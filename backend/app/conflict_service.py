"""Cakisma motoru dikisi (K-22) — ORM <-> motor adaptoru.

Router'lar motoru YALNIZCA bu modul uzerinden cagirir. Motorun kendisi
(app/conflicts/, WP5, Stajyer C) saf Python'dur: DB bilmez, ORM bilmez,
duz dict listeleri alir. Bu dosya iki dunyayi birbirine baglar:

    ORM nesneleri --[_weekly_to_dict/_exam_to_dict]--> motor dict'leri
    motor sonuclari (kontrat §0 ConflictResult) --> router --> istemci

Tasarim kararlari:
  - **Evren:** her kontrol, adayi workgroup'un DRAFT + SUBMITTED TUM girislerine
    karsi test eder (kural seti). Taslak bir ders, baska bolumun kilitli dersiyle
    cakisabilir; submit edilecek kume kendi icinde de cakisabilir.
  - **Aday filtresi:** motor evrenin tamamini tarar, biz yalnizca adayi (veya
    submit kumesini) ilgilendiren sonuclari donduruyoruz. Aksi halde kullanici
    kendi kaydini yaparken baskasinin cakismasini gorurdu.
  - **W8 (tamlik, K-20):** yalniz submit ve tam taramada uretilir, save'de ASLA.
  - **X kurallari (K-06):** workgroup.check_exam_vs_course bayragina baglidir;
    bayrak DB'den okunup motora parametre olarak gecirilir.
"""

from sqlalchemy.orm import Session, selectinload

from app.conflicts.orchestrator import (
    scan_completeness, scan_cross, scan_exams, scan_weekly,
)
from app.models import (
    Classroom, Course, CourseSection, Department, Exam, Workgroup,
    WeeklyScheduleEntry,
)


# ==================================================================
# Adaptorler: ORM nesnesi -> motorun bekledigi duz dict
# ==================================================================

def _weekly_to_dict(e: WeeklyScheduleEntry) -> dict:
    """Haftalik giris -> motor dict'i.

    Enum alanlar .value ile string'e cevrilir: motor saf Python'dur, SQLAlchemy
    enum tiplerini tanimaz ve karsilastirmalari string uzerinden yapar
    (or. delivery_mode == "ONLINE_ASYNC").
    """
    s = e.section
    c = s.course
    return {
        "id": e.id,
        "type": "weekly_entry",
        "section_id": e.section_id,
        "course_id": c.id,
        "classroom_id": e.classroom_id,
        "day_of_week": e.day_of_week,
        "start_slot": e.start_slot,
        "slot_count": e.slot_count,
        "lecturer_id": s.lecturer_id,
        "department_id": c.department_id,
        "department_name": c.department.name,      # mesajlarda ad (id degil)
        "year": c.year,
        "semester": c.semester.value,
        "is_elective": c.is_elective,
        "expected_students": s.expected_students,
        # K-23: online giriste derslik yoktur -> kapasite karsilastirmasi da yok
        "capacity": e.classroom.capacity if e.classroom else None,
        "course_code": c.code,
        "section_no": s.section_no,
        "session_type": e.session_type.value,
        "delivery_mode": e.delivery_mode.value,
        # W8 tamlik icin dersin T+U+L hedefleri
        "hours_theory": c.hours_theory,
        "hours_practice": c.hours_practice,
        "hours_lab": c.hours_lab,
    }


def _exam_to_dict(x: Exam) -> dict:
    """Sinav -> motor dict'i.

    `section_no` BILEREK YOKTUR: sinav ders duzeyindedir (K-16), subesi olmaz.
    `expected_students` turetilir (aktif subelerin toplami) ve `rooms`
    kontenjan icin capacity DEGIL exam_capacity tasir (K-17/K-21).
    """
    c = x.course
    return {
        "id": x.id,
        "type": "exam",
        "course_id": x.course_id,
        "exam_type": x.exam_type.value,
        "exam_date": x.exam_date,
        "start_time": x.start_time,
        "duration_minutes": x.duration_minutes,
        "lecturer_id": x.lecturer_id,
        "department_id": c.department_id,
        "department_name": c.department.name,
        "year": c.year,
        "semester": c.semester.value,
        "is_elective": c.is_elective,
        "expected_students": x.total_expected_students,   # property (K-16)
        "rooms": [
            {"classroom_id": r.id, "exam_capacity": r.exam_capacity}
            for r in x.classrooms
        ],
        "course_code": c.code,
    }


# ==================================================================
# Evren sorgulari: workgroup izolasyonu + eager yukleme
# ==================================================================

def _weekly_universe(db: Session, workgroup_id: int) -> list[dict]:
    """Workgroup'un TUM haftalik girisleri (DRAFT + SUBMITTED).

    Durum filtresi YOK: kural seti her iki anda da taslak+kilitli tumune
    bakilmasini sart kosar. Eager yukleme N+1'i onler — adaptor her giris icin
    section/course/department/classroom'a dokunuyor.
    """
    entries = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .filter(Department.workgroup_id == workgroup_id)
        .options(
            selectinload(WeeklyScheduleEntry.section)
            .selectinload(CourseSection.course)
            .selectinload(Course.department),
            selectinload(WeeklyScheduleEntry.classroom),
        )
        .all()
    )
    return [_weekly_to_dict(e) for e in entries]


def _exam_universe(db: Session, workgroup_id: int) -> list[dict]:
    """Workgroup'un TUM sinavlari (DRAFT + SUBMITTED)."""
    exams = (
        db.query(Exam)
        .join(Course).join(Department)
        .filter(Department.workgroup_id == workgroup_id)
        .options(
            selectinload(Exam.course).selectinload(Course.department),
            selectinload(Exam.course).selectinload(Course.sections),
            selectinload(Exam.classrooms),
        )
        .all()
    )
    return [_exam_to_dict(x) for x in exams]


def _cross_flag(db: Session, workgroup_id: int) -> bool:
    """K-06: X kurallari bu bayrakla acilir/kapanir (vize donemleri icin acik)."""
    wg = db.get(Workgroup, workgroup_id)
    return bool(wg and wg.check_exam_vs_course)


def _involves(result: dict, wanted: set[tuple[str, int]]) -> bool:
    """Sonuc, ilgilendigimiz nesnelerden (tip, id) en az birini iceriyor mu?"""
    return any(
        (ref["type"], ref["id"]) in wanted for ref in result["affected"]
    )


# ==================================================================
# Workgroup cozumleyiciler (ORM nesnesinden workgroup'a ulasma)
# ==================================================================

def _wg_of_entry(entry: WeeklyScheduleEntry) -> int:
    return entry.section.course.department.workgroup_id


def _wg_of_exam(exam: Exam) -> int:
    return exam.course.department.workgroup_id


# ==================================================================
# Seam: haftalik program
# ==================================================================

def check_weekly_save(db: Session, entry: WeeklyScheduleEntry) -> list[dict]:
    """Tek haftalik girisin kayit ani kontrolu.

    Sonuc BILGILENDIRIR, kaydi ENGELLEMEZ (K-03) — engelleme karari router'da.
    W8 tamlik kurali burada URETILMEZ (K-20): yerlestirme surerken "hala eksik"
    uyarisi yagdirmamak icin yalniz submit'te calisir.
    """
    wg = _wg_of_entry(entry)
    weeklies = _weekly_universe(db, wg)
    exams = _exam_universe(db, wg)

    results = scan_weekly(weeklies)
    results += scan_cross(exams, weeklies, _cross_flag(db, wg))

    return [r for r in results if _involves(r, {("weekly_entry", entry.id)})]


def check_weekly_submit(
    db: Session, entries: list[WeeklyScheduleEntry]
) -> list[dict]:
    """Submit kumesinin kontrolu (kume ici + mevcut girislere karsi).

    HARD iceren sonuc router tarafindan 409 ile reddedilir (hep-veya-hic).
    W8 tamlik WARNING'i YALNIZ burada uretilir (K-20) ve yalnizca submit
    edilen girislerin SUBELERI icin hesaplanir — sube bazinda tamlik, o subenin
    workgroup'taki tum oturumlarina bakar (yalniz submit kumesine degil).
    """
    if not entries:
        return []
    wg = _wg_of_entry(entries[0])
    weeklies = _weekly_universe(db, wg)
    exams = _exam_universe(db, wg)

    results = scan_weekly(weeklies)
    results += scan_cross(exams, weeklies, _cross_flag(db, wg))

    # W8: yalniz submit edilen girislerin subelerinin oturumlari degerlendirilir
    submitted_sections = {e.section_id for e in entries}
    section_entries = [
        w for w in weeklies if w["section_id"] in submitted_sections
    ]
    results += scan_completeness(section_entries)

    wanted = {("weekly_entry", e.id) for e in entries}
    return [r for r in results if _involves(r, wanted)]


# ==================================================================
# Seam: sinavlar
# ==================================================================

def check_exams_save(db: Session, exam: Exam) -> list[dict]:
    """Tek sinavin kayit ani kontrolu. Engellemez, bilgilendirir (K-03)."""
    wg = _wg_of_exam(exam)
    exams = _exam_universe(db, wg)
    weeklies = _weekly_universe(db, wg)

    results = scan_exams(exams)
    results += scan_cross(exams, weeklies, _cross_flag(db, wg))

    return [r for r in results if _involves(r, {("exam", exam.id)})]


def check_exams_submit(db: Session, exams_to_submit: list[Exam]) -> list[dict]:
    """Submit kumesinin kontrolu. HARD -> router 409 (hep-veya-hic)."""
    if not exams_to_submit:
        return []
    wg = _wg_of_exam(exams_to_submit[0])
    exams = _exam_universe(db, wg)
    weeklies = _weekly_universe(db, wg)

    results = scan_exams(exams)
    results += scan_cross(exams, weeklies, _cross_flag(db, wg))

    wanted = {("exam", x.id) for x in exams_to_submit}
    return [r for r in results if _involves(r, wanted)]


# ==================================================================
# Seam: tam tarama (kontrat §9 + §10 sayaclari)
# ==================================================================

def scan_workgroup(db: Session, workgroup_id: int) -> dict[str, list[dict]]:
    """Workgroup'un TAMAMINI tarar; aday filtresi YOK, her sey raporlanir.

    Tek cagri iki tuketiciyi besler: dashboard ozeti yalnizca len() alir,
    GET /conflicts ayni listeleri oldugu gibi doner. Ikisi ayri ayri tarasaydi
    ayni anda farkli sayi gosterebilirlerdi.

    W8 BURADA DA uretilir (K-39): save'deki susma gerekcesi "yerlestirme
    surerken rahatsiz etme"ydi; tam tarama ise kullanicinin bilerek "bana tum
    sorunlari goster" dedigi yerdir, eksik ders saati de bir sorundur.
    """
    weeklies = _weekly_universe(db, workgroup_id)
    exams = _exam_universe(db, workgroup_id)

    results = scan_weekly(weeklies)
    results += scan_exams(exams)
    results += scan_cross(exams, weeklies, _cross_flag(db, workgroup_id))
    results += scan_completeness(weeklies)

    return {
        "hard": [r for r in results if r["severity"] == "HARD"],
        "warnings": [r for r in results if r["severity"] == "WARNING"],
    }
