"""Program taslagi uclari (K-59) — ozel cohort taslagi + onaya gonderme.

Yasam dongusu: OPEN -> PENDING -> APPROVED | REJECTED.
Onaylama/reddetme bu dosyada DEGIL (adim 4); burada taslagin sahibinin yaptigi
her sey var: ac, duzenle, temizle, farki gor, onaya gonder, geri cek.

Uc kural bu dosyanin tamamini belirler:

1. **Taslak ozeldir.** Sahibinden BASKASI goremez — ADMIN dahil. Onay yetkisi
   bekleyen (PENDING) taslaklara erisim verir, o da adim 4'un isi.
2. **Bekleyen taslak donar.** PENDING'ken duzenlenemez; onaylayici hareketli
   hedef incelemesin. Sahibi "geri cek" derse OPEN'a doner.
3. **Taslak acmak serbesttir, onaya gondermek degildir.** Ozel taslak kimseyi
   etkilemez, o yuzden kum havuzu herkese acik; yayina dokunma niyeti
   `can_manage_weekly` + bolum uyeligi ister (K-25 iki boyut aynen).
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.audit import build_change_summary, log_action
from app.conflict_service import check_weekly_save, scan_draft
from app.draft_service import (
    clear_draft, compute_diff, copy_published_into_draft, draft_entries,
)
from app.deps import get_db, get_current_user
from app.models import (
    Department, DraftStatus, ScheduleDraft, User, UserRole, WeeklyScheduleEntry,
)
from app.routers.weekly_entries import (
    _ensure_online_has_no_classroom, _ensure_slot_window, _get_owned_section,
    _validate_classroom, _eager_entry_query,
)
from app.schemas import (
    DraftClearRequest, DraftClearResponse, DraftCreate, DraftDiffOut, DraftOut,
    DraftRename, DraftSubmitRequest, DraftSubmitResponse, ConflictScanOut,
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
    """Onaya gondermek yayina dokunma niyetidir: K-25'in iki boyutu aranir."""
    if user.role == UserRole.ADMIN:
        return
    if not user.can_manage_weekly:
        raise HTTPException(status_code=403, detail="Haftalık program yönetim yetkisi gerekli")
    if draft.department_id not in {m.department_id for m in user.memberships}:
        raise HTTPException(status_code=403, detail="Bu bölümde yetkiniz yok")


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
    return f"{dep.code} · {payload.year}. sınıf · {donem}"


def _to_out(db: Session, draft: ScheduleDraft) -> dict:
    """DraftOut govdesi: sayaclar taslagin O ANKI haline gore hesaplanir."""
    entries = draft_entries(db, draft)
    # Onaylanan taslagin satirlari yayina gecip silinir; canli fark hesabi o
    # noktada anlamsizdir (bos taslak "her sey kaldirildi" gibi gorunurdu).
    canli = draft.status != DraftStatus.APPROVED
    return {
        "id": draft.id,
        "department_id": draft.department_id,
        "department_name": draft.department.name,
        "year": draft.year,
        "semester": draft.semester,
        "name": draft.name,
        "status": draft.status,
        "entry_count": len(entries),
        "change_count": len(compute_diff(db, draft)) if canli else 0,
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
                ScheduleDraft.status != DraftStatus.APPROVED)
        .first()
    )
    if mevcut is not None:
        # Kismi UNIQUE index zaten engellerdi; temiz mesaj + taslagin id'si
        # verilsin diye once burada yakaliyoruz (K-59: sahip basina tek aktif).
        raise HTTPException(
            status_code=409,
            detail=f"Bu cohort için zaten açık taslağınız var (#{mevcut.id})",
        )

    draft = ScheduleDraft(
        workgroup_id=user.workgroup_id,
        department_id=payload.department_id,
        year=payload.year,
        semester=payload.semester,
        name=payload.name or _default_name(db, payload),
        created_by=user.id,
    )
    db.add(draft)
    db.flush()
    copy_published_into_draft(db, draft)
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
    silinen, korunan = clear_draft(db, draft, payload.include_shared)
    log_action(db, user, "UPDATE", "schedule_draft", draft.id, draft,
               f"Taslak temizlendi: {silinen} yerleşim silindi"
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
    return {"draft_id": draft.id, "items": compute_diff(db, draft)}


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
    return (
        _eager_entry_query(db)
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
    _ensure_editable(draft)
    _get_owned_section(db, user, payload.section_id)   # capraz-FK izolasyonu
    _validate_classroom(db, user, payload.classroom_id)
    _ensure_slot_window(payload.start_slot, payload.slot_count)
    _ensure_online_has_no_classroom(payload.delivery_mode, payload.classroom_id)

    entry = WeeklyScheduleEntry(draft_id=draft.id, created_by=user.id,
                                **payload.model_dump())
    db.add(entry)
    db.flush()
    log_action(db, user, "CREATE", "weekly_entry", entry.id, entry,
               f"Taslak #{draft.id}")
    db.commit()

    entry = _eager_entry_query(db).filter(WeeklyScheduleEntry.id == entry.id).first()
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

    ozet = build_change_summary(entry, data)
    for field, value in data.items():
        setattr(entry, field, value)
    log_action(db, user, "UPDATE", "weekly_entry", entry.id, entry, ozet)
    db.commit()

    entry = _eager_entry_query(db).filter(WeeklyScheduleEntry.id == entry.id).first()
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
    _ensure_editable(draft)
    entry = _get_draft_entry(db, draft, entry_id)
    log_action(db, user, "DELETE", "weekly_entry", entry.id, entry,
               f"Taslak #{draft.id}")
    db.delete(entry)
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

    if not compute_diff(db, draft):
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
