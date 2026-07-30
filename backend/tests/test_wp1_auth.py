from fastapi.testclient import TestClient
from app.main import app
from app.deps import require_admin
from app.models import User, UserRole
from fastapi import HTTPException
import pytest

client = TestClient(app)

def test_login_success():
    response = client.post("/auth/login", json={
        "email": "admin@muh.example.edu.tr",
        "password": "admin1234"
    })
    assert response.status_code == 200
    assert "access_token" in response.json()
    assert response.json()["user"]["role"] == "ADMIN"

def test_login_wrong_password():
    response = client.post("/auth/login", json={
        "email": "admin@muh.example.edu.tr",
        "password": "wrongpassword"
    })
    assert response.status_code == 401

def test_login_unknown_email():
    response = client.post("/auth/login", json={
        "email": "yok@muh.example.edu.tr",
        "password": "1234"
    })
    assert response.status_code == 401

def test_me_requires_token():
    response = client.get("/auth/me")
    assert response.status_code == 401

def test_me_with_token():
    # First, login to get a token
    login_response = client.post("/auth/login", json={
        "email": "admin@muh.example.edu.tr",
        "password": "admin1234"
    })
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    # Then, use the token to access the protected endpoint
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["role"] == "ADMIN"

def test_refresh_requires_token():
    # K-47: token'sız uzatma yok
    assert client.post("/auth/refresh").status_code == 401

def test_refresh_returns_new_token_and_user():
    # K-47: geçerli token → yeni token + aynı user şekli
    login = client.post("/auth/login", json={
        "email": "admin@muh.example.edu.tr", "password": "admin1234"})
    token = login.json()["access_token"]
    r = client.post("/auth/refresh", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "access_token" in body and body["user"]["role"] == "ADMIN"
    # Yeni token da çalışır
    assert client.get("/auth/me",
                      headers={"Authorization": f"Bearer {body['access_token']}"}
                      ).status_code == 200

def test_require_admin_rejects_subaccount():
    u= User(role=UserRole.SUB_ACCOUNT)
    with pytest.raises(HTTPException) as exc:
        require_admin(current_user=u)
    assert exc.value.status_code == 403

def test_require_admin_allows_admin():
    u= User(role=UserRole.ADMIN)
    assert require_admin(current_user=u) is u