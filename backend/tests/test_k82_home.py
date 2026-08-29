"""K-82 · Ana sayfa uçları: doluluk ısı haritası, kişisel işlem akışı, giriş damgaları.

Dashboard ana sayfaya taşındı ve üç yeni davranış doğdu:
  * `GET /dashboard/occupancy` — haftalık derslik doluluk ızgarası (9x5)
  * `GET /audit-logs/mine`     — "son işlemleriniz" (kapsam her zaman çağıran)
  * users.last_login_at / previous_login_at — Yönetim sütunu + kimlik kartı

`/dashboard/summary`'nin herkese açılması `test_wp6_dashboard.py`'de, yetki
sınıflandırması `test_k78_authz_matrix.py`'de denetleniyor.

Sayaç iddiaları hep FARKA bakar (ortak veritabanı; başka dosyaların bıraktığı
kayıtlar ızgarada da görünür).
"""

import uuid
from datetime import datetime, timedelta

from app.db import SessionLocal
from app.models import User, UserRole, UserStatus
from app.security import hash_password
from tests.helpers import (
    ADMIN, admin_headers, client, foreign_admin_headers, publish_weekly,
    sub_headers, _u,
)
from tests.test_k59_draft_api import (
    create_draft, make_classroom, make_course, make_department, make_lecturer,
    make_section,
)


def occupancy(h) -> dict:
    r = client.get("/dashboard/occupancy", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def hucre(g: dict, *, gun: int, slot: int) -> int:
    """grid[slot-1][gun-1] — okunurluk için tek yerde."""
    return g["grid"][slot - 1][gun - 1]


def setup_cohort(h):
    dep = make_department(h)
    lec = make_lecturer(h)
    cls = make_classroom(h)
    course = make_course(h, dep["id"])
    sec = make_section(h, course["id"], lec["id"])
    return dep, lec, cls, course, sec


# ==================================================================
# Doluluk ısı haritası
# ==================================================================

def test_occupancy_grid_has_the_shape_of_the_time_model():
    """9 slot x 5 gün — uydurma değil, slots.py + çalışma günü (brief §3.4)."""
    g = occupancy(admin_headers())
    assert len(g["grid"]) == 9
    assert all(len(satir) == 5 for satir in g["grid"])
    assert isinstance(g["classrooms"], int)


def test_entry_fills_every_slot_it_spans():
    """slot_count=2 olan giriş İKİ hücreyi doldurur — biri değil.

    Isı haritasının anlamı "o saatte derslik dolu mu"; iki saatlik ders ikinci
    saatte dersliği boşaltmıyor.
    """
    h = admin_headers()
    _dep, _lec, cls, _course, sec = setup_cohort(h)
    once = occupancy(h)

    publish_weekly(sec["id"], classroom_id=cls["id"],
                   day_of_week=2, start_slot=4, slot_count=2)

    sonra = occupancy(h)
    assert hucre(sonra, gun=2, slot=4) == hucre(once, gun=2, slot=4) + 1
    assert hucre(sonra, gun=2, slot=5) == hucre(once, gun=2, slot=5) + 1
    # Yayılmadığı slot etkilenmemeli.
    assert hucre(sonra, gun=2, slot=6) == hucre(once, gun=2, slot=6)


def test_same_classroom_twice_counts_once():
    """Hücrede AYRI DERSLİK sayılır, giriş değil.

    Aynı derslikte aynı saatte iki giriş zaten W1 çakışmasıdır; ikisini de
    saymak dersliği kapasitesinin üstünde dolu gösterirdi.
    """
    h = admin_headers()
    _dep, lec, cls, course, sec = setup_cohort(h)
    sec2 = make_section(h, course["id"], lec["id"], section_no=2)
    once = occupancy(h)

    publish_weekly(sec["id"], classroom_id=cls["id"], day_of_week=3,
                   start_slot=7, slot_count=1)
    publish_weekly(sec2["id"], classroom_id=cls["id"], day_of_week=3,
                   start_slot=7, slot_count=1)

    sonra = occupancy(h)
    assert hucre(sonra, gun=3, slot=7) == hucre(once, gun=3, slot=7) + 1


def test_classroomless_entry_is_not_counted():
    """Online derste derslik OLAMAZ (K-23) — dersliksiz giriş doluluk üretmez."""
    h = admin_headers()
    _dep, _lec, _cls, _course, sec = setup_cohort(h)
    once = occupancy(h)

    publish_weekly(sec["id"], classroom_id=None, day_of_week=4,
                   start_slot=2, slot_count=1, delivery_mode="ONLINE_SYNC")

    assert hucre(occupancy(h), gun=4, slot=2) == hucre(once, gun=4, slot=2)


def test_draft_entries_do_not_heat_the_map():
    """Kimsenin özel taslağı fakültenin doluluk haritasını şişirmemeli (K-59)."""
    h = admin_headers()
    dep, _lec, cls, _course, sec = setup_cohort(h)
    publish_weekly(sec["id"], classroom_id=cls["id"], day_of_week=1,
                   start_slot=1, slot_count=1)
    once = occupancy(h)

    # Taslak açmak yayındaki satırların KOPYASINI üretir; kopyalar draft_id
    # taşıdığı için ızgaraya girmemeli.
    create_draft(h, dep["id"])

    assert occupancy(h)["grid"] == once["grid"]


def test_occupancy_is_workgroup_isolated():
    """K-04: yabancı workgroup'un yerleşimi bizim haritamızı ısıtmaz."""
    h = admin_headers()
    yabanci = foreign_admin_headers()
    once = occupancy(yabanci)

    _dep, _lec, cls, _course, sec = setup_cohort(h)
    publish_weekly(sec["id"], classroom_id=cls["id"], day_of_week=5,
                   start_slot=9, slot_count=1)

    assert occupancy(yabanci)["grid"] == once["grid"]


def test_flagless_subaccount_can_read_occupancy():
    """Okuma workgroup genelinde serbest (K-26) — ısı haritası da öyle."""
    g = occupancy(sub_headers())
    assert len(g["grid"]) == 9


# ==================================================================
# "Son işlemleriniz"
# ==================================================================

def mine(h, limit=None) -> list[dict]:
    yol = "/audit-logs/mine" + (f"?limit={limit}" if limit else "")
    r = client.get(yol, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_my_log_shows_my_own_action():
    h = admin_headers()
    dep = make_department(h)
    ilk = mine(h)[0]
    assert ilk["entity_type"] == "department"
    assert ilk["entity_id"] == dep["id"]
    assert ilk["action"] == "CREATE"


def test_my_log_excludes_other_peoples_actions():
    """Akışın kapsamı ÇAĞIRAN — başkasının yaptığı iş buraya düşmez.

    (Başkasının yaptığı ve beni etkileyen değişiklikler ayrı bir akıştır:
    /schedule-changes, K-59.)
    """
    admin = admin_headers()
    alt = sub_headers(can_manage_courses=True)
    dep = make_department(admin)                 # admin'in işi

    assert all(
        not (r["entity_type"] == "department" and r["entity_id"] == dep["id"])
        for r in mine(alt)
    )


def test_my_log_is_newest_first_and_respects_limit():
    h = admin_headers()
    make_department(h)
    make_department(h)
    make_department(h)

    satirlar = mine(h, limit=2)
    assert len(satirlar) == 2
    assert satirlar[0]["created_at"] >= satirlar[1]["created_at"]


def test_brand_new_account_has_an_empty_log():
    """Hiç iş yapmamış hesapta akış boş döner — hata değil."""
    assert mine(sub_headers()) == []


# ==================================================================
# Giriş zaman damgaları
# ==================================================================

def _make_account(password="giristest123") -> tuple[str, str]:
    """Ana workgroup'ta, HİÇ giriş yapmamış bir alt hesap."""
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == ADMIN["email"]).first()
        email = f"login_{uuid.uuid4().hex[:8]}@muh.example.edu.tr"
        db.add(User(
            workgroup_id=admin.workgroup_id, name=f"Giris Testi {_u('')}",
            email=email, password_hash=hash_password(password),
            role=UserRole.SUB_ACCOUNT, status=UserStatus.ACTIVE,
        ))
        db.commit()
        return email, password
    finally:
        db.close()


def _login(email, password) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def _db_last_login(email: str):
    db = SessionLocal()
    try:
        return db.query(User).filter(User.email == email).first().last_login_at
    finally:
        db.close()


def test_first_login_has_no_previous_login():
    """İlk girişte gösterilecek bir "önceki" yok — null, sıfır tarih değil."""
    email, pw = _make_account()
    assert _login(email, pw)["previous_login_at"] is None
    assert _db_last_login(email) is not None       # ama son giriş yazıldı


def test_second_login_reports_the_first_one_as_previous():
    """Kimlik kartındaki damga BU oturumun değil, bir öncekinin olmalı.

    Tek kolonla yetinilseydi kullanıcı kendi kartında hep "az önce" görürdü.
    """
    email, pw = _make_account()
    _login(email, pw)
    ilk_giris = _db_last_login(email)

    ikinci = _login(email, pw)
    onceki = datetime.fromisoformat(ikinci["previous_login_at"])

    assert abs(onceki - ilk_giris) < timedelta(seconds=2)
    # Ve son giriş ileri taşındı: iki damga artık AYRI şeyler anlatıyor.
    assert _db_last_login(email) > ilk_giris


def test_failed_login_does_not_touch_the_stamps():
    """Şifre yanlışsa oturum açılmadı — damga da kıpırdamamalı."""
    email, pw = _make_account()
    _login(email, pw)
    once = _db_last_login(email)

    r = client.post("/auth/login", json={"email": email, "password": "yanlis123"})
    assert r.status_code == 401
    assert _db_last_login(email) == once


def test_management_list_exposes_last_login():
    """Yönetim tablosunun "Son giriş" sütunu (K-82) — admin'e görünür."""
    email, pw = _make_account()
    _login(email, pw)

    satirlar = client.get("/users", headers=admin_headers()).json()
    kayit = next(u for u in satirlar if u["email"] == email)
    assert kayit["last_login_at"] is not None

    # Hiç girmemiş hesapta null kalır (davet edildi, gelmedi).
    email2, _ = _make_account()
    kayit2 = next(u for u in client.get("/users", headers=admin_headers()).json()
                  if u["email"] == email2)
    assert kayit2["last_login_at"] is None
