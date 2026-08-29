"""K-78 · Yetki matrisi — her ayrıcalıklı ucun sunucu-taraflı denetiminin
TEK YERDE, sistematik regresyonu (brief §6.3/§10.2, yol haritası A-5).

Bu dosyanın varlık nedeni, dağınık olarak zaten kanıtlanmış olanı bir TABLOYA
indirmek: özellik testleri (wp2/wp3/wp4/k59/k60) yetkiyi kendi bağlamında
denetliyor, ama "hangi rol hangi ucu açar" sorusunun tek bir cevabı yoktu.
Buradaki değer iki katlı:
  1. İleride biri BEKÇİSİZ bir yazma ucu eklerse, aşağıdaki süpürme onu yakalar
     (uç listesi elle tutuluyor; yeni uç eklenince buraya da eklenmeli — eklenmezse
     401/403 süpürmesi o ucu görmez, ama en azından liste tek yerde durur).
  2. Beş saldırı sınıfı her uçta TEK BİÇİMDE iddia edilir, ad-hoc değil.

Denetlenen beş sınıf (mimarinin katmanları, dıştan içe):
  A. Kimliksiz istek           -> 401  (get_current_user bağımlılığı)
  B. Yanlış rol / bayrak yok   -> 403  (require_admin / require_* bağımlılığı)
  C. Bayrak var, bölüm değil   -> 403 (ders) | 404 (onay)  (gövdedeki üyelik denetimi)
  D. Yabancı workgroup + id     -> 404  (izolasyon; varlık sızdırmama, IDOR)
  E. Taslak yaşam döngüsü      -> öz-onay 403 | PENDING'e yazma 409 | başkasının 404

A/B için sahte id kullanılır: yetki BAĞIMLILIK katmanında, id çözülmeden önce
patlar (401/403 gövdeye hiç girmez). C/D/E gerçek kaynak ister.
"""

import pytest

from tests.helpers import (
    admin_headers, foreign_admin_headers, sub_headers, client, _u,
)
from tests.test_k59_draft_api import (
    base_setup, make_course, make_section, create_draft, publish_entry,
    make_department, make_lecturer, make_classroom,
)


def _call(method: str, path: str, headers: dict):
    """Tek giriş: gövde her zaman {} — bağımlılık patladığında gövde okunmaz."""
    return client.request(method, path, headers=headers, json={})


# ==================================================================
# Uç envanteri (yol, yöntem) — bağımlılık katmanında denetlenenler.
# Sahte id (1) yeterli: 401/403 id çözülmeden önce döner.
# ==================================================================

# Yalnız ADMIN — hiçbir alt hesap bayrağı açmaz.
ADMIN_ONLY = [
    ("POST", "/departments"),
    ("PATCH", "/departments/1"),
    ("DELETE", "/departments/1"),
    ("POST", "/users/invite"),
    ("POST", "/users/1/resend-invitation"),
    ("GET", "/users"),
    ("PATCH", "/users/1"),
    ("DELETE", "/users/1"),
    ("GET", "/audit-logs"),
]

# K-82: OTURUMU OLAN HERKESE açık okuma uçları. Ayrıcalıklı değiller ama
# kimliksiz de değiller — matrisin A sınıfı (401) burada da geçerli, B sınıfı
# (403) bilerek geçerli DEĞİL. Listeyi tutmanın sebebi: bir gün biri bu
# uçlardan birine yanlışlıkla require_admin koyarsa ya da tersine kimlik
# kapısını düşürürse, aşağıdaki iki süpürme onu yakalasın.
OPEN_TO_AUTHENTICATED = [
    ("GET", "/dashboard/summary"),      # kullanıcı sayaçları admin dışında None
    ("GET", "/dashboard/occupancy"),
    ("GET", "/audit-logs/mine"),        # kapsam her zaman current_user
]

# Bayrak kapısı: (uç listesi, o ucu açan bayrak).
COURSE_ENDPOINTS = [
    ("POST", "/courses"),
    ("PATCH", "/courses/1"),
    ("DELETE", "/courses/1"),
    ("POST", "/courses/1/sections"),
    ("PATCH", "/course-sections/1"),
    ("DELETE", "/course-sections/1"),
    ("POST", "/import/courses/preview"),
    ("POST", "/import/courses"),
]
CLASSROOM_ENDPOINTS = [
    ("POST", "/buildings"),
    ("PATCH", "/buildings/1"),
    ("DELETE", "/buildings/1"),
    ("POST", "/classrooms"),
    ("PATCH", "/classrooms/1"),
    ("DELETE", "/classrooms/1"),
]
LECTURER_ENDPOINTS = [
    ("POST", "/lecturers"),
    ("PATCH", "/lecturers/1"),
    ("DELETE", "/lecturers/1"),
    ("POST", "/lecturers/import/preview"),
    ("POST", "/lecturers/import/commit"),
]
APPROVER_ENDPOINTS = [
    ("GET", "/schedule-approvals/1"),
    ("POST", "/schedule-approvals/1/approve"),
    ("POST", "/schedule-approvals/1/reject"),
]

# submit türe göre bayrak ister (haftalık/sınav) — bağımlılık değil, gövdede;
# bu yüzden bağımlılık süpürmesine değil, C sınıfına (gerçek kaynak) girer.
ALL_PRIVILEGED = (
    ADMIN_ONLY + COURSE_ENDPOINTS + CLASSROOM_ENDPOINTS
    + LECTURER_ENDPOINTS + APPROVER_ENDPOINTS
    + [("POST", "/schedule-drafts/1/submit")]
)


# ------------------------------------------------------------------
# A · Kimliksiz istek -> 401 (her ayrıcalıklı uç)
# ------------------------------------------------------------------

@pytest.mark.parametrize("method,path", ALL_PRIVILEGED)
def test_unauthenticated_is_401(method, path):
    """Token yoksa hiçbir ayrıcalıklı uca girilemez — gövde hiç çalışmaz."""
    r = _call(method, path, headers={})
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


# ------------------------------------------------------------------
# B · Yanlış rol / bayrak yok -> 403
# ------------------------------------------------------------------

@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_admin_only_rejects_subaccount(method, path):
    """ADMIN-only uç: TÜM bayrakları açık bir alt hesap bile giremez (rol kapısı)."""
    h = sub_headers(
        can_manage_courses=True, can_manage_classrooms=True,
        can_manage_lecturers=True, can_manage_weekly=True,
        can_manage_exams=True, can_approve_schedule=True,
    )
    r = _call(method, path, headers=h)
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", COURSE_ENDPOINTS)
def test_course_endpoints_need_flag(method, path):
    r = _call(method, path, headers=sub_headers())          # bayraksız alt hesap
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", CLASSROOM_ENDPOINTS)
def test_classroom_endpoints_need_flag(method, path):
    r = _call(method, path, headers=sub_headers())
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", LECTURER_ENDPOINTS)
def test_lecturer_endpoints_need_flag(method, path):
    r = _call(method, path, headers=sub_headers())
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", APPROVER_ENDPOINTS)
def test_approval_endpoints_need_flag(method, path):
    r = _call(method, path, headers=sub_headers())
    assert r.status_code == 403, f"{method} {path} -> {r.status_code}"


# ------------------------------------------------------------------
# C · Bayrak VAR ama bölüm üyeliği YOK
#     ders yazma -> 403 · onaya gönderme -> 403 · onaylama -> 404
# ------------------------------------------------------------------

def test_course_write_needs_department_membership():
    """can_manage_courses açık ama dersin bölümüne üye değil -> 403.

    Bayrak "ders yönetebilirim" der; hangi bölümün dersi olduğu ayrı kapı
    (_ensure_course_access, K-25 iki boyut / K-49).
    """
    admin = admin_headers()
    dep_a = make_department(admin)
    course = make_course(admin, dep_a["id"])

    dep_b = make_department(admin)                # üye olacağı BAŞKA bölüm
    outsider = sub_headers(can_manage_courses=True, department_ids=[dep_b["id"]])

    r = client.patch(f"/courses/{course['id']}",
                     json={"name": "ele geçirme"}, headers=outsider)
    assert r.status_code == 403
    # DELETE de aynı kapıdan geçer
    assert client.delete(f"/courses/{course['id']}", headers=outsider).status_code == 403


def test_submit_needs_membership_of_the_drafts_department():
    """Taslak açmak serbest; ONAYA GÖNDERMEK bölüm üyeliği ister (_ensure_can_submit).

    Bayrak (can_manage_weekly) açık ama başka bölümün üyesi -> submit 403,
    taslağın kendisi (açma/düzenleme) engellenmez.
    """
    admin = admin_headers()
    dep_a, _lec, cls, _course, sec = base_setup(admin)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    dep_b = make_department(admin)
    outsider = sub_headers(can_manage_weekly=True, department_ids=[dep_b["id"]])

    draft = create_draft(outsider, dep_a["id"])          # açmak serbest
    row = client.get(f"/schedule-drafts/{draft['id']}/entries",
                     headers=outsider).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=outsider)

    r = client.post(f"/schedule-drafts/{draft['id']}/submit",
                    json={"note": "yetkisiz gönderim"}, headers=outsider)
    assert r.status_code == 403


def test_approver_outside_department_scope_gets_404():
    """Onay bayrağı VAR ama PENDING taslağın bölümüne üye değil -> 404.

    404 (403 değil): kapsam dışı özel bir taslağın VARLIĞI onay yetkisiyle bile
    sızdırılmaz (K-59). Onay/ret/inceleme üçü de aynı _get_reviewable'dan geçer.
    """
    admin = admin_headers()
    dep_a, _lec, cls, _course, sec = base_setup(admin)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)

    # dep_a'da PENDING bir taslak (admin sahibi)
    draft = create_draft(admin, dep_a["id"])
    row = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=admin).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=admin)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"note": "onaya"}, headers=admin)

    dep_b = make_department(admin)
    approver_b = sub_headers(can_approve_schedule=True, department_ids=[dep_b["id"]])

    assert client.get(f"/schedule-approvals/{draft['id']}",
                      headers=approver_b).status_code == 404
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=approver_b).status_code == 404
    assert client.post(f"/schedule-approvals/{draft['id']}/reject",
                       json={"note": "x"}, headers=approver_b).status_code == 404
    # kuyruğunda da görünmez
    q = client.get("/schedule-approvals", headers=approver_b).json()
    assert draft["id"] not in [d["id"] for d in q]


# ------------------------------------------------------------------
# D · Yabancı workgroup admini + gerçek id -> 404 (IDOR / URL id değiştirme)
# ------------------------------------------------------------------

def test_foreign_workgroup_admin_cannot_touch_our_resources():
    """Başka workgroup'un ADMIN'i (kendi workgroup'unda tam yetkili) bizim
    kaynaklarımıza id ile ulaşamaz: hepsi 404 — varlık bile sızmaz (K-04).

    require_admin bağımlılığı GEÇER (o gerçekten admin); izolasyon gövdedeki
    workgroup süzgecinde durur.
    """
    admin = admin_headers()
    dep, lec, cls, course, sec = base_setup(admin)
    bld_id = cls["building"]["id"]
    intruder = foreign_admin_headers()

    idor = [
        ("PATCH", f"/departments/{dep['id']}"),
        ("DELETE", f"/departments/{dep['id']}"),
        ("PATCH", f"/courses/{course['id']}"),
        ("DELETE", f"/courses/{course['id']}"),
        ("PATCH", f"/course-sections/{sec['id']}"),
        ("DELETE", f"/course-sections/{sec['id']}"),
        ("PATCH", f"/lecturers/{lec['id']}"),
        ("DELETE", f"/lecturers/{lec['id']}"),
        ("PATCH", f"/classrooms/{cls['id']}"),
        ("DELETE", f"/classrooms/{cls['id']}"),
        ("PATCH", f"/buildings/{bld_id}"),
        ("DELETE", f"/buildings/{bld_id}"),
    ]
    for method, path in idor:
        r = _call(method, path, headers=intruder)
        assert r.status_code == 404, f"{method} {path} -> {r.status_code} (sızıntı!)"


def test_foreign_workgroup_admin_cannot_touch_our_user():
    """Kullanıcı yönetimi de izole: yabancı admin bizim kullanıcımızı göremez."""
    admin = admin_headers()
    me = client.get("/users", headers=admin).json()
    my_id = me[0]["id"]
    intruder = foreign_admin_headers()

    assert client.patch(f"/users/{my_id}", json={"name": "x"},
                        headers=intruder).status_code == 404
    assert client.delete(f"/users/{my_id}", headers=intruder).status_code == 404


def test_foreign_workgroup_cannot_reach_our_draft_or_approval():
    """Taslak sahibine özel + onay workgroup'a bağlı: yabancı admin ikisinde de 404."""
    admin = admin_headers()
    dep, _lec, cls, _course, sec = base_setup(admin)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(admin, dep["id"])
    row = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=admin).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=admin)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"note": "onaya"}, headers=admin)

    intruder = foreign_admin_headers()
    assert client.get(f"/schedule-drafts/{draft['id']}",
                      headers=intruder).status_code == 404
    assert client.post(f"/schedule-drafts/{draft['id']}/submit",
                       json={"note": "x"}, headers=intruder).status_code == 404
    assert client.get(f"/schedule-approvals/{draft['id']}",
                      headers=intruder).status_code == 404
    assert client.post(f"/schedule-approvals/{draft['id']}/approve",
                       headers=intruder).status_code == 404


# ------------------------------------------------------------------
# E · Taslak yaşam döngüsü kapıları
# ------------------------------------------------------------------

def test_self_approval_is_forbidden_even_for_admin():
    """Öz-onay yasak, ADMIN dahil: hazırlayan onaylayamaz (K-59)."""
    admin = admin_headers()
    dep, _lec, cls, _course, sec = base_setup(admin)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(admin, dep["id"])
    row = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=admin).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=admin)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"note": "onaya"}, headers=admin)

    r = client.post(f"/schedule-approvals/{draft['id']}/approve", headers=admin)
    assert r.status_code == 403
    assert "Kendi talebinizi" in r.json()["detail"]


def test_pending_draft_is_write_locked():
    """Onaya gönderilmiş (PENDING) taslak DONAR: satır yazma/düzenleme 409.

    Düzenlemek için önce geri çekilmeli — onay kuyruğundaki bir talebin altından
    içeriğin değişmesi engellenir.
    """
    admin = admin_headers()
    dep, _lec, cls, _course, sec = base_setup(admin)
    publish_entry(sec["id"], cls["id"], day=1, slot=1)
    draft = create_draft(admin, dep["id"])
    row = client.get(f"/schedule-drafts/{draft['id']}/entries", headers=admin).json()[0]
    client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                 json={"day_of_week": 3, "start_slot": 5}, headers=admin)
    client.post(f"/schedule-drafts/{draft['id']}/submit",
                json={"note": "onaya"}, headers=admin)

    # PENDING'ken düzenleme denemeleri
    assert client.patch(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                        json={"start_slot": 7}, headers=admin).status_code == 409
    assert client.delete(f"/schedule-drafts/{draft['id']}/entries/{row['id']}",
                         headers=admin).status_code == 409
    assert client.post(f"/schedule-drafts/{draft['id']}/clear",
                       json={"include_shared": False},
                       headers=admin).status_code == 409


def test_another_users_draft_is_invisible():
    """Taslak sahibine özeldir: başka bir alt hesap onu göremez -> 404 (403 değil)."""
    admin = admin_headers()
    dep, _lec, cls, _course, _sec = base_setup(admin)
    draft = create_draft(admin, dep["id"])

    other = sub_headers()                               # aynı workgroup, başka kişi
    assert client.get(f"/schedule-drafts/{draft['id']}",
                      headers=other).status_code == 404
    assert client.get(f"/schedule-drafts/{draft['id']}/entries",
                      headers=other).status_code == 404
    assert client.delete(f"/schedule-drafts/{draft['id']}",
                         headers=other).status_code == 404


# ------------------------------------------------------------------
# A/B eki · Herkese açık okuma uçları (K-82)
# ------------------------------------------------------------------

@pytest.mark.parametrize("method,path", OPEN_TO_AUTHENTICATED)
def test_open_read_endpoints_still_need_identity(method, path):
    """Açık demek KİMLİKSİZ demek değil: token yoksa yine 401."""
    r = _call(method, path, headers={})
    assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


@pytest.mark.parametrize("method,path", OPEN_TO_AUTHENTICATED)
def test_open_read_endpoints_accept_flagless_subaccount(method, path):
    """Hiçbir bayrağı ve bölüm üyeliği olmayan alt hesap bile okuyabilmeli.

    Ana sayfa bu üç ucun üstünde duruyor; biri 403 dönerse en dar yetkili
    kullanıcının ana sayfası boş kalır.
    """
    r = _call(method, path, headers=sub_headers())
    assert r.status_code == 200, f"{method} {path} -> {r.status_code}"
