from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, require_admin
from app.models import (
    AuditLog, Building, Classroom, Course, CourseSection, Department,
    Exam, Lecturer, User, WeeklyScheduleEntry,
)
from app.schemas import AuditActorOut, AuditLogOut, AuditLogPage

router = APIRouter(tags=["audit"])


def _resolve_labels(db: Session, rows: list[AuditLog]) -> dict[tuple[str, int], str]:
    """(entity_type, entity_id) → insan-okur etiket — YALNIZ ESKİ SATIRLAR için.

    K-36'dan sonra etiket işlem anında satıra yazılıyor; bu fonksiyon artık
    yalnızca `entity_label` kolonundan ÖNCE yazılmış satırlar için çalışıyor.
    Onlarda tek yapılabilecek şey bu: varlık hâlâ duruyorsa adını üret,
    silinmişse None bırak.

    Bu geri düşüşün bilinen iki sınırı (K-36'da kayıtlı): silinmiş kayıt
    çözülemez, ve UPDATE satırı BUGÜNKÜ adı gösterir — işlem anındakini değil.
    Yeni satırlarda ikisi de yok.

    N+1 YOK: satırlar türe göre gruplanıp tür başına TEK sorgu atılır.
    """
    # tür → o türden istenen id'ler (yalnız etiketi eksik satırlar)
    istenen: dict[str, set[int]] = {}
    for r in rows:
        if r.entity_label is None:
            istenen.setdefault(r.entity_type, set()).add(r.entity_id)
    if not istenen:
        return {}

    etiketler: dict[tuple[str, int], str] = {}

    def topla(tur: str, model, etiketle, *yukle):
        ids = istenen.get(tur)
        if not ids:
            return
        q = db.query(model).filter(model.id.in_(ids))
        for y in yukle:
            q = q.options(y)
        for nesne in q.all():
            etiketler[(tur, nesne.id)] = etiketle(nesne)

    topla("department", Department, lambda d: f"{d.code} — {d.name}")
    topla("building", Building, lambda b: b.name)
    topla("lecturer", Lecturer, lambda l: l.full_name)
    topla("user", User, lambda u: u.name)
    topla("course", Course, lambda c: f"{c.code} — {c.name}")
    topla(
        "classroom", Classroom,
        lambda c: f"{c.building.name} {c.room_code}",
        selectinload(Classroom.building),
    )
    topla(
        "course_section", CourseSection,
        lambda s: f"{s.course.code} Şube {s.section_no}",
        selectinload(CourseSection.course),
    )
    topla(
        "exam", Exam,
        lambda e: f"{e.course.code} {e.exam_type.value}",
        selectinload(Exam.course),
    )
    topla(
        "weekly_entry", WeeklyScheduleEntry,
        lambda w: f"{w.section.course.code} Şube {w.section.section_no}",
        selectinload(WeeklyScheduleEntry.section).selectinload(CourseSection.course),
    )
    return etiketler


@router.get("/audit-logs", response_model=AuditLogPage)
def list_audit_logs(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user_id: int | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """İşlem kayıtları — kim, neyi, ne zaman değiştirdi (kontrat §12, K-35).

    Yalnız ADMIN: kim neyi değiştirdi bilgisi bir denetim aracıdır.

    İzolasyon `user_id → users.workgroup_id` join'iyle kurulur; `audit_logs`
    tablosunda `workgroup_id` kolonu yok. Bu güvenli, çünkü fail her zaman bir
    kullanıcıdır: PENDING hesap giriş yapamaz (deps.py ACTIVE arar), ACTIVE
    hesap K-34 gereği silinemez — yani `user_id` pratikte hiç NULL olmaz.
    """
    q = (
        db.query(AuditLog)
        .join(User, AuditLog.user_id == User.id)
        .filter(User.workgroup_id == admin.workgroup_id)
    )

    if user_id is not None:
        q = q.filter(AuditLog.user_id == user_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    # Tarih SINIRLARI dahil: date_to verilen günün tamamını kapsar, o günün
    # 00:00'ını değil — kullanıcı "24 Temmuz'a kadar" derken o günü kastediyor.
    if date_from:
        q = q.filter(AuditLog.created_at >= datetime.combine(date_from, time.min, timezone.utc))
    if date_to:
        q = q.filter(AuditLog.created_at <= datetime.combine(date_to, time.max, timezone.utc))

    # Sayım filtrelerden SONRA, sayfalamadan ÖNCE: "kaç sonuç var" sorusunun
    # cevabı sayfa değil, filtre kümesidir.
    total = q.count()

    rows = (
        q.options(selectinload(AuditLog.user))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    etiketler = _resolve_labels(db, rows)

    return AuditLogPage(
        total=total,
        items=[
            AuditLogOut(
                id=r.id,
                created_at=r.created_at,
                user=AuditActorOut.model_validate(r.user) if r.user else None,
                action=r.action,
                entity_type=r.entity_type,
                entity_id=r.entity_id,
                # Önce satıra YAZILMIŞ etiket (K-36) — işlem anındaki gerçek.
                # Yoksa eski satırdır, okuma anında çözülmeye çalışılır.
                entity_label=r.entity_label
                or etiketler.get((r.entity_type, r.entity_id)),
            )
            for r in rows
        ],
    )
