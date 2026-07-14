"""WP2 CRUD testleri — binalar + derslikler (K-02 yetki, K-17 kontenjan)."""

from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u


def make_building(h, name=None):
    r = client.post("/buildings", json={"name": name or _u("Bina-")}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


# --- binalar ---

def test_building_create_and_duplicate():
    h = admin_headers()
    name = _u("Muh-")
    assert client.post("/buildings", json={"name": name}, headers=h).status_code == 201
    assert client.post("/buildings", json={"name": name}, headers=h).status_code == 409


def test_building_rename():
    h = admin_headers()
    bld = make_building(h)
    r = client.patch(f"/buildings/{bld['id']}", json={"name": _u("Yeni-")}, headers=h)
    assert r.status_code == 200


# --- derslikler: temel akış ---

def test_classroom_create_with_nested_building():
    h = admin_headers()
    bld = make_building(h)
    r = client.post("/classrooms", json={
        "building_id": bld["id"], "room_code": _u("B-"),
        "capacity": 90, "exam_capacity": 40,
    }, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["building"]["name"] == bld["name"]     # iç içe cevap


def test_classroom_duplicate_room_in_building():
    h = admin_headers()
    bld = make_building(h)
    room = _u("C-")
    body = {"building_id": bld["id"], "room_code": room, "capacity": 50, "exam_capacity": 25}
    assert client.post("/classrooms", json=body, headers=h).status_code == 201
    assert client.post("/classrooms", json=body, headers=h).status_code == 409


# --- K-17: sınav kontenjanı kuralları ---

def test_exam_capacity_cannot_exceed_capacity_on_create():
    h = admin_headers()
    bld = make_building(h)
    r = client.post("/classrooms", json={
        "building_id": bld["id"], "room_code": _u("D-"),
        "capacity": 40, "exam_capacity": 41,
    }, headers=h)
    assert r.status_code == 400


def test_patch_cross_field_validation():
    """Kısmi güncelleme çapraz kuralı EFEKTİF değerlerle kontrol etmeli."""
    h = admin_headers()
    bld = make_building(h)
    cls = client.post("/classrooms", json={
        "building_id": bld["id"], "room_code": _u("E-"),
        "capacity": 90, "exam_capacity": 40,
    }, headers=h).json()

    # Sadece exam_capacity gönder: mevcut capacity=90'ı aşıyor -> 400
    assert client.patch(f"/classrooms/{cls['id']}", json={"exam_capacity": 100}, headers=h).status_code == 400
    # Sadece capacity gönder: mevcut exam_capacity=40'ın altına iniyor -> 400
    assert client.patch(f"/classrooms/{cls['id']}", json={"capacity": 30}, headers=h).status_code == 400
    # İkisini birlikte tutarlı gönder -> 200
    assert client.patch(f"/classrooms/{cls['id']}", json={"capacity": 60, "exam_capacity": 55}, headers=h).status_code == 200


# --- K-02: yetki ---

def test_sub_account_without_flag_cannot_write():
    h = sub_headers(can_manage_classrooms=False)
    assert client.post("/buildings", json={"name": _u("X-")}, headers=h).status_code == 403


def test_sub_account_with_flag_can_write():
    h = sub_headers(can_manage_classrooms=True)
    assert client.post("/buildings", json={"name": _u("Y-")}, headers=h).status_code == 201


# --- izolasyon: çapraz-FK ---

def test_cannot_create_classroom_in_foreign_building():
    """Yabancı workgroup'un binasına derslik asılamamalı (FK üzerinden delik)."""
    h_foreign = foreign_admin_headers()
    foreign_bld = make_building(h_foreign)

    h_ours = admin_headers()
    r = client.post("/classrooms", json={
        "building_id": foreign_bld["id"], "room_code": _u("Z-"),
        "capacity": 50, "exam_capacity": 25,
    }, headers=h_ours)
    assert r.status_code == 400


# --- K-21: exam_capacity artık opsiyonel ---

def test_classroom_without_exam_capacity_is_allowed():
    """K-21: exam_capacity girilmeden derslik açılabilir (NULL kalır)."""
    h = admin_headers()
    bld = make_building(h)
    r = client.post("/classrooms", json={
        "building_id": bld["id"], "room_code": _u("N-"),
        "capacity": 50,
    }, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["exam_capacity"] is None