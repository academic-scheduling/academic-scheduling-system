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


# ------------------------------------------------------------------
# Mükerrer yerleşim koruması
# ------------------------------------------------------------------

def test_exact_duplicate_placement_is_rejected():
    """Gerçek veride görülen hata: aynı şubenin aynı gün/saatte iki özdeş
    satırı. Bir şubenin öğrencileri tek gruptur, aynı anda iki yerde olamaz."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    draft = create_draft(h, dep["id"], year=1)

    ilk = yerlestir(h, draft["id"], sec["id"], cls["id"], day=5, slot=1)
    assert ilk.status_code == 201, ilk.text

    ikinci = yerlestir(h, draft["id"], sec["id"], cls["id"], day=5, slot=1)
    assert ikinci.status_code == 409, ikinci.text
    assert "zaten var" in ikinci.json()["detail"]


def test_moving_onto_an_identical_placement_is_rejected():
    """Taşıma da mükerrer üretebilir: bir satırı ötekinin tam üstüne bırakmak."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    draft = create_draft(h, dep["id"], year=1)
    a = yerlestir(h, draft["id"], sec["id"], cls["id"], day=5, slot=1).json()
    b = yerlestir(h, draft["id"], sec["id"], cls["id"], day=5, slot=4).json()

    r = client.patch(f"/schedule-drafts/{draft['id']}/entries/{b['entry']['id']}",
                     json={"start_slot": 1}, headers=h)
    assert r.status_code == 409, r.text
    assert a["entry"]["id"] != b["entry"]["id"]


def test_overlapping_but_different_placement_is_still_allowed():
    """Kapsam DAR tutuldu: üst üste binen ama özdeş OLMAYAN yerleşim
    engellenmez — W5 uyarısı olarak bildirilmeye devam eder (K-03/K-05)."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    draft = create_draft(h, dep["id"], year=1)
    # İlk oturum 1-2. slotları kaplar
    ilk = client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": sec["id"], "classroom_id": cls["id"],
        "day_of_week": 5, "start_slot": 1, "slot_count": 2,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)
    assert ilk.status_code == 201, ilk.text

    # İkincisi 2. slotta başlar: ÜST ÜSTE BİNİYOR ama özdeş değil
    r = client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": sec["id"], "classroom_id": cls["id"],
        "day_of_week": 5, "start_slot": 2, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)
    assert r.status_code == 201, r.text          # engellenmez
    assert any(c["rule_id"] == "W5" for c in r.json()["conflicts"]), r.json()["conflicts"]


# ------------------------------------------------------------------
# Taslak satırları OKUMA yollarına sızmamalı
# ------------------------------------------------------------------

def test_draft_rows_do_not_leak_into_public_reads():
    """K-59'un gizlilik güvencesi OKUMA tarafında da tutmalı.

    Bulunma hikâyesi: `GET /weekly-entries` filtresizdi ve herkesin özel
    taslak satırlarını döndürüyordu. Sonucu iki katmanlı: (1) gizlilik ihlali,
    (2) aynı ders ızgarada birkaç kez çizilir — kullanıcının "aynı saatte 4
    tane aynı ders var" şikâyeti buydu (2 yayın + 2 taslak kopyası).
    """
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)

    # Başka bir hesap kendi taslağını açar (yayının kopyasını taşır)
    baskasi = make_account([dep["id"]], can_manage_weekly=True)
    draft = create_draft(baskasi, dep["id"], year=1)
    taslak_satirlari = {
        e["id"] for e in
        client.get(f"/schedule-drafts/{draft['id']}/entries", headers=baskasi).json()
    }
    assert taslak_satirlari, "taslak yayından kopya almalıydı"

    # Genel liste: yalnız yayın
    liste = {e["id"] for e in client.get(
        f"/weekly-entries?department_id={dep['id']}&year=1&semester=FALL",
        headers=h).json()}
    assert yayin_id in liste
    assert not (liste & taslak_satirlari), "taslak satırları genel listeye sızdı"

    # Export da aynı evreni görmeli
    r = client.get(f"/export/weekly?department_id={dep['id']}&format=csv", headers=h)
    assert r.status_code == 200, r.text
    # Kopyalar aynı dersi taşıdığı için satır sayısı üzerinden ölçüyoruz:
    # yayında 1 yerleşim varsa CSV'de (başlık + 1) satır olmalı.
    satirlar = [s for s in r.content.decode("utf-8-sig").splitlines() if s.strip()]
    assert len(satirlar) == 2, satirlar
