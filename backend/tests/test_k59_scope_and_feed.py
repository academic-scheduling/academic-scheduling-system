"""K-59 adım 7 — taslak kapsamı + değişiklik akışı.

Kapsam denetimi (`_ensure_section_in_cohort`) iki şeyi birden korur:
  - **Yetki:** CE'nin sorumlusu, MATH'in dersini kendi taslağına koyup
    onaylatamaz (gönderim yetkisi yalnız CE üyeliğine bakıyor).
  - **Fark:** kapsam dışı satırın yayında karşılığı olmadığı için sonsuza dek
    "EKLENDİ" görünürdü.
Ortak ders (K-48) BU KURALIN İSTİSNASI DEĞİL: tüketen bölümün cohort'undan
filtreye takıldığı için yerleştirilebilir — K-49'un ruhuyla uyumlu.

Akış, ayrı bir bildirim tablosu OLMADAN onaylanmış taslak kayıtlarından türer.
"""

from app.db import SessionLocal
from app.models import DraftStatus, ScheduleDraft
from tests.helpers import _u, admin_headers, client
from tests.test_k59_draft_api import (
    base_setup, create_draft, make_course, make_department, make_lecturer,
    make_section, publish_entry,
)
from tests.test_k59_approval_api import make_account


def yerlestir(h, draft_id, section_id, classroom_id, day=2, slot=4):
    return client.post(f"/schedule-drafts/{draft_id}/entries", json={
        "section_id": section_id, "classroom_id": classroom_id,
        "day_of_week": day, "start_slot": slot, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)


# ------------------------------------------------------------------
# Kapsam
# ------------------------------------------------------------------

def test_course_outside_the_cohort_cannot_be_added():
    """Taslak CE/1/Güz; başka bölümün dersi buraya yerleştirilemez."""
    h = admin_headers()
    dep, lec, cls, _, _ = base_setup(h)
    yabanci_dep = make_department(h)
    yabanci_ders = make_course(h, yabanci_dep["id"], year=1)
    yabanci_sec = make_section(h, yabanci_ders["id"], lec["id"])

    draft = create_draft(h, dep["id"], year=1)
    r = yerlestir(h, draft["id"], yabanci_sec["id"], cls["id"])
    assert r.status_code == 400, r.text
    assert "kapsamında değil" in r.json()["detail"]


def test_course_from_another_year_cannot_be_added():
    """Aynı bölüm ama başka sınıf da kapsam dışıdır."""
    h = admin_headers()
    dep, lec, cls, _, _ = base_setup(h)
    ikinci_sinif = make_course(h, dep["id"], year=2)
    sec2 = make_section(h, ikinci_sinif["id"], lec["id"])

    draft = create_draft(h, dep["id"], year=1)
    assert yerlestir(h, draft["id"], sec2["id"], cls["id"]).status_code == 400


def test_shared_course_can_be_placed_by_the_consuming_cohort():
    """K-48/K-49: ortak dersi TÜKETEN bölüm kendi taslağında yerleştirebilir.

    Bu, kapsam kuralının istisnası değil sonucu: ek cohort da
    `cohort_course_filter`'a takılır.
    """
    h = admin_headers()
    sahip_dep, lec, cls, ortak, ortak_sec = base_setup(h)
    tuketen = make_department(h)
    r = client.patch(f"/courses/{ortak['id']}", json={
        "is_common": True,
        "cohorts": [{"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    assert r.status_code == 200, r.text

    # TÜKETEN bölümün taslağı — ders onun kendi dersi DEĞİL
    draft = create_draft(h, tuketen["id"], year=1)
    assert yerlestir(h, draft["id"], ortak_sec["id"], cls["id"]).status_code == 201


def test_scope_check_also_applies_to_a_normal_addition():
    """Kapsam içindeki ders elbette eklenebilir (kural fazla dar olmasın)."""
    h = admin_headers()
    dep, lec, cls, course, _ = base_setup(h)
    ikinci = make_section(h, course["id"], lec["id"], section_no=2)
    draft = create_draft(h, dep["id"], year=1)
    assert yerlestir(h, draft["id"], ikinci["id"], cls["id"]).status_code == 201


# ------------------------------------------------------------------
# Değişiklik akışı
# ------------------------------------------------------------------

def onayla(h_sahip, h_onaylayan, dep, cls, sec, *, day=3, slot=5):
    """Bir değişikliği onaydan geçirir; akışta görünmesi için gerekli."""
    draft = create_draft(h_sahip, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=h_sahip).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": day, "start_slot": slot}, headers=h_sahip)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "akış testi"}, headers=h_sahip)
    assert r.status_code == 200, r.text
    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=h_onaylayan)
    assert r.status_code == 200, r.text
    return draft


def test_feed_shows_approved_changes_of_my_department():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = onayla(sahip, onaylayan, dep, cls, sec)

    akis = client.get("/schedule-changes", headers=sahip).json()
    satir = next(x for x in akis if x["id"] == draft["id"])
    assert satir["department_id"] == dep["id"]
    assert "taşındı" in satir["summary"]
    assert satir["published_by"] == "Onay Testi"     # değişikliği yapan
    assert satir["approved_by"] == "Onay Testi"      # yayına alan (başka hesap)
    assert satir["published_at"] is not None


def test_feed_hides_other_departments_changes():
    """Üyesi olmadığım bölümün değişikliği akışıma düşmez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    sahip = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = onayla(sahip, onaylayan, dep, cls, sec)

    baska_dep = make_department(h)
    yabanci = make_account([baska_dep["id"]])
    assert draft["id"] not in [x["id"] for x in
                               client.get("/schedule-changes", headers=yabanci).json()]


def test_shared_course_change_reaches_the_consuming_department():
    """K-48/K-59'un asıl sebebi: ortak ders taşınınca TÜKETEN bölüm haberdar
    olmalı — kendi cohort'unda hiçbir şey yapmamış olsa bile."""
    h = admin_headers()
    dep, _, cls, course, sec = base_setup(h)
    tuketen = make_department(h)
    client.patch(f"/courses/{course['id']}", json={
        "is_common": True,
        "cohorts": [{"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = onayla(sahip, onaylayan, dep, cls, sec)

    # Tüketen bölümün üyesi: kendi bölümünde hiçbir onay yok ama akışta görüyor
    tuketen_uyesi = make_account([tuketen["id"]])
    akis = client.get("/schedule-changes", headers=tuketen_uyesi).json()
    satir = next((x for x in akis if x["id"] == draft["id"]), None)
    assert satir is not None, "ortak ders değişikliği tüketen bölüme ulaşmadı"
    assert tuketen["id"] in [d["id"] for d in satir["affected_departments"]]


def test_feed_is_empty_for_a_member_of_nothing():
    hicbiryerde = make_account([])
    assert client.get("/schedule-changes", headers=hicbiryerde).json() == []


def test_pending_and_rejected_drafts_are_not_in_the_feed():
    """Akış YAYINA GEÇENLERİ gösterir; bekleyen ya da reddedilen girmez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    sahip = make_account([dep["id"]], can_manage_weekly=True)

    draft = create_draft(sahip, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=sahip).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 4}, headers=sahip)
    client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=sahip)

    akis = client.get("/schedule-changes", headers=sahip).json()
    assert draft["id"] not in [x["id"] for x in akis]

    db = SessionLocal()
    try:
        assert db.get(ScheduleDraft, draft["id"]).status == DraftStatus.PENDING
    finally:
        db.close()
