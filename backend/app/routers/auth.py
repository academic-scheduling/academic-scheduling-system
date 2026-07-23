from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.deps import get_db, get_current_user
from app.schemas import (
    LoginRequest, TokenResponse, UserPublic,
    CompleteInvitationRequest, InvitationPreview, MessageResponse,
)
from app.security import verify_password, create_access_token, hash_password, hash_token
from app.models import User, UserStatus, InvitationToken
from app.audit import log_action

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash) :
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-posta veya şifre hatalı",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kullanıcı hesabı aktif değil",
        )
    access_token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=access_token, user=UserPublic.model_validate(user))

@router.get("/me", response_model=UserPublic)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    return UserPublic.model_validate(current_user)

def _resolve_invitation(db: Session, raw_token: str) -> InvitationToken:
    """Ham token'ı çözer; geçersiz/kullanılmış/süresi dolmuş ise 400 fırlatır.

    Token'ı TÜKETMEZ — used_at'i mühürleyen tek yer complete_invitation'dır (K-24).
    Üç hata da 400: 404 verilse token'ın varlığı/yokluğu ayırt edilirdi.
    """
    # 1. Ham token'ı hash'le, DB'de ara
    invite = db.query(InvitationToken).filter(
        InvitationToken.token_hash == hash_token(raw_token)
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

    return invite


@router.get("/invitation/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    """Hesap tamamlama ekranı açılırken token'ı ön-doğrular (K-24, kontrat §1).

    Ölü linkte kullanıcı şifresini yazmadan ÖNCE tam sayfa hata görebilsin diye
    var (wireframe §2). Token'ı tüketmez, hiçbir şey yazmaz.
    """
    invite = _resolve_invitation(db, token)
    return InvitationPreview.model_validate(invite.user)


@router.post("/complete-invitation", response_model=MessageResponse)
def complete_invitation(payload: CompleteInvitationRequest, db: Session = Depends(get_db)):
    # GET ön-doğrulamış olsa bile kontroller burada TEKRAR edilir (K-24): iki
    # çağrı arasında süre dolabilir ya da token başkasınca kullanılabilir.
    invite = _resolve_invitation(db, payload.token)

    # Hesabı aktifleştir + token'ı mühürle
    user = invite.user
    user.password_hash = hash_password(payload.password)
    user.status = UserStatus.ACTIVE
    invite.used_at = datetime.now(timezone.utc)

    # İz (K-37): FAİL kişinin KENDİSİ — davet eden admin değil. Linke tıklayıp
    # şifresini belirleyen odur. log_action'ın JWT'li istek dışında çağrıldığı
    # tek yer burası; fail yine de bir User nesnesi olduğu için imza değişmiyor.
    # İzolasyon bozulmaz: workgroup_id davet anında yazılmıştı (K-35 join'i).
    log_action(db, user, "ACTIVATE", "user", user.id, user)
    db.commit()

    return MessageResponse(message="Hesap aktifleştirildi")


