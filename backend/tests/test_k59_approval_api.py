"""K-59 onay API'si — kuyruk, inceleme, onay (fark uygulama), ret.

Kanitlanan kararlar:
  - Onay yetkisi = bayrak + bolum uyeligi; ADMIN ikisinden de muaf.
  - OZ-ONAY YASAK, ADMIN DAHIL. Tek yetkilisi olan workgroup yayin yapamaz.
  - Onay taslagin TAMAMINI degil FARKINI uygular -> baskasinin onaylanmis
    degisikligi sessizce silinmez. (Bu dosyanin en onemli testi.)
  - Tasima yayindaki satirin KIMLIGINI korur (silip yeniden yaratmaz).
  - Onay aninda cakisma yeniden kosar; arada bozulan talep onaylanamaz.
  - Ret gerekceyle olur, taslak silinmez; sahibi duzeltip yeniden gonderir.
"""

from app.db import SessionLocal
from app.models import (
    DepartmentMembership, DraftStatus, ScheduleDraft, User, UserRole, UserStatus,
    WeeklyScheduleEntry,
)
from app.security import hash_password
from tests.helpers import _u, admin_headers, client
from tests.test_k59_draft_api import (
    base_setup, create_draft, make_course, make_section, publish_entry,
)


# ------------------------------------------------------------------
# Hesap yardimcilari
# ------------------------------------------------------------------

def make_account(department_ids, **flags):
    """Ana workgroup'ta alt hesap yaratir, login olur, header doner.

    helpers.sub_headers `can_approve_schedule` bilmiyor (K-25 oncesi imza);
    onay testleri o bayragi acmak zorunda oldugu icin burada kuruluyor.
    """
    email = f"onay_{_u('')}@muh.example.edu.tr"
    pw = "onaytest1234"
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin@muh.example.edu.tr").one()
        u = User(
            workgroup_id=admin.workgroup_id, name="Onay Testi",
            email=email, password_hash=hash_password(pw),
            role=UserRole.SUB_ACCOUNT, status=UserStatus.ACTIVE, **flags,
        )
        db.add(u)
        db.flush()
        for dep_id in department_ids:
            db.add(DepartmentMembership(user_id=u.id, department_id=dep_id))
        db.commit()
    finally:
        db.close()
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def submitted_draft(h, dep, cls, sec, *, day=3, slot=5):
    """Bir yerlesimi tasiyip onaya gonderilmis taslak uretir."""
    draft = create_draft(h, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": day, "start_slot": slot}, headers=h)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "test talebi"}, headers=h)
    assert r.status_code == 200, r.text
    return draft


def entry_row(entry_id):
    db = SessionLocal()
    try:
        e = db.get(WeeklyScheduleEntry, entry_id)
        return None if e is None else (e.day_of_week, e.start_slot, e.draft_id)
    finally:
        db.close()


# ------------------------------------------------------------------
# Oz-onay yasagi
# ------------------------------------------------------------------

def test_admin_cannot_approve_own_request():
    """K-59 kullanici karari: admin icin istisna YOK — baskasina onaylatmali."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=h)
    assert r.status_code == 403
    assert "Kendi talebinizi" in r.json()["detail"]

    r = client.post(f"/schedule-approvals/{draft['id']}/reject",
                    json={"note": "olmaz"}, headers=h)
    assert r.status_code == 403


def test_own_request_is_visible_in_queue_but_not_actionable():
    """Kendi talebini kuyrukta GORURSUN (bekledigini bilmelisin), onaylayamazsin."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec)

    kuyruk = client.get("/schedule-approvals", headers=h).json()
    assert draft["id"] in [d["id"] for d in kuyruk]


# ------------------------------------------------------------------
# Yetki
# ------------------------------------------------------------------

def test_queue_and_review_need_the_approval_flag():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec)

    yetkisiz = make_account([dep["id"]], can_manage_weekly=True)   # onay bayragi YOK
    assert client.get("/schedule-approvals", headers=yetkisiz).json() == []
    assert client.get(f"/schedule-approvals/{draft['id']}",
                      headers=yetkisiz).status_code == 403
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=yetkisiz).status_code == 403


def test_approver_of_another_department_cannot_see_it():
    """Bayrak tek basina yetmez: bolum uyeligi de aranir (K-25 iki boyut)."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec)

    baska_dep = client.post("/departments",
                            json={"name": "Başka Bölüm", "code": _u("BB")},
                            headers=h).json()
    yabanci = make_account([baska_dep["id"]], can_approve_schedule=True)
    assert client.get("/schedule-approvals", headers=yabanci).json() == []
    assert client.get(f"/schedule-approvals/{draft['id']}",
                      headers=yabanci).status_code == 404


# ------------------------------------------------------------------
# Onay: farkin uygulanmasi
# ------------------------------------------------------------------

def test_approve_applies_the_move_and_preserves_row_identity():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec, day=3, slot=5)

    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["status"] == "APPROVED"
    assert [i["kind"] for i in r.json()["applied"]] == ["MOVED"]

    # Satirin KIMLIGI korundu: ayni id, yeni yer, hala yayinda
    assert entry_row(yayin_id) == (3, 5, None)

    # Ozet donduruldu; taslagin kopyalari ise K-80'den beri KORUNUR — Yayin
    # Merkezi "bu taslak onaylandiginda program neye benziyordu" sorusunu
    # bu satirlardan cevapliyor. Yayin evrenine sizmadiklarinin guvencesi
    # `draft_id`nin dolu kalmasi (yayin HER YERDE `draft_id IS NULL`).
    db = SessionLocal()
    try:
        d = db.get(ScheduleDraft, draft["id"])
        assert d.status == DraftStatus.APPROVED
        assert d.reviewed_by is not None and d.reviewed_at is not None
        assert "taşındı" in d.applied_summary
        assert db.query(WeeklyScheduleEntry).filter(
            WeeklyScheduleEntry.draft_id == d.id).count() == 1
    finally:
        db.close()


def test_approving_a_stale_draft_also_reverts_the_other_persons_change():
    """K-59'un en onemli — ve en yanlis anlasilmaya acik — davranisi.

    Iki kisi ayni cohorttan taslak acar. Ayse'ninki once onaylanir. Mehmet'in
    taslagi Ayse'nin degisikligini GORMEMISTIR (taslak ozeldir) ve eski hali
    tasimaya devam eder.

    Mehmet'in onayi IKI degisiklik uygular: kendi tasidigi ders VE Ayse'nin
    tasidigi dersin eski yerine geri donmesi. Cunku fark "Mehmet ne degistirdi"
    degil, "Mehmet'in taslagi SU ANKI yayindan nerede farkli" demektir.

    BU BEKLENEN DAVRANISTIR (K-59). Koruma engellemeyle degil SEFFAFLIKLA
    saglanir: onaylayici inceleme ekraninda "Per 7 → Pzt 1" satirini gorur ve
    geri alma karari bilerek verilir
    (bkz. test_review_shows_a_change_that_would_undo_someone_elses_work).

    Farkin uygulanmasi (tamaminin ikame edilmesi yerine) VERIYI degil
    SATIR KIMLIGINI korur: tasinan satir silinip yeniden yaratilmaz.
    """
    h = admin_headers()
    dep, lec, cls, course, sec_a = base_setup(h)
    sec_b = make_section(h, course["id"], lec["id"], section_no=2)
    a_id = publish_entry(sec_a["id"], cls["id"], day=1, slot=1)
    b_id = publish_entry(sec_b["id"], cls["id"], day=1, slot=3)

    ayse = make_account([dep["id"]], can_manage_weekly=True)
    mehmet = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    # Ikisi de AYNI ANDA taslak acar (ikisi de eski yayini kopyalar)
    ayse_draft = create_draft(ayse, dep["id"])
    mehmet_draft = create_draft(mehmet, dep["id"])

    def tasi(h_, draft, section_id, day, slot):
        satirlar = client.get(f"/schedule-drafts/{draft['id']}/entries",
                              headers=h_).json()
        hedef = next(e for e in satirlar if e["section"]["id"] == section_id)
        r = client.patch(f"/schedule-drafts/{draft['id']}/entries/{hedef['id']}",
                         json={"day_of_week": day, "start_slot": slot}, headers=h_)
        assert r.status_code == 200, r.text

    tasi(ayse, ayse_draft, sec_a["id"], 4, 7)      # Ayse A dersini tasir
    tasi(mehmet, mehmet_draft, sec_b["id"], 5, 2)  # Mehmet B dersini tasir

    for h_, d in ((ayse, ayse_draft), (mehmet, mehmet_draft)):
        assert client.post(f"/schedule-drafts/{d['id']}/submit",
                           json={}, headers=h_).status_code == 200

    # Ayse'ninki once onaylanir
    assert client.post(f"/schedule-approvals/{ayse_draft['id']}/approve",
                       headers=onaylayan).status_code == 200
    assert entry_row(a_id) == (4, 7, None)

    # Mehmet'in taslagi su anki yayindan IKI yerde farkli:
    #   B: kendi tasidigi  |  A: Ayse'nin tasidigi (onun taslaginda hala eski yerde)
    r = client.post(f"/schedule-approvals/{mehmet_draft['id']}/approve",
                    headers=onaylayan)
    assert r.status_code == 200, r.text
    assert [i["kind"] for i in r.json()["applied"]] == ["MOVED", "MOVED"]

    assert entry_row(b_id) == (5, 2, None), "Mehmet'in degisikligi uygulanmadi"
    assert entry_row(a_id) == (1, 1, None), (
        "Ayse'nin degisikligi geri alinmali: Mehmet'in taslagi eski hali "
        "tasiyordu ve onaylayici bunu fark listesinde gorerek onayladi"
    )

    # Kimlik korundu: satirlar silinip yeniden yaratilmadi, ayni id'ler duruyor
    assert entry_row(a_id) is not None and entry_row(b_id) is not None


def test_review_shows_a_change_that_would_undo_someone_elses_work():
    """Ayni satira dokunuluyorsa engellenmez ama onaylayici GORUR: sorun
    uzerine yazmak degil, sessizce yazmakti (K-59)."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)

    mehmet = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    mehmet_draft = create_draft(mehmet, dep["id"])          # Pzt 1'i kopyaladi

    # Arka planda yayin degisti (baskasinin onayi gecti gibi)
    db = SessionLocal()
    try:
        e = db.get(WeeklyScheduleEntry, yayin_id)
        e.day_of_week, e.start_slot = 2, 6
        db.commit()
    finally:
        db.close()

    r = client.post(f"/schedule-drafts/{mehmet_draft['id']}/submit",
                    json={}, headers=mehmet)
    assert r.status_code == 200, r.text

    inceleme = client.get(f"/schedule-approvals/{mehmet_draft['id']}",
                          headers=onaylayan).json()
    item = inceleme["items"][0]
    assert item["kind"] == "MOVED"
    # Onaylayici "Sal 6 -> Pzt 1" gorur: geri alinacak degisiklik gorunur halde
    assert (item["before"]["day_of_week"], item["before"]["start_slot"]) == (2, 6)
    assert (item["after"]["day_of_week"], item["after"]["start_slot"]) == (1, 1)


def test_approve_is_blocked_when_the_request_went_stale():
    """Talep temizken gonderildi, arada baska cohort ayni derslige yerlesti."""
    h = admin_headers()
    dep, lec, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = submitted_draft(h, dep, cls, sec, day=3, slot=5)   # temizken gitti

    # Arada BASKA cohort ayni derslik/saati yayina aldi -> talep artik cakisiyor
    komsu = make_course(h, dep["id"], year=2)
    komsu_sec = make_section(h, komsu["id"], lec["id"])
    publish_entry(komsu_sec["id"], cls["id"], day=3, slot=5)

    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    assert r.status_code == 409, r.text
    assert any(c["rule_id"] == "W1" for c in r.json()["conflicts"])

    db = SessionLocal()
    try:
        assert db.get(ScheduleDraft, draft["id"]).status == DraftStatus.PENDING
    finally:
        db.close()


def test_approve_records_affected_departments_for_shared_courses():
    """Ortak ders tasindiysa etkilenen bolumler kayda gecer (degisiklik akisi)."""
    h = admin_headers()
    dep, _, cls, course, sec = base_setup(h)
    tuketen = client.post("/departments",
                          json={"name": "Tüketen", "code": _u("TK")},
                          headers=h).json()
    client.patch(f"/courses/{course['id']}", json={
        "is_common": True,
        "cohorts": [{"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip = make_account([dep["id"]], can_manage_weekly=True)
    draft = create_draft(sahip, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=sahip).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 4}, headers=sahip)
    # K-83: alicilar GONDERIM aninda cozulur — onaylayici hesabin
    # gonderimden ONCE var olmasi gerekiyor, yoksa talep ona adreslenmez.
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=sahip)

    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    db = SessionLocal()
    try:
        d = db.get(ScheduleDraft, draft["id"])
        assert [x.id for x in d.affected_departments] == [tuketen["id"]]
    finally:
        db.close()


def test_approve_applies_additions_and_removals():
    h = admin_headers()
    dep, lec, cls, course, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)
    ikinci = make_section(h, course["id"], lec["id"], section_no=2)

    sahip = make_account([dep["id"]], can_manage_weekly=True)
    draft = create_draft(sahip, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=sahip).json()[0]
    client.delete(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                  headers=sahip)
    client.post(f"/schedule-drafts/{draft['id']}/entries", json={
        "section_id": ikinci["id"], "classroom_id": cls["id"],
        "day_of_week": 2, "start_slot": 4, "slot_count": 1,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    }, headers=sahip)
    # K-83: alicilar GONDERIM aninda cozulur — onaylayici hesabin
    # gonderimden ONCE var olmasi gerekiyor, yoksa talep ona adreslenmez.
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=sahip)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    assert r.status_code == 200, r.text
    assert {i["kind"] for i in r.json()["applied"]} == {"ADDED", "REMOVED"}

    assert entry_row(yayin_id) is None            # kaldirildi
    db = SessionLocal()
    try:
        yeni = (
            db.query(WeeklyScheduleEntry)
            .filter(WeeklyScheduleEntry.section_id == ikinci["id"],
                    WeeklyScheduleEntry.draft_id.is_(None))
            .one()
        )
        assert (yeni.day_of_week, yeni.start_slot) == (2, 4)
        # Yerlesimi yapan taslak sahibidir, onaylayan degil
        assert yeni.created_by is not None
    finally:
        db.close()


def test_review_warns_when_the_program_moved_after_the_draft_was_opened():
    """Bayatlık işareti: onaylayıcı 'bu taslak eski mi' diye şüphelensin."""
    h = admin_headers()
    dep, lec, cls, course, sec_a = base_setup(h)
    sec_b = make_section(h, course["id"], lec["id"], section_no=2)
    publish_entry(sec_a["id"], cls["id"], day=1, slot=1)
    publish_entry(sec_b["id"], cls["id"], day=1, slot=3)

    ayse = make_account([dep["id"]], can_manage_weekly=True)
    mehmet = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    mehmet_draft = create_draft(mehmet, dep["id"])          # ONCE acildi

    # Taslak temizken hicbir sey olmamis
    inceleme_oncesi = create_draft(ayse, dep["id"])
    satirlar = client.get(f"/schedule-drafts/{inceleme_oncesi['id']}/entries",
                          headers=ayse).json()
    hedef = next(e for e in satirlar if e["section"]["id"] == sec_a["id"])
    client.patch(f"/schedule-drafts/{inceleme_oncesi['id']}/entries/{hedef['id']}",
                 json={"day_of_week": 4, "start_slot": 7}, headers=ayse)
    client.post(f"/schedule-drafts/{inceleme_oncesi['id']}/submit",
                json={}, headers=ayse)
    assert client.post(f"/schedule-approvals/{inceleme_oncesi['id']}/approve",
                       headers=onaylayan).status_code == 200

    # Mehmet kendi degisikligini yapip gonderir
    satirlar = client.get(f"/schedule-drafts/{mehmet_draft['id']}/entries",
                          headers=mehmet).json()
    hedef = next(e for e in satirlar if e["section"]["id"] == sec_b["id"])
    client.patch(f"/schedule-drafts/{mehmet_draft['id']}/entries/{hedef['id']}",
                 json={"day_of_week": 5, "start_slot": 2}, headers=mehmet)
    client.post(f"/schedule-drafts/{mehmet_draft['id']}/submit", json={},
                headers=mehmet)

    staleness = client.get(f"/schedule-approvals/{mehmet_draft['id']}",
                           headers=onaylayan).json()["staleness"]
    assert staleness["publications_since"] == 1
    assert staleness["last_published_at"] is not None
    assert staleness["last_published_by"] == "Onay Testi"


# ------------------------------------------------------------------
# Ret
# ------------------------------------------------------------------

def test_reject_returns_the_draft_to_its_owner_with_a_reason():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    yayin_id = publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip = make_account([dep["id"]], can_manage_weekly=True)
    # K-83: alicilar GONDERIM aninda cozulur — onaylayici hesabin
    # gonderimden ONCE var olmasi gerekiyor, yoksa talep ona adreslenmez.
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = submitted_draft(sahip, dep, cls, sec, day=3, slot=5)

    r = client.post(f"/schedule-approvals/{draft['id']}/reject",
                    json={"note": "Çarşamba 5 amfi bakımda"}, headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REJECTED"
    assert r.json()["review_note"] == "Çarşamba 5 amfi bakımda"

    assert entry_row(yayin_id) == (1, 1, None)     # yayina dokunulmadi

    # Sahibi gerekceyi gorur ve DUZENLEYEBILIR (REJECTED, OPEN gibi)
    benim = client.get(f"/schedule-drafts/{draft['id']}", headers=sahip).json()
    assert benim["review_note"] == "Çarşamba 5 amfi bakımda"
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries",
                       headers=sahip).json()[0]
    assert client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                        json={"day_of_week": 2}, headers=sahip).status_code == 200

    # Yeniden gonderilince onceki ret gerekcesi temizlenir
    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=sahip)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["status"] == "PENDING"
    assert r.json()["draft"]["review_note"] is None


def test_rejected_draft_leaves_the_approval_queue():
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    sahip = make_account([dep["id"]], can_manage_weekly=True)
    draft = submitted_draft(sahip, dep, cls, sec)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    client.post(f"/schedule-approvals/{draft['id']}/reject",
                json={"note": "hayır"}, headers=onaylayan)
    kuyruk = client.get("/schedule-approvals", headers=onaylayan).json()
    assert draft["id"] not in [d["id"] for d in kuyruk]
