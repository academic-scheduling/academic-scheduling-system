"""Sinav endpoint'leri (WP4) — kontrat §8, save/submit deseni (K-03).

Sinav DERS duzeyindedir (K-16, subeden bagimsiz) ve birden cok derslige
yayilabilir (K-17, exam_classrooms). Cakisma kontrolu conflict_service
dikisi uzerinden yapilir (K-22); motor WP5'te C tarafindan takilir.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.audit import log_action
from app.conflict_service import check_exams_save, check_exams_submit
from app.deps import get_db, get_current_user
from app.models import (
    Classroom, Course, CourseSection, Department, EntryStatus, Exam,
    ExamType, Lecturer, SemesterType, User, UserRole,
)
from app.schemas import (
    ExamCreate, ExamOut, ExamSaveResponse, ExamSubmitRequest,
    ExamSubmitResponse, ExamUpdate,
)

router = APIRouter(tags=["exams"])


# ------------------------------------------------------------------
# Yardımcılar: erişim ve sahiplik kontrolleri (courses.py deseni)
# ------------------------------------------------------------------

def _member_department_ids(user: User) -> set[int]:
    return {m.department_id for m in user.memberships}


def _ensure_department_access(db: Session, user: User, department_id: int) -> None:
    """Alt hesap yalnız atanmış bölümlerinin sınavlarını yazabilir (kontrat §8)."""
    if user.role != UserRole.ADMIN and department_id not in _member_department_ids(user):
        raise HTTPException(status_code=403, detail="Bu bölümde yetkiniz yok")


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


def _get_owned_exam(db: Session, user: User, exam_id: int) -> Exam:
    """Sınav bizim workgroup'ta mı? Değilse/yoksa 404 (varlık sızdırmama)."""
    exam = (
        db.query(Exam)
        .join(Course).join(Department)
        .filter(Exam.id == exam_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if exam is None:
        raise HTTPException(status_code=404, detail="Sınav bulunamadı")
    return exam


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


def _ensure_draft(exam: Exam) -> None:
    if exam.status != EntryStatus.DRAFT:
        raise HTTPException(status_code=409,
                            detail="Sınav SUBMITTED durumda — önce draft'a çevrilmeli")


def _load_classrooms(db: Session, classroom_ids: list[int]) -> list[Classroom]:
    if not classroom_ids:
        return []
    return db.query(Classroom).filter(Classroom.id.in_(classroom_ids)).all()


def _eager_exam_query(db: Session):
    """ExamOut'un ihtiyaç duyduğu ilişkileri tek seferde yükler (N+1 önleme).

    course.sections, total_expected_students hesabı için gerekir (K-16).
    """
    return (
        db.query(Exam)
        .join(Course).join(Department)
        .options(
            selectinload(Exam.course).selectinload(Course.sections),
            selectinload(Exam.classrooms).selectinload(Classroom.building),
            selectinload(Exam.lecturer),
        )
    )


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
    # Alt hesap yalnız atanmış bölümlerini görür (courses.py ile aynı davranış)
    if user.role != UserRole.ADMIN:
        member_ids = _member_department_ids(user)
        if not member_ids:
            return []
        q = q.filter(Course.department_id.in_(member_ids))
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if exam_type is not None:
        q = q.filter(Exam.exam_type == exam_type)
    if date_from is not None:
        q = q.filter(Exam.exam_date >= date_from)
    if date_to is not None:
        q = q.filter(Exam.exam_date <= date_to)
    if classroom_id is not None:
        q = q.filter(Exam.classrooms.any(Classroom.id == classroom_id))
    if year is not None:
        q = q.filter(Course.year == year)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    if lecturer_id is not None:
        q = q.filter(Exam.lecturer_id == lecturer_id)
    return q.order_by(Exam.exam_date, Exam.start_time).all()


# ------------------------------------------------------------------
# Kayıt (save) — asla engellemez, conflicts bilgilendirir (K-03)
# ------------------------------------------------------------------

@router.post("/exams", response_model=ExamSaveResponse,
             status_code=status.HTTP_201_CREATED)
def create_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    course = _get_owned_course(db, user, payload.course_id)
    _ensure_department_access(db, user, course.department_id)

    data = payload.model_dump()
    _validate_exam_refs(db, user, data)
    _ensure_weekday(payload.exam_date)

    # E2 ön-kontrolü: aynı ders + aynı tip ikinci sınav (DB UNIQUE yedekte)
    clash = db.query(Exam).filter(
        Exam.course_id == course.id,
        Exam.exam_type == payload.exam_type,
    ).first()
    if clash:
        raise HTTPException(status_code=409,
                            detail="Bu dersin bu tipte sınavı zaten var (E2)")

    classroom_ids = data.pop("classroom_ids")
    exam = Exam(created_by=user.id, **data)
    exam.classrooms = _load_classrooms(db, classroom_ids)
    db.add(exam)
    db.flush()
    log_action(db, user, "CREATE", "exam", exam.id)
    db.commit()

    exam = _eager_exam_query(db).filter(Exam.id == exam.id).first()
    conflicts = check_exams_save(db, exam)
    return {"exam": exam, "conflicts": conflicts}


@router.patch("/exams/{exam_id}", response_model=ExamSaveResponse)
def update_exam(
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    _ensure_draft(exam)  # yalnız DRAFT düzenlenir (K-22)

    data = payload.model_dump(exclude_unset=True)
    _validate_exam_refs(db, user, data)
    if "exam_date" in data:
        _ensure_weekday(data["exam_date"])

    new_type = data.get("exam_type", exam.exam_type)
    if new_type != exam.exam_type:
        clash = db.query(Exam).filter(
            Exam.course_id == exam.course_id,
            Exam.exam_type == new_type,
            Exam.id != exam.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409,
                                detail="Bu dersin bu tipte sınavı zaten var (E2)")

    classroom_ids = data.pop("classroom_ids", None)
    if classroom_ids is not None:  # verilirse liste TAM değişir (K-22)
        exam.classrooms = _load_classrooms(db, classroom_ids)
    for field, value in data.items():
        setattr(exam, field, value)
    log_action(db, user, "UPDATE", "exam", exam.id)
    db.commit()

    exam = _eager_exam_query(db).filter(Exam.id == exam.id).first()
    conflicts = check_exams_save(db, exam)
    return {"exam": exam, "conflicts": conflicts}


# ------------------------------------------------------------------
# Yaşam döngüsü: submit / revert / delete (K-03)
# ------------------------------------------------------------------

@router.post("/exams/submit", response_model=ExamSubmitResponse)
def submit_exams(
    payload: ExamSubmitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    exams: list[Exam] = []
    for exam_id in payload.exam_ids:
        exam = _get_owned_exam(db, user, exam_id)
        _ensure_department_access(db, user, exam.course.department_id)
        if exam.status == EntryStatus.SUBMITTED:
            raise HTTPException(status_code=409,
                                detail=f"Sınav {exam_id} zaten submit edilmiş")
        exams.append(exam)

    conflicts = check_exams_submit(db, exams)
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
    for exam in exams:
        exam.status = EntryStatus.SUBMITTED
        exam.submitted_at = now  # CHECK: status ile tutarlı olmak zorunda
        log_action(db, user, "SUBMIT", "exam", exam.id)
    db.commit()
    return {"submitted": [e.id for e in exams], "warnings": warnings}


@router.post("/exams/{exam_id}/revert-to-draft", response_model=ExamOut)
def revert_exam_to_draft(
    exam_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    if exam.status != EntryStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="Sınav zaten taslak durumda")

    exam.status = EntryStatus.DRAFT
    exam.submitted_at = None
    log_action(db, user, "UPDATE", "exam", exam.id)
    db.commit()
    return _eager_exam_query(db).filter(Exam.id == exam.id).first()


@router.delete("/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    _ensure_draft(exam)  # SUBMITTED silinemez; önce draft'a çevrilir

    log_action(db, user, "DELETE", "exam", exam.id)
    db.delete(exam)  # exam_classrooms satırları CASCADE ile gider
    db.commit()
