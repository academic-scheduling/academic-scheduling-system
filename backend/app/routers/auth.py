from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.deps import get_db, get_current_user
from app.schemas import (
    LoginRequest, TokenResponse, UserPublic,
    CompleteInvitationRequest, MessageResponse,
)
from app.security import verify_password, create_access_token, hash_password, hash_token
from app.models import User, UserStatus, InvitationToken

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash) :
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is not active",
        )
    access_token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=access_token, user=UserPublic.model_validate(user))

@router.get("/me", response_model=UserPublic)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    return UserPublic.model_validate(current_user)

@router.post("/complete-invitation", response_model=MessageResponse)
def complete_invitation(payload: CompleteInvitationRequest, db: Session = Depends(get_db)):
    # 1. Ham token'ı hash'le, DB'de ara
    invite = db.query(InvitationToken).filter(
        InvitationToken.token_hash == hash_token(payload.token)
    ).first()
    if invite is None:
        raise HTTPException(status_code=400, detail="Geçersiz davet bağlantısı")

    # 2. Daha önce kullanılmış mı
    if invite.used_at is not None:
        raise HTTPException(status_code=400, detail="Davet bağlantısı zaten kullanılmış")

    # 3. Süresi dolmuş mu (naive gelirse UTC say — SQLite güvenliği)
    expires = invite.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Davet süresi dolmuş")

    # 4. Hesabı aktifleştir + token'ı mühürle
    user = invite.user
    user.password_hash = hash_password(payload.password)
    user.status = UserStatus.ACTIVE
    invite.used_at = datetime.now(timezone.utc)
    db.commit()

    return MessageResponse(message="Hesap aktifleştirildi")


