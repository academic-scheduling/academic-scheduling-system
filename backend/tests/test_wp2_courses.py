"""WP2 CRUD testleri — dersler + şubeler (K-14 iç içe yapı, üyelik yetkisi)."""

from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u


def make_department(h):
    r = client.post("/departments", json={"name": "Test Bölümü", "code": _u("TB")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_lecturer(h):
    r = client.post("/lecturers", json={"full_name": f"Dr. Ders Hocası {_u('')}"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_course(h, dep, **overrides):
    body = {
        "department_id": dep["id"], "year": 2, "semester": "SPRING",
        "code": _u("CE"), "name": "Test Dersi",
        "hours_theory": 3, "hours_practice": 2, "hours_lab": 0,
    }
    body.update(overrides)
    r = client.post("/courses", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def make_section(h, course, lec, section_no=1, **overrides):
    body = {"section_no": section_no, "lecturer_id": lec["id"], "expected_students": 40}
    body.update(overrides)
    r = client.post(f"/courses/{course['id']}/sections", json=body, headers=h)
    return r


# --- ders: temel akış ---

def test_create_course_with_tul():
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert course["hours_theory"] == 3 and course["hours_practice"] == 2
    assert course["sections"] == []          # henüz şube yok

def test_duplicate_course_identity():
    h = admin_headers()
    dep = make_department(h)
    course = make_course(h, dep)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 2, "semester": "SPRING",
        "code": course["code"], "name": "Kopya",
    }, headers=h)
    assert r.status_code == 409

def test_patch_course_hours():
    h = admin_headers()
    course = make_course(h, make_department(h))
    r = client.patch(f"/courses/{course['id']}", json={"hours_lab": 2}, headers=h)
    assert r.status_code == 200
    assert r.json()["hours_lab"] == 2
    assert r.json()["hours_theory"] == 3     # dokunulmamış alan korunur


# --- şubeler ---

def test_add_sections_and_nested_list():
    h = admin_headers()
    dep = make_department(h)
    course = make_course(h, dep)
    lec = make_lecturer(h)
    assert make_section(h, course, lec, 1).status_code == 201
    assert make_section(h, course, lec, 2).status_code == 201   # aynı hoca 2 şube (K-14)

    r = client.get(f"/courses?department_id={dep['id']}", headers=h)
    found = [c for c in r.json() if c["id"] == course["id"]][0]
    assert len(found["sections"]) == 2
    assert found["sections"][0]["lecturer"]["full_name"] == lec["full_name"]

def test_duplicate_section_no():
    h = admin_headers()
    course = make_course(h, make_department(h))
    lec = make_lecturer(h)
    assert make_section(h, course, lec, 1).status_code == 201
    assert make_section(h, course, lec, 1).status_code == 409

def test_section_foreign_lecturer_rejected():
    """Çapraz-FK: yabancı workgroup'un hocası şubeye atanamaz."""
    h_foreign = foreign_admin_headers()
    foreign_lec = make_lecturer(h_foreign)

    h = admin_headers()
    course = make_course(h, make_department(h))
    r = make_section(h, course, foreign_lec)
    assert r.status_code == 400

def test_delete_section_without_entries():
    h = admin_headers()
    course = make_course(h, make_department(h))
    lec = make_lecturer(h)
    sec_id = make_section(h, course, lec).json()["id"]
    assert client.delete(f"/course-sections/{sec_id}", headers=h).status_code == 204
    # not: "girişi olan şube silinemez (409)" dalı WP3'te, giriş endpoint'i gelince test edilir


# --- üyelik yetkisi (kontrat §6) ---

def test_sub_account_membership_rules():
    h = admin_headers()
    dep_a = make_department(h)     # üye olacağı bölüm
    dep_b = make_department(h)     # üye OLMAYACAĞI bölüm

    # Yetenek AÇIK: bu test üyelik boyutunu ölçer, bayrağı değil (K-25)
    h_sub = sub_headers(department_ids=[dep_a["id"]], can_manage_courses=True)

    # Atanmış bölümde ders açabilir
    r = client.post("/courses", json={
        "department_id": dep_a["id"], "year": 1, "semester": "FALL",
        "code": _u("SA"), "name": "İzinli",
    }, headers=h_sub)
    assert r.status_code == 201

    # Atanmamış (ama bizim workgroup'taki) bölümde -> 403
    r = client.post("/courses", json={
        "department_id": dep_b["id"], "year": 1, "semester": "FALL",
        "code": _u("SB"), "name": "İzinsiz",
    }, headers=h_sub)
    assert r.status_code == 403

def test_sub_account_lists_all_departments():
    """K-26: alt hesap workgroup'taki TÜM bölümlerin derslerini okur.

    Eski davranış (yalnız atanmış bölümler) çakışma çözümünü imkânsız kılıyordu:
    motor "CENG2001 ile çakışıyorsun" der ama kullanıcı o dersi göremezdi.
    """
    h = admin_headers()
    dep_a = make_department(h)
    dep_b = make_department(h)
    course_a = make_course(h, dep_a)
    course_b = make_course(h, dep_b)

    h_sub = sub_headers(department_ids=[dep_a["id"]])   # yalnız dep_a üyesi
    listed_ids = [c["id"] for c in client.get("/courses", headers=h_sub).json()]
    assert course_a["id"] in listed_ids
    assert course_b["id"] in listed_ids    # atanmamış bölümün dersi de GÖRÜNÜR

    # department_id filtresiyle daraltabilir (kontrat §6)
    only_b = client.get(f"/courses?department_id={dep_b['id']}", headers=h_sub).json()
    assert [c["id"] for c in only_b] == [course_b["id"]]


# --- yetenek bayrağı (K-25) ---

def test_course_capability_required():
    """Bayrak kapalıysa, bölüme ÜYE olsa bile yazamaz — iki boyutun ilki."""
    h = admin_headers()
    dep = make_department(h)

    # Üye AMA can_manage_courses kapalı
    h_sub = sub_headers(department_ids=[dep["id"]], can_manage_courses=False)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("NC"), "name": "Yetkisiz",
    }, headers=h_sub)
    assert r.status_code == 403
    assert r.json()["detail"] == "Ders yönetim yetkisi gerekli"

    # Okuma ise serbest (K-26) — yetkisizlik görmeyi engellemez
    assert client.get("/courses", headers=h_sub).status_code == 200


def test_capabilities_are_independent():
    """Bir yetenek diğerini açmaz: sınav yetkisi ders yazma hakkı vermez."""
    h = admin_headers()
    dep = make_department(h)
    h_sub = sub_headers(department_ids=[dep["id"]], can_manage_exams=True)

    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("XC"), "name": "Yanlış Yetki",
    }, headers=h_sub)
    assert r.status_code == 403


def test_admin_bypasses_all_capability_flags():
    """ADMIN'in DB'deki bayrakları false'tur ama rol muafiyeti geçirir."""
    h = admin_headers()
    dep = make_department(h)
    r = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("AD"), "name": "Admin Dersi",
    }, headers=h)
    assert r.status_code == 201

    # API admin'e tüm bayrakları true raporlar (kontrat §1)
    me = client.get("/auth/me", headers=h).json()
    assert me["can_manage_courses"] is True
    assert me["can_manage_exams"] is True


# --- izolasyon ---

def test_isolation_foreign_admin():
    h = admin_headers()
    course = make_course(h, make_department(h))

    h_foreign = foreign_admin_headers()
    r = client.patch(f"/courses/{course['id']}", json={"name": "Ele Geçti"}, headers=h_foreign)
    assert r.status_code == 404