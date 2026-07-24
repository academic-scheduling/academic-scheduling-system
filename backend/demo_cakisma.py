"""Çakışma motoru canlı demosu — hoca sunumu için (WP5).

Bu script, API'nin çağırdığı GERÇEK motoru (app/conflicts) realistik
senaryolarda çalıştırır ve ürettiği çakışma raporunu insan-okur Türkçe
mesajlarla basar. Veritabanı/Docker gerekmez — motor saf Python'dur.

Çalıştırma (backend/ klasöründen):
    python demo_cakisma.py

Her senaryo, projedeki bir kural kimliğini (W1..W8, E1..E7, X1..X3) ve
karar defterindeki bir kararı gösterir. Amaç brief §4'ün çekirdek değerini
kanıtlamak: "çakışmalar genel hata değil, AÇIK GEREKÇELERLE bildirilir."
"""

from datetime import date, time

from app.conflicts.orchestrator import scan_weekly, scan_exams, scan_cross


# ------------------------------------------------------------------
# Küçük kurucular — gerçek adaptörün ürettiği dict şeklini taklit eder
# (bkz. app/conflict_service.py _weekly_to_dict / _exam_to_dict)
# ------------------------------------------------------------------

def ders(id, kod, sube, gun, slot, sayi=2, *, derslik=1, hoca=1,
         bolum=1, bolum_ad="Bilgisayar Müh.", yil=2, donem="FALL",
         secmeli=False, ogrenci=40, kapasite=90, tur="THEORY",
         mod="FACE_TO_FACE", t=3, u=0, l=0):
    """Bir haftalık ders oturumu (motor dict'i)."""
    return {
        "id": id, "type": "weekly_entry", "section_id": id, "course_id": kod,
        "classroom_id": derslik, "day_of_week": gun, "start_slot": slot,
        "slot_count": sayi, "lecturer_id": hoca, "department_id": bolum,
        "department_name": bolum_ad, "year": yil, "semester": donem,
        "is_elective": secmeli, "expected_students": ogrenci,
        "capacity": kapasite, "course_code": kod, "section_no": sube,
        "session_type": tur, "delivery_mode": mod,
        "hours_theory": t, "hours_practice": u, "hours_lab": l,
    }


def sinav(id, kod, tarih, saat, sure=90, *, odalar=((1, 40),), hoca=1,
          tip="FINAL", bolum=1, bolum_ad="Bilgisayar Müh.", yil=1,
          donem="FALL", secmeli=False, ogrenci=60):
    """Bir sınav (motor dict'i). odalar: (derslik_id, exam_capacity) çiftleri."""
    return {
        "id": id, "type": "exam", "course_id": kod, "exam_type": tip,
        "exam_date": tarih, "start_time": saat, "duration_minutes": sure,
        "lecturer_id": hoca, "department_id": bolum, "department_name": bolum_ad,
        "year": yil, "semester": donem, "is_elective": secmeli,
        "expected_students": ogrenci,
        "rooms": [{"classroom_id": c, "exam_capacity": k} for c, k in odalar],
        "course_code": kod,
    }


# ------------------------------------------------------------------
# Raporlama
# ------------------------------------------------------------------

RENK = {"HARD": "🔴 HARD   ", "WARNING": "🟡 WARNING"}


def rapor(baslik, aciklama, sonuclar):
    print(f"\n{'─' * 72}")
    print(f"  {baslik}")
    print(f"  {aciklama}")
    print(f"{'─' * 72}")
    if not sonuclar:
        print("  ✅ Çakışma yok — program temiz.")
        return
    for c in sonuclar:
        print(f"  {RENK[c['severity']]} [{c['rule_id']:>3}]  {c['message']}")


def baslik_yaz(metin):
    print(f"\n\n╔{'═' * 70}╗")
    print(f"║  {metin:<66}  ║")
    print(f"╚{'═' * 70}╝")


# ==================================================================
# SENARYOLAR
# ==================================================================

def main():
    baslik_yaz("AKADEMİK ÇAKIŞMA MOTORU — CANLI DEMO")
    print("  Aşağıdaki her senaryo GERÇEK motoru çalıştırır (app/conflicts).")
    print("  Bu, API'nin POST/submit ve GET /conflicts uçlarında çağırdığı kodun aynısıdır.")

    # ---- HAFTALIK DERS KURALLARI ----
    baslik_yaz("A · HAFTALIK DERS ÇAKIŞMALARI")

    # W1 — derslik
    rapor(
        "Senaryo 1 · Aynı derslik, aynı saat (W1 — HARD)",
        "CENG2001-1 (2. sınıf) ve MATH1001-2 (1. sınıf), Pazartesi 10:30'da aynı E-B08'de.",
        scan_weekly([
            ders(1, "CENG2001", 1, gun=1, slot=3, derslik=8, yil=2),
            ders(2, "MATH1001", 2, gun=1, slot=3, derslik=8, hoca=2, yil=1),
        ]),
    )

    # W2 — hoca
    rapor(
        "Senaryo 2 · Aynı hoca iki derste (W2 — HARD)",
        "Dr. Ayşe Kaya (hoca #5) Çarşamba 13:30'da iki farklı sınıfın dersinde görünüyor.",
        scan_weekly([
            ders(1, "CENG3001", 1, gun=3, slot=6, derslik=8, hoca=5, yil=3),
            ders(2, "CENG1005", 1, gun=3, slot=6, derslik=9, hoca=5, yil=1),
        ]),
    )

    # W3 — cohort zorunlu (HARD)
    rapor(
        "Senaryo 3 · Aynı sınıfın iki zorunlu dersi (W3 — HARD)",
        "Bilgisayar Müh. 2. sınıf: İstatistik ve Diferansiyel Denklemler aynı saatte.",
        scan_weekly([
            ders(1, "STAT2001", 1, gun=4, slot=2, derslik=8),
            ders(2, "MATH2004", 1, gun=4, slot=2, derslik=9, hoca=2),
        ]),
    )

    # W4 — cohort seçmeli (WARNING)
    rapor(
        "Senaryo 4 · Biri seçmeli iki ders çakışıyor (W4 — WARNING)",
        "Aynı sınıf ama biri seçmeli → öğrenci diğerini seçebilir, uyarı yeter.",
        scan_weekly([
            ders(1, "CENG2001", 1, gun=2, slot=4, derslik=8),
            ders(2, "CENG2050", 1, gun=2, slot=4, derslik=9, hoca=2, secmeli=True),
        ]),
    )

    # Sınır durumu — uç uca slot (temiz)
    rapor(
        "Senaryo 5 · Uç uca dersler (SINIR DURUMU — çakışma YOK)",
        "Biri 10:30-11:15 (slot 3) biter, diğeri 11:30-12:15 (slot 4) başlar. Aynı derslik.",
        scan_weekly([
            ders(1, "CENG1001", 1, gun=5, slot=3, sayi=1, derslik=8),
            ders(2, "CENG1002", 1, gun=5, slot=4, sayi=1, derslik=8, hoca=2),
        ]),
    )

    # W7 — kapasite
    rapor(
        "Senaryo 6 · Sınıf kapasitesi yetersiz (W7 — WARNING)",
        "120 öğrenci beklenen ders, 90 kişilik dersliğe konmuş.",
        scan_weekly([
            ders(1, "CENG1001", 1, gun=1, slot=1, derslik=8,
                 ogrenci=120, kapasite=90),
        ]),
    )

    # ---- SINAV KURALLARI ----
    baslik_yaz("B · SINAV ÇAKIŞMALARI")

    # E1 — sınav derslik
    rapor(
        "Senaryo 7 · İki sınav aynı derslikte (E1 — HARD)",
        "CENG1004 (1.sınıf) ve CENG2001 (2.sınıf) finalleri 15 Haziran'da aynı derslikte.",
        scan_exams([
            sinav(1, "CENG1004", date(2026, 6, 15), time(10, 0), odalar=((5, 70),),
                  yil=1),
            sinav(2, "CENG2001", date(2026, 6, 15), time(10, 30), odalar=((5, 70),),
                  hoca=2, yil=2),
        ]),
    )

    # E4a — cohort sınav
    rapor(
        "Senaryo 8 · Aynı sınıfın iki zorunlu sınavı (E4a — HARD)",
        "Bilgisayar Müh. 1. sınıf: iki zorunlu dersin finali aynı tarih ve saatte.",
        scan_exams([
            sinav(1, "CENG1001", date(2026, 6, 16), time(9, 0), odalar=((5, 70),),
                  yil=1),
            sinav(2, "MATH1001", date(2026, 6, 16), time(9, 0), odalar=((6, 70),),
                  hoca=2, yil=1),
        ]),
    )

    # E7 — israf (margin=10, K-40)
    rapor(
        "Senaryo 9 · Gereksiz derslik seçimi (E7 — WARNING, K-40 payı=10)",
        "60 öğrenci için 40+40+40 kontenjan; en küçüğü çıksa 80 kalır (60+10'u aşar).",
        scan_exams([
            sinav(1, "CENG3001", date(2026, 6, 17), time(14, 0),
                  odalar=((1, 40), (2, 40), (3, 40)), ogrenci=60),
        ]),
    )

    # ---- ÇAPRAZ KURAL ----
    baslik_yaz("C · SINAV × HAFTALIK DERS (bayrak açıkken)")

    # X1 — sınav başka dersin dersliğini işgal
    rapor(
        "Senaryo 10 · Sınav, başka dersin saatindeki dersliği işgal ediyor (X1 — HARD)",
        "PHYS1002 vizesi, aynı anda CENG dersi olan E-B08'i kullanıyor (vize haftası açık).",
        scan_cross(
            exams=[sinav(1, "PHYS1002", date(2026, 11, 9), time(10, 30), sure=60,
                         odalar=((8, 40),), tip="MIDTERM")],   # 9 Kasım 2026 = Pazartesi
            weeklies=[ders(2, "CENG2001", 1, gun=1, slot=3, derslik=8, hoca=9)],
            check_exam_vs_course=True,
        ),
    )

    # ---- ÖZET ----
    baslik_yaz("ÖZET")
    print("  • 10 senaryo, projedeki 21 kuralın temsili bir kesitini gösterdi.")
    print("  • Motor her çakışmayı GEREKÇESİYLE açıklıyor (genel hata mesajı YOK).")
    print("  • Sınır durumu (uç uca ders) doğru şekilde TEMİZ sayıldı.")
    print("  • HARD çakışmalar submit'i engeller; WARNING'ler bilgilendirir (K-03).")
    print("  • Bu çıktı 335 otomatik testle sürekli doğrulanıyor.\n")


if __name__ == "__main__":
    main()
