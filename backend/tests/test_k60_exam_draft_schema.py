"""K-60 sinav taslak semasi smoke testleri — draft_kind + exams.draft_id.

Amac: sinav onay akisinin dayandigi UC sema garantisini kanitlamak.
  1. Bir cohort icin haftalik ve sinav taslagi AYNI ANDA acilabilir.
  2. K-46 tekilligi YAYINDA aynen durur, ama taslak kopyasini engellemez.
     (Bu, K-60'in en kirilgan noktasi: kosulsuz UNIQUE kalsaydi kopyalama
     aninda patlardi; tek bir dort kolonlu UNIQUE ise yayindaki tekilligi
     kaybettirirdi -- Postgres NULL'lari birbirine esit saymaz.)
  3. Taslagi silmek YALNIZ kendi sinav kopyalarini goturur, yayina dokunmaz.

K-59'un sema testiyle ayni desen; kurulum yardimcilari oradan ve wp0'dan
aliniyor -- ayni ORM iskeletini ucuncu kez yazmak, biri degistiginde
otekilerin sessizce eskimesi demek olurdu.
"""

from datetime import date, time

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    DraftKind,
    Exam,
    ExamType,
    ScheduleDraft,
    SemesterType,
)
from tests.test_k59_draft_schema import make_draft, make_user
from tests.test_wp0_smoke import (  # noqa: F401 — `session` fixture'i pytest bulur
    _u,
    make_base,
    make_course,
    session,
)

MONDAY = date(2026, 9, 14)      # wp0 testleriyle ayni gun: ISODOW CHECK'ini gecer


def make_exam(s, course, lec, exam_type=ExamType.MIDTERM, exam_index=1, **kw):
    x = Exam(
        course_id=course.id, exam_type=exam_type, exam_index=exam_index,
        exam_date=kw.pop("exam_date", MONDAY),
        start_time=kw.pop("start_time", time(10, 0)),
        duration_minutes=kw.pop("duration_minutes", 90),
        lecturer_id=lec.id, **kw,
    )
    s.add(x)
    s.flush()
    return x


# ------------------------------------------------------------------
# 1) kind ayraci
# ------------------------------------------------------------------
def test_kind_defaults_to_weekly(session):
    """K-60 oncesi acilmis taslaklarin tamami haftalik; varsayilan onlari korur."""
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    d = make_draft(session, wg, dep, owner)
    session.expire(d)
    assert d.kind == DraftKind.WEEKLY


def test_weekly_and_exam_drafts_coexist_for_same_cohort(session):
    """Ayni cohort icin iki taslak: biri program, biri sinav takvimi.

    Aktif taslak tekilligine `kind` eklenmeseydi bu ikisi carpisirdi -- oysa
    ders programi ile sinav takvimi birbirinden bagimsiz yuruyor (K-60).
    """
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    haftalik = make_draft(session, wg, dep, owner, kind=DraftKind.WEEKLY)
    sinav = make_draft(
        session, wg, dep, owner, kind=DraftKind.EXAM, name="Vize takvimi"
    )
    assert haftalik.id != sinav.id


def test_two_exam_drafts_for_same_cohort_still_blocked(session):
    """Tekillik gevsemedi, yalniz bir boyut kazandi: ayni kind'dan tek aktif."""
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    make_draft(session, wg, dep, owner, kind=DraftKind.EXAM)
    ikinci = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=1,
        semester=SemesterType.FALL, kind=DraftKind.EXAM,
        name="Ayni cohort, ikinci sinav taslagi", created_by=owner.id,
    )
    session.add(ikinci)
    with pytest.raises(IntegrityError):   # kismi UNIQUE index
        session.flush()


# ------------------------------------------------------------------
# 2) K-46 tekilligi: yayinda korunur, taslakta ayri sayilir
# ------------------------------------------------------------------
def test_published_exam_uniqueness_still_enforced(session):
    """Yayinda ayni (ders, tip, sira) ikinci kez giremez — K-46 aynen gecerli."""
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code=_u("K60A"))
    make_exam(session, course, lec)
    ikinci = Exam(
        course_id=course.id, exam_type=ExamType.MIDTERM, exam_index=1,
        exam_date=MONDAY, start_time=time(14, 0), duration_minutes=90,
        lecturer_id=lec.id,
    )
    session.add(ikinci)
    with pytest.raises(IntegrityError):
        session.flush()


def test_draft_may_hold_a_copy_of_a_published_exam(session):
    """Taslak yayinin KOPYASINI tasir; kosulsuz UNIQUE kalsaydi burasi patlardi.

    K-60'in tum sema isi bu tek satir icin: taslak acilirken yayindaki sinavlar
    kopyalanacak ve iki satir ayni (ders, tip, sira) ucluyu tasiyacak.
    """
    wg, dep, lec, _, _ = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("K60B"))
    draft = make_draft(session, wg, dep, owner, kind=DraftKind.EXAM)

    yayinda = make_exam(session, course, lec)
    taslakta = make_exam(
        session, course, lec, draft_id=draft.id, start_time=time(14, 0)
    )

    assert yayinda.draft_id is None          # NULL = yayinda
    assert taslakta.draft.id == draft.id
    assert [x.id for x in draft.exams] == [taslakta.id]


def test_two_drafts_may_each_hold_the_same_exam(session):
    """Iki kisi ayni cohorttan sinav taslagi acabilir; kopyalari carpismaz."""
    wg, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code=_u("K60C"))
    a = make_draft(
        session, wg, dep, make_user(session, wg), kind=DraftKind.EXAM
    )
    b = make_draft(
        session, wg, dep, make_user(session, wg), kind=DraftKind.EXAM
    )
    make_exam(session, course, lec, draft_id=a.id)
    make_exam(session, course, lec, draft_id=b.id, start_time=time(14, 0))
    session.flush()   # ikisi de gecmeli


def test_same_exam_twice_inside_one_draft_is_blocked(session):
    """Taslagin KENDI icinde de tekillik var: mukerrer satir taslakta da yanlis."""
    wg, dep, lec, _, _ = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("K60D"))
    draft = make_draft(session, wg, dep, owner, kind=DraftKind.EXAM)

    make_exam(session, course, lec, draft_id=draft.id)
    ikinci = Exam(
        course_id=course.id, exam_type=ExamType.MIDTERM, exam_index=1,
        exam_date=MONDAY, start_time=time(14, 0), duration_minutes=90,
        lecturer_id=lec.id, draft_id=draft.id,
    )
    session.add(ikinci)
    with pytest.raises(IntegrityError):
        session.flush()


# ------------------------------------------------------------------
# 3) Silme davranisi
# ------------------------------------------------------------------
def test_deleting_exam_draft_removes_only_its_own_exams(session):
    """Taslagi atmak yayina DOKUNMAZ — ozel taslagin tum guvencesi bu."""
    wg, dep, lec, _, _ = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("K60E"))
    draft = make_draft(session, wg, dep, owner, kind=DraftKind.EXAM)

    yayinda = make_exam(session, course, lec)
    taslakta = make_exam(
        session, course, lec, draft_id=draft.id, start_time=time(14, 0)
    )
    taslak_sinav_id = taslakta.id

    session.delete(draft)
    session.flush()
    session.expire_all()

    assert session.get(Exam, taslak_sinav_id) is None      # CASCADE
    assert session.get(Exam, yayinda.id) is not None       # yayin durur
