"""K-64 · Bologna'dan hoca eşleştirmeli şube import'u.

İki katman test edilir:
  1. Saf parse (ağ yok): parse_detail "Dersi Verenler" (tekil/çoklu/Yok) + vize
     sayısı; parse_courses her ders satırının detay postback hedefini çıkarır.
  2. Uçlar: detay çekme STUB'lanır (ağ yok) → preview hocayı mevcut listeyle
     eşler, commit hoca başına şube açar (80 kontenjan), mevcut şubesiz derse de
     şube ekler, zaten şubeliye dokunmaz, vize sayısını yazar.
"""

from pathlib import Path

import pytest

from app.bologna_import import (
    CourseDetail, ParsedInstructor, parse_courses, parse_detail,
)
from app.normalize import normalize_lecturer_name
from tests.helpers import admin_headers, client, _u

FIXTURE = Path(__file__).parent / "fixtures" / "bologna_ceng.html"
FIXTURE_HTML = FIXTURE.read_text(encoding="utf-8")
IMPORT_URL = "https://obs.mu.edu.tr/oibs/bologna/index.aspx?lang=tr&curSunit=253"


# ---------------------------------------------------------------------------
# 1. Saf parse — detay sayfası (ağ yok)
# ---------------------------------------------------------------------------

def _wrap(inner: str) -> str:
    return f"<html><body>{inner}</body></html>"


def test_parse_detail_single_instructor():
    html = _wrap(
        '<span id="dlDers_DERS_VERENLabel_0">Dr.Öğr.Üyesi BARIŞ İŞÇİ PEMBECİ</span>'
    )
    d = parse_detail(html)
    assert len(d.instructors) == 1
    ins = d.instructors[0]
    assert ins.raw == "Dr.Öğr.Üyesi BARIŞ İŞÇİ PEMBECİ"
    assert ins.title == "Dr. Öğr. Üyesi"          # unvan ayrıldı
    assert ins.name == "BARIŞ İŞÇİ PEMBECİ"
    assert ins.normalized == "barış işçi pembeci"  # eşleştirme anahtarı


def test_parse_detail_multiple_instructors_split_on_br():
    # Gerçek ENG 1803: iki okutman <br> ile ayrılmış.
    html = _wrap(
        '<span id="dlDers_DERS_VERENLabel_0">'
        'Okutman Müzeyyen Aykaç Erdoğan<br>Okutman Özlem GÜMÜŞ</span>'
    )
    d = parse_detail(html)
    assert [i.name for i in d.instructors] == [
        "Okutman Müzeyyen Aykaç Erdoğan", "Okutman Özlem GÜMÜŞ",
    ]


def test_parse_detail_yok_is_no_instructor():
    html = _wrap('<span id="dlDers_DERS_VERENLabel_0">Yok</span>')
    assert parse_detail(html).instructors == []


def test_parse_detail_missing_span():
    assert parse_detail(_wrap("<p>hoca alanı yok</p>")).instructors == []


def test_parse_detail_ignores_header_span():
    # Başlık span'i (...Labelh_0) değer sanılmamalı — yalnız ...Label_0 okunur.
    html = _wrap(
        '<span id="dlDers_DERS_VERENLabelh_0">Dersi Verenler</span>'
        '<span id="dlDers_DERS_VERENLabel_0">Prof.Dr. Ali VELİ</span>'
    )
    d = parse_detail(html)
    assert len(d.instructors) == 1 and d.instructors[0].name == "Ali VELİ"


def test_parse_detail_midterm_count():
    html = _wrap(
        '<table id="grd_degerlendirme">'
        '<tr><td>Ara Sınav</td><td>1</td><td>% 40</td></tr>'
        '<tr><td>Yarıyıl Sonu Sınavı</td><td>1</td><td>% 60</td></tr>'
        '</table>'
    )
    assert parse_detail(html).midterm_count == 1


def test_parse_detail_midterm_ignores_plural_and_topics():
    # "Ara Sınavlar" (çoğul, iş-yükü) ve hafta-konusu satırları ATLANIR;
    # yalnız tam "Ara Sınav" değerlendirme satırı sayılır.
    html = _wrap(
        '<table id="grd_degerlendirme">'
        '<tr><td>Ara Sınavlar</td><td>9</td><td>9</td></tr>'
        '<tr><td>Ara Sınav</td><td>2</td><td>% 30</td></tr>'
        '</table>'
    )
    assert parse_detail(html).midterm_count == 2


def test_parse_detail_midterm_clamped_to_three():
    html = _wrap(
        '<table id="grd_degerlendirme">'
        '<tr><td>Ara Sınav</td><td>5</td><td>% 50</td></tr></table>'
    )
    assert parse_detail(html).midterm_count == 3          # K-46: 1-3


def test_parse_detail_midterm_none_when_absent():
    assert parse_detail(_wrap("<p>değerlendirme yok</p>")).midterm_count is None


def test_parse_courses_extracts_event_target():
    courses = parse_courses(FIXTURE_HTML)
    intro = next(c for c in courses if c.code == "CENG 1007")
    assert intro.event_target == "grdBolognaDersler$ctl05$btnDersAyrinti"


# ---------------------------------------------------------------------------
# 2. Uçlar — detay STUB'lanır (ağ yok)
# ---------------------------------------------------------------------------

def _detail(names, midterm=None):
    """Verilen adlardan CourseDetail üretir (unvan test dışı, name=raw)."""
    return CourseDetail(
        instructors=[
            ParsedInstructor(
                raw=n, title=None, name=n, normalized=normalize_lecturer_name(n)
            )
            for n in names
        ],
        midterm_count=midterm,
    )


@pytest.fixture
def stub(monkeypatch):
    """Ağı kes: liste fixture'ı + TÜM derslere aynı detay. state['detail']
    değiştirilerek her testin hoca/vize senaryosu kurulur."""
    state = {"detail": _detail([])}
    monkeypatch.setattr(
        "app.routers.import_courses.fetch_bologna_html", lambda cur_sunit: FIXTURE_HTML
    )
    monkeypatch.setattr(
        "app.routers.import_courses.fetch_details_bulk",
        lambda cur_sunit, targets, hidden, **k: {t: state["detail"] for t in targets},
    )
    return state


def _make_dep(h):
    r = client.post("/departments", json={"name": "K64 Bölüm", "code": _u("K64")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _make_lecturer(h, full_name):
    r = client.post("/lecturers", json={"full_name": full_name}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _preview(h, dep_id):
    r = client.post("/import/courses/preview",
                    json={"department_id": dep_id, "url": IMPORT_URL}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()["courses"]


def _to_commit(row, sections=None):
    """Preview satırını commit gövdesine çevir (yalnız CourseFields + sections)."""
    keep = {"code", "name", "year", "semester", "hours_theory", "hours_practice",
            "hours_lab", "ects", "midterm_count", "is_elective", "is_common"}
    body = {k: v for k, v in row.items() if k in keep}
    body["is_common"] = False                # kendi bölümünde deterministik açılsın
    body["sections"] = sections or []
    return body


def _course_by_code(h, dep_id, code):
    return next(c for c in client.get(f"/courses?department_id={dep_id}", headers=h).json()
                if c["code"] == code)


def test_preview_matches_existing_lecturer(stub):
    h = admin_headers()
    dep = _make_dep(h)
    lec = _make_lecturer(h, "Barış İşçi Pembeci")
    stub["detail"] = _detail(["Dr.Öğr.Üyesi BARIŞ İŞÇİ PEMBECİ"], midterm=2)
    rows = _preview(h, dep["id"])
    row = next(r for r in rows if r["code"] == "CENG 1007")
    assert len(row["instructors"]) == 1
    assert row["instructors"][0]["lecturer_id"] == lec["id"]   # eşleşti
    assert row["midterm_count"] == 2


def test_preview_unmatched_lecturer_is_null(stub):
    h = admin_headers()
    dep = _make_dep(h)
    # Hiç hoca oluşturulmadı → eşleşme yok.
    stub["detail"] = _detail(["Dr.Öğr.Üyesi Kimse YOK"])
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    assert row["instructors"][0]["lecturer_id"] is None
    assert row["instructors"][0]["raw"] == "Dr.Öğr.Üyesi Kimse YOK"


def test_commit_creates_one_section_per_instructor(stub):
    h = admin_headers()
    dep = _make_dep(h)
    na, nb = _u("Ali"), _u("Veli")            # workgroup içinde benzersiz hoca adı
    a = _make_lecturer(h, na)
    b = _make_lecturer(h, nb)
    stub["detail"] = _detail([na, nb])
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    # İki eşleşen hoca → iki şube.
    body = _to_commit(row, sections=[
        {"lecturer_id": a["id"]}, {"lecturer_id": b["id"]},
    ])
    res = client.post("/import/courses",
                      json={"department_id": dep["id"], "courses": [body]}, headers=h).json()
    assert res["added_count"] == 1
    assert res["sections_created"] == 2
    course = _course_by_code(h, dep["id"], "CENG 1007")
    secs = sorted(course["sections"], key=lambda s: s["section_no"])
    assert [s["section_no"] for s in secs] == [1, 2]
    assert [s["lecturer"]["id"] for s in secs] == [a["id"], b["id"]]
    assert all(s["expected_students"] == 80 for s in secs)     # varsayılan kontenjan


def test_commit_adds_sections_to_existing_sectionless_course(stub):
    h = admin_headers()
    dep = _make_dep(h)
    name = _u("Ali")
    lec = _make_lecturer(h, name)
    # Ders elle önceden açılmış (şubesiz).
    client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": "CENG 1007", "name": "Elle", "midterm_count": 1,
    }, headers=h)
    stub["detail"] = _detail([name], midterm=3)
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    assert row["exists"] is True and row["has_sections"] is False
    body = _to_commit(row, sections=[{"lecturer_id": lec["id"]}])
    res = client.post("/import/courses",
                      json={"department_id": dep["id"], "courses": [body]}, headers=h).json()
    assert res["added_count"] == 0 and res["skipped_count"] == 1  # ders açılmadı
    assert res["sections_created"] == 1                          # ama şube eklendi
    course = _course_by_code(h, dep["id"], "CENG 1007")
    assert len(course["sections"]) == 1
    assert course["midterm_count"] == 3                          # vize Bologna'dan güncellendi


def test_commit_does_not_touch_course_with_sections(stub):
    h = admin_headers()
    dep = _make_dep(h)
    name = _u("Ali")
    lec = _make_lecturer(h, name)
    course = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": "CENG 1007", "name": "Elle",
    }, headers=h).json()
    # Zaten bir şubesi var.
    client.post(f"/courses/{course['id']}/sections", json={
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": 40,
    }, headers=h)
    stub["detail"] = _detail([name])
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    assert row["has_sections"] is True
    body = _to_commit(row, sections=[{"lecturer_id": lec["id"]}])
    res = client.post("/import/courses",
                      json={"department_id": dep["id"], "courses": [body]}, headers=h).json()
    assert res["sections_created"] == 0                          # mükerrer önlendi
    fresh = _course_by_code(h, dep["id"], "CENG 1007")
    assert len(fresh["sections"]) == 1
    assert fresh["sections"][0]["expected_students"] == 40       # dokunulmadı


def test_commit_section_foreign_lecturer_rejected(stub):
    from tests.helpers import foreign_admin_headers
    h = admin_headers()
    dep = _make_dep(h)
    # Başka workgroup'ta hoca.
    fh = foreign_admin_headers()
    alien = _make_lecturer(fh, "Yabancı Hoca")
    stub["detail"] = _detail([])
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    body = _to_commit(row, sections=[{"lecturer_id": alien["id"]}])
    r = client.post("/import/courses",
                    json={"department_id": dep["id"], "courses": [body]}, headers=h)
    assert r.status_code == 400                                  # çapraz-FK izolasyonu


def test_commit_new_course_sets_midterm_from_bologna(stub):
    h = admin_headers()
    dep = _make_dep(h)
    stub["detail"] = _detail([], midterm=3)
    row = next(r for r in _preview(h, dep["id"]) if r["code"] == "CENG 1007")
    assert row["midterm_count"] == 3
    body = _to_commit(row)                                       # şubesiz, yeni ders
    client.post("/import/courses",
                json={"department_id": dep["id"], "courses": [body]}, headers=h)
    course = _course_by_code(h, dep["id"], "CENG 1007")
    assert course["midterm_count"] == 3
