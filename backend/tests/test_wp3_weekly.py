"""WP3 haftalık program API testleri — kontrat §7, K-03/K-14/K-19/K-20.

Çakışma motoru henüz stub (conflict_service, K-22): kayıt/submit akışının
motor kablolaması monkeypatch ile sahte sonuç döndürerek test edilir —
C'nin gerçek motoru takıldığında bu testler değişmeden geçerli kalır.
"""

from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u


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
    body = {
        "section_id": section["id"], "classroom_id": None,
        "day_of_week": 1, "start_slot": 3, "slot_count": 2,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }
    body.update(overrides)
    return client.post("/weekly-entries", json=body, headers=h)


# --- kayıt (save) ---

def test_create_entry_draft_with_conflicts_field():
    h = admin_headers()
    section = make_section(h)
    r = make_entry(h, section)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["entry"]["status"] == "DRAFT"
    assert body["conflicts"] == []                     # stub: her zaman temiz (K-22)
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
    assert make_entry(h, section, delivery_mode="ONLINE_SYNC",
                      classroom_id=room["id"]).status_code == 400
    assert make_entry(h, section, delivery_mode="ONLINE_ASYNC",
                      classroom_id=room["id"]).status_code == 400
    assert make_entry(h, section, delivery_mode="ONLINE_SYNC",
                      classroom_id=None).status_code == 201      # dersliksiz online: geçerli


def test_patch_to_online_with_existing_classroom_rejected():
    """K-23 kontrolü gelen + MEVCUT alanların birleşimi üzerinden yapılır."""
    h = admin_headers()
    room = make_classroom(h)
    entry = make_entry(h, make_section(h), classroom_id=room["id"]).json()["entry"]

    # yalnız delivery_mode gelir; kayıttaki derslik dolu → 400
    assert client.patch(f"/weekly-entries/{entry['id']}",
                        json={"delivery_mode": "ONLINE_SYNC"}, headers=h).status_code == 400

    # dersliği aynı istekte temizlersen geçerli (kullanıcının çıkış yolu)
    r = client.patch(f"/weekly-entries/{entry['id']}",
                     json={"delivery_mode": "ONLINE_SYNC", "classroom_id": None}, headers=h)
    assert r.status_code == 200
    assert r.json()["entry"]["classroom"] is None


def test_slot_window_overflow_rejected():
    """Taşma API'de temiz 400 verir; DB CHECK'e düşüp 500 olmaz."""
    h = admin_headers()
    section = make_section(h)
    assert make_entry(h, section, start_slot=8, slot_count=3).status_code == 400   # 8+3-1=10 > 9
    assert make_entry(h, section, start_slot=8, slot_count=2).status_code == 201   # 8+2-1=9 sınır


def test_field_bounds_rejected():
    """Alan sınırları Pydantic'te yakalanır → 422 (400 değil)."""
    h = admin_headers()
    section = make_section(h)
    assert make_entry(h, section, day_of_week=6).status_code == 422       # hafta sonu yok
    assert make_entry(h, section, day_of_week=0).status_code == 422
    assert make_entry(h, section, start_slot=10).status_code == 422
    assert make_entry(h, section, slot_count=0).status_code == 422


# --- izolasyon ve yetki ---

def test_unauthenticated_rejected():
    assert client.get("/weekly-entries").status_code == 401
    assert client.post("/weekly-entries", json={}).status_code == 401


def test_foreign_section_rejected():
    h_foreign = foreign_admin_headers()
    foreign_section = make_section(h_foreign)
    assert make_entry(admin_headers(), foreign_section).status_code == 400   # gövde FK'sı yabancı


def test_foreign_classroom_rejected():
    h_foreign = foreign_admin_headers()
    foreign_room = make_classroom(h_foreign)
    h = admin_headers()
    assert make_entry(h, make_section(h), classroom_id=foreign_room["id"]).status_code == 400


def test_foreign_entry_hidden():
    """Yabancı workgroup'un girişi bizim için YOKTUR (404, varlık sızdırmama)."""
    h_foreign = foreign_admin_headers()
    entry_id = make_entry(h_foreign, make_section(h_foreign)).json()["entry"]["id"]
    h = admin_headers()
    assert client.patch(f"/weekly-entries/{entry_id}",
                        json={"slot_count": 1}, headers=h).status_code == 404
    assert client.delete(f"/weekly-entries/{entry_id}", headers=h).status_code == 404
    assert client.post(f"/weekly-entries/{entry_id}/revert-to-draft",
                       headers=h).status_code == 404
    assert entry_id not in [e["id"] for e in client.get("/weekly-entries", headers=h).json()]


def test_sub_account_membership_rules():
    h = admin_headers()
    dep_a, dep_b = make_department(h), make_department(h)
    sec_a, sec_b = make_section(h, dep=dep_a), make_section(h, dep=dep_b)
    make_entry(h, sec_b)                                   # admin dep_b'ye bir giriş koyar

    # Yetenek AÇIK: bu test üyelik boyutunu ölçer, bayrağı değil (K-25)
    h_sub = sub_headers(department_ids=[dep_a["id"]], can_manage_weekly=True)
    assert make_entry(h_sub, sec_a).status_code == 201     # atanmış bölüm: izinli
    assert make_entry(h_sub, sec_b).status_code == 403     # atanmamış bölüm: yasak
    # K-26: dep_b'ye YAZAMAZ ama GÖRÜR — çakışmayı çözebilmek için karşı tarafın
    # doluluğunu görmek şarttır.
    sec_ids = [e["section"]["id"] for e in client.get("/weekly-entries", headers=h_sub).json()]
    assert sec_a["id"] in sec_ids and sec_b["id"] in sec_ids


# --- yaşam döngüsü (K-03) ---

def test_lifecycle_submit_revert_delete():
    h = admin_headers()
    entry = make_entry(h, make_section(h)).json()["entry"]

    r = client.post("/weekly-entries/submit", json={"entry_ids": [entry["id"]]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["submitted"] == [entry["id"]]
    # Motor bağlandıktan sonra (K-39) tek slotluk giriş dersin T+U+L hedefini
    # karşılamadığı için W8 tamlık UYARISI gelir — submit'i durdurmaz (K-20).
    assert all(w["severity"] == "WARNING" for w in r.json()["warnings"])

    # SUBMITTED: düzenlenemez, silinemez, tekrar submit edilemez
    eid = entry["id"]
    assert client.patch(f"/weekly-entries/{eid}", json={"slot_count": 1}, headers=h).status_code == 409
    assert client.delete(f"/weekly-entries/{eid}", headers=h).status_code == 409
    assert client.post("/weekly-entries/submit", json={"entry_ids": [eid]}, headers=h).status_code == 409

    # revert → DRAFT → artık silinebilir
    r = client.post(f"/weekly-entries/{eid}/revert-to-draft", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "DRAFT"
    assert client.post(f"/weekly-entries/{eid}/revert-to-draft", headers=h).status_code == 409
    assert client.delete(f"/weekly-entries/{eid}", headers=h).status_code == 204


def test_patch_updates_fields():
    h = admin_headers()
    entry = make_entry(h, make_section(h)).json()["entry"]
    r = client.patch(f"/weekly-entries/{entry['id']}",
                     json={"day_of_week": 3, "session_type": "PRACTICE"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()["entry"]
    assert body["day_of_week"] == 3 and body["session_type"] == "PRACTICE"
    assert body["start_slot"] == 3          # dokunulmayan alan korunur (exclude_unset)


def test_patch_overflow_checks_combined_fields():
    """Taşma, GELEN + MEVCUT alanların birleşimi üzerinden hesaplanır."""
    h = admin_headers()
    entry = make_entry(h, make_section(h), start_slot=8, slot_count=1).json()["entry"]
    # yalnız slot_count gelir; mevcut start_slot=8 ile 8+4-1=11 > 9 → 400
    assert client.patch(f"/weekly-entries/{entry['id']}",
                        json={"slot_count": 4}, headers=h).status_code == 400


def test_patch_can_clear_classroom():
    """classroom_id: null → dersliği kaldırır; göndermemek → korur (exclude_unset)."""
    h = admin_headers()
    room = make_classroom(h)
    entry = make_entry(h, make_section(h), classroom_id=room["id"]).json()["entry"]

    r = client.patch(f"/weekly-entries/{entry['id']}", json={"slot_count": 1}, headers=h)
    assert r.json()["entry"]["classroom"]["id"] == room["id"]      # dokunulmadı → korundu

    r = client.patch(f"/weekly-entries/{entry['id']}", json={"classroom_id": None}, headers=h)
    assert r.json()["entry"]["classroom"] is None                  # açıkça null → kaldırıldı


# --- motor kablolaması (stub monkeypatch ile — K-22) ---

def _fake_conflict(severity, rule_id="W1"):
    return {"severity": severity, "rule_id": rule_id,
            "message": "test çakışması", "affected": []}


def test_save_returns_engine_conflicts(monkeypatch):
    """Save anında conflicts dolu gelse bile kayıt BAŞARILIDIR (K-03'ün kalbi)."""
    monkeypatch.setattr("app.routers.weekly_entries.check_weekly_save",
                        lambda db, entry: [_fake_conflict("HARD")])
    h = admin_headers()
    r = make_entry(h, make_section(h))
    assert r.status_code == 201                         # HARD bile kaydı engellemez
    assert r.json()["conflicts"][0]["severity"] == "HARD"
    assert r.json()["entry"]["status"] == "DRAFT"


def test_submit_hard_conflict_blocks_all(monkeypatch):
    """Hep-veya-hiç: motor HARD dönerse HİÇBİR giriş submit edilmez (K-03)."""
    monkeypatch.setattr("app.routers.weekly_entries.check_weekly_submit",
                        lambda db, entries: [_fake_conflict("HARD")])
    h = admin_headers()
    e1 = make_entry(h, make_section(h)).json()["entry"]
    e2 = make_entry(h, make_section(h)).json()["entry"]

    r = client.post("/weekly-entries/submit",
                    json={"entry_ids": [e1["id"], e2["id"]]}, headers=h)
    assert r.status_code == 409
    assert r.json()["detail"] == "Hard çakışma nedeniyle submit reddedildi"
    assert r.json()["conflicts"][0]["rule_id"] == "W1"
    # ikisi de DRAFT kaldı → silinebilir olmaları bunun kanıtı
    assert client.delete(f"/weekly-entries/{e1['id']}", headers=h).status_code == 204
    assert client.delete(f"/weekly-entries/{e2['id']}", headers=h).status_code == 204


def test_submit_warning_does_not_block(monkeypatch):
    """WARNING submit'i durdurmaz; W8 tamlık uyarısı dahil görünür kalır (K-03, K-20)."""
    monkeypatch.setattr("app.routers.weekly_entries.check_weekly_submit",
                        lambda db, entries: [_fake_conflict("WARNING", "W8")])
    h = admin_headers()
    entry = make_entry(h, make_section(h)).json()["entry"]
    r = client.post("/weekly-entries/submit", json={"entry_ids": [entry["id"]]}, headers=h)
    assert r.status_code == 200
    assert r.json()["submitted"] == [entry["id"]]
    assert r.json()["warnings"][0]["rule_id"] == "W8"


# --- filtreler (kontrat §7) ---

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