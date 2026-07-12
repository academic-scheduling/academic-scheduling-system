from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.config import settings
import secrets
import hashlib

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return payload
    except JWTError:
        return None

def generate_invitation_token() -> str:
    """Maile gidecek ham token. URL-safe, ~43 karakter, 32 bayt entropi."""
    return secrets.token_urlsafe(32)

def hash_token(raw_token: str) -> str:
    """DB'ye yazılacak/aranacak hash. Deterministik sha256 hex (64 karakter)."""
    return hashlib.sha256(raw_token.encode()).hexdigest()