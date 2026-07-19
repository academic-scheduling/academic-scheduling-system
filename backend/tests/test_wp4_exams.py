"""WP4 sınav API testleri — kontrat §8, K-16/K-17/K-22.

Çakışma motoru henüz stub (conflict_service, K-22): kayıt/submit akışının
motor kablolaması monkeypatch ile sahte sonuç döndürerek test edilir —
C'nin gerçek motoru takıldığında bu testler değişmeden geçerli kalır.
"""

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


def make_exam(h, course, **overrides):
    body = {
        "course_id": course["id"], "exam_type": "MIDTERM",
        "exam_date": WEEKDAY, "start_time": "10:00", "duration_minutes": 90,
        "classroom_ids": [], "lecturer_id": course["lecturer"]["id"],
    }
    body.update(overrides)
    return client.post("/exams", json=body, headers=h)


# --- kayıt (save) ---

def test_create_exam_draft_with_conflicts_field():
    h = admin_headers()
    course = make_course_with_sections(h)
    r = make_exam(h, course)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["exam"]["status"] == "DRAFT"
    assert body["conflicts"] == []           # stub: her zaman temiz (K-22)
    # K-16: türetilen öğrenci sayısı = aktif şubelerin toplamı
    assert body["exam"]["total_expected_students"] == 70


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
    assert make_exam(h, course).status_code == 409          # E2: aynı tip ikinci kez
    assert make_exam(h, course, exam_type="FINAL").status_code == 201


def test_exam_with_classrooms():
    h = admin_headers()
    course = make_course_with_sections(h)
    c1, c2 = make_classroom(h), make_classroom(h)
    r = make_exam(h, course, classroom_ids=[c1["id"], c2["id"]])
    assert r.status_code == 201, r.text
    rooms = r.json()["exam"]["classrooms"]
    assert {x["id"] for x in rooms} == {c1["id"], c2["id"]}
    assert rooms[0]["exam_capacity"] == 40                   # kontrat: exam_capacity döner


# --- izolasyon ve yetki ---

def test_foreign_course_rejected():
    h_foreign = foreign_admin_headers()
    foreign_course = make_course_with_sections(h_foreign)
    h = admin_headers()
    assert make_exam(h, foreign_course).status_code == 400   # gövde FK'sı yabancı → 400


def test_foreign_classroom_rejected():
    h_foreign = foreign_admin_headers()
    foreign_room = make_classroom(h_foreign)
    h = admin_headers()
    course = make_course_with_sections(h)
    r = make_exam(h, course, classroom_ids=[foreign_room["id"]])
    assert r.status_code == 400


def test_foreign_exam_hidden():
    """Yabancı workgroup'un sınavı bizim için YOKTUR (404, varlık sızdırmama)."""
    h_foreign = foreign_admin_headers()
    exam_id = make_exam(h_foreign, make_course_with_sections(h_foreign)).json()["exam"]["id"]
    h = admin_headers()
    assert client.patch(f"/exams/{exam_id}", json={"notes": "x"}, headers=h).status_code == 404
    assert client.delete(f"/exams/{exam_id}", headers=h).status_code == 404
    r = client.get("/exams", headers=h)
    assert exam_id not in [e["id"] for e in r.json()]


def test_sub_account_membership_rules():
    h = admin_headers()
    dep_a, dep_b = make_department(h), make_department(h)
    course_a = make_course_with_sections(h, dep=dep_a)
    course_b = make_course_with_sections(h, dep=dep_b)

    make_exam(h, course_b)          # admin dep_b'ye bir sınav koyar (görünürlük kanıtı için)

    # Yetenek AÇIK: bu test üyelik boyutunu ölçer, bayrağı değil (K-25)
    h_sub = sub_headers(department_ids=[dep_a["id"]], can_manage_exams=True)
    assert make_exam(h_sub, course_a).status_code == 201     # atanmış bölüm: izinli
    assert make_exam(h_sub, course_b).status_code == 403     # atanmamış bölüm: yasak
    # K-26: atanmamış bölümün sınavı da LİSTEDE GÖRÜNÜR (yazma yasak, okuma serbest)
    ids = [e["course"]["id"] for e in client.get("/exams", headers=h_sub).json()]
    assert course_a["id"] in ids and course_b["id"] in ids


# --- yaşam döngüsü (K-03) ---

def test_lifecycle_submit_revert_delete():
    h = admin_headers()
    course = make_course_with_sections(h)
    exam = make_exam(h, course).json()["exam"]

    # submit → SUBMITTED
    r = client.post("/exams/submit", json={"exam_ids": [exam["id"]]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"submitted": [exam["id"]], "warnings": []}

    # SUBMITTED: düzenlenemez, silinemez, tekrar submit edilemez
    assert client.patch(f"/exams/{exam['id']}", json={"notes": "x"}, headers=h).status_code == 409
    assert client.delete(f"/exams/{exam['id']}", headers=h).status_code == 409
    assert client.post("/exams/submit", json={"exam_ids": [exam["id"]]}, headers=h).status_code == 409

    # revert → DRAFT → artık silinebilir
    r = client.post(f"/exams/{exam['id']}/revert-to-draft", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "DRAFT"
    assert client.post(f"/exams/{exam['id']}/revert-to-draft", headers=h).status_code == 409
    assert client.delete(f"/exams/{exam['id']}", headers=h).status_code == 204


def test_patch_replaces_classroom_list():
    h = admin_headers()
    course = make_course_with_sections(h)
    c1, c2 = make_classroom(h), make_classroom(h)
    exam = make_exam(h, course, classroom_ids=[c1["id"]]).json()["exam"]
    r = client.patch(f"/exams/{exam['id']}",
                     json={"classroom_ids": [c2["id"]]}, headers=h)
    assert r.status_code == 200
    assert [x["id"] for x in r.json()["exam"]["classrooms"]] == [c2["id"]]  # TAM değişim (K-22)


# --- motor kablolaması (stub monkeypatch ile — K-22) ---

def _fake_conflict(severity):
    return {"severity": severity, "rule_id": "E1",
            "message": "test çakışması", "affected": []}


def test_submit_hard_conflict_blocks_all(monkeypatch):
    """Hep-veya-hiç: motor HARD dönerse hiçbir sınav submit edilmez (K-03)."""
    monkeypatch.setattr("app.routers.exams.check_exams_submit",
                        lambda db, exams: [_fake_conflict("HARD")])
    h = admin_headers()
    e1 = make_exam(h, make_course_with_sections(h)).json()["exam"]
    e2 = make_exam(h, make_course_with_sections(h)).json()["exam"]

    r = client.post("/exams/submit", json={"exam_ids": [e1["id"], e2["id"]]}, headers=h)
    assert r.status_code == 409
    assert r.json()["detail"] == "Hard çakışma nedeniyle submit reddedildi"
    assert r.json()["conflicts"][0]["rule_id"] == "E1"
    # ikisi de DRAFT kaldı → silinebilir olmaları bunun kanıtı
    assert client.delete(f"/exams/{e1['id']}", headers=h).status_code == 204
    assert client.delete(f"/exams/{e2['id']}", headers=h).status_code == 204


def test_submit_warning_does_not_block(monkeypatch):
    """WARNING submit'i durdurmaz; uyarılar cevapta görünür kalır (K-03)."""
    monkeypatch.setattr("app.routers.exams.check_exams_submit",
                        lambda db, exams: [_fake_conflict("WARNING")])
    h = admin_headers()
    exam = make_exam(h, make_course_with_sections(h)).json()["exam"]
    r = client.post("/exams/submit", json={"exam_ids": [exam["id"]]}, headers=h)
    assert r.status_code == 200
    assert r.json()["submitted"] == [exam["id"]]
    assert r.json()["warnings"][0]["severity"] == "WARNING"


def test_save_returns_engine_conflicts(monkeypatch):
    """Save anında conflicts dolu gelse bile kayıt BAŞARILIDIR (K-03)."""
    monkeypatch.setattr("app.routers.exams.check_exams_save",
                        lambda db, exam: [_fake_conflict("HARD")])
    h = admin_headers()
    r = make_exam(h, make_course_with_sections(h))
    assert r.status_code == 201                              # HARD bile engellemez
    assert r.json()["conflicts"][0]["severity"] == "HARD"


# --- filtreler (kontrat §8) ---

def test_filters():
    h = admin_headers()
    dep = make_department(h)
    course = make_course_with_sections(h, dep=dep)
    room = make_classroom(h)
    mid = make_exam(h, course, exam_date=WEEKDAY,
                    classroom_ids=[room["id"]]).json()["exam"]
    fin = make_exam(h, course, exam_type="FINAL", exam_date="2026-12-21").json()["exam"]

    def ids(qs):
        return [e["id"] for e in client.get(f"/exams?{qs}", headers=h).json()]

    assert mid["id"] in ids(f"department_id={dep['id']}&exam_type=MIDTERM")
    assert fin["id"] not in ids(f"department_id={dep['id']}&exam_type=MIDTERM")
    assert ids(f"department_id={dep['id']}&date_from=2026-12-01") == [fin["id"]]
    assert ids(f"department_id={dep['id']}&date_to=2026-11-30") == [mid["id"]]
    assert ids(f"classroom_id={room['id']}") == [mid["id"]]
    assert ids(f"department_id={dep['id']}&year=2&semester=FALL") == [mid["id"], fin["id"]]
