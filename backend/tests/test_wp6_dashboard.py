"""WP6 dashboard özet sayaçları — GET /dashboard/summary (kontrat §10, K-33).

Testler ortak veritabanında koşuyor: başka test dosyalarının bıraktığı kayıtlar
sayaçlarda görünür. Bu yüzden hiçbir test MUTLAK sayı iddia etmez — hepsi
"önce oku, bir şey yap, tekrar oku, FARKA bak" deseniyle çalışır. Mutlak sayı
iddia eden bir test, test sırası değişince kırılırdı.
"""

from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u
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
    """Sınavda `active` yok; DRAFT sınav da gerçek kayıttır, sayılır (K-33)."""
    h = admin_headers()
    course = make_course(h, make_department(h))
    lec = make_lecturer(h)
    once = summary(h)["exams"]

    r = client.post("/exams", json={
        "course_id": course["id"], "exam_type": "MIDTERM", "exam_date": "2026-11-12",
        "start_time": "10:00", "duration_minutes": 90, "classroom_ids": [],
        "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 201, r.text
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

def test_sub_account_cannot_read_summary():
    """Dashboard yalnız ADMIN'in (K-33); alt hesap bayrağı ne olursa olsun 403."""
    r = client.get("/dashboard/summary", headers=sub_headers(can_manage_courses=True))
    assert r.status_code == 403


def test_anonymous_cannot_read_summary():
    assert client.get("/dashboard/summary").status_code == 401


def test_foreign_workgroup_sees_only_its_own_counts():
    """K-04: yabancı admin bizim kayıtlarımızı saymaz."""
    h = admin_headers()
    yabanci = foreign_admin_headers()
    once = summary(yabanci)["departments"]

    make_department(h)                             # bizim workgroup'a ekliyoruz
    assert summary(yabanci)["departments"] == once, "sayaç workgroup'u aştı"
