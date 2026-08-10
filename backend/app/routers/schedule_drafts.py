"""Program taslagi uclari (K-59 haftalik, K-60 sinav) — ozel cohort taslagi.

Yasam dongusu: OPEN -> PENDING -> APPROVED | REJECTED.
Onaylama/reddetme bu dosyada DEGIL; burada taslagin sahibinin yaptigi her sey
var: ac, duzenle, temizle, farki gor, onaya gonder, geri cek.

Uc kural bu dosyanin tamamini belirler:

1. **Taslak ozeldir.** Sahibinden BASKASI goremez — ADMIN dahil. Onay yetkisi
   bekleyen (PENDING) taslaklara erisim verir, o ayri bir dosyanin isi.
2. **Bekleyen taslak donar.** PENDING'ken duzenlenemez; onaylayici hareketli
   hedef incelemesin. Sahibi "geri cek" derse OPEN'a doner.
3. **Taslak acmak serbesttir, onaya gondermek degildir.** Ozel taslak kimseyi
   etkilemez, o yuzden kum havuzu herkese acik; yayina dokunma niyeti yetki
   + bolum uyeligi ister (K-25 iki boyut aynen).

**K-60 — iki kol, tek yasam dongusu.** Taslak `kind` ile haftalik programi ya
da sinav takvimini kapsar. Yasam dongusu, gizlilik, donma, kapsam denetimi ve
onaya gonderme kapisi IKISI ICIN DE AYNI; ayrisan tek sey satirlarin sekli.
Bu yuzden dosyada iki ayri router yok, `_svc(draft)` dagiticisi var: ortak
uclar (ac / temizle / fark / gonder) dogru servisi secer, satir uclari ise
turune gore ayrilir (`/entries` haftalik, `/exams` sinav) — cunku govdeleri
ve dogrulama kurallari gercekten farkli.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.audit import build_change_summary, log_action
from app.cohort import cohort_course_filter
from app.conflict_service import check_exams_save, check_weekly_save, scan_draft
from app.draft_dispatch import service_for as _svc
from app.deps import get_db, get_current_user
from app.models import (
    Course, CourseSection, Department, DraftKind, DraftStatus, Exam,
    ScheduleDraft, User, UserRole, WeeklyScheduleEntry,
)
from app.routers.exams import (
    _e2_message, _eager_exam_query, _ensure_weekday, _get_owned_course,
    _load_classrooms, _normalize_exam_index, _validate_exam_refs,
)
from app.routers.weekly_entries import (
    _ensure_online_has_no_classroom, _ensure_slot_window, _get_owned_section,
    _validate_classroom, _eager_entry_query,
)
from app.schemas import (
    DraftClearRequest, DraftClearResponse, DraftCreate, DraftDiffOut, DraftOut,
    DraftRename, DraftSubmitRequest, DraftSubmitResponse, ConflictScanOut,
    ExamCreate, ExamOut, ExamSaveResponse, ExamUpdate,
    WeeklyEntryCreate, WeeklyEntryOut, WeeklyEntrySaveResponse, WeeklyEntryUpdate,
)

router = APIRouter(tags=["schedule-drafts"])


# ------------------------------------------------------------------
# Erisim ve durum kontrolleri
# ------------------------------------------------------------------

def _get_own_draft(db: Session, user: User, draft_id: int) -> ScheduleDraft:
    """Taslak BENIM mi? Degilse/yoksa 404 — varlik bile sizdirilmez.

    403 degil 404: "bu taslak var ama senin degil" cevabi, ozel bir taslagin
    varligini ele verirdi. ADMIN de muaf DEGIL — K-59'da taslak sahibine
    ozeldir, yetki meselesi degil gizlilik meselesidir.
    """
    draft = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer))
        .filter(ScheduleDraft.id == draft_id,
                ScheduleDraft.created_by == user.id,
                ScheduleDraft.workgroup_id == user.workgroup_id)
        .first()
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Taslak bulunamadı")
    return draft


def _ensure_editable(draft: ScheduleDraft) -> None:
    """PENDING dondu, APPROVED gecmis. Duzenleme yalniz OPEN/REJECTED'da."""
    if draft.status == DraftStatus.PENDING:
        raise HTTPException(
            status_code=409,
            detail="Taslak onay bekliyor — düzenlemek için önce geri çekin",
        )
    if draft.status == DraftStatus.APPROVED:
        raise HTTPException(
            status_code=409, detail="Onaylanmış taslak geçmiş kaydıdır, değiştirilemez"
        )


def _ensure_can_submit(user: User, draft: ScheduleDraft) -> None:
    """Onaya gondermek yayina dokunma niyetidir: K-25'in iki boyutu aranir.

    K-60: yetenek bayragi taslagin TURUNE gore secilir — haftalik programa
    dokunma niyeti `can_manage_weekly`, sinav takvimine dokunma niyeti
    `can_manage_exams` ister. ONAYLAMAK ise tek bayrak (`can_approve_schedule`,
    K-59): hazirlamak alan uzmanligi, onaylamak gozetim rolu.
    """
    if user.role == UserRole.ADMIN:
        return
    if draft.kind is DraftKind.EXAM:
        if not user.can_manage_exams:
            raise HTTPException(status_code=403, detail="Sınav yönetim yetkisi gerekli")
    elif not user.can_manage_weekly:
        raise HTTPException(status_code=403, detail="Haftalık program yönetim yetkisi gerekli")
    if draft.department_id not in {m.department_id for m in user.memberships}:
        raise HTTPException(status_code=403, detail="Bu bölümde yetkiniz yok")


def _ensure_kind(draft: ScheduleDraft, expected: DraftKind) -> None:
    """Satir ucu ile taslagin turu uyusuyor mu? (K-60)

    Sinav taslagina haftalik yerlesim (ya da tersi) yazilamaz: taslak bir
    cohort'un TAM programidir, karisik bir taslagin farki ve onayi tanimsizdir.
    """
    if draft.kind is not expected:
        ad = "sınav takvimi" if draft.kind is DraftKind.EXAM else "haftalık program"
        raise HTTPException(
            status_code=409, detail=f"Bu taslak bir {ad} taslağı — bu uç ona uygun değil"
        )


def _ensure_section_in_cohort(
    db: Session, draft: ScheduleDraft, section: CourseSection
) -> None:
    """Sube, taslagin COHORT'una giren bir dersin subesi mi? (K-59)

    Taslagin kapsami bir cohort'tur; kapsam disi bir ders eklenirse iki sey
    birden bozulur:
      1. **Yetki:** taslak CE/1/Guz'a ait ve gonderim yetkisi CE uyeligine
         bakiyor. Kapsam denetimi olmasa CE'nin sorumlusu MATH'in dersini
         taslagina koyup onaylatabilir — hic yetkisi olmayan bir bolume
         yerlesim yazmis olur.
      2. **Fark:** `compute_diff` yayin tarafini cohort filtresiyle okur.
         Kapsam disi satirin yayinda karsiligi HIC olmaz, sonsuza dek
         "EKLENDI" gorunur ve onaylandiktan sonra bile fark kapanmaz.

    Sinir `cohort_course_filter` ile cizilir — taslagin ACILIRKEN neyi
    kopyaladigini belirleyen ve cakisma evreninin disladigi filtrenin AYNISI.
    Ortak ders (K-48) bu filtreye ek cohort'undan takilir; yani tuketen bolum
    ortak dersi kendi taslaginda YERLESTIREBILIR — K-49'un ruhuyla uyumlu.
    """
    _ensure_course_in_cohort(db, draft, section.course_id)


def _ensure_course_in_cohort(db: Session, draft: ScheduleDraft, course_id: int) -> None:
    """Kapsam denetiminin ders duzeyindeki hali — sinav bunu dogrudan kullanir.

    Sinav ders duzeyindedir (K-16), subesi yoktur; ama kapsam sorusu ayni ve
    cevabi ayni filtre verir. Haftalik yol subeden derse inip buraya gelir.
    """
    kapsamda = (
        db.query(Course.id)
        .filter(Course.id == course_id,
                cohort_course_filter(draft.department_id, draft.year, draft.semester))
        .first()
    )
    if kapsamda is None:
        raise HTTPException(
            status_code=400,
            detail="Bu ders taslağın kapsamında değil (bölüm + sınıf + dönem)",
        )


def _ensure_not_duplicate(
    db: Session, draft: ScheduleDraft, section_id: int, day: int, slot: int,
    session_type, exclude_id: int | None = None,
) -> None:
    """BIREBIR ayni yerlesim iki kez girilemez (K-59 eki).

    Ayni sube + ayni gun + ayni baslangic slotu + ayni oturum turu; yani
    "ayni satiri iki kez ekledim" durumu. Bu hicbir zaman kasitli degildir:
    bir subenin ogrencileri tek gruptur, ayni anda iki yerde olamaz.

    KAPSAM BILEREK DAR: yalniz TAM ayni yerlesim engellenir. Ust uste BINEN
    ama ayni olmayan yerlesimler (or. 1. slotta 2 saatlik ve 2. slotta 1
    saatlik) W5 kuraliyla UYARI olarak bildirilmeye devam eder — K-03/K-05'in
    "uyar ama engelleme" cizgisi burada degistirilmiyor. Gercek veride goruleni
    (ISG 1801 Sube 1, Cuma 1. slot, iki ozdes satir) durduran budur.
    """
    q = db.query(WeeklyScheduleEntry).filter(
        WeeklyScheduleEntry.draft_id == draft.id,
        WeeklyScheduleEntry.section_id == section_id,
        WeeklyScheduleEntry.day_of_week == day,
        WeeklyScheduleEntry.start_slot == slot,
        WeeklyScheduleEntry.session_type == session_type,
    )
    if exclude_id is not None:
        q = q.filter(WeeklyScheduleEntry.id != exclude_id)
    if q.first() is not None:
        raise HTTPException(
            status_code=409,
            detail="Bu şubenin aynı gün ve saatte aynı türde bir oturumu zaten var",
        )


def _get_draft_entry(db: Session, draft: ScheduleDraft, entry_id: int) -> WeeklyScheduleEntry:
    entry = (
        db.query(WeeklyScheduleEntry)
        .filter(WeeklyScheduleEntry.id == entry_id,
                WeeklyScheduleEntry.draft_id == draft.id)
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Taslakta böyle bir yerleşim yok")
    return entry


def _default_name(db: Session, payload: DraftCreate) -> str:
    dep = db.get(Department, payload.department_id)
    donem = {"FALL": "Güz", "SPRING": "Bahar", "SUMMER": "Yaz"}[payload.semester.value]
    tur = "Sınav" if payload.kind is DraftKind.EXAM else "Program"
    return f"{dep.code} · {payload.year}. sınıf · {donem} · {tur}"


def _to_out(db: Session, draft: ScheduleDraft) -> dict:
    """DraftOut govdesi: sayaclar taslagin O ANKI haline gore hesaplanir."""
    svc = _svc(draft)
    # Onaylanan taslagin satirlari yayina gecip silinir; canli fark hesabi o
    # noktada anlamsizdir (bos taslak "her sey kaldirildi" gibi gorunurdu).
    canli = draft.status != DraftStatus.APPROVED
    return {
        "id": draft.id,
        "department_id": draft.department_id,
        "department_name": draft.department.name,
        "year": draft.year,
        "semester": draft.semester,
        "kind": draft.kind,
        "name": draft.name,
        "status": draft.status,
        "entry_count": svc.draft_row_count(db, draft),
        "change_count": len(svc.compute_diff(db, draft)) if canli else 0,
        "owner": draft.owner,
        "created_at": draft.created_at,
        "submitted_at": draft.submitted_at,
        "submit_note": draft.submit_note,
        "reviewer": draft.reviewer,
        "reviewed_at": draft.reviewed_at,
        "review_note": draft.review_note,
        "applied_summary": draft.applied_summary,
    }


# ------------------------------------------------------------------
# Taslak yasam dongusu
# ------------------------------------------------------------------

@router.get("/schedule-drafts", response_model=list[DraftOut])
def list_my_drafts(
    include_history: bool = Query(False, description="Onaylanmışları da getir"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """YALNIZ kendi taslaklarim. Baskasininki hicbir kosulda listelenmez."""
    q = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer))
        .filter(ScheduleDraft.created_by == user.id,
                ScheduleDraft.workgroup_id == user.workgroup_id)
    )
    if not include_history:
        q = q.filter(ScheduleDraft.status != DraftStatus.APPROVED)
    return [
        _to_out(db, d)
        for d in q.order_by(ScheduleDraft.created_at.desc()).all()
    ]


@router.post("/schedule-drafts", response_model=DraftOut,
             status_code=status.HTTP_201_CREATED)
def create_draft(
    payload: DraftCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cohort taslagi acar ve O ANKI yayini icine kopyalar (K-59).

    Yetki ARANMAZ: ozel taslak kimseyi etkilemez, "su dersi tasisak ne olur"
    kum havuzu herkese aciktir. Yayina dokunma niyeti submit'te denetlenir.
    """
    dep = db.get(Department, payload.department_id)
    if dep is None or dep.workgroup_id != user.workgroup_id:
        raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")

    mevcut = (
        db.query(ScheduleDraft)
        .filter(ScheduleDraft.created_by == user.id,
                ScheduleDraft.department_id == payload.department_id,
                ScheduleDraft.year == payload.year,
                ScheduleDraft.semester == payload.semester,
                # K-60: tekillik kind'i da iceriyor — ayni cohort icin haftalik
                # ve sinav taslagi ayni anda acilabilir.
                ScheduleDraft.kind == payload.kind,
                ScheduleDraft.status != DraftStatus.APPROVED)
        .first()
    )
    if mevcut is not None:
        # Kismi UNIQUE index zaten engellerdi; temiz mesaj + taslagin id'si
        # verilsin diye once burada yakaliyoruz (K-59: sahip basina tek aktif).
        tur = "sınav" if payload.kind is DraftKind.EXAM else "program"
        raise HTTPException(
            status_code=409,
            detail=f"Bu cohort için zaten açık {tur} taslağınız var (#{mevcut.id})",
        )

    draft = ScheduleDraft(
        workgroup_id=user.workgroup_id,
        department_id=payload.department_id,
        year=payload.year,
        semester=payload.semester,
        kind=payload.kind,
        name=payload.name or _default_name(db, payload),
        created_by=user.id,
    )
    db.add(draft)
    db.flush()
    _svc(draft).copy_published_into_draft(db, draft)
    log_action(db, user, "CREATE", "schedule_draft", draft.id, draft)
    db.commit()
    db.refresh(draft)
    return _to_out(db, draft)


@router.get("/schedule-drafts/{draft_id}", response_model=DraftOut)
def get_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _to_out(db, _get_own_draft(db, user, draft_id))


@router.patch("/schedule-drafts/{draft_id}", response_model=DraftOut)
def rename_draft(
    draft_id: int,
    payload: DraftRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = _get_own_draft(db, user, draft_id)
    _ensure_editable(draft)
    ozet = build_change_summary(draft, {"name": payload.name})
    draft.name = payload.name
    log_action(db, user, "UPDATE", "schedule_draft", draft.id, draft, ozet)
    db.commit()
    return _to_out(db, draft)


@router.delete("/schedule-drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslagi atar. Yayina HICBIR etkisi yoktur — ozel taslagin guvencesi bu."""
    draft = _get_own_draft(db, user, draft_id)
    if draft.status == DraftStatus.PENDING:
        raise HTTPException(
            status_code=409, detail="Onay bekleyen taslak silinemez — önce geri çekin"
        )
    if draft.status == DraftStatus.APPROVED:
        raise HTTPException(
            status_code=409, detail="Onaylanmış taslak geçmiş kaydıdır, silinemez"
        )
    log_action(db, user, "DELETE", "schedule_draft", draft.id, draft)
    db.delete(draft)          # satirlari FK CASCADE ile gider
    db.commit()


@router.post("/schedule-drafts/{draft_id}/clear", response_model=DraftClearResponse)
def clear_draft_entries(
    draft_id: int,
    payload: DraftClearRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslagi bosaltir — sifirdan dizmek icin. Yayina dokunmaz."""
    draft = _get_own_draft(db, user, draft_id)
    _ensure_editable(draft)
    silinen, korunan = _svc(draft).clear_draft(db, draft, payload.include_shared)
    birim = "sınav" if draft.kind is DraftKind.EXAM else "yerleşim"
    log_action(db, user, "UPDATE", "schedule_draft", draft.id, draft,
               f"Taslak temizlendi: {silinen} {birim} silindi"
               + (f", {korunan} ortak ders korundu" if korunan else ""))
    db.commit()
    return {"deleted": silinen, "preserved_shared": korunan}


# ------------------------------------------------------------------
# Fark ve cakisma
# ------------------------------------------------------------------

@router.get("/schedule-drafts/{draft_id}/diff", response_model=DraftDiffOut)
def get_draft_diff(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslak ile O ANKI yayin arasindaki fark (K-59: canli hesaplanir)."""
    draft = _get_own_draft(db, user, draft_id)
    return {
        "draft_id": draft.id,
        "kind": draft.kind,
        "items": _svc(draft).compute_diff(db, draft),
    }


@router.get("/schedule-drafts/{draft_id}/conflicts", response_model=ConflictScanOut)
def get_draft_conflicts(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslagin cakisma tablosu — kendi ici + yayindaki diger cohort'lara karsi."""
    draft = _get_own_draft(db, user, draft_id)
    return scan_draft(db, draft)


# ------------------------------------------------------------------
# Taslak icindeki yerlesimler
# ------------------------------------------------------------------

@router.get("/schedule-drafts/{draft_id}/entries", response_model=list[WeeklyEntryOut])
def list_draft_entries(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.WEEKLY)
    return (
        _eager_entry_query(db, published_only=False)
        .filter(WeeklyScheduleEntry.draft_id == draft.id)
        .order_by(WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot)
        .all()
    )


@router.post("/schedule-drafts/{draft_id}/entries",
             response_model=WeeklyEntrySaveResponse,
             status_code=status.HTTP_201_CREATED)
def create_draft_entry(
    draft_id: int,
    payload: WeeklyEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslaga yerlesim ekler. Cakisma BILGILENDIRIR, engellemez (K-03)."""
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.WEEKLY)
    _ensure_editable(draft)
    section = _get_owned_section(db, user, payload.section_id)  # capraz-FK izolasyonu
    _ensure_section_in_cohort(db, draft, section)               # kapsam (K-59)
    _validate_classroom(db, user, payload.classroom_id)
    _ensure_slot_window(payload.start_slot, payload.slot_count)
    _ensure_online_has_no_classroom(payload.delivery_mode, payload.classroom_id)
    _ensure_not_duplicate(db, draft, payload.section_id, payload.day_of_week,
                          payload.start_slot, payload.session_type)

    entry = WeeklyScheduleEntry(draft_id=draft.id, created_by=user.id,
                                **payload.model_dump())
    db.add(entry)
    db.flush()
    log_action(db, user, "CREATE", "weekly_entry", entry.id, entry,
               f"Taslak #{draft.id}")
    db.commit()

    entry = (_eager_entry_query(db, published_only=False)
             .filter(WeeklyScheduleEntry.id == entry.id).first())
    return {"entry": entry, "conflicts": check_weekly_save(db, entry, draft)}


@router.patch("/schedule-drafts/{draft_id}/entries/{entry_id}",
              response_model=WeeklyEntrySaveResponse)
def update_draft_entry(
    draft_id: int,
    entry_id: int,
    payload: WeeklyEntryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.WEEKLY)
    _ensure_editable(draft)
    entry = _get_draft_entry(db, draft, entry_id)

    data = payload.model_dump(exclude_unset=True)
    if "classroom_id" in data:
        _validate_classroom(db, user, data["classroom_id"])
    # Tasma ve online kontrolu, degisen + degismeyen alanlarin BIRLESIMI uzerinden
    _ensure_slot_window(
        data.get("start_slot", entry.start_slot),
        data.get("slot_count", entry.slot_count),
    )
    _ensure_online_has_no_classroom(
        data.get("delivery_mode", entry.delivery_mode),
        data.get("classroom_id", entry.classroom_id),
    )
    # Tasima da mukerrer uretebilir: bir satiri otekinin tam ustune birakmak.
    _ensure_not_duplicate(
        db, draft, entry.section_id,
        data.get("day_of_week", entry.day_of_week),
        data.get("start_slot", entry.start_slot),
        data.get("session_type", entry.session_type),
        exclude_id=entry.id,
    )

    ozet = build_change_summary(entry, data)
    for field, value in data.items():
        setattr(entry, field, value)
    log_action(db, user, "UPDATE", "weekly_entry", entry.id, entry, ozet)
    db.commit()

    entry = (_eager_entry_query(db, published_only=False)
             .filter(WeeklyScheduleEntry.id == entry.id).first())
    return {"entry": entry, "conflicts": check_weekly_save(db, entry, draft)}


@router.delete("/schedule-drafts/{draft_id}/entries/{entry_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_draft_entry(
    draft_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslaktan yerlesim cikarir. Yayindaki satir yerinde kalir; kaldirma
    ancak onay ile gerceklesir (K-59)."""
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.WEEKLY)
    _ensure_editable(draft)
    entry = _get_draft_entry(db, draft, entry_id)
    log_action(db, user, "DELETE", "weekly_entry", entry.id, entry,
               f"Taslak #{draft.id}")
    db.delete(entry)
    db.commit()


# ------------------------------------------------------------------
# Taslak icindeki sinavlar (K-60)
# ------------------------------------------------------------------

def _get_draft_exam(db: Session, draft: ScheduleDraft, exam_id: int) -> Exam:
    exam = (
        db.query(Exam)
        .filter(Exam.id == exam_id, Exam.draft_id == draft.id)
        .first()
    )
    if exam is None:
        raise HTTPException(status_code=404, detail="Taslakta böyle bir sınav yok")
    return exam


def _ensure_no_duplicate_exam(
    db: Session, draft: ScheduleDraft, course_id: int, exam_type, exam_index: int,
    exclude_id: int | None = None,
) -> None:
    """E2 on-kontrolu — taslagin KENDI icinde (K-46/K-60).

    Kismi UNIQUE indeks zaten engellerdi; buradaki amac ham DB hatasi yerine
    "bu dersin 2. vizesi zaten tanimli" diyebilmek. Kapsam taslakla sinirli:
    yayindaki ayni sinav bir CAKISMA degil, taslagin degistirdigi satirin ta
    kendisidir.
    """
    q = db.query(Exam).filter(
        Exam.draft_id == draft.id,
        Exam.course_id == course_id,
        Exam.exam_type == exam_type,
        Exam.exam_index == exam_index,
    )
    if exclude_id is not None:
        q = q.filter(Exam.id != exclude_id)
    if q.first() is not None:
        raise HTTPException(status_code=409, detail=_e2_message(exam_type, exam_index))


@router.get("/schedule-drafts/{draft_id}/exams", response_model=list[ExamOut])
def list_draft_exams(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.EXAM)
    return (
        _eager_exam_query(db, published_only=False)
        .filter(Exam.draft_id == draft.id)
        .order_by(Exam.exam_date, Exam.start_time)
        .all()
    )


@router.post("/schedule-drafts/{draft_id}/exams", response_model=ExamSaveResponse,
             status_code=status.HTTP_201_CREATED)
def create_draft_exam(
    draft_id: int,
    payload: ExamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslaga sinav ekler. Cakisma BILGILENDIRIR, engellemez (K-03).

    Dogrulama kurallari (E2 on-kontrolu, hafta ici zorunlulugu, K-46 sira
    normalizasyonu, capraz-FK izolasyonu) eski `/exams` ucundan AYNEN gelir —
    kural degismedi, yalnizca kapi degisti (K-60).
    """
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.EXAM)
    _ensure_editable(draft)

    course = _get_owned_course(db, user, payload.course_id)   # capraz-FK izolasyonu
    _ensure_course_in_cohort(db, draft, course.id)            # kapsam (K-59/K-60)

    data = payload.model_dump()
    _validate_exam_refs(db, user, data)
    _ensure_weekday(payload.exam_date)
    data["exam_index"] = _normalize_exam_index(
        payload.exam_type, payload.exam_index, course)
    _ensure_no_duplicate_exam(
        db, draft, course.id, payload.exam_type, data["exam_index"])

    classroom_ids = data.pop("classroom_ids")
    exam = Exam(draft_id=draft.id, created_by=user.id, **data)
    exam.classrooms = _load_classrooms(db, classroom_ids)
    db.add(exam)
    db.flush()
    log_action(db, user, "CREATE", "exam", exam.id, exam, f"Taslak #{draft.id}")
    db.commit()

    exam = (_eager_exam_query(db, published_only=False)
            .filter(Exam.id == exam.id).first())
    return {"exam": exam, "conflicts": check_exams_save(db, exam, draft)}


@router.patch("/schedule-drafts/{draft_id}/exams/{exam_id}",
              response_model=ExamSaveResponse)
def update_draft_exam(
    draft_id: int,
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.EXAM)
    _ensure_editable(draft)
    exam = _get_draft_exam(db, draft, exam_id)

    data = payload.model_dump(exclude_unset=True)
    _validate_exam_refs(db, user, data)
    if "exam_date" in data:
        _ensure_weekday(data["exam_date"])

    new_type = data.get("exam_type", exam.exam_type)
    new_index = _normalize_exam_index(
        new_type, data.get("exam_index", exam.exam_index), exam.course)
    # Sira degistiyse (or. final'e cevrilince 1'e sabitlendi) data'ya yaz ki
    # asagidaki setattr dongusu kalici kilsin.
    if new_index != exam.exam_index:
        data["exam_index"] = new_index
    if (new_type, new_index) != (exam.exam_type, exam.exam_index):
        _ensure_no_duplicate_exam(
            db, draft, exam.course_id, new_type, new_index, exclude_id=exam.id)

    classroom_ids = data.pop("classroom_ids", None)
    if classroom_ids is not None:      # verilirse liste TAM degisir (K-22)
        exam.classrooms = _load_classrooms(db, classroom_ids)
    ozet = build_change_summary(exam, data)
    for field, value in data.items():
        setattr(exam, field, value)
    log_action(db, user, "UPDATE", "exam", exam.id, exam, ozet)
    db.commit()

    exam = (_eager_exam_query(db, published_only=False)
            .filter(Exam.id == exam.id).first())
    return {"exam": exam, "conflicts": check_exams_save(db, exam, draft)}


@router.delete("/schedule-drafts/{draft_id}/exams/{exam_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_draft_exam(
    draft_id: int,
    exam_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslaktan sinav cikarir. Yayindaki sinav yerinde kalir; kaldirma ancak
    onay ile gerceklesir (K-60)."""
    draft = _get_own_draft(db, user, draft_id)
    _ensure_kind(draft, DraftKind.EXAM)
    _ensure_editable(draft)
    exam = _get_draft_exam(db, draft, exam_id)
    log_action(db, user, "DELETE", "exam", exam.id, exam, f"Taslak #{draft.id}")
    db.delete(exam)
    db.commit()


# ------------------------------------------------------------------
# Onaya gonderme / geri cekme
# ------------------------------------------------------------------

@router.post("/schedule-drafts/{draft_id}/submit", response_model=DraftSubmitResponse)
def submit_draft(
    draft_id: int,
    payload: DraftSubmitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Taslagi onaya gonderir: OPEN/REJECTED -> PENDING.

    Iki kapi:
      - Yetki: `can_manage_weekly` + bolum uyeligi (K-25).
      - HARD cakisma: varsa talep HIC olusmaz (K-03 aynen) — onay kuyrugu
        bastan bozuk taleplerle dolmasin. WARNING engellemez, gorunur kalir.

    Bos taslak da reddedilir: fark yoksa onaylanacak bir sey de yoktur.
    """
    draft = _get_own_draft(db, user, draft_id)
    _ensure_editable(draft)
    _ensure_can_submit(user, draft)

    if not _svc(draft).compute_diff(db, draft):
        raise HTTPException(
            status_code=409,
            detail="Taslak yayındaki programla aynı — onaya gönderilecek değişiklik yok",
        )

    tablo = scan_draft(db, draft)
    if tablo["hard"]:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "Hard çakışma nedeniyle onaya gönderilemedi",
                     "conflicts": tablo["hard"]},
        )

    draft.status = DraftStatus.PENDING
    draft.submitted_at = datetime.now(timezone.utc)
    draft.submit_note = payload.note
    # Onceki bir retten kalan gerekce yeni turda yaniltmasin.
    draft.reviewed_by = draft.reviewed_at = draft.review_note = None
    log_action(db, user, "SUBMIT", "schedule_draft", draft.id, draft,
               "Durum: Taslak → Onay bekliyor")
    db.commit()
    db.refresh(draft)
    return {"draft": _to_out(db, draft), "warnings": tablo["warnings"]}


@router.post("/schedule-drafts/{draft_id}/withdraw", response_model=DraftOut)
def withdraw_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Onay talebini geri ceker: PENDING -> OPEN, taslak tekrar duzenlenebilir."""
    draft = _get_own_draft(db, user, draft_id)
    if draft.status != DraftStatus.PENDING:
        raise HTTPException(status_code=409, detail="Taslak onay beklemiyor")

    draft.status = DraftStatus.OPEN
    draft.submitted_at = None
    log_action(db, user, "WITHDRAW", "schedule_draft", draft.id, draft,
               "Durum: Onay bekliyor → Taslak")
    db.commit()
    db.refresh(draft)
    return _to_out(db, draft)
