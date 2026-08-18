"""Haftalik program OKUMA ucu (WP3, K-59 sonrasi) — kontrat §7.

Yerlesim SUBEYE baglanir (K-14). session_type T/U/L'nin hangisini karsiladigini
soyler (K-20, W8). delivery_mode=ONLINE_ASYNC girisler gun/saat tasir ama
cakisma karsilastirmasina girmez (K-19). Cakisma kontrolu conflict_service
dikisi uzerinden yapilir (K-22); motor WP5'te C tarafindan takilir.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, get_current_user
from app.cohort import cohort_course_filter
from app.schemas import WeeklyEntryOut

from app.models import (
    Classroom, Course, CourseSection, DeliveryMode, Department,
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


def _eager_entry_query(db: Session, *, published_only: bool = True):
    """WeeklyEntryOut'un ihtiyaç duyduğu ilişkileri tek seferde yükler (N+1 önleme).

    section → course (iç içe gösterim) ve classroom → building gerekir.

    **`published_only` VARSAYILAN OLARAK AÇIK (K-59).** Taslak satırları
    sahiplerine ÖZELDİR; genel okuma yollarına (liste, export, ders ekranı
    rozetleri) karışırlarsa herkes birbirinin özel denemesini görür ve aynı
    ders ızgarada birkaç kez çizilir. Varsayılanın güvenli olmasının sebebi:
    yeni bir çağıran filtreyi eklemeyi UNUTURSA sızıntı değil, eksik veri olur —
    ikincisi fark edilir, birincisi edilmez.

    Taslağın KENDİ satırlarını okuyan yerler (schedule_drafts,
    schedule_approvals) `published_only=False` verip `draft_id` ile süzer.
    """
    q = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .options(
            selectinload(WeeklyScheduleEntry.section).selectinload(CourseSection.course),
            selectinload(WeeklyScheduleEntry.classroom).selectinload(Classroom.building),
        )
    )
    return q.filter(WeeklyScheduleEntry.draft_id.is_(None)) if published_only else q

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
    is_common: bool | None = Query(None, description="K-48: yalnız ortak dersler"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _eager_entry_query(db).filter(Department.workgroup_id == user.workgroup_id)
    # K-26: workgroup içindeki herkes TÜM bölümleri okur — çakışmayı çözebilmek için
    # başka bölümün doluluğunu görmek şarttır. Yazma kısıtı ayrıdır (bayrak + üyelik).
    # K-57: cohort görünümü ek cohort'ları da kapsar (tüketilen ortak dersin
    # yerleşimleri de görünsün — grid ile palet tutarlı olsun).
    if department_id is not None:
        q = q.filter(cohort_course_filter(department_id, year, semester))
    else:
        if year is not None:
            q = q.filter(Course.year == year)
        if semester is not None:
            q = q.filter(Course.semester == semester)
    if classroom_id is not None:
        q = q.filter(WeeklyScheduleEntry.classroom_id == classroom_id)
    if lecturer_id is not None:
        q = q.filter(CourseSection.lecturer_id == lecturer_id)
    if is_common is not None:                          # K-48: "Ortak Dersler" görünümü
        q = q.filter(Course.is_common.is_(is_common))
    return q.order_by(
        WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot
    ).all()


# ------------------------------------------------------------------
# YAZMA UÇLARI KALDIRILDI (K-59)
# ------------------------------------------------------------------
#
# Eskiden burada POST/PATCH/DELETE /weekly-entries, /weekly-entries/submit ve
# /weekly-entries/{id}/revert-to-draft vardı: `can_manage_weekly` yetkisi olan
# herkes YAYINDAKİ programa doğrudan yazabiliyordu.
#
# K-59 ile yayına yazan TEK yol onaydır (routers/schedule_approvals.py).
# Bu uçlar durdukça arayüz kullanmasa bile API üzerinden onay adımı tümden
# atlanabiliyordu — yani onay sisteminin bütün amacı boşa çıkıyordu. Bu yüzden
# kaldırıldılar; düzenleme artık yalnız kendi taslağının içinde yapılır
# (routers/schedule_drafts.py).
#
# Bu dosyada KALAN: okuma ucu (GET) + doğrulama yardımcıları. Yardımcıları
# schedule_drafts.py import eder — doğrulama kuralları (slot penceresi, online
# derslik yasağı, çapraz-FK izolasyonu) tek yerde dursun.
