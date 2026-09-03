"""WP2 CRUD testleri — dersler + şubeler (K-14 iç içe yapı, üyelik yetkisi)."""

from tests.helpers import (
    client, admin_headers, foreign_admin_headers, publish_exam, sub_headers, _u,
)


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

# --- ders silme (K-32) ---

def test_delete_empty_course():
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert client.delete(f"/courses/{course['id']}", headers=h).status_code == 204
    assert course["id"] not in [c["id"] for c in client.get("/courses", headers=h).json()]


def test_delete_course_blocked_by_section():
    h = admin_headers()
    dep = make_department(h)
    course = make_course(h, dep)
    lec = make_lecturer(h)
    client.post(f"/courses/{course['id']}/sections", json={
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": 30,
    }, headers=h)

    r = client.delete(f"/courses/{course['id']}", headers=h)
    assert r.status_code == 409
    assert "şube" in r.json()["detail"]


def test_delete_course_blocked_by_exam_without_section():
    """K-32'nin asıl sebebi: sınav DERS düzeyinde (K-16), şubesiz ders sınavlı olabilir."""
    h = admin_headers()
    dep = make_department(h)
    course = make_course(h, dep)
    lec = make_lecturer(h)
    # K-60: eski `POST /exams` kalktı; engelin konusu YAYINDAKİ sınav.
    publish_exam(course["id"], lec["id"])

    r = client.delete(f"/courses/{course['id']}", headers=h)
    assert r.status_code == 409
    assert "sınav" in r.json()["detail"]      # şube yok ama sınav engelledi


def test_delete_course_isolation_and_permission():
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert client.delete(f"/courses/{course['id']}", headers=foreign_admin_headers()).status_code == 404
    assert client.delete(f"/courses/{course['id']}", headers=sub_headers()).status_code == 403


# --- ortak (servis) ders + ek cohort'lar (K-48) ---

def _patch_course(h, course_id, body):
    return client.patch(f"/courses/{course_id}", json=body, headers=h)


def test_course_out_has_common_fields_defaults():
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert course["is_common"] is False
    assert course["extra_cohorts"] == []


def test_create_common_course_flag():
    h = admin_headers()
    course = make_course(h, make_department(h), is_common=True)
    assert course["is_common"] is True


def test_add_extra_cohorts_to_common_course():
    h = admin_headers()
    depA = make_department(h)
    depB = make_department(h)
    course = make_course(h, depA)                      # depA-2-SPRING (birincil)
    # K-85: liste TAM küme — birincil de içinde. Birincil listede olduğu için
    # yerinde kalır, depB ek cohort olur.
    r = _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [
            {"department_id": depA["id"], "year": 2, "semester": "SPRING"},
            {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
        ],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_common"] is True
    assert body["department_id"] == depA["id"]         # birincil taşınmadı
    assert len(body["extra_cohorts"]) == 1
    ec = body["extra_cohorts"][0]
    assert ec["department_id"] == depB["id"]
    assert ec["department_name"] == depB["name"]       # id değil ad
    assert ec["year"] == 2 and ec["semester"] == "SPRING"


def test_extra_cohort_replace_is_full():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h); depC = make_department(h)
    course = make_course(h, depA)
    birincil = {"department_id": depA["id"], "year": 2, "semester": "SPRING"}
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [birincil, {"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    # ikinci PATCH tam değiştirir: birincilin yanında artık yalnız depC kalmalı
    body = _patch_course(h, course["id"], {
        "cohorts": [birincil, {"department_id": depC["id"], "year": 1, "semester": "FALL"}],
    }).json()
    assert body["department_id"] == depA["id"]
    assert len(body["extra_cohorts"]) == 1
    assert body["extra_cohorts"][0]["department_id"] == depC["id"]


def test_extra_cohort_replace_retaining_one_no_500():
    # Regresyon: iki cohort'tan birini KORUYUP diğerini çıkaran PATCH, korunan
    # satırı yeniden INSERT etmeye çalışıp UNIQUE ihlali (500) vermemeli.
    h = admin_headers()
    depA = make_department(h); depB = make_department(h); depC = make_department(h)
    course = make_course(h, depA)
    birincil = {"department_id": depA["id"], "year": 2, "semester": "SPRING"}
    _patch_course(h, course["id"], {"is_common": True, "cohorts": [
        birincil,
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
        {"department_id": depC["id"], "year": 1, "semester": "FALL"},
    ]})
    # depB korunur, depC çıkar
    r = _patch_course(h, course["id"], {"cohorts": [
        birincil,
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
    ]})
    assert r.status_code == 200, r.text
    ec = r.json()["extra_cohorts"]
    assert len(ec) == 1 and ec[0]["department_id"] == depB["id"]


def test_unmark_common_clears_extra_cohorts():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    body = _patch_course(h, course["id"], {"is_common": False}).json()
    assert body["is_common"] is False
    assert body["extra_cohorts"] == []                 # ortak değilse ek cohort tutulmaz


def test_extra_cohort_on_non_common_rejected():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)                       # is_common False
    r = _patch_course(h, course["id"], {
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    assert r.status_code == 400


def test_cohort_set_may_contain_primary():
    """K-85: birincil cohort artık listeye DAHİL (K-48'de reddediliyordu).

    Liste kümenin tamamı olduğu için birincili yazmak normaldir; yalnız
    birincil verilirse ders tek cohort'lu ortak ders olur, ek cohort kalmaz.
    """
    h = admin_headers()
    depA = make_department(h)
    course = make_course(h, depA)                       # depA-2-SPRING
    r = _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depA["id"], "year": 2, "semester": "SPRING"}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["department_id"] == depA["id"]
    assert body["extra_cohorts"] == []


def test_cohort_set_can_drop_primary():
    """K-85: dersin BİRİNCİL bölümü de listeden çıkarılabilir.

    Asıl kazanım bu: K-48'de ortak dersin ilk girilen bölümü silinemiyordu.
    Çakışma motoru birincile ayrıcalık tanımadığı için (birincil ∪ ek) bu
    kısıt yalnızca depolamadan geliyordu. Birincil listeden çıkınca kalan
    cohort'lardan biri onun yerine geçer; ders bölümsüz kalmaz.
    """
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)                       # depA-2-SPRING
    _patch_course(h, course["id"], {"is_common": True, "cohorts": [
        {"department_id": depA["id"], "year": 2, "semester": "SPRING"},
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
    ]})
    # depA artık bu dersi almıyor
    r = _patch_course(h, course["id"], {"cohorts": [
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
    ]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["department_id"] == depB["id"]          # depB birincile terfi etti
    assert body["year"] == 2 and body["semester"] == "SPRING"
    assert body["extra_cohorts"] == []                  # depA'nın satırı da kalmadı


def test_cohort_set_promotes_first_when_primary_dropped():
    """Birincil listede yoksa terfi eden LİSTENİN İLKİdir (belirlenmiş sıra)."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h); depC = make_department(h)
    course = make_course(h, depA)
    r = _patch_course(h, course["id"], {"is_common": True, "cohorts": [
        {"department_id": depC["id"], "year": 1, "semester": "FALL"},
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
    ]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["department_id"] == depC["id"]
    assert body["year"] == 1 and body["semester"] == "FALL"
    assert len(body["extra_cohorts"]) == 1
    assert body["extra_cohorts"][0]["department_id"] == depB["id"]


def test_cohort_set_empty_rejected():
    """Ortak ders en az bir cohort'a bağlı kalmalı — bölümsüz ders yok."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)
    _patch_course(h, course["id"], {"is_common": True, "cohorts": [
        {"department_id": depA["id"], "year": 2, "semester": "SPRING"},
        {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
    ]})
    r = _patch_course(h, course["id"], {"cohorts": []})
    assert r.status_code == 400


def test_cohort_promotion_identity_clash_rejected():
    """Terfi eden üçlü uq_courses_identity'ye takılıyorsa 409 — sessiz 500 değil.

    Kod ve birincil AYNI PATCH'te değişebildiği için kimlik denetimi tek yerde
    ve efektif değerler üzerinden yapılır.
    """
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    kod = _u("CE")
    make_course(h, depB, code=kod, year=1, semester="FALL")   # depB-1-FALL/kod dolu
    course = make_course(h, depA, code=kod)                   # depA-2-SPRING/kod
    r = _patch_course(h, course["id"], {"is_common": True, "cohorts": [
        {"department_id": depB["id"], "year": 1, "semester": "FALL"},
    ]})
    assert r.status_code == 409, r.text


def test_extra_cohort_duplicate_rejected():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)
    r = _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [
            {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
            {"department_id": depB["id"], "year": 2, "semester": "SPRING"},
        ],
    })
    assert r.status_code == 400


def test_extra_cohort_foreign_department_rejected():
    h = admin_headers()
    depA = make_department(h)
    foreign_dep = make_department(foreign_admin_headers())   # başka workgroup
    course = make_course(h, depA)
    r = _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": foreign_dep["id"], "year": 2, "semester": "SPRING"}],
    })
    assert r.status_code == 400                          # izolasyon: yabancı bölüm


def test_extra_cohorts_visible_in_list():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [
            {"department_id": depA["id"], "year": 2, "semester": "SPRING"},
            {"department_id": depB["id"], "year": 3, "semester": "FALL"},
        ],
    })
    got = client.get(f"/courses?department_id={depA['id']}", headers=h).json()
    mine = next(c for c in got if c["id"] == course["id"])
    assert mine["is_common"] is True
    assert len(mine["extra_cohorts"]) == 1


def test_create_common_merges_by_code():
    # K-48: aynı kodlu ortak ders ikinci kez eklenince YENİ kayıt açılmaz —
    # gelen cohort mevcut ortak dersin altında toplanır.
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    code = _u("PHYS")
    c1 = make_course(h, depA, code=code, is_common=True, year=1, semester="FALL")
    r = client.post("/courses", json={
        "department_id": depB["id"], "year": 1, "semester": "SPRING",
        "code": code, "name": "Fizik", "is_common": True, "hours_theory": 3,
    }, headers=h)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] == c1["id"]                       # aynı ders döndü (birleşti)
    assert len(body["extra_cohorts"]) == 1
    assert body["extra_cohorts"][0]["department_id"] == depB["id"]
    # bu kodda sistemde TEK ortak ders var
    same = [c for c in client.get(f"/courses?department_id={depB['id']}", headers=h).json()
            if c["code"] == code]
    assert len(same) == 1


def test_create_common_merges_case_insensitive():
    # "CENG2001" varken "ceng2001" ortak eklenince BİRLEŞİR (kod harf duyarsız).
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    c1 = make_course(h, depA, code="CENG2001X", is_common=True, year=1, semester="FALL")
    r = client.post("/courses", json={
        "department_id": depB["id"], "year": 1, "semester": "SPRING",
        "code": "ceng2001x", "name": "istatistik", "is_common": True,
    }, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["id"] == c1["id"]                   # farklı harf, aynı ders
    assert len(r.json()["extra_cohorts"]) == 1


def test_create_common_merge_rejects_duplicate_cohort():
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    code = _u("MATH")
    make_course(h, depA, code=code, is_common=True, year=1, semester="FALL")
    body = {"department_id": depB["id"], "year": 1, "semester": "SPRING",
            "code": code, "name": "M", "is_common": True}
    assert client.post("/courses", json=body, headers=h).status_code == 201   # ilk merge
    assert client.post("/courses", json=body, headers=h).status_code == 409   # aynı cohort


def test_create_common_no_existing_creates_new():
    # İlk ortak ders: ortası yok → normal yeni kayıt (is_common true).
    h = admin_headers()
    dep = make_department(h)
    c = make_course(h, dep, code=_u("CHEM"), is_common=True)
    assert c["is_common"] is True and c["extra_cohorts"] == []


def test_non_common_same_code_not_merged():
    # Ortak DEĞİLSE birleştirme yok: farklı bölümde aynı kod ayrı kayıt kalır.
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    code = _u("HIST")
    a = make_course(h, depA, code=code)                 # ortak değil
    b = make_course(h, depB, code=code)                 # ortak değil, ayrı kayıt
    assert a["id"] != b["id"]


def test_list_common_via_extra_cohort():
    # K-48: ortak dersi EK cohort olarak alan bölümün listesinde de görünür.
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA, is_common=True)       # depA primary
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    got = client.get(f"/courses?department_id={depB['id']}", headers=h).json()
    assert any(c["id"] == course["id"] for c in got)


# --- K-49: ortak dersin düzenleme/şube yetkisi tüketen bölümlere de açık ---

def test_common_course_shared_edit_by_consumer():
    """K-49: dersi EK cohort olarak alan bölümün yetkilisi de düzenler + şube ekler."""
    h = admin_headers()
    depA = make_department(h)      # sahibi (birincil)
    depB = make_department(h)      # tüketen (ek cohort)
    lec = make_lecturer(h)
    course = make_course(h, depA, is_common=True)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })

    # depB üyesi alt hesap — SAHİBİ DEĞİL
    h_sub = sub_headers(department_ids=[depB["id"]], can_manage_courses=True)

    # düzenleyebilir
    r = client.patch(f"/courses/{course['id']}", json={"name": "Ortak Fizik II"}, headers=h_sub)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Ortak Fizik II"

    # şube ekleyebilir
    assert make_section(h_sub, course, lec).status_code == 201


def test_common_course_delete_by_consumer():
    """K-49: SİLME de paylaşımlı — tüketen bölümün yetkilisi boş ortak dersi siler."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA, is_common=True)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })

    # depB üyesi alt hesap (sahibi değil) boş dersi silebilir
    h_sub = sub_headers(department_ids=[depB["id"]], can_manage_courses=True)
    assert client.delete(f"/courses/{course['id']}", headers=h_sub).status_code == 204


def test_common_course_delete_blocked_for_noncohort():
    """K-49: dersi ALMAYAN bölüm silemez (403) — kapsam korunur."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h); depC = make_department(h)
    course = make_course(h, depA, is_common=True)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    h_sub = sub_headers(department_ids=[depC["id"]], can_manage_courses=True)
    assert client.delete(f"/courses/{course['id']}", headers=h_sub).status_code == 403


def test_common_course_not_editable_by_noncohort_department():
    """K-49: dersi ALMAYAN bölümün yetkilisi düzenleyemez (403) — kapsam korunur."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h); depC = make_department(h)
    course = make_course(h, depA, is_common=True)
    _patch_course(h, course["id"], {
        "is_common": True,
        "cohorts": [{"department_id": depB["id"], "year": 2, "semester": "SPRING"}],
    })
    # depC dersle hiç ilişkili değil
    h_sub = sub_headers(department_ids=[depC["id"]], can_manage_courses=True)
    assert client.patch(f"/courses/{course['id']}", json={"name": "x"},
                        headers=h_sub).status_code == 403


def test_normal_course_edit_still_owner_scoped():
    """K-49 regresyon: ortak OLMAYAN derste kural değişmez — atanmamış bölüm 403."""
    h = admin_headers()
    depA = make_department(h); depB = make_department(h)
    course = make_course(h, depA)                        # is_common False
    h_sub = sub_headers(department_ids=[depB["id"]], can_manage_courses=True)
    assert client.patch(f"/courses/{course['id']}", json={"name": "x"},
                        headers=h_sub).status_code == 403
