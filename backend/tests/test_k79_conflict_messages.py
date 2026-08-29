"""K-79 Faz 2 · Çakışma motoru mesajları iki dilli.

İki şeyi birden kanıtlar:
  1. **Türkçe BİREBİR korundu** — dil eklemek mevcut çıktıyı değiştirmemeliydi;
     motorun 71 testi ve arayüzün okuduğu metin aynı kalmalı.
  2. **Hiçbir kural sessizce Türkçeye düşmüyor** — 22 kuralın HEPSİNİN ayrı bir
     İngilizce karşılığı var. Bu bekçi olmasa yeni bir kural (W10, E9...) yalnız
     Türkçe mesajla eklenir ve İngilizce arayüzde Türkçe cümle görünürdü;
     `_pick` sessizce Türkçeyi döndürdüğü için kimse fark etmezdi.
"""

from datetime import date, time

import pytest

from app.conflicts.message import MESSAGE_BUILDERS, build_message
from app.i18n import set_lang


@pytest.fixture(autouse=True)
def _dili_sifirla():
    """Her testten sonra dili varsayılana çek.

    contextvar süreç boyunca yaşar; sızarsa SONRAKİ testler (motorun Türkçe
    metne dayanan iddiaları) esrarengiz biçimde kırılırdı.
    """
    yield
    set_lang("tr")


# Her kuralın ihtiyaç duyduğu anahtarların BİRLEŞİMİ: tek bir sözlükle 22
# kurucunun hepsi çağrılabilsin diye. (Kurallar birbirinden farklı alanlar
# okuyor; ayrı ayrı kurulum yazmak testi kuralların sayısı kadar uzatırdı.)
YEM = {
    "course_code": "CENG2001",
    "section_no": 1,
    "day_of_week": 1,
    "start_slot": 3,
    "slot_count": 2,
    "department_id": 7,
    "department_name": "Bilgisayar Mühendisliği",
    "year": 2,
    "semester": "FALL",
    "expected_students": 40,
    "exam_type": "MIDTERM",
    "exam_date": date(2026, 11, 12),
    "start_time": time(10, 0),
    "duration_minutes": 90,
}
YEM_B = {**YEM, "course_code": "MATH1001", "section_no": 2}


@pytest.mark.parametrize("rule_id", sorted(MESSAGE_BUILDERS))
def test_every_rule_has_a_distinct_english_message(rule_id):
    """22 kuralın her biri İngilizcede AYRI bir cümle üretmeli."""
    set_lang("tr")
    turkce = build_message(rule_id, YEM, YEM_B)
    set_lang("en")
    ingilizce = build_message(rule_id, YEM, YEM_B)

    assert turkce and ingilizce
    assert turkce != ingilizce, (
        f"{rule_id} kuralının İngilizce karşılığı yok — İngilizce arayüzde "
        f"Türkçe cümle görünür: {turkce!r}"
    )


@pytest.mark.parametrize("rule_id", sorted(MESSAGE_BUILDERS))
def test_english_message_has_no_turkish_letters(rule_id):
    """İngilizce mesajda Türkçeye özgü harf kalmamalı (yarım çeviri yakalar).

    Veri kaynaklı alanlar hariç: bölüm ADI çevrilmez (K-79 kapsam dışı), o
    yüzden yem verisindeki Türkçe bölüm adını maskeleyip bakıyoruz.
    """
    set_lang("en")
    mesaj = build_message(rule_id, YEM, YEM_B).replace(YEM["department_name"], "")
    kalan = {ch for ch in mesaj if ch in "çğışöüÇĞİŞÖÜ"}
    assert not kalan, f"{rule_id}: İngilizce mesajda Türkçe harf kaldı: {kalan}"


def test_turkish_output_is_unchanged():
    """Türkçe metinler birebir korundu — dil eklemek çıktıyı değiştirmedi."""
    set_lang("tr")
    assert build_message("W1", YEM, YEM_B) == (
        "Derslik çakışması: CENG2001-1 ve MATH1001-2, "
        "Pazartesi 10:30-12:15'te aynı dersliği kullanıyor."
    )
    assert build_message("E6", YEM, None) == (
        "Hafta sonu sınavı: CENG2001 sınavı 2026-11-12 tarihinde "
        "hafta sonuna denk geliyor."
    )


def test_english_day_names_are_translated():
    """Gün adı da çevrilmeli — mesajın en görünür veri parçası."""
    set_lang("en")
    mesaj = build_message("W1", YEM, YEM_B)
    assert "Monday" in mesaj and "Pazartesi" not in mesaj


def test_default_language_is_turkish_without_a_request():
    """İstek bağlamı yokken (motor testleri, betikler) Türkçe kalır."""
    assert "Derslik çakışması" in build_message("W1", YEM, YEM_B)


def test_unknown_rule_falls_back_in_both_languages():
    set_lang("tr")
    assert build_message("ZZ9", YEM, None) == "Çakışma: ZZ9"
    set_lang("en")
    assert build_message("ZZ9", YEM, None) == "Conflict: ZZ9"


def test_department_label_falls_back_when_name_missing():
    """Bölüm adı beslenmemişse mesaj yine anlaşılır kalmalı (iki dilde de)."""
    adsiz = {**YEM, "department_name": None}
    set_lang("tr")
    assert "7. bölüm" in build_message("W3", adsiz, YEM_B)
    set_lang("en")
    assert "department 7" in build_message("W3", adsiz, YEM_B)
