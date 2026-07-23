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


def test_deleted_record_still_has_its_name():
    """K-36'nın kalbi: silinen kayıt konuşur.

    K-35'te bu satır "silinmiş kayıt (#N)" oluyordu — üstelik adını en çok
    merak ettiğimiz satır oydu. Etiket artık işlem anında yazıldığı için,
    kaynağı silinse bile ad log'da duruyor.
    """
    h = admin_headers()
    course = make_course(h, make_department(h))
    assert client.delete(f"/courses/{course['id']}", headers=h).status_code == 204

    body = logs(h, entity_type="course", action="DELETE", limit=20)
    satir = next(i for i in body["items"] if i["entity_id"] == course["id"])
    assert satir["entity_label"] == f"{course['code']} — {course['name']}"


def test_rename_history_is_preserved_row_by_row():
    """K-36'nın ikinci kazanımı: log geçmişi anlatır, okuma anını değil.

    Satır işlem SONRASI adı taşır; ardışık satırlar birlikte okununca yeniden
    adlandırmanın izini verir. Kritik nokta: SONRAKİ değişiklikler eski
    satırları BOZMAZ.

    K-35'te (okuma anında çözme) üç satırın üçü de bugünkü adı — "Kuram" —
    gösterirdi ve ara adımlar tamamen kaybolurdu.
    """
    h = admin_headers()
    course = make_course(h, make_department(h), name="İstatistik")
    client.patch(f"/courses/{course['id']}", json={"name": "Olasılık"}, headers=h)
    client.patch(f"/courses/{course['id']}", json={"name": "Kuram"}, headers=h)

    body = logs(h, entity_type="course", limit=50)
    # Yeniden eskiye sıralı; bu dersin satırlarını eskiden yeniye çevir
    adlar = [i["entity_label"] for i in body["items"]
             if i["entity_id"] == course["id"]][::-1]

    assert adlar[0].endswith("İstatistik"), f"oluşturma satırı: {adlar[0]}"
    assert adlar[1].endswith("Olasılık"), \
        f"ara adım kayboldu, satır bugünkü adı gösteriyor: {adlar[1]}"
    assert adlar[2].endswith("Kuram"), f"son satır: {adlar[2]}"


def test_old_rows_without_label_fall_back_to_read_time():
    """K-36 öncesi satırlar: etiket yok, varlık duruyorsa okuma anında çözülür."""
    h = admin_headers()
    dep = make_department(h)

    db = SessionLocal()
    eski = AuditLog(user_id=client.get("/auth/me", headers=h).json()["id"],
                    action="UPDATE", entity_type="department", entity_id=dep["id"],
                    entity_label=None)
    db.add(eski)
    db.commit()
    eski_id = eski.id
    db.close()

    body = logs(h, entity_type="department", limit=50)
    satir = next(i for i in body["items"] if i["id"] == eski_id)
    assert satir["entity_label"] == f"{dep['code']} — {dep['name']}"

    db = SessionLocal()
    db.delete(db.get(AuditLog, eski_id))
    db.commit()
    db.close()


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


# --- davet akışı (K-37) ---

def test_invite_leaves_a_trace():
    """Davet iz bırakmalı: hesabın DOĞUŞU görünmüyordu (K-37)."""
    h = admin_headers()
    davetli = client.post("/users/invite", json={
        "name": "İzli Davetli",
        "email": f"izli_{uuid.uuid4().hex[:8]}@muh.example.edu.tr",
    }, headers=h).json()

    body = logs(h, entity_type="user", action="INVITE", limit=20)
    satir = next(i for i in body["items"] if i["entity_id"] == davetli["id"])
    assert satir["entity_label"] == "İzli Davetli"


def test_resend_leaves_a_second_invite_trace():
    """Yeniden gönderim de INVITE: davetin tekrarlandığı görünsün."""
    h = admin_headers()
    davetli = client.post("/users/invite", json={
        "name": "Tekrar Davetli",
        "email": f"tekrar_{uuid.uuid4().hex[:8]}@muh.example.edu.tr",
    }, headers=h).json()
    assert client.post(f"/users/{davetli['id']}/resend-invitation",
                       headers=h).status_code == 200

    body = logs(h, entity_type="user", action="INVITE", limit=50)
    satirlar = [i for i in body["items"] if i["entity_id"] == davetli["id"]]
    assert len(satirlar) == 2, "ilk davet + yeniden gönderim iki satır olmalı"


def test_activation_is_logged_with_the_person_as_actor():
    """K-37: aktifleşmenin faili davet EDEN admin değil, davet EDİLEN kişidir."""
    from app.models import InvitationToken
    from app.security import hash_token

    h = admin_headers()
    davetli = client.post("/users/invite", json={
        "name": "Kendi Açan",
        "email": f"acan_{uuid.uuid4().hex[:8]}@muh.example.edu.tr",
    }, headers=h).json()

    # Mailpit'e giden ham token'a testten erişemiyoruz; token'ı bilinen bir
    # değerle değiştirip aktivasyonu o değerle tetikliyoruz.
    ham = "test-token-" + uuid.uuid4().hex
    db = SessionLocal()
    tok = db.query(InvitationToken).filter(
        InvitationToken.user_id == davetli["id"]).first()
    tok.token_hash = hash_token(ham)
    db.commit()
    db.close()

    r = client.post("/auth/complete-invitation",
                    json={"token": ham, "password": "yenisifre123"})
    assert r.status_code == 200, r.text

    body = logs(h, entity_type="user", action="ACTIVATE", limit=20)
    satir = next(i for i in body["items"] if i["entity_id"] == davetli["id"])
    assert satir["user"]["id"] == davetli["id"], \
        "aktifleşmenin faili kişinin kendisi olmalı, davet eden admin değil"
    assert satir["entity_label"] == "Kendi Açan"


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
