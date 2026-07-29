"""Bologna ders import endpoint'i (WP7).

POST /import/courses {department_id, url}: Bologna bilgi paketinden dersleri
ceker, SECILI bolume YENI dersleri ekler. Zaten kayitli (bolum+yil+donem+kod)
ders ATLANIR — guncelleme yok. Yalniz DERS acilir; hoca/sube ACILMAZ (K-14).

Yetki courses.py ile ayni: require_course_manager + _ensure_department_access
(bolum bizim workgroup mu + alt hesabin uyeligi var mi).
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.audit import log_action
from app.bologna_import import extract_cursunit, fetch_bologna_html, parse_courses
from app.deps import get_db, require_course_manager
from app.models import Course, SemesterType, User
from app.routers.courses import _ensure_department_access

router = APIRouter(tags=["import"])


class CourseImportRequest(BaseModel):
    department_id: int
    url: str


class ImportedCourseOut(BaseModel):
    code: str
    name: str
    year: int
    semester: str


class CourseImportResult(BaseModel):
    """Ozet: kac ders eklendi, kac tanesi zaten vardi (atlandi)."""
    total_parsed: int
    added_count: int
    skipped_count: int
    added: list[ImportedCourseOut]
    skipped: list[ImportedCourseOut]


def _as_out(pc) -> ImportedCourseOut:
    return ImportedCourseOut(
        code=pc.code, name=pc.name, year=pc.year, semester=pc.semester,
    )


@router.post("/import/courses", response_model=CourseImportResult)
def import_courses(
    payload: CourseImportRequest,
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

    # Mevcut dersleri tek sorguda al: (yil, donem, kod) kumesiyle O(1) atlama.
    existing = {
        (c.year, c.semester.value, c.code)
        for c in db.query(Course).filter(Course.department_id == dep.id).all()
    }

    added: list = []
    skipped: list = []
    for pc in parsed:
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
            hours_theory=pc.hours_theory,
            hours_practice=pc.hours_practice,
            hours_lab=pc.hours_lab,
        )
        db.add(course)
        db.flush()
        log_action(db, user, "CREATE", "course", course.id, course)
        added.append(pc)
        existing.add(key)  # ayni batch tekrar getirirse ikinci kez eklenmesin

    db.commit()
    return CourseImportResult(
        total_parsed=len(parsed),
        added_count=len(added),
        skipped_count=len(skipped),
        added=[_as_out(c) for c in added],
        skipped=[_as_out(c) for c in skipped],
    )
