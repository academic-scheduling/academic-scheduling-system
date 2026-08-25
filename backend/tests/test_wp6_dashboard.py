"""WP6 dashboard özet sayaçları — GET /dashboard/summary (kontrat §10, K-33).

Testler ortak veritabanında koşuyor: başka test dosyalarının bıraktığı kayıtlar
sayaçlarda görünür. Bu yüzden hiçbir test MUTLAK sayı iddia etmez — hepsi
"önce oku, bir şey yap, tekrar oku, FARKA bak" deseniyle çalışır. Mutlak sayı
iddia eden bir test, test sırası değişince kırılırdı.
"""

from tests.helpers import (
    client, admin_headers, foreign_admin_headers, publish_exam, sub_headers, _u,
)
from tests.test_wp2_courses import make_department, make_lecturer, make_course, make_section


def summary(h) -> dict:
    r = client.get("/dashboard/summary", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# --- sözleşme ---

def test_summary_has_all_contract_fields():
    """Kontrat §10'un on alanı da dönmeli — B'nin mock'u bunlara güveniyor."""
    s = summary(admin_headers())
    for alan in ("departments", "classrooms", "lecturers", "courses",
                 "admins", "sub_accounts", "weekly_entries", "exams",
                 "unresolved_hard", "unresolved_warnings"):
        assert alan in s, f"{alan} alanı eksik"
        # K-82: admins/sub_accounts admin dışında None; ADMIN çağrısında hepsi int.
        assert isinstance(s[alan], int)


# --- sayaçlar gerçekten sayıyor mu ---

def test_department_increments_counter():
    h = admin_headers()
    once = summary(h)["departments"]
    make_department(h)
    assert summary(h)["departments"] == once + 1


def test_course_and_lecturer_increment_counters():
    h = admin_headers()
    once = summary(h)
    make_course(h, make_department(h))
    make_lecturer(h)
    sonra = summary(h)
    assert sonra["courses"] == once["courses"] + 1
    assert sonra["lecturers"] == once["lecturers"] + 1


# --- K-33: yalnız aktif kayıtlar sayılır ---

def test_passive_course_leaves_counter():
    """Pasife alınan ders sayaçtan düşer — Dersler ekranı da onu göstermiyor."""
    h = admin_headers()
    course = make_course(h, make_department(h))
    dolu = summary(h)["courses"]

    assert client.patch(f"/courses/{course['id']}", json={"active": False},
                        headers=h).status_code == 200
    assert summary(h)["courses"] == dolu - 1


def test_passive_department_leaves_counter():
    h = admin_headers()
    dep = make_department(h)
    dolu = summary(h)["departments"]

    assert client.patch(f"/departments/{dep['id']}", json={"active": False},
                        headers=h).status_code == 200
    assert summary(h)["departments"] == dolu - 1


# --- K-33: hesap sayaçları ---

def test_pending_invite_not_counted_until_active():
    """Davet edilen hesap ACTIVE olana dek sayılmaz (PENDING sayaca girmez)."""
    h = admin_headers()
    once = summary(h)["sub_accounts"]

    r = client.post("/users/invite", json={
        "name": "Bekleyen Hesap", "email": f"bekleyen_{_u('')}@muh.example.edu.tr",
        "role": "SUB_ACCOUNT",
    }, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "PENDING"

    assert summary(h)["sub_accounts"] == once, "PENDING hesap sayaca girmemeli"


def test_active_sub_account_is_counted():
    h = admin_headers()
    once = summary(h)["sub_accounts"]
    sub_headers()                                  # ACTIVE bir alt hesap yaratır
    assert summary(h)["sub_accounts"] == once + 1


def test_admin_counter_is_at_least_one():
    """Sayacı okuyan admin'in kendisi de sayılıyor."""
    assert summary(admin_headers())["admins"] >= 1


# --- K-03: sınav sayacı taslakları da sayar ---

def test_draft_exam_is_counted():
    """Sayaç YAYINDAKİ sınav takvimini anlatır (K-60).

    Eskiden "DRAFT sınav da gerçek kayıttır, sayılır" diyordu; K-60'tan sonra
    kapsamı `draft_id` çiziyor — kimsenin özel taslağı fakültenin sınav
    sayısını şişirmemeli (haftalık sayacın eşi).
    """
    h = admin_headers()
    course = make_course(h, make_department(h))
    lec = make_lecturer(h)
    once = summary(h)["exams"]

    publish_exam(course["id"], lec["id"])
    assert summary(h)["exams"] == once + 1


# --- motor bağlı: sayaçlar gerçek çakışmayı sayıyor (K-39) ---

def test_hard_counter_rises_with_a_real_conflict():
    """Gerçek W1 (derslik) çakışması yaratılır → unresolved_hard artar.

    Motor stub'ken bu sayaç sabit 0'dı ("çakışma yok" gibi okunuyordu, oysa
    henüz bakılmamıştı — K-33'ün bilinen sınırlaması). Artık gerçekten sayıyor.
    Mutlak sayı değil FARK ölçülür: ortak DB'de başka testlerin çakışmaları var.
    """
    from tests.test_wp3_weekly import make_classroom, make_entry, make_section

    h = admin_headers()
    once = summary(h)["unresolved_hard"]

    # Aynı derslik, aynı gün, aynı slot → W1 HARD (iki farklı şube)
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 3, "start_slot": 5}
    assert make_entry(h, make_section(h), **ortak).status_code == 201
    assert make_entry(h, make_section(h), **ortak).status_code == 201

    assert summary(h)["unresolved_hard"] > once


def test_conflict_counters_read_from_engine_seam(monkeypatch):
    """Sayaçlar motor dikişinden okunuyor — A-4 gelince router değişmeyecek."""
    from app import conflict_service

    monkeypatch.setattr(
        conflict_service, "scan_workgroup",
        lambda db, wg: {"hard": [{"rule_id": "W1"}, {"rule_id": "W2"}],
                        "warnings": [{"rule_id": "W7"}]},
    )
    s = summary(admin_headers())
    assert s["unresolved_hard"] == 2 and s["unresolved_warnings"] == 1


# --- yetki ve izolasyon ---

def test_sub_account_can_read_summary_without_user_counts():
    """K-82: özet artık herkesin (ana sayfa kartları) — ama kullanıcı sayaçları değil.

    Sayaçların çoğu alt hesabın zaten listeleyebildiği veriden türüyor (K-26),
    o yüzden saklamak anlamsızdı. Kullanıcı sayısı ise yönetim bilgisidir:
    None döner, sıfır DEĞİL — "kullanıcı yok" ile "sana gösterilmiyor"
    karışmasın.
    """
    s = summary(sub_headers(can_manage_courses=True))
    assert s["admins"] is None
    assert s["sub_accounts"] is None
    # Geri kalan sözleşme alanları alt hesapta da dolu gelmeli.
    for alan in ("departments", "classrooms", "lecturers", "courses",
                 "weekly_entries", "exams", "unresolved_hard",
                 "unresolved_warnings"):
        assert isinstance(s[alan], int), f"{alan} alt hesapta eksik"


def test_admin_still_sees_user_counts():
    """Admin'de iki sayaç dolu — kart çizilmesinin koşulu bu."""
    s = summary(admin_headers())
    assert isinstance(s["admins"], int) and s["admins"] >= 1
    assert isinstance(s["sub_accounts"], int)


def test_anonymous_cannot_read_summary():
    assert client.get("/dashboard/summary").status_code == 401


def test_foreign_workgroup_sees_only_its_own_counts():
    """K-04: yabancı admin bizim kayıtlarımızı saymaz."""
    h = admin_headers()
    yabanci = foreign_admin_headers()
    once = summary(yabanci)["departments"]

    make_department(h)                             # bizim workgroup'a ekliyoruz
    assert summary(yabanci)["departments"] == once, "sayaç workgroup'u aştı"
