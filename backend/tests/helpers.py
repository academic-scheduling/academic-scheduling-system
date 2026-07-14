import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.db import SessionLocal
from app.models import User, UserRole, UserStatus, Workgroup
from app.security import hash_password

client = TestClient(app)
ADMIN = {"email": "admin@muh.example.edu.tr", "password": "admin1234"}


def _u(prefix: str) -> str:
    """Testler arası çakışmayı önlemek için benzersiz kısa kod."""
    return f"{prefix}{uuid.uuid4().hex[:8].upper()}"


def admin_headers():
    r = client.post("/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def foreign_admin_headers():
    """Yabancı workgroup'un admin'ini yaratır, login olur, header döndürür."""
    email = f"admin_{uuid.uuid4().hex[:8]}@baska.example.edu.tr"
    pw = "digeradmin123"
    db = SessionLocal()
    wg = Workgroup(name=_u("WG-B-"), allowed_email_domain="baska.example.edu.tr")
    db.add(wg)
    db.flush()
    db.add(User(
        workgroup_id=wg.id, name="Diğer Admin", email=email,
        password_hash=hash_password(pw), role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
    ))
    db.commit()
    db.close()
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

def sub_headers(can_manage_classrooms: bool = False):
    """Ana workgroup'ta SUB_ACCOUNT yaratır, login olur, header döndürür."""
    db = SessionLocal()
    admin = db.query(User).filter(User.email == ADMIN["email"]).first()
    email = f"sub_{uuid.uuid4().hex[:8]}@muh.example.edu.tr"
    pw = "subhesap123"
    db.add(User(
        workgroup_id=admin.workgroup_id, name="Alt Hesap", email=email,
        password_hash=hash_password(pw), role=UserRole.SUB_ACCOUNT,
        status=UserStatus.ACTIVE,
        can_manage_classrooms=can_manage_classrooms,
    ))
    db.commit()
    db.close()
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}