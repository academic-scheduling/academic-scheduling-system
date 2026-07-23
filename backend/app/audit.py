"""Audit iz kaydi (K: audit_logs — kim, neyi, ne zaman).

Cagiran endpoint commit'ten ONCE cagirir; kayit ayni transaction'da gider
(islem basarisizsa iz de yazilmaz — yalanci iz kalmaz).

K-36: iz artik islem ANINDAKI insan-okur adi da tasir. Boylece log kendi
kendine yeter — silinen kaydin adi kaybolmaz, degistirilen ad o gunku
haliyle kalir.
"""
from sqlalchemy.orm import Session

from app.models import (
    AuditLog, Building, Classroom, Course, CourseSection, Department,
    Exam, Lecturer, User, WeeklyScheduleEntry,
)


def build_label(nesne) -> str | None:
    """Varliktan insan-okur ad uretir (K-36).

    TEK YER: hem yazma ani (log_action) hem de eski satirlar icin okuma
    anindaki geri dusus (audit_logs router) ayni bicimi kullansin. Ikiye
    ayrilsaydi ayni kayit iki farkli adla gorunebilirdi.

    Silmeden ONCE cagrilir; nesne o an hala yuklu oldugu icin iliskili
    alanlara (course.code gibi) erisilebilir.
    """
    if isinstance(nesne, Department):
        return f"{nesne.code} — {nesne.name}"
    if isinstance(nesne, Building):
        return nesne.name
    if isinstance(nesne, Classroom):
        return f"{nesne.building.name} {nesne.room_code}"
    if isinstance(nesne, Lecturer):
        return nesne.full_name
    if isinstance(nesne, Course):
        return f"{nesne.code} — {nesne.name}"
    if isinstance(nesne, CourseSection):
        return f"{nesne.course.code} Şube {nesne.section_no}"
    if isinstance(nesne, Exam):
        return f"{nesne.course.code} {nesne.exam_type.value}"
    if isinstance(nesne, WeeklyScheduleEntry):
        return f"{nesne.section.course.code} Şube {nesne.section.section_no}"
    if isinstance(nesne, User):
        return nesne.name
    return None


def log_action(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    entity_id: int,
    entity=None,
) -> None:
    """action: CREATE / UPDATE / DELETE / SUBMIT.

    `entity`: islemin uygulandigi ORM nesnesi. Adi buradan uretilir ve
    satira YAZILIR (K-36) — okuma aninda tabloya bakilmaz, cunku o tablo
    o kaydi kaybetmis olabilir.

    Varsayilani None: veren bir cagri yeri unutulursa iz yine yazilir,
    yalnizca adsiz kalir. Iz kaybetmektense adsiz iz iyidir.
    """
    db.add(AuditLog(
        user_id=user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=build_label(entity) if entity is not None else None,
    ))
