"""K-60 sinav onayi — inceleme, fark uygulama, oz-onay, bayatlik.

K-59'un onay testinin sinav ikizi. Yasam dongusu ve kapilar ayni oldugu icin
burada TEKRAR EDILMEZ (oz-onay yasaginin genel hali, kuyruk yetkisi, ret
gerekcesi orada kanitli); bu dosya yalniz SINAVA OZGU olani olcer:

  - Onay sinav farkini yayina uygular: tasima satir KIMLIGINI korur, derslik
    listesi de gecer, ekleme/kaldirma calisir.
  - Inceleme yuku `entries` degil `exams` tasir (K-60).
  - Bayat sinav taslaginin onayi, otekinin degisikligini de geri alir —
    haftaliktaki ayni davranis, ayni gerekce (seffaflik, engelleme degil).
  - Bayatlik sayaci TURE bakar: haftalik onay, sinav taslagini bayatlatmaz.
  - Ortak dersin sinavi tasindiginda etkilenen bolumler kaydedilir (K-48).
"""

from datetime import date

from app.db import SessionLocal
from app.models import DraftStatus, Exam, ScheduleDraft
from tests.helpers import _u, admin_headers, client
from tests.test_k59_approval_api import make_account
from tests.test_k59_draft_api import (
    create_draft, make_classroom, make_course, make_department, make_lecturer,
    make_section, publish_entry,
)
from tests.test_k60_exam_draft_api import (
    MONDAY, TUESDAY, base_setup, create_exam_draft, publish_exam,
)


def exam_row(exam_id):
    """(tarih, saat, derslik id'leri, draft_id) — satir kimligi korunuyor mu?"""
    db = SessionLocal()
    try:
        x = db.get(Exam, exam_id)
        if x is None:
            return None
        return (str(x.exam_date), str(x.start_time),
                sorted(c.id for c in x.classrooms), x.draft_id)
    finally:
        db.close()


def submitted_exam_draft(h, dep, **degisiklik):
    """Bir sinavi tasiyip onaya gonderilmis sinav taslagi uretir."""
    draft = create_exam_draft(h, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    r = client.patch(f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
                     json=degisiklik or {"exam_date": TUESDAY}, headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "vize takvimi"}, headers=h)
    assert r.status_code == 200, r.text
    return draft, kopya


# ------------------------------------------------------------------
# Inceleme yuku
# ------------------------------------------------------------------

def test_review_carries_exams_not_entries():
    """Onerilen taraf turune gore dolar; tek kaba sikistirilmaz (K-60)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, _ = submitted_exam_draft(h, dep)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    r = client.get(f"/schedule-approvals/{draft['id']}", headers=onaylayan)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["draft"]["kind"] == "EXAM"
    assert body["entries"] == []
    assert len(body["exams"]) == 1
    assert body["items"][0]["entity"] == "exam"


# ------------------------------------------------------------------
# Farkin yayina uygulanmasi
# ------------------------------------------------------------------

def test_approval_moves_the_published_exam_and_keeps_its_identity():
    """Tasima yayindaki satirin tarihini gunceller — silip yeniden yaratmaz."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, _ = submitted_exam_draft(h, dep, exam_date=TUESDAY,
                                    start_time="16:30:00")
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["status"] == "APPROVED"

    tarih, saat, odalar, draft_id = exam_row(yayin_id)
    assert (tarih, saat) == (TUESDAY, "16:30:00")   # AYNI satir tasindi
    assert draft_id is None                          # yayinda kaldi
    assert odalar == [cls["id"]]


def test_approval_applies_classroom_changes():
    """Derslik listesi yerlesimin parcasi (K-17) — onayla birlikte gecmeli."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    ikinci = make_classroom(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, _ = submitted_exam_draft(
        h, dep, classroom_ids=[cls["id"], ikinci["id"]])
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200
    _, _, odalar, _ = exam_row(yayin_id)
    assert odalar == sorted([cls["id"], ikinci["id"]])


def test_approval_adds_and_removes_exams():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    assert client.delete(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}", headers=h
    ).status_code == 204
    assert client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": course["id"], "exam_type": "FINAL", "exam_date": TUESDAY,
        "start_time": "13:00:00", "duration_minutes": 120,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h).status_code == 201
    assert client.post(f"/schedule-drafts/{draft['id']}/submit",
                       json={"note": "vize kalksin, final gelsin"},
                       headers=h).status_code == 200

    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=onaylayan).status_code == 200

    assert exam_row(yayin_id) is None                 # vize kaldirildi
    db = SessionLocal()
    try:
        yayindakiler = db.query(Exam).filter(
            Exam.course_id == course["id"], Exam.draft_id.is_(None)).all()
        assert len(yayindakiler) == 1
        assert yayindakiler[0].exam_type.value == "FINAL"
        # Ekleme onaylayanin degil TASLAK SAHIBININ adina yazilir
        assert yayindakiler[0].created_by is not None
        # Taslagin kopyalari K-80'den beri KORUNUR (onaylandigi hal salt
        # goruntu olarak okunabilsin diye). Taslakta vize silinip final
        # eklenmisti, dolayisiyla geriye tek satir kalir.
        assert db.query(Exam).filter(Exam.draft_id == draft["id"]).count() == 1
    finally:
        db.close()


def test_applied_summary_is_frozen_in_exam_wording():
    """Onaydan sonra fark yeniden hesaplanamaz; ozet kayitta donar (K-36)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, _ = submitted_exam_draft(h, dep, exam_date=TUESDAY)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    ozet = r.json()["draft"]["applied_summary"]
    assert "taşındı" in ozet
    assert "Vize" in ozet                     # sinav dili, sube/gun dili degil
    assert "14 Eyl" in ozet and "15 Eyl" in ozet


# ------------------------------------------------------------------
# Bayatlik: haftaliktaki davranisin aynisi, ayri sayilan tur
# ------------------------------------------------------------------

def test_approving_a_stale_exam_draft_also_reverts_the_other_persons_change():
    """K-59'un en onemli davranisi, sinav tarafinda.

    Iki kisi ayni cohorttan sinav taslagi acar; birinin onayi gecer. Otekinin
    taslagi eski hali tasidigi icin onayi o degisikligi de GERI ALIR. Bu
    beklenen davranistir: fark "ne degistirdim" degil "taslagim su anki
    yayindan nerede farkli" demektir. Koruma engelleme degil seffafliktir —
    onaylayici geri alinacak satiri fark listesinde gorur.
    """
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    ikinci_ders = make_course(h, dep["id"], year=1)
    a_id = publish_exam(course["id"], lec["id"], [cls["id"]], start_time="09:00:00")
    b_id = publish_exam(ikinci_ders["id"], lec["id"], [cls["id"]],
                        exam_date=TUESDAY, start_time="09:00:00")

    ayse = make_account([dep["id"]], can_manage_exams=True)
    mehmet = make_account([dep["id"]], can_manage_exams=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    ayse_draft = create_exam_draft(ayse, dep["id"])
    mehmet_draft = create_exam_draft(mehmet, dep["id"])

    def tasi(h_, draft, course_id, **degisiklik):
        satirlar = client.get(f"/schedule-drafts/{draft['id']}/exams",
                              headers=h_).json()
        hedef = next(x for x in satirlar if x["course"]["id"] == course_id)
        r = client.patch(f"/schedule-drafts/{draft['id']}/exams/{hedef['id']}",
                         json=degisiklik, headers=h_)
        assert r.status_code == 200, r.text

    tasi(ayse, ayse_draft, course["id"], start_time="14:00:00")
    tasi(mehmet, mehmet_draft, ikinci_ders["id"], start_time="16:00:00")

    for hh, d in ((ayse, ayse_draft), (mehmet, mehmet_draft)):
        assert client.post(f"/schedule-drafts/{d['id']}/submit",
                           json={"note": "t"}, headers=hh).status_code == 200

    assert client.post(f"/schedule-approvals/{ayse_draft['id']}/approve",
                       headers=onaylayan).status_code == 200
    assert exam_row(a_id)[1] == "14:00:00"

    # Mehmet'in incelemesi GERI ALINACAK satiri da gosteriyor mu?
    inceleme = client.get(f"/schedule-approvals/{mehmet_draft['id']}",
                          headers=onaylayan).json()
    geri_alinan = [i for i in inceleme["items"]
                   if i["course_id"] == course["id"]]
    assert len(geri_alinan) == 1, inceleme["items"]
    assert geri_alinan[0]["before"]["start_time"] == "14:00:00"
    assert geri_alinan[0]["after"]["start_time"] == "09:00:00"
    assert inceleme["staleness"]["publications_since"] == 1

    assert client.post(f"/schedule-approvals/{mehmet_draft['id']}/approve",
                       headers=onaylayan).status_code == 200
    assert exam_row(a_id)[1] == "09:00:00"      # Ayse'ninki geri alindi
    assert exam_row(b_id)[1] == "16:00:00"      # Mehmet'inki gecti


def test_weekly_approval_does_not_make_an_exam_draft_look_stale():
    """Bayatlik olcusu TURE baglidir: haftalik onay sinav taslaginin
    kopyaladigi hicbir satiri degistirmez, sayilirsa yanlis alarm olur."""
    h = admin_headers()
    dep = make_department(h)
    lec = make_lecturer(h)
    cls = make_classroom(h)
    course = make_course(h, dep["id"], year=1)
    sec = make_section(h, course["id"], lec["id"])
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    publish_exam(course["id"], lec["id"], [cls["id"]])

    hazirlayan = make_account([dep["id"]], can_manage_weekly=True,
                              can_manage_exams=True)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    # Once sinav taslagi acilir (bayatlik olcusu bu andan itibaren sayar)
    sinav_taslagi = create_exam_draft(hazirlayan, dep["id"])

    # Sonra HAFTALIK bir talep onaylanir
    haftalik = create_draft(hazirlayan, dep["id"])
    kopya = client.get(f"/schedule-drafts/{haftalik['id']}/entries",
                       headers=hazirlayan).json()[0]
    client.patch(f"/schedule-drafts/{haftalik['id']}/entries/{kopya['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=hazirlayan)
    assert client.post(f"/schedule-drafts/{haftalik['id']}/submit",
                       json={"note": "t"}, headers=hazirlayan).status_code == 200
    assert client.post(f"/schedule-approvals/{haftalik['id']}/approve",
                       headers=onaylayan).status_code == 200

    # Sinav taslagi onaya gider; bayatlik sayaci 0 olmali
    sinavlar = client.get(f"/schedule-drafts/{sinav_taslagi['id']}/exams",
                          headers=hazirlayan).json()
    client.patch(f"/schedule-drafts/{sinav_taslagi['id']}/exams/{sinavlar[0]['id']}",
                 json={"start_time": "16:30:00"}, headers=hazirlayan)
    assert client.post(f"/schedule-drafts/{sinav_taslagi['id']}/submit",
                       json={"note": "t"}, headers=hazirlayan).status_code == 200

    inceleme = client.get(f"/schedule-approvals/{sinav_taslagi['id']}",
                          headers=onaylayan).json()
    assert inceleme["staleness"]["publications_since"] == 0


# ------------------------------------------------------------------
# Ortak ders ve oz-onay
# ------------------------------------------------------------------

def test_shared_course_exam_records_affected_departments():
    """Ortak dersin sinavi tasindiginda etkilenen bolumler onayla kaydedilir;
    degisiklik akisi bu satirlari okur (K-48/K-59)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    tuketen = make_department(h)
    r = client.patch(f"/courses/{course['id']}", json={
        "is_common": True,      # istek alani `cohorts`, cevap alani `extra_cohorts`
        "cohorts": [{"department_id": tuketen["id"], "year": 1, "semester": "FALL"}],
    }, headers=h)
    assert r.status_code == 200, r.text
    assert len(r.json()["extra_cohorts"]) == 1, r.text
    publish_exam(course["id"], lec["id"], [cls["id"]])

    draft, _ = submitted_exam_draft(h, dep, exam_date=TUESDAY)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)
    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["applied"][0]["is_shared"] is True

    db = SessionLocal()
    try:
        d = db.get(ScheduleDraft, draft["id"])
        assert [x.id for x in d.affected_departments] == [tuketen["id"]]
    finally:
        db.close()


def test_self_approval_is_forbidden_for_exam_drafts_too():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, _ = submitted_exam_draft(h, dep)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=h)
    assert r.status_code == 403
    assert "Kendi talebinizi" in r.json()["detail"]


def test_rejecting_an_exam_draft_keeps_it_editable():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft, kopya = submitted_exam_draft(h, dep, exam_date=TUESDAY)
    onaylayan = make_account([dep["id"]], can_approve_schedule=True)

    r = client.post(f"/schedule-approvals/{draft['id']}/reject",
                    json={"note": "Bu tarih bayram tatiline denk geliyor"},
                    headers=onaylayan)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REJECTED"
    assert exam_row(yayin_id)[0] == MONDAY        # yayin dokunulmadi

    # Reddedilen taslak duzenlenebilir (OPEN gibi)
    assert client.patch(f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
                        json={"start_time": "11:00:00"},
                        headers=h).status_code == 200
