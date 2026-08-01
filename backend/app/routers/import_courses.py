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

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.audit import log_action
from app.bologna_import import extract_cursunit, fetch_bologna_html, parse_courses
from app.deps import get_db, require_course_manager
from app.models import Course, SemesterType, User
from app.routers.courses import _ensure_department_access

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

    return PreviewResult(courses=[
        PreviewCourse(
            code=pc.code, name=pc.name, year=pc.year, semester=pc.semester,
            hours_theory=pc.hours_theory, hours_practice=pc.hours_practice,
            hours_lab=pc.hours_lab, is_elective=pc.is_elective,
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
    """Ozet: kac ders eklendi, kac tanesi zaten vardi (atlandi)."""
    total_parsed: int
    added_count: int
    skipped_count: int
    added: list[CourseFields]
    skipped: list[CourseFields]


@router.post("/import/courses", response_model=CourseImportResult)
def import_courses(
    payload: CommitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_course_manager),
):
    dep = _ensure_department_access(db, user, payload.department_id)

    # Sunucu tarafi cift-kayit savunmasi: DB'de ZATEN olanlar + bu istekte
    # birden fazla gelenler atlanir (istemci filtrelese de garanti burada).
    existing = {
        (c.year, c.semester.value, c.code)
        for c in db.query(Course).filter(Course.department_id == dep.id).all()
    }

    added: list[CourseFields] = []
    skipped: list[CourseFields] = []
    for pc in payload.courses:
        key = (pc.year, pc.semester, pc.code)
        if key in existing:
            skipped.append(pc)
            continue
        course = Course(
            department_id=dep.id,
            year=pc.year,
            semester=SemesterType(pc.semester),
            code=pc.code,
            name=pc.name,
            is_elective=pc.is_elective,
            is_common=pc.is_common,           # K-48
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
        skipped_count=len(skipped),
        added=added,
        skipped=skipped,
    )
