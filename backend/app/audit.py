"""Audit iz kaydi (K: audit_logs — kim, neyi, ne zaman).

Cagiran endpoint commit'ten ONCE cagirir; kayit ayni transaction'da gider
(islem basarisizsa iz de yazilmaz — yalanci iz kalmaz).
"""
from sqlalchemy.orm import Session

from app.models import AuditLog, User


def log_action(db: Session, user: User, action: str, entity_type: str, entity_id: int) -> None:
    """action: CREATE / UPDATE / DELETE (WP3-4'te SUBMIT eklenecek)."""
    db.add(AuditLog(
        user_id=user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
    ))