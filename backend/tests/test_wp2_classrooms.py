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

# --- fakülte dışı bina (K-30) + silme (K-29) ---

def test_building_is_external_flag():
    h = admin_headers()
    ic = client.post("/buildings", json={"name": _u("Ic-")}, headers=h).json()
    dis = client.post("/buildings", json={"name": _u("Dis-"), "is_external": True}, headers=h).json()
    assert ic["is_external"] is False          # varsayılan
    assert dis["is_external"] is True

    # derslik cevabındaki gömülü bina da bayrağı taşımalı (tabloda rozet için)
    oda = client.post("/classrooms", json={
        "building_id": dis["id"], "room_code": _u("D"), "capacity": 50,
    }, headers=h).json()
    assert oda["building"]["is_external"] is True


def test_delete_unlinked_classroom_and_building():
    h = admin_headers()
    bina = make_building(h)
    oda = client.post("/classrooms", json={
        "building_id": bina["id"], "room_code": _u("S"), "capacity": 40,
    }, headers=h).json()

    # dersliği olan bina silinemez
    r = client.delete(f"/buildings/{bina['id']}", headers=h)
    assert r.status_code == 409
    assert "derslik" in r.json()["detail"]

    # bağlantısız derslik silinir, sonra bina da silinir
    assert client.delete(f"/classrooms/{oda['id']}", headers=h).status_code == 204
    assert client.delete(f"/buildings/{bina['id']}", headers=h).status_code == 204


def test_delete_classroom_blocked_by_default_section():
    """default_classroom_id SET NULL olsa da engel sayılır (K-29)."""
    h = admin_headers()
    bina = make_building(h)
    oda = client.post("/classrooms", json={
        "building_id": bina["id"], "room_code": _u("V"), "capacity": 60,
    }, headers=h).json()
    lec = client.post("/lecturers", json={"full_name": f"Dr. Derslik {_u('L')}"}, headers=h).json()
    dep = client.post("/departments", json={"name": "Derslik Testi", "code": _u("DT")}, headers=h).json()
    course = client.post("/courses", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "code": _u("DK"), "name": "Varsayilan Derslikli",
    }, headers=h).json()
    client.post(f"/courses/{course['id']}/sections", json={
        "section_no": 1, "lecturer_id": lec["id"], "expected_students": 30,
        "default_classroom_id": oda["id"],
    }, headers=h)

    r = client.delete(f"/classrooms/{oda['id']}", headers=h)
    assert r.status_code == 409
    assert "varsayılan" in r.json()["detail"]


def test_delete_classroom_isolation_and_permission():
    h = admin_headers()
    bina = make_building(h)
    oda = client.post("/classrooms", json={
        "building_id": bina["id"], "room_code": _u("K"), "capacity": 20,
    }, headers=h).json()
    # yabancı workgroup varlığı bile görmemeli
    assert client.delete(f"/classrooms/{oda['id']}", headers=foreign_admin_headers()).status_code == 404
    # can_manage_classrooms kapalı alt hesap
    assert client.delete(f"/classrooms/{oda['id']}", headers=sub_headers()).status_code == 403


# --- derslik tipi (K-31) ---

def test_room_type_default_and_set():
    h = admin_headers()
    b = make_building(h)
    varsayilan = client.post("/classrooms", json={
        "building_id": b["id"], "room_code": _u("T"), "capacity": 40,
    }, headers=h).json()
    assert varsayilan["room_type"] == "CLASSROOM"      # varsayılan

    amfi = client.post("/classrooms", json={
        "building_id": b["id"], "room_code": _u("A"), "capacity": 200,
        "room_type": "AMPHI",
    }, headers=h).json()
    assert amfi["room_type"] == "AMPHI"

    # PATCH ile tip değiştirilebilir
    r = client.patch(f"/classrooms/{varsayilan['id']}", json={"room_type": "LAB"}, headers=h)
    assert r.status_code == 200
    assert r.json()["room_type"] == "LAB"


def test_room_type_invalid_rejected():
    """Enum dışı değer Pydantic'te 422 — serbest metin kabul edilmez (K-31)."""
    h = admin_headers()
    b = make_building(h)
    r = client.post("/classrooms", json={
        "building_id": b["id"], "room_code": _u("X"), "capacity": 30,
        "room_type": "amfi",        # küçük harf: geçersiz
    }, headers=h)
    assert r.status_code == 422
