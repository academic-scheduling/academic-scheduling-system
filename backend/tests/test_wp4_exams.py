"""WP4 sınav testleri — kontrat §8, K-16/K-17/K-22/K-46.

**K-60 dönüşümü:** bu dosyanın konusu DOĞRULAMA KURALLARIydı ve öyle kaldı;
değişen tek şey KAPI. Sınav yazmanın tek yolu artık taslak ucu
(`/schedule-drafts/{id}/exams`), yayına geçmenin tek yolu onay. Eski
`POST/PATCH/DELETE /exams` ve `/exams/submit` uçları kalktığı için buradaki
her kural aynı gövdeyle taslak ucuna taşındı — K-59'da `test_wp3_weekly.py`
için yapılanın aynısı.

Yaşam döngüsü testleri (submit/revert/donma/onay) BURADA DEĞİL: onlar
`test_k60_exam_draft_api.py` ve `test_k60_exam_approval_api.py`'ye devredildi.
Burada kalan `GET /exams` testleri YAYINI okur.
"""

from datetime import date

from app.db import SessionLocal
from app.models import Classroom, Exam, ExamType
from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u

WEEKDAY = "2026-11-12"       # Perşembe
FRIDAY = "2026-11-13"
SATURDAY = "2026-11-14"


# --- kurulum yardımcıları (test_wp2_courses.py deseni) ---

def make_department(h):
    r = client.post("/departments", json={"name": "Sınav Bölümü", "code": _u("SB")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_lecturer(h):
    r = client.post("/lecturers", json={"full_name": f"Dr. Sınav Hocası {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_classroom(h, exam_capacity=40):
    r = client.post("/buildings", json={"name": f"Sınav Binası {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    r = client.post("/classrooms", json={
        "building_id": r.json()["id"], "room_code": _u("D"),
        "capacity": 90, "exam_capacity": exam_capacity,
    }, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_course_with_sections(h, dep=None, expected=(40, 30)):
    """Ders + her `expected` değeri için bir aktif şube kurar."""
    dep = dep or make_department(h)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 2, "semester": "FALL",
        "code": _u("SE"), "name": "Sınavlı Ders",
    }, headers=h)
    assert r.status_code == 201, r.text
    course = r.json()
    lec = make_lecturer(h)
    for i, n in enumerate(expected, start=1):
        r = client.post(f"/courses/{course['id']}/sections", json={
            "section_no": i, "lecturer_id": lec["id"], "expected_students": n,
        }, headers=h)
        assert r.status_code == 201, r.text
    course["lecturer"] = lec
    return course


def open_draft(h, course):
    """Dersin cohort'u (bölüm + 2. sınıf + Güz) üzerinde sınav taslağı açar.

    Taslak AÇMAK yetki istemez (K-59/K-60); kuralların kapısı burası.
    Aynı ders için ikinci kez çağrılırsa mevcut taslağı bulup döner —
    cohort başına tek aktif taslak var.
    """
    body = {"department_id": course["department_id"], "year": 2,
            "semester": "FALL", "kind": "EXAM"}
    r = client.post("/schedule-drafts", json=body, headers=h)
    if r.status_code == 201:
        return r.json()
    assert r.status_code == 409, r.text
    mevcut = [d for d in client.get("/schedule-drafts", headers=h).json()
              if d["kind"] == "EXAM"
              and d["department_id"] == course["department_id"] and d["year"] == 2]
    assert mevcut, r.text
    return mevcut[0]


def make_exam(h, course, draft=None, **overrides):
    """Sınavı TASLAĞA ekler. Kural aynı, kapı değişti (K-60)."""
    draft = draft or open_draft(h, course)
    body = {
        "course_id": course["id"], "exam_type": "MIDTERM",
        "exam_date": WEEKDAY, "start_time": "10:00", "duration_minutes": 90,
        "classroom_ids": [], "lecturer_id": course["lecturer"]["id"],
    }
    body.update(overrides)
    return client.post(f"/schedule-drafts/{draft['id']}/exams", json=body, headers=h)


def publish_exam(course, exam_index=1, exam_type=ExamType.MIDTERM,
                 exam_date=WEEKDAY, classroom_ids=()):
    """YAYINDAKİ bir sınav üretir (draft_id NULL).

    `GET /exams` ve ders düzenleme engellerini ölçen testler yayın ister;
    onay akışından geçirmek bu testlerin konusu değil (K-59'daki
    `publish_entry` ile aynı gerekçe).
    """
    db = SessionLocal()
    try:
        x = Exam(
            course_id=course["id"], exam_type=exam_type, exam_index=exam_index,
            exam_date=date.fromisoformat(exam_date), start_time="10:00:00",
            duration_minutes=90, lecturer_id=course["lecturer"]["id"],
        )
        if classroom_ids:
            x.classrooms = db.query(Classroom).filter(
                Classroom.id.in_(classroom_ids)).all()
        db.add(x)
        db.commit()
        return x.id
    finally:
        db.close()


# --- kayıt (save) ---

def test_create_exam_returns_conflicts_field():
    h = admin_headers()
    course = make_course_with_sections(h)
    r = make_exam(h, course)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["conflicts"] == []
    # K-16: türetilen öğrenci sayısı = aktif şubelerin toplamı
    assert body["exam"]["total_expected_students"] == 70
    # K-60: satır bazlı `status` kontrattan kalktı
    assert "status" not in body["exam"]


def test_total_expected_excludes_inactive_sections():
    h = admin_headers()
    course = make_course_with_sections(h, expected=(40, 30))
    # ikinci şubeyi pasife al → toplamdan düşmeli
    r = client.get(f"/courses?department_id={course['department_id']}", headers=h)
    sections = [c for c in r.json() if c["id"] == course["id"]][0]["sections"]
    sec2 = [s for s in sections if s["section_no"] == 2][0]
    assert client.patch(f"/course-sections/{sec2['id']}",
                        json={"active": False}, headers=h).status_code == 200
    r = make_exam(h, course)
    assert r.status_code == 201, r.text
    assert r.json()["exam"]["total_expected_students"] == 40


def test_weekend_date_rejected():
    h = admin_headers()
    course = make_course_with_sections(h)
    assert make_exam(h, course, exam_date=SATURDAY).status_code == 400
    assert make_exam(h, course, exam_date=FRIDAY).status_code == 201


def test_evening_start_time_allowed():
    """K-06: sınavda saat penceresi yok — 18:00 geçerli."""
    h = admin_headers()
    course = make_course_with_sections(h)
    assert make_exam(h, course, start_time="18:00").status_code == 201


def test_duplicate_exam_type():
    h = admin_headers()
    course = make_course_with_sections(h)
    assert make_exam(h, course).status_code == 201
    assert make_exam(h, course).status_code == 409          # E2: aynı SIRA ikinci kez
    assert make_exam(h, course, exam_type="FINAL").status_code == 201


def test_course_outside_the_cohort_is_rejected():
    """K-60: taslağın kapsamı cohort'tur; başka sınıfın dersine sınav konamaz.

    Eski akışta bu sınırı bölüm ÜYELİĞİ çiziyordu; artık kapsam denetimi
    çiziyor (`_ensure_course_in_cohort`) — aynı filtre taslağın neyi
    kopyaladığını da belirliyor.
    """
    h = admin_headers()
    dep = make_department(h)
    ikinci_sinif = make_course_with_sections(h, dep=dep)          # year=2
    draft = open_draft(h, ikinci_sinif)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 4, "semester": "FALL",
        "code": _u("SE"), "name": "Başka Sınıf",
    }, headers=h)
    assert r.status_code == 201
    baska = r.json()
    baska["lecturer"] = ikinci_sinif["lecturer"]
    assert make_exam(h, baska, draft=draft).status_code == 400


# --- K-46: çoklu vize ---

def test_multiple_midterms_up_to_count():
    """midterm_count=3 iken 1./2./3. vize ayrı kayıt; aynı sıra tekrar → E2."""
    h = admin_headers()
    course = make_course_with_sections(h)
    r = client.patch(f"/courses/{course['id']}", json={"midterm_count": 3}, headers=h)
    assert r.status_code == 200 and r.json()["midterm_count"] == 3
    draft = open_draft(h, course)
    for idx in (1, 2, 3):
        r = make_exam(h, course, draft=draft, exam_index=idx)
        assert r.status_code == 201, r.text
        assert r.json()["exam"]["exam_index"] == idx
    assert make_exam(h, course, draft=draft, exam_index=2).status_code == 409
    assert make_exam(h, course, draft=draft, exam_index=4).status_code == 422  # şema le=3


def test_midterm_index_beyond_count_rejected():
    """Varsayılan midterm_count=1 iken 2. vize denemesi sınır dışı → 400."""
    h = admin_headers()
    course = make_course_with_sections(h)
    draft = open_draft(h, course)
    assert make_exam(h, course, draft=draft, exam_index=1).status_code == 201
    assert make_exam(h, course, draft=draft, exam_index=2).status_code == 400


def test_non_midterm_index_forced_to_one():
    """Final'e sıra gönderilse bile 1'e sabitlenir; tür başına tek kalır."""
    h = admin_headers()
    course = make_course_with_sections(h)
    draft = open_draft(h, course)
    r = make_exam(h, course, draft=draft, exam_type="FINAL", exam_index=2)
    assert r.status_code == 201, r.text
    assert r.json()["exam"]["exam_index"] == 1
    assert make_exam(h, course, draft=draft, exam_type="FINAL").status_code == 409


def test_reduce_midterm_count_blocked_by_published_exam_only():
    """Sayıyı düşürmeyi YAYINDAKİ vize engeller; taslaktaki kopya ENGELLEMEZ.

    K-59'un kuralı: birinin özel taslağı kimsenin ders düzenlemesini
    bloklamamalı. Bayat kalan taslak sahibinin sorunudur (K-60).
    """
    h = admin_headers()
    course = make_course_with_sections(h)
    client.patch(f"/courses/{course['id']}", json={"midterm_count": 3}, headers=h)

    # Taslaktaki 3. vize engellemez
    assert make_exam(h, course, exam_index=3).status_code == 201
    assert client.patch(f"/courses/{course['id']}",
                        json={"midterm_count": 2}, headers=h).status_code == 200

    # Yayındaki 3. vize engeller
    client.patch(f"/courses/{course['id']}", json={"midterm_count": 3}, headers=h)
    yayin_id = publish_exam(course, exam_index=3)
    assert client.patch(f"/courses/{course['id']}",
                        json={"midterm_count": 2}, headers=h).status_code == 409

    db = SessionLocal()
    try:
        db.delete(db.get(Exam, yayin_id))
        db.commit()
    finally:
        db.close()
    assert client.patch(f"/courses/{course['id']}",
                        json={"midterm_count": 2}, headers=h).status_code == 200


def test_exam_with_classrooms():
    h = admin_headers()
    course = make_course_with_sections(h)
    c1, c2 = make_classroom(h), make_classroom(h)
    r = make_exam(h, course, classroom_ids=[c1["id"], c2["id"]])
    assert r.status_code == 201, r.text
    rooms = r.json()["exam"]["classrooms"]
    assert {x["id"] for x in rooms} == {c1["id"], c2["id"]}
    assert rooms[0]["exam_capacity"] == 40                   # kontrat: exam_capacity döner


def test_patch_replaces_classroom_list():
    h = admin_headers()
    course = make_course_with_sections(h)
    c1, c2 = make_classroom(h), make_classroom(h)
    draft = open_draft(h, course)
    exam = make_exam(h, course, draft=draft, classroom_ids=[c1["id"]]).json()["exam"]
    r = client.patch(f"/schedule-drafts/{draft['id']}/exams/{exam['id']}",
                     json={"classroom_ids": [c2["id"]]}, headers=h)
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["exam"]["classrooms"]] == [c2["id"]]  # TAM değişim (K-22)


# --- izolasyon ve yetki ---

def test_foreign_course_rejected():
    """Yabancı workgroup'un dersi: taslağa hiç giremez."""
    h_foreign = foreign_admin_headers()
    foreign_course = make_course_with_sections(h_foreign)
    h = admin_headers()
    course = make_course_with_sections(h)
    draft = open_draft(h, course)
    foreign_course["lecturer"] = course["lecturer"]
    assert make_exam(h, foreign_course, draft=draft).status_code == 400


def test_foreign_classroom_rejected():
    h_foreign = foreign_admin_headers()
    foreign_room = make_classroom(h_foreign)
    h = admin_headers()
    course = make_course_with_sections(h)
    assert make_exam(h, course, classroom_ids=[foreign_room["id"]]).status_code == 400


def test_foreign_exam_hidden():
    """Yabancı workgroup'un YAYINDAKİ sınavı bizim listemizde yoktur."""
    h_foreign = foreign_admin_headers()
    foreign_course = make_course_with_sections(h_foreign)
    exam_id = publish_exam(foreign_course)
    h = admin_headers()
    assert exam_id not in [e["id"] for e in client.get("/exams", headers=h).json()]


def test_draft_exams_do_not_leak_into_the_published_list():
    """K-60 güvenli varsayılanı: taslak sınav `GET /exams`'te GÖRÜNMEZ.

    K-59'un pahalı dersinin sınav karşılığı — orada bu süzgeç unutulmuş ve
    herkesin özel satırları ızgarada çizilmişti.
    """
    h = admin_headers()
    course = make_course_with_sections(h)
    exam_id = make_exam(h, course).json()["exam"]["id"]
    assert exam_id not in [e["id"] for e in client.get("/exams", headers=h).json()]


def test_writing_to_a_draft_needs_no_permission_but_submitting_does():
    """K-60'ın yetki devri: yazma yetkisi yer değiştirdi.

    Taslak açmak ve içine yazmak yetki İSTEMEZ (özel taslak kimseyi etkilemez);
    `can_manage_exams` + bölüm üyeliği ONAYA GÖNDERME kapısında aranır.
    Okuma K-26 gereği serbest kalır.
    """
    h = admin_headers()
    dep_a, dep_b = make_department(h), make_department(h)
    course_a = make_course_with_sections(h, dep=dep_a)
    course_b = make_course_with_sections(h, dep=dep_b)
    publish_exam(course_b)          # admin dep_b'ye yayında bir sınav koyar

    # HİÇBİR sınav yetkisi olmayan, yalnız dep_a üyesi hesap
    h_sub = sub_headers(department_ids=[dep_a["id"]])
    assert make_exam(h_sub, course_a).status_code == 201     # taslağa yazmak serbest

    draft_a = open_draft(h_sub, course_a)
    r = client.post(f"/schedule-drafts/{draft_a['id']}/submit", json={}, headers=h_sub)
    assert r.status_code == 403                              # bayrak yok → gönderemez
    assert "Sınav" in r.json()["detail"]

    # K-26: atanmamış bölümün YAYINDAKİ sınavı da listede görünür
    ids = [e["course"]["id"] for e in client.get("/exams", headers=h_sub).json()]
    assert course_b["id"] in ids


def test_submitting_needs_department_membership_too():
    """K-25'in ikinci boyutu: bayrak tek başına yetmez."""
    h = admin_headers()
    dep_a, dep_b = make_department(h), make_department(h)
    course_b = make_course_with_sections(h, dep=dep_b)

    # Bayrak AÇIK ama üyelik dep_a'da — dep_b'nin talebini gönderemez
    h_sub = sub_headers(department_ids=[dep_a["id"]], can_manage_exams=True)
    assert make_exam(h_sub, course_b).status_code == 201
    draft_b = open_draft(h_sub, course_b)
    r = client.post(f"/schedule-drafts/{draft_b['id']}/submit", json={}, headers=h_sub)
    assert r.status_code == 403
    assert "bölümde yetkiniz yok" in r.json()["detail"]


# --- motor kablolaması (stub monkeypatch ile — K-22) ---

def test_save_returns_engine_conflicts(monkeypatch):
    """Save anında conflicts dolu gelse bile kayıt BAŞARILIDIR (K-03)."""
    monkeypatch.setattr(
        "app.routers.schedule_drafts.check_exams_save",
        lambda db, exam, draft=None: [{
            "severity": "HARD", "rule_id": "E1",
            "message": "test çakışması", "affected": [],
        }],
    )
    h = admin_headers()
    r = make_exam(h, make_course_with_sections(h))
    assert r.status_code == 201, r.text
    assert r.json()["conflicts"][0]["rule_id"] == "E1"


# --- filtreler (kontrat §8) ---

def test_filters():
    """`GET /exams` YAYINI okur; süzgeçler kontrat §8'deki gibi çalışır."""
    h = admin_headers()
    dep = make_department(h)
    course = make_course_with_sections(h, dep=dep)
    room = make_classroom(h)
    publish_exam(course, classroom_ids=[room["id"]])

    def ids(qs):
        return [e["course"]["id"] for e in client.get(f"/exams?{qs}", headers=h).json()]

    assert course["id"] in ids(f"department_id={dep['id']}")
    assert course["id"] in ids("exam_type=MIDTERM")
    assert course["id"] not in ids("exam_type=FINAL")
    assert course["id"] in ids(f"date_from={WEEKDAY}&date_to={WEEKDAY}")
    assert course["id"] not in ids("date_from=2027-01-01")
    assert course["id"] in ids(f"classroom_id={room['id']}")
    assert course["id"] in ids(f"lecturer_id={course['lecturer']['id']}")
