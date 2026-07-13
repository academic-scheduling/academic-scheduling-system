"""WP0 smoke testleri (v0.3 semasi, K-14..K-20 dahil).

Amac: modellerin ve migration'in DOGRULUGUNU tekrar calistirilabilir sekilde
kanitlamak. Sadece "kisit var mi" degil, "kisit gercekten ateslenip hatali
veriyi reddediyor mu" test edilir.

Izolasyon: her test tek bir transaction icinde calisir ve sonunda ROLLBACK
edilir. Yani testler senin dev veritabanina (scheduling) baglanir ama HICBIR
veri kalici olmaz; veritabanini kirletmez.

Calistirma (backend/ icinde, venv aktif):
    pytest -v
"""

import uuid
from datetime import date, time

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models import (
    Building,
    Classroom,
    Course,
    CourseSection,
    Department,
    EntryStatus,
    Exam,
    ExamType,
    Lecturer,
    SemesterType,
    Slot,
    User,
    UserRole,
    WeeklyScheduleEntry,
    Workgroup,
)

engine = create_engine(settings.database_url)


@pytest.fixture()
def session():
    """Her testi bir transaction'a sarar, sonunda geri alir (rollback)."""
    conn = engine.connect()
    trans = conn.begin()
    Session = sessionmaker(bind=conn)
    s = Session()
    try:
        yield s
    finally:
        s.close()
        trans.rollback()
        conn.close()


def _u(prefix: str) -> str:
    """Testler arasi cakismayi onlemek icin benzersiz kisa metin."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def make_base(s):
    """Workgroup + department + lecturer + building + classroom olustur, flush et."""
    wg = Workgroup(name=_u("WG"), allowed_email_domain="muh.example.edu.tr")
    s.add(wg)
    s.flush()  # wg.id'yi almak icin (henuz commit degil)
    dep = Department(workgroup_id=wg.id, name="Bilgisayar Muh.", code=_u("BM"))
    lec = Lecturer(
        workgroup_id=wg.id, full_name="Dr. Ayse Kaya", normalized_name=_u("ayse")
    )
    bld = Building(workgroup_id=wg.id, name=_u("Muhendislik"))
    s.add_all([dep, lec, bld])
    s.flush()
    cls = Classroom(
        workgroup_id=wg.id, building_id=bld.id, room_code=_u("101"),
        capacity=40, exam_capacity=20,  # [K-17] bosluklu oturma
    )
    s.add(cls)
    s.flush()
    return wg, dep, lec, bld, cls


def make_course(s, dep, code="CE101", **kw):
    """Gecerli bir ders (kod duzeyi, K-14) olustur ve flush et."""
    c = Course(
        department_id=dep.id,
        year=1,
        semester=SemesterType.FALL,
        code=code,
        name="Programlama",
        hours_theory=kw.pop("hours_theory", 3),
        hours_practice=kw.pop("hours_practice", 0),
        hours_lab=kw.pop("hours_lab", 0),
        **kw,
    )
    s.add(c)
    s.flush()
    return c


def make_section(s, course, lec, section_no=1, **kw):
    """Gecerli bir sube (K-14) olustur ve flush et."""
    sec = CourseSection(
        course_id=course.id,
        section_no=section_no,
        lecturer_id=lec.id,
        expected_students=kw.pop("expected_students", 30),
        **kw,
    )
    s.add(sec)
    s.flush()
    return sec


# ------------------------------------------------------------------
# 1) Seed verisi
# ------------------------------------------------------------------
def test_slots_seeded(session):
    """slots referans tablosunda tam 9 satir olmali."""
    n = session.scalar(select(func.count()).select_from(Slot))
    assert n == 9


# ------------------------------------------------------------------
# 2) Iliski gezinme (relationship) dogru mu?
# ------------------------------------------------------------------
def test_relationship_navigation(session):
    wg, dep, lec, bld, cls = make_base(session)
    user = User(
        workgroup_id=wg.id, name="Admin", email=_u("a") + "@muh.edu",
        role=UserRole.ADMIN,
    )
    session.add(user)
    session.flush()
    wg.created_by = user.id  # dairesel FK (elle duzelttigimiz)
    course = make_course(session, dep)
    sec = make_section(session, course, lec, default_classroom_id=cls.id)

    assert sec.lecturer.id == lec.id                # sube -> hoca
    assert sec.course.id == course.id               # sube -> ders
    assert course.department.id == dep.id           # ders -> bolum
    assert sec in course.sections                   # ders -> subeleri (K-14)
    assert sec in lec.sections                      # hoca -> subeleri (ters yon)
    assert cls.building.id == bld.id                # derslik -> bina (K-18)
    assert cls in bld.classrooms                    # bina -> derslikleri
    assert user in wg.users                         # grup -> kullanicilari
    assert wg.creator.id == user.id                 # dairesel FK gezinmesi
    assert sec.default_classroom.id == cls.id       # sube -> varsayilan derslik


# ------------------------------------------------------------------
# 3) CHECK kisitlari gercekten hatali veriyi reddediyor mu?
# ------------------------------------------------------------------
def test_expected_students_must_be_positive(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE102")
    bad = CourseSection(
        course_id=course.id, section_no=1, lecturer_id=lec.id,
        expected_students=0,  # CHECK: > 0
    )
    session.add(bad)
    with pytest.raises(IntegrityError):
        session.flush()


def test_exam_capacity_cannot_exceed_capacity(session):
    """[K-17] exam_capacity > capacity reddedilmeli (bosluklu oturma <= normal)."""
    wg, _, _, bld, _ = make_base(session)
    bad = Classroom(
        workgroup_id=wg.id, building_id=bld.id, room_code=_u("102"),
        capacity=40, exam_capacity=41,
    )
    session.add(bad)
    with pytest.raises(IntegrityError):
        session.flush()


def test_exam_must_be_weekday(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE103")
    saturday = date(2026, 9, 12)
    assert saturday.isoweekday() == 6  # test kendini dogruluyor: bu bir Cumartesi
    exam = Exam(
        course_id=course.id, exam_type=ExamType.FINAL, exam_date=saturday,
        start_time=time(10, 0), duration_minutes=90, lecturer_id=lec.id,
    )
    session.add(exam)
    with pytest.raises(IntegrityError):  # K-06: hafta sonu yasak (ISODOW)
        session.flush()


def test_exam_on_weekday_is_allowed(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE105")
    monday = date(2026, 9, 14)
    assert monday.isoweekday() == 1
    exam = Exam(
        course_id=course.id, exam_type=ExamType.FINAL, exam_date=monday,
        start_time=time(10, 0), duration_minutes=90, lecturer_id=lec.id,
    )
    session.add(exam)
    session.flush()  # hafta ici -> sorunsuz gecmeli
    assert exam.id is not None


def test_slot_overflow_rejected(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE104")
    sec = make_section(session, course, lec)
    # 8. slotta baslayip 3 slot: 8 + 3 - 1 = 10 > 9  -> reddedilmeli
    wse = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=1, start_slot=8, slot_count=3
    )
    session.add(wse)
    with pytest.raises(IntegrityError):
        session.flush()


def test_submitted_requires_timestamp(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE106")
    sec = make_section(session, course, lec)
    # SUBMITTED ama submitted_at = None -> tutarlilik CHECK'i reddetmeli (K-03)
    wse = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=1, start_slot=1, slot_count=1,
        status=EntryStatus.SUBMITTED, submitted_at=None,
    )
    session.add(wse)
    with pytest.raises(IntegrityError):
        session.flush()


# ------------------------------------------------------------------
# 4) FK davranislari (RESTRICT) ve UNIQUE
# ------------------------------------------------------------------
def test_lecturer_delete_is_restricted(session):
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE107")
    make_section(session, course, lec)  # hocaya bagli sube var
    session.delete(lec)
    with pytest.raises(IntegrityError):  # RESTRICT: subesi olan hoca silinemez
        session.flush()


def test_lecturer_normalized_name_unique_per_workgroup(session):
    wg, _, lec, _, _ = make_base(session)
    dup = Lecturer(
        workgroup_id=wg.id, full_name="Baska Ad",
        normalized_name=lec.normalized_name,  # ayni grup + ayni normalize ad
    )
    session.add(dup)
    with pytest.raises(IntegrityError):  # UNIQUE ihlali
        session.flush()


def test_building_name_unique_per_workgroup(session):
    """[K-18] Ayni workgroup'ta ayni bina adi ikinci kez eklenemez."""
    wg, _, _, bld, _ = make_base(session)
    dup = Building(workgroup_id=wg.id, name=bld.name)
    session.add(dup)
    with pytest.raises(IntegrityError):
        session.flush()


def test_section_no_unique_per_course(session):
    """[K-14] Ayni derste ayni sube no ikinci kez acilamaz."""
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE108")
    make_section(session, course, lec, section_no=1)
    dup = CourseSection(
        course_id=course.id, section_no=1, lecturer_id=lec.id,
        expected_students=25,
    )
    session.add(dup)
    with pytest.raises(IntegrityError):
        session.flush()


def test_same_lecturer_can_teach_two_sections(session):
    """[K-14] Ayni hoca ayni dersin iki subesine girebilir (kisit YOK)."""
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE109")
    s1 = make_section(session, course, lec, section_no=1)
    s2 = make_section(session, course, lec, section_no=2)
    assert s1.id != s2.id


def test_exam_is_unique_per_course_and_type(session):
    """[K-16] Sinav ders duzeyinde TEKTIR: ayni ders + ayni tip ikinci kez giremez.

    Subeler ayri sinav yapamaz — hocanin 'tum subeler ayni sinava girer' sarti
    dogrudan bu UNIQUE ile garanti edilir.
    """
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code="CE110")
    make_section(session, course, lec, section_no=1)
    make_section(session, course, lec, section_no=2)
    monday = date(2026, 9, 14)
    e1 = Exam(
        course_id=course.id, exam_type=ExamType.MIDTERM, exam_date=monday,
        start_time=time(10, 0), duration_minutes=90, lecturer_id=lec.id,
    )
    session.add(e1)
    session.flush()
    e2 = Exam(
        course_id=course.id, exam_type=ExamType.MIDTERM, exam_date=monday,
        start_time=time(14, 0), duration_minutes=90, lecturer_id=lec.id,
    )
    session.add(e2)
    with pytest.raises(IntegrityError):
        session.flush()


def test_exam_can_have_multiple_classrooms(session):
    """[K-17] Bir sinava birden cok derslik atanabilir (exam_classrooms)."""
    wg, dep, lec, bld, cls = make_base(session)
    cls2 = Classroom(
        workgroup_id=wg.id, building_id=bld.id, room_code=_u("103"),
        capacity=60, exam_capacity=30,
    )
    session.add(cls2)
    session.flush()
    course = make_course(session, dep, code="CE111")
    exam = Exam(
        course_id=course.id, exam_type=ExamType.FINAL,
        exam_date=date(2026, 9, 14), start_time=time(10, 0),
        duration_minutes=90, lecturer_id=lec.id,
    )
    exam.classrooms = [cls, cls2]
    session.add(exam)
    session.flush()
    assert {c.id for c in exam.classrooms} == {cls.id, cls2.id}
