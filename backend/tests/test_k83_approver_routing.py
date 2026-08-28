"""K-83 onay talebinin ADRESLENMESI — kime gonderildiyse yalniz o gorur.

K-83 oncesi onaya gonderilen taslak, o bolumde onay yetkisi olan HERKESIN
(ve her adminin) kuyruguna dusuyordu. Artik gonderen alicilari secer.

Kanitlanan kararlar:
  - Aday havuzu = taslagin bolumundeki yetkililer + TUM adminler; gonderenin
    kendisi ve baska bolumun yetkilisi havuzda YOKTUR.
  - Secilen gorur, secilmeyen GORMEZ — admin dahil.
  - Havuz disindan alici secilemez (403); bos liste sema tarafindan reddedilir.
  - Secim yapilmazsa havuzun tamami adreslenir (K-83 oncesi davranis).
  - Geri cekmek adreslemeyi sifirlar; yeniden gonderim yeni adresi yazar.
  - Uyeligi sonradan alinan yetkili, adreslenmis olsa bile kuyrugu goremez
    (K-25'in bolum boyutu adreslemenin uzerinde canli kalir).
"""

from app.db import SessionLocal
from app.models import (
    DepartmentMembership, User, UserRole, UserStatus,
)
from app.security import hash_password
from tests.helpers import _u, admin_headers, client
from tests.test_k59_draft_api import base_setup, create_draft, publish_entry


# ------------------------------------------------------------------
# Yardimcilar
# ------------------------------------------------------------------

def account(name, department_ids, **flags):
    """Alt hesap yaratir; (header, id) doner.

    K-59'un `make_account`indan farki: ADI ve KIMLIGI geri veriyor — bu
    dosyanin butun testleri "kim adreslendi" sorusunu soruyor, dolayisiyla
    hesabi sonradan tanimak zorundayiz.
    """
    email = f"k83_{_u('')}@muh.example.edu.tr"
    pw = "k83test12345"
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.email == "admin@muh.example.edu.tr").one()
        u = User(
            workgroup_id=admin.workgroup_id, name=name, email=email,
            password_hash=hash_password(pw), role=UserRole.SUB_ACCOUNT,
            status=UserStatus.ACTIVE, **flags,
        )
        db.add(u)
        db.flush()
        for dep_id in department_ids:
            db.add(DepartmentMembership(user_id=u.id, department_id=dep_id))
        db.commit()
        uid = u.id
    finally:
        db.close()
    r = client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, uid


def moved_draft(h, dep, day=3, slot=5):
    """Bir yerlesimi tasinmis ama HENUZ GONDERILMEMIS taslak."""
    draft = create_draft(h, dep["id"])
    kopya = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=h).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{kopya['id']}",
                 json={"day_of_week": day, "start_slot": slot}, headers=h)
    return draft


def kuyruk_idleri(h):
    r = client.get("/schedule-approvals", headers=h)
    assert r.status_code == 200, r.text
    return {d["id"] for d in r.json()}


def me_id(h):
    return client.get("/auth/me", headers=h).json()["id"]


# ------------------------------------------------------------------
# Aday havuzu
# ------------------------------------------------------------------

def test_candidates_are_department_approvers_plus_admins():
    """Havuz: bolumun yetkilileri + adminler. Gonderen ve yabanci bolum yok."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    baska = client.post("/departments", json={"name": "Başka", "code": _u("BS")},
                        headers=h).json()
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, sahip_id = account("Sahip", [dep["id"]], can_manage_weekly=True,
                              can_approve_schedule=True)
    _, ic_id = account("İçerideki", [dep["id"]], can_approve_schedule=True)
    _, disari_id = account("Dışarıdaki", [baska["id"]], can_approve_schedule=True)
    # Yetkisiz uye: ayni bolumde ama onay bayragi kapali.
    _, yetkisiz_id = account("Yetkisiz", [dep["id"]], can_manage_weekly=True)

    draft = moved_draft(sahip, dep)
    r = client.get(f"/schedule-drafts/{draft['id']}/approver-candidates",
                   headers=sahip)
    assert r.status_code == 200, r.text
    idler = {c["id"] for c in r.json()}

    assert ic_id in idler                      # bolumun yetkilisi
    assert me_id(admin_headers()) in idler     # admin her bolumde yetkili
    assert disari_id not in idler              # baska bolumun yetkilisi
    assert yetkisiz_id not in idler            # bayragi kapali
    assert sahip_id not in idler               # oz-onay yasak (K-59)

    # `is_admin` rozeti: admin'in listede NEDEN oldugunu anlatan tek isaret.
    assert next(c for c in r.json() if c["is_admin"])["is_admin"] is True


def test_candidates_need_submit_right():
    """Gonderemeyecek biri adres listesini de cekemez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    # Taslak ACMAK serbesttir (kum havuzu), GONDERMEK yetki ister (K-59). Bu
    # hesabin sinav bayragi kapali; sinav taslagini gonderemez, dolayisiyla
    # adres listesini de goremez.
    sahip, _ = account("Yalnız Haftalık", [dep["id"]], can_manage_weekly=True)
    exam = client.post("/schedule-drafts", json={
        "department_id": dep["id"], "year": 1, "semester": "FALL",
        "kind": "EXAM", "name": "Sınav taslağı",
    }, headers=sahip)
    assert exam.status_code == 201, exam.text

    r = client.get(f"/schedule-drafts/{exam.json()['id']}/approver-candidates",
                   headers=sahip)
    assert r.status_code == 403, r.text


# ------------------------------------------------------------------
# Adresleme kuyrugu belirler
# ------------------------------------------------------------------

def test_only_selected_approvers_see_the_request():
    """Secilen gorur, secilmeyen gormez — ADMIN dahil."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    secilen, secilen_id = account("Seçilen", [dep["id"]], can_approve_schedule=True)
    secilmeyen, _ = account("Seçilmeyen", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "yalnız sana", "approver_ids": [secilen_id]},
                    headers=sahip)
    assert r.status_code == 200, r.text
    assert [a["id"] for a in r.json()["draft"]["approvers"]] == [secilen_id]

    assert draft["id"] in kuyruk_idleri(secilen)
    assert draft["id"] not in kuyruk_idleri(secilmeyen)
    # Admin de muaf DEGIL: adres listesinde yoksa talebi gormez.
    assert draft["id"] not in kuyruk_idleri(h)

    # Gormeyen inceleyemez ve onaylayamaz — 404 (varlik sizdirilmez).
    assert client.get(f"/schedule-approvals/{draft['id']}",
                      headers=secilmeyen).status_code == 404
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=h).status_code == 404
    # Secilen onaylayabilir.
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=secilen).status_code == 200


def test_owner_still_sees_own_pending_request():
    """Gonderen kendi talebini kuyrukta gorur ama alicisi degildir."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True,
                       can_approve_schedule=True)
    _, hedef_id = account("Hedef", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"approver_ids": [hedef_id]}, headers=sahip)
    assert [a["id"] for a in r.json()["draft"]["approvers"]] == [hedef_id]

    # Kuyrukta gorunur — bekledigini bilmeli.
    assert draft["id"] in kuyruk_idleri(sahip)
    # Ama gormek onaylamak degil: oz-onay yasagi yerinde (K-59).
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=sahip).status_code == 403


def test_selecting_someone_outside_the_pool_is_refused():
    """Havuz disindan alici yazilamaz — istemci listesine guvenilmez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    baska = client.post("/departments", json={"name": "Başka", "code": _u("BS")},
                        headers=h).json()
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    _, yabanci_id = account("Yabancı", [baska["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"approver_ids": [yabanci_id]}, headers=sahip)
    assert r.status_code == 403, r.text

    # Talep OLUSMADI: taslak hala duzenlenebilir durumda.
    assert client.get(f"/schedule-drafts/{draft['id']}",
                      headers=sahip).json()["status"] == "OPEN"


def test_empty_selection_is_rejected_by_schema():
    """Bos liste = hicbir yere gitmeyen talep; sema (min_length=1) reddeder."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    account("Yetkili", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"approver_ids": []}, headers=sahip)
    assert r.status_code == 422, r.text


def test_omitting_selection_addresses_the_whole_pool():
    """Secim yapilmazsa havuzun tamami adreslenir (K-83 oncesi davranis)."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    a, a_id = account("Yetkili A", [dep["id"]], can_approve_schedule=True)
    b, b_id = account("Yetkili B", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    r = client.post(f"/schedule-drafts/{draft['id']}/submit", json={},
                    headers=sahip)
    assert r.status_code == 200, r.text
    adresler = {x["id"] for x in r.json()["draft"]["approvers"]}
    assert {a_id, b_id} <= adresler
    assert draft["id"] in kuyruk_idleri(a)
    assert draft["id"] in kuyruk_idleri(b)
    assert draft["id"] in kuyruk_idleri(h)          # admin de havuzdaydi


# ------------------------------------------------------------------
# Adresleme gonderime aittir
# ------------------------------------------------------------------

def test_withdraw_clears_addressing_and_resubmit_rewrites_it():
    """Geri cekilen talep kimseye gitmiyordur; yeniden gonderim yeni adresi yazar."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    ilk, ilk_id = account("İlk Adres", [dep["id"]], can_approve_schedule=True)
    yeni, yeni_id = account("Yeni Adres", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"approver_ids": [ilk_id]}, headers=sahip)
    assert draft["id"] in kuyruk_idleri(ilk)

    r = client.post(f"/schedule-drafts/{draft['id']}/withdraw", headers=sahip)
    assert r.status_code == 200, r.text
    assert r.json()["approvers"] == []
    assert draft["id"] not in kuyruk_idleri(ilk)

    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"approver_ids": [yeni_id]}, headers=sahip)
    assert draft["id"] in kuyruk_idleri(yeni)
    assert draft["id"] not in kuyruk_idleri(ilk)    # eski adres uzerinde kalmadi


def test_membership_still_gates_an_addressed_approver():
    """Adres, K-25'in bolum boyutunu EZMEZ: uyeligi alinan yetkili goremez."""
    h = admin_headers()
    dep, _, cls, _, sec = base_setup(h)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    sahip, _ = account("Sahip", [dep["id"]], can_manage_weekly=True)
    hedef, hedef_id = account("Hedef", [dep["id"]], can_approve_schedule=True)

    draft = moved_draft(sahip, dep)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"approver_ids": [hedef_id]}, headers=sahip)
    assert draft["id"] in kuyruk_idleri(hedef)

    # Uyelik geri alinir — adres satiri yerinde kalir ama kapi kapanir.
    db = SessionLocal()
    try:
        db.query(DepartmentMembership).filter(
            DepartmentMembership.user_id == hedef_id).delete()
        db.commit()
    finally:
        db.close()

    assert draft["id"] not in kuyruk_idleri(hedef)
