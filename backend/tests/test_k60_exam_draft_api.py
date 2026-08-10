"""K-60 sinav taslak API'si — kopyalama, kapsam, fark, yetki, gonderme.

K-59'un taslak API testinin sinav ikizi. Kanitlanan sey listesi:
  - Sinav taslagi yayindaki sinav takviminin KOPYASI olarak acilir (derslikler
    dahil) — kosulsuz UNIQUE bolunmeseydi bu adim patlardi.
  - Ayni cohort icin haftalik ve sinav taslagi AYNI ANDA acilabilir.
  - Fark anahtari `(ders, tip, sira)`; tasima MOVED, silme REMOVED, ekleme
    ADDED. Not degisikligi de bir degisikliktir (ogrenciye basilan icerik).
  - Kapsam denetimi ders duzeyinde: baska cohort'un dersinin sinavi taslaga
    konamaz.
  - Onaya gondermek SINAV yetkisi ister (`can_manage_exams`), haftalik yetkisi
    YETMEZ — hazirlamak alan uzmanligidir (K-60).
  - Turler karismaz: sinav taslagina haftalik yerlesim ucu 409 doner.
  - Taslaktaki degisiklik yayina DOKUNMAZ.
"""

from datetime import date

from app.db import SessionLocal
from app.models import Exam, ExamType
from tests.helpers import _u, admin_headers, client, sub_headers
from tests.test_k59_draft_api import (
    make_classroom, make_course, make_department, make_lecturer,
)

MONDAY = "2026-09-14"      # ISODOW = 1 (hafta ici zorunlulugu, K-06)
TUESDAY = "2026-09-15"


# ------------------------------------------------------------------
# Kurulum yardimcilari
# ------------------------------------------------------------------

def publish_exam(course_id, lecturer_id, classroom_ids=(), exam_date=MONDAY,
                 start_time="09:00:00", exam_type=ExamType.MIDTERM, exam_index=1):
    """Yayindaki bir sinav uretir.

    Eski `/exams` ucundan gecmek yerine dogrudan DB'ye yaziyoruz: bu testlerin
    konusu yeni akis, eski submit yolunun davranisi degil (K-59 testlerindeki
    `publish_entry` ile ayni gerekce). draft_id NULL = yayinda.
    """
    db = SessionLocal()
    try:
        from app.models import Classroom
        x = Exam(
            course_id=course_id, exam_type=exam_type, exam_index=exam_index,
            exam_date=date.fromisoformat(exam_date), start_time=start_time,
            duration_minutes=90, lecturer_id=lecturer_id,
        )
        if classroom_ids:
            x.classrooms = db.query(Classroom).filter(
                Classroom.id.in_(classroom_ids)).all()
        db.add(x)
        db.commit()
        return x.id
    finally:
        db.close()


def base_setup(h, year=1):
    dep = make_department(h)
    lec = make_lecturer(h)
    cls = make_classroom(h)
    course = make_course(h, dep["id"], year=year)
    return dep, lec, cls, course


def create_exam_draft(h, dep_id, year=1, semester="FALL"):
    r = client.post("/schedule-drafts", json={
        "department_id": dep_id, "year": year, "semester": semester,
        "kind": "EXAM",
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def published_exam_count(course_id) -> int:
    db = SessionLocal()
    try:
        return db.query(Exam).filter(
            Exam.course_id == course_id, Exam.draft_id.is_(None)).count()
    finally:
        db.close()


# ------------------------------------------------------------------
# Olusturma ve kopyalama
# ------------------------------------------------------------------

def test_exam_draft_opens_as_a_copy_of_the_published_schedule():
    """Kopyalama, K-60'in kismi tekillik bolunmesinin ilk sinavi."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])

    draft = create_exam_draft(h, dep["id"])
    assert draft["kind"] == "EXAM"
    assert draft["entry_count"] == 1
    assert draft["change_count"] == 0          # kopya, yayinla ayni

    kopyalar = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()
    assert len(kopyalar) == 1
    # Derslikler de kopyalandi: derslik listesi yerlesimin parcasi (K-17)
    assert [c["id"] for c in kopyalar[0]["classrooms"]] == [cls["id"]]


def test_weekly_and_exam_drafts_coexist_for_the_same_cohort():
    """Iki is bagimsiz yuruyor; tekillik anahtarina `kind` bu yuzden girdi."""
    h = admin_headers()
    dep, _, _, _ = base_setup(h)
    haftalik = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL"}, headers=h)
    assert haftalik.status_code == 201, haftalik.text
    sinav = create_exam_draft(h, dep["id"])
    assert sinav["id"] != haftalik.json()["id"]


def test_second_exam_draft_for_same_cohort_is_rejected():
    h = admin_headers()
    dep, _, _, _ = base_setup(h)
    create_exam_draft(h, dep["id"])
    r = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL", "kind": "EXAM",
    }, headers=h)
    assert r.status_code == 409
    assert "sınav" in r.json()["detail"]


# ------------------------------------------------------------------
# Fark: anahtar (ders, tip, sira)
# ------------------------------------------------------------------

def test_moving_an_exam_shows_as_moved_and_leaves_published_alone():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    r = client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"exam_date": TUESDAY, "start_time": "14:00:00"}, headers=h)
    assert r.status_code == 200, r.text

    fark = client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()
    assert fark["kind"] == "EXAM"
    assert len(fark["items"]) == 1
    item = fark["items"][0]
    assert item["entity"] == "exam"
    assert item["kind"] == "MOVED"
    assert item["before"]["exam_date"] == MONDAY
    assert item["after"]["exam_date"] == TUESDAY

    # Yayin YERINDE: onay gelene dek hicbir sey degismez
    db = SessionLocal()
    try:
        assert str(db.get(Exam, yayin_id).exam_date) == MONDAY
    finally:
        db.close()


def test_removing_and_adding_show_up_in_the_diff():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    assert client.delete(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}", headers=h
    ).status_code == 204

    # Ayni derse FINAL ekle: farkli anahtar -> ayri bir ADDED satiri
    r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": course["id"], "exam_type": "FINAL", "exam_date": TUESDAY,
        "start_time": "13:00:00", "duration_minutes": 120,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 201, r.text

    kinds = {i["kind"] for i in
             client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]}
    assert kinds == {"REMOVED", "ADDED"}


def test_note_only_change_is_a_change():
    """Not ogrenciye basilan bir icerik; farka girmezse duzenleme sessizce kaybolur."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"notes": "Yanınızda hesap makinesi getirin"}, headers=h
    ).status_code == 200

    items = client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "MOVED"
    assert items[0]["after"]["notes"] == "Yanınızda hesap makinesi getirin"


def test_classroom_change_is_a_change_but_order_is_not():
    """Derslik karsilastirmasi KUMEdir (M2M'de sira anlamsiz, K-17)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    ikinci = make_classroom(h)
    publish_exam(course["id"], lec["id"], [cls["id"], ikinci["id"]])
    draft = create_exam_draft(h, dep["id"])

    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=h).json()[0]
    # Ayni kume, ters sirada -> DEGISIKLIK DEGIL
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"classroom_ids": [ikinci["id"], cls["id"]]}, headers=h
    ).status_code == 200
    assert client.get(
        f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"] == []

    # Kume daralinca -> degisiklik
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"classroom_ids": [cls["id"]]}, headers=h
    ).status_code == 200
    items = client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "MOVED"


def test_diff_is_live_against_the_current_published_schedule():
    """Fark saklanmaz: yayin degisirse ayni taslagin farki da degisir (K-59)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    yayin_id = publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])
    assert client.get(
        f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"] == []

    db = SessionLocal()               # yayin arkadan degisti
    try:
        db.get(Exam, yayin_id).exam_date = date.fromisoformat(TUESDAY)
        db.commit()
    finally:
        db.close()

    items = client.get(f"/schedule-drafts/{draft['id']}/diff", headers=h).json()["items"]
    assert len(items) == 1 and items[0]["kind"] == "MOVED"


# ------------------------------------------------------------------
# Kapsam ve tur korumasi
# ------------------------------------------------------------------

def test_exam_outside_the_cohort_is_rejected():
    """Kapsam denetimi ders duzeyinde: baska sinifin dersi taslaga konamaz."""
    h = admin_headers()
    dep, lec, cls, _ = base_setup(h, year=1)
    baska_yil = make_course(h, dep["id"], year=3)
    draft = create_exam_draft(h, dep["id"], year=1)

    r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": baska_yil["id"], "exam_type": "MIDTERM", "exam_date": MONDAY,
        "start_time": "09:00:00", "duration_minutes": 90,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 400
    assert "kapsam" in r.json()["detail"]


def test_weekly_endpoints_reject_an_exam_draft():
    """Turler karismaz: karisik bir taslagin farki ve onayi tanimsiz olurdu."""
    h = admin_headers()
    dep, _, _, _ = base_setup(h)
    draft = create_exam_draft(h, dep["id"])
    r = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h)
    assert r.status_code == 409
    assert "sınav takvimi" in r.json()["detail"]


def test_exam_endpoints_reject_a_weekly_draft():
    h = admin_headers()
    dep, _, _, _ = base_setup(h)
    haftalik = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL"}, headers=h).json()
    r = client.get(f"/schedule-drafts/{haftalik['id']}/exams", headers=h)
    assert r.status_code == 409
    assert "haftalık program" in r.json()["detail"]


def test_duplicate_exam_inside_a_draft_is_rejected():
    """E2 on-kontrolu taslagin kendi icinde de kosar (K-46)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": course["id"], "exam_type": "MIDTERM", "exam_index": 1,
        "exam_date": TUESDAY, "start_time": "13:00:00", "duration_minutes": 90,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 409
    assert "vize" in r.json()["detail"]


def test_weekend_exam_is_rejected_in_a_draft():
    """Kural ayni, kapi degisti: K-06 hafta sonu yasagi taslak yolunda da var."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    draft = create_exam_draft(h, dep["id"])
    r = client.post(f"/schedule-drafts/{draft['id']}/exams", json={
        "course_id": course["id"], "exam_type": "MIDTERM", "exam_date": "2026-09-12",
        "start_time": "09:00:00", "duration_minutes": 90,
        "classroom_ids": [cls["id"]], "lecturer_id": lec["id"],
    }, headers=h)
    assert r.status_code == 400
    assert "hafta içi" in r.json()["detail"]


# ------------------------------------------------------------------
# Onaya gonderme: yetki turden gelir
# ------------------------------------------------------------------

def test_submitting_an_exam_draft_needs_exam_permission():
    """`can_manage_weekly` sinav takvimini onaya gondermeye YETMEZ (K-60)."""
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])

    # Yalniz haftalik yetkisi olan, o bolume uye bir hesap
    hs = sub_headers(department_ids=[dep["id"]], can_manage_weekly=True)
    draft = create_exam_draft(hs, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=hs).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
                 json={"exam_date": TUESDAY}, headers=hs)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=hs)
    assert r.status_code == 403
    assert "Sınav" in r.json()["detail"]


def test_exam_manager_can_submit_and_the_draft_freezes():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])

    hs = sub_headers(department_ids=[dep["id"]], can_manage_exams=True)
    draft = create_exam_draft(hs, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/exams", headers=hs).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
                 json={"exam_date": TUESDAY}, headers=hs)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "Vize takvimi"}, headers=hs)
    assert r.status_code == 200, r.text
    assert r.json()["draft"]["status"] == "PENDING"

    # Donmus taslak duzenlenemez
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"start_time": "16:00:00"}, headers=hs
    ).status_code == 409
    # Geri cekilince yeniden duzenlenebilir
    assert client.post(
        f"/schedule-drafts/{draft['id']}/withdraw", headers=hs).status_code == 200
    assert client.patch(
        f"/schedule-drafts/{draft['id']}/exams/{kopya['id']}",
        json={"start_time": "16:00:00"}, headers=hs
    ).status_code == 200


def test_unchanged_exam_draft_cannot_be_submitted():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])
    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={}, headers=h)
    assert r.status_code == 409
    assert "değişiklik yok" in r.json()["detail"]


# ------------------------------------------------------------------
# Temizleme ve gizlilik
# ------------------------------------------------------------------

def test_clearing_an_exam_draft_leaves_the_published_schedule_alone():
    h = admin_headers()
    dep, lec, cls, course = base_setup(h)
    publish_exam(course["id"], lec["id"], [cls["id"]])
    draft = create_exam_draft(h, dep["id"])

    r = client.post(f"/schedule-drafts/{draft['id']}/clear",
                    json={"include_shared": False}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 1
    assert client.get(
        f"/schedule-drafts/{draft['id']}/exams", headers=h).json() == []
    assert published_exam_count(course["id"]) == 1      # yayin duruyor


def test_exam_draft_is_private_even_from_admin():
    """Gizlilik kind'a bakmaz — sinav taslagi da yalniz sahibinindir."""
    ha = admin_headers()
    dep, _, _, _ = base_setup(ha)
    hs = sub_headers(department_ids=[dep["id"]], can_manage_exams=True)
    onun = create_exam_draft(hs, dep["id"])

    assert client.get(f"/schedule-drafts/{onun['id']}/exams",
                      headers=ha).status_code == 404
    assert client.get(f"/schedule-drafts/{onun['id']}/diff",
                      headers=ha).status_code == 404
