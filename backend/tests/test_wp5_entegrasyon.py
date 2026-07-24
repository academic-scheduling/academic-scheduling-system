"""WP5 motor entegrasyonu — API üzerinden UÇTAN UCA çakışma testleri (K-39).

Buraya kadarki testler motoru monkeypatch'le taklit ediyordu (stub dönemi,
K-22). Bu dosya farklı: gerçek veri kurar, gerçek endpoint'i çağırır, gerçek
motorun ürettiği ConflictResult'ı doğrular. "Motor takıldı" iddiasının kanıtı
budur — kural setinin senaryoları artık API üzerinden koşuyor.

Ortak DB kullanıldığı için hiçbir test mutlak sayı iddia etmez; hep "bu isteğin
cevabında şu rule_id var mı" diye bakılır.
"""

from tests.helpers import client, admin_headers, foreign_admin_headers, _u
from tests.test_wp2_courses import make_department, make_lecturer
from tests.test_wp3_weekly import make_classroom, make_entry, make_section


# ------------------------------------------------------------------
# Yardımcılar
# ------------------------------------------------------------------

def rule_ids(conflicts) -> set[str]:
    return {c["rule_id"] for c in conflicts}


def save_conflicts(response) -> list[dict]:
    assert response.status_code == 201, response.text
    return response.json()["conflicts"]


def make_exam(h, course_id, lecturer_id, **overrides):
    body = {
        "course_id": course_id, "exam_type": "MIDTERM",
        "exam_date": "2026-11-12", "start_time": "10:00",
        "duration_minutes": 90, "classroom_ids": [], "lecturer_id": lecturer_id,
    }
    body.update(overrides)
    return client.post("/exams", json=body, headers=h)


def make_course(h, dep, **overrides):
    body = {
        "department_id": dep["id"], "year": 2, "semester": "FALL",
        "code": _u("EN"), "name": "Entegrasyon Dersi",
        "hours_theory": 2, "hours_practice": 0, "hours_lab": 0,
    }
    body.update(overrides)
    r = client.post("/courses", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


# ==================================================================
# Haftalık kurallar — save anı (K-03: bilgilendirir, engellemez)
# ==================================================================

def test_w1_classroom_conflict_reported_but_save_succeeds():
    """Aynı derslik + aynı saat → W1 HARD döner, AMA kayıt yine de başarılı."""
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 2, "start_slot": 4}

    make_entry(h, make_section(h), **ortak)
    conflicts = save_conflicts(make_entry(h, make_section(h), **ortak))

    assert "W1" in rule_ids(conflicts)
    w1 = [c for c in conflicts if c["rule_id"] == "W1"][0]
    assert w1["severity"] == "HARD"
    assert "Derslik çakışması" in w1["message"]
    # affected: iki tarafı da gösterir, ikisi de haftalık giriş
    assert len(w1["affected"]) == 2
    assert all(a["type"] == "weekly_entry" for a in w1["affected"])


def test_w2_lecturer_conflict():
    """Aynı hoca iki farklı derste aynı saatte → W2 HARD."""
    h = admin_headers()
    lec = make_lecturer(h)
    sec_a = make_section(h, lecturer=lec)
    sec_b = make_section(h, lecturer=lec)
    ortak = {"day_of_week": 3, "start_slot": 6}

    make_entry(h, sec_a, **ortak)
    assert "W2" in rule_ids(save_conflicts(make_entry(h, sec_b, **ortak)))


def test_w3_cohort_hard_for_two_mandatory_courses():
    """Aynı bölüm+yıl+dönem, iki zorunlu ders, tek şube, çakışan saat → W3 HARD."""
    h = admin_headers()
    dep = make_department(h)
    ortak = {"day_of_week": 4, "start_slot": 2}

    make_entry(h, make_section(h, dep=dep), **ortak)
    conflicts = save_conflicts(make_entry(h, make_section(h, dep=dep), **ortak))

    assert "W3" in rule_ids(conflicts)
    w3 = [c for c in conflicts if c["rule_id"] == "W3"][0]
    assert w3["severity"] == "HARD"
    # K-39: affected temsili giriş değil, çakışmayı kanıtlayan somut oturum çifti
    assert len(w3["affected"]) == 2


def test_no_conflict_on_adjacent_slots():
    """Sınır durumu: biri biterken diğeri başlıyor → çakışma YOK (doküman şartı)."""
    h = admin_headers()
    room = make_classroom(h)
    make_entry(h, make_section(h), classroom_id=room["id"],
               day_of_week=5, start_slot=1, slot_count=2)      # slot 1-2
    conflicts = save_conflicts(
        make_entry(h, make_section(h), classroom_id=room["id"],
                   day_of_week=5, start_slot=3, slot_count=1)  # slot 3
    )
    assert "W1" not in rule_ids(conflicts)


def test_async_entry_is_exempt_from_comparisons():
    """K-19: ONLINE_ASYNC giriş hiçbir çakışma karşılaştırmasına girmez."""
    h = admin_headers()
    lec = make_lecturer(h)
    ortak = {"day_of_week": 2, "start_slot": 8}

    make_entry(h, make_section(h, lecturer=lec), **ortak)
    # Aynı hoca, aynı saat — ama asenkron: W2 üretilmemeli
    conflicts = save_conflicts(make_entry(
        h, make_section(h, lecturer=lec),
        delivery_mode="ONLINE_ASYNC", classroom_id=None, **ortak,
    ))
    assert "W2" not in rule_ids(conflicts)


def test_w7_capacity_warning():
    """Beklenen öğrenci > derslik kapasitesi → W7 WARNING."""
    h = admin_headers()
    room = make_classroom(h, capacity=10)
    section = make_section(h, expected=50)
    conflicts = save_conflicts(make_entry(h, section, classroom_id=room["id"]))
    assert "W7" in rule_ids(conflicts)


# ==================================================================
# Submit kapısı (K-03: HARD reddeder, WARNING geçirir)
# ==================================================================

def test_submit_rejected_by_real_hard_conflict():
    """Gerçek W1 çakışması submit'i 409 ile düşürür — hep-veya-hiç."""
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 1, "start_slot": 7}

    e1 = make_entry(h, make_section(h), **ortak).json()["entry"]
    e2 = make_entry(h, make_section(h), **ortak).json()["entry"]

    r = client.post("/weekly-entries/submit",
                    json={"entry_ids": [e1["id"], e2["id"]]}, headers=h)
    assert r.status_code == 409, r.text
    assert "W1" in rule_ids(r.json()["conflicts"])

    # Hep-veya-hiç kanıtı: ikisi de DRAFT kaldı → hâlâ silinebilirler
    assert client.delete(f"/weekly-entries/{e1['id']}", headers=h).status_code == 204
    assert client.delete(f"/weekly-entries/{e2['id']}", headers=h).status_code == 204


def test_w8_completeness_only_at_submit():
    """K-20: W8 save'de SESSİZ, submit'te WARNING — ve submit'i durdurmaz."""
    h = admin_headers()
    section = make_section(h)          # ders 3+2+0 ister
    entry = make_entry(h, section, slot_count=1).json()["entry"]

    # save anında tamlık uyarısı YOK
    r = client.patch(f"/weekly-entries/{entry['id']}",
                     json={"slot_count": 1}, headers=h)
    assert "W8" not in rule_ids(r.json()["conflicts"])

    # submit anında VAR ve submit başarılı
    r = client.post("/weekly-entries/submit",
                    json={"entry_ids": [entry["id"]]}, headers=h)
    assert r.status_code == 200, r.text
    assert "W8" in rule_ids(r.json()["warnings"])


# ==================================================================
# Sınav kuralları
# ==================================================================

def test_e1_exam_classroom_conflict():
    """İki sınav ortak derslikte, kesişen saatte → E1 HARD."""
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    room = make_classroom(h)

    make_exam(h, make_course(h, dep)["id"], lec["id"], classroom_ids=[room["id"]])
    r = make_exam(h, make_course(h, dep)["id"], lec["id"],
                  classroom_ids=[room["id"]], exam_type="FINAL")
    conflicts = save_conflicts(r)

    assert "E1" in rule_ids(conflicts)
    e1 = [c for c in conflicts if c["rule_id"] == "E1"][0]
    assert e1["severity"] == "HARD"
    # K-16: sınav mesajında şube numarası olmamalı (eski KeyError'ın kaynağı)
    assert "-1" not in e1["message"].split("sınavları")[0]
    assert all(a["type"] == "exam" for a in e1["affected"])


def test_e5a_missing_exam_capacity_warning():
    """K-21: exam_capacity girilmemiş derslik seçilince E5a WARNING."""
    h = admin_headers()
    room = make_classroom(h)            # exam_capacity gönderilmiyor → NULL
    assert room["exam_capacity"] is None
    conflicts = save_conflicts(make_exam(
        h, make_course(h, make_department(h))["id"],
        make_lecturer(h)["id"], classroom_ids=[room["id"]],
    ))
    assert "E5a" in rule_ids(conflicts)


def test_exam_submit_rejected_by_hard_conflict():
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    room = make_classroom(h)

    x1 = make_exam(h, make_course(h, dep)["id"], lec["id"],
                   classroom_ids=[room["id"]]).json()["exam"]
    x2 = make_exam(h, make_course(h, dep)["id"], lec["id"],
                   classroom_ids=[room["id"]], exam_type="FINAL").json()["exam"]

    r = client.post("/exams/submit", json={"exam_ids": [x1["id"], x2["id"]]}, headers=h)
    assert r.status_code == 409, r.text
    assert "E1" in rule_ids(r.json()["conflicts"])


# ==================================================================
# Workgroup izolasyonu — motorun evreni sızdırmadığının kanıtı
# ==================================================================

def test_other_workgroup_entries_never_enter_the_universe():
    """Başka workgroup'un aynı saatteki dersi çakışma üretmemeli.

    Adaptör evreni workgroup'a göre süzmeseydi, iki fakültenin programı
    birbirine karışır ve sahte çakışma üretilirdi.
    """
    ortak = {"day_of_week": 3, "start_slot": 9, "slot_count": 1}

    h_foreign = foreign_admin_headers()
    foreign_room = make_classroom(h_foreign)
    foreign_entry = make_entry(h_foreign, make_section(h_foreign),
                               classroom_id=foreign_room["id"], **ortak
                               ).json()["entry"]

    h = admin_headers()
    conflicts = save_conflicts(make_entry(
        h, make_section(h), classroom_id=make_classroom(h)["id"], **ortak,
    ))

    # Aynı gün/saat olmasına rağmen çakışma yok (farklı derslik + farklı evren)
    assert "W1" not in rule_ids(conflicts)
    # Ve hiçbir sonuç yabancı workgroup'un girişine referans vermemeli
    gecen_idler = {a["id"] for c in conflicts for a in c["affected"]}
    assert foreign_entry["id"] not in gecen_idler


# ==================================================================
# Pasiflik: pasif şube/ders çakışma evreninden düşer (K-39)
# ==================================================================

def test_inactive_section_leaves_conflict_universe():
    """Girişi olan şube pasife alınınca artık kimseyle çakışmaz.

    Kural seti "tüm AKTİF şube çiftleri" der; K-16/K-33 de her yerde pasifi
    kapsam dışı tutar. Motor da tutarlı olmalı: pasif şubenin girişi hayalet
    çakışma üretmemeli.
    """
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 2, "start_slot": 3}

    sec_eski = make_section(h)
    make_entry(h, sec_eski, **ortak)

    # Kontrol: aktifken W1 üretilir. Probe girişini SİL ki evreni kirletmesin —
    # aksi halde bir sonraki probe bu aktif girişle çakışır, testi yanıltır.
    probe = make_entry(h, make_section(h), **ortak).json()
    assert "W1" in rule_ids(probe["conflicts"])
    assert client.delete(f"/weekly-entries/{probe['entry']['id']}", headers=h).status_code == 204

    # Şubeyi pasife al → sec_eski'nin girişi artık evren dışı → çakışma yok
    assert client.patch(f"/course-sections/{sec_eski['id']}",
                        json={"active": False}, headers=h).status_code == 200
    conflicts2 = save_conflicts(make_entry(h, make_section(h), **ortak))
    assert "W1" not in rule_ids(conflicts2)


def test_inactive_course_leaves_conflict_universe():
    """Ders pasife alınınca şubelerinin girişleri de evrenden düşer."""
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 5, "start_slot": 2}

    sec_eski = make_section(h)
    make_entry(h, sec_eski, **ortak)
    probe = make_entry(h, make_section(h), **ortak).json()
    assert "W1" in rule_ids(probe["conflicts"])
    assert client.delete(f"/weekly-entries/{probe['entry']['id']}", headers=h).status_code == 204

    # Dersi pasife al (şube değil) → şubenin girişleri de evren dışı kalmalı
    assert client.patch(f"/courses/{sec_eski['course']['id']}",
                        json={"active": False}, headers=h).status_code == 200
    assert "W1" not in rule_ids(save_conflicts(make_entry(h, make_section(h), **ortak)))


def test_inactive_course_exam_leaves_scan():
    """Pasif dersin sınavı tam taramada da görünmez (E-tarafı simetri)."""
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    room = make_classroom(h)

    c1 = make_course(h, dep)
    make_exam(h, c1["id"], lec["id"], classroom_ids=[room["id"]])
    c2 = make_course(h, dep)
    x2 = make_exam(h, c2["id"], lec["id"],
                   classroom_ids=[room["id"]], exam_type="FINAL").json()["exam"]

    # İkisi aktifken E1 var
    r = client.get("/conflicts", headers=h)
    hard_ids = {a["id"] for c in r.json()["hard"] for a in c["affected"]}
    assert x2["id"] in hard_ids

    # c1 pasife alınınca onun sınavı evrenden düşer → x2 artık çakışmaz
    assert client.patch(f"/courses/{c1['id']}", json={"active": False},
                        headers=h).status_code == 200
    r = client.get("/conflicts", headers=h)
    hard_ids = {a["id"] for c in r.json()["hard"] for a in c["affected"]}
    assert x2["id"] not in hard_ids


# ==================================================================
# Tam tarama (kontrat §9)
# ==================================================================

def test_full_scan_reports_real_conflicts():
    """GET /conflicts artık gerçek çakışmaları döner (stub'ken hep boştu)."""
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 4, "start_slot": 8}
    make_entry(h, make_section(h), **ortak)
    make_entry(h, make_section(h), **ortak)

    r = client.get("/conflicts", headers=h)
    assert r.status_code == 200, r.text
    assert "W1" in rule_ids(r.json()["hard"])
    # Her sonuç kontrat §0 şeklini taşımalı
    for c in r.json()["hard"] + r.json()["warnings"]:
        assert c["severity"] in ("HARD", "WARNING")
        assert c["message"] and not c["message"].startswith("Çakışma: ")
        for ref in c["affected"]:
            assert ref["type"] in ("weekly_entry", "exam")


def test_w8_completeness_appears_in_full_scan():
    """K-40: W8 tamlık uyarısı tam taramada da görünür (yalnız submit'te değil).

    save'de susmasının sebebi "iş sürerken rahatsız etme"ydi; tam tarama ise
    kullanıcının bilerek 'tüm sorunları göster' dediği yerdir — eksik ders saati
    de bir sorundur. Bu davranış kararla sabitlendi.
    """
    h = admin_headers()
    section = make_section(h)                 # ders 3+2+0 ister
    # Tek slotluk teori girişi bırak → tamlık eksik (submit etmeye bile gerek yok)
    make_entry(h, section, slot_count=1, day_of_week=1, start_slot=1)

    r = client.get("/conflicts", headers=h)
    assert r.status_code == 200, r.text
    assert "W8" in rule_ids(r.json()["warnings"])
