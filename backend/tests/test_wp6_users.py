"""WP6 hesap yönetimi — PATCH/DELETE /users (K-34).

Ayrımın kalbi: bekleyen davet SİLİNİR, kullanılmış hesap KAPATILIR. Silme
yasağını veritabanı koymuyor (FK'ler SET NULL), o yüzden testler engelin
uygulama katmanında gerçekten durduğunu kanıtlamak zorunda.
"""

import uuid

from app.db import SessionLocal
from app.models import AuditLog, User, UserStatus
from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u
from tests.test_wp2_courses import make_department


def invite(h, **overrides) -> dict:
    body = {
        "name": "Davetli Kişi",
        "email": f"davetli_{uuid.uuid4().hex[:8]}@muh.example.edu.tr",
        "role": "SUB_ACCOUNT",
    }
    body.update(overrides)
    r = client.post("/users/invite", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def get_user(h, user_id: int) -> dict:
    tumu = client.get("/users", headers=h).json()
    return next(u for u in tumu if u["id"] == user_id)


# --- bekleyen davetin silinmesi ---

def test_pending_invite_can_be_deleted():
    """Yanlış adrese giden davet listeden temizlenebilmeli — DELETE'in sebebi."""
    h = admin_headers()
    davetli = invite(h)
    assert client.delete(f"/users/{davetli['id']}", headers=h).status_code == 204
    assert davetli["id"] not in [u["id"] for u in client.get("/users", headers=h).json()]


def test_deleting_pending_invite_removes_its_token():
    """CASCADE davet token'ını da götürür: silinen davetin linki ölmeli."""
    from app.models import InvitationToken

    h = admin_headers()
    davetli = invite(h)
    db = SessionLocal()
    assert db.query(InvitationToken).filter(
        InvitationToken.user_id == davetli["id"]).count() == 1
    db.close()

    client.delete(f"/users/{davetli['id']}", headers=h)

    db = SessionLocal()
    kalan = db.query(InvitationToken).filter(
        InvitationToken.user_id == davetli["id"]).count()
    db.close()
    assert kalan == 0


# --- kullanılmış hesabın SİLİNEMEMESİ (K-34'ün kalbi) ---

def test_active_user_cannot_be_deleted():
    h = admin_headers()
    hedef = _active_sub_account_id(h)

    r = client.delete(f"/users/{hedef}", headers=h)
    assert r.status_code == 409
    assert "DISABLED" in r.json()["detail"]


def test_disabled_user_still_cannot_be_deleted():
    """Kapatmak silmeye giden bir ara adım DEĞİL — iz yine korunur."""
    h = admin_headers()
    hedef = _active_sub_account_id(h)
    client.patch(f"/users/{hedef}", json={"status": "DISABLED"}, headers=h)

    assert client.delete(f"/users/{hedef}", headers=h).status_code == 409


def test_delete_block_protects_the_audit_trail():
    """Engelin ASIL gerekçesi: log'un 'kim' bilgisi kaybolmasın (brief §6.3).

    Hesap silinseydi FK ON DELETE SET NULL yüzünden audit satırı kalır ama
    user_id'si NULL olurdu. Test, engel sayesinde izin bozulmadığını gösterir.
    """
    h = admin_headers()
    hedef = _active_sub_account_id(h)

    def iz_sayisi() -> int:
        # Mutlak sayı iddia edilemez: hesap paylaşımlı veritabanında başka
        # testlerin bıraktığı log satırlarına da sahip olabilir. Ölçülen şey
        # FARK — silme girişimi izi bozmuş mu, bozmamış mı.
        db = SessionLocal()
        n = db.query(AuditLog).filter(AuditLog.user_id == hedef).count()
        db.close()
        return n

    once = iz_sayisi()
    db = SessionLocal()
    db.add(AuditLog(user_id=hedef, action="CREATE", entity_type="course", entity_id=1))
    db.commit()
    db.close()
    assert iz_sayisi() == once + 1

    assert client.delete(f"/users/{hedef}", headers=h).status_code == 409
    assert iz_sayisi() == once + 1, "silme engellenmesine rağmen iz bozuldu"


def _active_sub_account_id(h) -> int:
    """ACTIVE bir alt hesap yaratır ve id'sini döner."""
    sub_headers()                                  # login olur → ACTIVE
    tumu = client.get("/users", headers=h).json()
    aktifler = [u for u in tumu if u["status"] == "ACTIVE" and u["role"] == "SUB_ACCOUNT"]
    assert aktifler, "ACTIVE alt hesap bulunamadı"
    return aktifler[-1]["id"]


# --- erişim kapatma ---

def test_disabled_user_cannot_log_in():
    """DISABLED yalnız bir etiket değil: giriş reddedilir."""
    email = f"kapatilacak_{uuid.uuid4().hex[:8]}@muh.example.edu.tr"
    pw = "kapatilan123"
    h = admin_headers()

    db = SessionLocal()
    from app.models import UserRole
    from app.security import hash_password
    admin = db.query(User).filter(User.email == "admin@muh.example.edu.tr").first()
    kullanici = User(
        workgroup_id=admin.workgroup_id, name="Kapatılacak", email=email,
        password_hash=hash_password(pw), role=UserRole.SUB_ACCOUNT,
        status=UserStatus.ACTIVE,
    )
    db.add(kullanici)
    db.commit()
    uid = kullanici.id
    db.close()

    assert client.post("/auth/login", json={"email": email, "password": pw}).status_code == 200

    assert client.patch(f"/users/{uid}", json={"status": "DISABLED"},
                        headers=h).status_code == 200

    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 403


def test_disabling_kills_the_existing_token():
    """Elindeki geçerli JWT bir sonraki istekte düşer — deps.py her istekte bakar.

    Bu, K-34'ün "erişimi kapatmak ANINDA etkilidir" iddiasının kanıtı;
    token süresinin dolmasını beklemek gerekmiyor.
    """
    h = admin_headers()
    sub_h = sub_headers()
    assert client.get("/courses", headers=sub_h).status_code == 200   # token çalışıyor

    kimlik = client.get("/auth/me", headers=sub_h).json()["id"]
    client.patch(f"/users/{kimlik}", json={"status": "DISABLED"}, headers=h)

    assert client.get("/courses", headers=sub_h).status_code == 403   # aynı token, artık geçmez


def test_disabled_user_can_be_reactivated():
    h = admin_headers()
    hedef = _active_sub_account_id(h)
    client.patch(f"/users/{hedef}", json={"status": "DISABLED"}, headers=h)
    assert get_user(h, hedef)["status"] == "DISABLED"

    client.patch(f"/users/{hedef}", json={"status": "ACTIVE"}, headers=h)
    assert get_user(h, hedef)["status"] == "ACTIVE"


# --- kendi hesabına dokunma kilidi ---

def test_admin_cannot_disable_self():
    h = admin_headers()
    kimlik = client.get("/auth/me", headers=h).json()["id"]
    r = client.patch(f"/users/{kimlik}", json={"status": "DISABLED"}, headers=h)
    assert r.status_code == 400
    assert "başka bir admin" in r.json()["detail"]


def test_admin_cannot_demote_self():
    """Son admin sorununun çözümü bu kilit: kendini düşüremezsen workgroup sahipsiz kalmaz."""
    h = admin_headers()
    kimlik = client.get("/auth/me", headers=h).json()["id"]
    r = client.patch(f"/users/{kimlik}", json={"role": "SUB_ACCOUNT"}, headers=h)
    assert r.status_code == 400
    assert get_user(h, kimlik)["role"] == "ADMIN"


def test_admin_can_rename_self():
    """Yasak yalnız rol ve durumda — ad değiştirmek kilitlenmeye yol açmaz."""
    h = admin_headers()
    kimlik = client.get("/auth/me", headers=h).json()["id"]
    r = client.patch(f"/users/{kimlik}", json={"name": "Yeni Ad"}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == "Yeni Ad"
    client.patch(f"/users/{kimlik}", json={"name": "Test Admin"}, headers=h)


# --- rol ve yetenek bayrakları (K-25) ---

def test_promoting_to_admin_clears_capability_flags():
    """ADMIN'de bayraklar false'a çekilir: rol düşerse sessizce yetkili kalmasın."""
    h = admin_headers()
    davetli = invite(h, can_manage_courses=True, can_manage_exams=True)

    r = client.patch(f"/users/{davetli['id']}", json={"role": "ADMIN"}, headers=h)
    assert r.status_code == 200
    # UserListItem ADMIN'i olduğu gibi raporlar (UserPublic'teki true'ya çevirme
    # yalnız /auth/me içindir) — DB'deki gerçek false olmalı.
    db = SessionLocal()
    ham = db.get(User, davetli["id"])
    assert ham.can_manage_courses is False and ham.can_manage_exams is False
    db.close()


def test_capability_flags_can_be_changed_for_sub_account():
    h = admin_headers()
    davetli = invite(h)
    r = client.patch(f"/users/{davetli['id']}",
                     json={"can_manage_weekly": True}, headers=h)
    assert r.status_code == 200 and r.json()["can_manage_weekly"] is True


# --- bölüm atamaları ---

def test_department_ids_are_replaced_wholesale():
    h = admin_headers()
    dep1, dep2 = make_department(h), make_department(h)
    davetli = invite(h, department_ids=[dep1["id"]])
    assert get_user(h, davetli["id"])["department_ids"] == [dep1["id"]]

    client.patch(f"/users/{davetli['id']}",
                 json={"department_ids": [dep2["id"]]}, headers=h)
    assert get_user(h, davetli["id"])["department_ids"] == [dep2["id"]]


def test_department_ids_can_be_emptied():
    h = admin_headers()
    dep = make_department(h)
    davetli = invite(h, department_ids=[dep["id"]])

    client.patch(f"/users/{davetli['id']}", json={"department_ids": []}, headers=h)
    assert get_user(h, davetli["id"])["department_ids"] == []


def test_foreign_department_is_rejected():
    h = admin_headers()
    davetli = invite(h)
    yabanci_dep = make_department(foreign_admin_headers())

    r = client.patch(f"/users/{davetli['id']}",
                     json={"department_ids": [yabanci_dep["id"]]}, headers=h)
    assert r.status_code == 400


# --- yetki ve izolasyon ---

def test_sub_account_cannot_manage_users():
    h = admin_headers()
    davetli = invite(h)
    sub_h = sub_headers(can_manage_courses=True)

    assert client.patch(f"/users/{davetli['id']}", json={"name": "X"},
                        headers=sub_h).status_code == 403
    assert client.delete(f"/users/{davetli['id']}", headers=sub_h).status_code == 403


def test_foreign_admin_sees_404_not_403():
    """Varlığını doğrulamak da sızıntıdır (brief §6.3)."""
    h = admin_headers()
    davetli = invite(h)
    yabanci = foreign_admin_headers()

    assert client.patch(f"/users/{davetli['id']}", json={"name": "Ele Geçti"},
                        headers=yabanci).status_code == 404
    assert client.delete(f"/users/{davetli['id']}", headers=yabanci).status_code == 404
