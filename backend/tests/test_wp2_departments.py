"""WP2 CRUD testleri — bölümler.

Desen: WP1 API testlerinin devamı. Gerçek dev DB'ye API üzerinden yazar;
benzersiz kod/e-postalarla tekrar çalıştırılabilir kalır. İzolasyon testi
için ikinci bir workgroup + admin DOĞRUDAN DB'ye eklenir (workgroup
oluşturma endpoint'i bilinçli olarak yok).
"""

from tests.helpers import client, admin_headers, foreign_admin_headers, _u

# --- temel CRUD ---

def test_list_requires_auth():
    assert client.get("/departments").status_code == 401


def test_create_and_list():
    h = admin_headers()
    code = _u("BM")
    r = client.post("/departments", json={"name": "Bilgisayar Müh.", "code": code}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["code"] == code

    listed = client.get("/departments", headers=h)
    assert listed.status_code == 200
    assert code in [d["code"] for d in listed.json()]


def test_create_duplicate_code_conflict():
    h = admin_headers()
    code = _u("EE")
    assert client.post("/departments", json={"name": "A", "code": code}, headers=h).status_code == 201
    assert client.post("/departments", json={"name": "B", "code": code}, headers=h).status_code == 409


def test_patch_partial_update():
    h = admin_headers()
    code = _u("MK")
    dep = client.post("/departments", json={"name": "Eski Ad", "code": code}, headers=h).json()

    r = client.patch(f"/departments/{dep['id']}", json={"name": "Yeni Ad"}, headers=h)
    assert r.status_code == 200
    assert r.json()["name"] == "Yeni Ad"
    assert r.json()["code"] == code          # göndermediğimiz alan DEĞİŞMEMELİ


def test_patch_code_conflict():
    h = admin_headers()
    code1, code2 = _u("IN"), _u("GD")
    client.post("/departments", json={"name": "A", "code": code1}, headers=h)
    dep2 = client.post("/departments", json={"name": "B", "code": code2}, headers=h).json()

    r = client.patch(f"/departments/{dep2['id']}", json={"code": code1}, headers=h)
    assert r.status_code == 409


def test_patch_nonexistent_returns_404():
    h = admin_headers()
    assert client.patch("/departments/99999999", json={"name": "X"}, headers=h).status_code == 404


def test_create_defaults_active_true():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Aktif", "code": _u("AK")}, headers=h).json()
    assert dep["active"] is True


def test_patch_deactivate_department():
    """K-02 soft delete: bölüm silinmez, active=false ile pasife alınır."""
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Kapanan", "code": _u("KP")}, headers=h).json()
    r = client.patch(f"/departments/{dep['id']}", json={"active": False}, headers=h)
    assert r.status_code == 200
    assert r.json()["active"] is False


# --- workgroup izolasyonu (WP2'nin kalbi) ---

def test_isolation_foreign_admin_cannot_see_or_touch():
    h_ours = admin_headers()
    code = _u("GZ")
    dep = client.post("/departments", json={"name": "Gizli Bölüm", "code": code}, headers=h_ours).json()

    h_foreign = foreign_admin_headers()

    # 1. Listesinde görünmemeli
    listed = client.get("/departments", headers=h_foreign)
    assert code not in [d["code"] for d in listed.json()]

    # 2. PATCH edememeli — üstelik 403 değil 404 (varlığını bile sızdırmayız)
    r = client.patch(f"/departments/{dep['id']}", json={"name": "Ele Geçti"}, headers=h_foreign)
    assert r.status_code == 404

# --- kalıcı silme (K-27) ---

def test_delete_empty_department():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Boş", "code": _u("DL")}, headers=h).json()
    assert client.delete(f"/departments/{dep['id']}", headers=h).status_code == 204
    assert dep["code"] not in [d["code"] for d in client.get("/departments", headers=h).json()]


def test_delete_blocked_by_course():
    """Ders bağlıysa silinmez ve mesaj sebebi söyler."""
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Derslibölüm", "code": _u("DC")}, headers=h).json()
    lec = client.post("/lecturers", json={"full_name": f"Dr. Silme {_u('L')}"}, headers=h).json()
    client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("DD"), "name": "Engelleyen Ders",
    }, headers=h)

    r = client.delete(f"/departments/{dep['id']}", headers=h)
    assert r.status_code == 409
    assert "ders" in r.json()["detail"]
    assert lec  # hoca kaydı kullanılmadıysa da testin niyeti bozulmasın


def test_delete_blocked_by_membership():
    """Kullanıcı ataması varsa silinmez (ders olmasa bile)."""
    from tests.helpers import sub_headers
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Atamalı", "code": _u("DM")}, headers=h).json()
    sub_headers(department_ids=[dep["id"]])          # bölüme bir kullanıcı ata

    r = client.delete(f"/departments/{dep['id']}", headers=h)
    assert r.status_code == 409
    assert "kullanıcı ataması" in r.json()["detail"]


def test_delete_isolation_foreign_admin():
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Bizim", "code": _u("DI")}, headers=h).json()
    assert client.delete(f"/departments/{dep['id']}", headers=foreign_admin_headers()).status_code == 404


def test_delete_forbidden_for_sub_account():
    from tests.helpers import sub_headers
    h = admin_headers()
    dep = client.post("/departments", json={"name": "Korunan", "code": _u("DF")}, headers=h).json()
    assert client.delete(f"/departments/{dep['id']}", headers=sub_headers()).status_code == 403