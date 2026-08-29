"""K-81 · Sinav gozetmenleri — API dogrulamalari ve E9 kurali.

Gozetmen SORUMLUYA EK bir roldur: istege bagli, 0..N, ve sorumluyla ayni kisi
olamaz. Motor tarafi `test_overlap.py`de birim olarak sinaniyor; burada
kanitlanan sey UCTAN UCA olan: govde -> dogrulama -> DB -> cakisma taramasi.
"""

from app.db import SessionLocal
from app.models import Exam
from tests.helpers import admin_headers, client
from tests.test_k59_draft_api import (
    make_classroom, make_course, make_department, make_lecturer,
)
from tests.test_k60_exam_draft_api import create_exam_draft

MONDAY = "2026-09-14"


def _kur(h, year=1):
    dep = make_department(h)
    cls = make_classroom(h)
    course = make_course(h, dep["id"], year=year)
    return dep, cls, course


def _govde(course_id, lecturer_id, gozetmenler=None, saat="09:00:00"):
    govde = {
        "course_id": course_id, "exam_type": "MIDTERM", "exam_index": 1,
        "exam_date": MONDAY, "start_time": saat, "duration_minutes": 90,
        "classroom_ids": [], "lecturer_id": lecturer_id,
    }
    if gozetmenler is not None:
        govde["invigilator_ids"] = gozetmenler
    return govde


def _ekle(h, draft_id, govde):
    return client.post("/schedule-drafts/%d/exams" % draft_id, json=govde, headers=h)


def _duzenle(h, draft_id, exam_id, govde):
    return client.patch(
        "/schedule-drafts/%d/exams/%d" % (draft_id, exam_id), json=govde, headers=h)


# ------------------------------------------------------------------
# Olusturma
# ------------------------------------------------------------------

def test_gozetmen_alani_hic_gonderilmeyebilir():
    """Geriye uyumluluk: gozetmen kavramini bilmeyen istemci kirilmamali."""
    h = admin_headers()
    dep, _, course = _kur(h)
    lec = make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    r = _ekle(h, d["id"], _govde(course["id"], lec["id"]))
    assert r.status_code == 201, r.text
    assert r.json()["exam"]["invigilators"] == []


def test_birden_fazla_gozetmen_eklenebilir():
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1, g2 = make_lecturer(h), make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    r = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"], g2["id"]]))
    assert r.status_code == 201, r.text
    assert {g["id"] for g in r.json()["exam"]["invigilators"]} == {g1["id"], g2["id"]}


def test_sorumlu_gozetmen_olarak_eklenemez():
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu = make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    r = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [sorumlu["id"]]))
    assert r.status_code == 400
    assert "gözetmen" in r.json()["detail"].lower()


def test_ayni_gozetmen_iki_kez_eklenemez():
    """Birlesik PK zaten reddeder; anlasilmaz 500 yerine acik 400 istiyoruz."""
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    r = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"], g1["id"]]))
    assert r.status_code == 400


# ------------------------------------------------------------------
# Guncelleme (K-22: liste verilirse TAM degisir)
# ------------------------------------------------------------------

def test_patch_listeyi_tam_degistirir():
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1, g2 = make_lecturer(h), make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])
    sinav = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"]])
                  ).json()["exam"]

    r = _duzenle(h, d["id"], sinav["id"], {"invigilator_ids": [g2["id"]]})
    assert r.status_code == 200, r.text
    assert [g["id"] for g in r.json()["exam"]["invigilators"]] == [g2["id"]]


def test_patch_bos_liste_gozetmenleri_kaldirir():
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])
    sinav = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"]])
                  ).json()["exam"]

    r = _duzenle(h, d["id"], sinav["id"], {"invigilator_ids": []})
    assert r.status_code == 200
    assert r.json()["exam"]["invigilators"] == []


def test_patch_alan_verilmezse_dokunmaz():
    """K-22: `None` 'dokunma' demektir — bos listeyle ayni sey DEGIL."""
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])
    sinav = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"]])
                  ).json()["exam"]

    r = _duzenle(h, d["id"], sinav["id"], {"duration_minutes": 60})
    assert r.status_code == 200
    assert [g["id"] for g in r.json()["exam"]["invigilators"]] == [g1["id"]]


def test_sorumluyu_gozetmenlerden_birine_cevirmek_reddedilir():
    """PATCH yalniz `lecturer_id` tasiyor; catisma KAYITTAKI listeye karsi."""
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])
    sinav = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"]])
                  ).json()["exam"]

    r = _duzenle(h, d["id"], sinav["id"], {"lecturer_id": g1["id"]})
    assert r.status_code == 400


# ------------------------------------------------------------------
# Cakisma: E9
# ------------------------------------------------------------------

def test_e9_ayni_gozetmen_iki_sinavda_UYARI_uretir():
    """Sonuc UYARI olmali (K-81): gozetmen degistirilerek cozulur, yayini durdurmaz."""
    h = admin_headers()
    dep, _, c1 = _kur(h)
    c2 = make_course(h, dep["id"], year=1)
    s1, s2, g1 = make_lecturer(h), make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    _ekle(h, d["id"], _govde(c1["id"], s1["id"], [g1["id"]]))
    r = _ekle(h, d["id"], _govde(c2["id"], s2["id"], [g1["id"]]))
    assert r.status_code == 201, r.text

    kurallar = {c["rule_id"]: c["severity"] for c in r.json()["conflicts"]}
    assert kurallar.get("E9") == "WARNING"


def test_e9_farkli_saatte_susar():
    h = admin_headers()
    dep, _, c1 = _kur(h)
    c2 = make_course(h, dep["id"], year=1)
    s1, s2, g1 = make_lecturer(h), make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    _ekle(h, d["id"], _govde(c1["id"], s1["id"], [g1["id"]]))
    r = _ekle(h, d["id"], _govde(c2["id"], s2["id"], [g1["id"]], saat="14:00:00"))
    assert "E9" not in {c["rule_id"] for c in r.json()["conflicts"]}


def test_gozetmensiz_sinavlar_e9_uretmez():
    """Bekci: bos gozetmen kumeleri 'kesisiyor' sayilip herkesi uyarmamali."""
    h = admin_headers()
    dep, _, c1 = _kur(h)
    c2 = make_course(h, dep["id"], year=1)
    s1, s2 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])

    _ekle(h, d["id"], _govde(c1["id"], s1["id"], []))
    r = _ekle(h, d["id"], _govde(c2["id"], s2["id"], []))
    assert "E9" not in {c["rule_id"] for c in r.json()["conflicts"]}


def test_gozetmen_kaydi_dbye_yaziliyor():
    h = admin_headers()
    dep, _, course = _kur(h)
    sorumlu, g1 = make_lecturer(h), make_lecturer(h)
    d = create_exam_draft(h, dep["id"])
    sinav = _ekle(h, d["id"], _govde(course["id"], sorumlu["id"], [g1["id"]])
                  ).json()["exam"]

    db = SessionLocal()
    try:
        x = db.get(Exam, sinav["id"])
        assert [g.id for g in x.invigilators] == [g1["id"]]
    finally:
        db.close()
