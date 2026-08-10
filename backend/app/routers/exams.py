"""Sinav OKUMA uclari (WP4 kalintisi) — kontrat §8.

Sinav DERS duzeyindedir (K-16, subeden bagimsiz) ve birden cok derslige
yayilabilir (K-17, exam_classrooms).

**K-60: bu dosyada artik YAZMA UCU YOK.** Eskiden burada duran
`POST/PATCH/DELETE /exams`, `POST /exams/submit` ve
`POST /exams/{id}/revert-to-draft` KALDIRILDI. Duran her kopyasi onay adimini
atlamanin bir yoluydu: `can_manage_exams` yetkisi olan biri onlari cagirarak
tek basina yayina yazabiliyordu — K-59'un haftalikta kapattigi bypass'in
aynisi. Sinav yazmanin tek yolu artik `schedule_drafts.py`'deki taslak uclari,
yayina gecmenin tek yolu ise onaydir.

Geriye kalan yardimcilar (`_eager_exam_query`, `_get_owned_course`,
`_validate_exam_refs`, `_ensure_weekday`, `_normalize_exam_index`,
`_e2_message`, `_load_classrooms`) SILINMEDI: dogrulama kurallari degismedi,
yalnizca KAPI degisti — taslak router'i ve export bunlari import ediyor.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, get_current_user
from app.cohort import cohort_course_filter
from app.models import (
    Classroom, Course, Department, Exam, ExamType, Lecturer, SemesterType, User,
)
from app.schemas import ExamOut

router = APIRouter(tags=["exams"])


# ------------------------------------------------------------------
# Yardımcılar: taslak router'ı ve export bunları paylaşır (K-60)
# ------------------------------------------------------------------

def _get_owned_course(db: Session, user: User, course_id: int) -> Course:
    """Gövdedeki ders referansı bizim workgroup'un mu? Değilse 400."""
    course = (
        db.query(Course)
        .join(Department)
        .filter(Course.id == course_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if course is None:
        raise HTTPException(status_code=400, detail="Geçersiz ders seçimi")
    return course


def _validate_exam_refs(db: Session, user: User, data: dict) -> None:
    """Gövdedeki FK'lar bizim workgroup'un mu? (çapraz-FK izolasyonu)"""
    if data.get("lecturer_id") is not None:
        lec = db.get(Lecturer, data["lecturer_id"])
        if lec is None or lec.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz hoca seçimi")
    if data.get("classroom_ids"):
        ids = data["classroom_ids"]
        owned = db.query(Classroom.id).filter(
            Classroom.id.in_(ids),
            Classroom.workgroup_id == user.workgroup_id,
        ).count()
        if owned != len(set(ids)):
            raise HTTPException(status_code=400, detail="Geçersiz derslik seçimi")


def _ensure_weekday(exam_date: date) -> None:
    """Hafta sonu sınav yok (K-06) — kontrat: 400. DB CHECK yedekte."""
    if exam_date.isoweekday() > 5:
        raise HTTPException(status_code=400,
                            detail="Sınav tarihi hafta içi olmalı (K-06: hafta sonu sınav yok)")


def _normalize_exam_index(exam_type: ExamType, exam_index: int, course: Course) -> int:
    """K-46: sınavın 'kaçıncı vize' değerini kurallara göre sabitle/doğrula.

    - MIDTERM dışı (final/büt) ders başına tektir → sıra HER ZAMAN 1 (istemci
      farklı gönderse bile sessizce 1'e çekilir).
    - MIDTERM'de sıra 1..course.midterm_count aralığında olmalı; dışındaysa 400.
    """
    if exam_type != ExamType.MIDTERM:
        return 1
    if not (1 <= exam_index <= course.midterm_count):
        raise HTTPException(
            status_code=400,
            detail=f"Bu ders için en fazla {course.midterm_count} vize tanımlı "
                   f"(geçersiz sıra: {exam_index})",
        )
    return exam_index


def _e2_message(exam_type: ExamType, exam_index: int) -> str:
    """E2 (mükerrer sınav) ön-kontrol mesajı — vizede kaçıncısı olduğunu söyler."""
    if exam_type == ExamType.MIDTERM:
        return f"Bu dersin {exam_index}. vizesi zaten tanımlı (E2)"
    return "Bu dersin bu tipte sınavı zaten var (E2)"


def _load_classrooms(db: Session, classroom_ids: list[int]) -> list[Classroom]:
    if not classroom_ids:
        return []
    return db.query(Classroom).filter(Classroom.id.in_(classroom_ids)).all()


def _eager_exam_query(db: Session, published_only: bool = True):
    """ExamOut'un ihtiyaç duyduğu ilişkileri tek seferde yükler (N+1 önleme).

    course.sections, total_expected_students hesabı için gerekir (K-16).

    K-60: `published_only` GÜVENLİ VARSAYILAN olarak True. Taslak sınavlar
    sahiplerine özeldir; genel okuma yollarından (liste, export) görünmemeleri
    gerekir. Varsayılanı True tutmanın gerekçesi K-59'un pahalı dersi: haftalıkta
    bu süzgeç unutulmuştu ve herkesin özel taslak satırları ızgarada çizildi
    ("aynı saatte 4 tane ISG 1801"). Yeni bir çağıran süzgeci unutursa sızıntı
    değil EKSİK VERİ olur — ikincisi fark edilir, birincisi edilmez.

    Bütünlük kontrolleri (silme engelleri) bu sorguyu KULLANMAZ ve kullanmamalı:
    ders/hoca silinirken taslaktaki kopya da FK'ya takılır, onu saymamak
    kullanıcıya "silinebilir" deyip ham DB hatası göstermek olurdu.
    """
    q = (
        db.query(Exam)
        .join(Course).join(Department)
        .options(
            selectinload(Exam.course).selectinload(Course.sections),
            selectinload(Exam.classrooms).selectinload(Classroom.building),
            selectinload(Exam.lecturer),
        )
    )
    return q.filter(Exam.draft_id.is_(None)) if published_only else q


# ------------------------------------------------------------------
# Listeleme
# ------------------------------------------------------------------

@router.get("/exams", response_model=list[ExamOut])
def list_exams(
    department_id: int | None = Query(None),
    exam_type: ExamType | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    classroom_id: int | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    lecturer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _eager_exam_query(db).filter(Department.workgroup_id == user.workgroup_id)
    # K-26: workgroup içindeki herkes TÜM bölümleri okur; yazma kısıtı ayrıdır
    # (bayrak + üyelik, yazma uçlarında).
    # K-57: cohort görünümü ek cohort'ları da kapsar (tüketilen ortak dersin
    # sınavları da bu cohort'un listesinde görünsün).
    if department_id is not None:
        q = q.filter(cohort_course_filter(department_id, year, semester))
    else:
        if year is not None:
            q = q.filter(Course.year == year)
        if semester is not None:
            q = q.filter(Course.semester == semester)
    if exam_type is not None:
        q = q.filter(Exam.exam_type == exam_type)
    if date_from is not None:
        q = q.filter(Exam.exam_date >= date_from)
    if date_to is not None:
        q = q.filter(Exam.exam_date <= date_to)
    if classroom_id is not None:
        q = q.filter(Exam.classrooms.any(Classroom.id == classroom_id))
    if lecturer_id is not None:
        q = q.filter(Exam.lecturer_id == lecturer_id)
    return q.order_by(Exam.exam_date, Exam.start_time).all()
