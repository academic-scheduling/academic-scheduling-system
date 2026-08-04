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
from sqlalchemy.orm import Session

from app.audit import log_action
from app.bologna_import import extract_cursunit, fetch_bologna_html, parse_courses
from app.deps import get_db, require_course_manager
from app.models import Course, CourseCohort, Department, SemesterType, User
from app.routers.courses import (
    _covered_cohorts, _ensure_department_access, _find_common_course,
)

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
    is_elective: bool = False
    is_common: bool = False               # K-48: içe aktarırken ortak işaretlenebilir

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


class PreviewCourse(CourseFields):
    exists: bool           # bu bolumde (yil+donem+kod) zaten kayitli mi?


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

    # Mevcut dersler tek sorguda: (yil, donem, kod) kumesiyle O(1) 'exists' isareti.
    existing = {
        (c.year, c.semester.value, c.code)
        for c in db.query(Course).filter(Course.department_id == dep.id).all()
    }
    # K-54: bu bölümün BAŞKA bir bölümce sahiplenen ortak dersleri TÜKETMESİ de
    # "zaten var" sayılır. Yoksa CENG'in açtığı ENG 1803, EEE önizlemesinde yine
    # "yeni" görünür (ve commit onu sessizce atlayınca kullanıcı şaşırır).
    for common in (
        db.query(Course).join(Department)
        .filter(Department.workgroup_id == user.workgroup_id, Course.is_common.is_(True))
        .all()
    ):
        for (dept_id, year, sem) in _covered_cohorts(common):
            if dept_id == dep.id:
                existing.add((year, sem.value, common.code))

    return PreviewResult(courses=[
        PreviewCourse(
            code=pc.code, name=pc.name, year=pc.year, semester=pc.semester,
            hours_theory=pc.hours_theory, hours_practice=pc.hours_practice,
            hours_lab=pc.hours_lab, ects=pc.ects, is_elective=pc.is_elective,
            # K-48: bölüm koduyla başlamayan dersleri ortak olarak ÖN-İŞARETLE
            # (kullanıcı önizlemede değiştirebilir).
            is_common=_looks_common(pc.code, dep.code),
            exists=(pc.year, pc.semester, pc.code) in existing,
        )
        for pc in parsed
    ])


# --------------------------------------------------------------------------
# Faz 2 — Isleme (secilenleri ekle)
# --------------------------------------------------------------------------

class CommitRequest(BaseModel):
    department_id: int
    courses: list[CourseFields]


class CourseImportResult(BaseModel):
    """Ozet: kac yeni ders acildi, kac ortak derse cohort eklendi (merged), kac
    tanesi zaten vardi (skipped)."""
    total_parsed: int
    added_count: int
    merged_count: int                     # K-54: mevcut ortak derse cohort eklendi
    skipped_count: int
    added: list[CourseFields]
    merged: list[CourseFields]
    skipped: list[CourseFields]


@router.post("/import/courses", response_model=CourseImportResult)
def import_courses(
    payload: CommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    dep = _ensure_department_access(db, user, payload.department_id)

    # Sunucu tarafi cift-kayit savunmasi: bu bolumde ZATEN olanlar + bu istekte
    # birden fazla gelenler atlanir (istemci filtrelese de garanti burada).
    existing = {
        (c.year, c.semester.value, c.code)
        for c in db.query(Course).filter(Course.department_id == dep.id).all()
    }

    added: list[CourseFields] = []
    merged: list[CourseFields] = []
    skipped: list[CourseFields] = []
    for pc in payload.courses:
        sem = SemesterType(pc.semester)

        # K-54: ortak ders BIRLESTIRME — create_course ile AYNI mantik (tek kaynak
        # `_find_common_course`/`_covered_cohorts`). Ayni workgroup'ta ayni kodlu
        # bir ortak ders varsa YENI KAYIT ACMA; bu (bolum, yil, donem)'i onun ek
        # cohort'u yap. Eski kod bunu atlayip her satira duz Course aciyordu →
        # CENG'in actigi ENG 1803'u EEE import edince cift kayit olusuyordu.
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
                continue
            # Bu kodda ortak ders henuz yoksa: asagida YENI ortak ders olarak acilir
            # (ilk aktaran bolum birincil sahibi olur; is_common=True saklanir).

        key = (pc.year, pc.semester, pc.code)
        if key in existing:
            skipped.append(pc)
            continue
        course = Course(
            department_id=dep.id,
            year=pc.year,
            semester=sem,
            code=pc.code,
            name=pc.name,
            is_elective=pc.is_elective,
            is_common=pc.is_common,           # K-48
            ects=pc.ects,                     # K-55
            hours_theory=pc.hours_theory,
            hours_practice=pc.hours_practice,
            hours_lab=pc.hours_lab,
        )
        db.add(course)
        db.flush()
        log_action(db, user, "CREATE", "course", course.id, course)
        added.append(pc)
        existing.add(key)  # ayni istekte tekrar gelirse ikinci kez eklenmesin

    db.commit()
    return CourseImportResult(
        total_parsed=len(payload.courses),
        added_count=len(added),
        merged_count=len(merged),
        skipped_count=len(skipped),
        added=added,
        merged=merged,
        skipped=skipped,
    )
