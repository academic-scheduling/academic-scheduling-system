"""Export endpoint'leri (WP6) — kontrat §11 + derslik programi.

Haftalik program, sinav ve derslik cizelgelerini XLSX/CSV indirir.
Besleyen sorgular list_weekly_entries / list_exams ile ayni (K-26 izolasyonu).
Format: xlsx (tercih) | csv (minimum). PDF MVP disi (K-09 -> backlog).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user
from app.export_service import (
    CLASSROOM_HEADERS, EXAM_HEADERS, WEEKLY_HEADERS,
    build_classrooms_xlsx, build_exam_schedule_xlsx, build_weekly_grid_xlsx,
    classrooms_rows, exams_rows, to_csv_bytes, to_xlsx_bytes, weekly_rows,
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

    # Cohort (bolum + sinif + donem birlikte) + xlsx -> RESMI IZGARA programi.
    # Aksi halde (derslik/hoca mercegi ya da csv) duz liste doner.
    is_cohort = department_id is not None and year is not None and semester is not None
    if format == "xlsx" and is_cohort:
        dep_en = ""
        faculty_en = ""
        dep = db.get(Department, department_id)
        if dep is not None and dep.workgroup_id == user.workgroup_id:
            dep_en = dep.name_en or dep.name
            faculty_en = dep.faculty_en or ""
        return Response(
            content=build_weekly_grid_xlsx(
                entries, faculty_en=faculty_en, department_en=dep_en,
                semester_value=semester.value, year=year),
            media_type=_XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="haftalik_program.xlsx"'},
        )

    return _spreadsheet_response(
        format, WEEKLY_HEADERS, weekly_rows(entries),
        "haftalik_program", "Haftalık Program",
    )

@router.get("/export/exams")
def export_exams(
    format: str = Query("xlsx"),
    department_id: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    schedule: str = Query("midterm"),   # "midterm" | "final" (final = final + but)
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Universite formati: bir bolumun bir donemdeki TUM yillarinin sinavlari.
    # midterm -> yalniz vize; final -> final + butunleme (ders bazinda eslenir).
    types = ([ExamType.MIDTERM] if schedule == "midterm"
             else [ExamType.FINAL, ExamType.MAKEUP])
    q = (
        _eager_exam_query(db)
        .filter(Department.workgroup_id == user.workgroup_id)
        .filter(Exam.exam_type.in_(types))
    )
    if department_id is not None:
        q = q.filter(Course.department_id == department_id)
    if semester is not None:
        q = q.filter(Course.semester == semester)
    exams = q.order_by(Course.year, Course.code, Exam.exam_type).all()

    # Resmi baslik ingilizce: bolumun ingilizce adi/fakultesi (yoksa TR ad'a duser).
    dep_en = ""
    faculty_en = ""
    if department_id is not None:
        dep = db.get(Department, department_id)
        if dep is not None and dep.workgroup_id == user.workgroup_id:
            dep_en = dep.name_en or dep.name
            faculty_en = dep.faculty_en or ""
    sem_value = semester.value if semester is not None else ""
    fname = "final_butunleme_programi" if schedule == "final" else "vize_programi"

    if format == "csv":
        # CSV: resmi izgara CSV'ye sigmaz; duz liste (veri) doner.
        return Response(
            content=to_csv_bytes(EXAM_HEADERS, exams_rows(exams)),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{fname}.csv"'},
        )
    if format == "xlsx":
        return Response(
            content=build_exam_schedule_xlsx(
                exams, faculty_en=faculty_en, department_en=dep_en,
                semester_value=sem_value, schedule=schedule),
            media_type=_XLSX_MIME,
            headers={"Content-Disposition": f'attachment; filename="{fname}.xlsx"'},
        )
    raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {format}")


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