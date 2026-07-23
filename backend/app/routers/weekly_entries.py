"""Haftalik program endpoint'leri (WP3) — kontrat §7, save/submit deseni (K-03).

Yerlesim SUBEYE baglanir (K-14). session_type T/U/L'nin hangisini karsiladigini
soyler (K-20, W8). delivery_mode=ONLINE_ASYNC girisler gun/saat tasir ama
cakisma karsilastirmasina girmez (K-19). Cakisma kontrolu conflict_service
dikisi uzerinden yapilir (K-22); motor WP5'te C tarafindan takilir.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.audit import log_action
from app.conflict_service import check_weekly_save, check_weekly_submit
from app.deps import get_db, get_current_user, require_weekly_manager
from app.models import (
    Classroom, Course, CourseSection, Department, EntryStatus,
    SemesterType, User, UserRole, WeeklyScheduleEntry,
)
from app.schemas import (
    WeeklyEntryCreate, WeeklyEntryOut, WeeklyEntrySaveResponse,
    WeeklyEntrySubmitRequest, WeeklyEntrySubmitResponse, WeeklyEntryUpdate,
)

from app.models import (
    Classroom, Course, CourseSection, DeliveryMode, Department, EntryStatus,
    SemesterType, User, UserRole, WeeklyScheduleEntry,
)

router = APIRouter(tags=["weekly-entries"])


# ------------------------------------------------------------------
# Yardımcılar: erişim ve sahiplik kontrolleri (exams.py deseni)
# ------------------------------------------------------------------

def _member_department_ids(user: User) -> set[int]:
    return {m.department_id for m in user.memberships}


def _ensure_department_access(user: User, department_id: int) -> None:
    """Alt hesap yalnız atanmış bölümlerinin girişlerini yazabilir (kontrat §7)."""
    if user.role != UserRole.ADMIN and department_id not in _member_department_ids(user):
        raise HTTPException(status_code=403, detail="Bu bölümde yetkiniz yok")


def _get_owned_section(db: Session, user: User, section_id: int) -> CourseSection:
    """Gövdedeki şube bizim workgroup'un mu? Değilse 400 (çapraz-FK izolasyonu)."""
    section = (
        db.query(CourseSection)
        .join(Course).join(Department)
        .filter(CourseSection.id == section_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if section is None:
        raise HTTPException(status_code=400, detail="Geçersiz şube seçimi")
    return section


def _get_owned_entry(db: Session, user: User, entry_id: int) -> WeeklyScheduleEntry:
    """Giriş bizim workgroup'ta mı? Değilse/yoksa 404 (varlık sızdırmama)."""
    entry = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .filter(WeeklyScheduleEntry.id == entry_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Haftalık giriş bulunamadı")
    return entry


def _validate_classroom(db: Session, user: User, classroom_id: int | None) -> None:
    """Gövdedeki derslik bizim workgroup'un mu? (çapraz-FK izolasyonu)"""
    if classroom_id is not None:
        room = db.get(Classroom, classroom_id)
        if room is None or room.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz derslik seçimi")


def _ensure_slot_window(start_slot: int, slot_count: int) -> None:
    """Slot taşması API'de temiz 400 verir; DB CHECK yedekte (W6 motorda mesaj üretir)."""
    if start_slot + slot_count - 1 > 9:
        raise HTTPException(status_code=400,
                            detail="Slot penceresi aşıldı (start_slot + slot_count - 1 ≤ 9 olmalı)")


def _ensure_online_has_no_classroom(delivery_mode: DeliveryMode,
                                    classroom_id: int | None) -> None:
    """K-23: hibrit ders yok — online girişte derslik olmaz.

    Aksi halde yüz yüzeden online'a çevrilip dersliği unutulan giriş, motorun
    o dersliği hayalet-dolu sanmasına ve sahte W1 üretmesine yol açar.
    """
    if delivery_mode != DeliveryMode.FACE_TO_FACE and classroom_id is not None:
        raise HTTPException(status_code=400,
                            detail="Online girişte derslik seçilemez (K-23: hibrit ders yok)")


def _ensure_draft(entry: WeeklyScheduleEntry) -> None:
    if entry.status != EntryStatus.DRAFT:
        raise HTTPException(status_code=409,
                            detail="Giriş SUBMITTED durumda — önce draft'a çevrilmeli")


def _eager_entry_query(db: Session):
    """WeeklyEntryOut'un ihtiyaç duyduğu ilişkileri tek seferde yükler (N+1 önleme).

    section → course (iç içe gösterim) ve classroom → building gerekir.
    """
    return (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .options(
            selectinload(WeeklyScheduleEntry.section).selectinload(CourseSection.course),
            selectinload(WeeklyScheduleEntry.classroom).selectinload(Classroom.building),
        )
    )

# ------------------------------------------------------------------
# Listeleme
# ------------------------------------------------------------------

@router.get("/weekly-entries", response_model=list[WeeklyEntryOut])
def list_weekly_entries(
    department_id: int | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    classroom_id: int | None = Query(None),
    lecturer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _eager_entry_query(db).filter(Department.workgroup_id == user.workgroup_id)
    # K-26: workgroup içindeki herkes TÜM bölümleri okur — çakışmayı çözebilmek için
    # başka bölümün doluluğunu görmek şarttır. Yazma kısıtı ayrıdır (bayrak + üyelik).
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if year is not None:
        q = q.filter(Course.year == year)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    if classroom_id is not None:
        q = q.filter(WeeklyScheduleEntry.classroom_id == classroom_id)
    if lecturer_id is not None:
        q = q.filter(CourseSection.lecturer_id == lecturer_id)
    return q.order_by(
        WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot
    ).all()


# ------------------------------------------------------------------
# Kayıt (save) — asla engellemez, conflicts bilgilendirir (K-03)
# ------------------------------------------------------------------

@router.post("/weekly-entries", response_model=WeeklyEntrySaveResponse,
             status_code=status.HTTP_201_CREATED)
def create_weekly_entry(
    payload: WeeklyEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_weekly_manager),
):
    section = _get_owned_section(db, user, payload.section_id)
    _ensure_department_access(user, section.course.department_id)

    data = payload.model_dump()
    _validate_classroom(db, user, data["classroom_id"])
    _ensure_slot_window(payload.start_slot, payload.slot_count)
    _ensure_online_has_no_classroom(payload.delivery_mode, payload.classroom_id)

    entry = WeeklyScheduleEntry(created_by=user.id, **data)
    db.add(entry)
    db.flush()
    log_action(db, user, "CREATE", "weekly_entry", entry.id, entry)
    db.commit()

    entry = _eager_entry_query(db).filter(WeeklyScheduleEntry.id == entry.id).first()
    conflicts = check_weekly_save(db, entry)
    # conflicts DOLU OLSA BİLE kayıt başarılıdır (K-03) — 201 döner.
    return {"entry": entry, "conflicts": conflicts}


@router.patch("/weekly-entries/{entry_id}", response_model=WeeklyEntrySaveResponse)
def update_weekly_entry(
    entry_id: int,
    payload: WeeklyEntryUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_weekly_manager),
):
    entry = _get_owned_entry(db, user, entry_id)
    _ensure_department_access(user, entry.section.course.department_id)
    _ensure_draft(entry)  # yalnız DRAFT düzenlenir (kontrat §7)

    data = payload.model_dump(exclude_unset=True)
    if "classroom_id" in data:
        _validate_classroom(db, user, data["classroom_id"])
    # Taşma kontrolü, değişen ve değişmeyen alanların BİRLEŞİMİ üzerinden yapılmalı
    _ensure_slot_window(
        data.get("start_slot", entry.start_slot),
        data.get("slot_count", entry.slot_count),
    )
    _ensure_online_has_no_classroom(
        data.get("delivery_mode", entry.delivery_mode),
        data.get("classroom_id", entry.classroom_id),
    )

    for field, value in data.items():
        setattr(entry, field, value)
    log_action(db, user, "UPDATE", "weekly_entry", entry.id, entry)
    db.commit()

    entry = _eager_entry_query(db).filter(WeeklyScheduleEntry.id == entry.id).first()
    conflicts = check_weekly_save(db, entry)
    return {"entry": entry, "conflicts": conflicts}

# ------------------------------------------------------------------
# Yaşam döngüsü: submit / revert / delete (K-03)
# ------------------------------------------------------------------

@router.post("/weekly-entries/submit", response_model=WeeklyEntrySubmitResponse)
def submit_weekly_entries(
    payload: WeeklyEntrySubmitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_weekly_manager),
):
    entries: list[WeeklyScheduleEntry] = []
    for entry_id in payload.entry_ids:
        entry = _get_owned_entry(db, user, entry_id)
        _ensure_department_access(user, entry.section.course.department_id)
        if entry.status == EntryStatus.SUBMITTED:
            raise HTTPException(status_code=409,
                                detail=f"Giriş {entry_id} zaten submit edilmiş")
        entries.append(entry)

    conflicts = check_weekly_submit(db, entries)
    hard = [c for c in conflicts if c["severity"] == "HARD"]
    warnings = [c for c in conflicts if c["severity"] == "WARNING"]

    if hard:
        # Hep-veya-hiç: tek HARD bile tüm kümeyi düşürür (K-03).
        # Kontrat 409 gövdesi detail + conflicts içerir; HTTPException
        # detail'i sarmaladığından JSONResponse kullanıyoruz.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "Hard çakışma nedeniyle submit reddedildi",
                     "conflicts": hard},
        )

    now = datetime.now(timezone.utc)
    for entry in entries:
        entry.status = EntryStatus.SUBMITTED
        entry.submitted_at = now  # CHECK: status ile tutarlı olmak zorunda
        log_action(db, user, "SUBMIT", "weekly_entry", entry.id, entry)
    db.commit()
    # W8 tamlık uyarıları dahil WARNING'ler submit'i durdurmaz, görünür kalır (K-20)
    return {"submitted": [e.id for e in entries], "warnings": warnings}


@router.post("/weekly-entries/{entry_id}/revert-to-draft", response_model=WeeklyEntryOut)
def revert_weekly_entry_to_draft(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_weekly_manager),
):
    entry = _get_owned_entry(db, user, entry_id)
    _ensure_department_access(user, entry.section.course.department_id)
    if entry.status != EntryStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="Giriş zaten taslak durumda")

    entry.status = EntryStatus.DRAFT
    entry.submitted_at = None
    log_action(db, user, "UPDATE", "weekly_entry", entry.id, entry)
    db.commit()
    return _eager_entry_query(db).filter(WeeklyScheduleEntry.id == entry.id).first()


@router.delete("/weekly-entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weekly_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_weekly_manager),
):
    entry = _get_owned_entry(db, user, entry_id)
    _ensure_department_access(user, entry.section.course.department_id)
    _ensure_draft(entry)  # SUBMITTED silinemez; önce draft'a çevrilir

    log_action(db, user, "DELETE", "weekly_entry", entry.id, entry)
    db.delete(entry)
    db.commit()