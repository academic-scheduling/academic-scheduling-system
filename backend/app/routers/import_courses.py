"""Bologna ders import endpoint'leri (WP7).

Iki adimli akis:

  POST /import/courses/preview {department_id, url}
      Bologna bilgi paketinden dersleri ceker + parse eder, her derse bolumde
      ZATEN kayitli mi (exists) bayragi ekler ve listeyi doner. HICBIR SEY
      YAZMAZ — kullanici hangi dersi/ne halde ekleyecegine bu listeden karar verir.

  POST /import/courses {department_id, courses:[...]}
      Istek govdesinde gelen (kullanici tarafindan secilmis/duzenlenmis) dersleri
      SECILI bolume ekler. Zaten kayitli (bolum+yil+donem+kod) ders sunucu
      tarafinda yine ATLANIR (cift-tiklama / es-zamanli import savunmasi).
      Yalniz DERS acilir; hoca/sube ACILMAZ (K-14).

Yetki courses.py ile ayni: require_course_manager + _ensure_department_access
(bolum bizim workgroup mu + alt hesabin uyeligi var mi).
"""

import re

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import log_action
from app.bologna_import import (
    extract_cursunit, fetch_bologna_html, fetch_details_bulk,
    parse_courses, parse_hidden_fields,
)
from app.deps import get_db, require_course_manager
from app.models import (
    Course, CourseCohort, CourseSection, Department, Lecturer, SemesterType, User,
)
from app.routers.courses import (
    _covered_cohorts, _ensure_department_access, _find_common_course,
)

# K-64: kaynakta kontenjan yok; şube beklenen öğrenci varsayılanı.
DEFAULT_EXPECTED_STUDENTS = 80

router = APIRouter(tags=["import"])


# --------------------------------------------------------------------------
# Ortak ders sekli
# --------------------------------------------------------------------------

class CourseFields(BaseModel):
    """Bir dersin import edilebilir alanlari (parse ciktisi = commit girisi)."""
    code: str
    name: str
    year: int
    semester: str          # "FALL" | "SPRING"
    hours_theory: int = 0
    hours_practice: int = 0
    hours_lab: int = 0
    ects: int | None = None               # K-55: AKTS (Bologna'dan; opsiyonel)
    midterm_count: int | None = None      # K-64: Bologna "Ara Sınav" sayısı (1-3)
    is_elective: bool = False
    is_common: bool = False               # K-48: içe aktarırken ortak işaretlenebilir

    @field_validator("midterm_count")
    @classmethod
    def _valid_midterm(cls, v: int | None) -> int | None:
        # K-46: 1-3 aralığı. Bologna beklenmedik bir değer verirse kırp/None.
        if v is None:
            return None
        return max(1, min(3, v))

    @field_validator("semester")
    @classmethod
    def _valid_semester(cls, v: str) -> str:
        try:
            return SemesterType(v).value
        except ValueError:
            raise ValueError(f"Gecersiz donem: {v!r}")

    @field_validator("year")
    @classmethod
    def _valid_year(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Yil 1 veya daha buyuk olmali")
        return v

    @field_validator("hours_theory", "hours_practice", "hours_lab")
    @classmethod
    def _non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("Ders saati negatif olamaz")
        return v

    @field_validator("code", "name")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Kod ve ad bos olamaz")
        return v.strip()


# --------------------------------------------------------------------------
# Faz 1 — Onizleme (yazma yok)
# --------------------------------------------------------------------------

class PreviewRequest(BaseModel):
    department_id: int
    url: str


class InstructorMatch(BaseModel):
    """K-64: detaydaki bir "Dersi Verenler" satırı + mevcut hocayla eşleşmesi."""
    raw: str                    # ekranda gösterilecek ham metin ("Dr.Öğr.Üyesi ...")
    name: str                   # unvansız ad
    title: str | None           # kanonik unvan (varsa)
    lecturer_id: int | None     # eşleşen mevcut hoca; None ise elle eşlenecek


class PreviewCourse(CourseFields):
    exists: bool                # bu bolumde (yil+donem+kod) zaten kayitli mi?
    has_sections: bool          # K-64: mevcut ders zaten şubeli mi (→ şube önerilmez)
    instructors: list[InstructorMatch]   # K-64: Bologna'daki hoca(lar) + eşleşme


class PreviewResult(BaseModel):
    courses: list[PreviewCourse]


_CODE_PREFIX = re.compile(r"[A-Za-z]+")


def _looks_common(code: str, dep_code: str) -> bool:
    """Ders kodunun HARF öneki bölüm kodundan farklıysa ortak (servis) ders say.

    Bologna sayfasındaki ders kodları genelde bölüm koduyla başlar (CENG bölümü →
    "CENG 1004"); bölüm koduyla başlamayanlar (Matematik, Fizik, Atatürk İlk.,
    "ATB 3801"/"CHEM 1853") başka bölümlerin de aldığı ortak derslerdir (K-48).
    Baştaki harf dizisini karşılaştırırız (startswith DEĞİL) — yoksa "CE" bölümü
    "CENG..." dersini kendi dersi sanardı. Bu yalnız ÖNERİ: kullanıcı önizlemede
    'Ortak ders' anahtarıyla değiştirebilir.
    """
    m = _CODE_PREFIX.match(code.strip())
    prefix = m.group(0).upper() if m else ""
    return prefix != dep_code.strip().upper()


@router.post("/import/courses/preview", response_model=PreviewResult)
def preview_courses(
    payload: PreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    dep = _ensure_department_access(db, user, payload.department_id)

    try:
        cur_sunit = extract_cursunit(payload.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        html = fetch_bologna_html(cur_sunit)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Bologna sayfası çekilemedi")

    parsed = parse_courses(html)
    if not parsed:
        raise HTTPException(status_code=422,
                            detail="Sayfada ders bulunamadı — URL doğru mu?")

    # K-64: her dersin detay sayfasından hoca + vize sayısını PARALEL çek. Gizli
    # alanlar (viewstate) aynı GET'ten; postback'ler bunları yeniden kullanır.
    hidden = parse_hidden_fields(html)
    targets = {pc.event_target: pc.event_target for pc in parsed if pc.event_target}
    details = fetch_details_bulk(cur_sunit, targets, hidden)

    # K-64: eşleştirme haritası — normalized_name → hoca. Kolon workgroup içinde
    # benzersiz (uq_lecturers_workgroup_normname), yani 1:1. Yalnız aktif hocalar.
    lecturer_by_norm = {
        lec.normalized_name: lec
        for lec in db.query(Lecturer).filter(
            Lecturer.workgroup_id == user.workgroup_id, Lecturer.active.is_(True)
        ).all()
    }

    # Mevcut dersler + şube sayısı: 'exists' ve 'has_sections' için tek geçiş.
    own_courses = db.query(Course).filter(Course.department_id == dep.id).all()
    own_by_key = {(c.year, c.semester.value, c.code): c for c in own_courses}
    sec_count = dict(
        db.query(CourseSection.course_id, func.count(CourseSection.id))
        .join(Course, Course.id == CourseSection.course_id)
        .filter(Course.department_id == dep.id)
        .group_by(CourseSection.course_id).all()
    )
    # K-54: bu bölümün BAŞKA bir bölümce sahiplenen ortak dersleri TÜKETMESİ de
    # "zaten var" sayılır. Yoksa CENG'in açtığı ENG 1803, EEE önizlemesinde yine
    # "yeni" görünür (ve commit onu sessizce atlayınca kullanıcı şaşırır).
    consumed_common: dict[tuple[int, str], Course] = {}
    for common in (
        db.query(Course).join(Department)
        .filter(Department.workgroup_id == user.workgroup_id, Course.is_common.is_(True))
        .all()
    ):
        for (dept_id, year, sem) in _covered_cohorts(common):
            if dept_id == dep.id:
                consumed_common[(year, common.code)] = common

    def _existing_course(pc) -> Course | None:
        """Bu dersin karşılığı olan mevcut Course (kendi bölüm ya da ortak)."""
        own = own_by_key.get((pc.year, pc.semester, pc.code))
        if own is not None:
            return own
        return consumed_common.get((pc.year, pc.code))

    def _has_sections(course: Course | None) -> bool:
        # Kendi bölümün dersi için sayaç hazır; ortak dersin şubeleri course.sections'ta.
        if course is None:
            return False
        if course.id in sec_count:
            return sec_count[course.id] > 0
        return any(course.sections)

    rows: list[PreviewCourse] = []
    for pc in parsed:
        existing_course = _existing_course(pc)
        detail = details.get(pc.event_target)
        instructors = [
            InstructorMatch(
                raw=ins.raw, name=ins.name, title=ins.title,
                lecturer_id=(m.id if (m := lecturer_by_norm.get(ins.normalized)) else None),
            )
            for ins in (detail.instructors if detail else [])
        ]
        rows.append(PreviewCourse(
            code=pc.code, name=pc.name, year=pc.year, semester=pc.semester,
            hours_theory=pc.hours_theory, hours_practice=pc.hours_practice,
            hours_lab=pc.hours_lab, ects=pc.ects, is_elective=pc.is_elective,
            midterm_count=(detail.midterm_count if detail else None),
            # K-48: bölüm koduyla başlamayan dersleri ortak olarak ÖN-İŞARETLE.
            is_common=_looks_common(pc.code, dep.code),
            exists=existing_course is not None,
            has_sections=_has_sections(existing_course),
            instructors=instructors,
        ))
    return PreviewResult(courses=rows)


# --------------------------------------------------------------------------
# Faz 2 — Isleme (secilenleri ekle)
# --------------------------------------------------------------------------

class SectionSpec(BaseModel):
    """K-64: bir derse açılacak tek şube — hocası + beklenen öğrenci."""
    lecturer_id: int
    expected_students: int = DEFAULT_EXPECTED_STUDENTS   # kaynakta yok → 80

    @field_validator("expected_students")
    @classmethod
    def _positive(cls, v: int) -> int:
        if v <= 0:                             # CHECK: expected_students > 0 (K-07)
            raise ValueError("Beklenen öğrenci sayısı pozitif olmalı")
        return v


class CommitCourse(CourseFields):
    """Aktarılacak ders + (K-64) o derse açılacak şubeler (eşleşen/elle-eşlenen)."""
    sections: list[SectionSpec] = []


class CommitRequest(BaseModel):
    department_id: int
    courses: list[CommitCourse]


class CourseImportResult(BaseModel):
    """Ozet: kac yeni ders acildi, kac ortak derse cohort eklendi (merged), kac
    tanesi zaten vardi (skipped), kac SUBE acildi (K-64)."""
    total_parsed: int
    added_count: int
    merged_count: int                     # K-54: mevcut ortak derse cohort eklendi
    skipped_count: int
    sections_created: int                 # K-64: açılan toplam şube
    added: list[CourseFields]
    merged: list[CourseFields]
    skipped: list[CourseFields]


def _apply_midterm(db: Session, user: User, course: Course, midterm: int | None) -> None:
    """K-64: mevcut derse Bologna'daki vize sayısını uygula (değiştiyse).

    Yeni ders zaten constructor'da doğru değerle açılır; bu yalnız MEVCUT ders
    için — 336 ders varsayılan 1 ile aktarılmıştı, Bologna değeri yetkilidir.
    """
    if midterm is None or course.midterm_count == midterm:
        return
    course.midterm_count = midterm
    db.flush()
    log_action(db, user, "UPDATE", "course", course.id, course,
               f"Vize sayısı Bologna'dan güncellendi: {midterm}")


def _create_sections(
    db: Session, user: User, course: Course, specs: list[SectionSpec]
) -> int:
    """K-64: derse şubeleri açar (hoca başı bir şube). Kaç şube açıldığını döner.

    Ders ZATEN şubeliyse dokunmaz (mükerrer önleme — kapsam kararı: yalnız
    şubesiz derse şube eklenir). section_no 1..N sırayla verilir. Hoca FK'sı
    workgroup içi doğrulanır (çapraz-FK izolasyonu; _validate_section_refs ile
    aynı kural).
    """
    if not specs or any(course.sections):
        return 0
    created = 0
    for i, spec in enumerate(specs, start=1):
        lec = db.get(Lecturer, spec.lecturer_id)
        if lec is None or lec.workgroup_id != user.workgroup_id:
            raise HTTPException(status_code=400, detail="Geçersiz hoca seçimi")
        sec = CourseSection(
            course_id=course.id, section_no=i, lecturer_id=spec.lecturer_id,
            expected_students=spec.expected_students,
        )
        db.add(sec)
        db.flush()
        log_action(db, user, "CREATE", "course_section", sec.id, sec)
        created += 1
    return created


@router.post("/import/courses", response_model=CourseImportResult)
def import_courses(
    payload: CommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    dep = _ensure_department_access(db, user, payload.department_id)

    # Bu bölümdeki mevcut dersler (kendi kayıtları): 'zaten var' savunması + K-64
    # mevcut şubesiz derse şube ekleme için hedef ders. İstek içinde açılan yeni
    # ders de buraya işlenir (aynı istekte ikinci kez gelirse tekrar açılmasın).
    own_by_key: dict[tuple[int, str, str], Course] = {
        (c.year, c.semester.value, c.code): c
        for c in db.query(Course).filter(Course.department_id == dep.id).all()
    }

    added: list[CourseFields] = []
    merged: list[CourseFields] = []
    skipped: list[CourseFields] = []
    sections_created = 0
    for pc in payload.courses:
        sem = SemesterType(pc.semester)
        target: Course | None = None

        # K-54: ortak ders BIRLESTIRME — create_course ile AYNI mantik (tek kaynak
        # `_find_common_course`/`_covered_cohorts`). Ayni workgroup'ta ayni kodlu
        # bir ortak ders varsa YENI KAYIT ACMA; bu (bolum, yil, donem)'i onun ek
        # cohort'u yap. Şube yine de o ortak derse eklenir (aşağıda).
        if pc.is_common:
            common = _find_common_course(db, user.workgroup_id, pc.code)
            if common:
                cohort_key = (dep.id, pc.year, sem)
                if cohort_key in _covered_cohorts(common):
                    skipped.append(pc)          # bu bolum zaten bu ortak dersi aliyor
                else:
                    common.extra_cohorts.append(CourseCohort(
                        department_id=dep.id, year=pc.year, semester=sem))
                    db.flush()
                    log_action(db, user, "UPDATE", "course", common.id, common,
                               "Ortak ders: import ile yeni cohort eklendi")
                    merged.append(pc)
                target = common
            # Bu kodda ortak ders henuz yoksa: asagida YENI ortak ders olarak acilir.

        if target is None:
            key = (pc.year, pc.semester, pc.code)
            own = own_by_key.get(key)
            if own is not None:
                # K-64: zaten kayıtlı ders — kayıt açılmaz ama şubesizse şube eklenir.
                skipped.append(pc)
                target = own
            else:
                course = Course(
                    department_id=dep.id,
                    year=pc.year,
                    semester=sem,
                    code=pc.code,
                    name=pc.name,
                    is_elective=pc.is_elective,
                    is_common=pc.is_common,           # K-48
                    ects=pc.ects,                     # K-55
                    midterm_count=pc.midterm_count or 1,   # K-64/K-46 (yoksa varsayılan 1)
                    hours_theory=pc.hours_theory,
                    hours_practice=pc.hours_practice,
                    hours_lab=pc.hours_lab,
                )
                db.add(course)
                db.flush()
                log_action(db, user, "CREATE", "course", course.id, course)
                added.append(pc)
                own_by_key[key] = course          # aynı istekte tekrar gelmesin
                target = course

        # K-64: hedef ders belli — (mevcutsa) vize sayısını güncelle ve şubeleri aç.
        _apply_midterm(db, user, target, pc.midterm_count)
        sections_created += _create_sections(db, user, target, pc.sections)

    db.commit()
    return CourseImportResult(
        total_parsed=len(payload.courses),
        added_count=len(added),
        merged_count=len(merged),
        skipped_count=len(skipped),
        sections_created=sections_created,
        added=added,
        merged=merged,
        skipped=skipped,
    )
