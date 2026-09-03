from datetime import datetime, timedelta, timezone

# PyJWT (python-jose DEGIL): jose 2021'den beri bakimsiz ve iki CVE tasiyor
# (CVE-2024-33663 algoritma karisikligi, CVE-2024-33664 JWE ile bellek
# tuketimi). Ikisi de burada dogrudan somurulemiyordu -- decode'da
# algorithms=["HS256"] zaten sabitti ve JWE hic kullanilmiyor -- ama bakimsiz
# bir imza kutuphanesine yaslanmak, bir sonraki acigin yamanmayacagi anlamina
# gelir. PyJWT ayni API'yi verir ve aktif surdurulur.
import jwt
from jwt import PyJWTError
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
    """Token'i dogrular; gecersiz/suresi dolmus ise None doner.

    `algorithms` TEK elemanli ve sabit: istemcinin gonderdigi basliktaki `alg`
    degeri asla dikkate alinmaz. Aksi halde saldirgan `alg: none` diyerek imza
    dogrulamasini atlatmaya calisabilirdi. PyJWT `exp`'i kendisi denetler.
    """
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except PyJWTError:
        return None

def generate_invitation_token() -> str:
    """Maile gidecek ham token. URL-safe, ~43 karakter, 32 bayt entropi."""
    return secrets.token_urlsafe(32)

def hash_token(raw_token: str) -> str:
    """DB'ye yazılacak/aranacak hash. Deterministik sha256 hex (64 karakter)."""
    return hashlib.sha256(raw_token.encode()).hexdigest()