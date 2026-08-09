"""K-59 cakisma evreni: taslak dikisi (conflict_service._weekly_universe).

Bu dosyanin kanitladigi sey TEK bir sey: **evren dogru kuruluyor mu.** Motorun
kurallari (W1/W2/W3...) baska yerde test edildi; burada onlarin NEYE bakacagini
belirleyen kume sorgulanir:

  1. Taslaksiz cagri yalniz yayini gorur.
  2. Taslakli cagri, taslagin cohort'unun YAYINDAKI dilimini disarida birakir
     (birakmazsa ayni ders iki yerde gorunur -> hayali cakisma).
  3. Baska hesabin taslagi hicbir bicimde girmez.
  4. Taslak yayindaki bir dersi tasidiginda, motor eski yerini DEGIL yeni
     yerini gorur -> gercek cakisma yakalanir, sahte cakisma uretilmez.
"""

import pytest

from app.conflict_service import _weekly_universe, scan_draft, scan_workgroup
from app.models import (
    Course,
    CourseCohort,
    DeliveryMode,
    Department,
    ScheduleDraft,
    SemesterType,
    User,
    UserRole,
    WeeklyScheduleEntry,
)
from tests.test_wp0_smoke import (  # noqa: F401 — `session` fixture'i pytest bulur
    _u,
    make_base,
    make_section,
    session,
)


def make_course(s, dep, code, year=1, semester=SemesterType.FALL, hours_theory=1):
    """test_wp0_smoke.make_course'un yil/donem alabilen surumu.

    Oradaki yardimci year'i 1'e sabitliyor; bu dosyanin butun meselesi
    "hangi cohort" oldugu icin ikisini de disaridan vermek sart.
    """
    c = Course(
        department_id=dep.id, year=year, semester=semester, code=code,
        name="Deneme Dersi", hours_theory=hours_theory,
        hours_practice=0, hours_lab=0,
    )
    s.add(c)
    s.flush()
    return c


def make_user(s, wg) -> User:
    u = User(
        workgroup_id=wg.id, name="Taslak Sahibi",
        email=_u("t") + "@muh.edu", role=UserRole.SUB_ACCOUNT,
    )
    s.add(u)
    s.flush()
    return u


def make_draft(s, wg, dep, owner, year=1, semester=SemesterType.FALL):
    d = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=year, semester=semester,
        name="Taslak", created_by=owner.id,
    )
    s.add(d)
    s.flush()
    return d


def place(s, sec, day, slot, classroom=None, draft=None, slot_count=1):
    e = WeeklyScheduleEntry(
        section_id=sec.id, day_of_week=day, start_slot=slot, slot_count=slot_count,
        classroom_id=classroom.id if classroom else None,
        delivery_mode=DeliveryMode.FACE_TO_FACE,
        draft_id=draft.id if draft else None,
    )
    s.add(e)
    s.flush()
    return e


def ids(universe) -> set[int]:
    return {w["id"] for w in universe}


# ------------------------------------------------------------------
# 1) Taslaksiz evren = yayin
# ------------------------------------------------------------------
def test_universe_without_draft_sees_only_published(session):
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("U1"))
    sec = make_section(session, course, lec)
    draft = make_draft(session, wg, dep, owner)

    yayinda = place(session, sec, 1, 1, cls)
    taslakta = place(session, sec, 2, 1, cls, draft=draft)

    evren = ids(_weekly_universe(session, wg.id))
    assert yayinda.id in evren
    assert taslakta.id not in evren


# ------------------------------------------------------------------
# 2) Taslakli evren: kendi cohort'unun yayin dilimi DISLANIR
# ------------------------------------------------------------------
def test_draft_universe_replaces_its_own_cohort_slice(session):
    """Ayni ders iki kez sayilmamali — yoksa motor kendisiyle cakisir."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("U2"))     # dep / 1 / FALL
    sec = make_section(session, course, lec)
    draft = make_draft(session, wg, dep, owner, year=1, semester=SemesterType.FALL)

    yayinda = place(session, sec, 1, 1, cls)
    taslakta = place(session, sec, 3, 5, cls, draft=draft)

    evren = ids(_weekly_universe(session, wg.id, draft))
    assert taslakta.id in evren      # taslagin kendi satiri
    assert yayinda.id not in evren   # ayni cohort'un yayindaki hali ikame edildi


def test_draft_universe_keeps_other_cohorts_published_rows(session):
    """Baska cohort'un yayini evrende KALIR — derslik/hoca cakismasi gorulsun."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    kapsamda = make_course(session, dep, code=_u("U3A"), year=1)
    disarida = make_course(session, dep, code=_u("U3B"), year=2)   # baska cohort
    sec_a = make_section(session, kapsamda, lec)
    sec_b = make_section(session, disarida, lec)
    draft = make_draft(session, wg, dep, owner, year=1)

    kapsam_yayin = place(session, sec_a, 1, 1, cls)
    baska_cohort_yayin = place(session, sec_b, 2, 4, cls)

    evren = ids(_weekly_universe(session, wg.id, draft))
    assert kapsam_yayin.id not in evren        # taslagin dilimi -> dislandi
    assert baska_cohort_yayin.id in evren      # ilgisiz cohort -> duruyor


def test_common_course_slice_follows_the_consuming_cohort(session):
    """K-48 ortak dersi: yerlesimi TEK fiziksel satirdir ve tuketen bolumun
    taslagi onun kopyasini tasir. Dolayisiyla o taslagin evreninde yayindaki
    hali DISLANMALI — dislanmazsa ortak ders her taslakta kendisiyle cakisir.

    Kurulum: ders MATH/1/FALL'a ait (birincil), CE/1/FALL onu ek cohort olarak
    tuketiyor; taslak CE/1/FALL uzerinde.
    """
    wg, math_dep, lec, _, cls = make_base(session)
    ce_dep = Department(workgroup_id=wg.id, name="Bilgisayar", code=_u("CE"))
    session.add(ce_dep)
    session.flush()
    owner = make_user(session, wg)

    ortak = make_course(session, math_dep, code=_u("MATH101"))     # birincil: MATH/1/FALL
    ortak.is_common = True
    session.add(CourseCohort(
        course_id=ortak.id, department_id=ce_dep.id,
        year=1, semester=SemesterType.FALL,                        # ek cohort: CE/1/FALL
    ))
    sec = make_section(session, ortak, lec)
    session.flush()

    draft = make_draft(session, wg, ce_dep, owner, year=1)         # CE'nin taslagi
    yayinda = place(session, sec, 1, 1, cls)
    taslakta = place(session, sec, 4, 2, cls, draft=draft)

    evren = ids(_weekly_universe(session, wg.id, draft))
    assert taslakta.id in evren
    assert yayinda.id not in evren, (
        "Ortak dersin yayindaki hali dislanmadi — taslak onu kendisiyle "
        "cakisiyor sanacak (ek cohort filtreye takilmiyor)."
    )


def test_other_accounts_drafts_never_enter_the_universe(session):
    """Taslak OZELDIR: baskasinin taslagi ne yayin ne de taslak evrenine girer."""
    wg, dep, lec, _, cls = make_base(session)
    ben = make_user(session, wg)
    baskasi = make_user(session, wg)
    course = make_course(session, dep, code=_u("U4"))
    sec = make_section(session, course, lec)

    benim = make_draft(session, wg, dep, ben)
    onunki = make_draft(session, wg, dep, baskasi)
    benim_satir = place(session, sec, 1, 1, cls, draft=benim)
    onun_satiri = place(session, sec, 2, 2, cls, draft=onunki)

    assert onun_satiri.id not in ids(_weekly_universe(session, wg.id))
    evren = ids(_weekly_universe(session, wg.id, benim))
    assert benim_satir.id in evren
    assert onun_satiri.id not in evren


# ------------------------------------------------------------------
# 3) Uctan uca: sahte cakisma uretmiyor, gercegi yakaliyor
# ------------------------------------------------------------------
def test_moving_a_course_in_draft_produces_no_phantom_conflict(session):
    """Yayindaki dersi taslakta tasimak, "kendisiyle derslik cakismasi" (W1)
    uretmemeli — dilim dislanmasaydi tam olarak bu olurdu."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("U5"), hours_theory=1)
    sec = make_section(session, course, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner)

    place(session, sec, 1, 1, cls)                    # yayinda: Pzt 1
    place(session, sec, 3, 1, cls, draft=draft)       # taslakta: Car 1

    tablo = scan_draft(session, draft)
    assert tablo["hard"] == []


def test_draft_sees_real_conflict_against_another_cohort(session):
    """Taslaktaki yerlesim, BASKA cohort'un yayindaki dersiyle ayni derslikte
    ayni saate gelirse W1 (HARD) cikmali."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    benim_ders = make_course(session, dep, code=_u("U6A"), year=1, hours_theory=1)
    komsu_ders = make_course(session, dep, code=_u("U6B"), year=2, hours_theory=1)
    sec_a = make_section(session, benim_ders, lec, expected_students=10)
    sec_b = make_section(session, komsu_ders, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner, year=1)

    place(session, sec_b, 2, 4, cls)                       # baska cohort, yayinda
    place(session, sec_a, 2, 4, cls, draft=draft)          # taslak ayni yer/saat

    tablo = scan_draft(session, draft)
    kurallar = {r["rule_id"] for r in tablo["hard"]}
    assert "W1" in kurallar, tablo


def test_workgroup_scan_ignores_drafts(session):
    """Rapor/dashboard taslaklari GORMEZ — herkes birbirinin denemesini
    cakisma diye gormesin."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("U7"), hours_theory=1)
    sec = make_section(session, course, lec, expected_students=10)
    ikinci = make_section(session, course, lec, section_no=2, expected_students=10)
    draft = make_draft(session, wg, dep, owner)

    place(session, sec, 1, 1, cls)                          # yayinda
    place(session, ikinci, 1, 1, cls, draft=draft)          # taslakta ayni yer/saat

    rapor = scan_workgroup(session, wg.id)
    etkilenen = {
        ref["id"]
        for r in rapor["hard"] + rapor["warnings"]
        for ref in r["affected"]
    }
    taslak_satirlari = {
        e.id for e in session.query(WeeklyScheduleEntry)
        .filter(WeeklyScheduleEntry.draft_id == draft.id)
    }
    assert etkilenen.isdisjoint(taslak_satirlari)
