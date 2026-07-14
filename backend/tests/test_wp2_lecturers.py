"""WP2 CRUD testleri — hocalar (normalize + autocomplete)."""

import uuid

from app.normalize import normalize_lecturer_name
from tests.helpers import client, admin_headers, foreign_admin_headers


def _uname(base: str) -> str:
    """Benzersiz hoca adı — soyad kısmına hex ek."""
    return f"{base} {uuid.uuid4().hex[:6].upper()}"


# --- normalize birim testleri (DB'siz, saf fonksiyon) ---

def test_normalize_strips_titles():
    assert normalize_lecturer_name("Doç. Dr. Ayşe Kaya") == "ayşe kaya"

def test_normalize_turkish_upper_i():
    assert normalize_lecturer_name("İsmail YILDIRIM") == "ismail yıldırım"

def test_normalize_collapses_spaces():
    assert normalize_lecturer_name("  Prof.Dr.   Ali   Veli ") == "ali veli"


# --- API testleri ---

def test_create_lecturer():
    h = admin_headers()
    name = _uname("Dr. Deneme Hoca")
    r = client.post("/lecturers", json={"full_name": name}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["is_external"] is False

def test_duplicate_by_normalized_name():
    """Farklı unvan yazımı aynı kişiyse 409 — K-08'in asıl amacı."""
    h = admin_headers()
    name = _uname("Ayşe Kaya")
    assert client.post("/lecturers", json={"full_name": f"Doç. Dr. {name}"}, headers=h).status_code == 201
    r = client.post("/lecturers", json={"full_name": name}, headers=h)   # unvansız hali
    assert r.status_code == 409
    assert "zaten kayıtlı" in r.json()["detail"]

def test_title_only_name_rejected():
    h = admin_headers()
    assert client.post("/lecturers", json={"full_name": "Prof. Dr."}, headers=h).status_code == 400

def test_search_ignores_title():
    h = admin_headers()
    name = _uname("Mehmet Demir")
    client.post("/lecturers", json={"full_name": f"Prof. Dr. {name}"}, headers=h)
    parca = name.split()[-1].lower()          # benzersiz hex soyadıyla ara
    r = client.get(f"/lecturers?search={parca}", headers=h)
    assert r.status_code == 200
    assert any(name in l["full_name"] for l in r.json())

def test_create_requires_admin_auth():
    assert client.post("/lecturers", json={"full_name": "X Y"}).status_code == 401

def test_isolation_foreign_admin_sees_nothing():
    h = admin_headers()
    name = _uname("Gizli Hoca")
    client.post("/lecturers", json={"full_name": name}, headers=h)
    r = client.get("/lecturers", headers=foreign_admin_headers())
    assert all(name not in l["full_name"] for l in r.json())


# --- PATCH: düzenleme + pasife alma ---

def test_patch_rename_lecturer():
    h = admin_headers()
    lec = client.post("/lecturers", json={"full_name": _uname("Eski Ad")}, headers=h).json()
    yeni = _uname("Yeni Ad")
    r = client.patch(f"/lecturers/{lec['id']}", json={"full_name": f"Prof. Dr. {yeni}"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == f"Prof. Dr. {yeni}"

def test_patch_deactivate_hides_from_autocomplete():
    """Pasife alınan hoca autocomplete listesinde görünmemeli."""
    h = admin_headers()
    name = _uname("Emekli Hoca")
    lec = client.post("/lecturers", json={"full_name": name}, headers=h).json()
    parca = name.split()[-1].lower()

    # önce görünüyor
    assert any(name in l["full_name"] for l in client.get(f"/lecturers?search={parca}", headers=h).json())
    # pasife al
    assert client.patch(f"/lecturers/{lec['id']}", json={"active": False}, headers=h).status_code == 200
    # artık görünmüyor
    assert all(name not in l["full_name"] for l in client.get(f"/lecturers?search={parca}", headers=h).json())

def test_patch_rename_into_existing_conflicts():
    """Yeni ad başka bir hocanın normalized_name'iyle çakışırsa 409."""
    h = admin_headers()
    hedef = _uname("Ahmet Yılmaz")
    client.post("/lecturers", json={"full_name": f"Doç. Dr. {hedef}"}, headers=h)   # mevcut hoca
    digeri = client.post("/lecturers", json={"full_name": _uname("Başka Hoca")}, headers=h).json()

    r = client.patch(f"/lecturers/{digeri['id']}", json={"full_name": hedef}, headers=h)   # onun adına çek
    assert r.status_code == 409

def test_patch_lecturer_isolation():
    h = admin_headers()
    lec = client.post("/lecturers", json={"full_name": _uname("Bizim Hoca")}, headers=h).json()
    r = client.patch(f"/lecturers/{lec['id']}", json={"active": False}, headers=foreign_admin_headers())
    assert r.status_code == 404      # yabancı admin ne görebilir ne dokunabilir