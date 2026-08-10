"""Sinav endpoint'leri (WP4) — kontrat §8, save/submit deseni (K-03).

Sinav DERS duzeyindedir (K-16, subeden bagimsiz) ve birden cok derslige
yayilabilir (K-17, exam_classrooms). Cakisma kontrolu conflict_service
dikisi uzerinden yapilir (K-22); motor WP5'te C tarafindan takilir.
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload

from app.audit import build_change_summary, log_action
from app.conflict_service import check_exams_save, check_exams_submit
from app.deps import get_db, get_current_user, require_exam_manager
from app.cohort import cohort_course_filter
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
    """Sınav bizim workgroup'ta ve YAYINDA mı? Değilse/yoksa 404.

    K-60: `draft_id IS NULL` şartı zorunlu. Olmasaydı bu eski uçlar BAŞKASININ
    ÖZEL taslak kopyasını bulur ve düzenleyebilirdi — taslağın gizliliği yalnız
    okuma yollarında değil yazma yollarında da korunmalı. (Tarayıcıda ortaya
    çıktı: taslak satırının id'siyle gelen PATCH satırı buluyor, sonra yayın
    süzgeçli yeniden okuma boş dönüp 500 üretiyordu.)

    Bu uçlar adım 7'de tamamen kalkacak; o güne kadar da delik açık kalmamalı.
    """
    exam = (
        db.query(Exam)
        .join(Course).join(Department)
        .filter(Exam.id == exam_id,
                Exam.draft_id.is_(None),
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


def _ensure_draft(exam: Exam) -> None:
    if exam.status != EntryStatus.DRAFT:
        raise HTTPException(status_code=409,
                            detail="Sınav SUBMITTED durumda — önce draft'a çevrilmeli")


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


# ------------------------------------------------------------------
# Kayıt (save) — asla engellemez, conflicts bilgilendirir (K-03)
# ------------------------------------------------------------------

@router.post("/exams", response_model=ExamSaveResponse,
             status_code=status.HTTP_201_CREATED)
def create_exam(
    payload: ExamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_exam_manager),
):
    course = _get_owned_course(db, user, payload.course_id)
    _ensure_department_access(db, user, course.department_id)

    data = payload.model_dump()
    _validate_exam_refs(db, user, data)
    _ensure_weekday(payload.exam_date)

    # K-46: sırayı kurallara göre sabitle (final/büt→1, vize 1..midterm_count).
    data["exam_index"] = _normalize_exam_index(payload.exam_type, payload.exam_index, course)

    # E2 ön-kontrolü: aynı (ders, tip, SIRA) ikinci sınav (DB UNIQUE yedekte).
    # Farklı numaralı vizeler (1./2./3.) çakışmaz — çoklu vize bu sayede olur.
    clash = db.query(Exam).filter(
        Exam.course_id == course.id,
        Exam.exam_type == payload.exam_type,
        Exam.exam_index == data["exam_index"],
    ).first()
    if clash:
        raise HTTPException(status_code=409,
                            detail=_e2_message(payload.exam_type, data["exam_index"]))

    classroom_ids = data.pop("classroom_ids")
    exam = Exam(created_by=user.id, **data)
    exam.classrooms = _load_classrooms(db, classroom_ids)
    db.add(exam)
    db.flush()
    log_action(db, user, "CREATE", "exam", exam.id, exam)
    db.commit()

    exam = _eager_exam_query(db).filter(Exam.id == exam.id).first()
    conflicts = check_exams_save(db, exam)
    return {"exam": exam, "conflicts": conflicts}


@router.patch("/exams/{exam_id}", response_model=ExamSaveResponse)
def update_exam(
    exam_id: int,
    payload: ExamUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_exam_manager),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    _ensure_draft(exam)  # yalnız DRAFT düzenlenir (K-22)

    data = payload.model_dump(exclude_unset=True)
    _validate_exam_refs(db, user, data)
    if "exam_date" in data:
        _ensure_weekday(data["exam_date"])

    new_type = data.get("exam_type", exam.exam_type)
    new_index = _normalize_exam_index(
        new_type, data.get("exam_index", exam.exam_index), exam.course)
    # Sıra değiştiyse (ör. final'e çevrilince 1'e sabitlendi) data'ya yaz ki
    # aşağıdaki setattr döngüsü kalıcı kılsın.
    if new_index != exam.exam_index:
        data["exam_index"] = new_index
    if (new_type, new_index) != (exam.exam_type, exam.exam_index):
        clash = db.query(Exam).filter(
            Exam.course_id == exam.course_id,
            Exam.exam_type == new_type,
            Exam.exam_index == new_index,
            Exam.id != exam.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail=_e2_message(new_type, new_index))

    classroom_ids = data.pop("classroom_ids", None)
    if classroom_ids is not None:  # verilirse liste TAM değişir (K-22)
        exam.classrooms = _load_classrooms(db, classroom_ids)
    ozet = build_change_summary(exam, data)
    for field, value in data.items():
        setattr(exam, field, value)
    log_action(db, user, "UPDATE", "exam", exam.id, exam, ozet)
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
    user: User = Depends(require_exam_manager),
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
        log_action(db, user, "SUBMIT", "exam", exam.id, exam)
    db.commit()
    return {"submitted": [e.id for e in exams], "warnings": warnings}


@router.post("/exams/{exam_id}/revert-to-draft", response_model=ExamOut)
def revert_exam_to_draft(
    exam_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_exam_manager),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    if exam.status != EntryStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="Sınav zaten taslak durumda")

    exam.status = EntryStatus.DRAFT
    exam.submitted_at = None
    # Değişiklik sabit ve bilinen: SUBMITTED → DRAFT. Burada `data` sözlüğü
    # yok, o yüzden özet elle veriliyor (K-38).
    log_action(db, user, "UPDATE", "exam", exam.id, exam,
               "Durum: Yayınlandı → Taslak")
    db.commit()
    return _eager_exam_query(db).filter(Exam.id == exam.id).first()


@router.delete("/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_exam_manager),
):
    exam = _get_owned_exam(db, user, exam_id)
    _ensure_department_access(db, user, exam.course.department_id)
    _ensure_draft(exam)  # SUBMITTED silinemez; önce draft'a çevrilir

    log_action(db, user, "DELETE", "exam", exam.id, exam)
    db.delete(exam)  # exam_classrooms satırları CASCADE ile gider
    db.commit()
