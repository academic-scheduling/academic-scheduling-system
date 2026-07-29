"""Sifre sifirlama akisi testleri (K-43, kontrat §1).

Sablon: kural setinin dort test sinifi (pozitif / negatif / sinir / atlama)
auth akisina uyarlanir — mutlu yol, gecersiz token, sinir (kullanilmis, dolmus),
ve yetki/durum atlamalari (PENDING, DISABLED).

Mail gonderimi her testte monkeypatch'lenir: SMTP'ye gercekten baglanmak
testleri Mailpit'in ayakta olmasina bagimli kilardi (test_wp1_invitations
ile ayni desen). Yakalanan ham token, kullanicinin mailde gorecegi seydir.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.db import SessionLocal
from app.models import AuditLog, PasswordResetToken, User, UserStatus
from app.security import hash_token, verify_password

client = TestClient(app)
ADMIN = {"email": "admin@muh.example.edu.tr", "password": "admin1234"}


def admin_headers():
    r = client.post("/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _unique_email():
    return f"reset_{uuid.uuid4().hex[:10]}@muh.example.edu.tr"


def make_active_user(password="baslangic123"):
    """Sifresi bilinen, ACTIVE bir kullanici yaratir ve (email, sifre) doner."""
    from app.security import hash_password

    email = _unique_email()
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == ADMIN["email"]).first()
        db.add(User(
            workgroup_id=admin.workgroup_id,
            name="Sifre Testi",
            email=email,
            password_hash=hash_password(password),
            role="SUB_ACCOUNT",
            status=UserStatus.ACTIVE,
        ))
        db.commit()
    finally:
        db.close()
    return email, password


def request_reset(monkeypatch, email):
    """forgot-password cagirir, maile giden HAM token'i dondurur (yoksa None)."""
    captured = {}
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda to_email, to_name, raw_token: captured.update(token=raw_token),
    )
    r = client.post("/auth/forgot-password", json={"email": email})
    assert r.status_code == 200, r.text
    return captured.get("token")


# ------------------------------------------------------------------
# 1) Mutlu yol
# ------------------------------------------------------------------
def test_full_reset_flow_changes_password(monkeypatch):
    email, eski = make_active_user()
    token = request_reset(monkeypatch, email)
    assert token, "ACTIVE hesaba mail gitmeliydi"

    # On-dogrulama: ekran acilirken hangi hesap oldugunu soyler, token yanmaz
    r = client.get(f"/auth/reset/{token}")
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email

    yeni = "yenisifre456"
    r = client.post("/auth/reset-password", json={"token": token, "password": yeni})
    assert r.status_code == 200, r.text

    # Yeni sifre calisir, eski calismaz
    assert client.post("/auth/login", json={"email": email, "password": yeni}).status_code == 200
    assert client.post("/auth/login", json={"email": email, "password": eski}).status_code == 401


def test_password_is_hashed_not_stored_plain(monkeypatch):
    """Brief §6.3: sifre asla duz metin saklanmaz."""
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)
    yeni = "hashlenmeli789"
    assert client.post("/auth/reset-password",
                       json={"token": token, "password": yeni}).status_code == 200

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user.password_hash != yeni
        assert verify_password(yeni, user.password_hash)
    finally:
        db.close()


# ------------------------------------------------------------------
# 2) Enumeration korumasi — var/yok ayirt edilmez
# ------------------------------------------------------------------
def test_unknown_email_returns_same_200(monkeypatch):
    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    bilinen_email, _ = make_active_user()

    r_yok = client.post("/auth/forgot-password", json={"email": "hicyok@muh.example.edu.tr"})
    r_var = client.post("/auth/forgot-password", json={"email": bilinen_email})

    # Ayni kod VE ayni govde: metin farki bile "kayitli mi" sorusunu cevaplardi
    assert r_yok.status_code == r_var.status_code == 200
    assert r_yok.json() == r_var.json()
    # Ama mail yalniz gercek hesaba gitti
    assert len(gonderildi) == 1


def test_forgot_password_is_public():
    """Kontrat §1: sifresini unutan giris yapamaz — bu uc token istemez."""
    r = client.post("/auth/forgot-password", json={"email": "biri@muh.example.edu.tr"})
    assert r.status_code == 200


# ------------------------------------------------------------------
# 3) Token gecerliligi: gecersiz / kullanilmis / dolmus
# ------------------------------------------------------------------
def test_invalid_token_rejected():
    assert client.get("/auth/reset/uydurma-token").status_code == 400
    r = client.post("/auth/reset-password",
                    json={"token": "uydurma-token", "password": "gecerli123"})
    assert r.status_code == 400


def test_token_is_single_use(monkeypatch):
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)

    assert client.post("/auth/reset-password",
                       json={"token": token, "password": "birinci123"}).status_code == 200
    # Ikinci kullanim: brief §6.3 "tek kullanimlik" sarti
    r = client.post("/auth/reset-password", json={"token": token, "password": "ikinci123"})
    assert r.status_code == 400
    # On-dogrulama ucu da yanmis token'i reddeder
    assert client.get(f"/auth/reset/{token}").status_code == 400


def test_expired_token_rejected(monkeypatch):
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)

    # Suresini gecmise cek (saati beklemek yerine)
    db = SessionLocal()
    try:
        row = db.query(PasswordResetToken).filter(
            PasswordResetToken.token_hash == hash_token(token)
        ).first()
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()

    assert client.get(f"/auth/reset/{token}").status_code == 400
    r = client.post("/auth/reset-password", json={"token": token, "password": "gecerli123"})
    assert r.status_code == 400


def test_preview_does_not_consume_token(monkeypatch):
    """K-24 deseni: token'i yakan tek yer reset-password'dur."""
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)

    # Uc kez on-dogrula — hicbiri tuketmemeli
    for _ in range(3):
        assert client.get(f"/auth/reset/{token}").status_code == 200
    assert client.post("/auth/reset-password",
                       json={"token": token, "password": "halagecerli1"}).status_code == 200


def test_new_request_invalidates_previous_token(monkeypatch):
    """Ayni anda birden cok gecerli link dolasmamali."""
    email, _ = make_active_user()
    ilk = request_reset(monkeypatch, email)
    ikinci = request_reset(monkeypatch, email)
    assert ilk != ikinci

    # Eski link olu, yeni link calisir
    assert client.get(f"/auth/reset/{ilk}").status_code == 400
    assert client.get(f"/auth/reset/{ikinci}").status_code == 200


def test_reset_burns_sibling_tokens(monkeypatch):
    """Sifre degistikten sonra bekleyen baska bir link hala calisMAMALI.

    Calissaydi, linki ele geciren kisi kullanici sifresini duzelttikten
    sonra tekrar degistirebilirdi.
    """
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)

    # Elle ikinci bir gecerli token uret (yeni istek eskiyi yakacagi icin)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        ikinci_ham = "elle-uretilmis-ikinci-token"
        db.add(PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(ikinci_ham),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        ))
        db.commit()
    finally:
        db.close()

    assert client.post("/auth/reset-password",
                       json={"token": token, "password": "yenisifre999"}).status_code == 200
    # Kardes token de yanmis olmali
    assert client.get(f"/auth/reset/{ikinci_ham}").status_code == 400


# ------------------------------------------------------------------
# 4) Hesap durumu atlamalari: PENDING ve DISABLED sifirlayamaz
# ------------------------------------------------------------------
def test_pending_account_gets_no_reset_mail(monkeypatch):
    """PENDING hesabin yolu davet linkidir, sifirlama degil."""
    gonderildi = []
    monkeypatch.setattr("app.routers.users.send_invitation_email", lambda *a, **k: None)
    email = _unique_email()
    assert client.post("/users/invite", json={"name": "Bekleyen", "email": email},
                       headers=admin_headers()).status_code == 201

    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    assert gonderildi == []


def test_disabled_account_gets_no_reset_mail(monkeypatch):
    """Erisimi kapatilmis hesap kendini sifirlayip geri aciyor olmamali."""
    email, _ = make_active_user()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        user.status = UserStatus.DISABLED
        db.commit()
    finally:
        db.close()

    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    assert gonderildi == []


def test_disabled_after_token_issued_cannot_reset(monkeypatch):
    """Token alindiktan SONRA hesap kapatilirsa sifirlama gecmemeli (TOCTOU)."""
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        user.status = UserStatus.DISABLED
        db.commit()
    finally:
        db.close()

    r = client.post("/auth/reset-password", json={"token": token, "password": "olmamali123"})
    assert r.status_code == 400


# ------------------------------------------------------------------
# 5) Dogrulama ve iz kaydi
# ------------------------------------------------------------------
def test_short_password_rejected(monkeypatch):
    """Sema siniri: en az 8 karakter (davet akisiyla ayni kural)."""
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)
    r = client.post("/auth/reset-password", json={"token": token, "password": "kisa"})
    assert r.status_code == 422


# ------------------------------------------------------------------
# 6) CAPTCHA (K-44)
# ------------------------------------------------------------------
def test_captcha_skipped_when_not_configured(monkeypatch):
    """Anahtar tanimli degilken dogrulama ATLANIR — yerel gelistirme ve
    testler internetsiz calisir (yukaridaki 15 testin dayanagi budur)."""
    from app import recaptcha

    monkeypatch.setattr(recaptcha.settings, "recaptcha_secret_key", "")
    assert recaptcha.is_enabled() is False
    # Token hic gonderilmese bile gecer
    assert recaptcha.verify_captcha(None) is True


def test_captcha_required_when_configured(monkeypatch):
    """Anahtar tanimliyken token'siz istek 400 — mail hic gonderilmez."""
    email, _ = make_active_user()
    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    # verify_captcha'yi router'in gordugu isimde degistir: token yoksa reddet
    monkeypatch.setattr(
        "app.routers.auth.verify_captcha",
        lambda token, ip=None: bool(token) and token == "gecerli-captcha",
    )

    r = client.post("/auth/forgot-password", json={"email": email})
    assert r.status_code == 400
    assert gonderildi == []


def test_valid_captcha_lets_request_through(monkeypatch):
    email, _ = make_active_user()
    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    monkeypatch.setattr(
        "app.routers.auth.verify_captcha",
        lambda token, ip=None: token == "gecerli-captcha",
    )

    r = client.post("/auth/forgot-password",
                    json={"email": email, "captcha_token": "gecerli-captcha"})
    assert r.status_code == 200
    assert len(gonderildi) == 1


def test_captcha_checked_before_email_lookup(monkeypatch):
    """CAPTCHA hatasi hicbir sey SIZDIRMAZ: e-posta daha sorgulanmadi bile.

    Bilinmeyen adres de kayitli adres de ayni 400'u alir.
    """
    email, _ = make_active_user()
    monkeypatch.setattr("app.routers.auth.verify_captcha", lambda token, ip=None: False)

    r_var = client.post("/auth/forgot-password", json={"email": email})
    r_yok = client.post("/auth/forgot-password", json={"email": "hicyok@muh.example.edu.tr"})
    assert r_var.status_code == r_yok.status_code == 400
    assert r_var.json() == r_yok.json()


def test_network_failure_fails_closed(monkeypatch):
    """Google'a ulasilamiyorsa istek GECMEZ (kapali kapi).

    Gecirseydik koruma, Google'i erisilemez kilarak atlatilabilirdi.
    """
    from app import recaptcha

    monkeypatch.setattr(recaptcha.settings, "recaptcha_secret_key", "bir-secret")

    def patlat(*a, **k):
        raise RuntimeError("ag yok")

    monkeypatch.setattr(recaptcha.httpx, "post", patlat)
    assert recaptcha.verify_captcha("herhangi-bir-token") is False


# ------------------------------------------------------------------
# 7) Hiz siniri (K-44)
# ------------------------------------------------------------------
def test_rate_limit_stops_mail_after_threshold(monkeypatch):
    """Saatlik sinir asilinca mail kesilir (mail bombardimani korumasi)."""
    from app.config import settings

    email, _ = make_active_user()
    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )

    limit = settings.password_reset_max_per_hour
    for _ in range(limit + 3):
        assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200

    assert len(gonderildi) == limit, "sinir kadar mail gitmeliydi, fazlasi degil"


def test_rate_limit_is_silent_preserves_enumeration_defense(monkeypatch):
    """Sinir asildiginda cevap DEGISMEZ — yoksa "429 aldim demek ki kayitli".

    Bu, K-43'un hesap sayimi korumasinin hiz siniriyla delinmedigini
    kanitlar: sinir yalnizca GERCEK ve ACTIVE hesaplarda tetiklenebilir.
    """
    monkeypatch.setattr("app.routers.auth.send_password_reset_email", lambda *a, **k: None)
    email, _ = make_active_user()

    # Siniri fazlasiyla as
    for _ in range(8):
        client.post("/auth/forgot-password", json={"email": email})

    r_sinirli = client.post("/auth/forgot-password", json={"email": email})
    r_bilinmeyen = client.post("/auth/forgot-password", json={"email": "hicyok@muh.example.edu.tr"})

    assert r_sinirli.status_code == r_bilinmeyen.status_code == 200
    assert r_sinirli.json() == r_bilinmeyen.json()


def test_rate_limit_is_per_account(monkeypatch):
    """Bir hesabin siniri baska hesabi etkilemez."""
    monkeypatch.setattr("app.routers.auth.send_password_reset_email", lambda *a, **k: None)
    kurban, _ = make_active_user()
    masum, _ = make_active_user()

    for _ in range(8):
        client.post("/auth/forgot-password", json={"email": kurban})

    # Masum hesap hala mail alabilmeli
    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    assert client.post("/auth/forgot-password", json={"email": masum}).status_code == 200
    assert len(gonderildi) == 1


def test_old_requests_fall_out_of_window(monkeypatch):
    """Bir saatten eski talepler sayilmaz — sinir kalici ceza degil."""
    monkeypatch.setattr("app.routers.auth.send_password_reset_email", lambda *a, **k: None)
    email, _ = make_active_user()

    for _ in range(8):
        client.post("/auth/forgot-password", json={"email": email})

    # Gecmisteki talepleri pencerenin disina it
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        eski = datetime.now(timezone.utc) - timedelta(hours=2)
        for tok in db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id
        ).all():
            tok.created_at = eski
        db.commit()
    finally:
        db.close()

    gonderildi = []
    monkeypatch.setattr(
        "app.routers.auth.send_password_reset_email",
        lambda *a, **k: gonderildi.append(1),
    )
    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    assert len(gonderildi) == 1, "pencere disindaki talepler sinira sayilmamali"


def test_reset_is_audited(monkeypatch):
    """K-37 deseni: iki eylem de loglanir, faili hesabin SAHIBIDIR."""
    email, _ = make_active_user()
    token = request_reset(monkeypatch, email)
    assert client.post("/auth/reset-password",
                       json={"token": token, "password": "izbirakir1"}).status_code == 200

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        actions = [
            r.action for r in
            db.query(AuditLog).filter(AuditLog.user_id == user.id).all()
        ]
        assert "RESET_REQUEST" in actions
        assert "RESET_PASSWORD" in actions
    finally:
        db.close()
