"""K-79 · Dil altyapısı: katalog bekçisi + dil çözümü + uçtan uca çeviri.

**Bu dosyanın asıl işi bekçilik.** K-79'da Türkçe metin kodda KANONİK kaldı ve
çeviri çıkışta bir katalogdan yapılıyor; yani katalogun anahtarı Türkçe metnin
BİREBİR kendisi. Bunun sessiz bozulma yolu şu: biri bir `detail=` metnini
düzeltir, katalogu güncellemeyi unutur, İngilizce arayüz sessizce Türkçeye düşer.
Aşağıdaki süpürme bunu derleme değil TEST zamanında yakalar (K-78'deki desenin
aynısı: kanıtı tek yerde tut).
"""

import ast
import pathlib

import pytest

from app.i18n import (
    DEFAULT_LANG, ERRORS, ERROR_PATTERNS, get_lang, parse_accept_language,
    set_lang, translate_error,
)
from tests.helpers import admin_headers, client

APP_DIR = pathlib.Path(__file__).resolve().parent.parent / "app"


# ------------------------------------------------------------------
# Bekçi: koddaki her `detail=` metni katalogda karşılığını bulmalı
# ------------------------------------------------------------------

def _detail_literals() -> list[tuple[str, str]]:
    """app/ altındaki tüm `detail=` argümanlarının SABİT metinlerini toplar.

    AST ile okunuyor (regex ile değil): çok satıra bölünmüş metinler ve bitişik
    string birleştirmesi ("...' 'devamı") ancak böyle doğru çözülür — kodda
    ikisi de var. f-string'ler (`JoinedStr`) atlanır; onlar desenle çevrilir ve
    ayrı test edilir.
    """
    bulunan: list[tuple[str, str]] = []
    for yol in APP_DIR.rglob("*.py"):
        agac = ast.parse(yol.read_text(encoding="utf-8"), filename=str(yol))
        for dugum in ast.walk(agac):
            if not isinstance(dugum, ast.Call):
                continue
            for kw in dugum.keywords:
                if kw.arg != "detail":
                    continue
                if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    bulunan.append((yol.name, kw.value.value))
    return bulunan


def test_every_static_error_message_has_a_translation():
    """Koddaki her sabit `detail` metni katalogda olmalı — yoksa EN'de TR düşer."""
    eksik = sorted({
        f"{dosya}: {metin}"
        for dosya, metin in _detail_literals()
        if metin not in ERRORS
    })
    assert not eksik, (
        "Kataloğa eklenmemiş hata mesajları var (app/i18n.py ERRORS):\n  "
        + "\n  ".join(eksik)
    )


def test_catalog_has_no_dead_entries():
    """Katalogda kodda ARTIK OLMAYAN metin birikmesin (çift yönlü bekçilik).

    Ölü girdi zararsız görünür ama katalogu okunmaz yapar ve "bu mesaj hâlâ var
    mı" sorusunu belirsizleştirir. deps.py'deki yetenek mesajları bir fabrikadan
    (`_require_capability`) geçtiği için `detail=` anahtar argümanı olarak
    görünmez — onlar beklenen istisnadır.
    """
    kodda = {metin for _dosya, metin in _detail_literals()}
    fabrikadan_gelenler = {
        "Ders yönetim yetkisi gerekli",
        "Derslik yönetim yetkisi gerekli",
        "Öğretim üyesi yönetim yetkisi gerekli",
        "Program onaylama yetkisi gerekli",
        # auth/deps'te doğrudan HTTPException(detail=...) ile değil, farklı
        # yollarla üretilen sabitler:
        "Not authenticated",
        "Invalid authentication credentials",
        "User not found",
        "User account is not active",
        "Admin privileges required",
    }
    olu = sorted(set(ERRORS) - kodda - fabrikadan_gelenler)
    assert not olu, (
        "Katalogda kodda karşılığı olmayan girdiler var:\n  " + "\n  ".join(olu)
    )


# ------------------------------------------------------------------
# Accept-Language çözümü
# ------------------------------------------------------------------

@pytest.mark.parametrize("header,beklenen", [
    (None, "tr"),                                  # başlık yok -> varsayılan
    ("", "tr"),
    ("tr", "tr"),
    ("en", "en"),
    ("EN", "en"),                                  # büyük/küçük harf duyarsız
    ("en-US", "en"),                               # alt etiket kökene iner
    ("de", "tr"),                                  # desteklenmeyen -> varsayılan
    ("de,en;q=0.9", "en"),                         # desteklenmeyeni atlar
    ("en-US,en;q=0.9,tr;q=0.8", "en"),             # tarayıcının doğal başlığı
    ("tr;q=0.9,en;q=0.8", "tr"),                   # q sırasına uyar
    ("en;q=0.8,tr;q=0.9", "tr"),                   # sıra değil q belirler
])
def test_accept_language_parsing(header, beklenen):
    assert parse_accept_language(header) == beklenen


def test_lang_contextvar_defaults_to_turkish():
    """İstek bağlamı yokken (motor testleri, betikler) dil "tr" olmalı."""
    assert get_lang() == DEFAULT_LANG
    set_lang("en")
    assert get_lang() == "en"
    set_lang("gibberish")          # desteklenmeyen -> varsayılana çekilir
    assert get_lang() == DEFAULT_LANG


# ------------------------------------------------------------------
# Çeviri fonksiyonu
# ------------------------------------------------------------------

def test_turkish_is_returned_untouched():
    assert translate_error("Bölüm bulunamadı", "tr") == "Bölüm bulunamadı"


def test_known_message_is_translated():
    assert translate_error("Bölüm bulunamadı", "en") == "Department not found"


def test_unknown_message_falls_back_silently():
    """Çevirisi olmayan mesaj isteği patlatmaz, Türkçe görünür."""
    assert translate_error("Bilinmeyen bir hata", "en") == "Bilinmeyen bir hata"


def test_dynamic_messages_are_translated_by_pattern():
    """f-string mesajlar birebir eşleşemez; desen çevirisi değerleri korur."""
    tr = "Bu bina silinemez: 3 derslik bağlı. Önce onları taşıyın."
    en = translate_error(tr, "en")
    assert en.startswith("This building cannot be deleted: 3 classroom(s) attached.")
    assert "3" in en


def test_every_pattern_compiles_and_substitutes():
    """Desenlerin şablonları geçerli olmalı (bozuk \\1 grubu sessizce patlar)."""
    ornekler = [
        "Bu bina silinemez: 2 derslik bağlı. ",
        "Bu derslik silinemez: 1 ders ve 2 sınav bağlı. ",
        "Bu ders silinemez: 3 şube bağlı. ",
        "'CENG2001' ortak dersi zaten bu bölüm/sınıf/dönemde kayıtlı",
    ]
    for ornek in ornekler:
        sonuc = translate_error(ornek, "en")
        assert sonuc != ornek, f"desen eşleşmedi: {ornek}"
        assert "\\1" not in sonuc and "\\2" not in sonuc


# ------------------------------------------------------------------
# Uçtan uca: gerçek istek İngilizce hata döndürür
# ------------------------------------------------------------------

def test_api_returns_english_error_when_requested():
    """Accept-Language: en -> `detail` İngilizce döner."""
    h = {**admin_headers(), "Accept-Language": "en"}
    r = client.get("/schedule-drafts/999999", headers=h)
    assert r.status_code == 404
    assert r.json()["detail"] == "Draft not found"


def test_api_returns_turkish_by_default():
    """Başlık yoksa Türkçe — mevcut istemciler ve testler etkilenmez."""
    r = client.get("/schedule-drafts/999999", headers=admin_headers())
    assert r.status_code == 404
    assert r.json()["detail"] == "Taslak bulunamadı"


def test_auth_401_is_translated_and_keeps_its_headers():
    """401 çevrilir AMA WWW-Authenticate başlığı korunur (handler'ın tuzağı)."""
    r = client.get("/users", headers={"Accept-Language": "en"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"
    assert r.headers.get("www-authenticate") == "Bearer"


def test_validation_422_body_is_not_mangled():
    """Pydantic 422'nin `detail` LİSTESİ yapısını korumalı (string değil)."""
    h = {**admin_headers(), "Accept-Language": "en"}
    r = client.post("/departments", json={"name": "eksik kod"}, headers=h)
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
