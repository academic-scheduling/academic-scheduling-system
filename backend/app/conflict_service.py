"""Cakisma motoru dikisi (K-22) — ORM <-> motor adaptoru.

Router'lar motoru YALNIZCA bu modul uzerinden cagirir. Motorun kendisi
(app/conflicts/, WP5, Stajyer C) saf Python'dur: DB bilmez, ORM bilmez,
duz dict listeleri alir. Bu dosya iki dunyayi birbirine baglar:

    ORM nesneleri --[_weekly_to_dict/_exam_to_dict]--> motor dict'leri
    motor sonuclari (kontrat §0 ConflictResult) --> router --> istemci

Tasarim kararlari:
  - **Evren (K-59):** iki bicimi var. Taslaksiz cagrilarda evren YAYINDAKI
    programdir. Bir taslak verildiginde evren, taslagin satirlari + yayinin o
    taslagin cohort'u DISINDA kalan kismidir; boylece taslak, kendi diliminin
    yayindaki halini ikame eder. Baska hesaplarin taslaklari asla girmez —
    taslak ozeldir, "taslaklar arasi cakisma" diye bir kavram yoktur.
  - **Aday filtresi:** motor evrenin tamamini tarar, biz yalnizca adayi (veya
    submit kumesini) ilgilendiren sonuclari donduruyoruz. Aksi halde kullanici
    kendi kaydini yaparken baskasinin cakismasini gorurdu.
  - **W8 (tamlik, K-20):** yalniz submit ve tam taramada uretilir, save'de ASLA.
  - **X kurallari (K-06):** workgroup.check_exam_vs_course bayragina baglidir;
    bayrak DB'den okunup motora parametre olarak gecirilir.
"""

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload

from app.cohort import cohort_course_filter
from app.conflicts.orchestrator import (
    scan_completeness, scan_cross, scan_exams, scan_weekly,
)
from app.models import (
    Classroom, Course, CourseCohort, CourseSection, Department, DraftKind, Exam,
    ScheduleDraft, Workgroup, WeeklyScheduleEntry,
)


# ==================================================================
# Adaptorler: ORM nesnesi -> motorun bekledigi duz dict
# ==================================================================

def _course_cohorts(c: Course) -> list[dict]:
    """Dersin efektif cohort KUMESI (K-48): birincil (courses satiri) + ek
    cohort'lar (course_cohorts). Normal derste tek eleman -> eski davranis.
    Motor 'ayni cohort mu' testini bu kume uzerinden kesisim olarak yapar;
    department_name mesajda paylasilan cohort'un adini yazabilmek icin tasinir."""
    cohorts = [{
        "department_id": c.department_id,
        "department_name": c.department.name,
        "year": c.year,
        "semester": c.semester.value,
    }]
    for cc in c.extra_cohorts:
        cohorts.append({
            "department_id": cc.department_id,
            "department_name": cc.department.name,
            "year": cc.year,
            "semester": cc.semester.value,
        })
    return cohorts

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
        # K-59: motor bu alani OKUMAZ; sonuclari "taslagi ilgilendiren" ve
        # "zaten yayinda olan" diye ayirmak icin burada tasiyoruz.
        "draft_id": e.draft_id,
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
        "cohorts": _course_cohorts(c),             # K-48: efektif cohort kumesi
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
        # K-60: motor bu alani OKUMAZ; sonuclari "taslagi ilgilendiren" ve
        # "zaten yayinda olan" diye ayirmak icin burada tasiyoruz (haftaligin
        # `draft_id` alaninin karsiligi).
        "draft_id": x.draft_id,
        "course_id": x.course_id,
        "exam_type": x.exam_type.value,
        "exam_index": x.exam_index,           # K-46: kaçıncı vize (E2 buna bakar)
        "exam_date": x.exam_date,
        "start_time": x.start_time,
        "duration_minutes": x.duration_minutes,
        "lecturer_id": x.lecturer_id,
        # K-81: gozetmenler. Motor bunu SORUMLUDAN AYRI tutuyor cunku
        # cakismanin mesaji hangi rolun catistigini soylemeli; tek bir "kisi
        # kumesi" alani olsaydi E9 "bu kisi iki sinavda" diyebilir ama
        # "gozetmen olarak" diyemezdi.
        "invigilator_ids": [g.id for g in x.invigilators],
        "department_id": c.department_id,
        "department_name": c.department.name,
        "year": c.year,
        "semester": c.semester.value,
        "cohorts": _course_cohorts(c),             # K-48: efektif cohort kumesi
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

def _weekly_universe(
    db: Session, workgroup_id: int, draft: ScheduleDraft | None = None
) -> list[dict]:
    """Workgroup'un cakisma evrenine giren haftalik girisleri.

    **Evren iki bicimde kurulur (K-59):**

    - `draft` YOK -> yalniz YAYINDAKI satirlar (`draft_id IS NULL`). Cakisma
      raporu, dashboard ve yayin uzerindeki kontroller bunu kullanir.
    - `draft` VAR -> taslagin kendi satirlari + yayinin taslak DISINDA kalan
      kismi. Taslak, kendi cohort'unun yayindaki dilimini KOMPLE ikame eder;
      o dilim disarida birakilmazsa ayni ders hem yayindaki hem taslaktaki
      yeriyle iki kez sayilir ve motor hayali cakisma uretir.

    Dilimin sinirini `cohort_course_filter` cizer — taslagin acilirken hangi
    dersleri kopyaladigini belirleyen filtrenin AYNISI. Ortak ders (K-48) de
    dahildir: tuketen bolumun cohort'undan geldigi icin filtreye takilir,
    yayindaki tek fiziksel satiri dislanir, yerine taslaktaki kopyasi gecer.

    BASKA HESAPLARIN TASLAKLARI HICBIR BICIMDE GIRMEZ: taslak ozeldir (K-59),
    "taslaklar arasi cakisma" diye bir kavram yoktur. Iki dalda da satirlar ya
    `draft_id IS NULL` ya da `draft_id = bu taslak`.

    Pasif sube/ders her iki bicimde de DISLANIR (K-39): girisi olan bir
    sube/ders pasife alindiginda o girisler artik kimseyle cakismaz —
    projenin her yerinde "pasif = kapsam disi" (K-16 ogrenci sayisi, K-33
    dashboard sayaci, K-15 "tum aktif sube ciftleri").

    Eager yukleme N+1'i onler — adaptor her giris icin
    section/course/department/classroom'a dokunuyor.
    """
    # K-60: SINAV taslagi haftalik evrende hicbir seyi ikame etmez. Cagiran
    # `scan_draft` iki evrene de ayni taslagi veriyor; her biri YALNIZ kendi
    # turunu alsin diye suzgec burada. Sessiz bir hata degil, dogru bir ifade:
    # "bir sinav taslagi haftalik programin hicbir dilimini degistirmez".
    if draft is not None and draft.kind is not DraftKind.WEEKLY:
        draft = None

    if draft is None:
        scope = WeeklyScheduleEntry.draft_id.is_(None)
    else:
        in_draft_cohort = cohort_course_filter(
            draft.department_id, draft.year, draft.semester
        )
        scope = or_(
            WeeklyScheduleEntry.draft_id == draft.id,
            and_(WeeklyScheduleEntry.draft_id.is_(None), ~in_draft_cohort),
        )

    entries = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .filter(
            Department.workgroup_id == workgroup_id,
            CourseSection.active.is_(True),
            Course.active.is_(True),
            scope,
        )
        .options(
            selectinload(WeeklyScheduleEntry.section)
            .selectinload(CourseSection.course)
            .selectinload(Course.department),
            # K-48: ortak dersin ek cohort'lari + onlarin bolumu (mesajda ad)
            selectinload(WeeklyScheduleEntry.section)
            .selectinload(CourseSection.course)
            .selectinload(Course.extra_cohorts)
            .selectinload(CourseCohort.department),
            selectinload(WeeklyScheduleEntry.classroom),
        )
        .all()
    )
    return [_weekly_to_dict(e) for e in entries]


def _exam_universe(
    db: Session, workgroup_id: int, draft: ScheduleDraft | None = None
) -> list[dict]:
    """Workgroup'un cakisma evrenine giren sinavlari.

    **Evren iki bicimde kurulur (K-60)** — `_weekly_universe` ile birebir ayni
    desen, gerekceleri de ayni:

    - `draft` YOK -> yalniz YAYINDAKI sinavlar (`draft_id IS NULL`).
      Eski hali "DRAFT + SUBMITTED hepsi" idi; artik yarim isler kimsenin
      evrenine girmiyor.
    - `draft` VAR (ve EXAM turunde) -> taslagin kendi sinavlari + yayinin
      taslak DISINDA kalan kismi. Taslak, kendi cohort'unun sinav dilimini
      KOMPLE ikame eder; dilim disarida birakilmazsa ayni sinav hem yayindaki
      hem taslaktaki tarihiyle iki kez sayilir ve motor hayali cakisma uretir.

    Dilimin sinirini yine `cohort_course_filter` cizer: sinav ders duzeyinde
    olsa da (K-16) ders `(department_id, year, semester)` + `extra_cohorts`
    tasidigi icin bir cohort'un sinavlari tam secilebilir. Ortak dersin sinavi
    tuketen bolumun cohort'undan da gelir, tek fiziksel satiri dislanir.

    HAFTALIK taslagi buraya verilirse YOK SAYILIR: haftalik taslak sinav
    evreninde hicbir seyi degistirmez (bkz. `_weekly_universe`'un simetrigi).

    Pasif dersin sinavi evren disidir (K-39; sinav ders duzeyindedir, ders
    pasifse sinav da kapsam disi). Sinavda `active` alani yok — pasiflik
    dersten gelir.
    """
    if draft is not None and draft.kind is not DraftKind.EXAM:
        draft = None

    if draft is None:
        scope = Exam.draft_id.is_(None)
    else:
        in_draft_cohort = cohort_course_filter(
            draft.department_id, draft.year, draft.semester
        )
        scope = or_(
            Exam.draft_id == draft.id,
            and_(Exam.draft_id.is_(None), ~in_draft_cohort),
        )

    exams = (
        db.query(Exam)
        .join(Course).join(Department)
        .filter(
            Department.workgroup_id == workgroup_id,
            Course.active.is_(True),
            scope,
        )
        .options(
            selectinload(Exam.course).selectinload(Course.department),
            selectinload(Exam.course).selectinload(Course.sections),
            # K-48: ortak dersin ek cohort'lari + onlarin bolumu (mesajda ad)
            selectinload(Exam.course)
            .selectinload(Course.extra_cohorts)
            .selectinload(CourseCohort.department),
            selectinload(Exam.classrooms),
            selectinload(Exam.invigilators),   # K-81 (N+1 onleme)
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

def check_weekly_save(
    db: Session, entry: WeeklyScheduleEntry, draft: ScheduleDraft | None = None
) -> list[dict]:
    """Tek haftalik girisin kayit ani kontrolu.

    Sonuc BILGILENDIRIR, kaydi ENGELLEMEZ (K-03) — engelleme karari router'da.
    W8 tamlik kurali burada URETILMEZ (K-20): yerlestirme surerken "hala eksik"
    uyarisi yagdirmamak icin yalniz submit'te calisir.

    `draft` verilirse kontrol o taslagin evreninde yapilir (K-59): taslak
    icindeki duzenleme, kendi cohort'unun yayindaki haline degil taslaktaki
    haline karsi test edilir.
    """
    wg = _wg_of_entry(entry)
    weeklies = _weekly_universe(db, wg, draft)
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
# Seam: taslak (K-59 haftalik, K-60 sinav)
# ==================================================================

def scan_draft(db: Session, draft: ScheduleDraft) -> dict[str, list[dict]]:
    """Bir taslagin TAM cakisma tablosu: kendi ici + yayindaki diger cohort'lar.

    Uc yerde ayni cagri kullanilir; ucunun ayni sayiyi gostermesi sart:
      1. Taslak editoru — kullanici duzenlerken durumu gorsun.
      2. Onaya gonderme kapisi — HARD varsa talep hic olusmasin.
      3. Onay ani — arada yayin degistiyse HARD cikabilir, onay engellenir
         ("bu talep artik guncel programla cakisiyor", K-59).

    **Sonuc suzgeci:** yalniz taslagin KENDI satirlarina dokunan cakismalar
    dondurulur. Baska cohort'larin yayinda zaten var olan cakismasi taslagin
    sucu degildir; gosterilirse kullanici duzeltemeyecegi bir listeye bakar ve
    onay kapisi baskasinin hatasi yuzunden kilitlenir.

    **W8 (tamlik, K-20) BURADA URETILIR:** kayit aninda susmasinin gerekcesi
    "yerlestirme surerken rahatsiz etme"ydi; taslagin tablosu ise kullanicinin
    bilerek "durum ne" dedigi yerdir (scan_workgroup'taki K-39 gerekcesinin
    aynisi). Yalniz taslagin satirlari degerlendirilir — taslak kendi
    cohort'unun tamamini tasidigi icin sube bazinda tamlik dogru hesaplanir.
    W8 haftaliga ozgudur (T+U+L saat hedefi); SINAV taslaginda uretilmez.

    **K-60 — kind'a gore taraf secimi:** iki evren de kurulur, ama taslak
    yalnizca KENDI turunu ikame eder; oteki taraf her zaman yayindir. Yani
    haftalik taslak "yayindaki sinavlara karsi", sinav taslagi "yayindaki
    derslere karsi" test edilir. X kurallari (K-06, sinav-ders) boylece
    taslagin icinde de dogru kosar.
    """
    wg = draft.workgroup_id
    # Her iki cagriya da ayni taslak veriliyor; her evren yalniz kendi turunu
    # alir, otekinde taslak yok sayilir (bkz. universe fonksiyonlarindaki suzgec).
    weeklies = _weekly_universe(db, wg, draft)
    exams = _exam_universe(db, wg, draft)
    cross = _cross_flag(db, wg)

    if draft.kind is DraftKind.EXAM:
        draft_rows = [x for x in exams if x["draft_id"] == draft.id]
        wanted = {("exam", r["id"]) for r in draft_rows}
        results = scan_exams(exams)
    else:
        draft_rows = [w for w in weeklies if w["draft_id"] == draft.id]
        wanted = {("weekly_entry", r["id"]) for r in draft_rows}
        results = scan_weekly(weeklies)
        results += scan_completeness(draft_rows)

    results += scan_cross(exams, weeklies, cross)
    results = [r for r in results if _involves(r, wanted)]

    return {
        "hard": [r for r in results if r["severity"] == "HARD"],
        "warnings": [r for r in results if r["severity"] == "WARNING"],
    }


# ==================================================================
# Seam: sinavlar
# ==================================================================

def check_exams_save(
    db: Session, exam: Exam, draft: ScheduleDraft | None = None
) -> list[dict]:
    """Tek sinavin kayit ani kontrolu. Engellemez, bilgilendirir (K-03).

    `draft` verilirse kontrol o taslagin evreninde yapilir (K-60): taslak
    icindeki duzenleme, kendi cohort'unun yayindaki haline degil taslaktaki
    haline karsi test edilir (`check_weekly_save`'in simetrigi).
    """
    wg = _wg_of_exam(exam)
    exams = _exam_universe(db, wg, draft)
    weeklies = _weekly_universe(db, wg, draft)

    results = scan_exams(exams)
    results += scan_cross(exams, weeklies, _cross_flag(db, wg))

    return [r for r in results if _involves(r, {("exam", exam.id)})]


# ==================================================================
# Seam: tam tarama (kontrat §9 + §10 sayaclari)
# ==================================================================

def scan_workgroup(db: Session, workgroup_id: int) -> dict[str, list[dict]]:
    """Workgroup'un YAYINDAKI programini tarar; aday filtresi YOK, her sey raporlanir.

    K-59: evren yalniz yayindir (`draft_id IS NULL`). Taslaklar ozeldir ve
    kimseyi etkilemez; rapora karisirlarsa herkes birbirinin denemesini
    "cakisma" diye gorurdu. Taslagin kendi tablosu `scan_draft` ile alinir.

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
