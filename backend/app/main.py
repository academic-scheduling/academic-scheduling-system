from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import check_db_connection

app = FastAPI(title="Akademik Program ve Sinav Cakisma Yonetimi", version="0.1.0")

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
