# Bu dosyanin varligi, pytest'in 'backend' klasorunu sys.path'e ekler
# (testler 'from app.models import ...' yapabilsin diye).
#
# Ayrica TEST IZOLASYONU: testler dev veritabanini (scheduling) DEGIL, ayri
# bir 'scheduling_test' veritabanini kullanir. Boylece test paketi calisinca
# dev DB kirlenmez. DATABASE_URL, app.* import edilmeden ONCE ayarlanmali —
# app.config settings'i import aninda okur.

import os
from datetime import time

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://app:app_dev_password@localhost:5432/scheduling_test",
)

import pytest

from app.db import SessionLocal, engine
from app.models import Base, Slot, User, UserRole, UserStatus, Workgroup
from app.security import hash_password

# Slot cetveli (frontend/src/utils/slots.ts ile ayni): 9 slot, 45 dk ders.
_SLOT_TIMES = [
    (time(8, 30), time(9, 15)), (time(9, 30), time(10, 15)),
    (time(10, 30), time(11, 15)), (time(11, 30), time(12, 15)),
    (time(12, 30), time(13, 15)), (time(13, 30), time(14, 15)),
    (time(14, 30), time(15, 15)), (time(15, 30), time(16, 15)),
    (time(16, 30), time(17, 15)),
]


def _seed_baseline() -> None:
    """Taze test DB'sine testlerin varsaydigi minimum veri: slot 1..9 ve
    helpers.ADMIN ile ayni admin + workgroup (create_admin.py ile ayni)."""
    db = SessionLocal()
    try:
        if db.query(Slot).count() == 0:
            db.add_all([
                Slot(slot_no=i, start_time=start, end_time=end)
                for i, (start, end) in enumerate(_SLOT_TIMES, start=1)
            ])
        if db.query(User).filter(User.email == "admin@muh.example.edu.tr").first() is None:
            wg = Workgroup(name="Test Fakültesi", allowed_email_domain="muh.example.edu.tr")
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


@pytest.fixture(scope="session", autouse=True)
def _prepare_test_db():
    """Oturum basinda semayi sifirdan kur + baseline seed. Guvenlik: yanlislikla
    dev DB'ye baglanildiysa dur (isim 'test' icermiyorsa veri silinmesin)."""
    assert "test" in engine.url.database, (
        f"Test DB adı 'test' içermeli, '{engine.url.database}' değil — dev DB koruması"
    )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    _seed_baseline()
    yield
