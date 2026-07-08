# Seed Data Planı (v0.1)

**Amaç:** Demo ve testlerin üzerinde koşacağı örnek veri. Rastgele veri DEĞİL —
her kayıt ya normal akışı ya da belirli bir çakışma kuralını (kural seti v1.1)
bilinçli tetikleyecek şekilde kurgulanmıştır. Stajyer C bu planı
`scripts/seed.py` olarak kodlar.

## 1. Workgroup ve Kullanıcılar

| Kayıt | Değerler |
|---|---|
| Workgroup | Mühendislik Fakültesi · allowed_email_domain: `muh.example.edu.tr` · check_exam_vs_course: true |
| Admin | Fakülte Yöneticisi · admin@muh.example.edu.tr · ACTIVE |
| Alt hesap 1 | Bilgisayar Sorumlusu · ceng@muh.example.edu.tr · can_manage_classrooms=TRUE · bölüm: CENG |
| Alt hesap 2 | Elektrik Sorumlusu · eee@muh.example.edu.tr · can_manage_classrooms=FALSE · bölüm: EEE |
| Bekleyen davet | pending@muh.example.edu.tr · PENDING (davet akışı demosu için) |

İki alt hesabın izin farkı bilinçli: K-02'nin iki yüzü de demoda gösterilebilsin.

## 2. Bölümler
- CENG — Bilgisayar Mühendisliği
- EEE — Elektrik-Elektronik Mühendisliği

## 3. Hocalar (K-08)

| Ad | Not |
|---|---|
| Doç. Dr. Ayşe Kaya | IMPORT — hem CENG hem EEE dersi verir → W2 tetikleyici |
| Prof. Dr. Mehmet Demir | IMPORT |
| Dr. Elif Arslan | IMPORT — online ders verir |
| Dr. Can Şahin | IMPORT |
| Öğr. Gör. Zeynep Yıldız | MANUAL, is_external=TRUE (40/a demosu) |

## 4. Derslikler

| Bina | Kod | Kapasite | Amaç |
|---|---|---|---|
| B Blok | B-201 | 60 | normal |
| B Blok | B-202 | 40 | normal |
| A Blok | A-101 | 120 | amfi |
| B Blok | LAB-1 | 30 | KÜÇÜK — W7 kapasite uyarısı tetikleyici |

## 5. Dersler (hepsi 2025-2026 Bahar / SPRING)

| Kod | Bölüm | Yıl | Ad | Hoca | Beklenen | Seçmeli |
|---|---|---|---|---|---|---|
| CENG2001-1 | CENG | 2 | İstatistik | Kaya | 55 | hayır |
| CENG2003-1 | CENG | 2 | Diferansiyel Denklemler | Demir | 55 | hayır |
| CENG2020-1 | CENG | 2 | Veri Yapıları | Şahin | 55 | hayır |
| CENG2051-1 | CENG | 2 | Yapay Zekaya Giriş | Arslan | 25 | EVET |
| CENG2052-1 | CENG | 2 | Oyun Programlama | Yıldız | 20 | EVET |
| MATH2002-1 | CENG | 2 | Mühendislik Matematiği | Demir | 55 | hayır |
| EEE2010-1 | EEE | 2 | Devre Analizi | Yıldız | 45 | hayır |
| EEE2015-1 | EEE | 2 | Sinyaller | Kaya | 45 | hayır |

İstatistik + Diferansiyel çifti bilinçli: hocanın K-05'te verdiği örneğin birebir kendisi.

## 6. Haftalık Program Girişleri — kural tetik haritası

| # | Giriş | Durum | Tetiklediği |
|---|---|---|---|
| 1 | CENG2001-1 · Pzt slot 1-2 · B-201 | SUBMITTED | temiz taban |
| 2 | CENG2003-1 · Pzt slot 2-3 · B-202 | DRAFT | **W3 HARD**: #1 ile cohort (2.sınıf Bahar, ikisi zorunlu, slot 2 kesişir) |
| 3 | EEE2015-1 · Pzt slot 1-2 · A-101 | SUBMITTED | **W2 HARD**: #1 ile hoca (Kaya iki bölümde aynı anda) — bölümler-arası çakışma kanıtı |
| 4 | CENG2051-1 · Sal slot 2-3 · Online (classroom NULL) | DRAFT | temiz; online ders görünümü (K-10) |
| 5 | CENG2052-1 · Sal slot 3-4 · LAB-1 | DRAFT | **W4 WARNING**: #4 ile cohort ama seçmeli (slot 3 kesişir) |
| 6 | CENG2020-1 · Sal slot 5-6 · LAB-1 | SUBMITTED | **W7 WARNING**: beklenen 55 > LAB-1 kapasite 30 |
| 7 | MATH2002-1 · Çar slot 1-2 · A-101 | SUBMITTED | temiz |
| 8 | EEE2010-1 · Cum slot 2 · A-101 | SUBMITTED | temiz |
| 9 | CENG2020-1 · Per slot 4 · B-201 | SUBMITTED | SINIR KANITI: hiçbir şeyle çakışmaz; #10 sınavıyla bitişik ama kesişmez |

Sınır testi ayrıca: #1 (slot 1-2) ile slot 3'te başlayan herhangi bir giriş
ÇAKIŞMAMALI — seed doğrulama script'i bunu assert eder.

## 7. Sınavlar (vize dönemi: Nisan 2026 hafta içi tarihleri)

| # | Sınav | Durum | Tetiklediği |
|---|---|---|---|
| S1 | CENG2001 Vize · Çar 15 Nisan · 18:00 · 90dk · A-101 | SUBMITTED | temiz + AKŞAM SINAVI KANITI (K-06: 17:30 sonrası geçerli) |
| S2 | CENG2003 Vize · Çar 15 Nisan · 18:30 · 90dk · A-101 | DRAFT | **E1 HARD**: S1 ile derslik+saat kesişimi; ayrıca **E4a HARD** (aynı cohort, ikisi zorunlu) |
| S3 | EEE2015 Vize · Per 16 Nisan · 10:30 · 60dk · B-201 | DRAFT | **X1 HARD**: Per slot 3-4'te B-201'de haftalık ders varsa; yoksa #9'u Per slot 3'e taşı — X1 kurgusu netleşsin. Ayrıca **X3 WARNING**: Kaya o saatte derste mi kontrolü |
| S4 | CENG2051 Vize · Cum 17 Nisan · 13:30 · 60dk · B-202 | SUBMITTED | temiz |
| S5 | (demo anında elle denenir) CENG2001 Vize İKİNCİ kayıt | — | **E2 HARD**: DB UNIQUE + motor mesajı; seed'e girmez, demo script'inde adım olarak yazılır |
| S6 | (demo anında elle denenir) Cumartesi tarihli sınav | — | **E6 HARD**: form zaten engellemeli; API'den denenirse 400 |

## 8. Beklenen Çakışma Raporu (seed sonrası GET /conflicts çıktısı)

HARD: W3 (#2), W2 (#3), E1+E4a (S2), X1 (S3)  → 4+ hard
WARNING: W4 (#5), W7 (#6), X3 (S3)             → 3 warning

Seed script'i sonunda bu tabloyu assert eden bir doğrulama bloğu içermeli:
beklenen kural id'leri raporda yoksa seed KIRIK demektir (Stajyer C'nin
motoru için canlı entegrasyon testi).

## 9. Demo Senaryosuna Bağlantı (doküman §10.3)

1. Admin girer → dashboard sayaçları doludur, çakışma kartı 4 HARD / 3 WARNING gösterir.
2. ceng@ hesabıyla girilir → yalnız CENG verisi görünür (izolasyon kanıtı).
3. Grid'de #2 (DRAFT, çakışmalı) submit edilmeye çalışılır → W3 mesajıyla RED.
4. #2 Salı boş slota taşınır → submit BAŞARILI → hücre kilitlenir.
5. S5 adımı: ikinci vize eklenmeye çalışılır → E2 engeli.
6. Export alınır → Excel çıktısında yıl sayfası düzeni görülür.
