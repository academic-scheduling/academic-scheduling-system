"""K-80 — onaylanan taslagin ONAYLANDIGI HALI okunabilir kalir.

Yayin Merkezi'nin "Yayinda" grubunda, o taslagin onaylandigi andaki program
goruntusu gosteriliyor. K-59'da onay taslagin satirlarini SILIYORDU, dolayisiyla
gosterilecek bir sey kalmiyordu; K-80 bu silmeyi kaldirdi.

Bu dosya, kaldirmanin bedava OLMADIGINI ve dogru sinirlarda durdugunu koruyor.
Uc soru cevaplanmali, cunku ucunun de sessizce bozulmasi mumkun:

1. **Goruntu KALICI MI?** Ayni cohortta baska bir taslak onaylanirsa, bu
   taslagin satirlari degismemeli. (Kullanici sarti tam olarak buydu.)
2. **Yayina SIZIYOR MU?** Korunan satirlar `draft_id` dolu oldugu icin yayin
   sorgularina girmemeli — sistem "yayinda"yi HER YERDE `draft_id IS NULL`
   diye tanimliyor ve bu testin korudugu sey o tanimin butunlugu.
3. **Onaylanan taslak hala DONMUS MU?** Satirlar durdugu icin "duzenlenebilir"
   gorunme riski dogdu; K-59'un kilidi yerinde kalmali.

Ayrica K-80'in iki kucuk ucu: `department_code` cikti alani ve onay notu.
"""

from app.db import SessionLocal
from app.models import DraftStatus, Exam, ScheduleDraft, WeeklyScheduleEntry
from tests.helpers import admin_headers, client
from tests.test_k59_approval_api import make_account, submitted_draft
from tests.test_k59_draft_api import (
    base_setup, create_draft, publish_entry,
)

SALI = "2026-09-15"        # ISODOW = 2 (hafta ici zorunlulugu, K-06)


def draft_rows(draft_id):
    """Taslaga ait (yayinda OLMAYAN) yerlesimlerin yeri."""
    db = SessionLocal()
    try:
        return sorted(
            (e.day_of_week, e.start_slot)
            for e in db.query(WeeklyScheduleEntry).filter(
                WeeklyScheduleEntry.draft_id == draft_id).all()
        )
    finally:
        db.close()


def published_rows(section_id):
    db = SessionLocal()
    try:
        return sorted(
            (e.day_of_week, e.start_slot)
            for e in db.query(WeeklyScheduleEntry).filter(
                WeeklyScheduleEntry.section_id == section_id,
                WeeklyScheduleEntry.draft_id.is_(None)).all()
        )
    finally:
        db.close()


# ------------------------------------------------------------------
# 1. Goruntu kalici: sonraki onaylar dokunmaz
# ------------------------------------------------------------------

def test_approved_draft_keeps_its_rows_after_a_later_approval_of_the_same_cohort():
    """K-80'in ASIL sartı: "spesifik olarak O taslagi" gosterebilmek.

    Ayni cohortta ikinci bir taslak onaylanir ve dersi bir kez daha tasir.
    Yayin yeni yere gider; BIRINCI taslagin satirlari ise onaylandigi yerde
    kalmalidir. Bu ayrisma, korunan satirlarin gercekten bir ANLIK GORUNTU
    oldugunu — yayinin takip eden bir kopyasi olmadigini — kanitlar.
    """
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    # 1. taslak: Pzt 1 -> Car 5, onaylandi.
    ilk = submitted_draft(h, dep, cls, sec, day=3, slot=5)
    assert client.post(f"/schedule-approvals/{ilk['id']}/approve",
                       headers=onaylayan).status_code == 200
    assert draft_rows(ilk["id"]) == [(3, 5)]
    assert published_rows(sec["id"]) == [(3, 5)]

    # 2. taslak: Car 5 -> Cum 2, o da onaylandi.
    ikinci = submitted_draft(h, dep, cls, sec, day=5, slot=2)
    assert client.post(f"/schedule-approvals/{ikinci['id']}/approve",
                       headers=onaylayan).status_code == 200

    # Yayin ilerledi; BIRINCI taslagin goruntusu yerinde kaldi.
    assert published_rows(sec["id"]) == [(5, 2)]
    assert draft_rows(ilk["id"]) == [(3, 5)], "onaylanan taslak sonraki onaydan etkilendi"
    assert draft_rows(ikinci["id"]) == [(5, 2)]


def test_owner_can_still_read_the_rows_of_an_approved_draft():
    """Goruntunun UCU da acik olmali — DB'de durup API'den okunamamasi
    K-80'i yarim birakirdi. Satir ucu sahibe aciktir (K-59 gizliligi aynen:
    baskasi goremez), durum kisitlamasi yok cunku OKUMA donmayi bozmaz."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = submitted_draft(h, dep, cls, sec, day=2, slot=4)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    r = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h)
    assert r.status_code == 200, r.text
    assert [(e["day_of_week"], e["start_slot"]) for e in r.json()] == [(2, 4)]


# ------------------------------------------------------------------
# 2. Yayin evrenine sizmiyor
# ------------------------------------------------------------------

def test_preserved_rows_do_not_leak_into_the_published_schedule():
    """Korunan satirlarin tek guvencesi `draft_id`nin dolu kalmasi.

    Yayin listesi ucu tasima sonrasi TEK satir gormeli: taslaktaki kopya
    yayin sorgusuna girseydi ayni ders iki yerde birden gorunurdu — ve bu,
    kullanicinin programinda hayalet ders demek olurdu.
    """
    h = admin_headers()
    dep, _, cls, course, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = submitted_draft(h, dep, cls, sec, day=4, slot=3)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    yayin = client.get(
        f"/weekly-entries?department_id={dep['id']}&year=1&semester=FALL",
        headers=h).json()
    bizimkiler = [e for e in yayin if e["section"]["id"] == sec["id"]]
    assert len(bizimkiler) == 1, "taslak kopyasi yayin listesine sizdi"
    assert (bizimkiler[0]["day_of_week"], bizimkiler[0]["start_slot"]) == (4, 3)


def test_a_new_draft_copies_only_the_published_program():
    """Yeni taslak yayinin kopyasidir (K-59). Onceki ONAYLANMIS taslagin
    korunan satirlari o kopyaya karismamali — karisirsa yeni taslak dogar
    dogmaz "2 yerlesim" gorur ve fark hesabi bastan bozulur."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    ilk = submitted_draft(h, dep, cls, sec, day=3, slot=6)
    assert client.post(f"/schedule-approvals/{ilk['id']}/approve",
                       headers=onaylayan).status_code == 200

    yeni = create_draft(h, dep["id"])
    assert yeni["entry_count"] == 1
    assert yeni["change_count"] == 0
    assert draft_rows(yeni["id"]) == [(3, 6)]


# ------------------------------------------------------------------
# 3. Onaylanan taslak hala donmus
# ------------------------------------------------------------------

def test_approved_draft_stays_frozen_even_though_its_rows_survive():
    """Satirlar durdugu icin "duzenlenebilir" gorunme riski dogdu; K-59'un
    kilidi yerinde. Yazan her yol 409 vermeli, silme dahil."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = submitted_draft(h, dep, cls, sec, day=2, slot=2)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    satir = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/entries/{satir['id']}",
        json={"day_of_week": 5}, headers=h).status_code == 409
    assert client.delete(
        f"/schedule-drafts/{draft['id']}/entries/{satir['id']}",
        headers=h).status_code == 409
    assert client.post(f"/schedule-drafts/{draft['id']}/clear",
                       json={"include_shared": False}, headers=h).status_code == 409
    assert client.delete(f"/schedule-drafts/{draft['id']}",
                         headers=h).status_code == 409

    # Kilit gercekten tuttu mu — goruntu bozulmadi.
    assert draft_rows(draft["id"]) == [(2, 2)]


def test_approved_draft_reports_no_live_change_count():
    """`change_count` onaylanan kayitta 0 kalir. Satirlar durdugu icin hesap
    artik KOSABILIR — ama o anki yayina karsi kosardi ve sonraki onaylarla
    kayardi ("onaylandi ama 3 degisiklik var"). Ozet `applied_summary`de."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    ilk = submitted_draft(h, dep, cls, sec, day=3, slot=5)
    client.post(f"/schedule-approvals/{ilk['id']}/approve", headers=onaylayan)
    # Sonraki onay yayini kaydirir; ilk taslak yine de 0 fark bildirmeli.
    ikinci = submitted_draft(h, dep, cls, sec, day=5, slot=1)
    client.post(f"/schedule-approvals/{ikinci['id']}/approve", headers=onaylayan)

    kayit = next(d for d in client.get(
        "/schedule-drafts?include_history=true", headers=h).json()
        if d["id"] == ilk["id"])
    assert kayit["status"] == "APPROVED"
    assert kayit["change_count"] == 0
    assert kayit["applied_summary"]


# ------------------------------------------------------------------
# Sinav kolu — ayni sozlesme (K-60 simetrisi)
# ------------------------------------------------------------------

def test_exam_draft_rows_are_preserved_too():
    """Iki kol tek yasam dongusudur; goruntu garantisi de tek olmali."""
    h = admin_headers()
    dep, lec, cls, course, _ = base_setup(h)
    r = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL", "kind": "EXAM",
    }, headers=h)
    assert r.status_code == 201, r.text
    draft = r.json()

    r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": course["id"], "exam_type": "FINAL", "exam_date": SALI,
        "start_time": "13:00:00", "duration_minutes": 120,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 201, r.text
    assert client.post(f"/schedule-drafts/{draft['id']}/submit",
                       json={}, headers=h).status_code == 200

    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    db = SessionLocal()
    try:
        assert db.query(Exam).filter(Exam.draft_id == draft["id"]).count() == 1
        assert db.query(Exam).filter(
            Exam.course_id == course["id"], Exam.draft_id.is_(None)).count() == 1
    finally:
        db.close()

    r = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h)
    assert r.status_code == 200
    assert [x["exam_date"] for x in r.json()] == [SALI]


# ------------------------------------------------------------------
# Cikti alanlari: bolum kodu ve karar notu
# ------------------------------------------------------------------

def test_draft_output_carries_the_department_code():
    """Yayin Merkezi kuyrugu bolumu KODUYLA tanitiyor (ad dar sutunda
    kirpiliyordu). Alan hem kendi taslak listesinde hem onay kuyrugunda
    dolmali — iki ayri `_to_out` var ve biri unutulabilirdi."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    draft = submitted_draft(h, dep, cls, sec)
    benim = next(d for d in client.get("/schedule-drafts", headers=h).json()
                 if d["id"] == draft["id"])
    assert benim["department_code"] == dep["code"]

    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    kuyruk = next(d for d in client.get("/schedule-approvals",
                                        headers=onaylayan).json()
                  if d["id"] == draft["id"])
    assert kuyruk["department_code"] == dep["code"]


def test_approval_note_is_optional_and_recorded():
    """Onay notu (K-80): retten farkli olarak ZORUNLU DEGIL.

    Iki yol da gecerli — notlu onay `review_note`a yazilir, govdesiz onay
    calismaya devam eder (uc govdeyi opsiyonel ilan ediyor).
    """
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    notlu = submitted_draft(h, dep, cls, sec, day=2, slot=3)
    r = client.post(f"/schedule-approvals/{notlu['id']}/approve",
                    json={"note": "2. şubeyi de kontrol ettim"}, headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["review_note"] == "2. şubeyi de kontrol ettim"
    assert r.json()["draft"]["reviewer"]["id"]

    notsuz = submitted_draft(h, dep, cls, sec, day=4, slot=1)
    r = client.post(f"/schedule-approvals/{notsuz['id']}/approve", headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["review_note"] is None


def test_resubmitting_clears_the_previous_decision_note():
    """K-59'da zaten vardi ama K-80 notu ONAYA da acti: yeni turda eski
    karar notu yaniltmamali. Ret notu yeniden gonderimde silinir."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = submitted_draft(h, dep, cls, sec, day=3, slot=2)
    assert client.post(f"/schedule-approvals/{draft['id']}/reject",
                       json={"note": "salı gününe alın"},
                       headers=onaylayan).status_code == 200

    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "düzeltildi"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["review_note"] is None
    assert r.json()["draft"]["status"] == "PENDING"


def test_rejected_draft_keeps_its_rows_and_conflict_scan():
    """Reddedilen taslak duzenlenebilir bir durumdur ve satirlari zaten
    duruyordu; Yayin Merkezi bu satirlardan "reddedildigi hali"ni ciziyor.
    Cakisma taramasi da acik kalmali — sahibi neyi duzeltecegini oradan gorur.
    """
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = submitted_draft(h, dep, cls, sec, day=4, slot=4)
    assert client.post(f"/schedule-approvals/{draft['id']}/reject",
                       json={"note": "çakışıyor"}, headers=onaylayan).status_code == 200

    assert draft_rows(draft["id"]) == [(4, 4)]
    assert client.get(f"/schedule-drafts/{draft['id']}/entries",
                      headers=h).status_code == 200
    r = client.get(f"/schedule-drafts/{draft['id']}/conflicts", headers=h)
    assert r.status_code == 200
    assert set(r.json()) == {"hard", "warnings"}

    db = SessionLocal()
    try:
        d = db.get(ScheduleDraft, draft["id"])
        assert d.status == DraftStatus.REJECTED
        assert d.review_note == "çakışıyor"
        assert d.reviewer is not None
    finally:
        db.close()


# ------------------------------------------------------------------
# K-80 · "Onaylananlar" gorunurlugu: hazirlik ozel, SONUC paylasilir
# ------------------------------------------------------------------
#
# Yayin Merkezi'nin "Onaylananlar" grubu artik BASKALARININ onaylanmis
# taslaklarini da gosteriyor. Bu, K-59 gizliliginin sinirini degistiriyor ve
# tam da bu yuzden en dikkatli korunmasi gereken yer burasi: genisleyen sey
# YALNIZCA onaylanan kayit olmali. OPEN/PENDING/REJECTED bir taslak sahibinden
# baskasina — ADMIN dahil — hala gorunmemeli.

def approved_draft_of(owner_h, dep, cls, sec, onaylayan, *, day=2, slot=6):
    draft = submitted_draft(owner_h, dep, cls, sec, day=day, slot=slot)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200
    return draft


def test_approval_history_shows_other_peoples_approved_drafts_in_scope():
    """Ayni bolume UYE baska bir kullanici onaylanan kaydi gorur ve satirlarini
    okuyabilir — grubun anlami bu."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    draft = approved_draft_of(h, dep, cls, sec, onaylayan)

    # Uye ama taslagin sahibi OLMAYAN biri (yetkisiz de olabilir: gorunurluk
    # onay yetkisine degil UYELIGE bakar).
    uye = make_account([dep["id"]])
    gecmis = client.get("/schedule-approvals/history", headers=uye)
    assert gecmis.status_code == 200, gecmis.text
    assert draft["id"] in [d["id"] for d in gecmis.json()]

    r = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=uye)
    assert r.status_code == 200, r.text
    assert [(e["day_of_week"], e["start_slot"]) for e in r.json()] == [(2, 6)]


def test_history_excludes_members_of_other_departments():
    """Baska bolumun uyesi kapsam disidir — ortak ders etkisi de yoksa gormez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = approved_draft_of(h, dep, cls, sec, onaylayan, day=3, slot=3)

    baska_dep, _, _, _, _ = base_setup(h)
    yabanci = make_account([baska_dep["id"]])

    assert draft["id"] not in [
        d["id"] for d in client.get("/schedule-approvals/history",
                                    headers=yabanci).json()]
    assert client.get(f"/schedule-drafts/{draft['id']}/entries",
                      headers=yabanci).status_code == 404


def test_history_is_empty_for_a_membershipless_account():
    """Uyeligi olmayan alt hesap bos liste alir — `/schedule-changes` ile ayni
    cizgi. (Seed'deki "Alt Hesap (Test)" tam olarak bu durumda.)"""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = approved_draft_of(h, dep, cls, sec, onaylayan, day=4, slot=2)

    uyeliksiz = make_account([])
    assert client.get("/schedule-approvals/history", headers=uyeliksiz).json() == []
    assert client.get(f"/schedule-drafts/{draft['id']}/entries",
                      headers=uyeliksiz).status_code == 404


def test_unapproved_drafts_stay_private_even_from_admin():
    """K-59'un CEKIRDEGI — K-80 bunu bozmamali.

    Onaylanmamis taslak (OPEN / PENDING / REJECTED) sahibinden baskasina
    gorunmez; ADMIN de muaf degil. Genisleyen sey yalnizca ONAYLANAN kayitti.
    """
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    sahip = make_account([dep["id"]], can_manage_weekly=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    # OPEN
    acik = create_draft(sahip, dep["id"])
    for baskasi in (h, onaylayan):
        assert client.get(f"/schedule-drafts/{acik['id']}/entries",
                          headers=baskasi).status_code == 404
        assert client.get(f"/schedule-drafts/{acik['id']}",
                          headers=baskasi).status_code == 404
    assert client.delete(f"/schedule-drafts/{acik['id']}", headers=sahip).status_code == 204

    # PENDING — onaylayici INCELEME ucundan gorur ama taslak ucundan GORMEZ,
    # ve onay yetkisi olmayan admin de satirlarina erisemez.
    bekleyen = submitted_draft(sahip, dep, cls, sec, day=5, slot=5)
    assert client.get(f"/schedule-drafts/{bekleyen['id']}/entries",
                      headers=h).status_code == 404

    # REJECTED
    assert client.post(f"/schedule-approvals/{bekleyen['id']}/reject",
                       json={"note": "olmadı"}, headers=onaylayan).status_code == 200
    assert client.get(f"/schedule-drafts/{bekleyen['id']}/entries",
                      headers=h).status_code == 404
    assert client.get(f"/schedule-drafts/{bekleyen['id']}/entries",
                      headers=onaylayan).status_code == 404


def test_history_route_is_not_shadowed_by_the_id_route():
    """`/schedule-approvals/history` ile `/schedule-approvals/{draft_id}` ayni
    on eki paylasiyor. Sabit yol ONCE tanimlanmazsa "history" bir id sanilir ve
    uc 422 dondurur — sessiz ve kafa karistirici bir kirilma."""
    h = admin_headers()
    r = client.get("/schedule-approvals/history", headers=h)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_approved_draft_is_still_read_only_for_a_non_owner():
    """Gorme hakki DUZENLEME hakki degil: kapsamdaki uye satirlari okur ama
    yazma uclari (sahiplik arayan `_get_own_draft`) ona kapali kalir."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    draft = approved_draft_of(h, dep, cls, sec, onaylayan, day=5, slot=7)

    uye = make_account([dep["id"]], can_manage_weekly=True)
    satir = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=uye).json()[0]
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/entries/{satir['id']}",
        json={"day_of_week": 1}, headers=uye).status_code == 404
    assert client.delete(f"/schedule-drafts/{draft['id']}",
                         headers=uye).status_code == 404
    # Fark/cakisma uclari da sahiplik arar (canli hesap, gecmis kayitta anlamsiz)
    assert client.get(f"/schedule-drafts/{draft['id']}/diff",
                      headers=uye).status_code == 404
