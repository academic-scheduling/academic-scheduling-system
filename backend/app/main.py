from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import check_db_connection

app = FastAPI(title="Akademik Program ve Sinav Cakisma Yonetimi", version="0.1.0")

from app.routers.auth import router as auth_router
app.include_router(auth_router)

from app.routers.users import router as users_router
app.include_router(users_router)

from app.routers.departments import router as departments_router
app.include_router(departments_router)

from app.routers.lecturers import router as lecturers_router
app.include_router(lecturers_router)

from app.routers.buildings import router as buildings_router
app.include_router(buildings_router)

from app.routers.classrooms import router as classrooms_router
app.include_router(classrooms_router)

from app.routers.courses import router as courses_router
app.include_router(courses_router)

from app.routers.exams import router as exams_router
app.include_router(exams_router)

from app.routers.weekly_entries import router as weekly_entries_router
app.include_router(weekly_entries_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Iskeletin kalp atisi: API ayakta mi, veritabanina ulasabiliyor mu?"""
    return {"status": "ok", "database": "up" if check_db_connection() else "down"}
