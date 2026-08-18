"""WP5 motor entegrasyonu — API üzerinden UÇTAN UCA çakışma testleri (K-39).

Buraya kadarki testler motoru monkeypatch'le taklit ediyordu (stub dönemi,
K-22). Bu dosya farklı: gerçek veri kurar, gerçek endpoint'i çağırır, gerçek
motorun ürettiği ConflictResult'ı doğrular. "Motor takıldı" iddiasının kanıtı
budur — kural setinin senaryoları artık API üzerinden koşuyor.

Ortak DB kullanıldığı için hiçbir test mutlak sayı iddia etmez; hep "bu isteğin
cevabında şu rule_id var mı" diye bakılır.
"""

from tests.helpers import (
    client, admin_headers, foreign_admin_headers, publish_exam, _u,
)
from tests.test_wp2_courses import make_department, make_lecturer
from tests.test_wp3_weekly import make_classroom, make_entry, make_section
from app.db import SessionLocal
from app.models import CourseCohort, SemesterType, WeeklyScheduleEntry


def unpublish(entry_id: int) -> None:
    """Yayin satirini kaldirir.

    K-59: `DELETE /weekly-entries/{id}` ucu YOK — yayina yazan tek yol onaydir.
    Bu testlerin derdi motor evreni; onay akisini kurmak konularinin disinda,
    o yuzden satir dogrudan silinir. (Onay akisi test_k59_* dosyalarinda.)
    """
    db = SessionLocal()
    try:
        e = db.get(WeeklyScheduleEntry, entry_id)
        if e is not None:
            db.delete(e)
            db.commit()
    finally:
        db.close()


# ------------------------------------------------------------------
# Yardımcılar
# ------------------------------------------------------------------

def rule_ids(conflicts) -> set[str]:
    return {c["rule_id"] for c in conflicts}


def save_conflicts(response) -> list[dict]:
    assert response.status_code == 201, response.text
    return response.json()["conflicts"]


def make_exam(h, course_id, lecturer_id, **overrides):
    """K-60: eski `POST /exams` kalktı; motor testleri YAYINDAKİ sınava bakar.
    `h` artık kullanılmıyor ama imza korundu — çağrı yerleri sabit kalsın."""
    return publish_exam(course_id, lecturer_id, **overrides)


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

def test_real_hard_conflict_is_reported_between_published_entries():
    """Gerçek W1: aynı derslik, aynı gün/saat → HARD.

    K-59: eski `submit` ucu kalktı; "HARD onaya göndermeyi engeller" kuralı
    `test_k59_draft_api.test_submit_is_blocked_by_hard_conflict`'te uçtan uca
    test edilir. Burada ölçülen şey MOTORUN kendisi.
    """
    h = admin_headers()
    room = make_classroom(h)
    ortak = {"classroom_id": room["id"], "day_of_week": 1, "start_slot": 7}

    e1 = make_entry(h, make_section(h), **ortak).json()["entry"]
    ikinci = make_entry(h, make_section(h), **ortak).json()
    assert "W1" in rule_ids(ikinci["conflicts"])
    w1 = [c for c in ikinci["conflicts"] if c["rule_id"] == "W1"][0]
    assert w1["severity"] == "HARD"

    unpublish(e1["id"])
    unpublish(ikinci["entry"]["id"])


def test_w8_completeness_is_silent_on_save_but_shown_on_scan():
    """K-20: W8 kayıt anında SESSİZ, tam taramada görünür.

    K-59: "submit anı" artık taslağın gönderilmesi; W8 orada da uyarı olarak
    çıkar ve göndermeyi durdurmaz (test_k59_draft_api). Buradaki iddia
    kuralın kendisi: save susar, tarama konuşur.
    """
    h = admin_headers()
    section = make_section(h)          # ders 3+2+0 ister
    kayit = make_entry(h, section, slot_count=1).json()

    # save anında tamlık uyarısı YOK
    assert "W8" not in rule_ids(kayit["conflicts"])

    # tam taramada VAR
    tarama = client.get("/conflicts", headers=h).json()
    ilgili = [
        c for c in tarama["warnings"]
        if c["rule_id"] == "W8"
        and any(a["id"] == kayit["entry"]["id"] for a in c["affected"])
    ]
    assert ilgili, "W8 tam taramada görünmedi"

    unpublish(kayit["entry"]["id"])


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
    """Hard çakışma onaya göndermeyi engeller — talep hiç oluşmaz (K-03/K-60).

    Kapı değişti (`/exams/submit` yerine taslak submit'i), kural aynı: motorun
    E1'i gönderim kapısına ULAŞIYOR mu, bu testin ölçtüğü şey o.
    """
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    room = make_classroom(h)
    a = make_course(h, dep)
    b = make_course(h, dep)

    r = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 2, "semester": "FALL", "kind": "EXAM",
    }, headers=h)
    assert r.status_code == 201, r.text
    draft = r.json()

    # Aynı derslik, aynı gün-saat, farklı ders → E1 (HARD)
    for course, tip in ((a, "MIDTERM"), (b, "FINAL")):
        r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
            "course_id": course["id"], "exam_type": tip,
            "exam_date": "2026-11-12", "start_time": "10:00",
            "duration_minutes": 90, "classroom_ids": [room["id"]],
            "lecturer_id": lec["id"],
        }, headers=h)
        assert r.status_code == 201, r.text

    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=h)
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
    # Ve hiçbir sonuç yabancı workgroup'un girişine referans vermemeli.
    # (tip, id) ÇİFTİ: sınav ve haftalık giriş id uzayları ayrıdır, ham id
    # karşılaştırması aynı numarayı taşıyan farklı türde bir kaydı eşleştirir.
    gecen = {(a["type"], a["id"]) for c in conflicts for a in c["affected"]}
    assert ("weekly_entry", foreign_entry["id"]) not in gecen


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
    unpublish(probe["entry"]["id"])

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
    unpublish(probe["entry"]["id"])

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

    # (tip, id) ÇİFTİ ile arıyoruz: sınav ve haftalık giriş ayrı id uzayları
    # kullanır, ham id karşılaştırması aynı numaralı bir haftalık girişi sınav
    # sanıp testi yanlış yere düşürür.
    def hard_refs():
        r = client.get("/conflicts", headers=h)
        return {(a["type"], a["id"]) for c in r.json()["hard"] for a in c["affected"]}

    # İkisi aktifken E1 var
    assert ("exam", x2["id"]) in hard_refs()

    # c1 pasife alınınca onun sınavı evrenden düşer → x2 artık çakışmaz
    assert client.patch(f"/courses/{c1['id']}", json={"active": False},
                        headers=h).status_code == 200
    assert ("exam", x2["id"]) not in hard_refs()


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


# ==================================================================
# K-48: ortak (servis) ders — çok-cohort'lu çakışma (ORM → adaptör → motor)
# ==================================================================

def _depB_w3(hard, dep_id):
    """Tam taramadaki HARD sonuçlardan, verilen bölümü etkileyen W3'ler."""
    return [c for c in hard if c["rule_id"] == "W3"
            and any(ref.get("department_id") == dep_id for ref in c["affected"])]


def test_common_course_extra_cohort_triggers_cross_cohort_w3():
    """Uçtan uca: ortak dersi EK cohort'a bağlayınca farklı bölümdeki dersle W3
    doğar; bağlamadan ÖNCE doğmaz (bölümler-arası izolasyon korunur). Adaptörün
    `cohorts` beslemesini + motorun kesişim mantığını gerçek DB üzerinden kanıtlar."""
    h = admin_headers()
    depA = make_department(h)
    depB = make_department(h)                 # benzersiz -> tam taramada izole
    slot = {"day_of_week": 3, "start_slot": 4, "slot_count": 2}
    secA = make_section(h, dep=depA)          # depA-2-FALL
    secB = make_section(h, dep=depB)          # depB-2-FALL, farklı hoca
    make_entry(h, secA, **slot)
    make_entry(h, secB, **slot)               # aynı gün/slot, dersliksiz -> W1/W2 yok

    # ORTAK DEĞİLKEN: farklı cohort -> depB'yi etkileyen W3 yok
    hard0 = client.get("/conflicts", headers=h).json()["hard"]
    assert _depB_w3(hard0, depB["id"]) == []

    # A dersini depB-2-FALL cohort'una da bağla (ortak ders yap) — doğrudan DB
    db = SessionLocal()
    try:
        db.add(CourseCohort(course_id=secA["course"]["id"],
                            department_id=depB["id"], year=2,
                            semester=SemesterType.FALL))
        db.commit()
    finally:
        db.close()

    # Artık paylaşılan depB-2 cohort'unda A ile B çakışır -> W3 HARD
    hard1 = client.get("/conflicts", headers=h).json()["hard"]
    mine = _depB_w3(hard1, depB["id"])
    assert len(mine) == 1
    assert mine[0]["severity"] == "HARD"
    assert len({ref["id"] for ref in mine[0]["affected"]}) == 2   # A ve B girişleri
