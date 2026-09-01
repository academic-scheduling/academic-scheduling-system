"""K-59 taslak API'si — yasam dongusu, gizlilik, temizleme, fark, gonderme.

Kanitlanan sey listesi (her biri bir karar):
  - Taslak acmak YETKI ISTEMEZ, onaya gondermek ISTER (K-25 iki boyut).
  - Taslak OZELDIR: baskasi goremez, ADMIN dahil (404 doner, 403 degil).
  - Taslak yayindan kopyalanarak acilir; "Temizle" ortaklari KORUR.
  - Fark CANLIDIR: yayin degisirse ayni taslagin farki degisir.
  - Bekleyen taslak DONAR; geri cekilince tekrar duzenlenebilir.
  - Taslaktaki degisiklik yayina DOKUNMAZ (onay gelene dek).
"""

from app.db import SessionLocal
from app.models import DraftStatus, ScheduleDraft, WeeklyScheduleEntry
from tests.helpers import _u, admin_headers, client, sub_headers


# ------------------------------------------------------------------
# Kurulum yardimcilari (test_wp3_weekly.py deseni)
# ------------------------------------------------------------------

def make_department(h):
    r = client.post("/departments", json={"name": "Taslak Bölüm", "code": _u("TB")},
                    headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_lecturer(h):
    r = client.post("/lecturers", json={"full_name": f"Dr. Taslak {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_classroom(h, capacity=90):
    b = client.post("/buildings", json={"name": f"Bina {_u('')}"}, headers=h)
    assert b.status_code == 201, b.text
    r = client.post("/classrooms", json={
        "building_id": b.json()["id"], "room_code": _u("D"),
        "capacity": capacity, "exam_capacity": capacity // 2,
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_course(h, dep_id, year=1, semester="FALL", hours_theory=1):
    r = client.post("/courses", json={
        "department_id": dep_id, "year": year, "semester": semester,
        "code": _u("TD"), "name": "Taslak Dersi",
        "hours_theory": hours_theory, "hours_practice": 0, "hours_lab": 0,
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_section(h, course_id, lecturer_id, section_no=1):
    r = client.post(f"/courses/{course_id}/sections", json={
        "section_no": section_no, "lecturer_id": lecturer_id,
        "expected_students": 30,
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def publish_entry(section_id, classroom_id, day=1, slot=1):
    """Yayindaki bir yerlesim uretir.

    Eski akisin ucundan gecmek yerine dogrudan DB'ye yaziyoruz: bu testlerin
    konusu yeni akis, eski submit yolunun davranisi degil. draft_id NULL =
    yayinda (K-59).
    """
    db = SessionLocal()
    try:
        e = WeeklyScheduleEntry(
            section_id=section_id, classroom_id=classroom_id,
            day_of_week=day, start_slot=slot, slot_count=1,
        )
        db.add(e)
        db.commit()
        return e.id
    finally:
        db.close()


def base_setup(h, year=1):
    dep = make_department(h)
    lec = make_lecturer(h)
    cls = make_classroom(h)
    course = make_course(h, dep["id"], year=year)
    sec = make_section(h, course["id"], lec["id"])
    return dep, lec, cls, course, sec


def create_draft(h, dep_id, year=1, semester="FALL", name=None):
    body = {"department_id": dep_id, "year": year, "semester": semester}
    if name:
        body["name"] = name
    r = client.post("/schedule-drafts", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------
# Olusturma: yayindan kopyalama, yetki, tek aktif taslak
# ------------------------------------------------------------------

def test_draft_opens_as_a_copy_of_the_published_program():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    draft = create_draft(h, dep["id"])
    assert draft["entry_count"] == 1        # yayin kopyalandi
    assert draft["change_count"] == 0       # heniz fark yok
    assert draft["status"] == "OPEN"

    entries = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()
    assert [(e["day_of_week"], e["start_slot"]) for e in entries] == [(1, 1)]


def test_anyone_can_open_a_draft_without_write_permission():
    """K-59: ozel taslak kimseyi etkilemez -> kum havuzu herkese acik."""
    h = admin_headers()
    dep, _, _, _, _ = base_setup(h)
    yetkisiz = sub_headers()               # hicbir bayrak yok, uyelik yok
    r = client.post("/schedule-drafts",
                    json={"department_id": dep["id"], "year": 1, "semester": "FALL"},
                    headers=yetkisiz)
    assert r.status_code == 201, r.text


def test_second_active_draft_for_same_cohort_is_rejected():
    h = admin_headers()
    dep, _, _, _, _ = base_setup(h)
    ilk = create_draft(h, dep["id"])
    r = client.post("/schedule-drafts",
                    json={"department_id": dep["id"], "year": 1, "semester": "FALL"},
                    headers=h)
    assert r.status_code == 409
    assert str(ilk["id"]) in r.json()["detail"]


def test_foreign_department_is_rejected():
    h = admin_headers()
    r = client.post("/schedule-drafts",
                    json={"department_id": 10**9, "year": 1, "semester": "FALL"},
                    headers=h)
    assert r.status_code == 400


# ------------------------------------------------------------------
# Gizlilik
# ------------------------------------------------------------------

def test_draft_is_private_even_from_admin():
    """Baskasinin taslagi 404 doner — 403 bile varligini ele verirdi."""
    h = admin_headers()
    dep, _, _, _, _ = base_setup(h)
    baskasi = sub_headers()
    onun = client.post("/schedule-drafts",
                       json={"department_id": dep["id"], "year": 1, "semester": "FALL"},
                       headers=baskasi).json()

    assert client.get(f"/schedule-drafts/{onun['id']}", headers=h).status_code == 404
    assert client.get(f"/schedule-drafts/{onun['id']}/diff", headers=h).status_code == 404
    assert client.delete(f"/schedule-drafts/{onun['id']}", headers=h).status_code == 404
    # Listede de gorunmez
    benimkiler = client.get("/schedule-drafts", headers=h).json()
    assert onun["id"] not in [d["id"] for d in benimkiler]


# ------------------------------------------------------------------
# Duzenleme ve fark
# ------------------------------------------------------------------

def test_moving_an_entry_in_draft_shows_as_moved_and_leaves_published_alone():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    r = client.patch(
        f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
        json={"day_of_week": 3, "start_slot": 5}, headers=h,
    )
    assert r.status_code == 200, r.text

    fark = client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]
    assert len(fark) == 1
    assert fark[0]["kind"] == "MOVED"
    assert (fark[0]["before"]["day_of_week"], fark[0]["before"]["start_slot"]) == (1, 1)
    assert (fark[0]["after"]["day_of_week"], fark[0]["after"]["start_slot"]) == (3, 5)

    # Yayin YERINDE duruyor — onay gelene dek hicbir sey degismez
    db = SessionLocal()
    try:
        yayin = db.get(WeeklyScheduleEntry, yayin_id)
        assert (yayin.day_of_week, yayin.start_slot) == (1, 1)
        assert yayin.draft_id is None
    finally:
        db.close()


def test_removing_and_adding_show_up_in_the_diff():
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    assert client.delete(
        f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}", headers=h
    ).status_code == 204

    ikinci = make_section(h, course["id"], lec["id"], section_no=2)
    r = client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": ikinci["id"], "classroom_id": cls["id"],
        "day_of_week": 2, "start_slot": 4, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)
    assert r.status_code == 201, r.text

    turler = {
        i["kind"] for i in
        client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]
    }
    assert turler == {"REMOVED", "ADDED"}


def test_updated_at_moves_when_the_draft_content_changes():
    """K-85: taslagin ICINDE yapilan degisiklik updated_at'i ileri tasir.

    Ana sayfadaki "son kayitlar" listesi bu alana gore siralaniyor. Girislerin
    kendi created_at'ine bakmak yetmezdi: TASIMA ve SILME o kolonu
    guncellemiyor, dolayisiyla "uzerinde calistigim taslak" listede yukari
    cikmazdi.
    """
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    draft = create_draft(h, dep["id"])
    acilis = draft["updated_at"]

    # 1) EKLEME
    r = client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": sec["id"], "classroom_id": cls["id"],
        "day_of_week": 1, "start_slot": 1, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)
    assert r.status_code == 201, r.text
    entry_id = r.json()["entry"]["id"]
    ekleme = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]
    assert ekleme > acilis

    # 2) TASIMA — girisin created_at'i degismez, updated_at ilerlemeli
    assert client.patch(f"/schedule-drafts/{draft['id']}/entries/{entry_id}",
                        json={"day_of_week": 3}, headers=h).status_code == 200
    tasima = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]
    assert tasima > ekleme

    # 3) SILME
    assert client.delete(f"/schedule-drafts/{draft['id']}/entries/{entry_id}",
                         headers=h).status_code == 204
    silme = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]
    assert silme > tasima


def test_updated_at_moves_on_submit_and_withdraw():
    """Yasam dongusu olaylari da ayni alani ileri tasir (K-85).

    Kullanicinin "en son ne oldu" sorusu "icini duzenledim" ile "onaya
    gonderdim"i ayirmiyor; iki ayri sira anahtari tutmak listeyi
    aciklanamaz hale getirirdi.
    """
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    draft = create_draft(h, dep["id"])
    client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": sec["id"], "classroom_id": cls["id"],
        "day_of_week": 1, "start_slot": 1, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=h)
    once = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]

    assert client.post(f"/schedule-drafts/{draft['id']}/submit",
                       json={}, headers=h).status_code == 200
    gonderim = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]
    assert gonderim > once

    assert client.post(f"/schedule-drafts/{draft['id']}/withdraw",
                       headers=h).status_code == 200
    geri = client.get(f"/schedule-drafts/{draft['id']}", headers=h).json()["updated_at"]
    assert geri > gonderim


def test_diff_is_live_against_the_current_published_program():
    """K-59'un merkezi: taban saklanmaz. Yayin degisirse ayni taslagin farki da
    degisir — onaylayici her zaman O ANKI gercege bakar."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(h, dep["id"])          # taslak Pzt 1'i kopyaladi

    def fark():
        return client.get(f"/schedule-drafts/{draft['id']}/diff",
                          headers=h).json()["items"]

    assert fark() == []                          # taslak = yayin

    # Yayin ARKADAN degisti (baska biri onaylatti gibi)
    db = SessionLocal()
    try:
        e = db.get(WeeklyScheduleEntry, yayin_id)
        e.day_of_week, e.start_slot = 5, 9
        db.commit()
    finally:
        db.close()

    guncel = fark()
    assert len(guncel) == 1 and guncel[0]["kind"] == "MOVED"
    assert (guncel[0]["before"]["day_of_week"], guncel[0]["before"]["start_slot"]) == (5, 9)
    assert (guncel[0]["after"]["day_of_week"], guncel[0]["after"]["start_slot"]) == (1, 1)


def test_clear_empties_the_draft_without_touching_published():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"])
    draft = create_draft(h, dep["id"])

    r = client.post(f"/schedule-drafts/{draft['id']}/clear",
                    json={"include_shared": False}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 1, "preserved_shared": 0}

    assert client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json() == []
    db = SessionLocal()
    try:
        assert db.get(WeeklyScheduleEntry, yayin_id) is not None
    finally:
        db.close()


def test_clear_preserves_shared_courses_by_default():
    """K-59: ortak dersi silmek uc bolumun programindan ders dusurur ->
    varsayilan olarak korunur, silmek ACIKCA istenmeli."""
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    tuketen = make_department(h)
    # Dersi ortak yap ve tuketen bolumu ek cohort olarak ekle (K-48)
    r = client.patch(f"/courses/{course['id']}", json={
        "is_common": True,
        # K-85: liste TAM cohort kumesi -- dersin KENDI cohort'u da icinde
        # olmali, yoksa tuketen bolum birincile terfi eder ve sahip duser.
        "cohorts": [{"department_id": dep["id"], "year": 1, "semester": "FALL"},
                    {"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    publish_entry(sec["id"], cls["id"])

    draft = create_draft(h, dep["id"])
    korumali = client.post(f"/schedule-drafts/{draft['id']}/clear",
                           json={"include_shared": False}, headers=h).json()
    assert korumali == {"deleted": 0, "preserved_shared": 1}

    hepsi = client.post(f"/schedule-drafts/{draft['id']}/clear",
                        json={"include_shared": True}, headers=h).json()
    assert hepsi == {"deleted": 1, "preserved_shared": 0}


def test_shared_course_diff_names_the_affected_departments():
    """Ortak ders tasinirken gosterilecek uyarinin verisi farkin icinde gelir."""
    h = admin_headers()
    dep, _, cls, course, sec = base_setup(h)
    tuketen = make_department(h)
    client.patch(f"/courses/{course['id']}", json={
        "is_common": True,
        # K-85: liste TAM cohort kumesi -- dersin KENDI cohort'u da icinde
        # olmali, yoksa tuketen bolum birincile terfi eder ve sahip duser.
        "cohorts": [{"department_id": dep["id"], "year": 1, "semester": "FALL"},
                    {"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    draft = create_draft(h, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 4}, headers=h)

    item = client.get(f"/schedule-drafts/{draft['id']}/diff",
                      headers=h).json()["items"][0]
    assert item["is_shared"] is True
    assert [d["id"] for d in item["affected_departments"]] == [tuketen["id"]]


# ------------------------------------------------------------------
# Onaya gonderme / geri cekme
# ------------------------------------------------------------------

def test_submit_requires_weekly_permission_and_membership():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    yetkisiz = sub_headers()                       # taslak acabilir...
    draft = client.post("/schedule-drafts",
                        json={"department_id": dep["id"], "year": 1, "semester": "FALL"},
                        headers=yetkisiz).json()
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=yetkisiz).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 3}, headers=yetkisiz)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=yetkisiz)
    assert r.status_code == 403                    # ...ama gonderemez


def test_submit_rejects_a_draft_with_no_changes():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"])
    draft = create_draft(h, dep["id"])
    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=h)
    assert r.status_code == 409


def test_submit_freezes_the_draft_and_withdraw_unfreezes_it():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(h, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 3}, headers=h)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "3. sınıf laboratuvarı için kaydırıldı"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["status"] == "PENDING"
    assert r.json()["draft"]["submit_note"] == "3. sınıf laboratuvarı için kaydırıldı"

    # DONDU: duzenleme, temizleme ve silme kapali
    assert client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                        json={"day_of_week": 4}, headers=h).status_code == 409
    assert client.post(f"/schedule-drafts/{draft['id']}/clear",
                       json={}, headers=h).status_code == 409
    assert client.delete(f"/schedule-drafts/{draft['id']}", headers=h).status_code == 409

    r = client.post(f"/schedule-drafts/{draft['id']}/withdraw", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "OPEN"
    assert client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                        json={"day_of_week": 4}, headers=h).status_code == 200


def test_submit_is_blocked_by_hard_conflict():
    """K-03 aynen: HARD varsa talep HIC olusmasin, kuyruk bozuk taleple dolmasin."""
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    komsu = make_course(h, dep["id"], year=2)        # baska cohort
    komsu_sec = make_section(h, komsu["id"], lec["id"])
    publish_entry(komsu_sec["id"], cls["id"], day=2, slot=4)   # yayinda, ayri cohort
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    draft = create_draft(h, dep["id"], year=1)
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    # Ayni derslik + ayni gun/saat -> W1 HARD
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 2, "start_slot": 4}, headers=h)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=h)
    assert r.status_code == 409, r.text
    assert any(c["rule_id"] == "W1" for c in r.json()["conflicts"])

    db = SessionLocal()
    try:
        assert db.get(ScheduleDraft, draft["id"]).status == DraftStatus.OPEN
    finally:
        db.close()
