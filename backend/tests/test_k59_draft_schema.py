"""K-59 taslak semasi smoke testleri — schedule_drafts + weekly.draft_id.

Amac: onay akisinin dayandigi UC sema garantisini kanitlamak.
  1. Yayin ile taslak AYRI durur: `draft_id IS NULL` = yayinda.
  2. Bir kullanici bir cohort icin ayni anda TEK aktif taslak tutar.
  3. Taslagi silmek YALNIZ kendi kopyalarini goturur, yayina dokunmaz.

test_wp0_smoke.py deseni: her test tek transaction, sonunda rollback. Kurulum
yardimcilari oradan alinir — ayni ORM iskeletini ikinci kez yazmak, biri
degistiginde otekinin sessizce eskimesi demek olurdu.
"""

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    Department,
    DraftStatus,
    ScheduleDraft,
    SemesterType,
    User,
    UserRole,
    WeeklyScheduleEntry,
)
from tests.test_wp0_smoke import (  # noqa: F401 — `session` fixture'i pytest bulur
    _u,
    make_base,
    make_course,
    make_section,
    session,
)


def make_user(s, wg) -> User:
    """Taslagin sahibi olacak hesap (schedule_drafts.created_by NOT NULL)."""
    u = User(
        workgroup_id=wg.id, name="Taslak Sahibi",
        email=_u("t") + "@muh.edu", role=UserRole.SUB_ACCOUNT,
    )
    s.add(u)
    s.flush()
    return u


def make_draft(s, wg, dep, owner, year=1, semester=SemesterType.FALL, **kw):
    d = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=year, semester=semester,
        name=kw.pop("name", "Deneme taslagi"), created_by=owner.id, **kw,
    )
    s.add(d)
    s.flush()
    return d


# ------------------------------------------------------------------
# 1) Yayin / taslak ayrimi
# ------------------------------------------------------------------
def test_published_entry_has_no_draft(session):
    """Bugunku (ve onaylanmis) satirlar draft_id tasimaz — varsayilan NULL."""
    _, dep, lec, _, _ = make_base(session)
    course = make_course(session, dep, code=_u("K59A"))
    sec = make_section(session, course, lec)
    e = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=1, start_slot=1, slot_count=1
    )
    session.add(e)
    session.flush()
    assert e.draft_id is None      # NULL = yayinda
    assert e.draft is None


def test_draft_entries_do_not_leak_into_published(session):
    """Taslak kopyasi ile yayin satiri ayni tabloda ama karismaz."""
    wg, dep, lec, _, _ = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("K59B"))
    sec = make_section(session, course, lec)
    draft = make_draft(session, wg, dep, owner)

    yayinda = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=1, start_slot=1, slot_count=1
    )
    taslakta = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=2, start_slot=3, slot_count=1,
        draft_id=draft.id,
    )
    session.add_all([yayinda, taslakta])
    session.flush()

    # Taslak yalniz kendi kopyasini gorur
    assert [e.id for e in draft.entries] == [taslakta.id]
    assert taslakta.draft.id == draft.id
    # "Yayindaki program" sorgusu taslak satirini GORMEZ
    yayin_satirlari = (
        session.query(WeeklyScheduleEntry)
        .filter(WeeklyScheduleEntry.section_id == sec.id,
                WeeklyScheduleEntry.draft_id.is_(None))
        .all()
    )
    assert [e.id for e in yayin_satirlari] == [yayinda.id]


# ------------------------------------------------------------------
# 2) Cohort basina tek aktif taslak
# ------------------------------------------------------------------
def test_one_active_draft_per_owner_and_cohort(session):
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    make_draft(session, wg, dep, owner)
    ikinci = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=1,
        semester=SemesterType.FALL, name="Ayni cohort, ikinci taslak",
        created_by=owner.id,
    )
    session.add(ikinci)
    with pytest.raises(IntegrityError):  # kismi UNIQUE index
        session.flush()


def test_approved_draft_does_not_block_a_new_one(session):
    """Onaylanan taslak GECMIS kaydidir; yeni taslak acmayi engellememeli."""
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    eski = make_draft(session, wg, dep, owner)
    eski.status = DraftStatus.APPROVED
    session.flush()

    yeni = make_draft(session, wg, dep, owner, name="Onaydan sonraki taslak")
    assert yeni.id != eski.id


def test_rejected_draft_still_blocks_a_second_one(session):
    """Reddedilen taslak aktiftir: yanina yenisini acmak gerekceyi kaybettirir."""
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    red = make_draft(session, wg, dep, owner)
    red.status = DraftStatus.REJECTED
    session.flush()

    ikinci = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=1,
        semester=SemesterType.FALL, name="Reddedilenin yanina",
        created_by=owner.id,
    )
    session.add(ikinci)
    with pytest.raises(IntegrityError):
        session.flush()


def test_other_cohorts_and_owners_are_independent(session):
    """Kisit (sahip + bolum + yil + donem [+ kind]) anahtarina baglidir, daha genisine degil.

    `kind` boyutu K-60'ta eklendi; testi orada (`test_k60_exam_draft_schema`).
    """
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    baskasi = make_user(session, wg)
    ilk = make_draft(session, wg, dep, owner, year=1)

    assert make_draft(session, wg, dep, owner, year=2).id != ilk.id       # baska yil
    assert make_draft(                                                     # baska donem
        session, wg, dep, owner, year=1, semester=SemesterType.SPRING
    ).id != ilk.id
    assert make_draft(session, wg, dep, baskasi, year=1).id != ilk.id     # baska sahip


# ------------------------------------------------------------------
# 3) Silme davranisi ve kisitlar
# ------------------------------------------------------------------
def test_deleting_draft_removes_only_its_own_entries(session):
    """Taslagi atmak yayina DOKUNMAZ — ozel taslagin tum guvencesi bu."""
    wg, dep, lec, _, _ = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("K59C"))
    sec = make_section(session, course, lec)
    draft = make_draft(session, wg, dep, owner)

    yayinda = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=1, start_slot=1, slot_count=1
    )
    taslakta = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=2, start_slot=3, slot_count=1,
        draft_id=draft.id,
    )
    session.add_all([yayinda, taslakta])
    session.flush()
    taslak_satir_id = taslakta.id

    session.delete(draft)
    session.flush()
    session.expire_all()

    assert session.get(WeeklyScheduleEntry, taslak_satir_id) is None   # CASCADE
    assert session.get(WeeklyScheduleEntry, yayinda.id) is not None    # yayin durur


def test_draft_year_must_be_in_range(session):
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    bad = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=7,  # CHECK: 1..6
        semester=SemesterType.FALL, name="Gecersiz yil", created_by=owner.id,
    )
    session.add(bad)
    with pytest.raises(IntegrityError):
        session.flush()


def test_affected_departments_roundtrip(session):
    """Ortak ders tasindiginda etkilenen bolumler taslaga baglanir (K-48/K-59)."""
    wg, dep, _, _, _ = make_base(session)
    owner = make_user(session, wg)
    tuketen = Department(workgroup_id=wg.id, name="Elektrik Muh.", code=_u("EE"))
    session.add(tuketen)
    session.flush()

    draft = make_draft(session, wg, dep, owner)
    draft.affected_departments = [tuketen]
    session.flush()
    session.expire_all()

    assert [d.id for d in draft.affected_departments] == [tuketen.id]
