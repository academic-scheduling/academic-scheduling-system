"""Sinav taslagi is mantigi (K-60) — kopyalama, temizleme, FARK hesabi.

`draft_service`'in sinav ikizi. AYRI yazilmasinin gerekcesi K-60'ta: ortak bir
"entity + anahtar fonksiyonu + yerlesim fonksiyonu" soyutlamasi, haftaligin
grup-ici eslestirme mantigini sinava da tasirdi — oysa sinavda o mantigin
karsiligi YOK. Paylasilan sey hesap degil SEKIL: `Change` uclusu, fark kontrati
ve inceleme tablosu.

**Fark neden daha basit:** haftalikta anahtar `(sube, oturum tipi)` idi ve bir
grup icinde birden cok satir olabiliyordu (2 saatlik teori, iki ayri gunde);
bu yuzden grup ici birebir eleme + sirali eslestirme gerekiyordu. Sinavda
anahtar `(ders, tip, sira)` ve bu uclu veritabaninda ZATEN TEKIL
(`uq_exams_course_type_index`). Her anahtarda en fazla bir yayin + bir taslak
satiri olur; eslestirme tek karsilastirmaya iner.

**Fark CANLIDIR (K-59'daki gibi):** taslagin acildigi andaki hali saklanmaz,
karsilastirma her zaman O ANKI yayina karsi yapilir.
"""

from sqlalchemy.orm import Session, selectinload

from app.cohort import cohort_course_filter
from app.draft_service import _affected_departments, _is_shared
from app.models import (
    Classroom, Course, Department, Exam, ScheduleDraft,
)


# ==================================================================
# Kapsam: taslagin cohort'una giren YAYIN sinavlari
# ==================================================================

def _cohort_query(db: Session, draft: ScheduleDraft):
    """Taslagin cohort'una ait YAYIN sinavlari (draft_id IS NULL).

    Kapsami `cohort_course_filter` cizer — cakisma evreninin disladigi dilimin
    AYNISI (conflict_service._exam_universe). Ikisi ayrissa taslak, evrende
    olmayan bir sinavi kopyalar ya da tersi olur.

    Sinav ders duzeyinde olsa da (K-16) cohort'a dersin uzerinden baglanir;
    ortak dersin sinavi tuketen bolumun cohort'undan da gelir (K-48).
    """
    return (
        db.query(Exam)
        .join(Course).join(Department)
        .filter(
            Department.workgroup_id == draft.workgroup_id,
            Exam.draft_id.is_(None),
            Course.active.is_(True),
            cohort_course_filter(draft.department_id, draft.year, draft.semester),
        )
    )


def _eager(q):
    """Fark ve gosterim icin gereken iliskileri tek seferde yukler."""
    return q.options(
        selectinload(Exam.course).selectinload(Course.extra_cohorts),
        selectinload(Exam.course).selectinload(Course.department),
        selectinload(Exam.course).selectinload(Course.sections),
        selectinload(Exam.classrooms).selectinload(Classroom.building),
        selectinload(Exam.lecturer),
    )


def published_exams(db: Session, draft: ScheduleDraft) -> list[Exam]:
    return _eager(_cohort_query(db, draft)).all()


def draft_exams(db: Session, draft: ScheduleDraft) -> list[Exam]:
    return _eager(db.query(Exam).filter(Exam.draft_id == draft.id)).all()


def draft_row_count(db: Session, draft: ScheduleDraft) -> int:
    """`_to_out`'un sayaci. Haftalik servisteki esiyle ayni ada sahip ki
    router tek bir dagiticiyla iki kolu da cagirabilsin."""
    return db.query(Exam).filter(Exam.draft_id == draft.id).count()


# ==================================================================
# Kopyalama ve temizleme
# ==================================================================

# Bir sinavin "ne zaman, nerede, kiminle" kimligi. Anahtar alanlar (course_id,
# exam_type, exam_index) DISARIDA: onlar sinavin KIMLIGI, degisiklik degil.
#
# `notes` bilerek ICERIDE: ogrenciye basilan bir icerik ve yalniz notu
# degistirilen bir sinav da onaydan gecmesi gereken bir degisikliktir. Disarida
# biraksaydik not degisikligi ne farkta gorunur ne de onayla yayina gecerdi —
# kullanici duzenlemesinin sessizce kayboldugunu gorurdu.
_PLACEMENT_FIELDS = (
    "exam_date", "start_time", "duration_minutes", "lecturer_id", "notes",
)
_KEY_FIELDS = ("course_id", "exam_type", "exam_index")


def copy_published_into_draft(db: Session, draft: ScheduleDraft) -> int:
    """Yayindaki cohort sinav takvimini taslaga kopyalar. Kopya sayisini doner.

    Derslikler M2M oldugu icin ayrica kopyalanir (K-17: derslik listesi sinavin
    yerlesiminin parcasi). Kopyanin gecebilmesi, K-60'ta kosulsuz UNIQUE'in iki
    kismi indekse bolunmesi sayesindedir.
    """
    kopyalanan = 0
    for x in _eager(_cohort_query(db, draft)).all():
        kopya = Exam(
            draft_id=draft.id,
            **{f: getattr(x, f) for f in _KEY_FIELDS},
            **{f: getattr(x, f) for f in _PLACEMENT_FIELDS},
        )
        kopya.classrooms = list(x.classrooms)
        db.add(kopya)
        kopyalanan += 1
    db.flush()
    return kopyalanan


def clear_draft(db: Session, draft: ScheduleDraft, include_shared: bool) -> tuple[int, int]:
    """Taslagi bosaltir. (silinen, korunan) doner.

    Haftaliktaki gerekcenin aynisi (K-59): varsayilan olarak ORTAK DERSLERIN
    sinavlari KORUNUR. Ortak dersin sinavi tek fiziksel kayittir; masum gorunen
    bir "Temizle", onaylandiginda birkac bolumun sinav takviminden sinav
    dusururdu. Silmek isteyen `include_shared` ile ACIKCA soyler.
    """
    silinen = korunan = 0
    for x in draft_exams(db, draft):
        if not include_shared and _is_shared(x.course):
            korunan += 1
            continue
        db.delete(x)
        silinen += 1
    db.flush()
    return silinen, korunan


# ==================================================================
# Fark
# ==================================================================

def _key(x: Exam) -> tuple:
    return (x.course_id, x.exam_type, x.exam_index)


def _classroom_ids(x: Exam) -> frozenset:
    """Derslik karsilastirmasi KUMEdir: M2M'de sira anlamsiz (K-17)."""
    return frozenset(r.id for r in x.classrooms)


def _placement(x: Exam) -> tuple:
    return tuple(getattr(x, f) for f in _PLACEMENT_FIELDS) + (_classroom_ids(x),)


def _classroom_label(x: Exam) -> str | None:
    if not x.classrooms:
        return None
    return ", ".join(
        f"{r.building.name} {r.room_code}"
        for r in sorted(x.classrooms, key=lambda r: (r.building.name, r.room_code))
    )


def _placement_out(x: Exam) -> dict:
    return {
        "exam_date": x.exam_date,
        "start_time": x.start_time,
        "duration_minutes": x.duration_minutes,
        "lecturer_id": x.lecturer_id,
        "lecturer_name": x.lecturer.full_name if x.lecturer else None,
        "classroom_ids": sorted(r.id for r in x.classrooms),
        "classroom_label": _classroom_label(x),
        "notes": x.notes,
    }


def _describe(draft: ScheduleDraft, x: Exam) -> dict:
    course = x.course
    return {
        # Kontratta ayirt edici alan: fark listesi haftalik ve sinav satirlarini
        # ayni sekille tasiyamaz, istemci hangisine baktigini bundan bilir.
        "entity": "exam",
        "course_id": x.course_id,
        "course_code": course.code,
        "course_name": course.name,
        "exam_type": x.exam_type,
        "exam_index": x.exam_index,
        "is_shared": _is_shared(course),
        "affected_departments": _affected_departments(draft, course),
    }


Change = tuple[str, Exam | None, Exam | None]
#          kind      yayindaki sinav   taslaktaki sinav


def pair_changes(db: Session, draft: ScheduleDraft) -> list[Change]:
    """Taslak ile O ANKI yayini eslestirir. TEK hesap noktasi.

    Hem `compute_diff` (onaylayicinin GORDUGU) hem `apply_draft` (onayin
    UYGULADIGI) buradan beslenir. Ayri hesaplasalardi ekranda bir sey gorunup
    baska bir sey yayina gecebilirdi — onay adiminin butun anlami bu.

    Eslestirme `(ders, tip, sira)` anahtariyla yapilir. Bu uclu veritabaninda
    tekil oldugu icin her anahtarda en fazla bir yayin + bir taslak satiri
    bulunur; haftaliktaki grup-ici eleme ve sirali `zip` mantigi GEREKMEZ:
      - iki tarafta da var, yerlesim ayni  -> degisiklik yok, farka girmez
      - iki tarafta da var, yerlesim farkli -> MOVED
      - yalniz yayinda -> REMOVED
      - yalniz taslakta -> ADDED
    """
    yayin = {_key(x): x for x in published_exams(db, draft)}
    taslak = {_key(x): x for x in draft_exams(db, draft)}

    degisiklikler: list[Change] = []
    for key in sorted(set(yayin) | set(taslak), key=lambda k: (k[0], str(k[1]), k[2])):
        p, d = yayin.get(key), taslak.get(key)
        if p is not None and d is not None:
            if _placement(p) != _placement(d):
                degisiklikler.append(("MOVED", p, d))
        elif p is not None:
            degisiklikler.append(("REMOVED", p, None))
        else:
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

_AY = {1: "Oca", 2: "Şub", 3: "Mar", 4: "Nis", 5: "May", 6: "Haz",
       7: "Tem", 8: "Ağu", 9: "Eyl", 10: "Eki", 11: "Kas", 12: "Ara"}

_TUR = {"MIDTERM": "Vize", "FINAL": "Final", "MAKEUP": "Büt"}


def _yer_metni(p: dict | None) -> str:
    if p is None:
        return "—"
    t = p["exam_date"]
    return f"{t.day} {_AY[t.month]} {p['start_time'].strftime('%H:%M')}"


def _sinav_adi(item: dict) -> str:
    tur = _TUR.get(str(item["exam_type"].value if hasattr(item["exam_type"], "value")
                       else item["exam_type"]), "Sınav")
    # Vizede kacincisi anlamli; final/but'te sira her zaman 1 (K-46).
    return f"{item['course_code']} {tur}" + (
        f" {item['exam_index']}" if tur == "Vize" else ""
    )


def build_applied_summary(fark: list[dict]) -> str:
    """Onay aninda DONDURULAN insan-okur ozet (K-36 deseni).

    Taslagin satirlari onaydan sonra silindigi icin fark geriye donuk yeniden
    hesaplanamaz; degisiklik akisi ve gecmis kaydi bu metni okur.
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
        f"{_sinav_adi(i)} {_yer_metni(i['before'])} → {_yer_metni(i['after'])}"
        for i in fark[:10]
    ]
    if len(fark) > 10:
        ayrinti.append(f"(+{len(fark) - 10} değişiklik daha)")
    return ", ".join(basliklar) + " · " + "; ".join(ayrinti)


def apply_draft(db: Session, draft: ScheduleDraft) -> list[dict]:
    """Taslagin FARKINI o anki yayina uygular ve uygulanan farki doner (K-60).

    Haftaliktaki gerekcelerin aynisi: taslagin TAMAMI yayinin yerine gecmez,
    satir KIMLIGI korunur (tasima, yayindaki satirin tarihini gunceller —
    silip yeniden yaratmaz, denetim izi kopmaz) ve eklenen satir onaylayanin
    degil TASLAK SAHIBININ adina yazilir.

    **Silme once, ekleme sonra:** yayindaki tekillik kismi bir UNIQUE indekstir
    (`uq_exams_course_type_index WHERE draft_id IS NULL`). Ekleme once
    yazilsaydi, ayni anahtardan bir satirin silinip digerinin eklendigi bir
    farkta SQLAlchemy'nin INSERT/DELETE sirasi indeksi ihlal edebilirdi.
    Bugunku eslestirme boyle bir cifti uretemez (anahtar iki tarafta da tekil),
    ama sira ucuz bir garanti.
    """
    fark = compute_diff(db, draft)          # once GOSTERIM (ozet + akis icin)
    degisiklikler = pair_changes(db, draft)

    for kind, onceki, _ in degisiklikler:
        if kind == "REMOVED":
            db.delete(onceki)
    db.flush()

    for kind, onceki, sonraki in degisiklikler:
        if kind == "MOVED":
            for f in _PLACEMENT_FIELDS:
                setattr(onceki, f, getattr(sonraki, f))
            onceki.classrooms = list(sonraki.classrooms)
        elif kind == "ADDED":
            yeni = Exam(
                draft_id=None,                       # NULL = yayinda
                created_by=draft.created_by,
                **{f: getattr(sonraki, f) for f in _KEY_FIELDS},
                **{f: getattr(sonraki, f) for f in _PLACEMENT_FIELDS},
            )
            yeni.classrooms = list(sonraki.classrooms)
            db.add(yeni)

    # Taslagin kopyalari artik gereksiz: onaylanan taslak GECMIS kaydidir.
    for x in draft_exams(db, draft):
        db.delete(x)

    db.flush()
    return fark
