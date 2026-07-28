"""WP6 export API testleri — kontrat §11 + derslik programi.

Uc endpoint (weekly / exams / classrooms) x iki format (csv / xlsx). Dogrulanan:
- 200 + Content-Disposition attachment + dogru dosya adi/MIME
- CSV icerigi UTF-8 BOM'lu, baslik + bilinen kayit iceriyor
- XLSX gecerli (PK imzasi) ve openpyxl ile geri okunabiliyor
- Workgroup izolasyonu: yabanci admin bizim veriyi export'ta gormez (K-26)
- Sinav tip filtresi, desteklenmeyen format (400), auth (401)
"""

import io

from openpyxl import load_workbook

from tests.helpers import client, admin_headers, foreign_admin_headers, _u

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --- kurulum yardimcilari (wp3/wp4 desenleri) ---

def _post(h, path, body):
    r = client.post(path, json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _setup(h):
    """Bir bolum + ders + sube + DERSLIKLI haftalik giris + sinav kurar."""
    dep = _post(h, "/departments", {"name": "Export Bölüm", "code": _u("EB")})
    lec = _post(h, "/lecturers", {"full_name": f"Dr. Export {_u('')}"})
    building = _post(h, "/buildings", {"name": f"Export Bina {_u('')}"})
    room = _post(h, "/classrooms", {
        "building_id": building["id"], "room_code": _u("D"),
        "capacity": 90, "exam_capacity": 40,
    })
    course = _post(h, "/courses", {
        "department_id": dep["id"], "year": 2, "semester": "FALL",
        "code": _u("EX"), "name": "Export Ders",
        "hours_theory": 3, "hours_practice": 0, "hours_lab": 0,
    })
    section = _post(h, f"/courses/{course['id']}/sections", {
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": 30,
    })
    _post(h, "/weekly-entries", {
        "section_id": section["id"], "classroom_id": room["id"],
        "day_of_week": 1, "start_slot": 1, "slot_count": 2,
        "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE",
    })
    _post(h, "/exams", {
        "course_id": course["id"], "exam_type": "MIDTERM",
        "exam_date": "2026-11-12", "start_time": "10:00", "duration_minutes": 90,
        "classroom_ids": [room["id"]], "lecturer_id": lec["id"],
    })
    return {"dep": dep, "course": course, "room": room, "building": building}


def _all_cell_text(content: bytes) -> str:
    """XLSX'teki tum hucre metnini tek stringde toplar (icerik aramasi icin)."""
    ws = load_workbook(io.BytesIO(content)).active
    out = []
    for row in ws.iter_rows(values_only=True):
        out += [str(v) for v in row if v is not None]
    return "\n".join(out)


# --- haftalik program ---

def test_weekly_csv():
    h = admin_headers()
    s = _setup(h)
    r = client.get("/export/weekly", params={"format": "csv"}, headers=h)
    assert r.status_code == 200, r.text
    cd = r.headers["content-disposition"]
    assert "attachment" in cd and "haftalik_program.csv" in cd
    assert r.headers["content-type"].startswith("text/csv")
    text = r.content.decode("utf-8-sig")
    assert text.startswith("Bölüm,")          # baslik satiri + BOM soyuldu
    assert s["course"]["code"] in text


def test_weekly_xlsx():
    h = admin_headers()
    s = _setup(h)
    r = client.get("/export/weekly", params={"format": "xlsx"}, headers=h)
    assert r.status_code == 200, r.text
    assert "haftalik_program.xlsx" in r.headers["content-disposition"]
    assert r.headers["content-type"].startswith(XLSX_MIME)
    assert r.content[:2] == b"PK"              # gecerli xlsx (zip)
    assert s["course"]["code"] in _all_cell_text(r.content)


# --- sinav programi ---

def test_exams_xlsx():
    h = admin_headers()
    s = _setup(h)
    r = client.get("/export/exams", params={"format": "xlsx"}, headers=h)
    assert r.status_code == 200, r.text
    assert "sinav_programi.xlsx" in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"
    body = _all_cell_text(r.content)
    assert s["course"]["code"] in body
    assert "Vize" in body                      # MIDTERM -> Vize cevirisi


def test_exams_type_filter():
    h = admin_headers()
    s = _setup(h)
    # Kurulan sinav MIDTERM: FINAL filtresi bizim dersi getirmemeli.
    r = client.get("/export/exams", params={"format": "csv", "exam_type": "FINAL"}, headers=h)
    assert r.status_code == 200
    assert s["course"]["code"] not in r.content.decode("utf-8-sig")
    r = client.get("/export/exams", params={"format": "csv", "exam_type": "MIDTERM"}, headers=h)
    assert s["course"]["code"] in r.content.decode("utf-8-sig")


# --- derslik programi (izgara) ---

def test_classrooms_xlsx_grid():
    h = admin_headers()
    s = _setup(h)
    r = client.get("/export/classrooms", params={"format": "xlsx"}, headers=h)
    assert r.status_code == 200, r.text
    assert "derslik_programi.xlsx" in r.headers["content-disposition"]
    assert r.content[:2] == b"PK"
    body = _all_cell_text(r.content)
    assert s["building"]["name"] in body       # derslik basligi
    assert s["course"]["code"] in body         # dolu hucre
    assert "Pazartesi" in body                 # gun basligi


def test_classrooms_csv():
    h = admin_headers()
    s = _setup(h)
    r = client.get("/export/classrooms", params={"format": "csv"}, headers=h)
    assert r.status_code == 200, r.text
    assert "derslik_programi.csv" in r.headers["content-disposition"]
    assert s["course"]["code"] in r.content.decode("utf-8-sig")


# --- izolasyon / hata / auth ---

def test_isolation_foreign_admin_sees_nothing():
    h = admin_headers()
    s = _setup(h)
    fh = foreign_admin_headers()
    for path in ("/export/weekly", "/export/exams", "/export/classrooms"):
        r = client.get(path, params={"format": "csv"}, headers=fh)
        assert r.status_code == 200, r.text
        assert s["course"]["code"] not in r.content.decode("utf-8-sig"), path


def test_unsupported_format_400():
    h = admin_headers()
    r = client.get("/export/weekly", params={"format": "pdf"}, headers=h)
    assert r.status_code == 400


def test_requires_auth_401():
    r = client.get("/export/weekly", params={"format": "csv"})
    assert r.status_code == 401
