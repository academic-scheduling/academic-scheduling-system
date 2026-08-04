"""K-50 · Fakülte web import testleri.

İki katman ayrı test edilir:
  1. Saf ayrıştırma (parse_list/parse_detail) — kaydedilmiş gerçek HTML
     fixture'larına karşı. Ağ yok.
  2. Uçlar (preview/commit) — ağ katmanı monkeypatch'lenir (fetch_list/
     fetch_detail sahte veri döner). Böylece test internetsiz çalışır ve
     dedup / bölüm eşleme / yetki / TOCTOU mantığı izole doğrulanır.
"""

from pathlib import Path

import pytest

from app.scrapers import mu_akademik
from app.scrapers.mu_akademik import (
    PersonDetail, PersonRef, ScrapeError, parse_detail, parse_list,
)
from app.normalize import canonical_title, normalize_lecturer_name, split_title
from tests.helpers import admin_headers, client, sub_headers
from app.db import SessionLocal
from app.models import Lecturer, User

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _clean_lecturers():
    """Modül içinde DB sıfırlanmadığından her test taze hoca tablosuyla başlar
    (dedup/commit sayıları testler arası kirlenmesin)."""
    db = SessionLocal()
    db.query(Lecturer).delete()
    db.commit()
    db.close()
    yield


# --- Katman 1: saf ayrıştırma -------------------------------------------------

def test_parse_list_reads_real_cards():
    people = parse_list((FIX / "mu_list_sample.html").read_text(encoding="utf-8"))
    assert len(people) == 2
    # K-52: full_name yalnız ad; unvan AYRI ve kanonikleştirilmiş.
    by_name = {p.full_name: p for p in people}
    assert "Ali Arslan KAYA" in by_name
    assert by_name["Ali Arslan KAYA"].title == "Prof. Dr."       # site "Prof.Dr." → kanonik
    # Site açık form yazar ("Doktor Öğretim Üyesi") → kısa forma iner.
    assert by_name["Erdem TÜRK"].title == "Dr. Öğr. Üyesi"
    # Detay linki absolute ve /personel/ içerir; liste sayfasına dönmez
    for p in people:
        assert p.detail_url.startswith("https://www.mu.edu.tr/tr/personel/")
        assert not p.detail_url.endswith("/akademik")


def test_parse_detail_reads_units_and_email():
    d = parse_detail((FIX / "mu_detail_sample.html").read_text(encoding="utf-8"))
    # Görev ≠ Kadro (gerçek örnek: Görev İnşaat, Kadro Jeoloji)
    assert d.duty_unit == "İnşaat Mühendisliği"
    assert d.cadre_unit == "Jeoloji Mühendisliği"
    assert d.email == "muratgul@mu.edu.tr"


def test_parse_detail_ignores_education_section():
    """"Öğrenim Bilgileri" bloğu da 'Bölümü' taşır; selector ona takılmamalı."""
    d = parse_detail((FIX / "mu_detail_sample.html").read_text(encoding="utf-8"))
    assert "Hacettepe" not in (d.duty_unit or "")
    assert "Hacettepe" not in (d.cadre_unit or "")


def test_parse_list_empty_raises():
    """Dolu bir sayfadan 0 kişi ayrıştırılırsa gürültülü hata (sessiz değil)."""
    with pytest.raises(ScrapeError):
        parse_list("<html><body><p>site değişti</p></body></html>")


# --- Unvan (K-52): kanonikleştirme + ayırma ----------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("Prof.Dr.", "Prof. Dr."),
    ("Doktor Öğretim Üyesi", "Dr. Öğr. Üyesi"),
    ("Dr. Öğr. Üyesi", "Dr. Öğr. Üyesi"),
    ("Araştırma Görevlisi", "Arş. Gör."),
    ("Öğretim Görevlisi Doktor", "Öğr. Gör. Dr."),
    ("Doç. Dr.", "Doç. Dr."),
    ("", None),
])
def test_canonical_title(raw, expected):
    assert canonical_title(raw) == expected


@pytest.mark.parametrize("full,title,name", [
    ("Doç. Dr. Ayşe Kaya", "Doç. Dr.", "Ayşe Kaya"),
    ("Prof.Dr. Ali Arslan KAYA", "Prof. Dr.", "Ali Arslan KAYA"),
    ("Doktor Öğretim Üyesi Web Demir", "Dr. Öğr. Üyesi", "Web Demir"),
    ("Ayşe Kaya", None, "Ayşe Kaya"),        # unvansız → ad aynen
    ("Prof. Dr.", None, "Prof. Dr."),        # yalnız unvan, ad yok → bölme
])
def test_split_title(full, title, name):
    assert split_title(full) == (title, name)


# --- Katman 2: uçlar (ağ monkeypatch) ----------------------------------------

def _make_department(headers, name: str, code: str) -> int:
    """İdempotent: modül içinde DB sıfırlanmadığından aynı kod tekrar gelebilir."""
    r = client.post("/departments", json={"name": name, "code": code}, headers=headers)
    if r.status_code == 409:
        existing = client.get("/departments", headers=headers).json()
        return next(d["id"] for d in existing if d["code"] == code)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.fixture
def fake_faculty(monkeypatch):
    """Sahte fakülte: 3 kişi. Biri CENG'e eşlenir, biri bölümsüz."""
    people = [
        PersonRef("Web Kaya", "https://www.mu.edu.tr/tr/personel/webkaya", "Prof. Dr."),
        PersonRef("Web Demir", "https://www.mu.edu.tr/tr/personel/webdemir", "Dr. Öğr. Üyesi"),
        PersonRef("Web Arslan", "https://www.mu.edu.tr/tr/personel/webarslan", "Arş. Gör."),
    ]
    details = {
        "https://www.mu.edu.tr/tr/personel/webkaya":
            PersonDetail("Bilgisayar Mühendisliği", "Bilgisayar Mühendisliği", "webkaya@mu.edu.tr"),
        "https://www.mu.edu.tr/tr/personel/webdemir":
            PersonDetail("Makine Mühendisliği", "Makine Mühendisliği", "webdemir@mu.edu.tr"),
        "https://www.mu.edu.tr/tr/personel/webarslan":
            PersonDetail(None, None, None),
    }
    monkeypatch.setattr(mu_akademik, "fetch_list", lambda url: people)
    monkeypatch.setattr(mu_akademik, "fetch_detail", lambda url: details[url])
    return people


def test_preview_returns_new_and_maps_department(fake_faculty):
    headers = admin_headers()
    _make_department(headers, "Bilgisayar Mühendisliği", "CENG")

    r = client.post("/lecturers/import/preview", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["list_total"] == 3
    assert len(body["new"]) == 3

    by_name = {row["full_name"]: row for row in body["new"]}
    kaya = by_name["Web Kaya"]
    assert kaya["title"] == "Prof. Dr."                 # K-52: unvan ayrı alanda
    assert kaya["department_id"] is not None            # Görev Birimi → CENG eşleşti
    assert kaya["department_label"].startswith("CENG")
    assert kaya["email"] == "webkaya@mu.edu.tr"

    demir = by_name["Web Demir"]
    assert demir["title"] == "Dr. Öğr. Üyesi"
    assert demir["department_id"] is None               # Makine bizde yok → NULL
    assert demir["cadre_unit"] == "Makine Mühendisliği"


def test_preview_skips_already_present(fake_faculty):
    headers = admin_headers()
    # "Web Kaya"yı elle ekle (farklı unvanla) — ada göre eşleşip elenmelı
    r = client.post(
        "/lecturers",
        json={"full_name": "Web Kaya", "title": "Doç. Dr.", "is_external": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text

    r = client.post("/lecturers/import/preview", headers=headers)
    body = r.json()
    assert body["already_present"] >= 1
    new_names = {row["normalized_name"] for row in body["new"]}
    assert normalize_lecturer_name("Web Kaya") not in new_names


def test_commit_writes_import_and_is_idempotent(fake_faculty):
    headers = admin_headers()
    _make_department(headers, "Bilgisayar Mühendisliği", "CENG")

    preview = client.post("/lecturers/import/preview", headers=headers).json()
    r = client.post("/lecturers/import/commit", json={"rows": preview["new"]}, headers=headers)
    assert r.status_code == 200, r.text
    created = r.json()["created"]
    assert len(created) == 3

    # source=IMPORT ve alanlar yazıldı mı — DB'den doğrula
    db = SessionLocal()
    kaya = db.query(Lecturer).filter(
        Lecturer.normalized_name == normalize_lecturer_name("Web Kaya")
    ).first()
    assert kaya.source == "IMPORT"
    assert kaya.full_name == "Web Kaya"           # K-52: ad saf, unvansız
    assert kaya.title == "Prof. Dr."              # K-52: unvan ayrı kolonda
    assert kaya.duty_unit == "Bilgisayar Mühendisliği"
    assert kaya.department_id is not None
    db.close()

    # İkinci commit aynı satırlarla → hepsi skip (tekrar yazılmaz)
    r2 = client.post("/lecturers/import/commit", json={"rows": preview["new"]}, headers=headers)
    body2 = r2.json()
    assert body2["created"] == []
    assert len(body2["skipped"]) == 3


def test_commit_ignores_foreign_department(fake_faculty):
    """İstemci başka workgroup'un bölüm id'sini gönderse bile bölüm boş geçilir."""
    headers = admin_headers()
    row = {
        "full_name": "Yeni Biri", "title": "Prof. Dr.",
        "normalized_name": normalize_lecturer_name("Yeni Biri"),
        "duty_unit": None, "cadre_unit": None, "email": None,
        "department_id": 999999, "department_label": None,   # olmayan/yabancı bölüm
        "detail_url": "https://www.mu.edu.tr/tr/personel/yenibiri",
    }
    r = client.post("/lecturers/import/commit", json={"rows": [row]}, headers=headers)
    assert r.status_code == 200, r.text
    assert len(r.json()["created"]) == 1
    assert r.json()["created"][0]["department_id"] is None


def test_department_match_ignores_hyphen(monkeypatch):
    """Site "Elektrik Elektronik" (boşluk), bizde "Elektrik-Elektronik" (tire)
    → yine de eşleşmeli (K-50 noktalama normalizasyonu)."""
    headers = admin_headers()
    _make_department(headers, "Elektrik-Elektronik Mühendisliği", "EEE")
    monkeypatch.setattr(mu_akademik, "fetch_list", lambda url: [
        PersonRef("Elektrikçi Biri", "https://www.mu.edu.tr/tr/personel/elk", "Prof. Dr."),
    ])
    monkeypatch.setattr(mu_akademik, "fetch_detail", lambda url: PersonDetail(
        "Elektrik Elektronik Mühendisliği", "Elektrik Elektronik Mühendisliği", None,
    ))
    body = client.post("/lecturers/import/preview", headers=headers).json()
    assert body["new"][0]["department_id"] is not None
    assert body["new"][0]["department_label"].startswith("EEE")


def test_department_falls_back_to_cadre(monkeypatch):
    """Görev Birimi bölüm değilse (ör. "Rektörlük") Kadro Birimi'ne düşülür."""
    headers = admin_headers()
    _make_department(headers, "İnşaat Mühendisliği", "CE")
    monkeypatch.setattr(mu_akademik, "fetch_list", lambda url: [
        PersonRef("Rektör Biri", "https://www.mu.edu.tr/tr/personel/rektor", "Prof. Dr."),
    ])
    monkeypatch.setattr(mu_akademik, "fetch_detail", lambda url: PersonDetail(
        "Rektörlük", "İnşaat Mühendisliği", None,     # Görev idari, Kadro bölüm
    ))
    row = client.post("/lecturers/import/preview", headers=headers).json()["new"][0]
    assert row["department_label"].startswith("CE")   # Kadro'dan eşleşti
    assert row["duty_unit"] == "Rektörlük"            # ama Görev de saklanır


def test_import_requires_lecturer_manager(fake_faculty):
    # Yetkisiz alt hesap (bayrak kapalı) → 403
    sub = sub_headers(can_manage_lecturers=False)
    assert client.post("/lecturers/import/preview", headers=sub).status_code == 403
    assert client.post(
        "/lecturers/import/commit", json={"rows": []}, headers=sub
    ).status_code == 403


def test_preview_scrape_error_returns_502(monkeypatch):
    def boom(url):
        raise ScrapeError("site yapısı değişti")
    monkeypatch.setattr(mu_akademik, "fetch_list", boom)
    r = client.post("/lecturers/import/preview", headers=admin_headers())
    assert r.status_code == 502
    assert "değişti" in r.json()["detail"]
