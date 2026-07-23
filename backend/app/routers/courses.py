from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, get_current_user, require_course_manager
from app.models import (
    Classroom, Course, CourseSection, Department, DepartmentMembership,
    Exam, Lecturer, SemesterType, User, UserRole, WeeklyScheduleEntry,
)
from app.schemas import (
    CourseCreate, CourseUpdate, CourseOut,
    SectionCreate, SectionUpdate, SectionOut,
)
from app.audit import build_change_summary, log_action

router = APIRouter(tags=["courses"])


# ------------------------------------------------------------------
# Yardımcılar: erişim ve sahiplik kontrolleri
# ------------------------------------------------------------------

def _member_department_ids(user: User) -> set[int]:
    return {m.department_id for m in user.memberships}


def _ensure_department_access(db: Session, user: User, department_id: int) -> Department:
    """Üç katmanlı kontrol: bölüm var mı + bizim workgroup mu + üyelik var mı.

    - Yabancı/yok bölüm -> 400 (gövdedeki referans geçersiz)
    - Bizim ama alt hesabın atanmadığı bölüm -> 403 (var, ama yetkin yok)
    """
    dep = db.get(Department, department_id)
    if dep is None or dep.workgroup_id != user.workgroup_id:
        raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")
    if user.role != UserRole.ADMIN and dep.id not in _member_department_ids(user):
        raise HTTPException(status_code=403, detail="Bu bölümde yetkiniz yok")
    return dep


def _get_owned_course(db: Session, user: User, course_id: int) -> Course:
    """Ders bizim workgroup'ta mı? Değilse/yoksa 404 (varlık sızdırmama)."""
    course = (
        db.query(Course)
        .join(Department)
        .filter(Course.id == course_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if course is None:
        raise HTTPException(status_code=404, detail="Ders bulunamadı")
    return course


def _get_owned_section(db: Session, user: User, section_id: int) -> CourseSection:
    sec = (
        db.query(CourseSection)
        .join(Course).join(Department)
        .filter(CourseSection.id == section_id,
                Department.workgroup_id == user.workgroup_id)
        .first()
    )
    if sec is None:
        raise HTTPException(status_code=404, detail="Şube bulunamadı")
    return sec


def _validate_section_refs(db: Session, user: User, data: dict) -> None:
    """Şube gövdesindeki FK'lar bizim workgroup'un mu? (çapraz-FK izolasyonu)"""
    if data.get("lecturer_id") is not None:
        lec = db.get(Lecturer, data["lecturer_id"])
        if lec is None or lec.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz hoca seçimi")
    if data.get("default_classroom_id") is not None:
        cls = db.get(Classroom, data["default_classroom_id"])
        if cls is None or cls.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz derslik seçimi")


# ------------------------------------------------------------------
# Dersler (kod düzeyi)
# ------------------------------------------------------------------

@router.get("/courses", response_model=list[CourseOut])
def list_courses(
    department_id: int | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    search: str | None = Query(None, description="Kod veya ad içinde arar"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = (
        db.query(Course)
        .join(Department)
        .options(selectinload(Course.sections).selectinload(CourseSection.lecturer))
        .filter(Department.workgroup_id == user.workgroup_id)
    )
    # K-26: workgroup içindeki herkes TÜM bölümleri okur; yazma kısıtı ayrıdır
    # (bayrak + üyelik, yazma uçlarında). Filtrelemek isteyen department_id kullanır.
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if year is not None:
        q = q.filter(Course.year == year)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    if search:
        pattern = f"%{search}%"
        q = q.filter(Course.code.ilike(pattern) | Course.name.ilike(pattern))
    return q.order_by(Course.code).all()


@router.post("/courses", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: CourseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    _ensure_department_access(db, user, payload.department_id)

    clash = db.query(Course).filter(
        Course.department_id == payload.department_id,
        Course.year == payload.year,
        Course.semester == payload.semester,
        Course.code == payload.code,
    ).first()
    if clash:
        raise HTTPException(status_code=409,
                            detail="Bu bölüm+yıl+dönemde bu ders kodu zaten kayıtlı")

    course = Course(**payload.model_dump())
    db.add(course)
    db.flush()
    log_action(db, user, "CREATE", "course", course.id, course)
    db.commit()
    db.refresh(course)
    return course


@router.patch("/courses/{course_id}", response_model=CourseOut)
def update_course(
    course_id: int,
    payload: CourseUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    course = _get_owned_course(db, user, course_id)
    _ensure_department_access(db, user, course.department_id)

    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != course.code:
        clash = db.query(Course).filter(
            Course.department_id == course.department_id,
            Course.year == course.year,
            Course.semester == course.semester,
            Course.code == data["code"],
            Course.id != course.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409,
                                detail="Bu bölüm+yıl+dönemde bu ders kodu zaten kayıtlı")

    ozet = build_change_summary(course, data)
    for field, value in data.items():
        setattr(course, field, value)
    log_action(db, user, "UPDATE", "course", course.id, course, ozet)
    db.commit()
    db.refresh(course)
    return course


# ------------------------------------------------------------------
# Şubeler
# ------------------------------------------------------------------

@router.post("/courses/{course_id}/sections", response_model=SectionOut,
             status_code=status.HTTP_201_CREATED)
def create_section(
    course_id: int,
    payload: SectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    course = _get_owned_course(db, user, course_id)
    _ensure_department_access(db, user, course.department_id)

    data = payload.model_dump()
    _validate_section_refs(db, user, data)

    clash = db.query(CourseSection).filter(
        CourseSection.course_id == course.id,
        CourseSection.section_no == payload.section_no,
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail="Bu derste bu şube no zaten var")

    sec = CourseSection(course_id=course.id, **data)
    db.add(sec)
    db.flush()
    log_action(db, user, "CREATE", "course_section", sec.id, sec)
    db.commit()
    db.refresh(sec)
    return sec


@router.patch("/course-sections/{section_id}", response_model=SectionOut)
def update_section(
    section_id: int,
    payload: SectionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    sec = _get_owned_section(db, user, section_id)
    _ensure_department_access(db, user, sec.course.department_id)

    data = payload.model_dump(exclude_unset=True)
    _validate_section_refs(db, user, data)

    new_no = data.get("section_no", sec.section_no)
    if new_no != sec.section_no:
        clash = db.query(CourseSection).filter(
            CourseSection.course_id == sec.course_id,
            CourseSection.section_no == new_no,
            CourseSection.id != sec.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Bu derste bu şube no zaten var")

    ozet = build_change_summary(sec, data)
    for field, value in data.items():
        setattr(sec, field, value)
    log_action(db, user, "UPDATE", "course_section", sec.id, sec, ozet)
    db.commit()
    db.refresh(sec)
    return sec


@router.delete("/course-sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(
    section_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    sec = _get_owned_section(db, user, section_id)
    _ensure_department_access(db, user, sec.course.department_id)

    has_entries = db.query(WeeklyScheduleEntry).filter(
        WeeklyScheduleEntry.section_id == sec.id
    ).first()
    if has_entries:
        raise HTTPException(status_code=409,
                            detail="Şubenin haftalık program girişi var; önce girişleri silin")

    log_action(db, user, "DELETE", "course_section", sec.id, sec)
    db.delete(sec)
    db.commit()


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    """Yalnız hiç şubesi ve hiç sınavı olmayan dersi siler (K-32).

    courses'a bağlananlar: course_sections (CASCADE) ve exams (CASCADE).
    Sınav K-16 gereği DERS düzeyindedir, yani şubesiz bir dersin sınavı
    olabilir; iki koşul da aranmazsa sınav sessizce silinirdi.
    Kullanımdaki ders silinmez, PATCH {active:false} ile pasife alınır.
    """
    course = _get_owned_course(db, user, course_id)
    _ensure_department_access(db, user, course.department_id)

    section_count = db.query(CourseSection).filter(
        CourseSection.course_id == course.id
    ).count()
    exam_count = db.query(Exam).filter(Exam.course_id == course.id).count()

    if section_count or exam_count:
        parcalar = []
        if section_count:
            parcalar.append(f"{section_count} şube")
        if exam_count:
            parcalar.append(f"{exam_count} sınav")
        raise HTTPException(
            status_code=409,
            detail=f"Bu ders silinemez: {' ve '.join(parcalar)} bağlı. "
                   "Önce bunları kaldırın.",
        )

    log_action(db, user, "DELETE", "course", course.id, course)
    db.delete(course)
    db.commit()
