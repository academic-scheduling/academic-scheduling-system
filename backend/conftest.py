"""Pytest kok konfigurasyonu — TEST IZOLASYONU.

Bu dosyanin iki isi var:

1. `backend/` klasorunu sys.path'e ekler (varligiyla; pytest conftest'in
   bulundugu dizini import yoluna koyar) — boylece testler `from app... import`
   yapabilir.

2. **Test izolasyonu (asil is):** Butun test paketini dev veritabaninin
   (`scheduling`) yaninda duran AYRI bir `scheduling_test` veritabaninda
   kosturur. Boylece testlerin `commit()` ettigi veri dev veritabanina ASLA
   dokunmaz — demo/gelistirme verisi kirlenmez.

   Nasil calisir:
   - `app.config.settings.database_url` dev URL'inden `<db>_test` turetilir.
   - Bu veritabani yoksa (bakim baglantisi `postgres` uzerinden) yaratilir.
   - `settings.database_url` + `DATABASE_URL` env test URL'ine cevrilir; boylece
     `app.db.engine`, `get_db`, `helpers.SessionLocal` ve testlerin actigi tum
     oturumlar tek bir yerden test veritabanina baglanir. Uygulama koduna veya
     test dosyalarina hicbir degisiklik gerekmez.
   - Her oturumun basinda sema tamamen silinip yeniden kurulur (crash'e
     dayanikli temiz baslangic) ve testlerin login oldugu admin hesabi + slot
     referans tablosu seed edilir.

   `test_wp0_smoke.py` zaten kendi transaction-rollback izolasyonunu yapiyordu;
   diger (API) testleri `commit()` edip temizlemedigi icin kirlilik onlardan
   geliyordu. Artik hepsi ortak test veritabaninda kosuyor.

Ortam degiskeni ile ozellestirme:
   - `TEST_DATABASE_URL` verilirse dogrudan o kullanilir (ornegin CI'da).
   - Aksi halde dev URL'inin veritabani adina `_test` eklenerek turetilir.
"""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

import pytest

from app.config import settings


# --------------------------------------------------------------------------
# 1) Dev URL'inden izole bir test veritabani URL'i turet
# --------------------------------------------------------------------------
_dev_url = make_url(settings.database_url)

_explicit = os.environ.get("TEST_DATABASE_URL")
if _explicit:
    _test_url = make_url(_explicit)
else:
    _test_db_name = f"{_dev_url.database or 'scheduling'}_test"
    _test_url = _dev_url.set(database=_test_db_name)

# GUVENLIK KILIDI: Asagida DROP SCHEMA public CASCADE calisiyor. Test URL'inin
# veritabani adi '_test' ile bitmiyorsa yanlislikla gercek bir veritabanini
# sifirlama riski var — o yuzden burada durduruyoruz.
assert (_test_url.database or "").endswith("_test"), (
    f"Test veritabani adi '_test' ile bitmeli, alinan: {_test_url.database!r}. "
    "Gercek veritabanini sifirlamamak icin durduruldu."
)


# --------------------------------------------------------------------------
# 2) Test veritabani yoksa yarat (bakim baglantisi: 'postgres')
# --------------------------------------------------------------------------
def _ensure_test_database() -> None:
    maintenance_url = _test_url.set(database="postgres")
    engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            already = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": _test_url.database},
            ).scalar()
            if not already:
                # Ad pg_database'te yok; kimlik dogrulandi (assert ustte).
                conn.execute(text(f'CREATE DATABASE "{_test_url.database}"'))
    finally:
        engine.dispose()


_ensure_test_database()


# --------------------------------------------------------------------------
# 3) Tum uygulamayi test veritabanina cevir
#    (app.db henuz import edilmedi; settings okundugunda test URL'ini gorecek)
#    Not: str(URL) parolayi '***' ile maskeler — engine o parolayla baglanamaz.
#    render_as_string(hide_password=False) gercek parolayi korur.
# --------------------------------------------------------------------------
_test_url_str = _test_url.render_as_string(hide_password=False)
settings.database_url = _test_url_str
os.environ["DATABASE_URL"] = _test_url_str


# --------------------------------------------------------------------------
# 4) Her oturumda temiz sema + minimal seed
# --------------------------------------------------------------------------
@pytest.fixture(scope="session", autouse=True)
def _prepare_test_database():
    """Oturum basinda semayi sifirdan kurar ve testlerin bagimli oldugu asgari
    veriyi (9 slot + admin hesabi) ekler.

    Importlar burada, cunku bu noktada `settings.database_url` artik test URL'ini
    tasiyor; `app.db.engine` dogru veritabanina baglanir.
    """
    from app.db import engine, SessionLocal
    from app.models import Base, Slot, User, UserRole, UserStatus, Workgroup
    from app.security import hash_password
    from app.conflicts.slots import SLOTS

    # Onceki kosumdan artik kalmis olsa da tam temiz baslangic (crash'e dayanikli).
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))

    Base.metadata.create_all(engine)

    db = SessionLocal()
    try:
        # Slot referans tablosu (migration'daki seed'in muadili; test_wp0_smoke
        # tam 9 satir bekler ve motor slot->saat cevrimine dayanir).
        db.add_all(
            Slot(slot_no=no, start_time=start, end_time=end)
            for no, (start, end) in SLOTS.items()
        )

        # Testlerin login oldugu admin (helpers.ADMIN ile ayni kimlik).
        wg = Workgroup(name="Test Fakultesi", allowed_email_domain="muh.example.edu.tr")
        db.add(wg)
        db.flush()
        admin = User(
            workgroup_id=wg.id,
            name="Test Admin",
            email="admin@muh.example.edu.tr",
            password_hash=hash_password("admin1234"),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
        )
        db.add(admin)
        db.flush()
        wg.created_by = admin.id
        db.commit()
    finally:
        db.close()

    yield
    # Test verisi scheduling_test'te kalir; dev veritabanina hicbir sekilde
    # dokunulmaz. Bir sonraki kosum bastaki DROP SCHEMA ile sifirlar.


# ---------------------------------------------------------------------------
# POSTA SUSTURMA (K-86) — testler ASLA gercek mail gondermez.
# ---------------------------------------------------------------------------
# Bazi testler (test_wp6_users, test_wp6_audit_logs) davet ucunu cagiriyor ama
# mailer'i taklit etmiyor; gonderim gercekten deneniyordu. Mailpit ayakta
# oldugu surece bu gorunmezdi -- mail bir yere dusuyor, kimse fark etmiyordu.
# .env gercek bir SMTP'ye cevrildigi anda ayni testler GERCEK mail gondermeye
# baslar: var olmayan adreslere onlarca deneme, her kosumda. Yeni bir gonderen
# hesabinda geri donen mailler itibari dogrudan zedeler.
#
# Cozum tek testte degil burada: _send butun oturum boyunca degistirilir, yani
# hangi test ne yaparsa yapsin mail makineden CIKAMAZ. Testler kendi
# monkeypatch'lerini yapmaya devam edebilir; bu onlarin altinda ikinci bir
# emniyet katmani.
@pytest.fixture(autouse=True, scope="session")
def postayi_sustur():
    """Oturum boyunca SMTP gonderimini keser; gonderilenleri listede tutar."""
    import app.mailer

    gonderilenler: list[dict] = []
    orijinal = app.mailer._send

    def sahte_send(to_email, subject, body, reply_to=None, html_body=None):
        gonderilenler.append({
            "to": to_email, "subject": subject, "body": body,
            "reply_to": reply_to, "html": html_body,
        })

    app.mailer._send = sahte_send
    try:
        yield gonderilenler
    finally:
        app.mailer._send = orijinal
