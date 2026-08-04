from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, get_current_user, require_course_manager
from app.models import (
    Classroom, Course, CourseCohort, CourseSection, Department, DepartmentMembership,
    EntryStatus, Exam, ExamType, Lecturer, SemesterType, User, UserRole,
    WeeklyScheduleEntry,
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


def _course_cohort_department_ids(course: Course) -> set[int]:
    """Dersin efektif cohort kümesindeki TÜM bölümler: birincil + ek (K-48/K-49).

    Normal derste ek cohort olmadığından küme tek elemanlıdır (yalnız birincil).
    """
    return {course.department_id} | {cc.department_id for cc in course.extra_cohorts}


def _ensure_course_access(db: Session, user: User, course: Course) -> None:
    """Dersi düzenleme + şube yönetimi yetkisi — ortak derste PAYLAŞIMLI (K-49).

    ADMIN muaf. Alt hesap için: dersi ALAN herhangi bir bölümün (birincil ∪ ek
    cohort) üyesiyse yeter. Ortak (servis) dersin bakımını onu alan tüm bölümler
    paylaşır; "sahibi tek bölüm düzenler" kısıtı (eski K-48) kaldırıldı.

    Normal derste efektif küme tek elemanlı olduğundan eski davranış (yalnız
    birincil bölümün üyeliği) birebir korunur. Bölümler zaten `_get_owned_course`
    ile workgroup'a bağlı; küme kesişimi yalnız kendi workgroup'undaki üyelikleri
    değerlendirir (izolasyon K-04 bozulmaz).
    """
    if user.role == UserRole.ADMIN:
        return
    if not (_course_cohort_department_ids(course) & _member_department_ids(user)):
        raise HTTPException(status_code=403, detail="Bu derste yetkiniz yok")


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


def _find_common_course(db: Session, workgroup_id: int, code: str) -> Course | None:
    """Bu workgroup'ta aynı KODLU mevcut ortak dersi bul (K-48 birleştirme anahtarı).

    Kod eşleşmesi büyük/küçük harf DUYARSIZ + kırpılmış: "ceng2001" ile "CENG2001"
    aynı ortak ders sayılır. Yalnız is_common kayıtlar aday — normal ders ortak
    dersle birleşmez. Hem create_course hem Bologna import BU tek kaynağı kullanır
    (import ayrı, birleştirmesiz bir yol izlerse K-54'teki çift kayıt geri döner).
    """
    return (
        db.query(Course).join(Department)
        .filter(Department.workgroup_id == workgroup_id,
                func.lower(func.trim(Course.code)) == code.strip().lower(),
                Course.is_common.is_(True))
        .first()
    )


def _covered_cohorts(course: Course) -> set[tuple[int, int, SemesterType]]:
    """Ortak dersin efektif cohort kümesi: birincil ∪ ek (bölüm, yıl, dönem)."""
    covered = {(course.department_id, course.year, course.semester)}
    covered |= {(cc.department_id, cc.year, cc.semester) for cc in course.extra_cohorts}
    return covered


def cohort_course_filter(department_id: int, year: int | None, semester: SemesterType | None):
    """K-57: cohort üyeliği filtresi = BİRİNCİL ∪ EK cohort.

    Bir cohort görünümünde (Dersler / Haftalık / Sınav — bölüm+yıl+dönem seçili)
    year/semester eşleşmesi hem birincile HEM ek cohort'a uygulanır. Böylece ortak
    (servis) ders, onu TÜKETEN bölümün cohort'undan da gelir — yalnız ilk atandığı
    (birincil) bölümden değil. Eski filtre `Course.department_id == X` idi ve ek
    cohort'la tüketilen ortak dersleri (ENG/MATH/PHYS...) kohortun listesinden
    düşürüyordu (kullanıcı: "8 ders olması gerekirken 2 çıkıyor").

    Course entity'si sorguya JOIN'li olmalı; `extra_cohorts.any(...)` korele EXISTS
    üretir (join'den bağımsız çalışır).
    """
    primary = [Course.department_id == department_id]
    extra = [CourseCohort.department_id == department_id]
    if year is not None:
        primary.append(Course.year == year)
        extra.append(CourseCohort.year == year)
    if semester is not None:
        primary.append(Course.semester == semester)
        extra.append(CourseCohort.semester == semester)
    return or_(and_(*primary), Course.extra_cohorts.any(and_(*extra)))


def _build_extra_cohorts(
    db: Session, user: User, course: Course, cohorts_in: list
) -> list[CourseCohort]:
    """Ortak dersin EK cohort listesini doğrular ve CourseCohort nesneleri üretir (K-48).

    Doğrulamalar:
    - Bölüm bizim workgroup'ta mı (izolasyon). Üyelik ARANMAZ: tüketen bölüm
      yalnız çakışma için cohort sağlar, yazma hakkı vermez — sahibi bölümün
      yetkisi zaten üstte denetlendi.
    - Ek cohort, dersin BİRİNCİL cohort'uyla aynı olamaz (zaten kapsanıyor).
    - Liste içinde tekrar olamaz.
    """
    primary = (course.department_id, course.year, course.semester)
    seen: set[tuple[int, int, SemesterType]] = set()
    result: list[CourseCohort] = []
    for c in cohorts_in:
        dep = db.get(Department, c.department_id)
        if dep is None or dep.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz cohort bölümü")
        key = (c.department_id, c.year, c.semester)
        if key == primary:
            raise HTTPException(
                status_code=400,
                detail="Dersin kendi cohort'u ek olarak eklenemez (zaten kapsanıyor)")
        if key in seen:
            raise HTTPException(status_code=400, detail="Aynı cohort iki kez verildi")
        seen.add(key)
        result.append(CourseCohort(
            department_id=c.department_id, year=c.year, semester=c.semester))
    return result


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
        .options(
            selectinload(Course.sections).selectinload(CourseSection.lecturer),
            # K-48: ortak dersin ek cohort'ları + bölüm adı (N+1 önle)
            selectinload(Course.extra_cohorts).selectinload(CourseCohort.department),
        )
        .filter(Department.workgroup_id == user.workgroup_id)
    )
    # K-26: workgroup içindeki herkes TÜM bölümleri okur; yazma kısıtı ayrıdır
    # (bayrak + üyelik, yazma uçlarında). Filtrelemek isteyen department_id kullanır.
    if department_id is not None:
        # K-48/K-57: bölümün KENDİ dersleri + o bölümü EK cohort olarak alan ortak
        # dersler. year/semester verildiyse cohort eşleşmesine (birincil VEYA ek)
        # uygulanır — tüketilen ortak ders kendi biriminin değil, TÜKETEN cohort'un
        # yıl/döneminden gelsin diye.
        q = q.filter(cohort_course_filter(department_id, year, semester))
    else:
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

    # K-48: ortak ders BİRLEŞTİRME. Aynı workgroup'ta aynı KODLU bir ortak ders
    # zaten varsa, yeni bir kayıt açmak yerine gönderilen (bölüm, sınıf, dönem)
    # o dersin EK cohort'u olarak eklenir — böylece "aynı ders iki kez" oluşmaz,
    # tek ders altında toplanır. Tüketen bölümde üyelik aranmaz (sahibinin değil,
    # yeni cohort'un bölümüne erişim yukarıda denetlendi; K-48 tüketim prensibi).
    if payload.is_common:
        existing = _find_common_course(db, user.workgroup_id, payload.code)
        if existing:
            new_key = (payload.department_id, payload.year, payload.semester)
            if new_key in _covered_cohorts(existing):
                raise HTTPException(
                    status_code=409,
                    detail=f"'{existing.code}' ortak dersi zaten bu bölüm/sınıf/dönemde kayıtlı")
            existing.extra_cohorts.append(CourseCohort(
                department_id=payload.department_id, year=payload.year,
                semester=payload.semester))
            db.flush()
            log_action(db, user, "UPDATE", "course", existing.id, existing,
                       "Ortak ders: yeni cohort eklendi")
            db.commit()
            db.refresh(existing)
            return existing

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
    # K-45: saati 0 olan bileşenin online bayrağı anlamsız — zorla false.
    for comp in ("theory", "practice", "lab"):
        if getattr(course, f"hours_{comp}") == 0:
            setattr(course, f"{comp}_online", False)
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
    _ensure_course_access(db, user, course)   # K-49: dersi alan her bölüm düzenler

    data = payload.model_dump(exclude_unset=True)
    # K-48: ek cohort listesi generic setattr döngüsüne GİRMEZ (ilişki alanı);
    # ayrıca ele alınır. model_dump dict'e düzleştirdiği için orijinal pydantic
    # nesnelerini (payload.cohorts) kullanırız. Önce doğrula ki kısmi mutasyon olmasın.
    cohorts_set = "cohorts" in data
    data.pop("cohorts", None)
    cohorts_in = payload.cohorts if cohorts_set else None
    eff_is_common = data.get("is_common", course.is_common)
    new_cohorts: list[CourseCohort] | None = None
    if cohorts_in is not None:
        if not eff_is_common:
            if cohorts_in:
                raise HTTPException(
                    status_code=400,
                    detail="Ortak olmayan derse ek cohort eklenemez — önce dersi ortak işaretleyin")
            new_cohorts = []
        else:
            new_cohorts = _build_extra_cohorts(db, user, course, cohorts_in)

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

    # K-45: bir bileşenin saati (bu PATCH sonrası) 0 ise online bayrağı zorla
    # false. data'ya yazılır ki hem özete hem kayda düzeltilmiş değer girsin.
    for comp in ("theory", "practice", "lab"):
        eff_hours = data.get(f"hours_{comp}", getattr(course, f"hours_{comp}"))
        if eff_hours == 0:
            data[f"{comp}_online"] = False

    # K-46: vize sayısı, halihazırda kayıtlı vizelerin altına çekilemez —
    # yoksa yüksek sıralı vize "kapsam dışı" kalır (aynı deseni K-27/K-32'de
    # olduğu gibi engelliyoruz). Önce ilgili vizeler silinsin.
    if "midterm_count" in data and data["midterm_count"] < course.midterm_count:
        over = db.query(Exam).filter(
            Exam.course_id == course.id,
            Exam.exam_type == ExamType.MIDTERM,
            Exam.exam_index > data["midterm_count"],
        ).count()
        if over:
            raise HTTPException(
                status_code=409,
                detail=f"{data['midterm_count']}'in üstünde sıralı {over} vize kayıtlı — "
                       f"önce onları silin",
            )

    # Programa ETKİ EDEN alan (online bayrakları / T+U+L saatleri) değiştiyse bu
    # dersin TASLAK yerleşimlerini sıfırla (sil): eski derslik/teslim/oturum
    # bilgisi sessizce bayat kalmasın — ör. yüz yüzeden online'a çevrilen bir
    # bileşenin haftalık girişi derslikli görünmeye devam ediyordu. Ders palete
    # geri döner, kullanıcı yeniden yerleştirir. Yayınlanmış (kilitli) yerleşim
    # varsa DÜZENLEMEYİ reddet — K-03 yayın kilidine saygılı, önce taslağa çevrilsin.
    SCHEDULING_FIELDS = (
        "theory_online", "practice_online", "lab_online",
        "hours_theory", "hours_practice", "hours_lab",
    )
    schedule_changed = any(
        f in data and data[f] != getattr(course, f) for f in SCHEDULING_FIELDS
    )
    if schedule_changed:
        section_ids = [
            sid for (sid,) in db.query(CourseSection.id).filter(
                CourseSection.course_id == course.id
            )
        ]
        submitted_weekly = (
            db.query(WeeklyScheduleEntry).filter(
                WeeklyScheduleEntry.section_id.in_(section_ids),
                WeeklyScheduleEntry.status == EntryStatus.SUBMITTED,
            ).count() if section_ids else 0
        )
        submitted_exam = db.query(Exam).filter(
            Exam.course_id == course.id,
            Exam.status == EntryStatus.SUBMITTED,
        ).count()
        if submitted_weekly or submitted_exam:
            parcalar = []
            if submitted_weekly:
                parcalar.append(f"{submitted_weekly} haftalık giriş")
            if submitted_exam:
                parcalar.append(f"{submitted_exam} sınav")
            raise HTTPException(
                status_code=409,
                detail=f"Bu dersin yayınlanmış {' ve '.join(parcalar)} var — programa "
                       "etki eden alanı (online/saat) değiştirmeden önce onları taslağa çevirin.",
            )
        draft_weekly = (
            db.query(WeeklyScheduleEntry).filter(
                WeeklyScheduleEntry.section_id.in_(section_ids),
                WeeklyScheduleEntry.status == EntryStatus.DRAFT,
            ).all() if section_ids else []
        )
        draft_exams = db.query(Exam).filter(
            Exam.course_id == course.id,
            Exam.status == EntryStatus.DRAFT,
        ).all()
        for we in draft_weekly:
            log_action(db, user, "DELETE", "weekly_entry", we.id, we)
            db.delete(we)
        for ex in draft_exams:
            log_action(db, user, "DELETE", "exam", ex.id, ex)
            db.delete(ex)

    ozet = build_change_summary(course, data)
    for field, value in data.items():
        setattr(course, field, value)
    # K-48: is_common uygulandıktan SONRA ek cohort'ları senkronla. Ortak
    # değilse ek cohort tutulmaz; ortak + yeni liste verildiyse KİMLİĞE GÖRE
    # uzlaştırılır (koru/çıkar/ekle). Blindly "= new_cohorts" YAPMA: korunan bir
    # cohort (aynı bölüm+yıl+dönem) silinmeden yeniden eklenirse uq_course_cohorts
    # UNIQUE ihlali (500) verir — retained satır yeniden INSERT edilmemeli.
    if not course.is_common:
        for cc in list(course.extra_cohorts):
            course.extra_cohorts.remove(cc)
    elif new_cohorts is not None:
        wanted = {(c.department_id, c.year, c.semester) for c in new_cohorts}
        for cc in list(course.extra_cohorts):
            if (cc.department_id, cc.year, cc.semester) not in wanted:
                course.extra_cohorts.remove(cc)          # istenmeyen → sil
        have = {(cc.department_id, cc.year, cc.semester) for cc in course.extra_cohorts}
        for c in new_cohorts:
            if (c.department_id, c.year, c.semester) not in have:
                course.extra_cohorts.append(c)           # yalnız gerçekten yeni olan
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
    _ensure_course_access(db, user, course)   # K-49: ortak derste şube yönetimi paylaşımlı

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
    _ensure_course_access(db, user, sec.course)   # K-49

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
    _ensure_course_access(db, user, sec.course)   # K-49

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
    # K-49: dersi ALAN her bölümün yetkilisi silebilir (düzenleme ile aynı kapsam).
    # Silme zaten yalnız BOŞ derste çalışır (şube/sınav yoksa) — yıkım sınırlı.
    _ensure_course_access(db, user, course)

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
