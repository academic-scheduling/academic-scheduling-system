"""WP2 CRUD testleri — bölümler.

Desen: WP1 API testlerinin devamı. Gerçek dev DB'ye API üzerinden yazar;
benzersiz kod/e-postalarla tekrar çalıştırılabilir kalır. İzolasyon testi
için ikinci bir workgroup + admin DOĞRUDAN DB'ye eklenir (workgroup
oluşturma endpoint'i bilinçli olarak yok).
"""

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


# --- temel CRUD ---

def test_list_requires_auth():
    assert client.get("/departments").status_code == 401


def test_create_and_list():
    h = admin_headers()
    code = _u("BM")
    r = client.post("/departments", json={"name": "Bilgisayar Müh.", "code": code}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["code"] == code

    listed = client.get("/departments", headers=h)
    assert listed.status_code == 200
    assert code in [d["code"] for d in listed.json()]


def test_create_duplicate_code_conflict():
    h = admin_headers()
    code = _u("EE")
    assert client.post("/departments", json={"name": "A", "code": code}, headers=h).status_code == 201
    assert client.post("/departments", json={"name": "B", "code": code}, headers=h).status_code == 409


def test_patch_partial_update():
    h = admin_headers()
    code = _u("MK")
    dep = client.post("/departments", json={"name": "Eski Ad", "code": code}, headers=h).json()

    r = client.patch(f"/departments/{dep['id']}", json={"name": "Yeni Ad"}, headers=h)
    assert r.status_code == 200
    assert r.json()["name"] == "Yeni Ad"
    assert r.json()["code"] == code          # göndermediğimiz alan DEĞİŞMEMELİ


def test_patch_code_conflict():
    h = admin_headers()
    code1, code2 = _u("IN"), _u("GD")
    client.post("/departments", json={"name": "A", "code": code1}, headers=h)
    dep2 = client.post("/departments", json={"name": "B", "code": code2}, headers=h).json()

    r = client.patch(f"/departments/{dep2['id']}", json={"code": code1}, headers=h)
    assert r.status_code == 409


def test_patch_nonexistent_returns_404():
    h = admin_headers()
    assert client.patch("/departments/99999999", json={"name": "X"}, headers=h).status_code == 404


# --- workgroup izolasyonu (WP2'nin kalbi) ---

def test_isolation_foreign_admin_cannot_see_or_touch():
    h_ours = admin_headers()
    code = _u("GZ")
    dep = client.post("/departments", json={"name": "Gizli Bölüm", "code": code}, headers=h_ours).json()

    h_foreign = foreign_admin_headers()

    # 1. Listesinde görünmemeli
    listed = client.get("/departments", headers=h_foreign)
    assert code not in [d["code"] for d in listed.json()]

    # 2. PATCH edememeli — üstelik 403 değil 404 (varlığını bile sızdırmayız)
    r = client.patch(f"/departments/{dep['id']}", json={"name": "Ele Geçti"}, headers=h_foreign)
    assert r.status_code == 404