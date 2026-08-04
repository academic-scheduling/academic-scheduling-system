"""WP7 Bologna ders import testleri — parser (Faz 1).

Parser kaydedilmis HTML fixture'i ile test edilir; ag KULLANILMAZ. Fixture:
tests/fixtures/bologna_ceng.html (Bilgisayar Muh. bilgi paketi, curSunit=253).
"""

from pathlib import Path

import pytest

from app.bologna_import import extract_cursunit, parse_courses

FIXTURE = Path(__file__).parent / "fixtures" / "bologna_ceng.html"


@pytest.fixture(scope="module")
def courses():
    return parse_courses(FIXTURE.read_text(encoding="utf-8"))


def test_parses_all_courses(courses):
    # CENG 2022 mufredati: 8 yariyil, 71 ders (staj dersleri dahil).
    assert len(courses) == 71


def test_first_course_fields(courses):
    intro = next(c for c in courses if c.code == "CENG 1007")
    assert intro.name == "Introduction to Computer Science"
    assert (intro.hours_theory, intro.hours_practice, intro.hours_lab) == (3, 0, 0)
    assert intro.year == 1 and intro.semester == "FALL"
    assert intro.is_elective is False


def test_semester_mapping(courses):
    # 2. yariyil -> yil 1 / BAHAR; 3. yariyil -> yil 2 / GUZ.
    y1_spring = next(c for c in courses if c.code == "CENG 1004")
    assert y1_spring.year == 1 and y1_spring.semester == "SPRING"
    assert all(1 <= c.year <= 4 for c in courses)
    assert {c.semester for c in courses} == {"FALL", "SPRING"}


def test_tul_split(courses):
    # "3+0+2" gibi laboratuvarli ders dogru bolunur.
    phys = next(c for c in courses if c.code == "PHYS 1851")
    assert (phys.hours_theory, phys.hours_practice, phys.hours_lab) == (3, 0, 2)


def test_elective_flag(courses):
    assert any(c.is_elective for c in courses)
    assert any(not c.is_elective for c in courses)


def test_zero_hours_course_included(courses):
    # Staj dersi 0+0+0 saattir ama gecerli bir derstir — atlanmamali.
    staj = next(c for c in courses if c.code == "CENG 3009")
    assert (staj.hours_theory, staj.hours_practice, staj.hours_lab) == (0, 0, 0)


def test_no_internal_duplicates(courses):
    keys = [(c.year, c.semester, c.code) for c in courses]
    assert len(keys) == len(set(keys))          # UNIQUE(bolum,yil,donem,kod) guvenli


def test_extract_cursunit():
    url = "https://obs.mu.edu.tr/oibs/bologna/index.aspx?lang=tr&curOp=showPac&curUnit=07&curSunit=253"
    assert extract_cursunit(url) == "253"


def test_extract_cursunit_missing():
    with pytest.raises(ValueError):
        extract_cursunit("https://obs.mu.edu.tr/oibs/bologna/index.aspx?lang=tr")


def test_parse_empty_html_returns_empty():
    assert parse_courses("<html><body>yok</body></html>") == []


# --- Endpoint testleri (Faz 2) — ag MOCK'lanir, fixture doner ---

from tests.helpers import (  # noqa: E402
    client, admin_headers, foreign_admin_headers, sub_headers, _u,
)

FIXTURE_HTML = FIXTURE.read_text(encoding="utf-8")
IMPORT_URL = "https://obs.mu.edu.tr/oibs/bologna/index.aspx?lang=tr&curSunit=253"


@pytest.fixture
def mock_fetch(monkeypatch):
    """Agi devre disi birak: fetch fixture HTML'i dondursun (deterministik test)."""
    monkeypatch.setattr(
        "app.routers.import_courses.fetch_bologna_html",
        lambda cur_sunit: FIXTURE_HTML,
    )


def _make_department(h):
    r = client.post("/departments", json={"name": "Import Bölüm", "code": _u("IB")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def _preview(h, dep_id, url=IMPORT_URL):
    return client.post("/import/courses/preview",
                       json={"department_id": dep_id, "url": url}, headers=h)


def _commit(h, dep_id, courses):
    return client.post("/import/courses",
                       json={"department_id": dep_id, "courses": courses}, headers=h)


def _strip_exists(courses):
    """Onizleme ciktisini commit govdesine cevir (exists alanini at)."""
    return [{k: v for k, v in c.items() if k != "exists"} for c in courses]


# --- Faz 1: onizleme (yazma yok) ---

def test_preview_lists_all_courses_and_writes_nothing(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    r = _preview(h, dep["id"])
    assert r.status_code == 200, r.text
    courses = r.json()["courses"]
    assert len(courses) == 71
    assert all(c["exists"] is False for c in courses)   # bolum bos
    # Onizleme hicbir sey EKLEMEDI:
    got = client.get(f"/courses?department_id={dep['id']}", headers=h).json()
    assert got == []


def test_preview_marks_existing(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": "CENG 1007", "name": "Elle eklenen",
    }, headers=h)
    courses = _preview(h, dep["id"]).json()["courses"]
    existing = [c for c in courses if c["exists"]]
    assert len(existing) == 1 and existing[0]["code"] == "CENG 1007"


def test_preview_invalid_url(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    r = _preview(h, dep["id"], url="https://obs.mu.edu.tr/?lang=tr")  # curSunit yok
    assert r.status_code == 400


# --- Faz 2: secilenleri ekle ---

def test_commit_adds_selected_only(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    parsed = _preview(h, dep["id"]).json()["courses"]
    subset = _strip_exists(parsed[:3])              # yalnizca uc dersi sec
    body = _commit(h, dep["id"], subset).json()
    assert body["added_count"] == 3
    assert body["skipped_count"] == 0
    got = client.get(f"/courses?department_id={dep['id']}", headers=h).json()
    assert len(got) == 3


def test_commit_persists_edited_fields(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    parsed = _preview(h, dep["id"]).json()["courses"]
    one = _strip_exists(parsed[:1])
    one[0]["name"] = "Düzenlenmiş Ad"               # kullanici adi degistirdi
    one[0]["is_elective"] = True
    # Bu test, import'ta duzenlenen alanlarin YENI ders acilirken korundugunu
    # dogrular → ortak isaretini kaldirip (kullanici onizlemede yapabilir) create
    # yolunu deterministik kil. Ortak birakilsaydi (K-48/K-54) ayni kodlu mevcut
    # ortak derse cohort eklenir ve ad/secmelilik SAHIBININ degeri kalirdi
    # (paylasilan alanlari tuketen bolum degistiremez) — o davranis ayri test.
    one[0]["is_common"] = False
    _commit(h, dep["id"], one)
    got = client.get(f"/courses?department_id={dep['id']}", headers=h).json()
    assert got[0]["name"] == "Düzenlenmiş Ad"
    assert got[0]["is_elective"] is True


def test_commit_persists_is_common(mock_fetch):
    # K-48: içe aktarırken ortak işaretlenen ders is_common=true olarak kaydedilir.
    h = admin_headers()
    dep = _make_department(h)
    one = _strip_exists(_preview(h, dep["id"]).json()["courses"])[:1]
    one[0]["is_common"] = True
    _commit(h, dep["id"], one)
    got = client.get(f"/courses?department_id={dep['id']}", headers=h).json()
    assert got[0]["is_common"] is True


def test_commit_skips_existing_server_side(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    parsed = _strip_exists(_preview(h, dep["id"]).json()["courses"])
    _commit(h, dep["id"], parsed)                   # hepsini ekle
    body = _commit(h, dep["id"], parsed).json()     # ayni kumeyi tekrar gonder
    assert body["added_count"] == 0
    assert body["skipped_count"] == 71


def test_commit_invalid_semester_rejected(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    bad = [{"code": "X 1", "name": "Kötü", "year": 1, "semester": "AUTUMN"}]
    r = _commit(h, dep["id"], bad)
    assert r.status_code == 422


def test_preview_foreign_department(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)                        # bizim workgroup'ta
    fh = foreign_admin_headers()
    r = _preview(fh, dep["id"])                      # yabanci admin bizim bolume bakamaz
    assert r.status_code == 400


def test_commit_foreign_department(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    fh = foreign_admin_headers()
    r = _commit(fh, dep["id"], [{"code": "X 1", "name": "X", "year": 1, "semester": "FALL"}])
    assert r.status_code == 400


def test_preview_requires_course_permission(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    sub = sub_headers(department_ids=[dep["id"]])    # can_manage_courses KAPALI (K-25)
    assert _preview(sub, dep["id"]).status_code == 403


def test_commit_requires_course_permission(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    sub = sub_headers(department_ids=[dep["id"]])
    r = _commit(sub, dep["id"], [{"code": "X 1", "name": "X", "year": 1, "semester": "FALL"}])
    assert r.status_code == 403


def test_sub_with_permission_can_preview_and_commit(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    sub = sub_headers(can_manage_courses=True, department_ids=[dep["id"]])
    parsed = _strip_exists(_preview(sub, dep["id"]).json()["courses"])
    # Yetkili alt hesap 71 dersin hepsini isleyebilmeli. Kac tanesi YENI acildi
    # (added) vs mevcut ortak derse cohort olarak eklendi (merged) paylasimli test
    # DB'sinde onceki testlerin biraktigi ortak derslere baglidir (K-54); bu test
    # YETKIYI dogrular → hepsi bir sekilde islensin (added + merged = 71).
    body = _commit(sub, dep["id"], parsed).json()
    assert body["added_count"] + body["merged_count"] == 71


# --- K-48: ortak ders ön-işareti (kod öneki ≠ bölüm kodu) ---

def test_looks_common_prefix_rule():
    from app.routers.import_courses import _looks_common
    # Bölüm koduyla başlayan → kendi dersi (ortak değil)
    assert _looks_common("CENG 1004", "CENG") is False
    assert _looks_common("CE 2001", "CE") is False
    # Baştaki HARF dizisi farklı → ortak (startswith değil: "CE" bölümü "CENG"i yutmaz)
    assert _looks_common("CENG 2001", "CE") is True
    assert _looks_common("ATB 3801", "CENG") is True
    assert _looks_common("CHEM 1853", "CENG") is True
    assert _looks_common("MATH1001", "CENG") is True


def test_preview_marks_common_by_prefix(mock_fetch):
    """CENG bölümünde: CENG dersleri ortak DEĞİL, diğerleri (ATB/MATH…) ortak."""
    h = admin_headers()
    r = client.post("/departments", json={"name": "Bilgisayar Müh.", "code": "CENG"}, headers=h)
    dep = (r.json() if r.status_code == 201
           else next(d for d in client.get("/departments", headers=h).json()
                     if d["code"] == "CENG"))
    courses = _preview(h, dep["id"]).json()["courses"]
    ceng = next(c for c in courses if c["code"].upper().startswith("CENG"))
    other = next(c for c in courses if not c["code"].upper().startswith("CENG"))
    assert ceng["is_common"] is False
    assert other["is_common"] is True


# --- K-54: ortak dersin bölümler-arası BİRLEŞTİRİLMESİ (kullanıcı şikâyeti) ---

def test_import_merges_common_across_departments():
    """A bölümüne aktarılan ortak ders, B bölümü import edince YENİ kayıt yerine
    aynı dersin cohort'u olur — eskiden her bölüm için ayrı kayıt açılıp 'Ortak
    Dersler'de iki kart çıkıyordu."""
    h = admin_headers()
    dep_a = _make_department(h)
    dep_b = _make_department(h)
    row = {"code": _u("SRV"), "name": "Ortak Servis Dersi", "year": 1,
           "semester": "FALL", "is_common": True, "ects": 5}
    # A'ya → yeni ortak ders açılır.
    ra = _commit(h, dep_a["id"], [row]).json()
    assert ra["added_count"] == 1 and ra["merged_count"] == 0
    # B'ye AYNI kod → MERGE (yeni kayıt yok, cohort eklenir).
    rb = _commit(h, dep_b["id"], [row]).json()
    assert rb["added_count"] == 0 and rb["merged_count"] == 1
    # Tek ders iki bölümde: A'nın dersi B'nin listesinde de aynı id ile görünür.
    a = next(c for c in client.get(f"/courses?department_id={dep_a['id']}", headers=h).json()
             if c["code"] == row["code"])
    b = next(c for c in client.get(f"/courses?department_id={dep_b['id']}", headers=h).json()
             if c["code"] == row["code"])
    assert a["id"] == b["id"]                         # tek kayıt, iki cohort
    assert any(cc["department_id"] == dep_b["id"] for cc in a["extra_cohorts"])
    assert a["ects"] == 5                             # K-55 korunur
    # Tekrar B'ye aynı satır → artık kapsanıyor, sessizce atlanır (idempotent).
    rb2 = _commit(h, dep_b["id"], [row]).json()
    assert rb2["merged_count"] == 0 and rb2["skipped_count"] == 1


# --- K-55: AKTS Bologna'dan okunur + saklanır ---

def test_import_parses_and_persists_ects(mock_fetch):
    h = admin_headers()
    dep = _make_department(h)
    parsed = _preview(h, dep["id"]).json()["courses"]
    intro = next(c for c in parsed if c["code"] == "CENG 1007")
    assert intro["ects"] == 6                         # fixture: Intro to CS = 6 AKTS
    row = {k: v for k, v in intro.items() if k != "exists"}
    row["is_common"] = False                          # kendi bölümünde saklansın
    row["code"] = _u("ECTS")                          # başka testle çakışmasın
    _commit(h, dep["id"], [row])
    saved = next(c for c in client.get(f"/courses?department_id={dep['id']}", headers=h).json()
                 if c["code"] == row["code"])
    assert saved["ects"] == 6
