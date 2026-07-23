"""WP6 işlem kayıtları okuma ucu — GET /audit-logs (kontrat §12, K-35).

Yazma tarafı WP2'den beri çalışıyordu (test_wp2_audit.py), burada okunabilir
hale gelmesi test ediliyor: sayfalama, filtreler, etiket çözümü, izolasyon.
"""

import uuid

from app.db import SessionLocal
from app.models import AuditLog
from tests.helpers import client, admin_headers, foreign_admin_headers, sub_headers, _u
from tests.test_wp2_courses import make_department, make_lecturer, make_course


def logs(h, **params) -> dict:
    r = client.get("/audit-logs", params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# --- sözleşme ve sıralama ---

def test_response_shape():
    h = admin_headers()
    make_department(h)                              # en az bir iz bırak
    body = logs(h, limit=5)
    assert isinstance(body["total"], int) and body["total"] > 0
    assert len(body["items"]) <= 5

    satir = body["items"][0]
    for alan in ("id", "created_at", "user", "action", "entity_type",
                 "entity_id", "entity_label"):
        assert alan in satir, f"{alan} eksik"
    assert satir["user"]["name"], "failin adı boş"


def test_newest_first():
    h = admin_headers()
    dep = make_department(h)
    ilk = logs(h, limit=1)["items"][0]
    assert ilk["entity_type"] == "department" and ilk["entity_id"] == dep["id"], \
        "en yeni kayıt en üstte değil"


# --- sayfalama (K-35: log tek büyür, hepsi dönmez) ---

def test_limit_is_respected():
    h = admin_headers()
    assert len(logs(h, limit=3)["items"]) == 3


def test_offset_moves_the_window():
    h = admin_headers()
    ilk_iki = logs(h, limit=2)["items"]
    kaydirilmis = logs(h, limit=2, offset=1)["items"]
    assert ilk_iki[1]["id"] == kaydirilmis[0]["id"], "offset pencereyi kaydırmadı"


def test_total_counts_filter_not_page():
    """total sayfanın değil, FİLTRE kümesinin büyüklüğüdür."""
    h = admin_headers()
    body = logs(h, limit=2)
    assert body["total"] > len(body["items"])


def test_limit_is_capped():
    """Sınırsız limit tabloyu taşırırdı — kontrat en fazla 100 diyor."""
    assert client.get("/audit-logs", params={"limit": 5000},
                      headers=admin_headers()).status_code == 422


# --- filtreler ---

def test_filter_by_entity_type():
    h = admin_headers()
    make_department(h)
    body = logs(h, entity_type="department", limit=20)
    assert body["items"], "sonuç yok"
    assert all(i["entity_type"] == "department" for i in body["items"])


def test_filter_by_action():
    h = admin_headers()
    dep = make_department(h)
    client.patch(f"/departments/{dep['id']}", json={"name": "Yeni Ad"}, headers=h)
    body = logs(h, action="UPDATE", limit=20)
    assert body["items"]
    assert all(i["action"] == "UPDATE" for i in body["items"])


def test_filter_by_user():
    h = admin_headers()
    kimlik = client.get("/auth/me", headers=h).json()["id"]
    body = logs(h, user_id=kimlik, limit=10)
    assert body["items"]
    assert all(i["user"]["id"] == kimlik for i in body["items"])


def test_date_to_includes_the_whole_day():
    """date_to verilen GÜNÜ kapsar, o günün 00:00'ını değil."""
    from datetime import date

    h = admin_headers()
    make_department(h)                              # bugün iz bırakıldı
    bugun = date.today().isoformat()
    assert logs(h, date_to=bugun, limit=5)["total"] > 0, \
        "bugün yazılan kayıt date_to=bugün ile elendi"


# --- etiket çözümü (K-35) ---

def test_label_is_resolved_for_living_record():
    h = admin_headers()
    course = make_course(h, make_department(h))
    body = logs(h, entity_type="course", limit=10)
    satir = next(i for i in body["items"] if i["entity_id"] == course["id"])
    assert satir["entity_label"] == f"{course['code']} — {course['name']}"


def test_label_is_null_for_deleted_record():
    """K-35'in bilinen sınırı: silinen kaydın adı çözülemez, None döner.

    Etiket yazma anında satıra denormalize edilseydi burada ad görünürdü —
    ki DELETE satırı adını en çok merak ettiğimiz satırdır. Test bu sınırı
    BELGELER; davranış değişirse (kolon eklenirse) burası da güncellenmeli.
    """
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert client.delete(f"/courses/{course['id']}", headers=h).status_code == 204

    body = logs(h, entity_type="course", action="DELETE", limit=20)
    satir = next(i for i in body["items"] if i["entity_id"] == course["id"])
    assert satir["entity_label"] is None


def test_labels_cover_every_entity_type():
    """Her tür için etiket üretilebilmeli — biri unutulursa None döner."""
    h = admin_headers()
    dep = make_department(h)
    make_lecturer(h)
    make_course(h, dep)
    bina = client.post("/buildings", json={"name": _u("İzBina-")}, headers=h).json()
    client.post("/classrooms", json={
        "building_id": bina["id"], "room_code": _u("R"), "capacity": 40,
    }, headers=h)

    body = logs(h, limit=100)
    gorulen = {i["entity_type"] for i in body["items"] if i["entity_label"]}
    for tur in ("department", "lecturer", "course", "building", "classroom"):
        assert tur in gorulen, f"{tur} için etiket çözülemedi"


# --- yetki ve izolasyon ---

def test_sub_account_cannot_read_logs():
    """Denetim aracı yalnız ADMIN'in (K-35)."""
    assert client.get("/audit-logs",
                      headers=sub_headers(can_manage_courses=True)).status_code == 403


def test_anonymous_cannot_read_logs():
    assert client.get("/audit-logs").status_code == 401


def test_foreign_workgroup_logs_are_invisible():
    """K-04: izolasyon user_id → workgroup join'iyle kuruluyor."""
    h = admin_headers()
    dep = make_department(h)                        # bizim workgroup'ta iz

    yabanci = foreign_admin_headers()
    body = logs(yabanci, entity_type="department", limit=100)
    assert dep["id"] not in [i["entity_id"] for i in body["items"]], \
        "yabancı admin bizim izimizi gördü"


def test_orphan_log_row_is_not_leaked():
    """user_id NULL olan satır (varsa) join yüzünden hiç dönmez.

    K-34 sayesinde pratikte oluşmaz; test, izolasyonun user join'ine
    dayandığını ve failsiz satırın sızmadığını sabitler.
    """
    db = SessionLocal()
    oksuz = AuditLog(user_id=None, action="CREATE", entity_type="course",
                     entity_id=999_999_999)
    db.add(oksuz)
    db.commit()
    oksuz_id = oksuz.id
    db.close()

    body = logs(admin_headers(), limit=100)
    assert oksuz_id not in [i["id"] for i in body["items"]]

    db = SessionLocal()
    db.delete(db.get(AuditLog, oksuz_id))
    db.commit()
    db.close()
