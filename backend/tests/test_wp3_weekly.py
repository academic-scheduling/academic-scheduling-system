"""WP3 haftalık program testleri — kontrat §7, K-14/K-19/K-20 + K-59.

**K-59 sonrası:** yayına doğrudan yazan uçlar KALDIRILDI. Buradaki doğrulama
kuralları (slot penceresi, K-23 online/derslik, çapraz-FK izolasyonu, alan
sınırları) artık TASLAK ucunda sınanır — kural aynı, kapı değişti. Taslak
yaşam döngüsünün kendisi `test_k59_draft_api.py` ve `test_k59_approval_api.py`
dosyalarında uçtan uca test edilir.

Okuma ucu (GET /weekly-entries) ve ders özelliği değişimi burada kalır.
"""

from tests.helpers import (
    client, admin_headers, foreign_admin_headers, sub_headers, _u,
    publish_weekly,
)


# --- kurulum yardımcıları (test_wp4_exams.py deseni) ---

def make_department(h):
    r = client.post("/departments", json={"name": "Haftalık Bölüm", "code": _u("HB")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_lecturer(h):
    r = client.post("/lecturers", json={"full_name": f"Dr. Haftalık Hoca {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_classroom(h, capacity=90):
    r = client.post("/buildings", json={"name": f"Haftalık Bina {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    r = client.post("/classrooms", json={
        "building_id": r.json()["id"], "room_code": _u("D"), "capacity": capacity,
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_section(h, dep=None, lecturer=None, expected=30):
    """Ders + tek şube kurar; şube dict'ine course/lecturer/department gömer."""
    dep = dep or make_department(h)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 2, "semester": "FALL",
        "code": _u("HD"), "name": "Haftalık Ders",
        "hours_theory": 3, "hours_practice": 2, "hours_lab": 0,   # K-20: T+U+L
    }, headers=h)
    assert r.status_code == 201, r.text
    course = r.json()
    lec = lecturer or make_lecturer(h)
    r = client.post(f"/courses/{course['id']}/sections", json={
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": expected,
    }, headers=h)
    assert r.status_code == 201, r.text
    section = r.json()
    section["course"] = course
    section["lecturer"] = lec
    section["department"] = dep
    return section


def make_entry(h, section, **overrides):
    """K-59: eskiden `POST /weekly-entries` çağırırdı; o uç kaldırıldı
    (yayına yazan tek yol onaydır). Motor testleri "programda şu yerleşim
    varken ne oluyor" diye sorduğu için doğrudan yayın satırı yazılır."""
    return publish_weekly(section["id"], **overrides)


def make_draft(h, section):
    """Şubenin cohort'u için taslak açar (make_section: yıl 2, Güz)."""
    r = client.post("/schedule-drafts", json={
        "department_id": section["department"]["id"], "year": 2, "semester": "FALL",
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def add_entry(h, draft, section, **overrides):
    """K-59: yerleşim TASLAĞIN içine eklenir; doğrulama kuralları burada koşar."""
    body = {
        "section_id": section["id"], "classroom_id": None,
        "day_of_week": 1, "start_slot": 3, "slot_count": 2,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }
    body.update(overrides)
    return client.post(f"/schedule-drafts/{draft['id']}/entries", json=body, headers=h)


def patch_entry(h, draft, entry_id, body):
    return client.patch(f"/schedule-drafts/{draft['id']}/entries/{entry_id}",
                        json=body, headers=h)


# --- kayıt (save) ---

def test_create_entry_draft_with_conflicts_field():
    h = admin_headers()
    section = make_section(h)
    r = make_entry(h, section)
    assert r.status_code == 201, r.text
    body = r.json()
    assert "status" not in body["entry"]        # K-59: satırın kendi durumu yok
    assert body["conflicts"] == []
    # kontrat §7: iç içe section → course şekli
    assert body["entry"]["section"]["id"] == section["id"]
    assert body["entry"]["section"]["course"]["code"] == section["course"]["code"]
    assert body["entry"]["classroom"] is None


def test_entry_with_classroom():
    h = admin_headers()
    room = make_classroom(h)
    r = make_entry(h, make_section(h), classroom_id=room["id"])
    assert r.status_code == 201, r.text
    assert r.json()["entry"]["classroom"]["id"] == room["id"]
    assert r.json()["entry"]["classroom"]["capacity"] == 90     # W7 kapasite kuralı buna bakacak


def test_online_async_entry_without_classroom():
    """K-19: asenkron giriş normal gün/saat taşır, dersliksiz geçerlidir."""
    r = make_entry(admin_headers(), make_section(admin_headers()),
                   delivery_mode="ONLINE_ASYNC", classroom_id=None)
    assert r.status_code == 201, r.text
    assert r.json()["entry"]["delivery_mode"] == "ONLINE_ASYNC"


def test_online_entry_rejects_classroom():
    """K-23: hibrit yok — online girişte derslik gönderilemez."""
    h = admin_headers()
    section = make_section(h)
    room = make_classroom(h)
    d = make_draft(h, section)
    assert add_entry(h, d, section, delivery_mode="ONLINE_SYNC",
                     classroom_id=room["id"]).status_code == 400
    assert add_entry(h, d, section, delivery_mode="ONLINE_ASYNC",
                     classroom_id=room["id"]).status_code == 400
    assert add_entry(h, d, section, delivery_mode="ONLINE_SYNC",
                     classroom_id=None).status_code == 201       # dersliksiz online: geçerli


def test_patch_to_online_with_existing_classroom_rejected():
    """K-23 kontrolü gelen + MEVCUT alanların birleşimi üzerinden yapılır."""
    h = admin_headers()
    section = make_section(h)
    room = make_classroom(h)
    d = make_draft(h, section)
    entry = add_entry(h, d, section, classroom_id=room["id"]).json()["entry"]

    # yalnız delivery_mode gelir; kayıttaki derslik dolu → 400
    assert patch_entry(h, d, entry["id"],
                       {"delivery_mode": "ONLINE_SYNC"}).status_code == 400

    # dersliği aynı istekte temizlersen geçerli (kullanıcının çıkış yolu)
    r = patch_entry(h, d, entry["id"],
                    {"delivery_mode": "ONLINE_SYNC", "classroom_id": None})
    assert r.status_code == 200
    assert r.json()["entry"]["classroom"] is None


def test_slot_window_overflow_rejected():
    """Taşma API'de temiz 400 verir; DB CHECK'e düşüp 500 olmaz."""
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    assert add_entry(h, d, section, start_slot=8, slot_count=3).status_code == 400  # 8+3-1=10 > 9
    assert add_entry(h, d, section, start_slot=8, slot_count=2).status_code == 201  # 8+2-1=9 sınır


def test_field_bounds_rejected():
    """Alan sınırları Pydantic'te yakalanır → 422 (400 değil)."""
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    assert add_entry(h, d, section, day_of_week=6).status_code == 422     # hafta sonu yok
    assert add_entry(h, d, section, day_of_week=0).status_code == 422
    assert add_entry(h, d, section, start_slot=10).status_code == 422
    assert add_entry(h, d, section, slot_count=0).status_code == 422


# --- izolasyon ve yetki ---

def test_unauthenticated_rejected():
    assert client.get("/weekly-entries").status_code == 401
    assert client.post("/schedule-drafts", json={}).status_code == 401


def test_foreign_section_rejected():
    h = admin_headers()
    foreign_section = make_section(foreign_admin_headers())
    d = make_draft(h, make_section(h))
    # govdedeki FK yabanci workgroup'tan -> 400 (varlik sizdirmadan reddedilir)
    assert add_entry(h, d, foreign_section).status_code == 400


def test_foreign_classroom_rejected():
    foreign_room = make_classroom(foreign_admin_headers())
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    assert add_entry(h, d, section, classroom_id=foreign_room["id"]).status_code == 400


def test_foreign_entry_hidden():
    """Yabancı workgroup'un girişi bizim için YOKTUR (404, varlık sızdırmama)."""
    h_foreign = foreign_admin_headers()
    entry_id = make_entry(h_foreign, make_section(h_foreign)).json()["entry"]["id"]
    h = admin_headers()
    # K-59: yazma uclari kalkti; kalan garanti OKUMADA -- yabanci satir
    # listemizde gorunmez (varlik sizdirmama).
    assert entry_id not in [e["id"] for e in client.get("/weekly-entries", headers=h).json()]


def test_sub_account_membership_rules():
    """K-59: üyelik boyutu artık YERLEŞTİRMEDE değil ONAYA GÖNDERMEDE aranır.

    Taslak açmak ve içine yazmak yetki istemez — özel taslak kimseyi etkilemez.
    Yayına dokunma niyeti (submit) `can_manage_weekly` + bölüm üyeliği ister.
    """
    h = admin_headers()
    dep_a, dep_b = make_department(h), make_department(h)
    sec_a, sec_b = make_section(h, dep=dep_a), make_section(h, dep=dep_b)
    make_entry(h, sec_a, day_of_week=2)        # admin her iki bölüme de birer
    make_entry(h, sec_b, day_of_week=3)        # YAYIN satırı koyar

    h_sub = sub_headers(department_ids=[dep_a["id"]], can_manage_weekly=True)

    # İkisinde de taslak açıp yazabilir (kum havuzu)
    d_a = make_draft(h_sub, sec_a)
    d_b = make_draft(h_sub, sec_b)
    assert add_entry(h_sub, d_a, sec_a, day_of_week=4, start_slot=1).status_code == 201
    assert add_entry(h_sub, d_b, sec_b, day_of_week=4, start_slot=1).status_code == 201

    # Ama onaya YALNIZ üyesi olduğu bölümde gönderebilir
    assert client.post(f"/schedule-drafts/{d_a['id']}/submit",
                       json={}, headers=h_sub).status_code == 200
    assert client.post(f"/schedule-drafts/{d_b['id']}/submit",
                       json={}, headers=h_sub).status_code == 403

    # K-26: dep_b'ye yazamaz ama GÖRÜR — çakışmayı çözebilmek için şart.
    sec_ids = [e["section"]["id"] for e in client.get("/weekly-entries", headers=h_sub).json()]
    assert sec_a["id"] in sec_ids and sec_b["id"] in sec_ids


# --- düzenleme (taslak içinde) ---

def test_patch_updates_fields():
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    entry = add_entry(h, d, section).json()["entry"]
    r = patch_entry(h, d, entry["id"], {"day_of_week": 3, "session_type": "PRACTICE"})
    assert r.status_code == 200, r.text
    body = r.json()["entry"]
    assert body["day_of_week"] == 3 and body["session_type"] == "PRACTICE"
    assert body["start_slot"] == 3          # dokunulmayan alan korunur (exclude_unset)


def test_patch_overflow_checks_combined_fields():
    """Taşma, GELEN + MEVCUT alanların birleşimi üzerinden hesaplanır."""
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    entry = add_entry(h, d, section, start_slot=8, slot_count=1).json()["entry"]
    # yalnız slot_count gelir; mevcut start_slot=8 ile 8+4-1=11 > 9 → 400
    assert patch_entry(h, d, entry["id"], {"slot_count": 4}).status_code == 400


def test_patch_can_clear_classroom():
    """classroom_id: null → dersliği kaldırır; göndermemek → korur (exclude_unset)."""
    h = admin_headers()
    section = make_section(h)
    room = make_classroom(h)
    d = make_draft(h, section)
    entry = add_entry(h, d, section, classroom_id=room["id"]).json()["entry"]

    r = patch_entry(h, d, entry["id"], {"slot_count": 1})
    assert r.json()["entry"]["classroom"]["id"] == room["id"]      # dokunulmadı → korundu

    r = patch_entry(h, d, entry["id"], {"classroom_id": None})
    assert r.json()["entry"]["classroom"] is None                  # açıkça null → kaldırıldı


# --- motor kablolaması (K-22 dikişi) ---

def _fake_conflict(severity, rule_id="W1"):
    return {"severity": severity, "rule_id": rule_id,
            "message": "test çakışması", "affected": []}


def test_save_returns_engine_conflicts(monkeypatch):
    """Save anında conflicts dolu gelse bile kayıt BAŞARILIDIR (K-03'ün kalbi).

    K-59: dikiş artık taslak ucunda — hedef modül değişti, kural değişmedi.
    """
    monkeypatch.setattr("app.routers.schedule_drafts.check_weekly_save",
                        lambda *a, **k: [_fake_conflict("HARD")])
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    r = add_entry(h, d, section)
    assert r.status_code == 201, r.text          # HARD olmasına rağmen kaydedildi
    assert r.json()["conflicts"][0]["rule_id"] == "W1"


def test_submit_blocked_by_hard_conflict(monkeypatch):
    """HARD çakışma onaya göndermeyi engeller (K-03 aynen, kapı değişti)."""
    monkeypatch.setattr(
        "app.routers.schedule_drafts.scan_draft",
        lambda *a, **k: {"hard": [_fake_conflict("HARD")], "warnings": []})
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    add_entry(h, d, section)
    r = client.post(f"/schedule-drafts/{d['id']}/submit", json={}, headers=h)
    assert r.status_code == 409, r.text
    assert r.json()["conflicts"][0]["rule_id"] == "W1"


def test_submit_warning_does_not_block(monkeypatch):
    """WARNING engellemez, görünür kalır (K-05)."""
    monkeypatch.setattr(
        "app.routers.schedule_drafts.scan_draft",
        lambda *a, **k: {"hard": [], "warnings": [_fake_conflict("WARNING", "W8")]})
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    add_entry(h, d, section)
    r = client.post(f"/schedule-drafts/{d['id']}/submit", json={}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["warnings"][0]["rule_id"] == "W8"


def test_filters():
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    room = make_classroom(h)
    sec1 = make_section(h, dep=dep, lecturer=lec)
    sec2 = make_section(h, dep=dep)                     # farklı hoca

    e1 = make_entry(h, sec1, day_of_week=1, start_slot=1,
                    classroom_id=room["id"]).json()["entry"]
    e2 = make_entry(h, sec2, day_of_week=2, start_slot=1).json()["entry"]

    def ids(qs):
        return [e["id"] for e in client.get(f"/weekly-entries?{qs}", headers=h).json()]

    assert ids(f"department_id={dep['id']}") == [e1["id"], e2["id"]]   # gün sırasına göre
    assert ids(f"classroom_id={room['id']}") == [e1["id"]]
    assert ids(f"lecturer_id={lec['id']}") == [e1["id"]]              # hoca şubeden gelir (K-14)
    assert ids(f"department_id={dep['id']}&year=2&semester=FALL") == [e1["id"], e2["id"]]
    assert ids(f"department_id={dep['id']}&year=3") == []


# --- ders özelliği değişince yerleşim ---
# K-59: "yayınlanmış" artık `draft_id IS NULL`. Programa ETKİ EDEN alan
# (online/T+U+L saat) değişimi, dersin YAYINDA yerleşimi varsa reddedilir;
# taslaklardaki özel kopyalar sayılmaz ve silinmez (başkasının işi).

def _entries_of(h, section):
    dep = section["department"]["id"]
    return client.get(
        f"/weekly-entries?department_id={dep}&year=2&semester=FALL", headers=h
    ).json()


def test_scheduling_change_blocked_by_published_entry():
    h = admin_headers()
    section = make_section(h)
    room = make_classroom(h)
    eid = make_entry(h, section, classroom_id=room["id"]).json()["entry"]["id"]
    r = client.patch(f"/courses/{section['course']['id']}",
                     json={"theory_online": True}, headers=h)
    assert r.status_code == 409, r.text
    assert any(e["id"] == eid for e in _entries_of(h, section))   # korunur


def test_nonscheduling_change_keeps_entry():
    h = admin_headers()
    section = make_section(h)
    eid = make_entry(h, section).json()["entry"]["id"]
    r = client.patch(f"/courses/{section['course']['id']}",
                     json={"name": "Yeni Ders Adı"}, headers=h)
    assert r.status_code == 200, r.text
    assert any(e["id"] == eid for e in _entries_of(h, section))


def test_scheduling_change_allowed_when_nothing_published():
    """Yayında yerleşim yoksa değişiklik serbest; taslaktaki özel kopya
    engellemez ve SİLİNMEZ (K-59: başkasının işini sessizce yok etme)."""
    h = admin_headers()
    section = make_section(h)
    d = make_draft(h, section)
    entry = add_entry(h, d, section).json()["entry"]

    r = client.patch(f"/courses/{section['course']['id']}",
                     json={"theory_online": True}, headers=h)
    assert r.status_code == 200, r.text

    kalan = client.get(f"/schedule-drafts/{d['id']}/entries", headers=h).json()
    assert entry["id"] in [e["id"] for e in kalan]
