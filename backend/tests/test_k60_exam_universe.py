"""K-60 cakisma evreni: sinav taslagi dikisi (conflict_service._exam_universe).

K-59'un haftalik evren testinin sinav ikizi. Kanitladigi sey yine TEK: **evren
dogru kuruluyor mu.** Motorun kurallari (E1/E2/E3/X1...) baska yerde test
edildi; burada onlarin NEYE bakacagini belirleyen kume sorgulanir:

  1. Taslaksiz cagri yalniz yayini gorur (eskiden "DRAFT + SUBMITTED hepsi"ydi).
  2. Taslakli cagri, taslagin cohort'unun YAYINDAKI sinav dilimini disarida
     birakir (birakmazsa ayni sinav iki kez sayilir -> E2 hayali cakismasi).
  3. Baska hesabin taslagi hicbir bicimde girmez.
  4. **kind izolasyonu:** haftalik taslak sinav evrenini, sinav taslagi haftalik
     evreni BOZMAZ. Oteki taraf her zaman yayindir -- K-06'nin X kurallari
     taslagin icinde de yayindaki gercege karsi kossun diye.
"""

from datetime import date, time

from app.conflict_service import (
    _exam_universe,
    _weekly_universe,
    scan_draft,
    scan_workgroup,
)
from app.models import (
    CourseCohort,
    DeliveryMode,
    Department,
    DraftKind,
    Exam,
    ExamType,
    ScheduleDraft,
    SemesterType,
    WeeklyScheduleEntry,
)
from tests.test_k59_draft_universe import make_course, make_user
from tests.test_wp0_smoke import (  # noqa: F401 — `session` fixture'i pytest bulur
    _u,
    make_base,
    make_section,
    session,
)

MONDAY = date(2026, 9, 14)      # ISODOW = 1; haftalik gun 1 ile ayni gune duser


def make_draft(s, wg, dep, owner, kind=DraftKind.EXAM, year=1,
               semester=SemesterType.FALL):
    d = ScheduleDraft(
        workgroup_id=wg.id, department_id=dep.id, year=year, semester=semester,
        kind=kind, name="Taslak", created_by=owner.id,
    )
    s.add(d)
    s.flush()
    return d


def sinav(s, course, lec, rooms=(), draft=None, start=time(9, 0),
          exam_type=ExamType.MIDTERM, exam_index=1, exam_date=MONDAY):
    x = Exam(
        course_id=course.id, exam_type=exam_type, exam_index=exam_index,
        exam_date=exam_date, start_time=start, duration_minutes=90,
        lecturer_id=lec.id, draft_id=draft.id if draft else None,
    )
    x.classrooms = list(rooms)
    s.add(x)
    s.flush()
    return x


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
    return {u["id"] for u in universe}


# ------------------------------------------------------------------
# 1) Taslaksiz evren = yayin
# ------------------------------------------------------------------
def test_exam_universe_without_draft_sees_only_published(session):
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("X1"))
    draft = make_draft(session, wg, dep, owner)

    yayinda = sinav(session, course, lec, rooms=[cls])
    taslakta = sinav(session, course, lec, rooms=[cls], draft=draft,
                     start=time(14, 0))

    evren = ids(_exam_universe(session, wg.id))
    assert yayinda.id in evren
    assert taslakta.id not in evren


# ------------------------------------------------------------------
# 2) Taslakli evren: kendi cohort'unun yayin dilimi DISLANIR
# ------------------------------------------------------------------
def test_exam_draft_universe_replaces_its_own_cohort_slice(session):
    """Ayni sinav iki kez sayilmamali — yoksa motor kendisiyle cakisir (E2)."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("X2"))       # dep / 1 / FALL
    draft = make_draft(session, wg, dep, owner, year=1, semester=SemesterType.FALL)

    yayinda = sinav(session, course, lec, rooms=[cls])
    taslakta = sinav(session, course, lec, rooms=[cls], draft=draft,
                     start=time(14, 0))

    evren = ids(_exam_universe(session, wg.id, draft))
    assert taslakta.id in evren      # taslagin kendi satiri
    assert yayinda.id not in evren   # ayni cohort'un yayindaki hali ikame edildi


def test_exam_draft_universe_keeps_other_cohorts_published_exams(session):
    """Baska cohort'un yayini evrende KALIR — derslik/hoca cakismasi gorulsun."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    kapsamda = make_course(session, dep, code=_u("X3A"), year=1)
    disarida = make_course(session, dep, code=_u("X3B"), year=2)   # baska cohort
    draft = make_draft(session, wg, dep, owner, year=1)

    kapsam_yayin = sinav(session, kapsamda, lec, rooms=[cls])
    baska_cohort_yayin = sinav(session, disarida, lec, rooms=[cls],
                               start=time(14, 0))

    evren = ids(_exam_universe(session, wg.id, draft))
    assert kapsam_yayin.id not in evren        # taslagin dilimi -> dislandi
    assert baska_cohort_yayin.id in evren      # ilgisiz cohort -> duruyor


def test_common_course_exam_slice_follows_the_consuming_cohort(session):
    """K-48 ortak dersinin sinavi da tuketen bolumun cohort'undan secilir.

    Bu, K-59'un acik uclarindaki "sinav ders duzeyinde, cohort'a baglanmaz"
    endisesinin yanlis oldugunun kanitidir: sinav derse, ders de ek cohort'a
    bagli oldugu icin `cohort_course_filter` onu tuketen bolumun taslaginda da
    bulur ve yayindaki halini dislar.
    """
    wg, math_dep, lec, _, cls = make_base(session)
    ce_dep = Department(workgroup_id=wg.id, name="Bilgisayar", code=_u("CE"))
    session.add(ce_dep)
    session.flush()
    owner = make_user(session, wg)

    ortak = make_course(session, math_dep, code=_u("MATH101"))   # birincil: MATH/1/FALL
    ortak.is_common = True
    session.add(CourseCohort(
        course_id=ortak.id, department_id=ce_dep.id,
        year=1, semester=SemesterType.FALL,                      # ek cohort: CE/1/FALL
    ))
    session.flush()

    draft = make_draft(session, wg, ce_dep, owner, year=1)       # CE'nin sinav taslagi
    yayinda = sinav(session, ortak, lec, rooms=[cls])
    taslakta = sinav(session, ortak, lec, rooms=[cls], draft=draft,
                     start=time(14, 0))

    evren = ids(_exam_universe(session, wg.id, draft))
    assert taslakta.id in evren
    assert yayinda.id not in evren, (
        "Ortak dersin yayindaki sinavi dislanmadi — taslak onu kendisiyle "
        "mukerrer (E2) sanacak (ek cohort filtreye takilmiyor)."
    )


def test_other_accounts_exam_drafts_never_enter_the_universe(session):
    """Taslak OZELDIR: baskasinin taslagi ne yayin ne de taslak evrenine girer."""
    wg, dep, lec, _, cls = make_base(session)
    ben = make_user(session, wg)
    baskasi = make_user(session, wg)
    course = make_course(session, dep, code=_u("X4"))

    benim = make_draft(session, wg, dep, ben)
    onunki = make_draft(session, wg, dep, baskasi)
    benim_satir = sinav(session, course, lec, rooms=[cls], draft=benim)
    onun_satiri = sinav(session, course, lec, rooms=[cls], draft=onunki,
                        start=time(14, 0))

    assert onun_satiri.id not in ids(_exam_universe(session, wg.id))
    evren = ids(_exam_universe(session, wg.id, benim))
    assert benim_satir.id in evren
    assert onun_satiri.id not in evren


# ------------------------------------------------------------------
# 3) kind izolasyonu: taslak yalniz KENDI turunu ikame eder
# ------------------------------------------------------------------
def test_weekly_draft_leaves_the_exam_universe_published(session):
    """Haftalik taslak sinav evreninde hicbir seyi degistirmez.

    `scan_draft` ayni taslagi iki evrene de veriyor; suzgec olmasaydi haftalik
    taslak, cohort'un YAYINDAKI sinavlarini evrenden dusururdu ve X kurallari
    (sinav-ders) sessizce kor kalirdi.
    """
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("X5"))
    haftalik_taslak = make_draft(session, wg, dep, owner, kind=DraftKind.WEEKLY)

    yayindaki_sinav = sinav(session, course, lec, rooms=[cls])

    evren = ids(_exam_universe(session, wg.id, haftalik_taslak))
    assert yayindaki_sinav.id in evren


def test_exam_draft_leaves_the_weekly_universe_published(session):
    """Simetrik: sinav taslagi haftalik evreni bozmaz."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("X6"))
    sec = make_section(session, course, lec)
    sinav_taslagi = make_draft(session, wg, dep, owner, kind=DraftKind.EXAM)

    yayindaki_ders = place(session, sec, 1, 1, cls)

    evren = ids(_weekly_universe(session, wg.id, sinav_taslagi))
    assert yayindaki_ders.id in evren


# ------------------------------------------------------------------
# 4) Uctan uca: sahte cakisma uretmiyor, gercegi yakaliyor
# ------------------------------------------------------------------
def test_moving_an_exam_in_draft_produces_no_phantom_conflict(session):
    """Yayindaki sinavi taslakta baska saate almak, "kendisiyle mukerrer" (E2)
    veya "kendi derslikleriyle cakisma" (E1) uretmemeli — dilim dislanmasaydi
    tam olarak bu olurdu."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    course = make_course(session, dep, code=_u("X7"))
    make_section(session, course, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner)

    sinav(session, course, lec, rooms=[cls])                              # yayinda 09:00
    sinav(session, course, lec, rooms=[cls], draft=draft, start=time(14, 0))

    tablo = scan_draft(session, draft)
    assert tablo["hard"] == [], tablo


def test_exam_draft_sees_real_conflict_against_another_cohort(session):
    """Taslaktaki sinav, BASKA cohort'un yayindaki sinaviyla ayni derslikte
    ayni saate gelirse E1 (HARD) cikmali."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    benim_ders = make_course(session, dep, code=_u("X8A"), year=1)
    komsu_ders = make_course(session, dep, code=_u("X8B"), year=2)
    make_section(session, benim_ders, lec, expected_students=10)
    make_section(session, komsu_ders, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner, year=1)

    sinav(session, komsu_ders, lec, rooms=[cls], start=time(9, 0))   # baska cohort, yayin
    sinav(session, benim_ders, lec, rooms=[cls], draft=draft, start=time(9, 0))

    tablo = scan_draft(session, draft)
    kurallar = {r["rule_id"] for r in tablo["hard"]}
    assert "E1" in kurallar, tablo


def test_exam_draft_is_checked_against_the_published_weekly_schedule(session):
    """K-06 X kurallari taslagin ICINDE de kosar: sinav taslagi, YAYINDAKI ders
    programina karsi test edilir. Sinav Pzt 09:00-10:30, ders Pzt 2. slot
    (09:30-10:15), ayni derslik -> X1 (HARD)."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    sinav_dersi = make_course(session, dep, code=_u("X9A"), year=1)
    haftalik_ders = make_course(session, dep, code=_u("X9B"), year=2)
    make_section(session, sinav_dersi, lec, expected_students=10)
    sec = make_section(session, haftalik_ders, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner, year=1)

    place(session, sec, 1, 2, cls)                                   # yayinda: Pzt 2
    sinav(session, sinav_dersi, lec, rooms=[cls], draft=draft, start=time(9, 0))

    tablo = scan_draft(session, draft)
    kurallar = {r["rule_id"] for r in tablo["hard"]}
    assert "X1" in kurallar, tablo


def test_workgroup_scan_ignores_exam_drafts(session):
    """Rapor/dashboard sinav taslaklarini GORMEZ — herkes birbirinin denemesini
    cakisma diye gormesin."""
    wg, dep, lec, _, cls = make_base(session)
    owner = make_user(session, wg)
    a = make_course(session, dep, code=_u("XA"))
    b = make_course(session, dep, code=_u("XB"))
    make_section(session, a, lec, expected_students=10)
    make_section(session, b, lec, expected_students=10)
    draft = make_draft(session, wg, dep, owner)

    sinav(session, a, lec, rooms=[cls], start=time(9, 0))                    # yayinda
    sinav(session, b, lec, rooms=[cls], draft=draft, start=time(9, 0))       # taslak, ayni yer/saat

    rapor = scan_workgroup(session, wg.id)
    etkilenen = {
        ref["id"]
        for r in rapor["hard"] + rapor["warnings"]
        for ref in r["affected"]
    }
    taslak_sinavlari = {
        x.id for x in session.query(Exam).filter(Exam.draft_id == draft.id)
    }
    assert etkilenen.isdisjoint(taslak_sinavlari)
