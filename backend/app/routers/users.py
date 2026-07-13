from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db, require_admin
from app.config import settings
from app.models import (
    User, UserRole, UserStatus,
    Department, DepartmentMembership, InvitationToken,
)
from app.schemas import InviteRequest, InviteResponse, MessageResponse, UserListItem
from app.security import generate_invitation_token, hash_token
from app.mailer import send_invitation_email


router = APIRouter(prefix="/users", tags=["users"])


# --- İzole domain kontrolü (ileride global<->workgroup geçişi burada) ---
def check_email_domain(email: str) -> bool:
    domains = [d.strip().lower() for d in settings.allowed_email_domains.split(",") if d.strip()]
    if "*" in domains:
        return True
    domain = email.split("@")[-1].lower()
    return domain in domains

def _create_and_store_token(db: Session, user_id: int) -> str:
    """Yeni token üretir, hash'ini DB'ye yazar, ham token'ı döner."""
    raw = generate_invitation_token()
    invite = InvitationToken(
        user_id=user_id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.invitation_expire_hours),
    )
    db.add(invite)
    return raw

@router.post("/invite", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: InviteRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # 1. Domain
    if not check_email_domain(payload.email):
        raise HTTPException(status_code=400, detail="E-posta izinli domainde değil")

    # 2. E-posta benzersizliği
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=409, detail="Bu e-posta zaten kayıtlı")

    # 3. Bölüm kontrolü + workgroup izolasyonu
    if payload.department_ids:
        wanted = set(payload.department_ids)
        found = db.query(Department).filter(
            Department.id.in_(wanted),
            Department.workgroup_id == admin.workgroup_id,
        ).all()
        if len(found) != len(wanted):
            raise HTTPException(status_code=400, detail="Geçersiz bölüm seçimi")

    # 4. PENDING kullanıcı
    user = User(
        workgroup_id=admin.workgroup_id,
        name=payload.name,
        email=payload.email,
        role=payload.role,
        status=UserStatus.PENDING,
        password_hash=None,
        can_manage_classrooms=payload.can_manage_classrooms,
    )
    db.add(user)
    db.flush()  # user.id'yi almak için

    # 5. Membership satırları
    for dept_id in set(payload.department_ids):
        db.add(DepartmentMembership(user_id=user.id, department_id=dept_id))

    # 6. Token
    raw_token = _create_and_store_token(db, user.id)

    # 7. Commit, sonra mail
    db.commit()
    db.refresh(user)
    send_invitation_email(user.email, user.name, raw_token)

    return user


@router.post("/{user_id}/resend-invitation", response_model=MessageResponse)
def resend_invitation(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if user is None or user.workgroup_id != admin.workgroup_id:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.status != UserStatus.PENDING:
        raise HTTPException(status_code=400, detail="Yalnızca bekleyen davetler yeniden gönderilebilir")

    # Eski kullanılmamış token'ları geçersiz kıl
    now = datetime.now(timezone.utc)
    for tok in user.invitation_tokens:
        if tok.used_at is None:
            tok.used_at = now

    raw_token = _create_and_store_token(db, user.id)
    db.commit()
    send_invitation_email(user.email, user.name, raw_token)

    return MessageResponse(message="Davet yeniden gönderildi")


@router.get("", response_model=list[UserListItem])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    users = db.query(User).filter(User.workgroup_id == admin.workgroup_id).all()
    result = []
    for u in users:
        result.append(UserListItem(
            id=u.id,
            name=u.name,
            email=u.email,
            role=u.role,
            status=u.status,
            can_manage_classrooms=u.can_manage_classrooms,
            department_ids=[m.department_id for m in u.memberships],
        ))
    return result
