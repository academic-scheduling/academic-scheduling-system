"""Taslak is mantigi (K-59) — kopyalama, temizleme, FARK hesabi.

Router'dan ayri durmasinin sebebi: `compute_diff` uc ayri yerde ayni cevabi
vermek zorunda (taslak editoru, onaya gonderme kapisi, onay ekrani) ve dorduncu
tuketicisi onay isleminin kendisi olacak (adim 4: farki yayina uygula).

**Fark CANLIDIR (K-59).** Taslagin acildigi andaki hali saklanmaz; karsilastirma
her zaman O ANKI yayina karsi yapilir. Bu yuzden burada taban anlik goruntusu,
surum sayaci veya `origin_entry_id` yoktur — ve "bayat taban" diye bir durum da
yoktur. Iki kisi ayni cohorttan taslak actiysa ve biri onaylandiysa, otekinin
farki artik yeni yayina gore hesaplanir; onaylayici neyin geri alinacagini
ekranda GORUR. Sorun uzerine yazmak degil, sessizce yazmakti.
"""

from sqlalchemy.orm import Session, selectinload

from app.cohort import cohort_course_filter
from app.models import (
    Classroom, Course, CourseSection, Department, ScheduleDraft,
    WeeklyScheduleEntry,
)


# ==================================================================
# Kapsam: taslagin cohort'una giren YAYIN satirlari
# ==================================================================

def _cohort_query(db: Session, draft: ScheduleDraft):
    """Taslagin cohort'una ait YAYIN satirlari (draft_id IS NULL).

    Kapsami `cohort_course_filter` cizer — cakisma evreninin disladigi dilimin
    AYNISI (conflict_service._weekly_universe). Ikisi ayrissa taslak, evrende
    olmayan bir satiri kopyalar ya da tersi olur.
    """
    return (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .filter(
            Department.workgroup_id == draft.workgroup_id,
            WeeklyScheduleEntry.draft_id.is_(None),
            CourseSection.active.is_(True),
            Course.active.is_(True),
            cohort_course_filter(draft.department_id, draft.year, draft.semester),
        )
    )


def _eager(q):
    """Fark ve gosterim icin gereken iliskileri tek seferde yukler."""
    return q.options(
        selectinload(WeeklyScheduleEntry.section)
        .selectinload(CourseSection.course)
        .selectinload(Course.extra_cohorts),
        selectinload(WeeklyScheduleEntry.section)
        .selectinload(CourseSection.course)
        .selectinload(Course.department),
        selectinload(WeeklyScheduleEntry.classroom)
        .selectinload(Classroom.building),
    )


def published_entries(db: Session, draft: ScheduleDraft) -> list[WeeklyScheduleEntry]:
    return _eager(_cohort_query(db, draft)).all()


def draft_entries(db: Session, draft: ScheduleDraft) -> list[WeeklyScheduleEntry]:
    return _eager(
        db.query(WeeklyScheduleEntry).filter(WeeklyScheduleEntry.draft_id == draft.id)
    ).all()


# ==================================================================
# Kopyalama ve temizleme
# ==================================================================

# Bir yerlesimin "nerede duruyor" kimligi. Fark hesabi bunu karsilastirir;
# id, created_at gibi kayit-ici alanlar DISARIDA — taslaktaki kopya yeni bir
# satirdir, id'si zaten farklidir ve bu bir degisiklik degildir.
_PLACEMENT_FIELDS = (
    "day_of_week", "start_slot", "slot_count", "classroom_id", "delivery_mode",
)


def copy_published_into_draft(db: Session, draft: ScheduleDraft) -> int:
    """Yayindaki cohort programini taslaga kopyalar. Kopyalanan satir sayisini doner.

    Taslak "o anki programin bir ornegi" olarak acilir (K-59); kullanici
    isterse "Temizle" ile sifirdan dizer.
    """
    kopyalanan = 0
    for e in _cohort_query(db, draft).all():
        db.add(WeeklyScheduleEntry(
            draft_id=draft.id,
            section_id=e.section_id,
            session_type=e.session_type,
            **{f: getattr(e, f) for f in _PLACEMENT_FIELDS},
        ))
        kopyalanan += 1
    db.flush()
    return kopyalanan


def _is_shared(course: Course) -> bool:
    """Ders baska bir cohort tarafindan da aliniyor mu? (K-48)

    Olcut `is_common` BAYRAGI degil, efektif cohort kumesinin genisligi: silme/
    tasima kararinin baskasini etkileyip etkilemedigini belirleyen sey budur.
    K-48 zaten "cakisma semantigi bayraktan DEGIL cohort kumesinden gelir" diyor;
    ayni olcut burada da gecerli.
    """
    return len(course.extra_cohorts) > 0


def clear_draft(db: Session, draft: ScheduleDraft, include_shared: bool) -> tuple[int, int]:
    """Taslagi bosaltir. (silinen, korunan) doner.

    K-59: varsayilan olarak ORTAK DERSLER KORUNUR. Aksi halde masum gorunen bir
    "Temizle" dugmesi, onaylandiginda uc bolumun programindan ders dusururdu —
    ortak dersin yerlesimi tek fiziksel satirdir ve onu alan herkes ayni satiri
    gorur. Silmek isteyen `include_shared` ile ACIKCA soyler.
    """
    silinen = korunan = 0
    for e in draft_entries(db, draft):
        if not include_shared and _is_shared(e.section.course):
            korunan += 1
            continue
        db.delete(e)
        silinen += 1
    db.flush()
    return silinen, korunan


# ==================================================================
# Fark
# ==================================================================

def _placement(e: WeeklyScheduleEntry) -> tuple:
    return tuple(getattr(e, f) for f in _PLACEMENT_FIELDS)


def _classroom_label(e: WeeklyScheduleEntry) -> str | None:
    if e.classroom is None:
        return None
    return f"{e.classroom.building.name} {e.classroom.room_code}"


def _placement_out(e: WeeklyScheduleEntry) -> dict:
    return {
        "day_of_week": e.day_of_week,
        "start_slot": e.start_slot,
        "slot_count": e.slot_count,
        "classroom_id": e.classroom_id,
        "classroom_label": _classroom_label(e),
        "delivery_mode": e.delivery_mode,
    }


def _affected_departments(draft: ScheduleDraft, course: Course) -> list[dict]:
    """Dersi alan, taslagin KENDI bolumu disindaki bolumler (K-48/K-59).

    Ortak ders tasindiginda/silindiginde gosterilecek uyarinin verisi:
    "Bu ders ortak. Konumu su bolumlerin programini etkileyecek."
    """
    hepsi = {course.department_id: course.department}
    for cc in course.extra_cohorts:
        hepsi.setdefault(cc.department_id, cc.department)
    return [
        {"id": dep_id, "name": dep.name}
        for dep_id, dep in hepsi.items()
        if dep_id != draft.department_id
    ]


def _describe(draft: ScheduleDraft, e: WeeklyScheduleEntry) -> dict:
    course = e.section.course
    return {
        "section_id": e.section_id,
        "course_code": course.code,
        "course_name": course.name,
        "section_no": e.section.section_no,
        "session_type": e.session_type,
        "is_shared": _is_shared(course),
        "affected_departments": _affected_departments(draft, course),
    }


def compute_diff(db: Session, draft: ScheduleDraft) -> list[dict]:
    """Taslak ile O ANKI yayin arasindaki fark.

    Eslestirme `(sube, oturum tipi)` grubu icinde yapilir; grup icinde AYNI
    yerlesime sahip satirlar birebir eslesip elenir. Geriye kalanlar:
      - iki tarafta da artan varsa -> TASINDI (sirali eslestirme)
      - yalniz yayinda artan -> KALDIRILDI
      - yalniz taslakta artan -> EKLENDI

    Neden "grup icinde": bir subenin ayni tipte birden cok oturumu olabilir
    (2 saatlik teori, iki ayri gunde). Tek anahtarla eslestirmek bunlari
    birbirine karistirirdi.

    Kullanici "Temizle" deyip programi bastan dizse bile bu hesap dogru
    calisir: ayni yere geri koyduklari eslesip elenir, gercekten degisenler
    kalir. Fark "nasil yapildigini" degil "sonucun neresi farkli"yi anlatir.
    """
    def grupla(entries):
        g: dict[tuple, list[WeeklyScheduleEntry]] = {}
        for e in entries:
            g.setdefault((e.section_id, e.session_type), []).append(e)
        return g

    yayin = grupla(published_entries(db, draft))
    taslak = grupla(draft_entries(db, draft))

    fark: list[dict] = []
    for key in sorted(set(yayin) | set(taslak), key=lambda k: (k[0], str(k[1]))):
        onceki = list(yayin.get(key, []))
        sonraki = list(taslak.get(key, []))

        # Ayni yerlesime sahip olanlari birebir esleyip ele
        kalan_taslak = list(sonraki)
        kalan_yayin = []
        for p in onceki:
            esi = next((d for d in kalan_taslak if _placement(d) == _placement(p)), None)
            if esi is not None:
                kalan_taslak.remove(esi)
            else:
                kalan_yayin.append(p)

        siralama = lambda e: (e.day_of_week, e.start_slot)   # noqa: E731
        kalan_yayin.sort(key=siralama)
        kalan_taslak.sort(key=siralama)

        # Iki tarafta da artan varsa TASINMA olarak eslestir (okunakli olsun);
        # artikligi tek tarafta kalanlar ekleme/kaldirma.
        for p, d in zip(kalan_yayin, kalan_taslak):
            fark.append({**_describe(draft, d), "kind": "MOVED",
                         "before": _placement_out(p), "after": _placement_out(d)})
        for p in kalan_yayin[len(kalan_taslak):]:
            fark.append({**_describe(draft, p), "kind": "REMOVED",
                         "before": _placement_out(p), "after": None})
        for d in kalan_taslak[len(kalan_yayin):]:
            fark.append({**_describe(draft, d), "kind": "ADDED",
                         "before": None, "after": _placement_out(d)})

    return fark


def diff_affected_department_ids(fark: list[dict], draft: ScheduleDraft) -> set[int]:
    """Farkin ETKILEDIGI, taslagin kendi bolumu disindaki bolumler.

    Onay aninda `draft_affected_departments`'a yazilir; degisiklik akisi bunu
    okur. Yalniz ortak ders iceren farklarda dolar.
    """
    return {
        dep["id"]
        for item in fark
        for dep in item["affected_departments"]
    }
