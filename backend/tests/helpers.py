import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.db import SessionLocal
from app.models import User, UserRole, UserStatus, Workgroup
from app.security import hash_password

from app.models import User, UserRole, UserStatus, Workgroup, DepartmentMembership

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

def sub_headers(
    can_manage_classrooms: bool = False,
    department_ids: list[int] | None = None,
    can_manage_courses: bool = False,
    can_manage_weekly: bool = False,
    can_manage_exams: bool = False,
    can_manage_lecturers: bool = False,
):
    """Ana workgroup'ta SUB_ACCOUNT yaratır, login olur, header döndürür.

    K-25: yetenek bayraklarının hepsi VARSAYILAN OLARAK KAPALI. Her test
    hangi yetkiyle çalıştığını açıkça söyler — "kolaylık olsun" diye açık
    varsayılan vermek, yetki testlerinin gerçekte neyi kanıtladığını gizler.
    """
    db = SessionLocal()
    admin = db.query(User).filter(User.email == ADMIN["email"]).first()
    email = f"sub_{uuid.uuid4().hex[:8]}@muh.example.edu.tr"
    pw = "subhesap123"
    user = User(
        workgroup_id=admin.workgroup_id, name="Alt Hesap", email=email,
        password_hash=hash_password(pw), role=UserRole.SUB_ACCOUNT,
        status=UserStatus.ACTIVE,
        can_manage_classrooms=can_manage_classrooms,
        can_manage_courses=can_manage_courses,
        can_manage_weekly=can_manage_weekly,
        can_manage_exams=can_manage_exams,
        can_manage_lecturers=can_manage_lecturers,
    )
    db.add(user)
    db.flush()
    for dep_id in (department_ids or []):
        db.add(DepartmentMembership(user_id=user.id, department_id=dep_id))
    db.commit()
    db.close()
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

# ==================================================================
# K-59: yayına doğrudan satır yazma (yalnız TESTLER için)
# ==================================================================

class FakeResponse:
    """`client.post(...)` cevabını taklit eder.

    Eski testler `r.status_code`, `r.json()`, `r.text` bekliyordu. Yazma ucu
    kalktığı için gerçek bir HTTP cevabı yok; şekli koruyup çağrı yerlerini
    olduğu gibi bırakıyoruz.
    """

    def __init__(self, payload: dict, status_code: int = 201):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    @property
    def text(self) -> str:
        return str(self._payload)


def publish_weekly(section_id: int, **overrides) -> FakeResponse:
    """YAYINDA bir haftalık yerleşim üretir (draft_id NULL) ve save-anı
    çakışmalarını döndürür.

    Neden doğrudan DB: K-59 ile yayına yazan tek yol ONAYDIR
    (schedule-approvals). Eski `POST /weekly-entries` kaldırıldı — duran her
    kopyası onay adımını atlamanın bir yolu olurdu. Testlerin çoğunun derdi
    "programda şu yerleşim varken motor ne diyor"; onay akışını baştan sona
    kurmak o testlerin konusu değil, o yüzden kısa yoldan yayın satırı
    yazılıyor. Onay akışının KENDİSİ test_k59_* dosyalarında uçtan uca test
    edilir.
    """
    from app.conflict_service import check_weekly_save
    from app.models import DeliveryMode, SessionType, WeeklyScheduleEntry
    from app.schemas import WeeklyEntryOut

    alanlar = {
        "classroom_id": None, "day_of_week": 1, "start_slot": 3,
        "slot_count": 2, "session_type": "THEORY",
        "delivery_mode": "FACE_TO_FACE",
    }
    alanlar.update(overrides)

    db = SessionLocal()
    try:
        e = WeeklyScheduleEntry(
            draft_id=None,                      # NULL = yayında
            section_id=section_id,
            classroom_id=alanlar["classroom_id"],
            day_of_week=alanlar["day_of_week"],
            start_slot=alanlar["start_slot"],
            slot_count=alanlar["slot_count"],
            session_type=SessionType(alanlar["session_type"]),
            delivery_mode=DeliveryMode(alanlar["delivery_mode"]),
        )
        db.add(e)
        db.commit()
        db.refresh(e)
        conflicts = check_weekly_save(db, e)
        return FakeResponse({
            "entry": WeeklyEntryOut.model_validate(e).model_dump(mode="json"),
            "conflicts": conflicts,
        })
    finally:
        db.close()
