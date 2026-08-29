from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import check_db_connection
from app.i18n import parse_accept_language, set_lang, translate_error

app = FastAPI(title="Akademik Program ve Sinav Cakisma Yonetimi", version="0.1.0")


# --------------------------------------------------------------------------
# K-79 · Dil (TR/EN)
# --------------------------------------------------------------------------
@app.middleware("http")
async def dil_baglamini_kur(request: Request, call_next):
    """Isteğin dilini `Accept-Language`'dan okuyup ambient bağlama koyar.

    Burada (async middleware'de) set edilmesi ŞART: senkron bağımlılıklar
    threadpool'da koşar ve orada set edilen contextvar uca ulaşmaz. Buradan
    set edilince değer threadpool'a kopyalanır — çakışma motoruna kadar
    görünür olur (gerekçenin tamamı `app/i18n.py`).
    """
    set_lang(parse_accept_language(request.headers.get("accept-language")))
    return await call_next(request)


@app.exception_handler(HTTPException)
async def hatalari_cevir(request: Request, exc: HTTPException) -> JSONResponse:
    """`detail` metnini isteğin diline çevirir (K-79 "kenarda çeviri").

    Böylece 107 `raise` yerine dokunulmadı: Türkçe metin kodda kanonik kaldı,
    çeviri tek katalogdan burada uygulanıyor. `detail` string DEĞİLSE (Pydantic
    422 listesi ya da kontrat §7'nin conflicts taşıyan 409 gövdesi) olduğu gibi
    geçer — yapıyı bozmak istemiyoruz.
    """
    detail = exc.detail
    if isinstance(detail, str):
        detail = translate_error(
            detail, parse_accept_language(request.headers.get("accept-language"))
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail},
        headers=getattr(exc, "headers", None),
    )

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

from app.routers.schedule_drafts import router as schedule_drafts_router
app.include_router(schedule_drafts_router)

from app.routers.schedule_approvals import router as schedule_approvals_router
app.include_router(schedule_approvals_router)

from app.routers.schedule_changes import router as schedule_changes_router
app.include_router(schedule_changes_router)

from app.routers.dashboard import router as dashboard_router
app.include_router(dashboard_router)

from app.routers.conflicts import router as conflicts_router
app.include_router(conflicts_router)

from app.routers.audit_logs import router as audit_logs_router
app.include_router(audit_logs_router)

from app.routers.export import router as export_router
app.include_router(export_router)

from app.routers.import_courses import router as import_courses_router
app.include_router(import_courses_router)

# Izin verilen kaynaklar .env'den gelir (brief: yapilandirma koda gomulmez).
# Dev'de varsayilan yine http://localhost:5173, yani yerel kurulumda hicbir sey
# degismez; yayinda CORS_ORIGINS gercek alan adiyla doldurulur.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    """Iskeletin kalp atisi: API ayakta mi, veritabanina ulasabiliyor mu?"""
    return {"status": "ok", "database": "up" if check_db_connection() else "down"}
