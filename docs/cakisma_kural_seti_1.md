# Çakışma Motoru Kural Seti (v1.2 — K-12, K-13 işlendi)

**Kaynak:** Proje dokümanı §4 + karar defteri K-03, K-05, K-06, K-07, K-08, K-10.
**Sahibi:** Stajyer C. Bu belge hem implementasyon spesifikasyonu hem unit test şablonudur.

## Motorun İki Çalışma Anı [K-03]

| An | Davranış |
|---|---|
| **Kayıt (save)** | Tüm kurallar çalışır, sonuçlar kullanıcıya gösterilir, **hiçbir kural kaydı engellemez**. Giriş DRAFT olarak kaydedilir. |
| **Submit** | Tüm kurallar çalışır. **HARD sonuç varsa submit reddedilir**, WARNING varsa submit gerçekleşir ve uyarılar görünür kalır. |

**Karşılaştırma evreni:** Her iki anda da aday giriş(ler), workgroup'taki **DRAFT + SUBMITTED tüm girişlere** karşı test edilir. (Taslak bir ders, başka bölümün kilitli dersiyle çakışabilir; submit edilecek küme kendi içinde de çakışabilir.)

**Dönen sonuç yapısı:** `{severity, rule_id, affected_objects[], message}` — dokümanın "yapılandırılmış sonuç" şartı.

## Temel Zaman Matematiği

- Çakışma koşulu: `startA < endB AND startB < endA` (aynı gün/tarihte).
- **Sınır kuralı:** biri tam biterken diğeri başlıyorsa ÇAKIŞMA YOKTUR
  (09:15 biten × 09:30 başlayan → temiz; hatta 09:15 biten × 09:15 başlayan → temiz).
- Haftalık dersler: `day_of_week` + slot aralığı `[start_slot, start_slot+slot_count-1]`.
  Slot aralıkları kesişiyorsa çakışma (slot kümesi kesişimi yeterli).
- Sınavlar: `exam_date` + `[start_time, start_time + duration_minutes]`.
- Çapraz (sınav × ders): sınav tarihinden `day_of_week` türet; slotları slot
  tablosundan saat aralığına çevir; saat düzleminde kesişim testi yap.

## A. Haftalık Ders Kuralları

| ID | Kural | Koşul | Severity | Atlama koşulu |
|---|---|---|---|---|
| W1 | Derslik çakışması | Aynı `classroom_id`, aynı gün, kesişen slotlar | **HARD** | Taraflardan birinin `classroom_id` NULL ise [K-10] |
| W2 | Hoca çakışması | Aynı `lecturer_id`, aynı gün, kesişen slotlar | **HARD** | — |
| W3 | Cohort: zorunlu × zorunlu | Aynı bölüm+yıl+dönem, iki ders de `is_elective=false`, kesişen slotlar | **HARD** [K-05] | Aynı dersin kendisiyle karşılaştırması (o W5'in işi) |
| W4 | Cohort: seçmeli dahil | Aynı bölüm+yıl+dönem, en az biri `is_elective=true`, kesişen slotlar | **WARNING** [K-05] | — |
| W5 | Mükerrer ders-şube oturumu | Aynı `course_id`, kesişen slotlar | WARNING | — |
| W6 | Pencere dışı slot | Gün 1-5 dışında VEYA `start_slot+slot_count-1 > 9` | **HARD** | Sadece derslere uygulanır; sınavlara ASLA [K-06]. DB CHECK zaten koruyor; motor yine de anlaşılır mesaj üretir |
| W7 | Kapasite | `course.expected_students > classroom.capacity` | WARNING | `classroom_id` NULL ise |

## B. Sınav Kuralları

| ID | Kural | Koşul | Severity | Atlama koşulu |
|---|---|---|---|---|
| E1 | Sınav derslik çakışması | Aynı `classroom_id`, aynı tarih, kesişen saat aralıkları | **HARD** | Taraflardan biri NULL derslikli ise |
| E2 | Mükerrer sınav tipi | Aynı `course_id` + `exam_type` ikinci kayıt | **HARD** | — (DB UNIQUE zaten engeller; motor anlaşılır mesaj üretir) |
| E3 | Hoca/sorumlu çakışması | Aynı `lecturer_id`, aynı tarih, kesişen saatler | **HARD** [K-12] | — |
| E4a | Cohort sınav: zorunlu × zorunlu | Aynı bölüm+yıl+dönem, ikisi de zorunlu, kesişen tarih+saat | **HARD** [K-12] | — |
| E4b | Cohort sınav: seçmeli dahil | Aynı cohort, en az biri seçmeli | **WARNING** | — |
| E5 | Sınav kapasitesi | `course.expected_students > classroom.capacity` | WARNING | NULL derslik |
| E6 | Hafta sonu tarihi | `exam_date` Cmt/Paz | **HARD** [K-06] | — (DB CHECK yedekli) |

Not: Sınavlarda **saat penceresi kuralı yoktur** — 17:30 sonrası serbesttir [K-06].

## C. Çapraz Kural: Sınav × Haftalık Ders [K-06, AÇIK]

`workgroup.check_exam_vs_course = true` iken çalışır (vize dönemleri için açık).
Dokümandaki tek satırlık "exam vs course" kuralı aslında üç ayrı fiziksel duruma ayrışır:

| ID | Kural | Koşul | Severity (öneri) |
|---|---|---|---|
| X1 | Derslik işgali | Sınav, aynı derslikteki haftalık dersle kesişiyor | **HARD** — fiziksel imkânsızlık, oda ikiye bölünemez |
| X2 | Cohort | Sınav, aynı cohort'un (bölüm+yıl+dönem) haftalık dersiyle kesişiyor | WARNING — vize haftasında dersler fiilen boş geçebilir; engellemek aşırı katı olur |
| X3 | Hoca | Sınav sorumlusu, aynı anda haftalık derste görünüyor | WARNING — ders o hafta yapılmıyor olabilir |

**Aynı ders istisnası [K-13]:** X1/X2/X3 karşılaştırmalarında sınavın dersi ile
haftalık girişin dersi aynıysa (`exam.course_id == weekly_entry.course_id`) o
karşılaştırma ATLANIR. Bir dersin sınavı kendi normal yerinde/saatinde/hocasıyla
yapıldığında sahte çakışma üretilmemesi için. Gerçek çakışma yalnızca sınav BAŞKA
bir dersin oda/cohort/hoca alanına girince doğar.

Karşılaştırma: yalnızca sınav tarihi hafta içiyse ve sınav saati 08:30-17:30
penceresiyle kesişiyorsa anlamlıdır (17:30 sonrası sınav hiçbir dersle kesişemez —
bu, ucuz bir ön-eleme optimizasyonudur).

## Açık Kararlar (ekip onayı bekliyor)

1. **E3 severity:** Doküman "hard veya warning" diyor. Öneri: **HARD** — W2 ile tutarlı
   (bir hoca iki yerde olamaz). Onaylanmalı.
2. **E4 severity ayrımı:** K-05 haftalık dersler için verildi; sınavlara aynı mantığın
   (zorunlu×zorunlu=hard, seçmeli=warning) uygulanması önerildi. Onaylanmalı.
3. **X2/X3 severity:** WARNING önerildi (gerekçe tabloda). Onaylanmalı.

## Unit Test Şablonu (Stajyer C)

Her kural için asgari dört test sınıfı:

1. **Pozitif:** Kural ihlali var → doğru severity + doğru rule_id döner.
2. **Negatif:** İhlal yok → sonuç boş.
3. **Sınır:** Biri tam biterken diğeri başlıyor → ÇAKIŞMA YOK
   (dokümanın açıkça istediği boundary case; W1-W5, E1, E3, E4, X1-X3 için zorunlu).
4. **Atlama:** Atlama koşulu aktif (NULL derslik, farklı gün, farklı workgroup) → kural sessiz.

Ek senaryo testleri:
- Submit kümesi kendi içinde çakışıyor (iki DRAFT birbiriyle) → HARD yakalanır.
- DRAFT giriş, SUBMITTED girişle çakışıyor → HARD yakalanır.
- Save anında HARD var → sonuç döner AMA kayıt başarılıdır (engellenmez).
- Submit anında yalnızca WARNING var → submit BAŞARILIDIR, uyarılar raporda görünür.
- İki slotluk ders (slot 3-4) × tek slotluk ders (slot 4) → çakışır.
- İki slotluk ders (slot 3-4) × tek slotluk ders (slot 5) → çakışmaz.
- 17:31'de başlayan sınav × slot 9 dersi (16:30-17:15) → çakışmaz (X kuralları).
- Matematik vizesi, Matematik dersinin kendi yerinde/saatinde → X1/X2/X3 HİÇBİRİ tetiklenmez [K-13].
- Matematik vizesi, aynı odada BAŞKA dersin (Fizik) olduğu saate → X1 HARD tetiklenir.
- Aynı saat farklı gün / aynı gün farklı workgroup → çakışmaz.

## Mesaj Şablonları (doküman §4.4 formatında)

- W1: "Derslik çakışması: {courseA}-{secA} ve {courseB}-{secB}, {gün} {saat aralığı}'nda aynı {bina} {oda} dersliğini kullanıyor."
- W3: "Cohort çakışması: {bölüm} {yıl}. sınıf {dönem} zorunlu dersleri {courseA} ve {courseB}, {gün} {aralık}'ta çakışıyor."
- E1: "Sınav çakışması: {courseA} ve {courseB} sınavları {tarih}'te {bina} {oda}'da çakışıyor."
- X1: "Sınav-ders çakışması: {course} {tip} sınavı, {tarih} ({gün}) {aralık}'ta {bina} {oda}'daki {weeklyCourse} dersiyle çakışıyor."

Tüm mesajlar insan-okur formatında, nesne adlarıyla; ID'siz genel hata mesajı YASAK (doküman şartı).
