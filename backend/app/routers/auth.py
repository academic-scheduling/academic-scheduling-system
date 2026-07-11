from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.deps import get_db, get_current_user
from app.schemas import LoginRequest, TokenResponse, UserPublic
from app.security import verify_password, create_access_token
from app.models import User, UserStatus

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