# Çakışma Motoru Kural Seti (v1.4 — K-14..K-21 işlendi, 13-14 Temmuz hoca toplantısı)

**Kaynak:** Proje dokümanı §4 + karar defteri K-03, K-05..K-08, K-12..K-21.
**Sahibi:** Stajyer C. Bu belge hem implementasyon spesifikasyonu hem unit test şablonudur.
**v1.3/v1.4 değişiklikleri (Stajyer A tarafından taslaklandı, C'nin onayı bekleniyor):**
şube-farkındalıklı cohort (W3/W4), asenkron muafiyeti (ön-eleme), W8 tamlık kuralı,
sınavın ders düzeyine taşınması, çoklu derslik + exam_capacity (E1/E5/E5a/E7).

## Ön-Eleme: Asenkron Muafiyeti [K-19]

`delivery_mode = 'ONLINE_ASYNC'` olan haftalık giriş, gün/saat taşısa bile
**hiçbir çakışma karşılaştırmasına girmez**: taraflarından biri asenkron olan
her (giriş, giriş) ve (sınav, giriş) çifti W1-W5, W7 ve X1-X3'te ATLANIR.
İstisnalar: W6 (pencere) girişin kendi geçerliliğidir, asenkron için de çalışır;
W8 (tamlık) toplamına asenkron oturumlar DAHİLDİR (normal gün/saat taşırlar).
`ONLINE_SYNC` girişlerde muafiyet YOKTUR: dersliği olmadığından W1/W7 zaten
NULL-derslik koşuluyla susar; W2 (hoca) ve W3/W4 (cohort) normal çalışır.

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

Genel not [K-14]: haftalık giriş artık **şubeye** (`section_id`) bağlıdır;
`course` = şubenin dersi (kod düzeyi). Tüm kurallarda asenkron ön-elemesi geçerli.

| ID | Kural | Koşul | Severity | Atlama koşulu |
|---|---|---|---|---|
| W1 | Derslik çakışması | Aynı `classroom_id`, aynı gün, kesişen slotlar | **HARD** | Taraflardan birinin `classroom_id` NULL ise [K-10] |
| W2 | Hoca çakışması | Aynı `section.lecturer_id`, aynı gün, kesişen slotlar | **HARD** | — |
| W3 | Cohort: zorunlu × zorunlu | Aynı bölüm+yıl+dönem, iki FARKLI ders, ikisi de `is_elective=false`, **şube-farkındalıklı çakışma** (aşağıda) | **HARD** [K-05, K-15] | Aynı dersin şubeleri arası karşılaştırma (şubeler alternatiftir; aynı şube içi mükerrerlik W5'in işi) |
| W4 | Cohort: seçmeli dahil | Aynı bölüm+yıl+dönem, iki FARKLI ders, en az biri `is_elective=true`, **şube-farkındalıklı çakışma** | **WARNING** [K-05, K-15] | — |
| W5 | Mükerrer şube oturumu | Aynı `section_id`, kesişen slotlar | WARNING | — |
| W6 | Pencere dışı slot | Gün 1-5 dışında VEYA `start_slot+slot_count-1 > 9` | **HARD** | Sadece derslere uygulanır; sınavlara ASLA [K-06]. DB CHECK zaten koruyor; motor yine de anlaşılır mesaj üretir |
| W7 | Kapasite | `section.expected_students > classroom.capacity` | WARNING | `classroom_id` NULL ise |
| W8 | T+U+L tamlığı [K-20] | Şubenin `session_type` bazında SUM(slot_count) ≠ dersin `hours_theory/practice/lab` değeri (eksik VEYA fazla) | WARNING | **Yalnız submit anında** çalışır; save'de sessiz [K-20]. hours değeri 0 olan bileşen için giriş yoksa kontrol edilmez |

### Şube-farkındalıklı cohort çakışması [K-15]

W3/W4, ders (kod) düzeyinde değerlendirilir:

1. Aynı cohort'taki (bölüm+yıl+dönem) iki farklı ders A ve B için tüm aktif
   şube çiftleri (a ∈ A.sections, b ∈ B.sections) kurulur.
2. Bir (a, b) çifti "uyumsuz"dur ⇔ a'nın herhangi bir oturumu ile b'nin
   herhangi bir oturumu kesişir (asenkron oturumlar kesişim hesabına girmez).
3. **En az bir uyumlu (a, b) çifti varsa çakışma YOKTUR** — öğrenci o
   kombinasyonu seçebilir. TÜM çiftler uyumsuzsa W3/W4 üretilir.

Örnek [S]: A1×B1 aynı saatte, A2×B2 aynı (ama farklı) saatte → (A1,B2) ve
(A2,B1) uyumlu → çakışma yok. Tek şubeli iki ders çakışıyorsa (tek çift, o da
uyumsuz) → eski davranışla birebir aynı sonuç.

Not: `affected_objects` uyumsuzluğu kanıtlayan somut giriş çiftlerini içermeli
ki B raporda "hangi oturumlar" gösterebilsin.

## B. Sınav Kuralları

Genel not [K-16, K-17]: sınav artık **ders düzeyindedir** (şubeden bağımsız,
tüm şubeler aynı sınava girer) ve **birden çok dersliği** olabilir
(`exam_classrooms`). "Dersliksiz sınav" = sıfır derslik satırı.
Sınavın öğrenci sayısı: `total_expected = SUM(dersin aktif şubelerinin
expected_students)`.

| ID | Kural | Koşul | Severity | Atlama koşulu |
|---|---|---|---|---|
| E1 | Sınav derslik çakışması | İki sınavın derslik KÜMELERİ kesişiyor (ortak en az bir derslik) ve aynı tarih, kesişen saat aralıkları | **HARD** | Taraflardan birinin derslik kümesi boşsa |
| E2 | Mükerrer sınav tipi | Aynı `course_id` (ders) + `exam_type` ikinci kayıt | **HARD** | — (DB UNIQUE zaten engeller; motor anlaşılır mesaj üretir) |
| E3 | Hoca/sorumlu çakışması | Aynı `lecturer_id`, aynı tarih, kesişen saatler | **HARD** [K-12] | — |
| E4a | Cohort sınav: zorunlu × zorunlu | Aynı bölüm+yıl+dönem, ikisi de zorunlu, kesişen tarih+saat | **HARD** [K-12] | — (sınav ders düzeyinde olduğundan şube esnekliği YOKTUR — herkes aynı sınavda) |
| E4b | Cohort sınav: seçmeli dahil | Aynı cohort, en az biri seçmeli | **WARNING** | — |
| E5 | Sınav kontenjanı yetersiz [K-17] | `SUM(seçili dersliklerin exam_capacity) < total_expected` → "ek derslik seçin" mesajı | WARNING | Derslik kümesi boşsa VEYA kümede exam_capacity=NULL derslik varsa (önce E5a) |
| E5a | Kontenjansız derslik seçimi [K-21] | Seçili dersliklerden birinin `exam_capacity` değeri NULL | WARNING — "sınav kontenjanı girilmemiş, önce derslik kaydına girin" | Derslik kümesi boşsa |
| E6 | Hafta sonu tarihi | `exam_date` Cmt/Paz | **HARD** [K-06] | — (DB CHECK yedekli) |
| E7 | Gereksiz kontenjan fazlası [K-17] | EN KÜÇÜK `exam_capacity`'li derslik çıkarıldığında kalan toplam `>= total_expected + 10` ise (bariz fazlalık, K-40) | WARNING | Derslik sayısı <= 1 VEYA kümede exam_capacity=NULL derslik varsa (önce E5a) |

Not: Sınavlarda **saat penceresi kuralı yoktur** — 17:30 sonrası serbesttir [K-06].
Not: E5/E7'de `capacity` DEĞİL `exam_capacity` kullanılır (boşluklu oturma, K-17).
E7 eşiği **margin=10** olarak sabitlendi (K-40): tam sınırda oturan sınav
"gereksiz" diye uyarılmasın, yalnız bariz fazlalık tetiklensin.

## C. Çapraz Kural: Sınav × Haftalık Ders [K-06, AÇIK]

`workgroup.check_exam_vs_course = true` iken çalışır (vize dönemleri için açık).
Dokümandaki tek satırlık "exam vs course" kuralı aslında üç ayrı fiziksel duruma ayrışır:

| ID | Kural | Koşul | Severity (öneri) |
|---|---|---|---|
| X1 | Derslik işgali | Sınavın derslik kümesinden HERHANGİ biri, aynı derslikteki haftalık dersle kesişiyor | **HARD** — fiziksel imkânsızlık, oda ikiye bölünemez |
| X2 | Cohort | Sınav, aynı cohort'un (bölüm+yıl+dönem) haftalık dersiyle kesişiyor | WARNING — vize haftasında dersler fiilen boş geçebilir; engellemek aşırı katı olur |
| X3 | Hoca | Sınav sorumlusu, aynı anda haftalık derste görünüyor | WARNING — ders o hafta yapılmıyor olabilir |

Haftalık taraf `ONLINE_ASYNC` ise X1/X2/X3 atlanır (ön-eleme, K-19).

**Aynı ders istisnası [K-13]:** X1/X2/X3 karşılaştırmalarında sınavın dersi ile
haftalık girişin dersi aynıysa (`exam.course_id == weekly_entry.section.course_id`
— sınav ders düzeyinde olduğundan dersin HERHANGİ bir şubesinin oturumu bu
istisnaya girer, K-16) o karşılaştırma ATLANIR. Bir dersin sınavı kendi normal
yerinde/saatinde/hocasıyla yapıldığında sahte çakışma üretilmemesi için. Gerçek
çakışma yalnızca sınav BAŞKA bir dersin oda/cohort/hoca alanına girince doğar.

Karşılaştırma: yalnızca sınav tarihi hafta içiyse ve sınav saati 08:30-17:30
penceresiyle kesişiyorsa anlamlıdır (17:30 sonrası sınav hiçbir dersle kesişemez —
bu, ucuz bir ön-eleme optimizasyonudur).

## Açık Kararlar — HEPSİ KAPANDI (24 Temmuz)

1. ~~E3 / E4 / X2-X3 severity'leri~~ → K-12 ile onaylandı (v1.2).
2. ~~v1.3 değişiklik seti~~ (şube-farkındalıklı W3/W4, asenkron ön-eleme, W8,
   ders düzeyi sınav, E1/E5/E7) → Stajyer C onayladı ve `wp5-engine-v14`'te
   uyguladı; `wp5-motor-entegrasyon`'da API'ye bağlandı (K-39).
3. ~~E7 israf eşiği~~ → K-40 ile margin=10 olarak sabitlendi.

Ek karar (K-40): **W8** save'de sessiz, submit'te ve tam taramada WARNING üretir.

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

v1.3 ek senaryoları [K-15, K-19, K-20, K-17]:
- A1×B1 çakışık, A2×B2 çakışık (farklı saatte) → W3 YOK (uyumlu kombinasyon var).
- A1×B1 çakışık, A1×B2 çakışık, A tek şubeli → W3 VAR (tüm çiftler uyumsuz).
- Tek şubeli iki zorunlu ders çakışık → W3 VAR (eski davranışla aynı).
- Asenkron giriş × aynı saatte aynı hocanın başka dersi → W2 YOK (ön-eleme).
- Senkron online giriş × aynı hocanın aynı saatte dersi → W2 VAR.
- Asenkron giriş W8 toplamına dahil: 3+0+0 ders, 2 slot yüz yüze + 1 slot
  asenkron THEORY → W8 YOK.
- 3+2+0 ders, submit'te teori 2 slot yerleşmiş → W8 WARNING (eksik).
  Teori 4 slot → W8 WARNING (fazla). Lab girişi yok (L=0) → sessiz.
- Sınav: exam_capacity 40+40, total_expected 90 → E5 WARNING (yetersiz).
- Sınav: exam_capacity 40+40+40, total_expected 75 → E7 WARNING (40 çıkınca 80 >= 75).
- İki sınav ortak dersliği paylaşıyor, saatler kesişik → E1 HARD (küme kesişimi).
- Aynı dersin (kod) iki şubesinin oturumları çakışık → W3/W4 YOK, W5 de YOK
  (farklı section_id); şubeler alternatiftir.

## Mesaj Şablonları (doküman §4.4 formatında)

- W1: "Derslik çakışması: {courseA}-{secA} ve {courseB}-{secB}, {gün} {saat aralığı}'nda aynı {bina} {oda} dersliğini kullanıyor."
- W3: "Cohort çakışması: {bölüm} {yıl}. sınıf {dönem} zorunlu dersleri {courseA} ve {courseB}, {gün} {aralık}'ta çakışıyor."
- E1: "Sınav çakışması: {courseA} ve {courseB} sınavları {tarih}'te {bina} {oda}'da çakışıyor."
- X1: "Sınav-ders çakışması: {course} {tip} sınavı, {tarih} ({gün}) {aralık}'ta {bina} {oda}'daki {weeklyCourse} dersiyle çakışıyor."

Tüm mesajlar insan-okur formatında, nesne adlarıyla; ID'siz genel hata mesajı YASAK (doküman şartı).
