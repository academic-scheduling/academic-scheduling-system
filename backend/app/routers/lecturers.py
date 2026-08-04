from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import get_db, get_current_user, require_lecturer_manager
from app.models import CourseSection, Department, Exam, Lecturer, User
from app.normalize import normalize_lecturer_name, turkish_lower
from app.scrapers import mu_akademik
from app.scrapers.mu_akademik import ScrapeError
from app.schemas import (
    ImportCommitIn, ImportCommitOut, ImportPreviewOut, ImportRow,
    LecturerCreate, LecturerUpdate, LecturerOut,
)
from app.audit import build_change_summary, log_action

router = APIRouter(prefix="/lecturers", tags=["lecturers"])


def _validate_department(db: Session, workgroup_id: int, department_id: int | None) -> None:
    """Asli bölüm bu workgroup'a ait olmalı; başka fakültenin bölümü seçilemez.
    None geçerlidir (bölümsüz kayda izin var)."""
    if department_id is None:
        return
    dep = db.get(Department, department_id)
    if dep is None or dep.workgroup_id != workgroup_id:
        raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")


@router.get("", response_model=list[LecturerOut])
def list_lecturers(
    search: str | None = Query(None, description="Autocomplete: normalized_name üzerinde arar"),
    include_inactive: bool = Query(
        False, description="K-28: pasifler de gelsin mi (yönetim ekranı için)"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Varsayılan yalnız aktifler: ders formundaki autocomplete pasife alınmış
    # hocayı ÖNERMEMELİ (K-08/K-28). Yönetim ekranı include_inactive=true geçer.
    q = db.query(Lecturer).filter(Lecturer.workgroup_id == user.workgroup_id)
    if not include_inactive:
        q = q.filter(Lecturer.active.is_(True))
    if search:
        # Aranan terimi de normalize et: kullanici "Doç. Ayşe" yazsa da bulsun
        q = q.filter(Lecturer.normalized_name.contains(normalize_lecturer_name(search)))
    return q.order_by(Lecturer.full_name).all()


@router.post("", response_model=LecturerOut, status_code=status.HTTP_201_CREATED)
def create_lecturer(
    payload: LecturerCreate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    normalized = normalize_lecturer_name(payload.full_name)
    if not normalized:
        raise HTTPException(status_code=400, detail="Geçerli bir hoca adı girilmeli")

    clash = db.query(Lecturer).filter(
        Lecturer.workgroup_id == manager.workgroup_id,
        Lecturer.normalized_name == normalized,
    ).first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"Bu hoca zaten kayıtlı: {clash.full_name}",
        )

    _validate_department(db, manager.workgroup_id, payload.department_id)

    lec = Lecturer(
        workgroup_id=manager.workgroup_id,
        full_name=payload.full_name,
        title=payload.title,      # K-52: unvan ayrı alan (ad'a gömülmez)
        normalized_name=normalized,
        email=payload.email,
        is_external=payload.is_external,
        department_id=payload.department_id,
        source="MANUAL",          # elle eklenen 40/a; web import'u IMPORT yazar
    )
    db.add(lec)
    db.flush()
    log_action(db, manager,"CREATE", "lecturer", lec.id, lec)
    db.commit()
    db.refresh(lec)
    return lec


@router.patch("/{lecturer_id}", response_model=LecturerOut)
def update_lecturer(
    lecturer_id: int,
    payload: LecturerUpdate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    lec = db.get(Lecturer, lecturer_id)
    if lec is None or lec.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Hoca bulunamadı")

    data = payload.model_dump(exclude_unset=True)

    if "department_id" in data:
        _validate_department(db, manager.workgroup_id, data["department_id"])

    # full_name degisirse normalized_name yeniden hesaplanir ve cakisma kontrol edilir.
    if "full_name" in data:
        normalized = normalize_lecturer_name(data["full_name"])
        if not normalized:
            raise HTTPException(status_code=400, detail="Geçerli bir hoca adı girilmeli")
        if normalized != lec.normalized_name:
            clash = db.query(Lecturer).filter(
                Lecturer.workgroup_id == manager.workgroup_id,
                Lecturer.normalized_name == normalized,
                Lecturer.id != lec.id,
            ).first()
            if clash:
                raise HTTPException(
                    status_code=409,
                    detail=f"Bu hoca zaten kayıtlı: {clash.full_name}",
                )
        lec.normalized_name = normalized

    ozet = build_change_summary(lec, data)
    for field, value in data.items():
        setattr(lec, field, value)
    log_action(db, manager,"UPDATE", "lecturer", lec.id, lec, ozet)
    db.commit()
    db.refresh(lec)
    return lec


@router.delete("/{lecturer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lecturer(
    lecturer_id: int,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    """Yalnız hiçbir yere bağlı olmayan öğretim üyesini siler (K-28).

    Şema zaten korur (lecturer_id FK'leri ondelete=RESTRICT); bu kontrol
    kullanıcının ham DB hatası yerine neyin engellediğini sayan bir mesaj
    görmesi için. Ders vermiş ama ayrılan hoca silinmez, pasife alınır.
    """
    lec = db.get(Lecturer, lecturer_id)
    if lec is None or lec.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Öğretim üyesi bulunamadı")

    section_count = db.query(CourseSection).filter(
        CourseSection.lecturer_id == lec.id
    ).count()
    exam_count = db.query(Exam).filter(Exam.lecturer_id == lec.id).count()

    if section_count or exam_count:
        parcalar = []
        if section_count:
            parcalar.append(f"{section_count} şube")
        if exam_count:
            parcalar.append(f"{exam_count} sınav")
        raise HTTPException(
            status_code=409,
            detail=f"Bu öğretim üyesi silinemez: {' ve '.join(parcalar)} bağlı. "
                   "Önce bu bağlantıları kaldırın.",
        )

    log_action(db, manager, "DELETE", "lecturer", lec.id, lec)
    db.delete(lec)
    db.commit()


# ============================================================================
# Fakülte web import (K-50) — K-08'in "fakülte sayfasından import" kararı
# ============================================================================
#
# İki uç: /import/preview (yalnız okur, farkı gösterir) ve /import/commit
# (kullanıcının onayladığı satırları yazar). Önizle→onayla ayrımı bilinçli:
# scraping kırılgandır, insan kapısı olmadan bozuk bir parser çöpü doğrudan
# lecturers'a — çakışma tespitinin kimlik anahtarına (K-08) — yazardı.


def _dept_key(text: str) -> str:
    """Bölüm adı eşlemesi için sadeleştirilmiş anahtar: küçük harf, noktalama
    boşluğa, tek boşluk. Site "Elektrik Elektronik" yazarken bizim adımız
    "Elektrik-Elektronik" olabilir — tire/nokta eşlemeyi bozmamalı."""
    for ch in "-–—/.,":
        text = text.replace(ch, " ")
    return " ".join(turkish_lower(text).split())


def _department_index(db: Session, workgroup_id: int) -> dict[str, tuple[int, str]]:
    """Aktif bölümlerin {sadeleştirilmiş ad: (id, "KOD — Ad")} sözlüğü.

    Görev Birimi metnini ("Bilgisayar Mühendisliği") bizim bölüm tablomuza
    eşlemek için. Eşleşmezse department_id NULL kalır (model buna izin verir).
    """
    index: dict[str, tuple[int, str]] = {}
    deps = (
        db.query(Department)
        .filter(Department.workgroup_id == workgroup_id, Department.active.is_(True))
        .all()
    )
    for dep in deps:
        index[_dept_key(dep.name)] = (dep.id, f"{dep.code} — {dep.name}")
    return index


def _match_department(
    index: dict[str, tuple[int, str]], unit: str | None
) -> tuple[int | None, str | None]:
    if not unit:
        return None, None
    hit = index.get(_dept_key(unit))
    return hit if hit else (None, None)


@router.post("/import/preview", response_model=ImportPreviewOut)
def import_preview(
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    """Fakülte sayfasını tarar, sistemde OLMAYAN kişileri döndürür (hiç yazmaz).

    Zaten kayıtlı kişiler ada göre (normalized_name) elenir; yalnız yeni
    kişilerin detay sayfası çekilir. Böylece ilk çalıştırma ağır, sonrakiler
    yalnız yeni eklenenleri okur — kullanıcının "site güncellenince farkı
    aktar" isteğinin karşılığı.
    """
    try:
        people = mu_akademik.fetch_list(settings.lecturer_import_list_url)
    except ScrapeError as exc:
        # Kaynak site çekilemedi ya da yapısı değişti: sessiz "0 yeni" değil,
        # görünür bir üst-akış hatası (502).
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    existing = {
        norm
        for (norm,) in db.query(Lecturer.normalized_name).filter(
            Lecturer.workgroup_id == manager.workgroup_id
        )
    }
    dept_index = _department_index(db, manager.workgroup_id)

    # 1. Faz — sınıflandırma (ağ yok): kim yeni, kim zaten kayıtlı. Yalnız
    # YENİ kişilerin detayı çekilecek (mevcutlar için detay sayfasına gidilmez).
    new_refs: list[tuple[str, object]] = []      # (normalized_name, PersonRef)
    already_present = 0
    seen: set[str] = set()
    for person in people:
        norm = normalize_lecturer_name(person.full_name)
        if not norm:
            continue
        if norm in existing:
            already_present += 1
            continue
        if norm in seen:
            continue                      # aynı taramada mükerrer (nadir)
        seen.add(norm)
        if len(new_refs) >= settings.lecturer_import_max_detail_fetch:
            break                          # emniyet supabı: yüzlerce detay çekme
        new_refs.append((norm, person))

    # 2. Faz — detayları SINIRLI eşzamanlılıkla topluca çek. İş ağ-bekleme
    # ağırlıklı; sıralı ~2 dk süren çekim havuzla ~15 sn'ye iner. Tek sayfanın
    # hatası o kişiyi bölümsüz bırakır, import'u düşürmez (bulk içinde ele alınır).
    details = mu_akademik.fetch_details_bulk(
        [person.detail_url for _, person in new_refs],
        max_workers=settings.lecturer_import_concurrency,
    )

    new_rows: list[ImportRow] = []
    for norm, person in new_refs:
        detail = details.get(
            person.detail_url,
            mu_akademik.PersonDetail(duty_unit=None, cadre_unit=None, email=None),
        )
        # Önce Görev Birimi (fiilen ders verdiği yer); tutmazsa Kadro Birimi'ne
        # düş. Yönetici hocalarda Görev bölüm değildir ("Rektörlük"), asıl bölüm
        # Kadro'da yazar (örn. Görev Rektörlük / Kadro İnşaat → İnşaat'a eşleşir).
        dept_id, dept_label = _match_department(dept_index, detail.duty_unit)
        if dept_id is None:
            dept_id, dept_label = _match_department(dept_index, detail.cadre_unit)
        new_rows.append(
            ImportRow(
                full_name=person.full_name,
                title=person.title,           # K-52: siteden kanonikleştirilen unvan
                normalized_name=norm,
                duty_unit=detail.duty_unit,
                cadre_unit=detail.cadre_unit,
                email=detail.email,
                department_id=dept_id,
                department_label=dept_label,
                detail_url=person.detail_url,
            )
        )

    return ImportPreviewOut(
        new=new_rows,
        already_present=already_present,
        list_total=len(people),
    )


@router.post("/import/commit", response_model=ImportCommitOut)
def import_commit(
    payload: ImportCommitIn,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    """Önizlemeden onaylanan satırları yazar (source='IMPORT').

    İstemciden gelen satırlara güvenmek, elle create'le aynı güven düzeyidir:
    sunucu yine de (a) ada göre benzersizliği YENİDEN denetler (önizlemeden bu
    yana biri eklenmiş olabilir — TOCTOU) ve (b) department_id'nin bu
    workgroup'a ait olduğunu doğrular; ait değilse bölümü boş bırakır, tüm
    partiyi düşürmez. Her satır ayrı ayrı loglanır (K-37 deseni).
    """
    created: list[Lecturer] = []
    skipped: list[str] = []

    for row in payload.rows:
        norm = normalize_lecturer_name(row.full_name)
        if not norm:
            skipped.append(row.full_name)
            continue
        clash = db.query(Lecturer).filter(
            Lecturer.workgroup_id == manager.workgroup_id,
            Lecturer.normalized_name == norm,
        ).first()
        if clash:
            skipped.append(row.full_name)
            continue

        dept_id = row.department_id
        if dept_id is not None:
            dep = db.get(Department, dept_id)
            if dep is None or dep.workgroup_id != manager.workgroup_id:
                dept_id = None            # güvenilmez bölüm: boş geç, partiyi düşürme

        lec = Lecturer(
            workgroup_id=manager.workgroup_id,
            full_name=row.full_name,
            title=row.title,              # K-52: unvan ayrı alan
            normalized_name=norm,
            email=row.email,
            is_external=False,            # fakülte kadrosu; 40/a değil
            source="IMPORT",
            department_id=dept_id,
            duty_unit=row.duty_unit,
            cadre_unit=row.cadre_unit,
        )
        db.add(lec)
        db.flush()
        log_action(db, manager, "CREATE", "lecturer", lec.id, lec)
        created.append(lec)

    db.commit()
    for lec in created:
        db.refresh(lec)
    return ImportCommitOut(created=created, skipped=skipped)