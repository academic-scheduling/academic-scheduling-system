"""Export endpoint'leri (WP6) — kontrat §11 + derslik programi.

Haftalik program, sinav ve derslik cizelgelerini XLSX/CSV indirir.
Besleyen sorgular list_weekly_entries / list_exams ile ayni (K-26 izolasyonu).
Format: xlsx (tercih) | csv (minimum). PDF MVP disi (K-09 -> backlog).
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user
from app.export_service import (
    CLASSROOM_HEADERS, EXAM_HEADERS, WEEKLY_HEADERS,
    build_classrooms_xlsx, classrooms_rows,
    exams_rows, to_csv_bytes, to_xlsx_bytes, weekly_rows,
)
from app.models import (
    Classroom, Course, CourseSection, Department, Exam, ExamType, SemesterType,
    User, WeeklyScheduleEntry,
)
from app.routers.exams import _eager_exam_query
from app.routers.weekly_entries import _eager_entry_query

router = APIRouter(tags=["export"])

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _spreadsheet_response(fmt: str, headers, rows, filename: str, sheet: str) -> Response:
    """Format sec -> bytes -> indirilebilir Response. Uc endpoint de bunu kullanir."""
    if fmt == "csv":
        return Response(
            content=to_csv_bytes(headers, rows),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
        )
    if fmt == "xlsx":
        return Response(
            content=to_xlsx_bytes(headers, rows, sheet_name=sheet),
            media_type=_XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
        )
    raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {fmt}")

@router.get("/export/weekly")
def export_weekly(
    format: str = Query("xlsx"),
    department_id: int | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    classroom_id: int | None = Query(None),
    lecturer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _eager_entry_query(db).filter(Department.workgroup_id == user.workgroup_id)
    # Filtreler list_weekly_entries ile birebir ayni (kontrat §7, K-26):
    # workgroup ici herkes TUM bolumleri okur, yazma kisiti ayridir.
    # Bes filtre de UI'daki uc mercegi (cohort/derslik/hoca) karsilar.
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if year is not None:
        q = q.filter(Course.year == year)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    if classroom_id is not None:
        q = q.filter(WeeklyScheduleEntry.classroom_id == classroom_id)
    if lecturer_id is not None:
        q = q.filter(CourseSection.lecturer_id == lecturer_id)
    entries = q.order_by(
        WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot
    ).all()

    return _spreadsheet_response(
        format, WEEKLY_HEADERS, weekly_rows(entries),
        "haftalik_program", "Haftalık Program",
    )

@router.get("/export/exams")
def export_exams(
    format: str = Query("xlsx"),
    department_id: int | None = Query(None),
    exam_type: ExamType | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _eager_exam_query(db).filter(Department.workgroup_id == user.workgroup_id)
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if exam_type is not None:
        q = q.filter(Exam.exam_type == exam_type)
    if date_from is not None:
        q = q.filter(Exam.exam_date >= date_from)
    if date_to is not None:
        q = q.filter(Exam.exam_date <= date_to)
    if year is not None:
        q = q.filter(Course.year == year)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    exams = q.order_by(Exam.exam_date, Exam.start_time).all()

    return _spreadsheet_response(
        format, EXAM_HEADERS, exams_rows(exams),
        "sinav_programi", "Sınav Programı",
    )


@router.get("/export/classrooms")
def export_classrooms(
    format: str = Query("xlsx"),
    building_id: int | None = Query(None),
    classroom_id: int | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # classroom_id uzerinden INNER join: dersliksiz (cevrimici) girisler dogal
    # olarak elenir; derslik programina yalniz fiziksel dersler girer.
    q = (
        _eager_entry_query(db)
        .join(Classroom, WeeklyScheduleEntry.classroom_id == Classroom.id)
        .filter(Department.workgroup_id == user.workgroup_id)
    )
    if building_id is not None:
        q = q.filter(Classroom.building_id == building_id)
    if classroom_id is not None:
        # Tek derslik: "bu dersligin programi" gorunumunden indirme icin.
        q = q.filter(Classroom.id == classroom_id)
    entries = q.all()

    if format == "csv":
        return Response(
            content=to_csv_bytes(CLASSROOM_HEADERS, classrooms_rows(entries)),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="derslik_programi.csv"'},
        )
    if format == "xlsx":
        return Response(
            content=build_classrooms_xlsx(entries),
            media_type=_XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="derslik_programi.xlsx"'},
        )
    raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {format}")     