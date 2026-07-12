"""WP0 smoke testleri.

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
    Classroom,
    Course,
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
    """Bir workgroup + department + lecturer + classroom olustur ve flush et."""
    wg = Workgroup(name=_u("WG"), allowed_email_domain="muh.example.edu.tr")
    s.add(wg)
    s.flush()  # wg.id'yi almak icin (henuz commit degil)
    dep = Department(workgroup_id=wg.id, name="Bilgisayar Muh.", code=_u("BM"))
    lec = Lecturer(
        workgroup_id=wg.id, full_name="Dr. Ayse Kaya", normalized_name=_u("ayse")
    )
    cls = Classroom(
        workgroup_id=wg.id, building="A", room_code=_u("101"), capacity=40
    )
    s.add_all([dep, lec, cls])
    s.flush()
    return wg, dep, lec, cls


def make_course(s, dep, lec, code="CE101", **kw):
    """Gecerli bir ders olustur ve flush et."""
    c = Course(
        department_id=dep.id,
        year=1,
        semester=SemesterType.FALL,
        code=code,
        name="Programlama",
        lecturer_id=lec.id,
        expected_students=kw.pop("expected_students", 30),
        **kw,
    )
    s.add(c)
    s.flush()
    return c


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
    wg, dep, lec, cls = make_base(session)
    user = User(
        workgroup_id=wg.id, name="Admin", email=_u("a") + "@muh.edu",
        role=UserRole.ADMIN,
    )
    session.add(user)
    session.flush()
    wg.created_by = user.id  # dairesel FK (elle duzelttigimiz)
    course = make_course(session, dep, lec, default_classroom_id=cls.id)

    assert course.lecturer.id == lec.id            # ders -> hoca
    assert course.department.id == dep.id          # ders -> bolum
    assert course in lec.courses                    # hoca -> dersleri (ters yon)
    assert user in wg.users                         # grup -> kullanicilari
    assert wg.creator.id == user.id                 # dairesel FK gezinmesi
    assert course.default_classroom.id == cls.id    # ders -> varsayilan derslik


# ------------------------------------------------------------------
# 3) CHECK kisitlari gercekten hatali veriyi reddediyor mu?
# ------------------------------------------------------------------
def test_expected_students_must_be_positive(session):
    _, dep, lec, _ = make_base(session)
    bad = Course(
        department_id=dep.id, year=1, semester=SemesterType.FALL, code="CE102",
        name="X", lecturer_id=lec.id, expected_students=0,  # CHECK: > 0
    )
    session.add(bad)
    with pytest.raises(IntegrityError):
        session.flush()


def test_exam_must_be_weekday(session):
    _, dep, lec, _ = make_base(session)
    course = make_course(session, dep, lec, code="CE103")
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
    _, dep, lec, _ = make_base(session)
    course = make_course(session, dep, lec, code="CE105")
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
    _, dep, lec, _ = make_base(session)
    course = make_course(session, dep, lec, code="CE104")
    # 8. slotta baslayip 3 slot: 8 + 3 - 1 = 10 > 9  -> reddedilmeli
    wse = WeeklyScheduleEntry(
        course_id=course.id, day_of_week=1, start_slot=8, slot_count=3
    )
    session.add(wse)
    with pytest.raises(IntegrityError):
        session.flush()


def test_submitted_requires_timestamp(session):
    _, dep, lec, _ = make_base(session)
    course = make_course(session, dep, lec, code="CE106")
    # SUBMITTED ama submitted_at = None -> tutarlilik CHECK'i reddetmeli (K-03)
    wse = WeeklyScheduleEntry(
        course_id=course.id, day_of_week=1, start_slot=1, slot_count=1,
        status=EntryStatus.SUBMITTED, submitted_at=None,
    )
    session.add(wse)
    with pytest.raises(IntegrityError):
        session.flush()


# ------------------------------------------------------------------
# 4) FK davranislari (RESTRICT) ve UNIQUE
# ------------------------------------------------------------------
def test_lecturer_delete_is_restricted(session):
    _, dep, lec, _ = make_base(session)
    make_course(session, dep, lec, code="CE107")  # hocaya bagli ders var
    session.delete(lec)
    with pytest.raises(IntegrityError):  # RESTRICT: dersi olan hoca silinemez
        session.flush()


def test_lecturer_normalized_name_unique_per_workgroup(session):
    wg, _, lec, _ = make_base(session)
    dup = Lecturer(
        workgroup_id=wg.id, full_name="Baska Ad",
        normalized_name=lec.normalized_name,  # ayni grup + ayni normalize ad
    )
    session.add(dup)
    with pytest.raises(IntegrityError):  # UNIQUE ihlali
        session.flush()
