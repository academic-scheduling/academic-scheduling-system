import uuid
from datetime import datetime, timezone, timedelta

from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.models import InvitationToken
from app.security import hash_token

client = TestClient(app)
ADMIN = {"email": "admin@muh.example.edu.tr", "password": "admin1234"}


def admin_headers():
    r = client.post("/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def unique_email(domain="muh.example.edu.tr"):
    return f"invite_{uuid.uuid4().hex[:10]}@{domain}"


# --- invite ---

def test_invite_requires_auth():
    r = client.post("/users/invite", json={"name": "X", "email": unique_email()})
    assert r.status_code == 401


def test_invite_success(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(email=to_email, token=raw_token),
    )
    email = unique_email()
    r = client.post("/users/invite",
                    json={"name": "Yeni Kullanıcı", "email": email},
                    headers=admin_headers())
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "PENDING"
    assert captured["email"] == email      # mail "gönderildi"
    assert captured["token"]               # ham token yakalandı


def test_invite_bad_domain(monkeypatch):
    monkeypatch.setattr("app.routers.users.send_invitation_email", lambda *a, **k: None)
    r = client.post("/users/invite",
                    json={"name": "Dış", "email": "biri@hotmail.com"},
                    headers=admin_headers())
    assert r.status_code == 400


def test_invite_duplicate_email(monkeypatch):
    monkeypatch.setattr("app.routers.users.send_invitation_email", lambda *a, **k: None)
    email = unique_email()
    h = admin_headers()
    assert client.post("/users/invite", json={"name": "A", "email": email}, headers=h).status_code == 201
    assert client.post("/users/invite", json={"name": "A", "email": email}, headers=h).status_code == 409


def test_invite_forbidden_for_subaccount(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    pw = "subhesap123"
    client.post("/users/invite", json={"name": "Alt", "email": email, "role": "SUB_ACCOUNT"}, headers=admin_headers())
    client.post("/auth/complete-invitation", json={"token": captured["token"], "password": pw})
    login = client.post("/auth/login", json={"email": email, "password": pw})
    sub_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = client.post("/users/invite", json={"name": "Olmaz", "email": unique_email()}, headers=sub_headers)
    assert r.status_code == 403


# --- invitation preview (K-24) ---

def test_preview_returns_owner(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Önizleme", "email": email}, headers=admin_headers())

    r = client.get(f"/auth/invitation/{captured['token']}")
    assert r.status_code == 200, r.text
    assert r.json() == {"email": email, "name": "Önizleme"}   # rol/bölüm SIZMAZ


def test_preview_does_not_consume_token(monkeypatch):
    """K-24 çekirdek şartı: ön-doğrulama token'ı yakmaz."""
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Yanmaz", "email": email}, headers=admin_headers())
    token = captured["token"]

    assert client.get(f"/auth/invitation/{token}").status_code == 200
    assert client.get(f"/auth/invitation/{token}").status_code == 200   # ikinci kez de çalışır
    # ve token hâlâ hesabı aktifleştirebilir
    assert client.post("/auth/complete-invitation",
                       json={"token": token, "password": "yenisifre123"}).status_code == 200


def test_preview_invalid_token():
    r = client.get("/auth/invitation/gecersiz-token")
    assert r.status_code == 400
    assert r.json()["detail"] == "Geçersiz davet bağlantısı"


def test_preview_used_token(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Kullanılmış", "email": email}, headers=admin_headers())
    token = captured["token"]
    client.post("/auth/complete-invitation", json={"token": token, "password": "yenisifre123"})

    r = client.get(f"/auth/invitation/{token}")
    assert r.status_code == 400
    assert r.json()["detail"] == "Davet bağlantısı zaten kullanılmış"


def test_preview_expired_token(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Süresi Dolan", "email": email}, headers=admin_headers())
    token = captured["token"]

    db = SessionLocal()
    tok = db.query(InvitationToken).filter(InvitationToken.token_hash == hash_token(token)).first()
    tok.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()
    db.close()

    r = client.get(f"/auth/invitation/{token}")
    assert r.status_code == 400
    assert r.json()["detail"] == "Davet süresi dolmuş"


def test_preview_requires_no_auth(monkeypatch):
    """Kontrat §1: davet uçları public — Bearer istemez."""
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    client.post("/users/invite", json={"name": "Public", "email": unique_email()}, headers=admin_headers())
    r = client.get(f"/auth/invitation/{captured['token']}")   # başlıksız
    assert r.status_code == 200


# --- complete-invitation ---

def test_complete_invitation_flow(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Aktif", "email": email}, headers=admin_headers())
    token = captured["token"]

    r = client.post("/auth/complete-invitation", json={"token": token, "password": "yenisifre123"})
    assert r.status_code == 200, r.text

    # artık login olabilmeli
    assert client.post("/auth/login", json={"email": email, "password": "yenisifre123"}).status_code == 200

    # aynı token ikinci kez çalışmamalı
    r3 = client.post("/auth/complete-invitation", json={"token": token, "password": "baskasifre123"})
    assert r3.status_code == 400


def test_complete_invitation_invalid_token():
    r = client.post("/auth/complete-invitation", json={"token": "gecersiz-token", "password": "12345678"})
    assert r.status_code == 400


def test_complete_invitation_expired(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    email = unique_email()
    client.post("/users/invite", json={"name": "Süre", "email": email}, headers=admin_headers())
    token = captured["token"]

    # token'ın süresini elle geçmişe çek
    db = SessionLocal()
    tok = db.query(InvitationToken).filter(InvitationToken.token_hash == hash_token(token)).first()
    tok.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db.commit()
    db.close()

    r = client.post("/auth/complete-invitation", json={"token": token, "password": "yenisifre123"})
    assert r.status_code == 400


# --- resend + list ---

def test_resend_invalidates_old_token(monkeypatch):
    tokens = []
    monkeypatch.setattr(
        "app.routers.users.send_invitation_email",
        lambda to_email, to_name, raw_token: tokens.append(raw_token),
    )
    email = unique_email()
    h = admin_headers()
    resp = client.post("/users/invite", json={"name": "Tekrar", "email": email}, headers=h)
    user_id = resp.json()["id"]

    assert client.post(f"/users/{user_id}/resend-invitation", headers=h).status_code == 200
    assert len(tokens) == 2 and tokens[0] != tokens[1]      # yeni token üretildi

    # eski token geçersiz, yeni token çalışır
    assert client.post("/auth/complete-invitation", json={"token": tokens[0], "password": "yenisifre123"}).status_code == 400
    assert client.post("/auth/complete-invitation", json={"token": tokens[1], "password": "yenisifre123"}).status_code == 200


def test_list_users(monkeypatch):
    monkeypatch.setattr("app.routers.users.send_invitation_email", lambda *a, **k: None)
    email = unique_email()
    h = admin_headers()
    client.post("/users/invite", json={"name": "Listede", "email": email}, headers=h)
    r = client.get("/users", headers=h)
    assert r.status_code == 200
    assert email in [u["email"] for u in r.json()]