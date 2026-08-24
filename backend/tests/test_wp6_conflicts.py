"""WP6 çakışma taraması — GET /conflicts (kontrat §9).

Motor stub olduğu için gerçek çakışma üretilemiyor; testler sözleşmeyi ve
yetkiyi koruyor. Motor bağlandığında (A-3/C-2) buraya senaryo testleri eklenir.
"""

from tests.helpers import client, admin_headers, sub_headers


def test_scan_returns_two_buckets():
    """Cevap her zaman iki kovalı: hard ve warnings (kontrat §9)."""
    r = client.get("/conflicts", headers=admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["hard"], list)
    assert isinstance(body["warnings"], list)


def test_sub_account_can_read_conflicts():
    """K-26: alt hesap da tüm workgroup'un çakışmalarını GÖRÜR.

    Dashboard özetinden (yalnız ADMIN) ayrılan nokta burası. Alt hesap
    çakışmayı çözebilmek için karşı tarafı görmek zorunda; hiçbir yetenek
    bayrağı olmayan hesap bile okuyabilmeli.
    """
    r = client.get("/conflicts", headers=sub_headers())
    assert r.status_code == 200, r.text


def test_anonymous_cannot_read_conflicts():
    assert client.get("/conflicts").status_code == 401


def test_buckets_are_split_by_severity(monkeypatch):
    """Hard/warning ayrımını SUNUCU yapar; UI yalnızca çizer (K-05)."""
    from app import conflict_service

    monkeypatch.setattr(
        conflict_service, "scan_workgroup",
        lambda db, wg: {
            "hard": [{"severity": "HARD", "rule_id": "W1",
                      "message": "Derslik çakışması", "affected": []}],
            "warnings": [{"severity": "WARNING", "rule_id": "W7",
                          "message": "Kapasite aşımı", "affected": []}],
        },
    )
    body = client.get("/conflicts", headers=admin_headers()).json()
    assert len(body["hard"]) == 1 and body["hard"][0]["rule_id"] == "W1"
    assert len(body["warnings"]) == 1 and body["warnings"][0]["rule_id"] == "W7"


def test_affected_refs_survive_the_contract(monkeypatch):
    """`affected` listesi kontrat §0 şeklini korumalı — UI satırı ondan kuruyor."""
    from app import conflict_service

    monkeypatch.setattr(
        conflict_service, "scan_workgroup",
        lambda db, wg: {
            "hard": [{
                "severity": "HARD", "rule_id": "E1",
                "message": "Sınav derslik çakışması",
                # K-80: COHORT üçlüsü (bölüm + sınıf + dönem) taşınır — rapor
                # süzmesi bunları okur.
                "affected": [{"type": "exam", "id": 42, "course_code": "CENG2001",
                              "department_id": 3, "year": 2, "semester": "SPRING"}],
            }],
            "warnings": [],
        },
    )
    ref = client.get("/conflicts", headers=admin_headers()).json()["hard"][0]["affected"][0]
    assert ref == {"type": "exam", "id": 42, "course_code": "CENG2001",
                   "department_id": 3, "year": 2, "semester": "SPRING"}


def test_affected_ref_carries_the_semester_from_the_engine():
    """K-80: `semester` motor dict'inde ZATEN vardı ama dışarı verilmiyordu.

    Sözleşme testi (yukarıdaki) motoru monkeypatch'lediği için bu boşluğu
    göremezdi — burada GERÇEK motor çıktısı üzerinden bakılıyor: cohort üç
    boyutludur ve rapor "güz mü bahar mı" diye süzebilmeli.
    """
    from app.conflicts.message import _affected_ref

    ref = _affected_ref({
        "type": "weekly_entry", "id": 7, "course_code": "CENG 1004",
        "section_no": 1, "department_id": 3, "year": 1, "semester": "SPRING",
    })
    assert ref["semester"] == "SPRING"
    assert (ref["department_id"], ref["year"]) == (3, 1)
