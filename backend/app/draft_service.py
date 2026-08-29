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

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload

from app.cohort import cohort_course_filter
from app.models import (
    Classroom, Course, CourseSection, Department, DraftStatus, ScheduleDraft,
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


def draft_row_count(db: Session, draft: ScheduleDraft) -> int:
    """`_to_out`'un sayaci. Sinav servisindeki esiyle ayni ada sahip ki router
    tek bir dagiticiyla iki kolu da cagirabilsin (K-60)."""
    return (
        db.query(WeeklyScheduleEntry)
        .filter(WeeklyScheduleEntry.draft_id == draft.id)
        .count()
    )


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
        # K-60: fark listesi artik iki sekil tasiyabiliyor (haftalik yerlesim /
        # sinav). Istemci hangisine baktigini bu ayirt edici alandan bilir.
        "entity": "weekly",
        "section_id": e.section_id,
        "course_code": course.code,
        "course_name": course.name,
        "section_no": e.section.section_no,
        "session_type": e.session_type,
        "is_shared": _is_shared(course),
        "affected_departments": _affected_departments(draft, course),
    }


Change = tuple[str, WeeklyScheduleEntry | None, WeeklyScheduleEntry | None]
#          kind          yayindaki satir          taslaktaki satir


def pair_changes(db: Session, draft: ScheduleDraft) -> list[Change]:
    """Taslak ile O ANKI yayini eslestirir. TEK hesap noktasi.

    Hem `compute_diff` (onaylayicinin GORDUGU) hem `apply_draft` (onayin
    UYGULADIGI) buradan beslenir. Ayri hesaplasalardi ekranda bir sey gorunup
    baska bir sey yayina gecebilirdi — bu, onay adiminin butun anlamini
    bosa cikarirdi.

    Eslestirme `(sube, oturum tipi)` grubu icinde yapilir; grup icinde AYNI
    yerlesime sahip satirlar birebir eslesip elenir. Geriye kalanlar:
      - iki tarafta da artan varsa -> MOVED (sirali eslestirme)
      - yalniz yayinda artan -> REMOVED
      - yalniz taslakta artan -> ADDED

    Neden "grup icinde": bir subenin ayni tipte birden cok oturumu olabilir
    (2 saatlik teori, iki ayri gunde). Tek anahtarla eslestirmek bunlari
    birbirine karistirirdi.

    Kullanici "Temizle" deyip programi bastan dizse bile hesap dogru calisir:
    ayni yere geri koyduklari eslesip elenir. Fark "nasil yapildigini" degil
    "sonucun neresi farkli"yi anlatir.
    """
    def grupla(entries):
        g: dict[tuple, list[WeeklyScheduleEntry]] = {}
        for e in entries:
            g.setdefault((e.section_id, e.session_type), []).append(e)
        return g

    yayin = grupla(published_entries(db, draft))
    taslak = grupla(draft_entries(db, draft))

    degisiklikler: list[Change] = []
    for key in sorted(set(yayin) | set(taslak), key=lambda k: (k[0], str(k[1]))):
        kalan_taslak = list(taslak.get(key, []))
        kalan_yayin = []
        for p in yayin.get(key, []):
            esi = next((d for d in kalan_taslak if _placement(d) == _placement(p)), None)
            if esi is not None:
                kalan_taslak.remove(esi)      # degismemis: farka girmez
            else:
                kalan_yayin.append(p)

        def siralama(e):
            return (e.day_of_week, e.start_slot)

        kalan_yayin.sort(key=siralama)
        kalan_taslak.sort(key=siralama)

        # Iki tarafta da artan varsa TASINMA olarak eslestir (okunakli olsun);
        # tek tarafta kalanlar ekleme/kaldirma.
        for p, d in zip(kalan_yayin, kalan_taslak):
            degisiklikler.append(("MOVED", p, d))
        for p in kalan_yayin[len(kalan_taslak):]:
            degisiklikler.append(("REMOVED", p, None))
        for d in kalan_taslak[len(kalan_yayin):]:
            degisiklikler.append(("ADDED", None, d))

    return degisiklikler


def compute_diff(db: Session, draft: ScheduleDraft) -> list[dict]:
    """Farkin gosterime hazir hali (kontrat sekli)."""
    fark = []
    for kind, onceki, sonraki in pair_changes(db, draft):
        temsil = sonraki if sonraki is not None else onceki
        fark.append({
            **_describe(draft, temsil),
            "kind": kind,
            "before": _placement_out(onceki) if onceki is not None else None,
            "after": _placement_out(sonraki) if sonraki is not None else None,
        })
    return fark


# ==================================================================
# Onay: farki yayina uygula
# ==================================================================

_GUN = {1: "Pzt", 2: "Sal", 3: "Çar", 4: "Per", 5: "Cum"}


def _yer_metni(p: dict | None) -> str:
    if p is None:
        return "—"
    return f"{_GUN[p['day_of_week']]} {p['start_slot']}"


def build_applied_summary(fark: list[dict]) -> str:
    """Onay aninda DONDURULAN insan-okur ozet (K-36 deseni).

    Taslagin satirlari onaydan sonra silindigi ve yayin yoluna devam ettigi
    icin fark geriye donuk yeniden hesaplanamaz. Degisiklik akisi ve gecmis
    kaydi bu metni okur; kayit kendi kendine yetsin diye burada saklanir.
    """
    sayac = {"MOVED": 0, "ADDED": 0, "REMOVED": 0}
    for item in fark:
        sayac[item["kind"]] += 1
    basliklar = []
    if sayac["MOVED"]:
        basliklar.append(f"{sayac['MOVED']} taşındı")
    if sayac["ADDED"]:
        basliklar.append(f"{sayac['ADDED']} eklendi")
    if sayac["REMOVED"]:
        basliklar.append(f"{sayac['REMOVED']} kaldırıldı")

    ayrinti = [
        f"{i['course_code']} Ş{i['section_no']} "
        f"{_yer_metni(i['before'])} → {_yer_metni(i['after'])}"
        for i in fark[:10]
    ]
    if len(fark) > 10:
        ayrinti.append(f"(+{len(fark) - 10} değişiklik daha)")
    return ", ".join(basliklar) + " · " + "; ".join(ayrinti)


def apply_draft(db: Session, draft: ScheduleDraft) -> list[dict]:
    """Taslagin FARKINI o anki yayina uygular ve uygulanan farki doner (K-59).

    Taslagin TAMAMI yayinin yerine GECMEZ. Aradaki fark su senaryoda gorunur:
    iki kisi ayni cohorttan taslak actiysa ve biri onaylandiysa, otekinin
    onayi yalniz KENDI degisikliklerini tasir; oteki kisinin dokunmadigi
    satirlar yerinde kalir.

    Satir KIMLIGI korunur: tasima, yayindaki satirin yerini gunceller — silip
    yeniden yaratmaz. Boylece denetim izi bir dersin gecmisini takip edebilir
    ve o satira bakan baska kayitlar kopmaz.

    `created_by`: eklenen satir, onaylayanin degil TASLAK SAHIBININ adina
    yazilir — yerlesimi yapan odur, onaylayan yalnizca izin vermistir.
    """
    fark = compute_diff(db, draft)          # once GOSTERIM (ozet + akis icin)
    for kind, onceki, sonraki in pair_changes(db, draft):
        if kind == "MOVED":
            for f in _PLACEMENT_FIELDS:
                setattr(onceki, f, getattr(sonraki, f))
        elif kind == "REMOVED":
            db.delete(onceki)
        elif kind == "ADDED":
            db.add(WeeklyScheduleEntry(
                draft_id=None,                       # NULL = yayinda
                section_id=sonraki.section_id,
                session_type=sonraki.session_type,
                created_by=draft.created_by,
                **{f: getattr(sonraki, f) for f in _PLACEMENT_FIELDS},
            ))

    # K-80: taslagin satirlari SILINMEZ — onaylanan taslagin ONAYLANDIGI HALI
    # goruntulenebilsin diye yerinde birakilir. K-59'da silinmelerinin gerekcesi
    # "duzenlenebilir gorunen donmus bir kopya yaniltici olur" idi; artik Yayin
    # Merkezi bu kaydi bilerek SALT GORUNTU olarak gosteriyor, dolayisiyla
    # gerekce dustu ve yerini "onaylanan hal geriye donuk okunabilmeli" aldi.
    #
    # Guvenli olmasinin sebebi: sistemde "yayinda" HER YERDE `draft_id IS NULL`
    # demektir (kismi UNIQUE indeksler dahil), yani korunan satirlar hicbir
    # sorgunun evrenine sizmaz. Ayrica bu goruntu sonraki onaylardan ETKILENMEZ:
    # baska bir taslagin onayi yayin satirlarina yazar, `draft_id` dolu olan bu
    # kopyalara dokunmaz.
    db.flush()
    return fark


def publications_since_opened(db: Session, draft: ScheduleDraft) -> list[ScheduleDraft]:
    """Bu taslak ACILDIKTAN SONRA bu cohort'un programini degistiren onaylar.

    Neden gerekli: taslak, acildigi andaki yayinin kopyasidir ve o kopya
    ESKIYEBILIR. Sahibi dokunmadigi satirlar bile, arada baskasinin onayi
    gectiyse fark listesinde "geri alinacak degisiklik" olarak belirir. Fark
    zaten bunu satir satir gosterir; bu sayac onaylayiciya BAKMASI GEREKTIGINI
    soyleyen ust duzey isarettir ("taslak 8 Ağustos'ta açıldı, program o
    tarihten sonra 2 kez güncellendi").

    Iki yoldan etkilenme sayilir:
      - ayni cohort'un onaylanmis taslaklari,
      - baska bir cohort'un onayi ORTAK DERS uzerinden bu bolumu etkilediyse
        (`affected_departments`, K-48).

    K-60: `kind` de aranir. Bir sinav taslagi icin bayatlik olcusu, o cohort'un
    SINAV takviminde olan onaylardir; haftalik program onaylari sinav taslaginin
    kopyaladigi hicbir satiri degistirmez ve sayilirsa yanlis alarm uretir.
    Bu fonksiyon kind-agnostik durur (iki kol da cagirir), suzgec taslagin
    kendi turunden gelir.
    """
    return (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.owner))
        .filter(
            ScheduleDraft.workgroup_id == draft.workgroup_id,
            ScheduleDraft.status == DraftStatus.APPROVED,
            ScheduleDraft.kind == draft.kind,
            ScheduleDraft.reviewed_at > draft.created_at,
            ScheduleDraft.id != draft.id,
            or_(
                and_(
                    ScheduleDraft.department_id == draft.department_id,
                    ScheduleDraft.year == draft.year,
                    ScheduleDraft.semester == draft.semester,
                ),
                ScheduleDraft.affected_departments.any(
                    Department.id == draft.department_id
                ),
            ),
        )
        .order_by(ScheduleDraft.reviewed_at.desc())
        .all()
    )


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
