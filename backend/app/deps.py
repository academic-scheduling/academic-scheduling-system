from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.security import decode_access_token
from app.models import User, UserRole, UserStatus
from app.db import SessionLocal

bearer_scheme = HTTPBearer(auto_error=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(credentials=Depends(bearer_scheme), db=Depends(get_db)) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.get(User, int(user_id)) 
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is not active",
        )
    return user

def require_admin(current_user=Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user

def _require_capability(flag_name: str, error_detail: str):
    """Yetenek bayrağı denetleyen bir dependency üretir (K-25).

    Desen K-02'den gelir: ADMIN her yetenekten muaftır, alt hesap bayrağa bakar.
    Fabrika kullanılmasının sebebi, beş yeteneğin aynı üç satırı kopyalamaması —
    kural tek yerde durur, biri düzeltilince hepsi düzelir.
    """
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role != UserRole.ADMIN and not getattr(current_user, flag_name):
            raise HTTPException(status_code=403, detail=error_detail)
        return current_user
    return dependency


# Bölüme ait kaynaklar: bayrak TEK BAŞINA yetmez, ayrıca bölüm üyeliği aranır
# (router'lar içinde, K-25'in "iki boyut" kuralı).
require_course_manager = _require_capability(
    "can_manage_courses", "Ders yönetim yetkisi gerekli"
)
require_weekly_manager = _require_capability(
    "can_manage_weekly", "Haftalık program yönetim yetkisi gerekli"
)
require_exam_manager = _require_capability(
    "can_manage_exams", "Sınav yönetim yetkisi gerekli"
)

# Workgroup geneli paylaşımlı kaynaklar: üyelik boyutu yok, bayrak yeter.
require_classroom_manager = _require_capability(
    "can_manage_classrooms", "Derslik yönetim yetkisi gerekli"
)
require_lecturer_manager = _require_capability(
    "can_manage_lecturers", "Öğretim üyesi yönetim yetkisi gerekli"
)