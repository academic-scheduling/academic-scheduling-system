# Proje Karar Defteri (Decision Log)

**Proje:** Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
**Son güncelleme:** 11 Ağustos 2026 (Not: W6/E2/E6 DB şemasıyla engelli · K-60: sınav onay akışı tamamlandı — yayına yazan tek yol onay)
**Amaç:** Doküman WP0 gereği, gereksinim netleştirme kararlarının izlenebilir kaydı.
Kaynaklar: [S] = Süpervizör cevabı, [E] = Ekip kararı, [D] = Doküman varsayılanı.

---

## K-01 · Tech Stack [E]
FastAPI (Python 3.12) + SQLAlchemy 2 + Alembic + PostgreSQL 16 (Docker) ·
React 18 + Vite + TypeScript + Mantine UI · JWT auth · Mailpit (sandbox e-posta) ·
pytest · GitHub (repo + Issues) · Docker Compose · openpyxl (XLSX) · Excalidraw (wireframe).
**Gerekçe:** Hızlı CRUD geliştirme, otomatik OpenAPI kontratı, saf Python'da test
edilebilir çakışma servisi.

## K-02 · Derslik yönetim yetkisi [S]
Derslik ekleme/çıkarma yetkisi **kullanıcı bazlı bir izindir**; admin bu izni
**davet/hesap oluşturma sırasında** seçer. Şema karşılığı: `users.can_manage_classrooms`.
Ortak dersliklerin korunması için silme yerine soft delete (`active=false`) esastır.

## K-03 · Hard conflict davranışı: kaydet, submit etme [S]
Hard çakışma **kaydı engellemez**, **submit'i engeller**. Program girişleri
(haftalık oturum + sınav) `DRAFT` / `SUBMITTED` durumu taşır.
- Kayıt anı: çakışma kontrolü çalışır, sonuç **bilgilendirir**, engellemez.
- Submit anı: motor taslaklar + kilitli girişlerin **tamamına** bakar; hard
  conflict varsa submit reddedilir ve çakışma listesi gösterilir.
- Submit sonrası girişler kilitlenir (salt-okunur). Değişiklik = girişi tekrar
  DRAFT'a çevir → düzenle → yeniden submit. [E: değişiklik-seti modeli]
- Submit'i **alt hesap yapabilir**. [S+E]

## K-04 · Admin çakışma görünürlüğü [S]
Admin, workgroup'taki **tüm bölümlerin** çakışmalarını görür. Çakışma rapor
sayfası admin için workgroup genelinde çalışır.

## K-05 · Cohort kuralı: yıl + dönem, seçmeli ayrımı [S]
Cohort = bölüm + yıl + dönem. Severity, zorunlu/seçmeli ayrımına göre:
- **Zorunlu × zorunlu** aynı cohort çakışması → **hard** (submit engeli).
  Örnek [S]: 2. sınıf 2. dönem İstatistik ile Diferansiyel Denklemler.
- **Seçmeli dahil** herhangi bir cohort çakışması → **soft warning**
  (görünür kalır, engellemez).
Şema karşılığı: `courses.is_elective` MVP'de aktif kullanılır.

## K-06 · Sınav zaman kuralları [S+E]
- Vizeler ders haftalarında yapılır → **exam-vs-course çakışma kontrolü AÇIK**. [S]
- Sınavlarda saat kısıtı **yok**; hafta içi 17:30 sonrasına sınav konulabilir. [S]
- **Hafta sonu sınav yok**: sınav tarihi Pazartesi–Cuma olmalı; hafta sonu
  tarihi → hard error. [E]
- 08:30–17:30 slot penceresi ve slot hizalama kuralı **yalnızca haftalık
  ders oturumları** için geçerlidir; sınavlara uygulanmaz.

## K-07 · Kapasite alanları [S+E]
- `classrooms.capacity`: derslik oluşturulurken **zorunlu**. [S]
- `courses.expected_students`: ders oluşturulurken girilir. [E]
  Öneri: zorunlu tutulmalı, aksi halde kapasite uyarı kuralı fiilen çalışmaz.
- Kapasite kuralı: beklenen öğrenci > derslik kapasitesi → **warning**.

## K-08 · Lecturer: yönetilen entity [S+E]
Serbest metin YOK. `lecturers` tablosu; ders formunda autocomplete ile seçilir.
- Fakülte hocaları: fakülte web sayfasından **bir kerelik import**. [S]
- 40/a dış görevlendirmeler: admin listeye **elle ekler** (yine entity). [E]
- Periyodik web senkronu → backlog.
Şema etkisi: `courses.lecturer` (text) → `courses.lecturer_id` (FK).
Gerekçe: "A. Yılmaz" / "Ahmet Yılmaz" tutarsızlığı hoca çakışma tespitini bozar.

## K-09 · Export formatları [S]
**XLSX + PDF** hedeflenir (PDF "Could"dan kapsama alındı). CSV teknik taban
olarak kalır. Format referansı: paylaşılan örnek dosyanın grid düzeni —
yıl bazlı sayfalar, gün × 15-dk zaman dilimi grid'i, hücrede
kod+şube+ad+hoca+derslik. Ayrıntılı format görüşmesi **ertelendi**
(Hafta 3, export işi başlarken). [ERTELENDİ]

## K-10 · Online/uzaktan dersler [ERTELENDİ]
Örnek dosyada dersliksiz (online) dersler mevcut. Karar sonraya bırakıldı. [E]
Alınan önlem: `classroom_id` şemada şimdiden **nullable**; çakışma motoru
dersliksiz girişte derslik kuralını atlar, cohort kuralını uygular.
Açık alt soru: senkron/asenkron ayrımı cohort kuralını etkiler mi?

## K-11 · MVP'de override yok [D]
Hard conflict için admin override'ı MVP'de yok; K-03'teki taslak/submit modeli
esneklik ihtiyacını zaten karşılıyor (çakışmalı taslak tutulabilir). Backlog: Could.

---

## Kapsam Değişiklikleri Özeti (dokümana göre)
| Konu | Doküman | Güncel karar |
|---|---|---|
| Hard conflict | Kaydı engeller | Submit'i engeller (DRAFT/SUBMITTED yaşam döngüsü) |
| Seçmeli ayrımı | Netleştirilecek | MVP kuralı: seçmeli → soft warning |
| Exam-vs-course | Configurable, belirsiz | Vize için AÇIK |
| Sınav saat penceresi | Belirsiz | Kısıt yok (hafta içi olmak şartıyla) |
| Lecturer | Serbest metin önerisi | Yönetilen entity + web import |
| PDF export | Could | Kapsamda (format ertelendi) |
| Şube (section) | Tek courses tablosu | courses + course_sections ayrımı (K-14) |
| Cohort kuralı | Şubeden habersiz | Şube-farkındalıklı, kod düzeyinde (K-15) |
| Sınav | Şube başına | Şubeden bağımsız, ders düzeyinde tek sınav (K-16) |
| Sınav dersliği | Tek derslik (nullable) | Çoklu derslik + exam_capacity (K-17) |
| Bina | Serbest metin | buildings tablosu (K-18) |
| Online ders | Ertelendi (K-10) | delivery_mode giriş düzeyinde; asenkron muaf (K-19) |
| Ders saatleri | Yok | T+U+L + session_type + W8 tamlık kuralı (K-20) |
| Yazma yetkisi | Yalnız derslik izne bağlı (§2.1) | Beş yetenek bayrağı (K-25) |
| Alt hesap görünürlüğü | Yalnız atanmış bölümler | Workgroup içi tümü salt-okunur (K-26) |
| Ders–bölüm ilişkisi | Ders tek bölüme ait | Ortak ders çok-cohort'lu (course_cohorts, K-48) |

## Açık / Ertelenen Konular
1. ~~Online derslerin derslik ve cohort davranışı (K-10)~~ → K-19 ile kapandı
2. XLSX/PDF ayrıntılı format şablonu (K-09) — Hafta 3
3. `expected_students` zorunlu mu opsiyonel mi — ekip önerisi zorunlu, onay bekliyor (K-07)
4. ~~Lecturer import'unun kaynağı olan fakülte sayfasının URL'i ve veri yapısı (K-08)~~ → K-50 ile kapandı
5. ~~E7 israf uyarısının eşiği~~ → K-40 ile kapandı (margin=10 sabitlendi).
6. **Çoklu workgroup [S] — hoca talebi, KARAR BEKLİYOR (17 Tem itibarıyla).**
   Bugünkü sistem tek workgroup varsayıyor: `users.workgroup_id` tekil FK,
   workgroup endpoint'i yok, workgroup'u `create_admin.py` yaratıyor. Brief
   çelişkili: §1 "one or more" derken §2 "Owns a scheduling group" diyor ve
   §5 veri modelinde `User.workgroup_id` hiç yok.
   Konuşulan tasarım: admin çoklu (sahiplik `workgroups.created_by` üzerinden),
   alt hesap tekli; aktif workgroup **token claim'i** ile taşınır
   (`POST /auth/select-workgroup` yeni token üretir; kontratın "istemci
   workgroup_id göndermez" kuralı korunur). Şema değişikliği gerektirmez.
   Bilinen sınırlama: `users.email` global unique olduğundan aynı e-posta iki
   workgroup'a davet edilemez.
   **Son tarih:** Hafta 4 başı; o güne dek karar çıkmazsa fiilen "MVP'de yok"
   demektir. Tahmini maliyet ~2,5-3 gün (izolasyon filtreleri 8 router'da
   revize edilir). K-25 ile aynı dosyalara (deps.py, kontrat §1-2) dokunduğu
   için birlikte planlanmalı.

## K-12 · Sınav/çapraz kural severity'leri [E]
Kural setindeki üç açık severity kararı onaylandı:
- **E3** (sınav hoca/sorumlu çakışması) → **HARD** (haftalık W2 ile tutarlı; hoca aynı anda iki sınavda olamaz).
- **E4** (cohort sınav çakışması) → K-05 mantığı sınavlara da uygulanır: zorunlu×zorunlu = **HARD**, seçmeli dahil = **WARNING**.
- **X2 / X3** (sınav×ders cohort ve hoca çakışması) → **WARNING** (vize haftasında ders fiilen yapılmayabilir; engellemek aşırı katı olur). X1 (derslik) HARD kalır.

## K-13 · Sınav×ders (X kuralları) aynı ders istisnası [E]
X1/X2/X3 çapraz kuralları çalışırken, sınavın dersi ile haftalık ders girişinin
dersi **aynıysa** (`exam.course_id == weekly_entry.section.course_id`) o
karşılaştırma **atlanır** — çakışma üretmez.
**Gerekçe:** Bir dersin sınavı, o dersin normal haftalık yerinde/saatinde/hocasıyla
yapıldığında oda, cohort ve hoca "çakışması" görünür ama gerçek değildir: çakışan
iki nesne aynı derse aittir, öğrenciler zaten o saatte o dersteydi. İstisna olmazsa
"dersin sınavını kendi yerinde yapmak" gibi tamamen normal bir durum yanlışlıkla
3 uyarı birden üretir. Gerçek çakışma ancak sınav BAŞKA bir dersin
oda/cohort/hoca alanına girdiğinde doğar.
(Not: K-14 ders/şube ayrımından sonra karşılaştırma şube değil ders kimliği
üzerinden yapılır — bir dersin sınavı, dersin HERHANGİ bir şubesinin oturumuyla
karşılaştırılırken atlanır.)

## K-14 · Ders / şube (section) ayrımı: iki tablo [S+E]
Hoca bildirdi [S]: bir ders birden çok şube ile açılabilir; şubeler farklı
hoca/saat/derslikte olabilir, aynı hoca birden çok şubeye de girebilir; haftalık
programa her şube ayrı yerleştirilir. Şema kararı [E]: tek `courses` tablosu
yerine **`courses` (ders, kod düzeyi) + `course_sections` (şube)** ayrımı.
- Ders düzeyi: bölüm, yıl, dönem, kod, ad, zorunlu/seçmeli, T+U+L saatleri.
- Şube düzeyi: şube no, hoca, beklenen öğrenci, varsayılan derslik.
**Gerekçe:** ad/T+U+L/seçmelilik kod düzeyinin özelliğidir; şube başına
kopyalanırsa şubeler arasında tutarsızlaşabilir (A1: 3+2+0, A2: 3+0-0 gibi).
Sınavın şubeden bağımsızlığı (K-16) bu ayrımla şemada garanti edilir.

## K-15 · Şube-farkındalıklı cohort çakışması [S]
W3/W4 cohort kuralları **ders (kod) düzeyinde** değerlendirilir: aynı cohort'taki
iki ders ancak **tüm şube kombinasyonları çakışıyorsa** çakışmış sayılır.
En az bir çakışmayan (şubeA, şubeB) çifti varsa öğrenciler o kombinasyonu
seçebilir → çakışma YOK. Örnek [S]: A1×B1 aynı saatte ve A2×B2 aynı saatte
(farklı bir saatte) ise B1 alan öğrenci A2'yi seçer → temiz.
Şube çifti "çakışıyor" = iki şubenin herhangi iki oturumu kesişiyor
(asenkron oturumlar hariç, K-19).

## K-16 · Sınav şubeden bağımsız [S]
Şubeli derslerin sınavı **tektir**: tüm şubeler aynı sınava girer. Sınav
`courses` (ders düzeyi) tablosuna bağlanır; UNIQUE(ders, sınav tipi) korunur.
Sınavın öğrenci sayısı = dersin tüm şubelerinin `expected_students` toplamı.

## K-17 · Sınav kontenjanı ve çoklu derslik [S]
- `classrooms.exam_capacity`: boşluklu oturma düzeni kontenjanı; derslik
  eklenirken yetkili tarafından girilir, **zorunlu**, `<= capacity` (örn.
  kapasite 90 → sınav kontenjanı 40).
- Bir sınava **birden çok derslik** atanabilir: `exam_classrooms` (çok-a-çok).
  Tek `classroom_id` alanı kalktı; dersliksiz sınav = sıfır satır (K-10 nullable
  semantiğinin yerini alır).
- Yeni uyarılar: seçilen dersliklerin `exam_capacity` toplamı öğrenci sayısını
  karşılamıyorsa → **WARNING** "ek derslik seçin" (E5 yeniden tanımlandı);
  bir derslik çıkarıldığında kontenjan hâlâ yetiyorsa (gereksiz fazla seçim)
  → **WARNING** israf uyarısı (yeni E7).

## K-18 · Bina: yönetilen entity [E]
`classrooms.building` serbest metni yerine **`buildings` tablosu**
(workgroup'a bağlı, id + ad). Derslik formu binayı listeden seçer.
**Gerekçe:** serbest metinde aynı bina farklı yazılır ("Müh. Fak." /
"Mühendislik"); derslik çakışma tespiti ve raporlar bina adına dayanır.

## K-19 · Online dersler: delivery_mode giriş düzeyinde [S+E] — K-10 kapandı
Haftalık girişe `delivery_mode` alanı: `FACE_TO_FACE / ONLINE_SYNC / ONLINE_ASYNC`.
- Giriş düzeyinde tutulur [E]: aynı dersin teorisi online, lab'ı yüz yüze olabilir.
- **Asenkron** girişler normal gün/saatle girilir ve programda görünür [S+E],
  ancak **hiçbir çakışma karşılaştırmasına girmez** (W1-W5, W7, X1-X3 muaf;
  sabit saatte fiilen kimse bir yerde bulunmaz).
- **Senkron online**: saati sabittir; derslik yok (classroom_id NULL → W1/W7
  zaten atlanır) ama **W2 (hoca) ve W3/W4 (cohort) çalışmaya devam eder**.

## K-20 · T+U+L ders saatleri ve tamlık kuralı [S+E]
- Derse `hours_theory / hours_practice / hours_lab` (T+U+L, örn. Fizik 3+2+0)
  girilir. U/L ayrımının doğruluğu **sorgulanmaz**; değerler olduğu gibi alınır [S].
- Haftalık girişe `session_type` alanı: `THEORY / PRACTICE / LAB` — her
  yerleştirme hangi bileşeni karşıladığını söyler.
- Yeni kural **W8 (tamlık)**: bir şubenin bileşen bazında yerleştirilen slot
  toplamı T/U/L değerinden **eksik veya fazla** ise uyarı. Tetiklenme anı [E]:
  **submit'te WARNING** (save sırasında sessiz — yerleştirme sürerken "hâlâ
  eksik" uyarısı yağdırmamak için; K-03 save/submit ikiliğiyle tutarlı).
  Asenkron oturumlar da normal gün/saat taşıdığından tamlık toplamına dahildir.

## K-21 · exam_capacity opsiyonel; sınav dersliği seçiminde istenir [S+E] — K-17 revizyonu
Her derslikte sınav yapılmaz. `classrooms.exam_capacity` bu yüzden derslik
eklenirken ZORUNLU DEĞİLDİR (NULL olabilir); K-17'deki "zorunlu" ifadesi
geçersizdir.
- Sınav yeri seçiminde, seçilen dersliğin `exam_capacity`'si NULL ise motor
  WARNING üretir: "bu dersliğin sınav kontenjanı girilmemiş" — kullanıcı
  önce derslik kaydına kontenjanı girer (PATCH /classrooms/{id}), sonra
  sınav yerleşimine devam eder.
- E5 toplam kontenjan kontrolü, yalnızca TÜM seçili dersliklerin
  exam_capacity'si doluyken hesaplanabilir; NULL'lu derslik varken toplam
  karşılaştırması yapılmaz (önce eksik veri uyarısı).
- Girildiğinde kural aynı: `exam_capacity > 0 AND exam_capacity <= capacity`.

## K-22 · Sınav PATCH endpoint'i + çakışma servisi dikişi [E]
WP4 başlangıcında (14 Temmuz, üç stajyerin onayıyla) iki karar:
- Kontrat §8'e `PATCH /exams/{id}` (yalnız DRAFT) eklendi. Gerekçe: haftalık
  programda PATCH vardı, sınavda unutulmuştu; brief kabul kriteri "sınav
  kayıtları düzenlenebilir" diyor. Haftalıkla aynı DRAFT-only sözleşme.
- Sınav endpoint'leri çakışma motorunu `app/conflict_service.py` arayüzü
  üzerinden çağırır. Motor (WP5, Stajyer C) hazır olana dek stub `[]` döner;
  entegrasyon bu tek dosyada yapılır. İmza: `check_exams_save(db, exam)` /
  `check_exams_submit(db, exams)` → kontrat §0 ConflictResult listesi.
  Stub aktifken submit HARD engeli göremez (bilinen geçici sınırlama).

## K-23 · Online girişte derslik yok: API kısıtı [E] — K-19 tamamlayıcısı
WP3 haftalık program API'si yazılırken (16 Temmuz, üç stajyerin onayıyla):
**hibrit ders yoktur** (fiziksel sınıftan online yayın senaryosu kabul edilmiyor).
Dolayısıyla `delivery_mode` FACE_TO_FACE değilken `classroom_id` gönderilmesi
anlamsızdır ve API tarafından **400** ile reddedilir.
- **Gerekçe:** K-19 "senkron online: derslik yok" diyordu ama bunu yalnız motor
  davranışı olarak tarif ediyordu (NULL → W1/W7 susar); API'de kısıt yoktu.
  Yüz yüze bir giriş PATCH ile online'a çevrilip dersliği temizlenmezse, motor
  o dersliği **hayalet-dolu** sanar ve başka bir ders o saate konduğunda sahte
  W1 üretir — oysa oda gerçekte boştur.
- **Kapsam:** POST ve PATCH. PATCH'te kontrol, gelen + mevcut alanların
  BİRLEŞİMİ üzerinden yapılır (slot taşması kontrolüyle aynı desen).
- Kontrat §7'ye 400 hata satırları eklendi.

## K-24 · Davet token'ı ön-doğrulama ucu [E] — kontrat §1 eklemesi
Frontend bağlama işi başlarken (16 Temmuz, üç stajyerin onayıyla) kontrat §1'e
`GET /auth/invitation/{token}` eklendi: hesap tamamlama ekranı açılırken token'ı
doğrular, sahibinin e-posta + adını döner, token'ı **tüketmez**.
- **Gerekçe:** Wireframe §2 "süresi dolmuş/kullanılmış token → form yerine tam
  sayfa hata" diyor, ama bugünkü tek uç (`POST /auth/complete-invitation`) bu üç
  durumu ancak şifre gönderildikten SONRA 400 ile bildiriyor. Kullanıcı ölü bir
  linke şifresini yazıp gönderdikten sonra duvara çarpıyor; sayfa açılır açılmaz
  söylenmesi gereken şey en sona kalıyor. Ayrıca ekranın salt-okunur e-posta
  alanının (wireframe §2) başka veri kaynağı yok — token'dan çözülmesi gerekiyor.
- **Reddedilen alternatif:** 400 cevabının mesaj metnini frontend'de string olarak
  eşleştirip durumu ayırt etmek. Mesaj metni değiştiği gün UI sessizce bozulur;
  sözleşme metne değil uca dayanmalı.
- **Güvenlik sınırları [E]:** Token'ı yakan tek uç `complete-invitation`'dır — GET
  `used_at`'e ASLA dokunmaz. Cevap yalnız e-posta + ad taşır; rol/bölüm/workgroup
  sızdırılmaz. 404 kullanılmaz, üç hata da 400'dür (POST ile aynı desen — token'ın
  varlığı ayırt edilmez). Token URL'de yeni bir risk değil: zaten davet mailindeki
  linkin içinde, tek kullanımlık ve süreli (brief §6.3 şartı sağlanıyor).
  GET ön-doğrulama yapsa bile POST tüm kontrolleri tekrar eder — iki çağrı
  arasında token süresi dolabilir veya başkası kullanabilir (TOCTOU).
- **Yan düzeltme:** Kontratın "tüm istekler login hariç Bearer taşır" genel kuralı
  yanlıştı — davet uçlarının ikisi de public. Kural üç public ucu sayacak şekilde
  düzeltildi.

## K-25 · Yetenek matrisi: yazma yetkileri kullanıcı bazlı bayraklar [E]
K-02'nin (derslik izni) tek bayraklı deseni **beş yeteneğe genelleştirildi**.
Admin davet sırasında hangi yetkileri vereceğini tek tek seçer; ADMIN rolü
verilirse hepsi otomatik açıktır.

| Bayrak | Kapsadığı yazma uçları | Üyelik boyutu |
|---|---|---|
| `can_manage_courses` | `/courses`, `/course-sections` | **var** |
| `can_manage_weekly` | `/weekly-entries` (submit/revert dahil) | **var** |
| `can_manage_exams` | `/exams` (submit/revert dahil) | **var** |
| `can_manage_classrooms` (K-02) | `/classrooms`, `/buildings` | yok |
| `can_manage_lecturers` | `/lecturers` | yok |

- **İki boyut:** İlk üç yetenek bölüme ait kaynakları yönetir; yetki =
  **bayrak VE bölüm üyeliği** (ikisi birden). Son ikisi workgroup geneli
  paylaşımlı kaynaklardır; üyelik boyutu yoktur, yalnız bayrağa bakılır.
- **Bölüm CRUD'u ve kullanıcı daveti bayrağa bağlanMAZ** — yapıyı tanımlayan
  işlemler ADMIN'de kalır (kontrat §2-§3).
- **Uygulama deseni:** mevcut `require_classroom_manager` aynen çoğaltılır:
  `role != ADMIN and not flag` → 403. Bayraklar `users` tablosunda boolean
  kolonlar olarak tutulur (ayrı izin tablosu kurulmadı: yetenek sayısı sabit
  ve az, JWT/`/auth/me` ile taşınması bu haliyle ucuz).
- **Brief'ten sapma [bilinçli]:** Brief §2.1 yalnız dersliği izne bağlıyor,
  ders/haftalık/sınav için "atanmış bölüm yeter" diyor. Ekip, sınav
  koordinatörlüğü gibi ayrışan sorumlulukları ifade edebilmek için yetenek
  boyutunu ekledi. Bedeli kabul edildi: A-5'in test matrisi genişliyor.
- **Frontend sonucu:** bayraklar login cevabı ve `/auth/me` ile taşınır;
  ekranlar "düzenleyebilir miyim?" sorusunu buradan cevaplar (yetkisizde
  salt-okunur görünüm). UI'da gizlemek güvenlik değildir — otorite sunucudadır.

## K-26 · Bölüm görünürlüğü: workgroup içinde herkes her şeyi OKUR [S+E]
Alt hesap, workgroup'undaki **tüm bölümlerin** ders/haftalık/sınav/çakışma
verisini görür; **yazma** yetkisi yalnız atandığı bölümlerle sınırlıdır.
Bir alt hesap birden çok bölüme atanabilir (`department_memberships` çok-a-çok).
- **Önceki durum:** Kontrat §6/§9 ve `list_courses` alt hesabı yalnız atanmış
  bölümlerini görecek şekilde kısıtlıyordu; gerekçesi kayda geçmemişti.
- **Gerekçe 1 — çakışma çözülemiyordu:** Motor mesajları zaten başka bölümün
  verisini açığa veriyor ("Derslik çakışması: CENG2001-1 ve MATH1001-2, Pzt
  10:30, B-201"). Kullanıcıya çakıştığı dersi söyleyip o bölümün programını
  göstermemek, çakışmayı çözmesini imkânsız kılıyordu — boş saat aramak için
  diğer bölümün doluluğunu görmek gerekir. Kısıt, sistemin çekirdek işlevini
  sabote ediyordu.
- **Gerekçe 2:** Brief §2.1 zaten bunu öneriyor: *"View all schedules in
  workgroup — Sub-account: Recommended: read-only."*
- **Değişmeyen:** Workgroup izolasyonu mutlak kalır (K-04). Açılan yalnızca
  fakülte içi bölümler arası **okuma**.
- **Demo etkisi:** seed planı §9 adım 2'deki "izolasyon kanıtı" yer değiştirir:
  "ceng@ EEE verisini görür ama düzenlemeye kalkınca 403" — sunucu taraflı
  yetki denetimini gösterdiği için brief §10.2 açısından daha güçlü bir kanıt.

## K-38 · UPDATE satırı NEYİN değiştiğini söyler: "eski → yeni" [E]
`audit_logs.change_summary` kolonu eklendi (nullable, migration `b8d52fa03c47`).

**Sorun:** log satırı yalnız "hangi kayıt" sorusunu cevaplıyordu. Bir hesabın
erişimi kapatıldığında satır "Test Admin · Düzenledi · Kullanıcı · **Aktif**"
diye okunuyordu — buradaki "Aktif" o kullanıcının ADI. Yani okuyan kişi
`entity_label`'ı durum sanabiliyordu ve asıl bilgi (neyin değiştiği) hiç
görünmüyordu. Aynı satır bir ad değişikliğinden de, yetki değişikliğinden de,
erişim kapatmadan da aynı şekilde üretiliyordu.

- **İki soru, iki sütun:** `entity_label` = *hangi kayıt*, `change_summary` =
  *ne değişti*. Tek metne sıkıştırılsalardı ikisi de okunmaz olurdu; bir ders
  güncellemesi beş alanı birden değiştirebiliyor.
- **Biçim:** `"Durum: Aktif → Pasif"`, birden çok alan varsa ` · ` ile ayrılır.
- **Mutasyondan ÖNCE hesaplanır** — eski değerler hâlâ nesnenin üzerinde.
  Bu, `entity_label`'ın aksine (o işlem SONRASI adı taşır, K-36) bilinçli bir
  fark: etiket "kayıt şimdi bu", özet "şu değerden şuna geçti" der.
- **Yalnızca GERÇEKTEN değişen alanlar yazılır:** istemci bir alanı aynı
  değeriyle gönderdiğinde "Ad: X → X" gürültüsü üretilmez.
- **`FIELD_LABELS` beyaz listedir:** listede olmayan alan özete girmez. Bilinçli
  — "hangi alanlar denetime değer" kararı açık olsun, türetilmiş/duyarlı alanlar
  (şifre hash'i, `normalized_name`, `submitted_at`) sessizce dökülmesin.
- **Yetenek bayrakları dahil** (K-25): hangi yetkinin açılıp kapandığı denetimin
  tam da bakmak isteyeceği şey.
- **Liste alanları dışarıda** (`department_ids`): tek satırlık özete sığmıyor.
  Gerekirse ayrı bir iş olarak eklenir.
- **`data` sözlüğü olmayan iki uç** (`revert-to-draft`) özeti elle verir:
  değişiklik zaten sabit ve bilinen — "Durum: Yayınlandı → Taslak".
- **CREATE/DELETE'te boş kalır:** o eylemlerde "değişiklik" kavramı yok.
  Eski satırlarda da boş — geriye dönük üretilemez, çünkü eski değerler
  hiçbir yerde saklanmıyordu.

## K-37 · Davet akışı da loglanır: INVITE ve ACTIVATE [E]
Eylem sözlüğü genişledi: `CREATE` · `UPDATE` · `DELETE` · `SUBMIT` · **`INVITE`**
· **`ACTIVATE`**.

**Kapatılan boşluk:** `POST /users/invite` ve `POST /auth/complete-invitation`
hiç iz bırakmıyordu. Kullanıcı için yalnız UPDATE ve DELETE loglanıyordu; yani
bir hesabın **doğuşu ve aktifleşmesi** görünmüyordu. Brief §6.3 "her
create/update/delete kullanıcı ve zaman damgasıyla loglanmalı" diyor ve davet,
brief §2.2'nin çekirdek akışı — denetlenmesi gereken ilk şey.

- **Neden `CREATE` değil `INVITE`:** davet, sıradan bir kayıt eklemek değil;
  e-posta gönderiyor, süreli tek kullanımlık token üretiyor (K-24) ve karşı
  tarafa erişim veriyor. Log'da "Ekledi · Kullanıcı" yazsaydı bu güvenlik
  olayının ağırlığı kaybolurdu.
- **`resend-invitation` da `INVITE` yazar.** Aynı fiil: yeni bir e-posta gidiyor
  ve eski token geçersiz kılınıyor. Aynı kullanıcı için iki INVITE satırı
  görmek doğru bilgidir — davetin tekrarlandığını gösterir.
- **`ACTIVATE`'in faili davet edilen kişinin KENDİSİDİR**, davet eden admin
  değil. Linke tıklayıp şifresini belirleyen odur. Log satırı "Ayşe Yılmaz ·
  Hesabını açtı · Kullanıcı · Ayşe Yılmaz" olarak okunur.
  - İzolasyon bozulmaz: kullanıcının `workgroup_id`'si davet anında yazılmıştır,
    `user_id → users.workgroup_id` join'i (K-35) çalışmaya devam eder.
  - Bu, `log_action`'ın JWT'li istek DIŞINDA çağrıldığı tek yerdir; fail yine
    de bir `User` nesnesidir, imza değişmedi.
- **`UPDATE` kullanılmadı:** aktifleşme teknik olarak bir alan güncellemesidir
  ama "Ayşe Yılmaz · Düzenledi · Kullanıcı · Ayşe Yılmaz" satırı kendi kendini
  düzenlemiş gibi okunurdu. Log'un tek işi okunabilirlik.

## K-36 · Log etiketi işlem anında yazılır [E] — K-35'in düzeltmesi
`audit_logs.entity_label` kolonu eklendi (nullable, migration `a7c41e9b2d18`).
`log_action` artık işlemin uygulandığı nesneyi de alır ve o ANDAKI insan-okur
adı satıra yazar. Böylece log kendi kendine yeter: okunurken başka hiçbir
tabloya bakılmaz.

**K-35'in okuma anında çözme yaklaşımı iki yerde yanlış sonuç veriyordu:**
1. **Silinen kayıt konuşamıyordu.** `log_action` yazıldıktan hemen sonra
   `db.delete()` çalışıyor; ertesi gün `courses WHERE id=2038` boş dönüyor ve
   ad kalıcı olarak kayboluyor. İronisi: o satır zaten bir şeyin silindiğini
   kaydetmek için var, ama neyin silindiğini söyleyemiyor. Ekranda "Sildi"
   filtresindeki **her** satır "silinmiş kayıt (#N)" çıkıyordu.
2. **Sonraki değişiklikler eski satırları bozuyordu.** Bir ders "İstatistik" →
   "Olasılık" → "Kuram" diye iki kez yeniden adlandırıldıysa, okuma anında
   çözme üç satırın da **"Kuram"** görünmesine yol açıyordu: ara adımlar
   tamamen kayboluyor, log kendi geçmişini silmiş oluyordu.

**Etiket işlem SONRASI adı taşır** (yazma, alanlar set edildikten sonra olur).
Bilinçli: ardışık satırlar birlikte okununca yeniden adlandırmanın izini verir
("İstatistik", "Olasılık", "Kuram"). İşlem öncesi ad yazılsaydı yeni ad hiçbir
satırda görünmezdi. Tek satır zaten bir yeniden adlandırmayı ifade edemez;
önemli olan sonraki değişikliklerin eski satırları BOZMAMASI.

**Neden okuma tarafında çözülemezdi:** sorun sorguda değil, bilginin nerede
durduğunda. Okurken elde yalnız bir işaretçi (`id`) var ve gösterdiği yer
değişmiş ya da boşalmış olabilir. Olmayan veri sorguyla getirilemez.

- **Etiket üretimi tek yerde:** `audit.build_label(nesne)`. Hem yazma anı hem
  eski satırların okuma anındaki geri düşüşü aynı biçimi kullanır; ikiye
  ayrılsaydı aynı kayıt iki farklı adla görünebilirdi.
- **Silmeden ÖNCE çağrılır** — nesne o an hâlâ yüklü, ilişkili alanlarına
  (`course.code`) erişilebilir. Mevcut çağrı sırası zaten böyleydi.
- **`entity` parametresi opsiyonel** (varsayılan `None`): veren bir çağrı yeri
  unutulursa iz yine yazılır, yalnızca adsız kalır. İz kaybetmektense adsız iz.
- **Eski satırlar geriye dönük doldurulamaz** — silinmiş kayıtların adı zaten
  hiçbir yerde durmuyor. Onlar için K-35'in okuma anında çözme yolu geri düşüş
  olarak KORUNUYOR: varlık hâlâ duruyorsa ad üretilir, yoksa `#id` gösterilir.
- **Cevap şekli değişmedi:** `entity_label` alanı K-35'te de vardı; yalnızca
  doldurulduğu yer değişti. Frontend'e dokunulmadı.

## K-35 · İşlem kayıtları: okuma ucu + etiket okuma anında çözülür [E]
`GET /audit-logs` — dashboard'un en alt bloğu (kontrat §12). Brief §6.3'ün
"her create/update/delete kullanıcı ve zaman damgasıyla loglanmalı" şartının
**görünür** hale gelmesi; yazma tarafı WP2'den beri çalışıyordu ama kimse
okuyamıyordu.

- **Yalnız ADMIN.** Kim neyi değiştirdi bilgisi bir denetim aracıdır; alt
  hesabın kendi bölümü dışındaki işlemleri görmesi için sebep yok. Dashboard
  zaten admin'e özel.
- **İzolasyon `user_id` üzerinden:** `audit_logs` tablosunda `workgroup_id`
  YOK. Kapsam, `user_id → users.workgroup_id` join'iyle kurulur. Bu güvenli,
  çünkü **fail her zaman bir kullanıcıdır**: PENDING hesap giriş yapamadığı
  için (deps.py `status == ACTIVE` arar) hiçbir işlemin faili olamaz, ACTIVE
  hesap ise K-34 gereği silinemez. Yani `user_id` pratikte hiç NULL olmaz.
- **Sunucu tarafı sayfalama zorunlu:** log tek büyüyen tablodur (bugün ~2600
  satır). `GET /users` gibi hepsini döndürmek kısa sürede taşırdı. `limit` +
  `offset`, cevapta `total`.
- **Etiket OKUMA ANINDA çözülür** [bilinçli, sınırlı]: log yalnız
  `entity_type` + `entity_id` tutuyor. Okurken ilgili tablodan insan-okur bir
  ad üretilir ("CENG2001 — İstatistik"). **Silinmiş kayıtta çözülemez**,
  `entity_label: null` döner ve UI `#12` gösterir — üstelik bu, adını en çok
  merak edeceğimiz satırdır (DELETE).
  - **Neden şimdilik böyle:** kalıcı çözüm etiketi YAZMA anında satıra
    denormalize etmek; bu `entity_label` kolonu + migration + ~20 çağrı
    yerinin değişmesi demek. Brief §6.3'ün çıtası "en azından kullanıcı ve
    zaman damgası" — okuma anında çözme bu çıtayı geçiyor.
  - **Yükseltme yolu açık:** kolon sonradan eklenirse cevap şekli DEĞİŞMEZ
    (`entity_label` zaten var, sadece dolduğu yer değişir) ve UI'a
    dokunulmaz. Eski satırlar `null` kalır, yeni satırlar dolu gelir.
- **N+1 yok:** bir sayfadaki satırlar `entity_type`'a göre gruplanıp tür
  başına TEK sorguyla çözülür (en fazla 9 sorgu), satır başına bir sorgu değil.

## K-34 · Hesap yönetimi: bekleyen davet silinir, kullanılmış hesap kapatılır [E]
Dashboard'un kullanıcı bloğu. İki ayrı "iptal" vardır ve ayrım kasıtlıdır:

- **`DELETE /users/{id}` — yalnız `PENDING`.** Davet edilmiş ama hiç giriş
  yapmamış hesap kalıcı silinir (yanlış e-postaya gönderilen davet, işe
  başlamayan kişi). CASCADE'in götürdüğü tek şey kendi davet token'ı ve bölüm
  ataması — ikisi de o hesaptan başka kimseyi ilgilendirmiyor.
- **`PATCH /users/{id}` `{status:"DISABLED"}` — kullanılmış hesap.** ACTIVE
  veya DISABLED hesap SİLİNMEZ, erişimi kapatılır.

**Neden silinmiyor — veritabanı bizi durdurmuyor:** `audit_logs.user_id`,
`exams.created_by` ve `weekly_schedule_entries.created_by` FK'leri
`ON DELETE SET NULL`. Yani ACTIVE bir hesabı silmek hata vermez; **sessizce**
o kişinin yaptığı her işlemin "kim" sütununu boşaltır. Brief §6.3 her
create/update/delete işleminin kullanıcı + zaman damgasıyla loglanmasını şart
koşuyor — silme, bu şartı geriye dönük çökertir. Engel bu yüzden router'da:
kısıt veritabanında olmadığı için uygulama katmanı koymak zorunda.
(K-27/K-29/K-32'nin aynı deseni; farkı, orada FK RESTRICT'ti, burada değil.)

**DISABLED bugün gerçekten çalışıyor:** `auth.py` girişte, `deps.py` ise HER
istekte `status == ACTIVE` arıyor. Kapatılan hesabın elindeki geçerli JWT bir
sonraki istekte 403 alır — token süresinin dolmasını beklemeye gerek yok.
Enum değeri modelde vardı ama hiçbir yerde kullanılmıyordu; bu karar onu
işler hale getiriyor.

**E-posta değiştirilemez.** Kimliktir ve davet token'ı ona bağlıdır. Yanlış
e-postayla davet edilen hesabın çözümü düzenleme değil, daveti silip yeniden
göndermektir — `DELETE`in asıl varlık sebebi budur.

**Kendi hesabına rol/durum değişikliği yasak.** Admin kendini DISABLED yaparsa
ya da SUB_ACCOUNT'a düşürürse geri dönüşü olmayan biçimde kilitlenir; kurtarma
yolu yok. Bir admin'i ancak başka bir admin değiştirebilir.

**"Son admin" için ayrı kural GEREKMİYOR** [bilinçli]: bu uçları çağıran zaten
`require_admin`'den geçmiş, ACTIVE bir admin'dir. Kendi rolünü/durumunu
değiştiremediğine göre, işlem sonrası workgroup'ta en az bir aktif admin
(çağıranın kendisi) her zaman kalır. Ayrı bir sayım kuralı ölü kod olurdu.

**Rol yükseltme/düşürme serbest** (kendi hesabı hariç). ADMIN'e çıkarılan
hesabın yetenek bayrakları K-25 gereği `false`'a çekilir: rol muafiyeti zaten
her yetkiyi veriyor, DB'ye `true` yazmak "rol düşürülürse sessizce yetkili
kalır" tuzağını kurardı.

**ADMIN'e bölüm ataması YAPILMAZ** — bayrakların aynı gerekçesi.
`_ensure_department_access` admin'i üyelik kontrolünden muaf tutuyor
(`role != ADMIN and dep.id not in ...`), frontend'de `canWriteIn` de öyle.
Yani admin için üyelik satırı **ölü veridir** ve aynı tuzağı kurar: hesap
sonradan alt hesaba düşürülürse tam o bölümlerde sessizce yetkili kalır.
- `POST /users/invite`: `role=ADMIN` ise `department_ids` yok sayılır.
- `PATCH /users/{id}`: rol ADMIN'e **yükseltilirken mevcut üyelikler silinir** —
  asıl tehlikeli durum bu, çünkü alt hesabın birikmiş atamaları vardır.
- UI karşılığı: ADMIN seçilince bölüm alanı hiç gösterilmez, tabloda
  "tümü" yazar.

## K-33 · Dashboard özeti: sekiz sayaç, yalnız aktif kayıtlar [E]
`GET /dashboard/summary` — admin dashboard'unun en üst bloğu (kontrat §10).
Sekiz kart: Bölümler · Derslikler · Öğretim Üyeleri · Dersler · Admin ·
Alt hesap · Sınavlar · Çakışma.

- **Yalnız aktif kayıtlar sayılır** (K-02'nin soft delete deseni): `active=false`
  bölüm/derslik/öğretim üyesi/ders sayaca girmez. Gerekçe: pasif kayıt zaten
  ekranlardaki listelerden düşüyor; sayaç hepsini sayarsa dashboard "24 ders"
  derken Dersler ekranı 21 gösterir ve hangisinin doğru olduğu sorulur. Bir
  sayının iki farklı yerde iki farklı değeri olamaz.
- **Kullanıcı karşılığı:** yalnız `ACTIVE` hesaplar sayılır. `PENDING` (davet
  edilmiş, henüz giriş yapmamış) ve `DISABLED` hesaplar sayaca girmez —
  ikisi de bugün sisteme hiçbir şey yapamaz. Bekleyen davetler hemen alttaki
  kullanıcı tablosunda rozetle görünür, sayaçta değil.
- **Sınav istisnası:** `exams` tablosunda `active` yok, yerine DRAFT/SUBMITTED
  (K-03) var. Taslak sınav da gerçek bir kayıttır ve silinene dek durur; bu
  yüzden sınav sayacı ikisini birlikte sayar. Aynısı `weekly_entries` için de
  geçerli.
- **Admin ve alt hesap ayrı sayılır:** tek "kullanıcı" sayacı "kaç kişi yetkili"
  sorusunu cevaplamıyordu. Ayrıca admin sayısı, kullanıcı yönetimi bloğunun
  "son admin kapatılamaz" kilidi için zaten gereken bir bilgi.
- **Çakışma tek kartta iki sayı:** `unresolved_hard` ve `unresolved_warnings`
  ayrı ayrı döner (kontrat §10 bunu zaten vaat ediyordu), kart ikisini
  "3 / 7" biçiminde gösterir. Tek toplam sayı K-05'in en kritik ayrımını
  silerdi: 10 warning normal bir programdır, 10 hard ise program hiç
  yayınlanamaz demektir.
- **Motor bağlanana dek 0 döner** [bilinçli risk]: `conflict_service` stub
  olduğu için iki alan da 0. Ekranda "0 çakışma", "bakıldı ve temiz" gibi
  okunur — oysa henüz bakılmadı. A-3/A-4 bitince yalnız servis çağrısı
  değişir, kontrat ve UI aynı kalır.
- **`weekly_entries` alanı korunuyor:** sekiz kartın arasında yok ama kontrat
  §10 onu zaten vaat etmişti. Kaldırmak kırıcı bir kontrat değişikliği olurdu;
  bedeli tek bir COUNT sorgusu. Haftalık program ekranı gelince kart eklenir.
- **Sorgu notu:** `courses` ve `exams` tablolarında `workgroup_id` yok; ders
  bölüm üzerinden, sınav ders→bölüm üzerinden workgroup'a bağlanır. Sayaçlar
  bu yüzden join'li çalışır — izolasyon (K-04) yine mutlaktır.
- **Yetki:** yalnız ADMIN (`require_admin`). Alt hesabın dashboard'u yok.

## K-32 · Ders silme: yalnız BOŞ ders kalıcı silinir [E] — K-27 deseni
`DELETE /courses/{id}`: yalnız **hiç şubesi ve hiç sınavı olmayan** ders silinir.
- **İki koşul da şart:** `courses`'a bağlananlar `course_sections` (CASCADE) ve
  `exams` (CASCADE). Sınav K-16 gereği DERS düzeyindedir, yani şubesi olmayan
  bir dersin sınavı olabilir. Yalnız şubeye baksaydık, şubesiz+sınavlı bir ders
  silindiğinde sınav da sessizce giderdi.
- **Zincir:** şube varsa onun haftalık girişleri de CASCADE ile gider; bu yüzden
  şube engeli aynı zamanda programı korur. (Şubenin kendi silinmesi zaten
  haftalık giriş varsa 409 veriyor — mevcut davranış korunuyor.)
- **Pasife alma korunuyor:** kullanımdaki ders silinemez, `PATCH {active:false}`
  ile listeden düşürülür (K-29 deseniyle aynı ikili).
- Mesaj neyin engellediğini sayar: "2 şube ve 1 sınav bağlı".

## K-31 · Derslik türü: sınıf / amfi / laboratuvar [E]
`classrooms.room_type` enum: `CLASSROOM` (varsayılan) · `AMPHI` · `LAB`.
UI etiketleri: **Sınıf** / Amfi / Laboratuvar — ekranın adı "Derslikler" olduğu
için normal tipe "Derslik" demek karışıklık yaratıyordu. Enum değerleri
değişmedi; etiket eşlemesi yalnız istemcide (`ROOM_TYPE_LABELS`).
- **Neden enum, serbest metin değil:** K-18'in bina için kurduğu mantığın aynısı —
  "Lab" / "laboratuvar" / "LAB." gibi varyantlar filtreyi ve raporu bozardı.
- **Bugün davranışsal etkisi YOK:** çakışma motoru tipi okumaz; kapasite ve
  sınav kontenjanı kuralları (W7, E5/E7) aynı işler. Alan şimdilik
  **bilgi + filtre** amaçlı (K-30'daki `is_external` ile aynı statü).
- **Muhtemel gelecek kullanımı [BACKLOG]:** K-20 ile haftalık girişin
  `session_type`'ı var (THEORY/PRACTICE/LAB). "LAB oturumu, LAB olmayan
  dersliğe yerleştirilmiş" durumu anlamlı bir WARNING adayı. Kural setinde
  (v1.4) böyle bir kural YOK; eklenmesi Stajyer C'nin ve ekip onayının işidir.
  Alan şimdiden doğru modellendiği için o kural gerektiğinde veri hazır olur.
- **Mevcut kayıtlar:** `server_default='CLASSROOM'` — migration'da eski
  derslikler normal derslik sayılır, kullanıcı sonra düzeltir.

## K-30 · Fakülte dışı bina etiketi [E]
`buildings.is_external` (boolean, varsayılan false): binanın fakülte dışı olduğunu
söyleyen alan. Derslik tablosunda rozet, bina filtresinde "Fakülte dışı" seçeneği.
- **Neden ad değil alan:** "Fakülte dışı"nı bina ADIYLA anlatmak (örn. "Fakülte
  Dışı — A Salonu") K-18'in düzelttiği hatayı tekrar ederdi: biri "Fakülte Dışı",
  biri "Dış Bina", biri "Diğer" yazar; filtre ve raporlar tutmaz.
- **Emsal:** `lecturers.is_external` (40/a dış görevliler, K-08) aynı deseni
  zaten kullanıyor; ekranda "Dış görevli" rozeti çiziliyor.
- **Davranışsal etkisi YOK:** çakışma motoru açısından oda odadır; kapasite,
  sınav kontenjanı ve tüm W/E/X kuralları aynı işler. Alan yalnız etiket+filtre.

## K-29 · Derslik ve bina silme: bağlantısızsa kalıcı, kullanılmışsa pasif [E] — K-02 uyumlu
Derslik ve binalar için **hem kalıcı silme hem pasife alma** bulunur (K-28 deseni).
- **Silinebilir derslik:** hiçbir haftalık girişe, sınava ve şubenin varsayılan
  dersliğine bağlı olmayan kayıt.
- **Silinebilir bina:** hiç dersliği olmayan bina.
- **Pasife al:** kullanılmış kayıt için — silinemez ama yeni yerleşimlerde
  seçilmemesi gerekiyorsa `active=false`.
- **K-02 [S] ile çelişmez:** K-02 "ortak dersliklerin korunması" gerekçesiyle
  soft delete diyordu; o koruma şemada **zaten RESTRICT olarak kurulu**:
  `weekly_schedule_entries.classroom_id` ve `exam_classrooms.classroom_id`
  → RESTRICT, `classrooms.building_id` → RESTRICT. Programa/sınava girmiş bir
  derslik veritabanı tarafından zaten silinemiyor. Hiç kullanılmamış bir derslik
  ise koruyacak bir şey taşımaz. Yani K-02'nin AMACI korunuyor, yalnız "hiç
  silme yok" lafzı bağlantısız kayıtlar için gevşetiliyor.
- **`default_classroom_id` (SET NULL) de engel sayılır:** teknik olarak silme
  yalnız şubenin tercih ettiği dersliği temizler, veri kaybı olmaz. Yine de
  "bağlantısı yok" tanımına dahil edildi — kullanıcı sessiz bir yan etkiyle
  karşılaşmasın; mesaj neyin engellediğini sayarak söyler.

## K-28 · Öğretim üyesi: silme VE pasife alma birlikte [E]
Öğretim üyeleri hem kalıcı silinebilir hem pasife alınabilir; ikisi farklı
ihtiyaçlara cevap verir ve biri diğerinin yerine geçmez.
- **Sil** (yeni `DELETE /lecturers/{id}`): yalnız hiçbir şubeye/sınava bağlı
  olmayan kayıt. Yanlış eklenen kaydı temizlemek içindir.
- **Pasife al** (`PATCH {active:false}`, mevcut): ders vermiş ama ayrılan hoca.
  Silinemez — geçmiş şube/sınav kayıtları ona bağlıdır — ama autocomplete'ten
  çıkar, yeni derse yanlışlıkla atanamaz.
- **Şema zaten koruyor:** `course_sections.lecturer_id` ve `exams.lecturer_id`
  **ondelete=RESTRICT**. Yani bölümlerdeki CASCADE riski burada yok; veritabanı
  bağlı kaydın silinmesini kendisi reddeder. Endpoint bu kontrolü önden yapar ki
  kullanıcı ham DB hatası yerine sayılı bir mesaj görsün ("2 şube ve 1 sınav bağlı").
- **Kontrat §4 düzeltmesi:** `LecturerOut` autocomplete için tasarlanmıştı
  (`{id, full_name, is_external}`) ve `GET /lecturers` pasifleri sertçe süzüyordu;
  bu haliyle bir yönetim ekranı pasif hocayı görüp geri açamazdı. Eklenenler:
  cevaba `active`, sorguya `include_inactive` (varsayılan `false` — autocomplete
  davranışı korunur).
- **E-posta bilinçli olarak EKLENMEDİ:** `lecturers.email` kolonu şemada duruyor
  ama UI'da toplanmıyor/gösterilmiyor; MVP'de bir işlevi yok (bildirim/davet
  akışı hocalara değil kullanıcılara gider).

## K-27 · Bölüm silme: yalnız BOŞ bölüm kalıcı silinir [E] — K-02'nin kapsam düzeltmesi
Bölümler için soft delete (`active`) UI'dan kaldırıldı; yerine **kalıcı silme**
geldi ve yalnız **hiçbir şey bağlı değilken** çalışır.
- **Silinebilir = 0 ders VE 0 kullanıcı ataması.** Herhangi biri varsa 409 ve
  mesaj neyin engellediğini sayarak söyler ("3 ders ve 2 kullanıcı ataması bağlı").
- **Gerekçe:** `departments`'a FK ile bağlanan tam olarak iki şey var —
  `courses` ve `department_memberships`, ikisi de CASCADE. Ders yoksa şube,
  şube yoksa haftalık giriş ve sınav da yoktur; yani boş bölümde cascade'in
  silecek hiçbir şeyi kalmaz. Riski doğuran senaryo (bir dönemlik programın
  sessizce yok olması) böylece imkânsızlaşır.
- **K-02 kapsam notu:** K-02 [S] **dersliklere** dairdir ("Ortak dersliklerin
  korunması için..."); bölümlere "silme yok" kuralını ekip genişletmişti.
  Bu madde o genişletmeyi revize eder, hoca kararına dokunmaz.
- **Reddedilen alternatif:** Atama varken silip "N kullanıcının ataması
  kaldırılacak" uyarısı vermek — kullanıcıların yazma kapsamı habersiz
  değişirdi. Kural tek cümlede anlaşılır olsun istendi: *boş bölüm silinir.*
- **Bilinen boşluk:** Dersi olan bir bölüm artık ne silinebilir ne pasife
  alınabilir (UI'dan). `departments.active` şemada ve API'de durmaya devam
  ediyor; ihtiyaç doğarsa "arşivle" eylemi geri getirilebilir.
## K-39 · Çakışma motoru API'ye bağlandı: stub dönemi bitti [E]
`feature/wp5-motor-entegrasyon` (24 Temmuz). C'nin motoru (WP5) artık
`conflict_service.py` adaptörü üzerinden gerçekten çalışıyor; beş seam
fonksiyonunun tamamı `[]` yerine gerçek sonuç döner. K-22'de kayıtlı
"submit HARD engeli göremez" sınırlaması ve K-33'teki "dashboard sayaçları
hep 0" sınırlaması **kapandı**.

**Adaptör sözleşmesi:** ORM nesneleri motora düz dict olarak geçer; motor
DB/ORM bilmez (saf Python kalır). Enum alanlar `.value` ile string'e çevrilir.
Sınav dict'i `section_no` TAŞIMAZ (K-16), kontenjan için `capacity` değil
`exam_capacity` besler (K-17/K-21).

**Karşılaştırma evreni:** Her kontrol, adayı workgroup'un DRAFT + SUBMITTED
tüm girişlerine karşı test eder; sonuçlar yalnız adayı (veya submit kümesini)
ilgilendirenlere süzülür. Süzme olmasaydı kullanıcı kendi kaydını yaparken
başkasının çakışmasını görürdü.

**W8 (tamlık) hangi anlarda üretilir — K-20'nin kapsam netleştirmesi:**
- `save` → HAYIR (yerleştirme sürerken "hâlâ eksik" uyarısı yağdırmamak için)
- `submit` → EVET (WARNING, submit'i durdurmaz)
- `GET /conflicts` tam tarama → **EVET**. Gerekçe: save'deki susma gerekçesi
  "kullanıcıyı iş sürerken rahatsız etme"ydi; tam tarama ise kullanıcının
  bilerek "bana tüm sorunları göster" dediği yerdir ve eksik ders saati de
  çözülmesi gereken bir sorundur. Dashboard sayacı da bunu içerir.

**Motor uyum düzeltmeleri (aynı branch):**
- Sınav mesajları `course_label()` yerine `exam_label()` kullanır — eskisi
  `section_no` istiyordu ve sınav dict'inde o alan olmadığı için KeyError
  veriyordu. Hata, testteki sahte `section_no: 1` fixture'ı yüzünden
  görünmüyordu; fixture da gerçek veriye uyacak şekilde düzeltildi.
- Cohort mesajları bölüm ADINI yazar (ham `department_id` değil); adı adaptör
  besler, yoksa id'ye düşer.
- W3/W4'ün `affected` alanı temsili giriş yerine **çakışmayı kanıtlayan somut
  oturum çiftini** taşır (kural seti §A şartı) — B raporda "hangi oturumlar"
  gösterebilsin diye.
- Kontrat §0 enum'una `E4a/E4b/E5a` eklendi (üç stajyerin haberi var).

**Pasif şube/ders çakışma evreni dışıdır:** Girişi olan bir şube veya ders
pasife alındığında (`active=false`), o şubenin/dersin haftalık girişleri ve
sınavları artık hiçbir çakışma karşılaştırmasına GİRMEZ. Motor stub'ken bu
fark edilmiyordu; motor bağlanınca pasif şubenin girişi hayalet W1 üretiyordu.
Gerekçe: proje pasifliği her yerde "kapsam dışı" sayar — K-16 sınav öğrenci
sayısında yalnız aktif şubeleri toplar, K-33 dashboard yalnız aktif kayıtları
sayar, K-15 "tüm AKTİF şube çiftleri" der. Motor da tutarlı olmalı.
Uygulama: `_weekly_universe` `CourseSection.active AND Course.active`,
`_exam_universe` `Course.active` ile süzer. Sınavda `active` alanı yok;
pasiflik dersten miras alınır.

**Bilinen sınırlama:** Aday filtresi evrenin tamamını tarayıp süzdüğü için
maliyet O(n²). MVP ölçeğinde ölçülebilir bir sorun değil; gerekirse
aday-vs-evren için özel bir tarama yardımcısı eklenir (kural seti değişmez).

## K-40 · E7 güvenlik payı = 10; W8 tam taramada da görünür [E]
`feature/wp5-motor-entegrasyon` (24 Temmuz). Motorda iki açık ucun kapatılması.

**E7 israf eşiği → margin=10 (açık konu 5 kapandı).** Hoca onayı beklenmeden
ekip kararıyla sabitlendi. E7 artık ancak en küçük derslik çıkarıldıktan sonra
kalan kontenjan öğrenci sayısından **en az 10 fazlaysa** tetiklenir. Gerekçe:
tam sınırda (80 kontenjan / 75 öğrenci) oturan bir sınav "gereksiz derslik"
diye uyarılmamalı; sınavda seyrek oturma için küçük bir tampon meşrudur.
`margin=0` bariz doğru olmayan uyarılar üretiyordu. İhtiyaç olursa değer tek
yerden (engine `e7_excess_capacity` varsayılanı) değişir.

**W8 tam taramada da üretilir (K-20'nin kapsam kararı).** K-20 "W8 yalnız
submit'te" diyordu; save'de susmasının sebebi "yerleştirme sürerken rahatsız
etme"ydi. `GET /conflicts` tam taraması ise kullanıcının bilerek "bana tüm
sorunları göster" dediği yerdir — eksik/fazla ders saati de çözülmesi gereken
bir sorundur, orada gizlemek yanlış olur. Dolayısıyla W8 üç yerde farklı
davranır: **save → sessiz**, **submit → WARNING**, **tam tarama → WARNING**.
Dashboard uyarı sayacı da (K-33) tam taramadan beslendiği için W8'i içerir.

## K-41 · Sınav×ders (X) kuralları YALNIZ vizede çalışır [E] — K-06 kapsam düzeltmesi
X1/X2/X3 çapraz kuralları artık iki kapıdan geçer: `check_exam_vs_course`
bayrağı (K-06) **ve** sınavın türü **MIDTERM** olması.

**Gerekçe:** K-06 "vizeler ders haftalarında yapılır → exam-vs-course kontrolü
AÇIK" derken kastedilen zaten vizelerdi; ama kural sınav türünden bağımsız
uygulanıyordu. Final ve bütünleme dönemlerinde **ders yapılmaz**, dolayısıyla o
sınavları haftalık programla karşılaştırmak olmayan bir dersle çakışma
uydurmaktır. Gerçek veride (CENG 2025-26 Bahar + Haziran final haftası) bu,
19 sahte X2 uyarısı üretiyordu ve listeyi kullanılamaz hale getiriyordu.

**Uygulama:** `orchestrator.scan_cross` MIDTERM olmayan sınavları atlar.
Bayrak korunur — bir fakülte vize döneminde de kontrolü kapatmak isteyebilir.

**Not:** Bu, `wp5-engine-v14` incelemesinde C'den "X kurallarını sınav tipine
değil bayrağa bağla" diye istediğim değişikliğin kısmen geri alınmasıdır. O
zamanki gerekçe "tür değil bayrak kontrol etmeli"ydi; doğrusu İKİSİ birden.

## K-42 · Test izolasyonu: testler ayrı `scheduling_test` veritabanında koşar [E]
`backend/conftest.py`. Test paketi artık dev veritabanına (`scheduling`) değil,
onun yanında duran ayrı bir `scheduling_test` veritabanına yazar. Uygulama
koduna ve 336 testin hiçbirine dokunulmadı; değişen tek dosya `conftest.py`.

**Sorun:** Test paketinde izolasyon yoktu. `tests/helpers.py` doğrudan
`app.db.SessionLocal` ile dev Postgres'e bağlanıp `commit()` ediyor, teardown
yapmıyordu (`foreign_admin_headers`/`sub_headers` her çağrıda yeni workgroup +
kullanıcı yaratıyor). Sonuç: her `pytest` koşumu dev veritabanına kalıcı çöp
bırakıyordu — bir noktada ~2 bölüm olması gereken yerde **130 bölüm**, 1
workgroup yerine **22 workgroup** birikmişti. `test_wp0_smoke.py` kendi
transaction-rollback fixture'ını yaptığı için kirletmeyen tek dosyaydı; kirlilik
API testlerinden (wp1–wp6) geliyordu. Brief §10.2 ve WP7 açısından bu bir
altyapı eksikliğiydi (ilk proje analizinde işaret edilmişti).

**Karar — ayrı test veritabanı, transaction-rollback DEĞİL.** İki yol vardı:
(a) her testi bir transaction'a sarıp geri almak, (b) ayrı bir throwaway
veritabanı. (a) reddedildi: testler bolca `commit()` ediyor ve `helpers` ile
router'lar sürekli TAZE `SessionLocal()` açıyor; hepsini tek bir bağlantıda
iç-içe savepoint'lerle sarmak (commit'te savepoint'i yeniden başlatan klasik
desen) 336 test için kırılgan olurdu. (b) sıfır test/uygulama değişikliğiyle
sağlam çalışır — seçildi.

**Nasıl çalışır (`conftest.py`):**
- Dev URL'inin veritabanı adına `_test` eklenerek test URL'i türetilir
  (`scheduling` → `scheduling_test`). `TEST_DATABASE_URL` env'i verilirse
  doğrudan o kullanılır (CI için).
- Bu veritabanı yoksa bakım bağlantısıyla (`postgres`) `CREATE DATABASE` edilir.
- `settings.database_url` + `DATABASE_URL` env test URL'ine çevrilir; böylece
  `get_db`, `helpers.SessionLocal` ve testlerin açtığı her oturum tek yerden
  test veritabanına bağlanır.
- Her oturumun başında `DROP SCHEMA public CASCADE` + `create_all` ile şema
  sıfırdan kurulur (crash'e dayanıklı temiz başlangıç), sonra asgari seed:
  9 slot referans satırı + testlerin login olduğu admin (`admin@muh...`).
- **Güvenlik kilidi:** test veritabanı adı `_test` ile bitmiyorsa `assert`
  durdurur — `DROP SCHEMA`'nın yanlışlıkla gerçek bir veritabanını sıfırlaması
  imkânsız.

**Tuzak (kayda değer):** `str(URL)` SQLAlchemy'de parolayı `***` ile maskeler;
ilk denemede engine `app:***` ile bağlanmaya çalışıp auth hatası verdi. Doğrusu
`URL.render_as_string(hide_password=False)`.

**Kanıt:** 336 test yeşil kaldı; koşum öncesi/sonrası dev veritabanı sayaçları
**bit bit aynı** (test verisi yalnız `scheduling_test`'e yazıldı). `scheduling_test`
kendini yönetir — her koşum başında sıfırlandığı için orada da birikme olmaz.

## K-43 · Şifre sıfırlama: davet akışının ikizi, ayrı token tablosuyla [E]
Kontrat §1'e üç public uç eklendi: `POST /auth/forgot-password`,
`GET /auth/reset/{token}`, `POST /auth/reset-password`. Migration `a1fc8eee1f4c`.

**Neden şimdi:** Brief §6.1 minimum ekranlar listesinde *"forgot password or
password reset placeholder"* geçiyordu ve bugüne dek hiçbir karşılığı yoktu —
şifresini unutan kullanıcının tek çaresi admin'e gitmekti. Placeholder brief'in
lafzını karşılardı; ekip tam akışı seçti çünkü altyapı (token üretimi, hash,
mailer, süre/tek-kullanım deseni) davet akışından **hazır** geliyordu.

**Ayrı `password_reset_tokens` tablosu — `invitation_tokens`'a `purpose` kolonu
DEĞİL.** Reddedilen alternatif tek tabloydu. Gerekçe: iki token farklı şeyler
yapar — davet token'ı **hesabı aktifleştirir**, sıfırlama token'ı **mevcut
şifreyi değiştirir**. Tek tabloda tutulsalardı `_resolve_invitation` ve davet
oluşturma yollarının hepsi `purpose`'a göre süzülmek zorunda kalırdı; bir yerde
süzme unutulursa davet token'ıyla şifre sıfırlama (veya tersi) mümkün olurdu.
Ayrı tablo bu karışmayı **şema düzeyinde** imkânsız kılar ve çalışan davet
akışının kod yoluna hiç dokunmaz. Bedeli: bir migration + paralel bir resolver.

**Hesap sayımı (enumeration) koruması:** `forgot-password` **her zaman** 200 ve
**aynı gövdeyi** döner. E-posta kayıtlı olmasa da. Farklı cevap vermek —hatta
sadece farklı metin— sistemi "bu adres kayıtlı mı" sorusuna cevap veren bir
sorgulama aracına çevirirdi. Mail yalnız eşleşen **ACTIVE** hesaba gider.

**Hangi hesap sıfırlayamaz ve neden:**
- `PENDING`: hesabın henüz şifresi yok; yolu davet linkidir (`resend-invitation`).
  Sıfırlama izni verilseydi davet akışının yanında ikinci bir aktivasyon kapısı
  açılırdı.
- `DISABLED`: erişimi K-34 gereği **bilerek** kapatılmış. Kendi kendine
  sıfırlayabilseydi kapatma kararı delinirdi.
- Kontrol iki yerde: mail gönderiminde ve `reset-password` anında. İkincisi
  şart, çünkü token alındıktan sonra hesap kapatılmış olabilir (TOCTOU).

**Token ömrü davetten KISA: 2 saat** (`PASSWORD_RESET_EXPIRE_HOURS`, davet 7 gün).
Gerekçe: çalınan bir sıfırlama linki **aktif** bir hesabı doğrudan ele geçirir;
çalınan davet linki ise henüz sahibi olmayan bir hesabı açar. Risk aynı değil,
ömür de aynı olmamalı.

**Tek kullanımlık + kardeş token'lar da yanar.** Başarılı sıfırlamada yalnız
kullanılan token değil, o kullanıcının **bekleyen tüm** sıfırlama token'ları
mühürlenir. Aksi halde linki ele geçiren kişi, kullanıcı şifresini düzelttikten
sonra elindeki ikinci linkle tekrar değiştirebilirdi. Ayrıca yeni bir talep
eskileri geçersiz kılar (`resend-invitation` deseni).

**Önizleme ucu daha dar (K-24'ten sapma):** `GET /auth/reset/{token}` yalnız
`email` döner, `name` DÖNMEZ. Davet önizlemesi adı veriyordu çünkü orada ekran
"seni davet ettik" diyordu; burada token'ı ele geçirene kişi adı sızdırmanın
hiçbir faydası yok.

**Audit: iki ayrı eylem** — `RESET_REQUEST` ve `RESET_PASSWORD`, ikisinin de
faili hesabın **sahibi** (K-37'deki `ACTIVATE` gerekçesi). Ayrı olmalarının
sebebi: "link istendi ama hiç kullanılmadı" durumu görünür kalsın; birikmiş
talep satırları olası bir saldırının ilk işaretidir.
- **Yan etki:** `audit_logs.action` kolonu `VARCHAR(10)` idi ve `RESET_PASSWORD`
  (14 karakter) **sığmıyordu**; kolon 20'ye genişletildi (aynı migration).
  Migration'ın `downgrade`'i RESET_* satırları varken hata verir — sessiz veri
  kaybı yerine açık hata doğru davranıştır.

**Mailer tek gönderim yoluna indirildi** (`_send`): davet ve sıfırlama aynı
SMTP/TLS/timeout mantığını paylaşır. Kopyalansaydı biri düzeltilirken diğeri
unutulurdu (timeout eklenmesi tam da böyle bir düzeltmeydi).

**Test:** `tests/test_wp1_password_reset.py` — 15 test; mutlu yol, hash
doğrulaması, enumeration, geçersiz/kullanılmış/süresi dolmuş token, önizlemenin
tüketmemesi, kardeş token yanması, PENDING/DISABLED atlamaları, TOCTOU ve iz
kaydı. Tam paket **351 yeşil**.

## K-44 · Şifre sıfırlamaya CAPTCHA + saatlik talep sınırı [E] — K-43'ün sertleştirmesi
`POST /auth/forgot-password` public, kimliksiz ve **her çağrıda mail gönderiyor**.
K-43 bu ucu açtı ama istismara karşı hiçbir katman koymamıştı: bir saldırgan
ucu döngüye alıp bir kullanıcının posta kutusunu doldurabilir (mail
bombardımanı) ya da adres deneyerek sistemi yoklayabilirdi. İki katman eklendi.

**1. Google reCAPTCHA v2 ("Ben robot değilim" kutusu).** v3 (görünmez, skor)
reddedildi: skor eşiği yanlış ayarlandığında gerçek kullanıcıyı **sessizce**
engeller ve demoda gösterilecek bir şeyi yoktur. v2 ikili cevap verir, eşik
ayarı gerektirmez ve süpervizöre "şu koruma var" diye gösterilebilir — brief
§10.3'ün demo edilebilirlik çıtasıyla uyumlu.
- **Doğrulama e-postadan ÖNCE:** CAPTCHA başarısızsa 400 döner ve hiçbir DB
  sorgusu/mail yapılmaz. Bu 400 hiçbir şey sızdırmaz, çünkü e-posta henüz
  sorgulanmamıştır — bilinmeyen adres de kayıtlı adres de aynı 400'ü alır.
- **Ağ hatasında KAPALI kapı** (`verify_captcha` → `False`): Google'a
  ulaşılamıyorsa istek geçmez. Geçirseydik koruma, Google'ı erişilemez kılarak
  (veya sadece şansla) atlatılabilir olurdu.
- **Anahtar yoksa doğrulama ATLANIR** [bilinçli]: yerel geliştirme, testler ve
  internetsiz demo makinesi eskisi gibi çalışsın. Yayında korumasız kalmasın
  diye `config.py`'nin üretim denetçisine eklendi — `ENVIRONMENT=production`
  iken `RECAPTCHA_SECRET_KEY` boşsa uygulama **açılmaz**. Sessiz bir güvenlik
  boşluğu yerine açılışta patlayan bir hata (K-01'deki `SECRET_KEY` deseni).
- **Kütüphane eklenmedi:** doğrulama tek bir `httpx.post` (httpx zaten
  bağımlılıkta), istemci tarafı ~90 satırlık bir bileşen. Bir react wrapper
  paketi tek bir form için bağımlılık maliyetine değmiyordu.
- **Google'ın test anahtarları HER token'ı geçirir** (`hostname:
  testkey.google.com`) — boru hattını kanıtlar ama **sıfır koruma** sağlar.
  Yayında gerçek anahtar şart; `.env.example` bunu açıkça yazar.

**2. Saatlik talep sınırı (`PASSWORD_RESET_MAX_PER_HOUR`, varsayılan 3).**
CAPTCHA'yı elle geçen birine karşı ikinci katman.
- **Yeni tablo YOK:** `password_reset_tokens`'ın kendisi talep geçmişidir —
  her talep bir satır yazar ve `created_at` taşır. Son bir saatteki satırlar
  sayılır. (Kullanılmış/geçersiz kılınmış satırlar da sayılır; önemli olan
  MAIL'in kaç kez gönderildiği, token'ın akıbeti değil.)
- **SESSİZ sınır — 429 DEĞİL** [en kritik karar]: sınır aşıldığında yine aynı
  200 döner, yalnızca mail gönderilmez. Farklı bir kod/mesaj dönmek K-43'ün
  hesap sayımı korumasını **delerdi**, çünkü sınır yalnızca gerçek ve ACTIVE
  hesaplarda tetiklenebilir: "429 aldıysan bu adres kayıtlıdır" demek olurdu.
  Korumanın amacı mail bombardımanını durdurmak; susarak durdurmak bunu sağlar
  ve hiçbir şey sızdırmaz.
- **Hesap başına**, IP başına değil: korunan şey kullanıcının posta kutusudur.
  Pencere kayan bir saattir, kalıcı ceza değil.

**Bilinçli olarak yapılmayanlar:** `POST /auth/login` CAPTCHA'sız kaldı (kaba
kuvvet koruması ayrı bir iş, kapsam genişletilmedi). IP bazlı genel hız sınırı
yok — ters vekil/altyapı katmanının işi.

**Test:** `test_wp1_password_reset.py` 15 → **24 test**. Yeni olanlar: anahtar
yokken atlama, anahtar varken zorunluluk, geçerli token'ın geçmesi, CAPTCHA
hatasının sızdırmaması, ağ hatasında kapalı kapı, sınırın maili kesmesi,
sınırın cevabı DEĞİŞTİRMEMESİ, sınırın hesap başına olması, eski taleplerin
pencereden düşmesi. Tam paket **360 yeşil**.

## K-45 · Online'lık ders bileşeninin özelliğidir: T/U/L bazında bayrak [E] — K-19/K-20 genişletmesi
`courses.theory_online / practice_online / lab_online` (migration `c7e9a02b4d31`).

**Sorun:** Online'lık yalnızca haftalık GİRİŞTE (`delivery_mode`) seçilebiliyordu
(K-19). Kullanıcı dersi/şubeyi oluştururken "bu dersin teorisi online" diyemiyordu;
her yerleştirmede tek tek işaretlemek gerekiyordu ve bu dersin sabit bir özelliğini
(online mı) girişin geçici bir alanı gibi gösteriyordu.

**Karar:** "Online mı" artık **ders düzeyinde, bileşen (T/U/L) bazında** sabittir.
SENKRON/ASENKRON ayrımı ise K-19'daki gibi **haftalık girişte** kalır.
- Ders formunda T/U/L saatlerinin altında, **yalnız saati >0 olan bileşen** için
  "online mı" onay kutusu. Hiç saat yoksa blok görünmez; saati 0 olan bileşenin
  bayrağı router'da **zorla false** (anlamsız veri tutulmaz — K-25/K-34 deseni).
- Haftalık ekleme/düzenleme modalında oturum türü (T/U/L) seçilince: o bileşen
  online ise giriş online olur ve **yalnız senkron/asenkron** sorulur, derslik
  sorulmaz; değilse yüz yüze sabittir ve derslik sorulur.

**K-19 KORUNUR, ezilmez:** `weekly_schedule_entries.delivery_mode` hâlâ giriş
düzeyinde ve üç değerli (FACE_TO_FACE / ONLINE_SYNC / ONLINE_ASYNC). Motor (K-19
asenkron ön-elemesi) hiç değişmedi — bu bayraklar yalnızca UI'da delivery_mode'un
NASIL seçildiğini yönlendirir. "Aynı dersin teorisi online, lab'ı yüz yüze"
senaryosu bileşen bazında bayrakla artık ders düzeyinde ifade edilebiliyor
(K-19'un giriş düzeyi gerekçesiyle tutarlı: bileşenler ayrı).

**Kapsam dışı [bilinçli]:** Backend haftalık API'si delivery_mode'u hâlâ serbest
kabul eder (K-23 kısıtı dışında); ders bayrağıyla girişin delivery_mode'unun
TUTARLILIĞINI zorlamaz. UI bunu sürüyor; katı sunucu doğrulaması istenirse ayrı
iş. Sınav tarafı etkilenmez (sınavda online kavramı yok).

**Kontrat:** §6 CourseCreate/Update/Out'a üç boolean eklendi (üç stajyerin haberi
var). **Test:** wp2_courses 17 yeşil.

## K-46 · Çoklu vize: ders başına 1-3 vize [E]
Bugüne dek sistem ders başına tür başına TEK sınav varsayıyordu (`exams`
UNIQUE(course_id, exam_type), motor E2). Gerçekte bazı derslerin 3'e kadar vizesi
olabiliyor. Karar: derse `courses.midterm_count` (1-3, varsayılan 1) eklenir;
sınava `exams.exam_index` ("kaçıncı vize") eklenir; UNIQUE
(course_id, exam_type) → (course_id, exam_type, exam_index) olur.

**Kapsam yalnız VİZE:** final ve bütünleme ders başına tektir. MIDTERM dışı
türlerde `exam_index` sunucuda zorla 1 yapılır, dolayısıyla UNIQUE onlar için
eski "tek kayıt" davranışını aynen korur. `midterm_count` yalnız vizeyi ilgilendirir.

**E2 yeniden tanımı:** mükerrer sınav artık aynı **(ders, tip, SIRA)** üçlüsüdür.
Farklı numaralı vizeler (1./2./3.) çakışma üretmez — çoklu vize bunun üstüne kurulur.
Aynı numaralı ikinci vize → E2 HARD (DB UNIQUE yedekte).

**Sıra doğrulama sunucuda:** MIDTERM'de `exam_index ∈ 1..course.midterm_count`;
dışındaysa 400. Şema ayrıca mutlak üst sınırı korur (`exam_index BETWEEN 1 AND 3`).

**Vize sayısı düşürme kilidi:** `midterm_count`, halihazırda kayıtlı vizelerin
altına PATCH'le çekilemez (K-27/K-32 deseni: kullanımdaki kayıt sessizce
kapsam dışı kalmasın) → 409, önce ilgili vize silinsin.

**UI:** Ders formunda "Vize sayısı" (1-3). Sınav modalında ders birden çok vize
taşıyorsa "Kaçıncı vize" seçimi çıkar; dolu sıralar devre dışı, ilk boş sıra
otomatik seçilir. Takvim kartı/başlık birden çok vizede sırayı gösterir ("2. Vize").

**Kontrat:** §6 courses'a `midterm_count`, §8 exams'a `exam_index` eklendi;
E2 semantiği güncellendi (üç stajyerin haberi var). **Migration:** a3c9e1f5b7d2.
**Test:** wp4_exams'a 4 senaryo (çoklu vize, sınır dışı, non-midterm→1, düşürme
kilidi) + overlap'a farklı-sıra E2 testi.

## K-47 · Oturum: boşta-kalma modeli (mutlak 60 dk atma yerine) [E]
Eski davranış: JWT 60 dk, dolunca istemci token'ı silip login'e atıyordu —
kullanıcı iş ortasında habersiz düşüyordu. Karar: **boşta-kalma (idle) modeli.**
- **Aktifken hiç kesinti yok:** istemci ~10 dk'da bir `POST /auth/refresh` ile
  token'ı sessizce ileri taşır; çalışan kullanıcı asla atılmaz.
- **15 dk hareketsizlikte** "Oturumu uzat / Çıkış" modalı çıkar; içinde 60 sn
  geri sayım. "Uzat" → tazele; "Çıkış" veya sayaç biterse → oturum kapanır.
- Modal açıkken sıradan fare/klavye hareketi oturumu uzatmaz — kullanıcı bilerek
  seçmeli (yanlışlıkla dokunuşla dirilmesin).

**Reddedilen alternatif:** mutlak 60 dk + dolunca 30 sn sayaç. Aktif kullanıcıyı
saat başı bölerdi; boşta-kalma modeli hem daha az kesinti hem güvenlik açısından
yeterli (gerçek risk terk edilmiş açık oturumdur, çalışan oturum değil).

**Güvenlik:** `POST /auth/refresh`, `get_current_user`e dayanır — her istekte
`status == ACTIVE` arandığından (deps.py, K-34) kapatılmış hesabın elindeki token
uzatılamaz. Token süresi (60 dk) ve tazeleme aralığı env'den ayarlanabilir kalır.

**Kontrat:** §1'e `POST /auth/refresh` eklendi (login ile aynı cevap şekli).
**UI:** AuthContext idle izleme + geri sayımlı modal (MantineProvider içinde).

## K-48 · Ortak (servis) dersler: ders çok-cohort'lu olabilir [S+E]
Fizik/Matematik/Türkçe gibi birden çok mühendislik bölümünün birlikte aldığı
ortak dersler için. Örnek dosyadaki "Common Courses" programı (1.-4. sınıfların
yanında ayrı bir sayfa) bunun kanıtı.

**Sorun:** Bir ders şimdiye dek tam olarak TEK bölüme aitti (`courses.department_id`
tekil FK) ve cohort kimliği motorda skaler `(bölüm, yıl, dönem)` üçlüsüydü. Ortak
bir ders yalnız bir bölüme kayıtlıysa, motor onun DİĞER bölümlerin cohort'larıyla
çakışmasını hiç görmüyordu (farklı `department_id` → kural sessizce geçiyordu).
"Her bölüme ayrı Fizik gir" alternatifi de bozuk: aynı fiziksel ders motor için
alâkasız N ders olur, cohort esnekliği kaybolur.

**Karar:** Bir dersin cohort'u artık tek üçlü değil, bir **KÜME**. Dersin kendi
`(department_id, year, semester)`'i birincil cohort olarak `courses` satırında
kalır; ek cohort'lar yeni **`course_cohorts`** tablosunda durur. Efektif cohort =
birincil ∪ ek. `courses.is_common` bayrağı ayrı "Ortak Dersler" görünümü + import
işaretidir; çakışma semantiği bayraktan DEĞİL, cohort kümesinden gelir.

- **Motor:** "aynı cohort mu?" testi **eşitlik**ten **küme kesişimi**ne döndü
  (`engine.shared_cohort`). W3/W4 gruplaması (orchestrator `scan_cohort`) çoklu
  üyeliğe geçti: bir giriş ait olduğu HER cohort grubuna girer, ortak dersin
  başka bölümün cohort'uyla çakışması o grupta yakalanır. Aynı çift birden çok
  paylaşılan cohort'ta üretilirse ders düzeyinde tekilleştirilir. E4a/E4b ve X2
  aynı kesişim mantığına geçti.
- **Geriye uyum [kanıtlı]:** Normal dersin `course_cohorts`'ta satırı yoktur →
  efektif cohort tek elemanlı → kesişim = eski eşitlik. Adaptör `cohorts` listesi
  vermeyen eski dict'lerde skaler alanlardan tek eleman türetilir. 404 mevcut
  test dokunulmadan yeşil kaldı; 9 yeni test (8 motor + 1 ORM uçtan-uca).
- **Mesaj:** Cohort mesajı çakışmanın gerçekleştiği PAYLAŞILAN cohort'un
  bölüm/yıl/dönemini yazar (ortak dersin birincil cohort'unu değil). `build_result`
  paylaşılan cohort'u alıp `a`'nın bir kopyasına bindirir — hiçbir mesaj
  kurucusunun imzası değişmez.
- **Yetki:** ~~Ortak dersi düzenleme, sahibi bölümün (`courses.department_id`)
  üyeliğine bağlı kalır; tüketen bölümler yalnız çakışma için cohort sağlar,
  yazma hakkı vermez.~~ → **K-49 ile değişti:** düzenleme + şube yönetimi + silme
  dersi ALAN tüm bölümlerce paylaşılır (birincil ∪ ek cohort).
- **Şema:** migration `c7e2a9f4b6d1` — `courses.is_common` (default false) +
  `course_cohorts(course_id, department_id, year, semester)`, UNIQUE(dörtlü),
  CASCADE (ders veya tüketen bölüm silinince tüketim satırı gider).
- **Tamamlanan fazlar (31 Tem):**
  - CRUD + kontrat: `POST/PATCH /courses` `is_common` + `PATCH` `cohorts` (tam
    değiştirme); `CourseOut` `is_common` + `extra_cohorts`. Ek cohort bölümünde
    üyelik aranmaz, yalnız workgroup izolasyonu. Yabancı/birincil/tekrar cohort → 400.
  - Frontend: Dersler formunda "ortak ders" switch'i + cohort editörü (bölüm/
    sınıf/dönem satırları) + listede "Ortak +N" rozeti. Haftalık'ta 4. bakış
    "Ortak" (salt-okunur, `GET /weekly-entries?is_common=true`).
  - Export: `/export/weekly?is_common=true` düz liste (ortak dersler programı).
  - Bologna import: önizleme satırında "Ortak ders" switch'i; commit `is_common`
    taşır (`CourseFields`). Ek cohort'lar sonradan ders düzenlemeden atanır.
  - Test: motor 8 + ORM 1 + CRUD 10 + import 1 = 20 yeni; toplam 424 yeşil.
- **UX rötuşları + birleştirme (31 Tem, kullanıcı geri bildirimi):**
  - **Ortak ders BİRLEŞTİRME:** `POST /courses is_common:true` ile aynı kodlu ortak
    ders varsa yeni kayıt açılmaz, gelen cohort mevcut derse eklenir (aynı ders
    döner). "Aynı ders iki kez" (kullanıcının iki ayrı "aaa" kaydı) böyle önlenir.
    Ek cohort'lar yalnız DÜZENLE'den yönetilir; ekleme formunda cohort editörü yok.
  - **`GET /courses?department_id=X`** artık X'i ek cohort olarak alan ortak dersleri
    de döner (X'in kendi dersi olmasa da) — tüketen bölüm onları görebilsin.
  - **Dersler UI:** ortak dersler ayrı "Ortak Dersler" kategorisinde AMA cohort'u
    olan her dönem grubunda da "Ortak ders" etiketiyle görünür; detayda "Aldığı
    gruplar" tüm cohort'ları listeler.
  - **Haftalık + Sınav:** "Ortak" ayrı sekme değil, Sınıf seçicisinde "Ortak dersler"
    değeri → palet + yazılabilir cohort bakışı.
  - Toplam 429 backend testi yeşil.

## K-49 · Ortak dersin düzenleme yetkisi tüketen bölümlere açıldı [E] — K-48 revizyonu
K-48 ortak dersi "sahibi bölüm düzenler, tüketen yalnız cohort sağlar" diye
kurmuştu. Kullanıcı geri bildirimi: servis dersinin bakımı doğası gereği
paylaşımlı — Fizik'i CENG de EEE de alıyorsa, her ikisinin sorumlusu kendi
şubesini (kendi hocası, kendi öğrenci sayısı) ekleyip dersi düzenleyebilmeli.

**Karar:** Ortak dersin **düzenlenmesi + şube yönetimi + silinmesi**, dersi ALAN
**herhangi bir** bölümün (birincil ∪ ek cohort) `can_manage_courses` yetkili
üyesine açık. "Sahibi tek bölüm" imtiyazı tümden kalktı — servis dersinin
bakımını (silme dahil) onu alan bölümler eşit paylaşır. Silme zaten yalnız BOŞ
derste (şube/sınav yok) çalıştığı için (K-32) yıkım sınırlıdır.

> İlk uygulamada silme sahibe özel bırakılmıştı; kullanıcı kararıyla o da
> paylaşıma açıldı — düzenleme/silme kapsamı ayrışınca "düzenleyebiliyorum ama
> silemiyorum" tutarsızlığı doğuyordu.

**Uygulama:** Yeni `_ensure_course_access(course)` yardımcısı, birincil-bölüm
kontrolü yapan `_ensure_department_access`'in yerine **beş uçta** (update_course +
üç şube ucu + delete_course) geçti. Efektif cohort kümesi ∩ kullanıcının
üyelikleri boşsa 403. Normal derste küme tek elemanlı → eski davranış birebir
(regresyon testiyle kilitlendi). ADMIN muaf. İzolasyon (K-04) bozulmaz: küme
yalnız workgroup içi bölümlerden oluşur. Frontend `canEdit` cohort kümesine
genişledi (Düzenle + Sil ikisini de kapsar).

**Gösterim (aynı iş):** Ortak dersin detay kimlik satırı artık tek bölüm/sınıf/
dönem göstermez (tek sahibi yok); "Ortak ders" rozeti + T+U+L taşır, cohort'lar
"Aldığı gruplar"da eşit listelenir.

**Bilinen keskin kenar [kabul edildi, MVP]:** Bir tüketen bölüm, PATCH cohort
listesiyle BAŞKA bir tüketenin cohort'unu çıkarabilir (`_build_extra_cohorts`
üyelik aramaz). Küçük, güvenilen bir fakülte ölçeğinde kabul edildi; gerekirse
cohort-listesi değişikliğini sahibe kısıtlamak backlog.

- Test: `test_common_course_shared_edit_by_consumer`,
  `_delete_by_consumer`, `_delete_blocked_for_noncohort`,
  `_not_editable_by_noncohort_department`,
  `test_normal_course_edit_still_owner_scoped` (regresyon). Toplam 436 yeşil.

## K-50 · Öğretim üyesi web import: fakülte sayfasından çek [S+E] — K-08 açık konu 4 kapandı
K-08 "fakülte hocaları: fakülte web sayfasından **bir kerelik import**" demişti;
kaynağın URL'i ve veri yapısı açık kalmıştı (açık konu 4). Bu karar onu somuta
bağlar ve kapatır. Yeni uçlar: `POST /lecturers/import/preview` (yalnız okur) +
`POST /lecturers/import/commit` (onaylananları yazar). Frontend'de Öğretim Üyeleri
ekranında "Siteden İçe Aktar" butonu.

**Kaynağın iki katmanı [ölçüldü, canlı doğrulandı]:**
- LİSTE (`muhendislik.mu.edu.tr/tr/personel/akademik`): ~89 kişi, `div.person`
  içinde `.perName` (ad) + `.perTitle` (unvan) + "Detay" linki. **Bölüm YOK.**
- DETAY (`www.mu.edu.tr/tr/personel/<slug>` — **farklı domain**): "Kadro
  Bilgileri" bloğunda (`span#…lbl_kadro`) **Görev Birimi** ve **Kadro Birimi**,
  ayrıca `[itemprop=email]`. Detay sayfaları büyük (~376 KB).

**İki birim ayrı saklanır (`lecturers.duty_unit` + `cadre_unit`) [S kararı].**
Detay sayfasındaki tek "Bölüm" yerine ikisi de tutulur ve ekranda gösterilir;
çünkü **ikisi gerçekten farklı olabiliyor**: Murat Gül → Görev İnşaat / Kadro
Jeoloji; Deniz Ülgen → Görev *Rektörlük* (idari) / Kadro İnşaat. Yönetici
hocalarda Görev bir bölüm bile değildir. Bu alanlar GÖRÜNTÜ içindir — çakışma
matematiği `department_id`/`lecturer_id` kullanır, birim metnini değil.
- `department_id` (asli bölüm FK) önce **Görev Birimi'nden** eşlenir (fiilen
  ders verdiği yer); tutmazsa **Kadro Birimi'ne düşülür**. Yönetici hocalarda
  Görev bir bölüm değildir ("Rektörlük", "Dekanlık") ve asıl bölüm Kadro'da
  yazar — örn. Görev Rektörlük / Kadro İnşaat → İnşaat'a eşleşir. İkisi de
  tutmazsa NULL (model nullable). Eşleme aktif bölüm adına göre, sadeleştirilmiş:
  küçük harf, **tire/noktalama boşluğa** (site "Elektrik Elektronik" yazarken
  bizde "Elektrik-Elektronik" olabilir), tek boşluk, " Bölümü" eki atılır.

**Önizle → onayla, kör import değil [E].** Scraping kırılgandır; site markup'ı
sessizce değişir. İnsan kapısı olmadan bozuk bir parser çöpü doğrudan
`lecturers`'a — çakışma tespitinin kimlik anahtarına (K-08) — yazardı ve W2/E3'ü
sessizce delerdi. Bu yüzden preview yazmaz, farkı gösterir; kullanıcı görüp
seçtiklerini commit eder. Parser **gürültülü hata** verir: dolu sayfadan 0 kişi
ayrıştırılırsa `ScrapeError` → **502** (sessiz "0 yeni hoca" yalanı yerine).
Site sözleşmesi (selector'lar) tek modülde: `app/scrapers/mu_akademik.py`; site
değişirse yalnız o dosya + fixture testi kırılır.

**Dedup ada göre; normalize sağlamlaştırıldı [E].** Aday, `normalized_name` ile
mevcut kayıtlara karşı elenir (workgroup içi UNIQUE zaten var). Site unvanı AÇIK
yazıyor ("Doktor Öğretim Üyesi", "Araştırma Görevlisi"); elle giriş kısaltma
kullanıyor ("Dr. Öğr. Üyesi"). Eşleşmeleri için `normalize.TITLE_TOKENS`'a
**tam-kelime unvan formları** eklendi (doktor/öğretim/görevlisi/araştırma/
profesör/doçent). Bu kelimeler Türkçe kişi adında geçmez; ad token'ını düşürmez.

**Yalnız yeni kişilerin detayı çekilir [E].** Mevcutlar liste adından elenir,
detay sayfasına hiç gidilmez → kullanıcının "site güncellenince farkı aktar"
isteği: ilk tam tarama ağır, sonrakiler yalnız yeni eklenenleri okur. İçe
aktarılan kayıt `source="IMPORT"`, `is_external=false` (fakülte kadrosu, 40/a
değil); her satır ayrı `CREATE` loglanır (K-37 deseni; yeni bir audit fiili
eklenmedi, `source` alanı IMPORT'u zaten ayırt ediyor).

**Config, hardcode değil (brief §6.3):** liste URL'i `settings.
lecturer_import_list_url` (env'den; başka fakülte kendi listesini verir). Detay
adresleri liste sayfasındaki linklerden gelir. Yeni bağımlılık YOK: `httpx` +
`beautifulsoup4` zaten requirements'ta.

**Güven sınırı:** commit istemciden gelen satırlara elle create ile aynı düzeyde
güvenir; sunucu yine de (a) ada göre benzersizliği YENİDEN denetler (TOCTOU) ve
(b) `department_id`'nin bu workgroup'a ait olduğunu doğrular, değilse bölümü boş
geçer (partiyi düşürmez). Yetki: `require_lecturer_manager` (K-25).

**N+1 → sınırlı eşzamanlılık [uygulandı].** İş ağ-bekleme ağırlıklı (I/O-bound):
detay çekimi her sayfayı hızlandıramaz ama beklemeleri üst üste bindirebilir.
`fetch_details_bulk` detayları **8'li ThreadPoolExecutor** havuzuyla çeker
(`lecturer_import_concurrency`, env'den). Site boştayken ölçüm: 24 sayfa
**61 sn → 10,5 sn (5,8×)**, sonuçlar birebir aynı. Havuz küçük tutuldu —
kaynak siteyi bombalamamak için (paralel ama kibar). Tek sayfanın hatası o
kişiyi bölümsüz bırakır, partiyi düşürmez.
- **Keep-alive denendi ve GERİ ALINDI:** paylaşımlı istemci throttling altında
  havuzda bayat bağlantı → ReadTimeout üretti (kişi sessizce detaysız kalıyor)
  ve ölçümde per-request'ten yavaştı. İstek başına taze bağlantı daha sade ve
  güvenilir; hız kazancı eşzamanlılıktan gelir. `_TIMEOUT` 30 sn'ye çıkarıldı.
- **Gerçek darboğaz sunucu [ölçüldü]:** kaynak site bazen bizi throttle ediyor
  (~117 KB/s, sayfa başına ~2 sn); o anlarda 89 kişi ~90 sn sürebilir — istemci
  tarafında çözülemez. **Asıl pratik kaldıraç: bir kez COMMIT etmek.** İçe
  aktarılan kişiler sonraki taramada "zaten kayıtlı" diye elenir, detayları hiç
  çekilmez → tekrar çalıştırma neredeyse anlık. Vazgeçilip tekrar taranırsa her
  seferinde tam maliyet ödenir.
- **Kalan pürüz [kabul edildi, MVP]:** spinner ilerleme göstermez ve iptal
  yoktur (backend istemci kapansa da havuzu bitirir). `lecturer_import_
  max_detail_fetch` (200) emniyet supabı olarak durur.

**Not:** Sistemde zaten `POST /import/courses` (ders import) uçları vardı; bu iş
aynı önizle-onayla desenini hocalara taşır.

**Migration:** `f7b3c1a9e2d4` (lecturers.duty_unit + cadre_unit, nullable).
**Test:** `test_lecturer_import.py` — saf ayrıştırma gerçek HTML fixture'larına
karşı (`tests/fixtures/mu_*.html`) + uçlar ağ monkeypatch'iyle (internetsiz
çalışır): dedup, bölüm eşleme (tire + Kadro fallback), TOCTOU, yetki 403,
ScrapeError 502. Toplam 448 yeşil.

## K-51 · Veri ucundan gelen HER 401 oturumu düşürür [E] — "Not authenticated" düzeltmesi
**Belirti:** Kullanıcı sitede gezerken bazen "Not authenticated" görüp ekranda
asılı kalıyordu (login'e atılmıyordu). **Güvenlik açığı DEĞİL:** backend her
yetkisiz isteği zaten reddediyor (401/403), korumalı veri sızmıyor — otorite
sunucuda (brief §10.2). Sorun yalnızca **frontend oturum yönetimiydi**: oturum
ölünce kullanıcı dışarı atılmıyordu.

**Kök neden:** `deps.get_current_user` token YOKKEN **401 "Not authenticated"**
döner; frontend ise yalnız `401 && token varsa` çıkış yapıyordu. Token bir
önceki istekte temizlenmiş (süre doldu) ya da paralel isteklerden biri token'sız
çıkmışsa 401 geliyor ama `token` boş → koşul tutmuyor → ham hata ekranda kalıyor.

**Karar:** `api/client.ts` (`request` + `download`) artık **`/auth/*` DIŞINDAKİ
her uçtan gelen 401'de** token'ı siler ve `/login`'e yönlendirir — token elimizde
olsun olmasın. `/auth/*` istisnadır: login/şifre-sıfırlama/davet kendi 401'lerini
formda gösterir (yoksa sonsuz yönlendirme). Zaten `/login`'deysek tekrar
assign etmeyiz.

**Kapsam dışı [bilinçli]:** Pasif hesap (K-34) **403** "User account is not
active" döner ve `test_disabling_kills_the_existing_token` bunu 403'e kilitler;
403 aynı zamanda meşru "yetkin yok" reddi olduğundan (admin/ yetenek) körlemesine
çıkış yaptıramayız. Pasife alınan kullanıcının kabuğu açık kalır ama hiçbir
istek geçmez (her eylem 403 + hata). Temiz çözümü (403'e makine-okur bir sinyal
eklemek) backlog — K-24'ün "mesaj metnine göre ayırma" uyarısına düşmemek için
metin eşlemesi yapılmadı.

## K-52 · Unvan ve e-posta ad'dan AYRI alanlar [E] — K-08/K-50'nin devamı
K-08'den beri unvan `full_name`'in içine gömülüydü ("Doç. Dr. Ayşe Kaya");
frontend Select ile birleştirip `splitTitle`'la ayrıştırarak taklit ediyordu.
Bu karar unvanı **gerçek bir kolona** (`lecturers.title`) taşır, `full_name`'i
**saf ada** indirir; e-postayı da görünür ve elle girilebilir yapar.

**Neden ayrı kolon [E].** Unvanı ad'a gömmek üç yerde sızdırıyordu: (a) ekranda
"Ad Soyad" sütunu unvanı da taşıyordu, (b) her istemci birleştirme/ayrıştırma
mantığını tekrar yazmak zorundaydı (kırılgan prefix eşleşmesi), (c) web import
site formunu ("Doktor Öğretim Üyesi") ada yapıştırıyordu. Artık `title` ayrı;
`full_name` yalnız ad. **Dedup DEĞİŞMEZ:** `normalized_name` unvanı zaten
söküyordu, o yüzden ada göre benzersizlik ve W2/E3 hoca çakışması aynı kaldı.

**Kanonikleştirme tek kaynakta [E].** `normalize.canonical_title` serbest unvan
metnini kısa forma indirir ("Prof.Dr."→"Prof. Dr.", "Araştırma Görevlisi"→
"Arş. Gör."). Token KÜMESİ eşlemesi (sırasız): site açık yazar, elle giriş
kısaltır — ikisi de aynı kanonik forma düşer. `split_title` eski birleşik
adları ayırır (migration bunu kullanır). Bu kelimeler Türkçe kişi adında geçmez
→ ad token'ı yanlışlıkla tüketilmez. Tanınmayan unvan ham haliyle korunur (bilgi
kaybolmasın), sadece ekleme formundaki Select'te hazır seçenek olmaz.

**Eksik unvanlar eklendi [S/E].** Frontend listesi 6 unvandı; sitede olup eksik
olanlar eklendi: "Prof.", "Doç.", "Öğr. Gör. Dr.", "Arş. Gör. Dr.", "Uzman".
Backend `CANONICAL_TITLES` ile frontend `TITLES` eş tutulur (aynı kısa formlar).

**create/update unvanı AYRIŞTIRMAZ [E].** API `full_name`'i olduğu gibi saklar;
unvanı istemci ayrı `title` alanında gönderir. Böylece eski testler (unvanı
`full_name`'e gömen `POST /lecturers`) kırılmaz — sadece o satırlarda `title`
boş kalır, ad string'i aynen durur. Otomatik ayrıştırma yalnız **migration**'da
(eski veri) ve **web import**'ta (site formu) yapılır.

**E-posta artık görünür [E].** Alan zaten modelde ve `LecturerCreate`'te vardı
ama `LecturerOut`'ta yoktu → istemciye hiç dönmüyordu ve ekleme formunda alanı
yoktu. `LecturerOut`'a eklendi; forma opsiyonel e-posta girişi (basit biçim
denetimi, zorunlu değil) kondu; tabloda ayrı sütun (`mailto:` linki).

**Diğer ekranlar regresyonsuz [E kararı].** Unvan ad'dan çıkınca Dersler/
Sınavlar/Haftalık'ta hoca "Ayşe Kaya" olarak görünüp unvanı kaybedebilirdi.
`types.lecturerLabel(l)` = `title + full_name` yardımcısıyla o ekranlarda ad+unvan
birlikte gösterilir; backend zaten nested `LecturerOut`'ta `title`'ı taşıdığı
için ek uç gerekmedi.

**Migration:** `b8d2f4a6c1e3` — `title` kolonu (nullable) + mevcut `full_name`'leri
`split_title` ile ayırıp unvanı `title`'a taşır, ad'ı saflaştırır. Downgrade
`full_name`'i geri birleştirmez (kanonik form üretilmişti; kayıpsız değil).
**Test:** `test_lecturer_import.py`'a `canonical_title`/`split_title` birim
testleri + import'un unvanı ayrı taşıdığı doğrulaması. Test DB `create_all` ile
kurulduğundan migration testte çalışmaz; kolon modelden gelir. Toplam yeşil.

## K-53 · Programa etki eden ders değişikliği taslak yerleşimi sıfırlar [E]
**Belirti:** Kullanıcı bir dersi haftalık programa yüz yüze + derslikli koydu,
sonra dersi (bileşeni) online yaptı; haftalık girişte derslik öylece kaldı.
**Kök neden:** online/derslik/teslim bilgisi haftalık GİRİŞ'te tutulur; ders
bayrağı (K-45 `*_online`) değişince mevcut girişler güncellenmiyordu. Giriş
kaydındaki "online → derslik olamaz" kontrolü (K-23) yalnız kayıt anında çalışır.

**Karar:** `update_course`'ta **programa etki eden alan** — `theory/practice/
lab_online` ve `hours_theory/practice/lab` — gerçekten DEĞİŞTİYSE bu dersin
**taslak** yerleşimleri (tüm şubelerinin haftalık girişleri + dersin sınavları)
**silinir**; ders palete geri döner, kullanıcı yeniden yerleştirir. Bayat
derslik/teslim/oturum verisi sessizce kalmaz.
- **Yalnız programa etki eden alanlar [S/E].** Ad/kod/seçmeli gibi kozmetik
  düzeltmeler yerleşime dokunmaz — yazım düzeltince program silinmesin. Değişim
  "gerçekten değişti mi" (`data[f] != course.f`) ile ölçülür; aynı değer
  gönderilmesi tetiklemez. Frontend aynı karşılaştırmayı yapıp mesajı gösterir.
- **Yalnız taslak; yayınlanmış varsa REDDET [E].** Yayınlanmış (SUBMITTED)
  giriş/sınav K-03 gereği kilitli. Programa etki eden alan değiştirilmek istenir
  ama yayınlanmış yerleşim varsa **409**: "önce onları taslağa çevirin". Silme
  yalnız DRAFT'lara uygulanır. Böylece yayın kilidi bir ders düzenlemesiyle
  sessizce delinmez.
- **Neden hem haftalık hem sınav [E].** Sınav ders düzeyindedir (K-16) ve
  online/saat onu doğrudan geçersiz kılmaz; yine de kullanıcı "ders özelliği
  değişince ikisini de sıfırla" istedi — öngörülebilir tek kural. Silinen her
  giriş/sınav ayrı DELETE loglanır (K-35 deseni), hepsi ders UPDATE'iyle aynı
  transaction'da.
- **Frontend [E].** Ders düzenlemesi programa etki eden alanı değiştirdiyse
  yeşil bildirime "haftalık ve sınav yerleşimleri sıfırlandı, yeniden
  yerleştirin" eklenir. Ders 409'ları (kod çakışması + yayın bloğu) artık `code`
  alanına değil bildirime düşer — ikisi de tek satıra sığmayan açıklama taşıyor.

**Test:** `test_wp3_weekly.py` — taslak giriş sıfırlanır, kozmetik değişiklik
korur, yayınlanmış giriş 409 ile bloklar (üçü de yeşil).

## K-54 · Bologna import ortak dersi BÖLÜMLER-ARASI birleştirir [E] — çift kayıt düzeltmesi
**Belirti (kullanıcı):** Önce CENG, sonra EEE dersleri import edildi. İki bölümün
de aldığı ortak dersler (ENG 1803, MATH 1851, CHEM…) "Ortak Dersler" ekranında
**birleşmedi**, her bölüm için ayrı kart çıktı. AKTS'leri de aynıydı ama yine
ayrıydı.

**Kök neden:** `create_course` (elle ekleme) K-48'den beri ortak dersi kod'a göre
birleştiriyordu (aynı kodlu ortak ders varsa yeni kayıt açmayıp gönderilen
bölüm/sınıf/dönem'i **ek cohort** yapıyor). Ama `POST /import/courses` commit
döngüsü bu mantığı **ATLIYOR**du: her satır için düz `Course(...)` açıyordu.
Üstelik çift-kayıt savunması yalnız **hedef bölümde** (`department_id == dep.id`)
bakıyordu; CENG'in sahiplendiği ENG 1803'ü EEE import'u göremiyordu → ikinci kayıt.

**Karar:** Birleştirme mantığı `courses.py`'de **tek kaynağa** çıkarıldı
(`_find_common_course` = workgroup'ta aynı kodlu ortak dersi bul; `_covered_cohorts`
= birincil ∪ ek cohort kümesi). Hem `create_course` hem import bunu kullanır.
Import commit'te `is_common` satır için: aynı kodlu ortak ders varsa yeni kayıt
AÇMA — (bölüm, yıl, dönem) onun ek cohort'u olur (kapsanıyorsa sessizce atla).
Yoksa yeni ortak ders açılır (ilk aktaran bölüm birincil sahibi).
- **Neden kod'a göre, workgroup-genelinde [E].** Ortak dersin kimliği kodudur
  (K-48); "iki bölüm de alıyor" tam olarak bu — tek ders, çok cohort. Sahibin
  ad/saat/AKTS değeri kalır, tüketen bölüm bunları değiştiremez (paylaşılan
  alanlar). Bu yüzden import'ta ortak dersin düzenlenen ad'ı **yok sayılır**
  (yalnız cohort eklenir) — create_course ile birebir aynı davranış.
- **Preview de düzeltildi [E].** Önizleme `exists` işareti eskiden yalnız hedef
  bölümün KENDİ derslerine bakıyordu; başka bölümün ortak dersini bu bölüm
  tüketiyorsa yine "yeni" görünüyordu. Artık workgroup'taki ortak derslerin bu
  bölümü kapsayan cohort'ları da `exists=true` sayılır — commit'in sessizce
  atlayacağı bir dersi "yeni" diye önermeyiz.
- **Sonuç şekli genişledi [E].** `CourseImportResult`'a `merged_count`/`merged`
  eklendi: kaç ders YENİ açıldı (added) vs mevcut ortak derse cohort olarak
  eklendi (merged) vs zaten kapsanıyordu (skipped). Frontend bunu ayrı gösterir
  ("N ders mevcut ortak derse eklendi"). Her merge ayrı `UPDATE` loglanır (K-37).

**Test:** `test_wp7_import.py` — `test_import_merges_common_across_departments`
(A'ya ekle→B import edince tek id iki cohort, tekrar B idempotent atlar) +
mevcut iki testin varsayımı yeni davranışa göre güncellendi (edit-koruma testi
create yolunu deterministik kılmak için `is_common=false`; yetki testi
`added+merged=71` sayar — paylaşımlı test DB'sinde önceki ortak derslere bağımlı
sayı sabitlenemez).

## K-55 · Ders AKTS (ECTS) alanı [S/E] — kategori + import
Kullanıcı isteği: AKTS derslerde bir alan olsun (Dersler ekranında görünsün,
ders eklerken sorulsun, içe aktarırken listelensin). Bologna sayfası AKTS'yi
zaten taşıyordu ama okunmuyordu ("Course modelinde karşılığı yok" notu).

**`courses.ects` NULLABLE [E].** Zorunlu yapmak mevcut ~yüzlerce dersi ve unvanı
`full_name`'e gömen eski POST testlerini kırardı; ayrıca elle eklemede kullanıcı
bilmeyebilir. Bologna import her zaman doldurur (site tam sayı verir), elle
eklemede opsiyonel (`—`). Ders düzeyindedir (T+U+L gibi şubeler arası ortak),
**çakışma matematiğine GİRMEZ** — yalnız bilgi/görüntü.
- **Parse [uygulandı].** `bologna_import` AKTS'yi tablo sütunundan (`cells[5]`)
  okur; boş/sayısal değilse None. Ondalık gelmez.
- **Ayrıştırma yok, generic akış [E].** `CourseCreate/Update/Out` + import şekline
  `ects` eklendi; update generic setattr döngüsüyle uygular (programa-etkili alan
  DEĞİL → K-53 taslak sıfırlamayı tetiklemez). Merge'de dokunulmaz (aynı ders).
- **Frontend [E].** Ekleme/düzenleme formunda opsiyonel AKTS girişi; Dersler
  listesinde (tablo, K-56) ayrı **AKTS sütunu**; import önizleme tablosunda ayrı
  AKTS sütunu + satır-içi düzenleme.

**Migration:** `a1e4c7f9d2b6` (courses.ects SmallInteger nullable).
**Test:** `test_wp7_import.py::test_import_parses_and_persists_ects` — önizleme
AKTS'yi getirir (Intro to CS = 6), commit saklar.

## K-56 · Dersler ekranı: kart yerine TABLO + satır-içi detay [E]
Kullanıcı isteği: Dersler listesi iki sütunlu kart yerine **sütunlu tablo**
(Kod · Ad · AKTS · Tür · Sınıf · Dönem) olsun; kategoriler (Ortak Dersler, N.
Dönem) tablo başlıklarının üstünde kalsın. Bir derse tıklayınca detay + şube
yönetimi **modal yerine SATIR İÇİNDE** (colSpan'li açılır satır, akordeon) gelsin.

**Neden [E].** Kart-grid çok yer kaplıyordu ve tarama zordu; tablo taranabilir,
AKTS gibi alanları yan yana gösterir. Modal yerine satır-içi açılım bağlamı
korur (kullanıcı listedeki yerini kaybetmez). Ortak ders satırında Sınıf/Dönem
tek değere sığmadığından "—"; cohort'ların tamamı açılan detayda listelenir.
- **Panel yalnız açıkken mount [E].** Kapalı satır boş bir `<Collapse>` tutar,
  `CourseDetailPanel` (kendi `useForm`'u var) yalnız açık derste render edilir —
  uzun listede N form/efekt mount etmemek için.
- Eski `SectionsModal` → `CourseDetailPanel`'e indirgendi (Modal sarmalayıcı
  kaldırıldı, içerik doğrudan render); şube silme onayı hâlâ küçük bir modal.

**Not:** Yalnız frontend (`CoursesPage.tsx`); API/şema değişmedi.

## K-57 · Cohort filtresi EK cohort'ları kapsar (Haftalık/Sınav/Dersler) [E]
**Belirti (kullanıcı):** CE — İnşaat 1. sınıf Güz cohortu seçilince Haftalık
paletinde 2, Dersler'de 1 ders çıkıyordu; Bologna'da o cohortta 8 ders var.
"Ortak dersleri seçince sadece 4 ders" geliyordu.

**Kök neden:** Cohort üyeliği = **birincil ∪ ek cohort** (K-48). Ama palet ve
liste filtreleri yalnız BİRİNCİL'e (`course.department_id == dep`) bakıyordu —
ortak (servis) dersi TÜKETEN bölümün cohort'undan (`extra_cohorts`) düşürüyordu.
Yani ortak dersin haftalık/sınav kontrolü fiilen yalnız "ilk atandığı (birincil)
bölüme" yapılıyordu; ENG/MATH/PHYS gibi CE'nin ek cohort'la aldığı dersler
listede yoktu. `/courses` bölüm filtresi ek cohort'ları katıyordu ama year/
semester yine birincile uygulanıyordu; `/weekly-entries` ve `/exams` ek cohort'u
hiç katmıyordu.

**Karar:** Tek kaynak `courses.cohort_course_filter(department_id, year, semester)`
= birincil VEYA ek cohort eşleşmesi (SQL `or_(and_(primary...), extra_cohorts.
any(and_(extra...)))`). year/semester **cohort eşleşmesine** uygulanır (birincile
DEĞİL) — ortak ders tüketen bölümün yıl/döneminden gelsin. Üç uç da bunu kullanır:
`/courses`, `/weekly-entries`, `/exams`. Ölçüm: CE/1/FALL → 2 yerine **9 ders**.
- **Frontend simetrik [E].** `types.courseInCohort` (birincil ∪ ek) ve
  `courseCommonForDept` ("Ortak dersler" görünümü: bölümün o dönemde aldığı tüm
  ortaklar). WeeklyPage paleti + ExamsPage cohortCourses artık bunları kullanır.
- **Dersler ekranı [E].** Ortak Dersler kategorisi belirli sınıf seçilince
  gizleniyordu → artık ortak ders varsa her zaman görünür (cohort o ortakları da
  alır). Böylece CE/1/Güz: 8 ortak + 1 bölüm dersi = tam cohort.
- **Derslik merceği kapsam dışı:** cohort ders listesi kullanmaz (classroom_id/
  lecturer_id ile süzülür), dokunulmadı.

**Test:** mevcut suite yeşil (cohort filtresi gerçek veriyle doğrulandı; CE/1/FALL
9 ders). Not: import edilmiş veride ek cohort'lar birincil ile aynı yıl/dönemde
olduğundan eski year/semester filtresi tesadüfen kısmen çalışıyordu; yeni filtre
farklı yıl/döneme de dayanıklı.

## K-58 · Bölüm "Hızlı İşlemler" YAZMA kısayolları yetkiye göre kilitli [E]
**Belirti (kullanıcı):** Ders ekleme yetkisi OLMAYAN alt hesap, Bölümler → bir
bölümün "Hızlı İşlemler"inden "Ders Ekle"ye tıklayıp ekleme formuna düşebiliyordu
(her bölümde, üye olmasa da).

**Güvenlik açığı DEĞİL:** Sunucu otoritesi sağlam (brief §10.2) — `POST /courses`
`require_course_manager` ile `can_manage_courses` yoksa **403**, ayrıca bölüm
üyeliği ikinci katman (`_ensure_department_access`). Yani veri yazılamıyordu;
sorun yalnız yanıltıcı UI: kullanıcı yetkisiz bir forma yönlendiriliyordu.

**Karar:** Hızlı İşlemler'deki **YAZMA** kısayolları (`Ders Ekle`, `Öğretim Üyesi
Ekle`) `canWriteIn` ile kilitlenir; yetki yoksa **karartılır** (Mantine
`data-disabled`) + tıklama engellenir + neden tooltip'i ("Bu bölümde ders ekleme
yetkiniz yok"). `LockedAction` yardımcı bileşeni: native `disabled` yerine
`data-disabled` kullanılır ki buton hover alsın ve tooltip görünsün.
- **`Ders Ekle`** → `can_manage_courses` + seçili bölüm üyeliği (K-25 iki boyut).
- **`Öğretim Üyesi Ekle`** → `can_manage_lecturers` (paylaşımlı kaynak, bölümsüz).
- **`Haftalık/Sınav ... Aç`** → GÖRÜNTÜLEME (K-26: herkes tüm bölümleri okur) →
  herkese açık kalır; kilitlenmez. "Aç" bir yazma değil, gezinmedir.

**Not:** Yalnız frontend (`DepartmentsPage.tsx`); görünüm kararı — otorite yine
sunucuda. Diğer ekranlar (Dersler/Haftalık/Sınav) zaten `canWriteIn` ile yazma
düğmelerini gizliyordu; bu, Bölümler genel-bakışındaki kısayolları da aynı
kurala bağlar.

## Not · Üç çakışma kuralı DB şemasıyla zaten engelli (W6/E2/E6) [gözlem]
Çakışma motorunun 3 kuralı, geçerli bir kayıtla asla tetiklenemez; ilgili geçersiz
veri veritabanı kısıtlarıyla (CHECK/UNIQUE) baştan reddedilir. Yani bu kurallar
motorda **savunma amaçlı** (defense-in-depth) durur — pratikte ölü kod değildir
ama normal akışta hiç ateşlenmez:
- **W6** (pencere dışı haftalık): `weekly_schedule_entries` CHECK'leri —
  `day_of_week BETWEEN 1 AND 5` + `start_slot + slot_count - 1 <= 9` — hafta sonu
  veya taşan slot satırını saklatmaz.
- **E2** (mükerrer sınav): `exams` üzerinde `UNIQUE(course_id, exam_type,
  exam_index)` — aynı ders+tip+sıra ikinci kez eklenemez.
- **E6** (hafta sonu sınavı): `exams` CHECK `ck_exams_weekday_only` — Cmt/Paz
  tarihli sınav saklanamaz.

Bu gözlem, çakışma örnekleri seed edilirken çıktı: kalan 17 kural gerçek veriyle
kurulup GET /conflicts'te doğrulandı (9 HARD + 13 WARNING); bu 3'ü kurulamadı.
İleride motor testlerinde bu 3 kural yalnız birim düzeyde (elle dict ile) test
edilebilir — uçtan uca (DB üzerinden) değil.

## K-59 · Yayın onay akışı: özel cohort taslağı + yetkili onayı [E] — K-03 revizyonu
**Belirti (kullanıcı):** Program düzenleme yetkisi olan tek kişi, yaptığı
değişikliği doğrudan yayına alabiliyordu. "Son programa ilk kullanıcı tek başına
etki ediyor." İkinci bir göz yok.

**Mevcut durumun tespiti (tasarım öncesi okuma):**
- Program "sürüm" taşımıyor; `DRAFT`/`SUBMITTED` bütün programın değil TEK TEK
  SATIRLARIN durumu. "Yayınlamak" = seçili satırları SUBMITTED yapmak.
- Taslaklar **zaten herkese görünüyordu**: `GET /weekly-entries` status'e hiç
  bakmıyor (K-26), frontend yalnız rozetle ayırıyordu. Yani "yayınlayınca
  herkese düşer" değil, satır oluştuğu anda düşüyordu.
- `revert-to-draft` **denetimsiz bir yayından-kaldırmaydı**: `can_manage_weekly`
  olan biri yayındaki satırı tek istekle indirebiliyordu. Onay kapısı yalnız
  submit'e konsaydı bu delik açık kalırdı.
- Export status'e bakmıyor, taslakları da basıyordu.

**Karar — model:** Onay birimi satır değil, **cohort taslağı**. Bir taslak, bir
cohort'un (bölüm+yıl+dönem) bağımsız ve tam program halidir; açılırken o anki
yayının kopyasıyla dolar, "Temizle" ile sıfırdan da dizilebilir.

- **Taslak ÖZELDİR.** Yalnız sahibi görür ve saklanır (sonradan devam edilir).
  Herkesin gördüğü tek şey yayındaki onaylı programdır. Bunun sonucu: **taslaklar
  arası çakışma diye bir şey yoktur** — başka hesabın taslağı hiçbir sorguya,
  hiçbir çakışma evrenine girmez.
- **Fark CANLIDIR.** Taslağın açıldığı andaki hali saklanmaz; fark her seferinde
  *o anki yayına* karşı hesaplanır (eşleştirme: şube + oturum tipi).
  Dolayısıyla taban anlık görüntüsü, sürüm sayacı, `origin_entry_id`, "bayat
  taban" kavramı ve buna dayalı engelleme kuralları **yoktur**.
- **Onay, farkı uygular** — taslağın tamamını yayının yerine geçirmez.
  > Tasarım sırasında önce "onay = cohort'un satırlarını taslağınkilerle
  > değiştir" kurulmuştu. Bu, iki kişinin aynı cohorttan taslak açtığı durumda
  > sonra onaylananın diğerinin onaylanmış değişikliğini SESSİZCE silmesine yol
  > açıyordu. Canlı fark bunu çözer: onaylayıcı "PHYS101 Sal 3 → Pzt 2" satırını
  > ekranda görür, geri alındığını bilerek karar verir. Sorun üzerine yazmak
  > değil, sessizce yazmaktı; çözüm engelleme değil şeffaflık.

- **DÜZELTME [uygulama sırasında ölçüldü].** Yukarıdaki paragraf, ilk yazıldığında
  "farkı uygulamak diğerinin değişikliğini KORUR" gibi okunuyordu. **Korumaz.**
  Fark, "gönderen ne değiştirdi" değil "gönderenin taslağı ŞU ANKİ yayından
  nerede farklı" demektir. Mehmet'in taslağı Ayşe'nin taşıdığı dersin eski
  halini taşıyorsa, Mehmet'in onayı o dersi de eski yerine geri götürür — ve
  bu, onay ekranında ayrı bir satır olarak görünür.
  - Sonuç olarak fark-uygulama ile toptan-ikame **aynı son duruma** varır;
    aradaki gerçek fark **satır kimliğinin korunması**dır (taşıma, satırı silip
    yeniden yaratmaz → denetim izi kopmaz).
  - Yani sessiz üzerine yazmaya karşı tek koruma **görünürlüktür**: onaylayıcı
    geri alınacak her satırı fark listesinde görür.
    Test: `test_approving_a_stale_draft_also_reverts_the_other_persons_change`.
  - **Bayatlık işareti (bu düzeltmenin gereği):** inceleme ekranı "taslak şu
    tarihte açıldı, program o tarihten sonra N kez güncellendi (son: kim,
    ne zaman)" bilgisini taşır (`DraftReviewOut.staleness`). Fark zaten satır
    satır gösteriyor; bu, onaylayıcıya DİKKATLİ BAKMASI gerektiğini söyleyen
    üst düzey işaret. Yeni şema gerekmedi: aynı cohort'un onaylanmış
    taslakları + `affected_departments` üzerinden ortak ders etkisi sayılır.

**Karar — yetki:** Yeni tek bayrak `users.can_approve_schedule` (K-25 fabrikası
`_require_capability` ile), haftalık + sınav ortak. Onaylamak bir alan
uzmanlığı değil gözetim rolüdür; ikiye bölmek kuyruğu/UI/testi ikiye katlar.
- **Taslak açmak:** herkese açık. Özel taslak kimseyi etkilemez, "şunu taşısak
  ne olur" kum havuzu olarak değerlidir.
- **Onaya göndermek:** `can_manage_weekly` + bölüm üyeliği (K-25 iki boyut aynen).
- **Onaylamak:** `can_approve_schedule` + bölüm üyeliği.
- **Öz-onay YASAK, ADMIN dahil.** İstisna yok: tek yetkilisi olan workgroup
  yayın yapamaz, ikinci onay yetkilisi davet etmek zorundadır. Bilinen sonuç —
  seed/demo ve test hesabı kurulumu buna göre güncellenecek.

**Karar — yaşam döngüsü:** `OPEN → PENDING → APPROVED | REJECTED`.
- Bekleyen taslak **donar** (salt-okunur): onaylayıcı hareketli hedef
  incelemesin. Sahibi "geri çek" derse `OPEN`'a döner.
- Onaylanan taslak salt-okunur geçmiş kaydı olur; reddedilen gerekçesiyle
  `OPEN`'a döner, düzeltilip yeniden gönderilir.
- Kuyruk **ortak ve atamasız** (bölümün onay yetkilileri görür) + gönderende
  serbest not alanı. Atama kolonu sonradan eklenebilir, sökülmesi zordur.

**Karar — şema:**
- Yeni `schedule_drafts`: cohort kimliği (department_id, year, semester), ad,
  durum, `created_by`, gönderim (`submitted_at`, `submit_note`), inceleme
  (`reviewed_by`, `reviewed_at`, `review_note`), etkilenen bölümler (ortak ders).
- `weekly_schedule_entries.draft_id` (nullable FK). **`draft_id IS NULL` = yayında.**
- `weekly_schedule_entries.status` ve `submitted_at` **KALKAR**: `draft_id` ile
  aynı gerçeği söyleyen iki kolon er geç birbiriyle çelişir. `(status =
  'SUBMITTED') = (submitted_at IS NOT NULL)` CHECK'i de onunla birlikte gider.
  **Ama ilk migration'da değil.** `status`'ü hemen düşürmek `schemas.py`,
  `weekly_entries.py`, `export_service.py`, seed'ler, testler ve frontend'i aynı
  anda kırar — bunları düzeltmek zaten 3-6. adımların işi. Bu yüzden ilk
  migration **tamamen eklemelidir** (hiçbir kolon düşmez, mevcut akış aynen
  çalışır); düşürme + artık `DRAFT` satırlarının **silinmesi** (kullanıcı kararı:
  taşınmayacak) yeni uçlar devreye girdikten sonra ayrı bir **temizlik
  migration'ına** bırakılır. Böylece her commit'te ağaç yeşil kalır.
- `entry_status` enum TİPİ kalır: sınavlar hâlâ kullanıyor (sınav fazı ayrı).
- Onaylanan taslak kaydı **değişiklik kaydının kendisidir** — ayrı bildirim
  tablosu yok. Uygulama içi akış ("bölümünüzü etkileyen son değişiklikler")
  bu tablodan türetilir. E-posta bu fazda YOK (kullanıcı kararı).

**Karar — çakışma motoru:** Motorun kendisine (`app/conflicts/`, saf Python)
DOKUNULMAZ. Tek değişiklik `conflict_service._weekly_universe(...)` dikişinde
bir `draft_id` parametresi (K-22'nin "motoru tek dikişten çağır" kararı tam
burada ödüyor):
- `draft_id` yok → evren = yalnız yayındaki satırlar.
- `draft_id` var → diğer cohort'ların yayını + taslağın kendi satırları.
- Cohort kapsamı için yeni sorgu yazılmaz, K-57'nin `cohort_course_filter`'ı
  kullanılır (ortak dersi tüketen bölümden de getirir).
- Kontrol **hem gönderimde hem onayda** koşar. Talep temizken başka bölüm bir şey
  yayınlayabilir; onay anında hard çakışma çıkarsa onay engellenir ("bu talep
  artık güncel programla çakışıyor"). Kullanıcının en baştaki isteği buydu:
  "o anki program ile çalışmaları kontrol edilip".
- Çakışma raporu ve dashboard **yalnız yayını** tarar. Bugünkü "DRAFT + SUBMITTED
  hepsi" evreni sadeleşir.

**Karar — ortak ders (K-48/K-49 ile ilişki):** K-49 ortak dersin düzenlenmesini,
şube yönetimini ve silinmesini tüketen bölümlere açtı; ama **haftalık yerleşimi
açmadı** — `weekly_entries` uçları hâlâ birincil bölüme bakıyor
(`_ensure_department_access(user, section.course.department_id)`). Bugünkü
tutarsız sonuç: CE, MATH101'e kendi şubesini ekleyebiliyor ama o şubeyi programa
YERLEŞTİREMİYOR.
- **Yerleştirme de paylaşıma açılır:** haftalık uçlarda K-49'un mevcut
  `_ensure_course_access` yardımcısı kullanılır. Şubeye bölüm kolonu
  (`course_sections.department_id`) EKLENMEZ — yerleştirme paylaşımlıysa şubeyi
  bir bölüme atfetmeye gerek yoktur.
- Ortak dersin tek fiziksel yerleşimi vardır; "onaylanınca tüm programlarda yeri
  değişir" davranışı bu yüzden kendiliğinden gelir, ek iş gerektirmez.
- **Uyarı zorunlu:** ortak ders taşınmadan önce etkilenen bölümleri listeleyen
  pop-up (`_course_cohorts()` verisi hazır).
- **Tek onay + bildirim:** talebi gönderen bölümün onaylayıcısı tek başına
  onaylar, etkilenen bölümler akışta görür. K-49'un kabul ettiği "güvenilen
  fakülte ölçeği" toleransıyla tutarlı.
- **"Temizle" ortakları silmez** (varsayılan): yalnız cohort'un kendi dersleri.
  Ortakları da silmek ayrı ve açıkça uyaran bir seçenektir — aksi halde masum
  görünen bir düğme üç bölümün programından ders düşürür.

**Uygulama sırası:**
1. Şema + migration — **eklemeli** (`schedule_drafts`,
   `draft_affected_departments`, `weekly_schedule_entries.draft_id`,
   `users.can_approve_schedule`). ✅ `d3f8b1c47a09`; up/down/up doğrulandı,
   9 şema testi (`test_k59_draft_schema.py`) + mevcut 467 test yeşil.
2. Motor dikişi: `_weekly_universe(..., draft=None)` + `scan_draft`. ✅
   `cohort_course_filter` router'dan `app/cohort.py`'ye taşındı (servisin
   router'dan import etmesi bağımlılığı ters çevirirdi). 8 test
   (`test_k59_draft_universe.py`).
3. Taslak API'si: oluştur (kopyala) / temizle / düzenle / fark / gönder / geri çek. ✅
   `app/draft_service.py` (kopyalama + temizleme + **canlı fark**) ve
   `routers/schedule_drafts.py` (14 uç). Fark eşleştirmesi `(şube, oturum tipi)`
   grubu içinde yapılır; aynı yerleşimler birebir eşleşip elenir, artan varsa
   TAŞINDI / EKLENDİ / KALDIRILDI çıkar. "Temizle"den sonra baştan dizilse bile
   sonuç doğru: fark "nasıl yapıldığını" değil "sonucun neresi farklı"yı anlatır.
   15 test (`test_k59_draft_api.py`).
4. Onay API'si: kuyruk / inceleme / onayla (fark uygula) / reddet. ✅
   `routers/schedule_approvals.py` + `deps.require_schedule_approver`.
   `draft_service.pair_changes` TEK eşleştirme noktası: onaylayıcının GÖRDÜĞÜ
   fark ile onayın UYGULADIĞI fark aynı hesaptan çıkar, yoksa ekranda bir şey
   görünüp başka bir şey yayına geçebilirdi. 12 test
   (`test_k59_approval_api.py`); öz-onay yasağı admin dahil doğrulandı.
5. Frontend haftalık: yayın-taslak modu, temizle, ortak ders uyarısı. ✅
   `components/DraftBar.tsx` (mod çubuğu + fark tablosu + onaya gönderme) ve
   `WeeklyPage.tsx` bağlantısı. Kilit noktalar:
   - **Yazma yetkisi yer değiştirdi.** `canWrite` artık "düzenlenebilir bir
     taslağın içindeyim" demek; `can_manage_weekly` + üyelik **onaya gönderme**
     kapısına taşındı. Taslak açmak/düzenlemek yetki istemez (K-59).
   - Bütün CRUD `writeBase` üzerinden taslağın altına gider; geri-al yığını da
     (`UndoEntity` şablon tipiyle) aynı kökü kullanır.
   - **Satır bazlı `status` arayüzden kalktı**: "yayında/taslak" rozeti, kilit
     ikonu ve "taslağa çevir" düğmesi silindi — durum artık satırın değil
     MODUN özelliği. Eski `Yayınla` düğmesi ve `SubmitModal` da kaldırıldı.
   - Ortak ders taşınırken/kaldırılırken etkilenen bölümleri sayan onay
     diyaloğu (`sharedCourseOk`, veri `Course.extra_cohorts`'tan).
   - Taslaklar yalnız cohort bakışında; "Ortak dersler" sözde-yılında taslak
     açılamaz (cohort'un sayısal yılı yok).
   - Yetki arayüzü: `can_approve_schedule` kontrata bağlandı (UserPublic /
     UserListItem / InviteRequest / UserUpdate + users router) ve
     `UsersSection`'da YAZMA yetkilerinden **ayrı başlık** altında gösteriliyor —
     aynı listede sıradan bir kutu gibi dursa yanlışlıkla verilmesi kolaylaşırdı.
6. Frontend onay sayfası: kuyruk + inceleme + fark + ızgara + onay/ret. ✅
   `pages/ApprovalsPage.tsx` + `components/DiffTable.tsx` (taslak sahibinin
   "Farkı Gör"ü ile onaylayıcının incelemesi AYNI tabloyu kullanır — ayrı
   çizilseydi zamanla ayrışırlardı). Menü girişi `approverOnly` ile gizli.
   - **"Yan yana ızgara" yerine tek ızgara + fark tablosu.** İki ızgarayı yan
     yana sıkıştırmak ikisini de okunmaz yapıyordu; fark tablosu zaten "ne
     değişti"yi anlatıyor, ızgara "haftanın bütününde nereye oturuyor"u.
     Değişen yerleşimler ızgarada vurgulu.
   - **Vurgu ŞUBEYE değil YERLEŞİME bağlı.** İlk hali şube bazlıydı ve gerçek
     veride bir şubenin aynı slotta iki satırı olunca DEĞİŞMEYEN kopyayı da
     "taşındı" gibi gösteriyordu (tarayıcıda yakalandı).
   - Bayatlık bandı, hard çakışmada onay düğmesinin kapanması, öz-onayda
     ikisinin de kapanması ve gerekçe zorunlu ret ekranı burada.
7. Taslak kapsamı + değişiklik akışı. ✅
   - **Kapsam açığı kapandı.** Taslağa yerleşim eklerken yalnız workgroup
     izolasyonu aranıyordu; CE'nin sorumlusu MATH'in dersini kendi taslağına
     koyup onaylatabiliyordu (gönderim yetkisi yalnız CE üyeliğine bakıyor).
     `_ensure_section_in_cohort` sınırı `cohort_course_filter` ile çizer —
     taslağın neyi kopyaladığını ve çakışma evreninin neyi dışladığını
     belirleyen filtrenin AYNISI. İkinci fayda: kapsam dışı satırın yayında
     karşılığı olmadığı için farkta sonsuza dek "EKLENDİ" görünürdü.
   - **K-49 tutarsızlığı kendiliğinden çözüldü.** Ortak ders, tüketen bölümün
     cohort'undan filtreye takılır → tüketen bölüm onu KENDİ taslağında
     yerleştirebilir. Eski `_ensure_department_access` (birincil bölüm) engeli
     yeni akışta yok; `course_sections.department_id` eklemeye gerek kalmadı.
   - **Değişiklik akışı** (`GET /schedule-changes` + `ChangeFeed`): ayrı
     bildirim tablosu YOK, onaylanmış taslak kaydının kendisi değişiklik
     kaydıdır. "Beni ilgilendiren" = kendi bölümümün cohort'u VEYA ortak ders
     üzerinden etkilenen bölümler (`affected_departments`). Okundu/okunmadı
     yok — bu bir akış, bildirim merkezi değil. Ana sayfada ve haftalık
     ekranın YAYIN modunda görünür (taslaktayken gürültü olurdu).
8. Seed/test hesapları: ikinci onay yetkilisi. ✅
   Öz-onay yasağı (admin dahil) tek hesapla akışın denenmesini imkânsız kılıyor;
   seed artık **hazırlayan ve onaylayan**ı ayrı ayrı kuruyor.
   - `seed_engineering.py`: tek `SUB_ACCOUNT` sabiti yerine `TEST_ACCOUNTS`
     listesi — `althesap@` (kısıtlı, değişmedi), `program@`
     (`can_manage_weekly`, tüm bölümlere üye → hazırlar ve onaya gönderir),
     `onay@` (`can_approve_schedule`, tüm bölümlere üye → yayına alır).
     Üyelik şart: K-25'in ikinci boyutu hem gönderimde hem onayda aranıyor.
   - `seed_demo.py`: `onay@` eklendi (ceng + eee üyeliğiyle); demo bandosunda
     görünüyor.
   - Hepsi e-postaya göre idempotent; şifreler değişmedi.
9. **Temizlik + eski uçların kapatılması.** ✅ (`e6b2d95c31af`)
   - **Eski YAZMA uçları kaldırıldı** (`POST/PATCH/DELETE /weekly-entries`,
     `/submit`, `/revert-to-draft`). Duran her kopyası onay adımını atlamanın
     bir yoluydu; arayüz kullanmasa da API açıktı. `GET` kaldı.
   - `weekly_schedule_entries.status` + `submitted_at` + tutarlılık CHECK'i +
     `idx_wse_status` düşürüldü. `entry_status` TİPİ durur — sınavlar kullanıyor.
   - **"Kalan DRAFT satırlarını sil" adımı İPTAL EDİLDİ.** Plandaki varsayım
     "DRAFT = yarım kalmış iş" idi; gerçek veride import/seed her şeyi `DRAFT`
     yazmış ve adım 1'den beri bu satırların TAMAMI `draft_id IS NULL` olduğu
     için uygulama onları YAYIN olarak gösteriyor. Ölçüm: 19 yayın satırının
     19'u da `status=DRAFT`. Status'e bakıp silmek **programın tamamını**
     silerdi. Kolonu düşürmek zaten doğru sonucu veriyor.
   - **Bulunan sızıntı (adım 1'den beri taşınıyordu):** `GET /weekly-entries`,
     export ve dashboard sayacı `draft_id` süzmüyordu — herkesin ÖZEL taslak
     satırları genel okuma yollarından görünüyordu. İki sonucu vardı:
     gizlilik ihlali ve aynı dersin ızgarada birkaç kez çizilmesi (kullanıcının
     "aynı saatte 4 tane ISG 1801" şikâyeti tam olarak buydu: ölçüm sırasında
     uç 6 satır dönüyordu — 2 yayın + 4 taslak kopyası).
     Düzeltme `_eager_entry_query(db, published_only=True)` ile **güvenli
     varsayılana** bağlandı: yeni bir çağıran filtreyi unutursa sızıntı değil
     eksik veri olur — ikincisi fark edilir, birincisi edilmez.
     Regresyon testi: `test_draft_rows_do_not_leak_into_public_reads`.
   - Testler: `test_wp3_weekly.py` doğrulama kuralları taslak ucuna çevrildi
     (kural aynı, kapı değişti); yaşam döngüsü testleri `test_k59_*`'e
     devredildi. `test_wp5/wp6` için `tests/helpers.publish_weekly` eklendi.
     `test_wp0_smoke`'taki CHECK testi sınava taşındı. 524 test yeşil.
   **Ayrıca ZORUNLU — eski yazma uçlarını kapat.** `POST/PATCH/DELETE
   /weekly-entries`, `/weekly-entries/submit` ve `/weekly-entries/{id}/
   revert-to-draft` hâlâ ayakta ve `can_manage_weekly` yetkisi olan biri
   onları çağırarak **onay adımını tümden atlayıp doğrudan yayına
   yazabilir**. Arayüz onları kullanmıyor ama API açık; bu, K-59'un bütün
   amacını boşa çıkaran bir bypass'tır. Adım 9 bitmeden sistem "onaylı" değil.
   (Kasıtlı olarak ertelendi: bu uçları şimdi kaldırmak `test_wp3_weekly.py`'yi
   toptan yeniden yazmayı gerektiriyor ve ağacı fazlar boyunca kırık bırakırdı.)

**Ek · Palet ders düzeyine geçti + mükerrer yerleşim koruması [E]**
**Belirti (kullanıcı):** "Cuma günü aynı saatte aynı yerde Şube 1'den birkaç
ISG 1801 dersi var." Ölçüm: yayında ISG 1801 Şube 1 için Cuma 1. slotta
**iki özdeş satır**; motorun W5 kuralı bunu görüyor ama **WARNING** olarak
bildiriyor (K-03/K-05'in "uyar, engelleme" çizgisi).

- **Palet artık ŞUBE değil DERS taşır.** Servis derslerinin 7-8 şubesi listeyi
  şişiriyor ve "hangi şubeyi sürüklüyorum" kararı, daha yeri seçilmeden
  verilmek zorunda kalıyordu. Şube **bırakma anında** sorulur; tek şubeli
  derste hiç sorulmaz. Palet kartında `N şube` rozeti + ders düzeyinde
  tamamlanma işareti (tüm şubeleri bitmişse). Izgara vurgusu da şubeden
  derse geçti.
- **Ama asıl düzeltme bu DEĞİL.** Palet değişikliği mükerrer kaydı engellemez;
  onu `_ensure_not_duplicate` engeller: aynı şube + aynı gün + aynı başlangıç
  slotu + aynı oturum türü ikinci kez girilemez (409). Ekleme ve TAŞIMA
  yollarının ikisinde de.
- **Kapsam bilerek dar:** yalnız TAM özdeş yerleşim bloklanır. Üst üste binen
  ama özdeş olmayan yerleşimler W5 uyarısı olarak kalır — "uyar ama engelleme"
  kararı değiştirilmedi.
- **Mevcut veri temizlenmedi:** yayındaki iki özdeş ISG satırı duruyor; bunlar
  import/seed'den gelmiş, silinmesi kullanıcının kararı.

**Açık uçlar (bu fazda değil):**
- **Sınavlar.** → **K-60'ta ele alındı.** Bu maddenin ilk hali "K-16 gereği
  sınav ders düzeyindedir, cohort'a bağlanmaz; cohort taslağı kavramı sınavda
  karşılıksız, birim muhtemelen bölüm + sınav dönemi olur" diyordu. **Bu
  gerekçe yanlıştı** ve düzeltildi: sınav derse, ders de `(department_id, year,
  semester)` + `extra_cohorts`'a bağlı olduğu için bir cohort'un sınavları
  `cohort_course_filter` ile — haftalıkta kullanılan filtrenin AYNISIYLA — tam
  seçilebiliyor. Ayrıntı ve düzeltmenin gerekçesi K-60'ta.
- **Bildirim merkezi.** Kişi başına okundu/okunmadı durumu + zil ikonu; uygulama
  içi akışın üstüne sonradan eklenebilir.
- **Cohort dışı düzenleme.** Taslaklar yalnız cohort modunda olduğu için derslik/
  hoca merceğinden düzenleme kalkar (mercekler görüntüleme olarak kalır). "Şu
  derslik tadilata girdi, boşalt" işi cohort cohort dolaşmayı gerektirir —
  bilerek kabul edildi.
- **Export.** "Resmî program" kavramı ancak bu fazla anlam kazanıyor; export'un
  varsayılan olarak yalnız yayını basması ayrıca ele alınacak.

---

## K-60 · Sınav onay akışı: `kind` ayracıyla aynı taslak mekanizması [E] — K-59'un ikinci yarısı
**Belirti:** K-59 haftalık programı onay kapısının arkasına aldı, sınav tarafına
dokunmadı. Sistem şu an **yarım**: ders programı onaylı, sınav takvimi değil.
Aynı kurumda iki farklı yönetişim kuralı işliyor.

**Mevcut durumun tespiti (tasarım öncesi okuma — kodda ölçüldü):**
- `POST /exams/submit` (`routers/exams.py:286`) ve
  `POST /exams/{id}/revert-to-draft` (`:324`) **ayakta**. `can_manage_exams`
  yetkisi olan biri ikinci bir göz olmadan sınav takvimini yayına alıyor **ve**
  yayından indiriyor. Bu, K-59 adım 9'da haftalıkta kapatılan bypass'ın
  birebir aynısı — orada "adım 9 bitmeden sistem onaylı değil" demiştik;
  sınav için henüz o adım hiç atılmadı.
- `Exam.status` + `submitted_at` + `ck_exams_status_submitted_consistency`
  duruyor. `entry_status` enum TİPİ K-59'da tam olarak bunun için bırakılmıştı.
- `_exam_universe(db, workgroup_id)` (`conflict_service.py:207`) evreni
  **"DRAFT + SUBMITTED hepsi"**. Yani sınavda, haftalıkta sadeleştirdiğimiz
  "yarım işler herkesin çakışma evreninde" durumu aynen sürüyor.
- Sınavı okuyan **altı** yol var: `routers/exams.py`, `dashboard.py`,
  `export.py`, `courses.py`, `lecturers.py` ve `conflict_service.py`.
  Hepsi bugün her satırı görüyor.

**Karar — taslak birimi: cohort, K-59'daki gibi.** K-59'un açık uçlar
maddesinde "sınav ders düzeyindedir, cohort taslağı kavramı sınavda
karşılıksız; birim muhtemelen bölüm + sınav dönemi" yazıyordu. **Bu gerekçe
yanlıştı, iptal edildi.**
- `Exam.course_id → Course`, `Course` ise `(department_id, year, semester)`
  taşıyor ve ortak dersi `extra_cohorts` üzerinden veriyor. Yani bir cohort'un
  sınav kümesi `cohort_course_filter` ile **tam** seçilebiliyor — haftalık
  taslağın kapsamını, kopyalayacağı satırları ve çakışma evrenini belirleyen
  filtrenin AYNISI. Sınav "ders düzeyinde" olmak yüzünden cohort'suz değil;
  cohort'a dersin üzerinden bağlı.
- Ortak dersin sınavının birkaç bölümü aynı anda etkilemesi **yeni bir sorun
  değil**: haftalıkta aynı durum paylaşımlı yerleştirme + "etkilenen bölümler"
  uyarısı + tek onay ile çözüldü (K-59 / K-48-49). Sınavda tekrar çözülecek
  bir şey yok, aynı çözüm devralınıyor.
- **"Bölüm + sınav dönemi" birimi REDDEDİLDİ.** Dönem zaten cohort kimliğinin
  içinde (`semester`). Yeni bir kapsam kavramı icat etmek ikinci bir filtre,
  ikinci bir kapsam denetimi ve ikinci bir kuyruk mantığı demek olurdu —
  hiçbirinin karşılığı yok.

**Karar — ayrı mekanizma değil, `schedule_drafts.kind: WEEKLY | EXAM`.**
Yaşam döngüsü (`OPEN → PENDING → APPROVED | REJECTED`), donma, geri çekme,
öz-onay yasağı (ADMIN dahil), ortak ve atamasız kuyruk, inceleme ekranı,
bayatlık bandı, `applied_summary` dondurma ve değişiklik akışı **olduğu gibi
yeniden kullanılır**. K-59 bu ayrımı zaten öngörmüştü: `can_approve_schedule`
oraya "haftalık + sınav ortak" gerekçesiyle tek bayrak olarak konmuştu.
- **Haftalık ve sınav AYRI onaylanır**, tek talepte birleşmez. Sınav dönemi
  planlaması ders programından bağımsız yürüyor; birleştirmek "vize takvimini
  onaylatmak için ders programını da onaylatmak" demeye gelirdi.

**Karar — yetki:** onaylamak tek bayrak (`can_approve_schedule`, kind'a
bakmaz — gözetim rolü bölünmez, K-59). **Onaya göndermek kind'a göre**
ayrışır: `WEEKLY → can_manage_weekly`, `EXAM → can_manage_exams`. Bölüm
üyeliği (K-25'in ikinci boyutu) her iki kapıda da aranır. Taslak açmak yine
yetkisiz — özel taslak kimseyi etkilemez.

**Karar — şema:**
- `schedule_drafts.kind` (`DraftKind` enum, `server_default 'WEEKLY'` →
  mevcut satırlar doğru değeri kendiliğinden alır).
- **`uq_schedule_drafts_active_per_owner` indeksine `kind` EKLENİR.** Yoksa
  bir kullanıcı aynı cohort için haftalık ve sınav taslağını aynı anda
  açamaz — bu iki iş birbirinden bağımsız yürüdüğü için kabul edilemez.
- `exams.draft_id` (nullable FK). **`draft_id IS NULL` = yayında**, haftalıkla
  aynı tek-gerçek kuralı.
- **`uq_exams_course_type_index` PARÇALANIR — bu, sınava özgü ve zorunlu.**
  Bugün `(course_id, exam_type, exam_index)` üzerinde koşulsuz UNIQUE (K-46).
  Taslak yayının kopyasını taşıyacağı için **kopyalama anında** bu kısıt
  ihlal edilir. İki KISMİ indekse bölünür:
  - `(course_id, exam_type, exam_index) WHERE draft_id IS NULL`
    → yayında tekillik korunur; K-46'nın asıl amacı budur.
  - `(course_id, exam_type, exam_index, draft_id) WHERE draft_id IS NOT NULL`
    → her taslağın kendi içinde tekillik.

  Tek bir dört kolonlu UNIQUE **yetmez**: Postgres'te NULL'lar birbirine eşit
  sayılmaz, o indeks altında yayında aynı sınavın iki kopyası geçerdi.
  (Haftalıkta bu iş çıkmadı, çünkü `weekly_schedule_entries`'te böyle bir
  tekillik kısıtı yok.)
- Sınav kopyalanırken **`exam_classrooms` M2M satırları da kopyalanır**;
  derslik listesi sınavın yerleşiminin parçası (K-17).
- `Exam.status`, `submitted_at`, tutarlılık CHECK'i ve `idx_exams_status`
  **düşer — ama ilk migration'da değil.** K-59'un dersi aynen geçerli: ilk
  migration tamamen eklemelidir, mevcut akış bozulmadan çalışmaya devam eder;
  düşürme son temizlik migration'ına kalır. Böylece her commit'te ağaç yeşil.
- `entry_status` TİPİ: haftalık onu K-59'da bıraktı, sınav bu fazın sonunda
  bırakacak. Son adımda **kullananı kalmadığı ölçülüp** tip de düşürülür.

**Karar — fark eşleştirmesi:** anahtar `(course_id, exam_type, exam_index)`,
yerleşim `(exam_date, start_time, duration_minutes, lecturer_id,
classroom_ids, notes)`.
- **`notes` karşılaştırmaya DAHİL** [uygulama sırasında eklendi]. İlk liste onu
  dışarıda bırakıyordu, çünkü not "yerleşim" değil. Ama not öğrenciye basılan
  bir içerik: dışarıda kalsaydı yalnızca notu değiştiren bir düzenleme ne farkta
  görünür ne de onayla yayına geçerdi — kullanıcı, yaptığı düzenlemenin sessizce
  kaybolduğunu görürdü. Test: `test_note_only_change_is_a_change`.
- Haftalıktan **daha basit**: bu üçlü veritabanında zaten tekil olduğu için
  grup içi çoklu eşleştirme, sıralı `zip`'leme ve "bir şubenin aynı tipte iki
  oturumu olabilir" karmaşası **yok**. Her anahtarda en fazla bir yayın + bir
  taslak satırı: ikisi de varsa ve yerleşim aynıysa elenir, farklıysa MOVED;
  yalnız yayında REMOVED; yalnız taslakta ADDED.
- **Derslik karşılaştırması KÜMEdir** (M2M, sıra anlamsız).
- **Gözetmen farka girer.** Haftalıkta hoca şubeden türüyordu; sınavda
  `lecturer_id` satırın kendi alanı, dolayısıyla gözetmen değişikliği de
  onaylayıcının gördüğü farkta ayrı bir satırdır.

**Karar — `pair_changes` GENELLEŞTİRİLMEZ, sınav için ayrı yazılır.**
Ortak bir "entity + anahtar fonksiyonu + yerleşim fonksiyonu" soyutlaması
kurmak, haftalığın grup-içi eşleştirme mantığını sınava da taşırdı — oysa
sınavda o mantığın karşılığı yok. Bedeli iki tarafı da okunmaz yapmak olurdu.
Paylaşılan şey **hesap değil şekil**: `Change` üçlüsü, fark kontratı ve
`DiffTable`. Tablo "yer" sütununu bir **metinleştirici** üzerinden çizer
(haftalık `"Sal 3"`, sınav `"12 Oca 09:00 (90 dk)"`); kind rozeti, ders
sütunu ve ortak ders uyarısı aynen paylaşılır. Onaylayıcının GÖRDÜĞÜ fark ile
onayın UYGULADIĞI farkın tek hesaptan çıkması kuralı (K-59 adım 4) sınav
kolunda da geçerli.

**Karar — çakışma motoru:** motora yine DOKUNULMAZ, tek değişiklik dikişte:
`_exam_universe(db, wg, draft=None)`.
- `draft` yok → yalnız `draft_id IS NULL`.
- `draft` var → taslağın kendi sınavları + yayının, taslağın cohort kapsamı
  DIŞINDA kalan sınavları (`cohort_course_filter`'ın tersi — haftalıkla
  birebir aynı desen).
- `scan_draft` **kind'a göre hangi tarafı taslak evrenine alacağını seçer**:
  WEEKLY taslağında haftalık taslaktan + sınav yayından, EXAM taslağında sınav
  taslaktan + haftalık yayından. K-06'nın X kuralları (sınav-ders çakışması)
  böylece taslak içinde de doğru koşar.
- Kontrol hem gönderimde hem onayda koşar; onay anında hard çakışma çıkarsa
  onay engellenir (K-59 ile aynı).

**Karar — sızıntı baştan kapatılır.** `_eager_exam_query(db,
published_only=True)` **güvenli varsayılan** olarak kurulur ve yukarıdaki altı
okuma yolu daha ilk adımda ona bağlanır. Haftalıkta bu sızıntı adım 1'den adım
9'a kadar taşındı ve kullanıcı "aynı saatte 4 tane ISG 1801" diye şikâyet
edene kadar görülmedi (testler görmüyordu). Aynı hatayı bile bile ikinci kez
yapmanın anlamı yok.

**Karar — doğrulama kuralları:** E1/E2/E6 ve `_validate_exam_refs`,
`_ensure_weekday`, `_normalize_exam_index` **aynen kalır, yalnız kapı
değişir** — taslak yazma yoluna taşınır (K-59 adım 9'daki
`test_wp3_weekly.py` dönüşümünün aynısı: kural aynı, uç farklı).

**Uygulama sırası:**
1. ✅ Şema + migration — **eklemeli** (`schedule_drafts.kind`, indekse `kind`,
   `exams.draft_id`, `uq_exams_course_type_index`'in iki kısmi indekse
   bölünmesi). Hiçbir kolon düşmedi. `b7d3e0a15c92`; up/down/up elle
   doğrulandı (testler `create_all` ile kurulduğu için migration'ları
   çalıştırmıyor), 8 şema testi (`test_k60_exam_draft_schema.py`) + mevcut
   524 test yeşil (532).
   - Geliştirme veritabanında ölçüldü: iki kısmi indeks beklendiği gibi kuruldu,
     eski koşulsuz constraint `pg_constraint`'ten düştü, mevcut 3 taslak
     `server_default` sayesinde `WEEKLY` aldı, 11 sınavın 11'i de `draft_id
     IS NULL` (yayında).
   - Tarayıcı: sınav ekranı ve çakışma taraması bozulmadan çalışıyor, eski
     "Yayınla" akışı aynen duruyor — eklemeli migration'ın amacı buydu.
2. ✅ Motor dikişi: `_exam_universe(..., draft=None)` + `scan_draft`'in kind'a
   göre evren seçimi + okuma yollarının süzülmesi. 11 test
   (`test_k60_exam_universe.py`), toplam 543 yeşil.
   - **kind süzgeci evrenin İÇİNE kondu**, çağırana bırakılmadı: `scan_draft`
     aynı taslağı iki evrene de veriyor, her biri yalnız kendi türünü alıyor
     (`_weekly_universe` bir EXAM taslağını yok sayar, `_exam_universe` bir
     WEEKLY taslağını). Sessiz bir hata değil doğru bir ifade — "sınav taslağı
     haftalık programın hiçbir dilimini değiştirmez" — ve yanlış kullanımı
     imkânsız kılıyor. Öteki taraf hep yayın olduğu için K-06'nın X kuralları
     taslağın içinde de yayındaki gerçeğe karşı koşuyor (X1 testi).
   - **Okuma yolları ikiye ayrıldı, hepsine aynı muamele YAPILMADI:**
     görüntüleme/sızıntı yolları (`_eager_exam_query` → liste + export,
     dashboard sayacı, çakışma evreni) `published_only`ye bağlandı; **bütünlük
     kontrolleri bilerek her satırı saymaya devam ediyor** (ders/hoca silme
     engelleri — taslaktaki kopya da FK'ya takılır, saymamak kullanıcıya
     "silinebilir" deyip ham DB hatası göstermek olurdu). K-59'un haftalıkta
     kurduğu ayrımın aynısı (`courses.py:485`, `classrooms.py:129`).
   - **Bulunan canlı veri kaybı hatası:** `courses.py`'de "programa etki eden
     alan değişti → taslak yerleşimleri sil" bloğu sınav tarafında hâlâ
     `status`'e bakıyordu. Gerçek veride her sınav `DRAFT` olduğu için
     `SUBMITTED` sayacı 0 dönüyor, blok ise o dersin **yayındaki** sınavlarını
     siliyordu — K-59'da haftalıkta ölçülen tuzağın aynısı. `draft_id`
     semantiğine çevrildi; artık 409 ile duruyor. Canlı ölçüm: CE 4523'ün
     dersinde `theory_online` değişikliği → 409, 11 sınav yerinde.
     (Silme bloğu bu değişiklikten sonra ispatlanabilir biçimde ölü kaldığı
     için haftalıktaki eşiyle birlikte kaldırıldı.)
3. ✅ Taslak API'sinin sınav kolu: oluştur (kopyala) / temizle / düzenle /
   fark / gönder / geri çek. 18 test (`test_k60_exam_draft_api.py`),
   toplam 561 yeşil.
   - `app/exam_draft_service.py` (kopyalama + temizleme + canlı fark + onayın
     uygulaması) ve `schedule_drafts.py`'ye dört sınav ucu.
   - **Dağıtıcı ayrı bir modülde:** `app/draft_dispatch.py → service_for(draft)`.
     İki servis modülü bilerek AYNI adları taşıyor
     (`copy_published_into_draft`, `clear_draft`, `compute_diff`, `apply_draft`,
     `build_applied_summary`, `draft_row_count`) → ortak uçlar tek satırla doğru
     kola gidiyor. Ayrı modül olmasının tek sebebi çevrimsel import:
     `exam_draft_service` zaten `draft_service`'ten kind-agnostik yardımcıları
     alıyor, dağıtıcı ikisinin üstünde durmalı.
   - **Fark kontratı ayrık:** `entity: "weekly" | "exam"` ayırt edici alanıyla
     Pydantic union. Tek modele sıkıştırmak iki yerleşim şeklini aynı alanlara
     zorlamak olurdu; ayrı uçlara bölmek ise onay ekranını ikiye ayırırdı.
   - **Kapsam denetimi ders düzeyine indi:** `_ensure_course_in_cohort`.
     Haftalık yol şubeden derse inip aynı fonksiyona geliyor — sınırı çizen
     filtre tek.
   - `publications_since_opened`'a `kind` süzgeci eklendi: sınav taslağının
     bayatlık ölçüsü SINAV onaylarıdır, haftalık onaylar onun kopyaladığı
     hiçbir satırı değiştirmez ve sayılırsa yanlış alarm üretir.
   - **Onay router'ının dağıtıcıya bağlanması bu adımda yapıldı** (adım 4'e
     bırakılmadı): adım 3'ten itibaren sınav taslağı onaya gönderilebiliyor,
     kuyruk ve inceleme uçları o taslağı görüyor. Sonraki adıma bırakmak ağacı
     "gönderilebilen ama incelenince 500 veren" bir arada durumda bırakırdı.
   - Gerçek veriyle ölçüm: CE/4/Güz sınav taslağı açıldı → 5 sınav çok-derslikli
     M2M'iyle kopyalandı, bir sınav taşındı → fark tek MOVED satırı, çakışma
     tablosu 0 engel/5 uyarı, yayındaki 11 sınav değişmedi, taslak silindi.
4. ✅ Onay API'si. Kod adım 3'te dağıtıcıya bağlanmıştı; bu adım **kanıt**:
   10 test (`test_k60_exam_approval_api.py`), toplam 571 yeşil.
   - K-59'da kanıtlanmış genel kapılar (kuyruk yetkisi, ret gerekçesi,
     öz-onay yasağının genel hali) TEKRAR EDİLMEDİ; dosya yalnız sınava özgü
     olanı ölçüyor: taşımanın satır kimliğini koruması, derslik listesinin
     onayla geçmesi, ekleme/kaldırma, `applied_summary`'nin sınav dili
     ("1 taşındı · CE 4523 Vize 1 14 Eyl → 15 Eyl"), incelemenin `entries`
     değil `exams` taşıması.
   - **Bayat sınav taslağı testi** haftalıktaki eşinin aynısı: ikinci onay,
     dokunulmayan satırı da geri alır ve bu inceleme ekranında ayrı bir satır
     olarak görünür. Ayrıca `kind` süzgecinin karşılığı ölçüldü — haftalık bir
     onay, sınav taslağının bayatlık sayacını artırmıyor.
   - Gerçek veride uçtan uca (yayına yazmadan): taslak → 5 sınav kopyası →
     değişiklik → onaya gönder → kuyrukta `kind=EXAM` → inceleme
     (`entries: 0, exams: 5`, bayatlık 0, fark tek MOVED satırı notuyla,
     0 engel/5 uyarı) → geri çek → sil. Yayındaki 11 sınav ve saatleri aynı.
5. ✅ `ExamsPage`: yayın/taslak modu, `DraftBar`'ın yeniden kullanımı,
   satır bazlı durum rozetlerinin kaldırılması. `tsc --noEmit` + `vite build`
   temiz, 571 backend testi yeşil.
   - `DraftBar` ve `DiffTable` **ortak kaldı, kopyalanmadı**: çubuk bir `kind`
     alıyor (metinler ve gönderme yetkisinin adı ondan geliyor), tablo ise
     `entity`ye bakan iki küçük metinleştiriciyle iki şekli de çiziyor
     ("Çar 5 · A Blok 101" / "15 Eyl 09:00 (90 dk) · B Blok 202"). İkişer
     bileşen yazmak, K-59'da bilerek kaçınılan ayrışmayı geri getirirdi.
   - **Yazma yetkisi yer değiştirdi** (haftalıktaki devrin aynısı): `canWrite`
     artık "düzenlenebilir bir taslağın içindeyim" demek; `can_manage_exams` +
     üyelik onaya gönderme kapısına taşındı. Palet ve ders seçici yetki
     süzgeçlerini bıraktı — kapsamı sunucu (`_ensure_course_in_cohort`) çiziyor.
   - **Eski "Yayınla" düğmesi, `SubmitModal`, "taslağa çevir" ve kart başına
     durum rozeti/kilit KALKTI.** Durum artık satırın değil MODUN özelliği.
   - **Tarayıcı iki kusur yakaladı, ikisi de testlerle görünmezdi:**
     1. `ExamModal` hâlâ eski `/exams` ucuna yazıyordu → taslaktaki bir sınavı
        düzenlemek HTTP 500 veriyordu. Yazma kökü artık sayfadan geçiriliyor;
        modalın "hangi moddayım"ı kendi başına bilmesi, iki yerde ayrı ayrı
        doğru tutulması gereken bir gerçek olurdu.
     2. Asıl sorun bunun ALTINDAYDI: `_get_owned_exam` taslak satırlarını da
        buluyordu, yani eski yazma uçları **başkasının özel taslak kopyasını
        düzenleyebiliyordu**. Taslağın gizliliği yalnız okuma yollarında
        korunuyormuş. `draft_id IS NULL` şartı eklendi — uçlar adım 7'de zaten
        kalkacak ama o güne kadar delik açık kalmamalı.
   - Tarayıcıda uçtan uca: taslak aç (1 sınav kopyalandı) → saat değiştir →
     "1 değişiklik" → Farkı Gör tablosunda TAŞINDI satırı, ortak ders uyarısı
     ve "8 Eyl 08:30 → 8 Eyl 14:30" → taslak silindi, yayındaki 11 sınav ve
     saatleri değişmedi.
6. ✅ `ApprovalsPage`: tür rozeti + sınav incelemesi. `tsc --noEmit` temiz,
   571 backend testi yeşil.
   - **Kuyruk BÖLÜNMEDİ, rozetlendi.** Sekme/ayrı kuyruk düşünüldü ve
     reddedildi: onaylamak tek bir gözetim rolü (`can_approve_schedule`,
     K-59) ve "bugün ne bekliyor" sorusunun tek bir cevabı olmalı. Ama
     onaylayıcının neye baktığını ilk bakışta bilmesi gerekir — her satır ve
     inceleme başlığı türünü rozetle söylüyor.
   - **Sınavda IZGARA YOK, kronolojik liste var** (`ProposedExamList`).
     Haftalık ızgara işini görüyor çünkü haftalık program TEK haftaya sığar;
     sınav takvimi iki-üç haftalık bir döneme yayılır. Doğrulamada açılan
     gerçek talep 7 Eylül–16 Eylül arasına yayıldı — tek haftalık bir ızgara
     bu takvimin yarısını gösteremezdi. Aynı soruya ("bu değişiklik takvimin
     bütününde nereye oturuyor") cevap veren şey güne göre gruplanmış sıra:
     onaylayıcı aynı günde başka ne var, gün yüklü mü, sınavlar arka arkaya
     mı düşüyor görür.
   - Vurgu yine YERLEŞİME bağlı, derse değil — K-59'da haftalıkta şube bazlı
     vurgunun yaptığı hatanın (değişmeyen kardeş satırı da "taşındı" göstermek)
     sınav karşılığı bir dersin birden çok sınavı olduğunda çıkardı.
   - **Değişiklik akışına `kind` eklendi** (`ScheduleChangeOut.kind`) ve akış
     sınav ekranının YAYIN moduna da kondu: iki tür onay aynı akışta akıyor,
     hangisinin değiştiği özetten tahmin edilmemeli.
   - Tarayıcıda uçtan uca, İKİ hesapla (öz-onay yasak): `program@` talebi
     gönderdi → `onay@` kuyrukta "SINAV TAKVİMİ" rozetli satırı gördü →
     incelemede fark tablosu ("7 Eyl 15:30 → 7 Eyl 16:30"), 5 uyarı ve
     güne göre gruplanmış öneri listesi → "Onayla ve yayına al" → yayına
     geçti, akışta sınav dili özetiyle göründü.
     **Doğrulama değişikliği aynı akıştan geçirilerek geri alındı**; yayın
     15:30'a döndü, 11 sınav yerinde. Geliştirme veritabanında kalan tek iz
     değişiklik akışındaki iki kayıt (K-59 gereği onaylanmış taslak silinmez,
     geçmiş kaydıdır).
7. ✅ Temizlik + eski uçların kapatılması. `c4a70f2d9e83`; up/down/up elle
   doğrulandı, 570 test yeşil, `tsc --noEmit` temiz.
   - **Kaldırılan uç listesi plandakinden GENİŞ.** Plan yalnız
     `/exams/submit` ve `/exams/{id}/revert-to-draft` diyordu; ama
     `POST/PATCH/DELETE /exams` de kaldırıldı. Onları bırakmak, K-59'un
     haftalıkta kapattığı bypass'ı sınavda açık bırakmak olurdu:
     `can_manage_exams` yetkisi olan biri onları çağırarak onay adımını
     tümden atlayıp doğrudan yayına yazabilirdi. `GET /exams` kaldı.
     Ölçüm: `POST /exams → 405`, `PATCH/DELETE /exams/{id} → 404`,
     `/exams/submit → 404`, `/exams/{id}/revert-to-draft → 404`,
     `GET /exams → 200`.
   - `Exam.status`, `submitted_at`, tutarlılık CHECK'i ve `idx_exams_status`
     düştü. **`entry_status` TİPİ de düştü** — kullananı kalmadığı ölçüldü
     (haftalık onu K-59'da, sınav burada bıraktı). Kontrattan `ExamOut.status`
     ve frontend'den `EntryStatus` kalktı.
   - **Veri silinmedi.** K-59'un dersi burada da geçerli: gerçek veride her
     sınav `DRAFT` yazılmış, `status`'e bakıp satır silmek yayındaki takvimin
     tamamını silerdi. Kolonu düşürmek zaten doğru sonucu veriyor. Ölçüm:
     11 yayın sınavı, 19 yayın haftalık satırı yerinde.
   - **`require_weekly_manager` ve `require_exam_manager` bağımlılıkları da
     kalktı** (ilki K-59'dan beri ölüydü, fark edilmemişti). İkisi de "yayına
     yazma" kapısıydı; yayına yazan uç kalmayınca karşılıkları da kalmadı.
     Bayrakların kendisi duruyor ve hâlâ aranıyor — ama onaya gönderme
     kapısında, taslağın türüne göre.
   - **`test_wp4_exams.py` dönüştürüldü** (K-59'daki `test_wp3_weekly.py`
     dönüşümünün aynısı): doğrulama kuralları — hafta sonu yasağı, E2
     ön-kontrolü, K-46 sıra normalizasyonu, çapraz-FK izolasyonu, derslik
     listesinin tam değişimi — aynı gövdeyle taslak ucuna taşındı. Yaşam
     döngüsü testleri `test_k60_*`'e devredildi. `tests/helpers.publish_exam`
     eklendi (`publish_weekly`'nin ikizi); wp2/wp5/wp6 testleri ona bağlandı.
   - **Bulunan tutarsızlık:** `midterm_count` düşürme engeli taslaktaki
     kopyaları da sayıyordu — yani birinin özel denemesi başkasının ders
     düzenlemesini bloklayabiliyordu. K-59'un "özel taslak kimseyi engellemez"
     kuralı gereği yayına daraltıldı; bayat kalan taslak sahibinin sorunudur.
   - Tarayıcı: her iki ekran da (haftalık + sınav) yayın modunda sağlam,
     değişiklik akışı tür rozetleriyle çalışıyor, tüm istekler 200.

**Açık uçlar (bu fazda değil):**
- **Bildirim merkezi** ve **export'un yalnız yayını basması** — K-59'dan
  devrolan iki madde, sınav fazı bunları da kapsamıyor.
- **Sınav dönemi takvimi.** "Vize haftası 12-23 Ocak" gibi bir dönem tanımı
  yok; sınavlar serbest tarihe konuyor. Taslak birimi cohort olduğu için bu
  faz onu gerektirmiyor, ama ileride gelirse taslağa değil **workgroup
  ayarına** bağlanmalı.

---

## K-61 · Taslağa dönüş yolu + iki adımlı yerleştirme [E] — K-59/K-60 kullanım düzeltmeleri
**Belirti (kullanıcı, üç madde):** (1) paletten şube kaldırılıp "bırakma anında
sorulacak" denmişti, sorulmuyor; (2) modal "Ders / şube" diye tek soru soruyor,
önce ders sonra şube sorulmalı; (3) taslak açıp "Yayına Dön" dedikten sonra o
taslağa geri dönülemiyor — "Bu cohort için zaten açık program taslağınız var
(#16)" deyip çıkmaza sokuyor.

**Tespit — (1) bir hata DEĞİL, veri durumu.** Kod K-59 ekinde kararlaştırıldığı
gibi çalışıyor: tek şubeli derste şube sorulmuyor, çok şubelide soruluyor.
Geliştirme veritabanında ölçüldü: **313 ders 0 aktif şubeli, 24 ders 1 şubeli,
2+ şubeli ders YOK.** Yani sorulacak bir seçim hiç oluşmamış. Şubesiz dersler
paletten zaten sürüklenemiyor ("şube yok" rozeti + "önce şube ekleyin" uyarısı),
orada çıkmaz yok.
- Yine de kullanıcının istediği akış farklı ve daha iyi: **her durumda önce ders,
  sonra şube.** Tek şubelide şube seçtirilmez ama GÖSTERİLİR — kullanıcı neyi
  yerleştirdiğini görür, akış her durumda aynı okunur ve çok şubeli veri
  geldiğinde davranış değişmez.

**Karar — yerleştirme modalı iki adım.** Birleşik `CENG 1801-1 — IT FOR
ENGINEERS` listesi kalkar; yerine "Ders" ve "Şube" iki ayrı seçici gelir.
- Sürükleyerek gelindiğinde ders zaten bellidir → salt-okunur gösterilir,
  yalnız şube sorulur. Boş slota tıklanarak gelindiyse ikisi de sorulur.
- **Tek şubede seçici DEVRE DIŞI ama görünür.** Gizlemek "şube diye bir şey
  yok" izlenimi verirdi; asıl bilgi "bu dersin tek şubesi var" ve bunu
  söylemenin yeri burası.
- Ders değişince şube seçimi sıfırlanır — başka dersin şubesi taşınırsa sunucu
  400 verir, ama kullanıcı sebebini anlamaz.

**Karar — açık taslağa dönüş İKİ yüzeyden (kullanıcı kararı: "ikisi de").**
Asıl kusur şu: çubuktaki "Taslak Aç" her seferinde POST atıyor, mevcut taslağı
SEÇME yolu yok. Taslağı hatırlayan efekt yalnız cohort değişince koşuyor, o
yüzden "Yayına Dön" → "Taslak Aç" 409'a çarpıyor.
- **Çubukta:** düğme, o cohort için açık taslağım varsa "Taslağı Aç (#N)"
  olur ve POST atmaz. 409 bir daha hiç görünmemeli — çünkü kullanıcı hatası
  değil, arayüzün mevcut durumu bilmemesiydi.
- **Menüde "Taslaklarım" sayfası:** haftalık + sınav bütün açık taslaklarım tek
  listede (cohort, tür, kaç değişiklik, durum) ve "Aç" düğmesi ilgili ekrana o
  taslak seçili olarak götürür. **Onay Bekleyenler'in eşi** — o onaylayan
  tarafın kuyruğu, bu hazırlayan tarafın. Yalnız çubukla yetinmek, bulunduğunuz
  cohort dışındaki taslakları görünmez bırakırdı; "bir yerlerde açık taslağım
  var mı" sorusunun cevabı hiçbir yerde olmazdı.
- Sayfa herkese açık: taslak açmak yetki istemiyor, dolayısıyla "kendi
  taslaklarım" listesi de istemez. Sunucu zaten yalnız kendi taslaklarını döner.

**Karar — değişiklik akışının başlığı netleşir.** Kullanıcı "bu panel neyi
gösteriyor, ortak dersleri mi çakışmaları mı?" diye sordu; soru sorulmuşsa
başlık kendini anlatmıyor demektir. Panel ONAYLANIP YAYINA GEÇMİŞ değişiklikleri
gösterir (çakışmayla ilgisi yok) ve bir kayıt iki yoldan düşer: değişiklik kendi
bölümümün cohort'unda yapıldı, ya da başka bölümün onayı ortak ders üzerinden
beni etkiledi. Bu ikinci cümle panele alt başlık olarak yazılır.

**Uygulama sırası:**
1. ✅ `EntryModal` iki adıma bölündü (ders → şube). Sürükleyerek gelindiğinde
   ders seçicisi DOLU ve kilitli; tek şubede şube kendiliğinden seçiliyor ve
   seçici "Bu dersin tek şubesi var" açıklamasıyla kilitli görünüyor.
   - **Yol üstünde bulunan kusur:** modalın ders listesi `paletteItems`'tan
     türetiliyordu, yani **palet arama kutusuna bağlıydı**. "MATH" aratıp boş
     bir hücreye tıklayan kullanıcı modalda yalnız MATH derslerini görürdü.
     Arama bir gezinme yardımıdır, kapsam değil — liste `courses`'tan (cohort'un
     şubesi olan dersleri) türetiliyor artık.
2. ✅ `DraftBar` yayın modundayken o cohort'un açık taslağını arar; varsa düğme
   "Taslağa Dön (#N)" olur ve POST atmaz. **409 bir daha görünmemeli** — o bir
   kullanıcı hatası değil, arayüzün mevcut durumu bilmemesiydi.
3. ✅ `Taslaklarım` sayfası (`/drafts`) + menü girişi. "Aç", cohort'u sorgu
   parametreleriyle vererek ilgili ekrana götürüyor; ekran cohort'u seçince mod
   çubuğu taslağı kendiliğinden buluyor. Reddedilen taslağın gerekçesi listede
   de görünüyor — kullanıcı neyi düzelteceğini öğrenmek için taslağı açmak
   zorunda kalmasın.
4. ✅ Değişiklik akışına alt başlık eklendi.

**Doğrulama (tarayıcı):** Taslaklarım 4 taslağı listeliyor → "Aç" (#16) doğru
cohort'a taslak seçili olarak gitti → "Yayına Dön" → düğme "Taslağa Dön (#16)"
oldu → tıklayınca 409 almadan taslağa döndü. Boş hücre modalı ders/şube ayrı
soruyor; palet "CE 1002"ye filtreliyken bile modal cohort'un tamamını sunuyor.
- **Sürükleyip bırakma yolu tarayıcıda TIKLANAMADI:** sentetik fare olayları
  HTML5 sürükle-bırak API'sini tetiklemiyor. Bu yolun tek farkı `fixedCourseId`
  propunun dolu gelmesi; tip denetimi geçiyor ama gerçek bırakma denenmedi.

---

## K-62 · Çakışma listesi taslak/yayın ayrımını kaybetmişti [E] — K-59/K-60 kalıntısı
**Belirti (kullanıcı):** bir taslakta çalışırken çakışma listesindeki iki çipin
ikisi de yanlış davranıyor. "DENEME-1" → *"Vurgulanacak kayıt bulunamadı"*;
"CE 1003-1" → dersin cohort'una gidiyor ama oradaki AÇIK TASLAĞA düşüyor ve
aranan ders orada olmadığı için boş ızgara görünüyor. Kullanıcının teşhisi:
"çakışma listesi taslak ve yayın arasında karışmış görünüyor."

**Tespit — liste DOĞRU, tıklama bozuk.** Ölçülen veri:
`CE 1003-1` (#121) YAYINDA, cohort 5/1/**Güz**; `DENEME-1` (#180) TASLAK #16'da,
cohort 5/1/**Bahar**. İkisi de aynı hocada (id 9) ve Çarşamba 1-2. slotta →
W2 gerçek bir çakışma. Taslak evreni tanım gereği böyle kurulur (K-59): taslağın
kendi satırları + yayının, taslağın cohort'u DIŞINDA kalan kısmı. Yani çakışmanın
**iki tarafı iki ayrı evrenden** gelir ve bu, mekanizmanın hatası değil amacıdır.

**Kök sebep:** vurgulama/yönlendirme kodu taslaklardan ÖNCE yazılmıştı ve her
satırın yayında olduğunu varsayıyordu — `GET /weekly-entries` çağırıyor, o da
K-59'dan beri yalnız yayını döndürüyor. Taslak satırı orada yok → "bulunamadı".
Yayın satırı bulunuyor ama gidilen cohort'ta açık taslak varsa ekran ona geçiyor
ve aranan satır görünmüyor.

**Karar — tıklama önce "bu satır ekranda mı" diye sorar.**
- Satır o an gösterilen kümedeyse (taslaktaysam taslağımın satırı) → YERİNDE
  vurgulanır, hiçbir yere gidilmez. Zaten oradayız.
- Değilse tanım gereği YAYINDAKİ bir satırdır → cohort'una gidilir **ve yayın
  moduna geçilir**. Taslağı kendiliğinden seçen efekt tek seferlik bir bayrakla
  atlatılır; yoksa hedef yine ekrandan kaçar. Bildirim de nereye gidildiğini
  ("YAYINDAKİ programda, N. sınıf görünümüne geçildi") açıkça söyler.
- Aynı düzeltme sınav ekranına da uygulandı — orada `GET /exams` ile birebir
  aynı kusur vardı.

**Karar — panelin kapsamı yazıyla söylenir.** Kullanıcı "bu cohortu mu yoksa tüm
sistemi mi gösteriyor" diye sordu. Taslakta liste **taslağımın satırlarına
dokunanlarla** sınırlıdır (sunucu `scan_draft`'ta öyle süzer) ama karşı taraf
başka cohort'un yayındaki dersi olabilir. Bunu söylememek listeyi "neden burada
başka sınıfın dersi var" sorusuna açık bırakıyordu; panele alt başlık kondu.

**Bulunan ikinci kusur (tarayıcı yakaladı):** haftalık ekranın "bu cohort için
açık taslağımı seç" arayışı **`kind` süzmüyordu**. K-60'ta sınav taslakları
eklendiğinde bu arayış güncellenmemiş; aynı cohort'un SINAV taslağı haftalık
ekranda seçilebiliyor ve ekran *"Bu taslak bir sınav takvimi taslağı — bu uç ona
uygun değil"* hatasına düşüyordu. Sınav ekranındaki eşi K-60'ta doğru yazılmıştı,
haftalıktaki geride kalmış. Süzgeç eklendi.

**Doğrulama (tarayıcı, kullanıcının senaryosu birebir):** Taslaklarım → #16
"Aç" → doğru taslak (Program, sınav değil) açıldı → çakışma listesinde
"DENEME-1" yerinde vurgulandı (taslaktan çıkmadan) → "CE 1003-1" CE/1/Güz'e
**yayın modunda** götürdü, satır vurgulu göründü, çubuk "Taslağa Dön (#3)"
seçeneğini sundu ama zorlamadı.

---

## K-63 · Program sıfırlama betiği [E]
**Bağlam (kullanıcı):** "örnek ve test verilerini sil; bölümler, hesaplar,
öğretim üyeleri, derslikler ve dersler kalsın ama program ve sınavlar boş olsun
— gerçek programları kendim tek tek ekleyip denemek istiyorum."

**Karar — sınır İKİ KATMAN arasından geçer.** Seed betikleri veri ÜRETİR;
bu betik yalnız **program katmanını** siler, **kimlik ve katalog katmanına**
dokunmaz:
- **Silinir:** `weekly_schedule_entries`, `exams` (+`exam_classrooms` CASCADE),
  `schedule_drafts` (+`draft_affected_departments`), `audit_logs`.
- **Kalır:** workgroup, kullanıcı, üyelik, bölüm, öğretim üyesi, bina, derslik,
  ders, şube, ek cohort, slot.

**Onaylanmış taslaklar da silinir** (kullanıcı kararı): onaylanan taslak kaydı
K-59 gereği aynı zamanda "son değişiklikler" akışının kaynağıdır — bırakılsaydı
artık var olmayan satırların geçmişi akışta durmaya devam ederdi.

`backend/reset_schedule.py`. Onay bayrağı olmadan **yalnız ölçer**
(`--evet-sil` verilmeden hiçbir şey silmez) — yanlışlıkla çalıştırılan bir
sıfırlama betiği, geri alınamayan bir zarardır. `--dersi-sil KOD` ile tek tek
ders de düşürülebilir (test dersleri için).

**Uygulandı (11 Ağustos 2026, geliştirme veritabanı):** 41 haftalık yerleşim,
12 sınav, 13 sınav-derslik bağı, 9 taslak, 1043 denetim kaydı ve `DENEME` test
dersi (1 şube + 3 ek cohort) silindi. 7 bölüm, 7 kullanıcı, 93 öğretim üyesi,
23 derslik, 336 ders, 23 şube, 52 ek cohort duruyor.
- Boş durum tarayıcıda doğrulandı: haftalık, sınav, çakışma raporu ve
  Taslaklarım ekranları boş veriyle sorunsuz çiziliyor; boş programda taslak
  açma (0 satır kopyalanır, fark boş, çakışma boş) çalışıyor.

---

## K-64 · Bologna'dan hoca eşleştirmeli şube import'u [E]
**Bağlam (kullanıcı):** "Ders aktarmada dersleri şubesiz ekliyoruz. Ders
detayında ( 'i' simgesi) 'Dersi Verenler' yazıyor, bazen birden fazla. Şube
oluşturmayı bunu baz alarak yap — orada yazan öğretmene direkt şube atanmış
gelsin. Kontenjan görünmüyor, varsayılan 80 olsun." Bu, K-14'te ertelenen
"şube sonra elle eklenir" kararının otomatik hâli; K-08 hoca listesini kimlik
anahtarı olarak kullanır.

**Kaynağın anatomisi (tarayıcı + httpx ile kanıtlandı).** `progCourses.aspx`
(WP7'de kazınan liste sayfası) hoca içermez. Hoca yalnız ders DETAY sayfasında:
`progCourseDetails.aspx?curCourse=<ID>&lang=tr`. Ama `curCourse` ID'si liste
sayfasında **gömülü değildir** — her satırdaki "i" bağlantısı bir ASP.NET
postback'idir (`__doPostBack('grdBolognaDersler$ctlNN$btnDersAyrinti','')`) ve
ID sunucuda viewstate'ten çözülür. Zincir: liste GET → gizli alanları
(`__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, `curYear`) al →
her ders için `__EVENTTARGET`'i o satırın bağlantısından oku → aynı viewstate
ile POST → 302 → detay sayfasına in → parse. **Tek GET'in viewstate'i tüm
dersler için yeniden kullanılabilir** (ölçüldü: 22 ders tek viewstate ile
çekildi). Detay ~160 KB; ders başına bir postback+redirect. K-50'deki
`fetch_details_bulk` deseniyle (8 worker, istek başına taze bağlantı) paralel
çekilir — kaynağı bombalamadan beklemeleri üst üste bindirir.

**"Dersi Verenler" biçimi.** `span#dlDers_DERS_VERENLabel_0` içinde, çoklu hoca
`<br>` ile ayrılır. Her giriş `<Unvan> <Ad>` (ör. `Dr.Öğr.Üyesi BARIŞ İŞÇİ
PEMBECİ`, noktalar bitişik). `normalize.split_title` noktayı boşluğa çevirip
baştaki unvan token'larını greedy tüketir → (kanonik unvan, ad).
`normalize_lecturer_name` unvanı atıp Türkçe-küçük harfe indirir → eşleştirme
anahtarı. Tek kaynak; yeni normalizasyon yazılmadı.

**Eşleştirme KISMİDİR — tasarımın kalbi budur.** Gerçek CENG verisinde ölçüldü:
kendi bölüm hocaları eşleşir (`BARIŞ İŞÇİ PEMBECİ`→`barış işçi pembeci`), ama üç
sınıf eşleşmez ve eşleşmemesi doğaldır:
1. **Servis dersleri** — MATH/PHYS/CHEM/ENG hocaları başka fakültededir, K-50
   listesi (yalnız Mühendislik kadrosu, 93 kişi) onları içermez.
2. **Diakritiksiz yazım** — `Tugba Suzek` (Bologna) ≠ `tuğba süzek` (liste);
   aynı kişi, farklı harfler.
3. **Ad varyantı** — `Zeynep Filiz EREN DOĞU` (ek soyad) ≠ `zeynep filiz eren`.

Şube `lecturer_id` NOT NULL/RESTRICT olduğundan eşleşmeyen otomatik bağlanamaz.

**Karar — eşleşmeyen için ELLE EŞLE, oto-açma YOK (kullanıcı kararı).**
Önizlemede eşleşmeyen hocanın ham Bologna adı gösterilir + bir hoca seçici;
kullanıcı mevcut bir hocaya eşler ya da boş bırakır (o hoca için şube açılmaz).
Yeni hoca **otomatik açılmaz**: `Tugba Suzek`i ayrı bir Lecturer yapmak, zaten
var olan `Tuğba Süzek`in mükerreri olur ve W2/E3 hoca çakışma matematiğini
böler (K-08'in tam tersi). Mükerrer üretmektense şubesiz bırakmak güvenlidir.

**Karar — çoklu hoca → çoklu şube (kullanıcı kararı).** N hoca → N şube
(Şube 1, Şube 2…), her biri o hocaya atanmış, hepsi `expected_students = 80`
(kaynakta kontenjan yok). "Orada yazan öğretmene direkt şube atanır" isteğinin
birebir karşılığı.

**Karar — vize sayısı da otomatik dolar (kullanıcı kararı).** Detay sayfasını
zaten çekiyoruz; `grd_degerlendirme` tablosunda ilk hücresi **tam olarak** "Ara
Sınav" olan (çoğul "Ara Sınavlar" iş-yükü satırı ve hafta-konusu satırları
HARİÇ), üç hücreli, ikinci hücresi sayı olan satırdan `courses.midterm_count`
(K-46, 1–3'e kırpılır) yazılır. Bulunamazsa varsayılan 1 kalır.

**Karar — kapsam: mevcut şubesiz derslere de (kullanıcı kararı).** 336 ders
zaten aktarılmış, 313'ü şubesiz. Şube açmayı yalnız YENİ derse bağlamak mevcut
veriye faydasız olurdu (kullanıcı 336 dersi silip yeniden aktarmalıydı). Bu
yüzden önizleme, Bologna'da bulunan bir ders zaten kayıtlı **ama şubesizse**
onu da şube adayı sayar: ders açılmaz, yalnız şubeleri eklenir. Zaten şubesi
olan ders dokunulmaz (mükerrer önlenir). Böylece re-import ile 313 şubesiz ders
şube kazanır.

**Veri temizliği (kullanıcı kararı):** Var olan 23 şube deneme amaçlıydı;
silindi (bağımlı haftalık giriş yok — K-63 sıfırlaması sonrası program boştu).
Böylece 336 dersin tamamı şubesiz zemine indi ve Bologna şube-import'u hepsini
tekdüze işler.

**Sınır:** İş yine iki adımlı (K-61) — önizleme yazmaz, yalnız commit yazar.
Detay çekme önizlemeyi yavaşlatır (ders başına bir postback); tek seferlik
kurulum işi olduğu için kabul edildi. Bir dersin detayı çekilemezse o ders
hocasız/şubesiz döner, tüm import düşmez (K-50'deki "tek sayfa patlarsa kişi
detaysız kalır" toleransının aynısı).

**Doğrulama (tarayıcı, gerçek Bologna, 11 Ağustos 2026):** program@ hesabıyla
CENG (curSunit=253) önizlendi — 71 ders + detaylar canlı backend'den çekildi
(POST /import/courses/preview → 200). Eşleşenler ön-dolu geldi (CENG 1007 →
Barış İşçi Pembeci, ISG 1801 → İbrahim Ferid Öge), servis dersleri kırmızı
"eşleşmedi" ile: ENG 1803 iki okutmanı da, MATH 1851 (Mehmet Ali Balcı) —
listede olmayanlar. 71 dersin tamamı "kayıtlı · şubesiz" (313 şubesiz ders
kararının somut hali). Tek ders (CENG 1007) commit edildi → "0 yeni ders · 1
şube eklendi": DB'de Şube 1, Barış İŞÇİ PEMBECİ, 80 kontenjan. Doğrulama şubesi
sonra silindi (kullanıcı programı kendi kuracak). 587 backend testi yeşil
(17 yeni K-64), tsc + vite build temiz.

**Veri notu:** Var olan 23 deneme şubesi bu iş kapsamında silindi; 336 dersin
tamamı şubesiz. Hoca listesi 93 kişi (yalnız Mühendislik kadrosu) — servis
dersi hocaları eşleşmez, elle eşlenir ya da şubesiz kalır.

## K-65 · Dersler ekranı: tek sıralanabilir tablo + sağ Drawer + TÜR segmenti [E] — K-56 revizyonu
**Bağlam (kullanıcı):** Claude Design'da (`claude.ai/design`, proje
`a0c09d60…`, dosya `Dersler Yeni.dc.html`) Dersler sayfasının yeni arayüzü
tasarlandı; "bu dersler sayfasının arayüzünü mevcut arayüze implement edelim".
Mockup ham `<div>`+DC-runtime; Mantine v7'ye çevrildi. K-56'nın iki-tablo +
satır-içi akordeon düzenini geri alır.

**Karar — iki tablo TEK tabloya birleşti.** K-56'daki ayrı "Ortak Dersler" /
"Bölüm Dersleri" tabloları kalktı; hepsi **tek sıralanabilir tabloda**
(Kod · Ad · Tür · AKTS · T+U+L · Sınıf · Dönem · Şube). Ortak ders satırda
kalır: TÜR rozeti "Ortak", Sınıf/Dönem "—" (tek değere sığmaz), cohort'ların
tamamı Drawer'daki "Aldığı gruplar"da. Neden [E]: yeni tasarımın çözümü bu —
TÜR sütunu + segment ortak dersi tek listede ayırt edilebilir kılıyor, iki ayrı
tabloya gerek kalmıyor.

**Karar — TÜR segmenti, "Ortak dersler" sözde-yılının yerini aldı.** Üstte
`SegmentedControl` (Tümü/Zorunlu/Seçmeli/Ortak) — istemci tarafı süzgeç. K-48'de
Sınıf filtresine konan `COMMON` sözde-değeri kaldırıldı; Sınıf artık sade 1–4.
"Ortak" segmenti `is_common`'ı süzer.

**Karar — satır-içi akordeon → sağdan Drawer.** Satıra tıklayınca detay **sağ
Drawer'da** (Mantine `Drawer`, 560px): künye (kod+tür+ad) · istatistik ızgarası
(AKTS/T+U+L/Sınıf-Dönem/Vize) · online bileşen · ortak dersse aldığı gruplar ·
şubeler **kart** olarak · sabit alt çubuk (Dersi düzenle · Haftalık programda gör
· Sil). Tüm şube CRUD'ı + K-48/K-49 yetki mantığı Drawer içinde korundu. K-56'nın
"panel yalnız açıkken mount" gerekçesi Drawer'da doğal: gövde yalnız seçili ders
varken render edilir.

**Karar — sıralanabilir sütunlar (istemci).** Başlığa tıkla → o sütuna göre
sırala, tekrar tıkla → yön çevir. Varsayılan gizli sıra `donem` (K-56'nın
dönem-artan düzenini korur). Tür sırası Ortak<Seçmeli<Zorunlu; yıl/dönemde ortak
ders dibe (99); eşitlikte koda göre.

**Karar — süzgeç `Popover`'a toplandı + aktif çipler.** Bölüm/Hoca/Sınıf/Dönem
selectleri düz satırdan `Popover`'a taşındı ("Pasif dersleri gizle" onayıyla);
aktif filtreler çip olarak çubukta, "Temizle" ile toptan silinir. Filtre
düğmesinde aktif sayısı rozeti.

**Sunucu-taraf DEĞİŞMEDİ.** `load()` yine dep/yıl/dönem/arama'yı sunucuya sorar
(kontrat §6); segment + sort + pasif süzgeci istemcide katman. K-48/K-57 backend
semantiği aynen korundu. Şube slotları yine **yalnız yayındaki** yeşil rozet
(GET /weekly-entries taslak görmez — mockup'taki DRAFT/SUBMITTED renkleri
uydurulmadı). "Haftalık programda gör" → `/weekly?department_id&year&semester`
(cohort görünümüne geçer).

**Not:** Yalnız frontend (`CoursesPage.tsx`); API/şema değişmedi. `dataviz`/tema
uyumu: kenarlıklar `--mantine-color-default-border` (koyu temada `gray-2` fazla
açıktı); tablo dar ekranda `Table.ScrollContainer` ile yatay kayar.

**Doğrulama (tarayıcı, gerçek veri, 12 Ağustos 2026):** 336 ders tek tabloda
render; "Ortak" segmenti 51 derse indirdi; CENG bölüm filtresi 19 derse (çip +
rozet "1") — sunucu reload'u ile. Normal ders Drawer'ı (CENG 1007: stat ızgarası,
şube kartı, şube-ekle formu) ve ortak ders Drawer'ı (MATH 1851: "çok gruplu" +
5 grubun teal rozeti) çalışıyor. AKTS başlığıyla sıralama doğrulandı. tsc + vite
build temiz; temiz yenilemede konsol/ağ hatası yok.

## K-66 · Öğretim Üyeleri + Derslikler ekranları K-65 arayüzüne geçti [E]
**Bağlam (kullanıcı):** "Aynı arayüz değişikliklerini derslikler ve öğretim
üyeleri sayfasına da yapalım." Claude Design mockup'ları (`Öğretim Üyeleri.dc.html`,
`Derslikler.dc.html`) K-65'in kabuğunu (tek sıralanabilir tablo + sağ Drawer +
TÜR segmenti + filtre popover + zebra + memo satır) bu iki ekrana taşıdı. Yalnız
frontend (`LecturersPage.tsx`, `ClassroomsPage.tsx`); API/şema değişmedi.

**İlke — mockup'ın backend'de KARŞILIĞI olmayan alanları UYDURULMADI.** İki
mockup da gerçek veri modelinin ötesinde alanlar içeriyordu; K-64/K-65'teki
"olmayan veriyi çizme" ilkesi (ör. DRAFT/SUBMITTED renkleri) burada da geçerli.
Kabuk birebir alındı, veri panelleri gerçeğe göre budandı:

- **Öğretim Üyeleri — düşürülenler:** ders yükü %'si / `maxHours` / "yükü aşan"
  (hocada üst sınır alanı yok), KISITLAR (kısıt tablosu yok), HAFTALIK MÜSAİTLİK
  ızgarası (kısıt verisi yok), Kadrolu/Yarı-zamanlı `type` (yok — en yakını
  `is_external` 40/a). **Gerçek karşılıklar:** segment Tümü/Kadrolu/Dış görevli/
  Ders vermeyen; stat ızgarası Ders·Şube·**Haftalık saat** (verdiği şubelerin
  T+U+L toplamı — sınırsız, sadece "N sa")·Öğrenci; unvan rozeti renkli (prefix'e
  göre); avatar baş harfleri; "Verdiği dersler" kartlarında gerçek yayın slotları
  (`/weekly-entries`). Footer'da "Haftalık programda gör" KALDI (hocanın kendi
  takvim görünümü `view=lecturer` — mevcut, çalışan özellik).
- **Derslikler — düşürülenler:** Blok/Kat (yalnız `building.name`, kat yok),
  Donanım (alan yok), Sorumlu bölüm (derslik paylaşımlı, K-25), haftalık kullanım
  ızgarası, İçe Aktar (derslik import'u yok — mevcut Export + Binaları Yönet
  korundu). **Gerçek karşılıklar:** segment Sınıf/Laboratuvar/Amfi (`room_type`);
  tabloda **Sınav Kont.** (K-21) korundu + **Haftalık Doluluk** çubuğu (dolu slot
  ÷ 45 = 5 gün × 9 slot, slots.ts'ten türetilir); Drawer'da "Yerleştirilen
  dersler" gerçek yayın slotları + hoca + öğrenci + **kapasite aşımı** kontrolü
  (`expected_students > capacity`). Booking'lerde hoca/öğrenci için `/courses` da
  yükleniyor (WeeklyEntry.section bunları taşımaz).

**Ortak desen (K-65 ile aynı):** sunucu yüklemesi değişmedi; segment+sort+pasif
istemci katmanı. Satırlar `memo`, `onSelect` `useCallback` ile sabit; başlık
`<SortTh/>` değil `sortTh()` fonksiyonu (gereksiz remount yok). Kenarlıklar
`--mantine-color-default-border`; dar ekranda `Table.ScrollContainer`.

**Doğrulama (tarayıcı, gerçek veri, 14 Ağustos 2026):** Öğretim Üyeleri 121 kişi,
renkli unvan rozetleri + 40/A + avatar; drawer (Ali Ekber IRMAK: Ders 1·Şube 1·
Haftalık saat 5 sa·Öğrenci 30, PHYS 1852 iki yayın slotu). Derslikler 29 derslik,
doluluk çubukları; drawer (B3B08: %47 · 21/45 slot, 5 gerçek yerleştirilen ders,
hoca+öğrenci). Her iki sayfada tsc + vite build temiz, konsol hatası yok.

## K-67 · Haftalık Program yalnız cohort; derslik/hoca programları kendi drawer'larında [E]
**Bağlam (kullanıcı):** "Haftalık programdaki derslik ve öğretim üyeleri
programlarını kaldıralım; tasarım dosyalarındaki gibi programları derslikler ve
öğretim üyeleri sayfalarındaki açılan sayfalara (drawer) ekleyelim; görünümleri
demo'daki gibi basit olsun. Ayrıca dışarı aktarma kısımlarını da haftalık
programdan kaldırıp kendi kısımlarına ekleyelim." Yalnız frontend.

**Karar — Haftalık Program tek MERCEK: cohort.** WeeklyPage üç mercekliydi
(cohort / derslik / hoca; sonuncu ikisi salt-okunur "kontrol" bakışıydı). Mercek
seçici (SegmentedControl), derslik/hoca süzgeç Select'leri, `InfoPanel` (sol
bilgi paneli), `roomFilter`/`lecFilter`/`view` state'i, iki `viewParam` deep-link
efekti ve `lecturers` fetch'i tümüyle KALDIRILDI. `ClusterCard`'ın `view` prop'u
ve dala bağlı metinleri sadeleşti. Cohort düzenleyici (palet, sürükle-bırak,
taslak barı, değişiklik akışı, çakışmalar) aynen korundu.

**Karar — programlar drawer'a `MiniWeekGrid` ile.** Yeni ortak bileşen
`components/MiniWeekGrid.tsx`: 5 gün × 9 slot sade ızgara (mockup'ların HAFTALIK
KULLANIM / MÜSAİTLİK'inin sade karşılığı). Salt-okunur, YALNIZ yayın yerleşimleri;
çok-slotlu blok tüm slotlarını doldurur, etiket başta yazılır. Öğretim Üyeleri
drawer'ında "HAFTALIK PROGRAM" (verdiği şubelerin gün-slot'u), Derslikler
drawer'ında (odaya düşen yerleşimler). **Not:** K-66'da "düşürülen" ızgara
KISIT-tabanlı müsaitlikti (veri yok); bu ise gerçek YERLEŞİM ızgarası — uydurma
değil. "Haftalık programda gör" düğmeleri kalktı (program artık içeride).

**Karar — export ilgili sayfaya taşındı (yeni backend ucu GEREKMEDİ).** Öğretim
Üyeleri drawer'ında `/export/weekly?lecturer_id=X`, Derslikler drawer'ında
`/export/classrooms?classroom_id=X` (ikisi de zaten vardı). Haftalık Program'daki
export DÖNEM (cohort) programının resmi çizelgesiyle sınırlandı; **kullanıcı
kararı: dönem export'u Haftalık Program'da KALSIN** (resmi çizelgenin başka evi
yok). Derslik/hoca export dalları WeeklyPage'den çıktı.

**Doğrulama (tarayıcı, gerçek veri, 14 Ağustos 2026):** Öğretim Üyeleri drawer'ı
Ali Ekber IRMAK → HAFTALIK PROGRAM ızgarasında PHYS 1852 (Pzt 3 slot + Sal 2 slot
= 5 sa) + "Programı Aktar". Derslikler drawer'ı B3B08 → 5 dersin gün-slot'u
ızgarada + "Programı Aktar". Haftalık Program artık mercek seçicisiz, yalnız
cohort; palet/grid/taslak/çakışma çalışıyor, `/lecturers` çekilmiyor, tüm API
200. tsc + vite build temiz.

## K-68 · Dersler/Derslikler/Öğretim Üyeleri arayüz düzeltmeleri + derslik `floor` [S+E]
Kullanıcı geri bildirim toplu düzeltmeleri (K-65/66/67 üstüne). Çoğu frontend;
biri backend şema (kat).

**Dersler.** Segment TÜR (Zorunlu/Seçmeli/Ortak) yerine KATEGORİ:
Tümü/Ortak/1-4. sınıf. Sınıf segmenti yıl süzgecini SUNUCUYA taşır (`year=N`);
"Ortak" is_common (istemci); 1-4 sınıfta ortak dersler dışlanır. Ders türü
(Zorunlu/Seçmeli) filtre popover'ına indi; popover'daki "Sınıf" kalktı. Çip
"yıl" yerine "tür".

**MiniWeekGrid (ortak).** Çok-slotlu blokta etiket artık HER slotta yazılır
(eskiden yalnız başta, ardışık slotlar isimsiz boyanıyordu — kullanıcı "ne
olduğu belirsiz" dedi). "ders/boş" legend'i kaldırıldı (isim yazınca gereksiz).

**Derslikler.** Tabloda "Haftalık Doluluk" → "Haftalık Kullanım". Bina sütunu +
drawer stat'ı bina+kat gösterir ("B Blok · 2. kat"). Drawer stat'ta "Haftalık
saat" → "Konum". Künyeden bina+kapasite alt satırı kaldırıldı (ikisi de stat'ta).
Özet etikete "N ders" (bu dersliklere yerleşmiş farklı ders) eklendi. Pasife-al
simgesi daire yerine GÖZ (IconEye/EyeOff).
- **Backend `floor` (K-68) [S]:** `classrooms.floor int NULL` — model + schema
  (Create/Update/Out) + alembic migration `b8e4f1a09c2d`. Motor okumaz, opsiyonel
  bilgi. Form'da "Kat" (opsiyonel, 0=zemin). Uçtan uca doğrulandı (B3B08 → 2. kat
  kaydedildi, Konum'da göründü). 587 backend testi yeşil.

**Öğretim Üyeleri.** "Bölüm" → "Kadro birimi" (sütun + form; kadro = asli bölüm,
department_id). Drawer'a "GÖREV BİRİMİ" = verdiği ORTAK OLMAYAN derslerin
bölümleri (türetilir; ortak ders çok bölümlü olduğu için görev birimi belirtmez).
"Verdiği dersler" kartında slot rozetleri yan yana yerine ÜST ÜSTE (çok-günlü
ders — CENG 4012, 5 slot — satırı kaplayıp çirkin duruyordu). "Ders vermeyen"
segmenti kaldırıldı. Pasife-al simgesi GÖZ oldu.

**Doğrulama (tarayıcı, 14 Ağustos 2026):** Dersler segmenti 1. sınıf → 18 ders
(ortak yok); Derslikler drawer'ı Konum "B Blok · 2. kat", ızgarada her slotta
isim, göz simgesi; Öğretim Üyeleri drawer'ı görev birimi + CENG 4012 slotları
üst üste. tsc + vite build temiz; 587 backend testi yeşil.

## K-69 · Başlık sayaçları sadeleşti + Dersler performans (istemci segment, statik-bir-kez) [E]
Kullanıcı: başlık yanındaki çok parçalı sayaçlardan yalnız ana belirteç kalsın;
"sayfalar biraz kasıyor". Yalnız frontend.

**Sayaç etiketleri.** Üç sayfada da tek ana sayaç: Dersler "N ders" (eski
"· şube · ortak" düştü), Derslikler "N derslik" (eski "· kişilik · ders ·
kapalı"), Öğretim Üyeleri "N kişi" (eski "· ders veren"). Bunları besleyen
`sectionTotal`/`commonCount`/`totalCap`/`closedCount`/`lessonCount`/`teachingCount`
useMemo'ları da kaldırıldı (render başına iş azaldı).

**Performans — Dersler.**
- **Sınıf segmenti İSTEMCİYE alındı.** Eskiden 1-4. sınıf seçimi sunucuya
  `year=N` gönderip TAM yeniden yükleme yapıyordu (ağ turu + 336 satır yeniden
  render). Artık `seg` filtre `useEffect` bağımlılığında değil; yıl istemcide
  süzülür (`c.year === N && !is_common`). Segment geçişi anlık — ders nesneleri
  aynı ref kaldığı için memo'lu satırlar yeniden render bile olmaz, yalnız DOM
  süzülür. (Derslikler/Öğretim Üyeleri zaten tümünü bir kez yükleyip istemcide
  süzüyordu; Dersler tek sunucu-taraflı sayfaydı.)
- **Statik listeler yalnız BİR kez.** Bölüm/hoca/derslik/haftalık filtreyle
  değişmez; her dep/dönem/arama değişiminde dördünü birden çekmek gereksizdi.
  `useRef` bayrağıyla ilk `load`'da hepsi (paralel), sonraki yüklemelerde yalnız
  `/courses` çekilir. Tüm `load()` çağrı yerleri değişmedi (tek fonksiyon).

**Doğrulama (tarayıcı, 14 Ağustos 2026):** Üç başlık tek sayaç; Dersler "1. sınıf"
segmenti spinner'sız anında 18 derse indi (ağ isteği yok). tsc + vite build temiz.

## K-70 · Dönemler-arası çakışma kapatıldı + eksik derslik uyarısı (W9/E8) [E]
Kullanıcı: (1) sistem güz ile bahar dersleri arasında da çakışma arıyor — güz ve
bahar farklı zamanlarda olduğundan bu saçma, kaldır. (2) Programa ders veya sınav
konurken derslik girilmemişse uyarı ver.

**Dönem kapısı (genel — dönem adına bağlı DEĞİL).** `same_semester(a,b)` yalnız
`semester` eşitliğine bakar; FALL/SPRING (veya ileride bir YAZ) gömülü değildir,
"farklı dönem = ayrı" kuralı geneldir. Kapıyı motorun saf kural fonksiyonlarına
DEĞİL — orchestrator'ın ikili döngülerine koydum: yanlışsa `continue`. Neden
orchestrator: kural fonksiyon imzaları sabit kalsın, birim testleri kırılmasın.

Nerede uygulanır — gerekçesi "farklı dönemin **haftalık** dersi takvimde farklı
haftalarda TEKRAR eder, asla aynı anda olmaz":
- **W1/W2/W5 (haftalık kaynak): EVET.** Bir dönemde A101-Pzt-1.slot ↔ başka
  dönemde aynı derslik/saat → eskiden sahte HARD W1, artık sessiz.
- **X1–X3 (sınav×ders): EVET.** Haftalık taraf tekrar eden slot; sınavın somut
  tarihi başka dönemin dersiyle `exam_date.weekday()` üzerinden sahte eşleşir.
- **E1–E4 (sınav×sınav): HAYIR (kullanıcı düzeltmesi).** Sınav somut tarih taşır,
  tekrar etmez; kesişim zaten aynı `exam_date` şartına bağlı ve bir takvim günü
  tek döneme ait → dönem ayrımı gereksiz. Orchestrator'da E döngüsüne kapı KONMAZ.
- Cohort kuralları (W3/W4/E4/X2) dönemi zaten cohort anahtarında taşır, etkilenmez.

- **Cohort kuralları (W3/W4/E4/X2) dokunulmadı:** dönemi zaten cohort anahtarında
  (`department_id, year, semester`) taşıyorlar; farklı dönem = farklı cohort =
  zaten çakışmıyor. Kapı yalnız kaynak-kaynak (derslik/hoca/tarih) sahte
  eşleşmelerini eler. En belirgin sahte durum: güz'de A101-Pzt-1.slot ile bahar'da
  aynı derslik/saat → eskiden HARD W1, artık sessiz.
- **Neden scalar `semester` yeterli:** ortak ders (K-48) birden çok cohort'a
  yayılsa da tek fiziksel zamanda olur; extra_cohort'lar "kim katılıyor"u belirtir,
  "ne zaman"ı değil. O yüzden dönem karşılaştırması dersin kendi `semester`'ı
  üzerinden doğru.

**W9 (haftalık eksik derslik).** Tekil kural (W6/W7 gibi). `delivery_mode=
FACE_TO_FACE` VE `classroom_id` NULL → WARNING. Online (SYNC/ASYNC) girişler
tasarımca dersliksizdir (K-10/K-23) — eksiklik değil, uyarı üretmez. W6 tekil
döngüsüne eklendi (asenkron dahil tüm girişler; online zaten kural içinde susar).

**E8 (sınav eksik derslik).** Tekil kural (E5/E5a/E6 gibi). `rooms` boş → WARNING.
Sınavın online kavramı yok; dersliksiz her sınav uyarılır. E5/E5a/E7 boş kümede
sessizce atlıyordu (kontenjan hesaplayacak oda yok); E8 tam o boşluğu yakalayıp
"derslik ekle" der. `scan_exams` tekil döngüsüne eklendi.

Her ikisi de WARNING (kullanıcı "uyarı" dedi) — yerleştirmeyi engellemez, submit'i
kilitlemez; yalnız "derslik eklemeyi unuttun" hatırlatması. Mesajlar message.py'de
(_msg_w9/_msg_e8); frontend değişmedi (kural mesajını sunucudan alıp gösteriyor,
yalnız types.ts yorumu W9/E8'e güncellendi).

**Doğrulama:** test_overlap 130→+13 test yeşil (W9/E8 motor + orchestrator
kablolaması; dönemler-arası W1/E1/X1 bastırma + aynı-dönem kontrol testleri).

## K-71 · Öğretim Üyeleri arayüz düzeltmeleri + `detail_url` + unvan normalizasyon bug'ı [S+E]
Kullanıcı geri bildirim toplu düzeltmeleri. Biri backend şema (`detail_url`),
biri veri düzeltmesi (unvan), gerisi frontend.

**Akademik personel sayfası (`detail_url`).** Hoca modeline nullable `detail_url`
kolonu (migration c1a2b3d4e5f6). Web import kişinin `detail_url`'ini artık
SAKLIYOR (eskiden yalnız önizlemede vardı, yazılmıyordu); elle eklerken/düzenlerken
opsiyonel "Akademik personel sayfası" alanından girilir ("detay" denince
anlaşılmıyordu — açık ad). Drawer'da Öğrenci sayacı yerine "Akademik sayfa" linki
(varsa "Aç ↗", yoksa —). NOT: bu kolondan ÖNCE import edilmiş kayıtlarda NULL;
geri-doldurmak için yeniden scrape gerekir (yapılmadı, yeni import'lar dolu gelir).

**Drawer stat ızgarası yeniden dizildi.** [Ders, Şube, Haftalık saat, Öğrenci] →
[Ders, **Kadro birimi** (asli bölüm adı), Haftalık saat, **Akademik sayfa** (link)].
Şube ve Öğrenci sayaçları kalktı. Künyede isim altındaki bölüm adı da kaldırıldı
(artık Kadro birimi stat'ında; iki yerde yazmasın) — alt satırda yalnız e-posta.

**Unvan normalizasyon bug'ı (aktarma hatası).** `normalize._TOKEN_ALIAS`'ta
`"araş"→"arş"` yoktu; site "Araş.Gör.Dr." yazınca kanonikleşmeden HAM saklanıyordu
("Araş.Gör.Dr."), frontend TITLES'ta bu yok → düzenle formunda Unvan Select'i BOŞ
görünüyordu. Alias eklendi (kök neden, gelecekteki import'lar düzgün). Mevcut 9
satır tek seferlik `canonical_title` ile yeniden normalize edildi ("Arş. Gör. Dr.").
Ayrıca form Select'i artık kanonik-dışı bir unvanı da seçenek olarak gösteriyor
(savunma; herhangi bir bilinmeyen unvanda boş kalmasın).

**Import önizleme.** "Görev / Kadro Birimi" sütunu yalnız **Kadro Birimi**'ne indi.
Görev birimi verdiği derslerden türetilir (dutyUnitsOf); import'ta göstermeye gerek
yok. Backend bölüm eşleme (görev→kadro düşüşü) değişmedi — yalnız görüntü.

**Küçük düzeltmeler.** (a) Öğretim Üyeleri + Derslikler drawer'larındaki export
düğmesi "Programı Aktar" → "Programı İndir". (b) Tablo sütun genişlikleri: her iki
tabloda tek genişliksiz sütun (Öğretim Üyeleri "Ad Soyad", Derslikler "Bina") tüm
boşluğu yutup orantısız genişliyordu; hepsine genişlik verilince boşluk oranlı
dağıldı, odak sütunu baskın ama diğerleri sıkışmıyor.

**Yetki (kullanıcı sorusu).** `canWrite` false olduğunda tüm yazma kontrolleri
(Ekle/İçe Aktar/Düzenle/Sil/Pasife al) `canWrite && (...)` ile HİÇ render edilmez —
soluk/disabled değil, tamamen gizli. Salt-okunur drawer + "Programı İndir" herkeste.

**Doğrulama (tarayıcı, 14 Ağustos 2026):** Drawer yeni stat düzeni, Aysu GÖÇÜGENCİ
düzenle formunda "Arş. Gör. Dr." dolu (bug düzeldi), form açıklaması yok + akademik
sayfa alanı var, iki tabloda sütunlar dengeli. tsc + vite build temiz; lecturer+
import backend testleri (48) yeşil.

## K-72 · Import kadro-only eşleştirme + 40/a çözümü + eksik-bilgi güncelleme + UI cila [S+E]
Kullanıcı geri bildirim toplu düzeltmeleri (K-71 üstüne).

**İçe aktarma — bölüm eşleştirme yalnız KADRO birimi.** `_match_department` artık
görev birimini denemiyor (eskiden görev→kadro düşüşü vardı). Görev birimi fiilen
ders verdiği yer; o zaten verdiği derslerden türetilir. Bölüm = resmi kadro.

**İçe aktarma — bölümsüz kayıt kuralı.** Kadro bir bölüme eşleşmezse önizlemede o
satırın "Bölüm" hücresi düzenlenebilir bir Select (bölümler + "40/a — dış görevli
(bölümsüz)"). Eşleşen satır ön-dolu gelir. Commit kuralı: bölümü olan → normal
eklenir; bölümsüz + 40/a işaretli → dış görevli (is_external, bölümsüz) eklenir;
**bölümsüz VE 40/a değil → EKLENMEZ** (skipped "(bölümsüz)"). `ImportRow`'a
`is_external` eklendi; commit'te sabit `is_external=False` yerine satırdan gelir.

**İçe aktarma — eksik-bilgi güncelleme kolu.** Önce yalnız YENİ kişiler geliyordu;
K-71'den önce eklenmiş kayıtlarda `detail_url` yok. Artık preview `updates` da
döndürüyor: sistemde olan ama detay sayfası / e-postası eksik kayıtlar. detay linki
liste taramasından BEDAVA (PersonRef); e-posta için yalnız eksik olanların detayı
çekilir (cap'li). Commit `updates` kolu yalnız NULL alanı doldurur, var olanı
EZMEZ. `ImportUpdateRow` + `ImportCommitOut.updated` eklendi. Canlı doğrulama:
88 kişi, 85 zaten kayıtlı → 3 yeni + 85 güncellenebilir.

**Öğretim Üyeleri UI.** (a) Kadro birimi artık KOD ("MINE", "CENG") — ad değil;
hem derli toplu hem sütun sıkışmıyor (`depLabelOf` → `.code`). (b) Drawer stat
"Akademik sayfa" → "Detay sayfası". (c) Her iki drawer'da "Sil" düğmesi metin
yerine yalnız çöp-kutusu ikonu (ActionIcon). (d) İki filtre popover'ından
gereksiz "Kapat" düğmesi kaldırıldı.

**Derslik `floor` bug'ı.** Mantine NumberInput temizlenince değer "" (boş string)
olup backend'e gidiyor, `int|None` "valid integer değil" 422 veriyordu → kat
silinemiyordu. Submit'te `typeof === "number"` değilse null'a indirgeniyor;
`allowDecimal={false}`. Canlı doğrulama: kat girip temizleyip kaydetme artık
null olarak geçiyor.

**Doğrulama:** 604 backend testi yeşil (5 yeni import testi: kadro-only, görev
yok sayılır, bölümsüz-40a-değil skip, elle bölüm çözümü, eksik-bilgi güncelleme +
ezmeme). tsc + vite build temiz. Tarayıcıda import akışı uçtan uca (40/a dropdown,
kırmızı çözülmedi uyarısı, 85 güncelleme), kadro=kod, Detay sayfası, simge-Sil,
Kapat yok, floor temizleme — hepsi teyit.

## K-73 · Program sayfaları: değişiklik akışı sadeleşti, mod hafızası, yayın bilgisi pop-up'ı + küçük düzeltmeler [S+E]
Kullanıcı geri bildirim toplu düzeltmeleri.

**Küçük düzeltmeler.** (a) K-72'de kaldırılan filtre "Kapat" düğmeleri GERİ geldi
(iki sayfa). (b) Hoca "Kadro birimi" artık "KOD - Ad" ("CE - İnşaat Mühendisliği")
— K-72'de yalnız koddu, kullanıcı adı da istedi. (c) Derslik kat alanının
"Opsiyonel (0 = zemin)." açıklaması kaldırıldı.

**Değişiklik akışı (ChangeFeed) yeniden tasarlandı.** "Bölümünüzü etkileyen son
değişiklikler" göz yoruyordu. Artık: (a) açılır-kapanır (varsayılan KAPALI, başlıkta
sayaç), (b) her satır tek satır — "cohort · tür rozeti · tarih · Göster" (özet
metni kalktı), (c) "Göster" o cohort'un YAYINDAKİ halini açar. (d) **Tür ayrımı:**
Haftalık ekranda yalnız WEEKLY, Sınav ekranda yalnız EXAM değişiklikleri (`kind`
prop + backend süzgeci); ana sayfada ikisi birden (URL ile yönlendirir).

**Backend `/schedule-changes` süzgeçleri.** `kind`, `department_id`, `year`,
`semester` opsiyonel parametreleri eklendi. Cohort süzgeci ORTAK DERS etkisini
KATMAZ (DraftBar pop-up'ı "bu cohort'u kim düzenledi" sorar, doğrudan onayı ister).

**Mod hafızası (K-73).** Bug: taslaktan yayına dönüp sayfa değiştirip geri
gelince ekran hep taslağa atlıyordu. Artık cohort başına son mod localStorage'da
(`weekly-mode`/`exam-mode` → "pub" | taslak id). Oto-seçim efekti tercihi gözetir:
"pub" ise taslağa atlamaz; taslak id ise onu seçer; tercih yoksa (ilk ziyaret)
eski davranış (açık taslağı seç). En optimize yol: zaten atılan taslak sorgusunun
sonucundan HANGİSİNİ seçeceğimizi belirleyen bir yerel tercih — ek sunucu turu yok.

**DraftBar: kilit + "salt-okunur" → "i" pop-up'ı.** Yayın modunda "Yayındaki
program" yanındaki kilit simgesi ve "salt-okunur — değişiklik için taslak açın"
metni kaldırıldı. Yerine bir "i" (HoverCard): bu cohort+tür için son APPROVED
taslaktan **Düzenleyen (owner) · Onaylayan (reviewer) · Yayınlanma tarihi**. Onaylı
değişiklik yoksa "henüz onaylı değişiklik yok" der. (Palet içindeki ayrı salt-okunur
ipucu bırakıldı — o paletin neden sürüklenmediğini anlatır, farklı bir yer.)

**Header hizalama.** Haftalık ve Sınav sayfalarında cohort seçicileri farklı
konumdaydı (Haftalık'ta ortada justify=center, Sınav'da sağda) ve ortalanmış
duruyordu. İkisi de başlıkla birlikte SOLA çekildi, hizalar tuttu.

**Doğrulama (tarayıcı):** Header sol hizalı; DraftBar "i" pop-up'ı dolu (Düzenleyen
Fakülte Yöneticisi · Onaylayan Alt Hesap (Test) · 12 Ağustos 2026) ve boş cohort'ta
fallback; ChangeFeed açılır-kapanır + yalnız WEEKLY + Göster cohort'u yayında açtı
(taslak #25 varken bile yayında kaldı); mod hafızası iki yönde (yayında bırak→yayın,
taslakta bırak→taslak). tsc + vite build temiz; schedule-changes süzgeç testi eklendi.

## K-74 · Mod çubuğu üst bara gömüldü (tek bar) + 40/a etiketi + palet düzeltmeleri [E]
Kullanıcı: ayrı "mod çubuğu" kalabalık; üst barla birleştirelim. + küçük düzeltmeler.

**DraftBar üçe bölündü, üst bara gömüldü.** Eskiden başlık barı + ayrı DraftBar +
ChangeFeed üst üste 3 Paper'dı. DraftBar `DraftStatus` / `DraftActions` / `DraftNotes`
olarak bölündü ve üst barın İÇİNE yerleşti (tek Paper): durum cohort seçicilerin
SAĞINDA ("Yayındaki program"+i ya da taslak rozeti+"N değişiklik"; cohort adı
TEKRAR yazılmaz — seçicilerde var), eylemler (Taslak Aç/Dön, Farkı Gör, Temizle,
Onaya Gönder, Sil, Geri Çek, Yayına Dön) sağ eylem grubunda. PENDING/REJECTED bilgi
satırı barın altına ince bir `DraftNotes` olarak indi (yalnız o durumlarda görünür).
Taslaktayken bar hafif renklenir (DRAFT_SURFACE/BORDER) — eski renkli çubuğun işlevi.

- **Dışa Aktar yalnız YAYINDA:** export yayındaki programı indirir, taslakta anlamsız
  → taslak modunda gizli.
- **"Taslağa Dön" sayısı kaldırıldı** ("(#25)" gitti; taslakta sayı tutmaya gerek yok).

**40/a etiketi.** Import'ta "40/a — dış görevli (bölümsüz)" → "40/a — dış görevli".
Kullanıcı: 40/a bölümsüz demek değil; başka fakültede kadrolu (Matematik/Fizik gibi
servis derslerini verenler), bizim bölümlerimize ait olmaması onları bölümsüz yapmaz.

**Palet.** (a) Haftalık paletindeki "Yayındaki program salt-okunur…" ipucu kaldırıldı.
(b) `offsetScrollbars` kaldırıldı (iki sayfa) — ders kartları artık "Ders ara"
kutusuyla aynı genişlikte (eskiden kaydırma payı kadar dardı).

**Doğrulama (tarayıcı):** Haftalık + Sınav'da tek bar; yayın modu (Yayındaki
program+i · Taslağa Dön · Dışa Aktar) ve taslak modu (renkli · TASLAK+durum ·
tüm butonlar · export gizli) teyit; palet kartları arama kutusuyla eşit genişlik;
salt-okunur ipucu yok. tsc + vite build temiz (frontend-only).

**K-74 inceltme (aynı tur, kullanıcı geri bildirimi):** (a) Taslak durumundaki
"yayındaki … ile aynı" metni kaldırıldı — değişiklik varken yalnız "N değişiklik",
yokken hiçbir şey (TASLAK rozeti zaten belli ediyor). (b) Farkı Gör ve Temizle
yalnız SİMGE (yazı yok; Sil zaten çöp simgesiydi). (c) Onaya Gönder birincil eylem
olarak EN SAĞA alındı: DraftActions barın en sonunda render edilir (Geri Al ve
Dışa Aktar ondan önce), Onaya Gönder de DraftActions içinde son buton. Yayın
modunda aynı düzenden Taslak Aç/Dön en sağda kalır.

## K-75 · Program gridi sadeleştirme: legend + grid etiketleri + tıkla-taslak kaldırıldı [E]
Kullanıcı: grid çok kalabalık; renk açıklaması ve satır-içi etiketler gitsin.

- **Renk açıklaması (legend) kaldırıldı** (Haftalık + Sınav). Yayınlanmış/Taslak/
  Uyarı/Çakışma/Online swatch'ları ve `Legend` bileşeni silindi. Kart renkleri
  (mavi/gri kenar, kesikli taslak kenarı, uyarı/çakışma köşesi) kalır — yalnız
  açıklama satırı gitti.
- **Online artık gridde özel kategori değil:** legend'deki "Online" swatch'ı kalktı.
  (Karttaki işlevsel online göstergesi — küre ikonu + "online" oda etiketi —
  korundu; oda bilgisi kaybolmasın diye. İstenirse o da kaldırılır.)
- **Grid SEÇMELİ + TASLAK etiketleri kaldırıldı** (Haftalık ClusterCard). Palet/
  sol-panel "Seçmeli" rozeti KALDI (kullanıcı "gridteki" dedi). Sınav gridinde
  bu etiketler zaten yoktu.
- **Yayında gridde tıkla→"taslak açılsın mı?" kaldırıldı.** `askSwitchToDraft`
  (iki sayfa) ve `ClusterCard.onRequestDraft` silindi; yayın modunda karta/boş
  hücreye tıklama artık bir şey yapmaz. Taslak YALNIZ üstteki bardan açılır.

Frontend-only; tsc + vite build temiz. Tarayıcıda teyit: legend yok, grid
kartlarında SEÇMELİ/TASLAK yok, yayında karta tıklama sessiz.

## K-76 · Program barı ince ayarları + Temizle onayı + sınav gridi 1 saat + hover "i" [E]
Kullanıcı geri bildirim toplu düzeltmeleri (Haftalık + Sınav).

**Bar düzeni.** (a) Dışa Aktar EN SAĞA (DraftActions'tan sonra); yayın modunda
en sağda, taslakta zaten gizli → Onaya Gönder en sağda kalır. (b) Geri Al yalnız
SİMGE (ActionIcon; sayı tooltip'e taşındı). (c) Taslakta bar RENK DEĞİŞTİRMEZ —
DRAFT_SURFACE/DRAFT_BORDER tonu kaldırıldı (TASLAK rozeti zaten belli ediyor).
(d) Taslağı Sil simgesi çerçeveli (variant outline, kırmızı) + tooltip'ten
"yayına etkisi yok" çıktı. (e) Yayına Dön çerçeveli (subtle → default).

**Temizle onayı (K-76).** "Temizle" artık doğrudan silmiyor; bir modal açıyor:
"Ortak dersleri de sil" onay kutusu. İşaretlenirse `include_shared=true` gider ve
cohort'taki ortak (servis) dersler de silinir; işaretlenmezse korunur. Backend
`/clear` bunu zaten destekliyordu; eksik olan istemci sorusuydu.

**Değişiklik akışı programlardan kaldırıldı.** ChangeFeed yalnız ana sayfada;
Haftalık + Sınav sayfalarından çıkarıldı (ana sayfada zaten var, tekrar gürültü).

**Sınav gridi haftalık gibi 1 saat.** Bir saat 63px → `WEEKLY_ROW_H` (91px):
saat satırı artık haftalık slotla aynı boyda (eskiden "yarım slot" gibi sıkışıktı).
Grid böylece uzuyor; görünür yükseklik weekly gridiyle eşitlendi
(`VISIBLE_H = HEAD_H + WEEKLY_ROW_H*9`) ve akşam saatleri dikey scroll ile açılıyor
(Paper `overflow:auto` + `maxHeight`). Sol panel yüksekliği de VISIBLE_H'ye eşit.
NOT: basit yaklaşım — scroll'da gün başlıkları da kayıyor (sticky başlık ayrı iş).

**Ders "i" pop-up'ı hover'da da açılır.** CourseInfoButton artık `onMouseEnter`
ile açılıyor (yalnız tıklama değil). Tıklama SABİTLER (pinned): sabitken fare
çekilince kapanmaz (içindeki bağlantıya gidilebilir), hover'la açıldıysa çekilince
kapanır. Başka "i" açılınca sabitleme sıfırlanır.

**Doğrulama (tarayıcı):** Bar (Dışa Aktar sağda, Geri Al simge, ton yok, çerçeveler),
Temizle modalı (ortak ders onayı), sınav gridi (91px satır + dikey scroll ile 17:00+),
hover "i" — hepsi teyit. tsc + vite build temiz (frontend-only).

## K-77 · Yayın Merkezi: Taslaklarım + Onay Bekleyenler tek master-detail sayfada [S+E]
Kullanıcı (design import): iki sayfa birleşsin, tek "Yayın Merkezi" olsun. Design
solda durum-gruplu kuyruk, sağda seçili kaydın tam incelemesi + kararı gösteriyor.

**Neden birleşti.** DraftsPage ("kendi kuyruğum") ile ApprovalsPage ("onay
kuyruğu") aynı yaşam döngüsünün (OPEN→PENDING→APPROVED|REJECTED) iki ucuydu;
kullanıcı ikisi arasında gidip geliyordu. Artık tek ekran, tek zihinsel model.
Sol menüde iki öğe (Taslaklarım + Onay Bekleyenler) tek **Yayın Merkezi**'ne indi
(IconInbox); yeni bir liste ucu değil, iki mevcut ucun master-detail birleşimi.

**Görünürlük K-59 gizliliğine SADIK (kullanıcı kararı — mock'un birleşik havuzu
DEĞİL).** Design herkesin taslağını tek havuzda gösteriyordu; backend ise OPEN/
REJECTED/APPROVED taslakları yalnız sahibine, PENDING'i kapsamdaki onaylayıcıya
açıyor. İki seçenek sunuldu (gizliliğe sadık kal / yeni birleşik uç); kullanıcı
gizliliği seçti. Sonuç asimetrik ama dürüst:
- **Taslaklar/Reddedilenler/Yayında** = yalnız BENİM (`/schedule-drafts?
  include_history=true`).
- **Onay bekleyenler** = onaylayıcıysam kapsam kuyruğu (`/schedule-approvals`),
  değilsem kendi PENDING'lerim (myDrafts süzgeci). Tek kaynak → mükerrer yok.
  (Kendi PENDING'im onaylayıcıda daima kuyrukta görünür: submit bölüm üyeliği
  ister, admin tüm workgroup'u görür → "görünmez pending" oluşmaz.)

**Detay paneli — kayda göre kaynak + GERÇEK eylem modeli.** Design'ın "admin→
onayla / diğer→gönder" basitleştirmesi yerine duruma göre:
- İncelenebilir PENDING (onaylayıcı) → `/schedule-approvals/{id}` (fark + ızgara/
  liste + çakışma + bayatlık). Başkasınınsa **Onayla ve yayınla** (hard'da kilitli)
  + **Reddet**; kendiminse **Geri çek** + "kendi talebinizi onaylayamazsınız".
- Kendi taslağım (OPEN/REJECTED/PENDING) → `/schedule-drafts/{id}` diff+conflicts+
  entries/exams. OPEN/REJECTED: **Onaya gönder** (opsiyonel not modalı) + **Programda
  düzenle** + **Sil**; PENDING: **Geri çek**.
- **APPROVED özel:** satırlar yayına geçip silindiği için canlı fark/ızgara YOK;
  yeşil "Bu değişiklik yayında" + `applied_summary` gösterilir, footer salt-okunur
  (yalnız Programda gör). Adım çubuğu (Taslak→Onayda→Yayında) duruma göre dolar.

**v1 sadeleştirme (kullanıcı kararı).** Design'ın kart-başı çakışma çipleri, "Engelli
önce" sıralaması ve "Temizleri onayla" toplu onayı liste uçlarında çakışma sayısı
gerektiriyor (kart başına tarama). v1'de yok: çakışma yalnız detay panelinde (zaten
orada taranıyor). Toplu onay sonraki tura.

**Revizyon (aynı tur, kullanıcı geri bildirimi): sol panel Bölümler kabuğu +
sıralama seçici kaldırıldı (gruplar KALDI).** İlk sürümde sol panel dört durum
grubu (sayaçlı düğmeler) + bir sıralama seçicisi (En yeni / Bölüme göre)
taşıyordu. Kullanıcı: (a) sol taraf **Bölümler ekranındaki gibi** olsun — design
zaten öyle; (b) "kategorileme"den kastı yalnız SIRALAMAYDI → sıralama seçicisi
kalksın, grup içinde daima en yeni önce. Dört durum grubu KORUNDU.
- **Yalnız sıralama seçicisi SİLİNDİ.** Grup içi liste daima `ts` (submitted ??
  created) azalan. Grup havuzu ilk tasarımdaki gibi: PENDING onaylayıcıda kuyruktan
  (`/schedule-approvals`), OPEN/REJECTED/APPROVED "benim taslaklarım"dan — her grup
  tek kaynak, tekilleştirmeye gerek yok.
- Sol panel Bölümler kabuğuna geçti: `Grid columns={100}` (sol 26 / sağ 74),
  `Title order={4}`, dört grup düğmesi (leftSection ikon + rightSection sayaç,
  seçili olan `variant=light` grup renginde), "Ara" `TextInput`, `ScrollArea.Autosize
  mah="calc(100vh - 220px)"`, kartlar `UnstyledButton` + `.pub-card` (DepartmentsPage
  `.dept-card`'ının aynısı: hover yükselme, seçilide sol mavi kenar + blue-light
  zemin). Sağ panel de sabit-yükseklik/iç-kaydırma yerine sayfa akışına döndü;
  eylem çubuğu içeriğin sonunda ince bir ayraçla durur.
- Karttaki durum rozeti korundu (design'da da var; grup zaten durumu söylese de
  design bütünlüğü için bırakıldı).

**Program önizleme yeniden kullanımı.** ApprovalsPage'e gömülü `ProposedGrid` +
`ProposedExamList` ortak `components/ProposedSchedule.tsx`'e taşındı (tek kaynak).
DiffTable'ın `placementText`/`examPlacementText`'i değişiklik listesinde kullanıldı.
Eski iki sayfa silindi; `/drafts` ve `/approvals` query'yi koruyarak `/publishing`'e
yönlenir (derin bağlantılar kırılmaz). Menü rozeti (bekleyen sayısı) AppLayout'ta
canlı: onaylayıcıda kuyruk, değilse kendi PENDING'i; `publishing:refresh` olayıyla
karar sonrası tazelenir.

**Doğrulama (tarayıcı):** Dört grup (sayaçlar 0/5/1/3), OPEN detayı (stat hücreleri
DEĞİŞİKLİK/ENGEL/UYARI/DÖNEM + program ızgarası + W9 çakışma kartları + gönderen/
karar + 3 butonlu footer), REJECTED (adım notu "düzeltip yeniden gönderilebilir"),
APPROVED (applied_summary özeti + salt-okunur footer) teyit. tsc + vite build temiz.

## K-78 · Yetki matrisi: sistematik regresyon testi (denetim + kanıt) [E] — brief §6.3/§10.2, yol haritası A-5
Kullanıcı sorusu somuttu: "yetkisiz biri erişemeyeceği şeye erişebiliyor mu?"
İki iş: (1) mimariyi statik DENETLE, (2) sonucu tek bir regresyon dosyasına kilitle.

**Denetim sonucu — açık YOK.** Her ayrıcalıklı uç katmanlı korunuyor:
kimlik (`get_current_user` → 401) · yetenek bayrağı (`require_admin`/`require_*`
bağımlılığı → 403) · bölüm üyeliği (gövdede `_ensure_*_access` → 403) · workgroup
izolasyonu (`_get_owned_*` id sorgusu workgroup'a bağlı → **404**, varlık sızmaz)
· çapraz-FK (gövdedeki yabancı id → 400) · öz-onay (`_ensure_not_self` → 403) +
PENDING kilidi (`_ensure_editable` → 409). Yazan uçların tamamı bir `require_*`
kapısından geçiyor; çıplak `get_current_user` ile yazan tek grup taslak uçları,
o da bilerek (K-59: özel taslak kum havuzu; yetki `submit`'te aranır). Geniş
görünen okuma uçları (`/conflicts`, `/export/*`) bilinçli karar (K-04/K-26), açık
değil.

**Neden mevcut testler yetmiyordu (eksik olan neydi).** Yetki 33× 403 + 12
dosyada `foreign_admin` ile ZATEN kanıtlıydı — ama DAĞINIK, özellik-başına. "Hangi
rol hangi ucu açar" sorusunun tek bir cevabı yoktu. Yeni dosyanın değeri iki katlı:
ileride bekçisiz bir uç eklenirse tek süpürme yakalar; beş saldırı sınıfı her uçta
TEK BİÇİMDE iddia edilir.

**`backend/tests/test_k78_authz_matrix.py` — beş sınıf (dıştan içe):**
- **A · Kimliksiz → 401:** her ayrıcalıklı uç (parametrize, ~33 uç). Sahte id
  yeter: yetki BAĞIMLILIK katmanında, id çözülmeden patlar.
- **B · Yanlış rol / bayrak yok → 403:** ADMIN-only uçlar tüm-bayraklı alt hesabı
  bile reddeder; ders/derslik/hoca/onay uçları bayraksız alt hesabı reddeder.
- **C · Bayrak var, bölüm değil:** ders yazma → 403, onaya gönderme → 403,
  ONAYLAMA → **404** (kapsam dışı taslağın varlığı onay yetkisiyle bile sızmaz).
- **D · Yabancı workgroup admini + gerçek id → 404 (IDOR / URL id değiştirme):**
  bölüm/ders/şube/hoca/derslik/bina/kullanıcı/taslak/onay — hepsi 404.
- **E · Taslak yaşam döngüsü:** öz-onay 403 (ADMIN dahil) · PENDING'e yazma 409 ·
  başkasının taslağı 404.

**Yan düzeltme.** `helpers.sub_headers` `can_approve_schedule` bayrağını bilmiyordu
(K-25 öncesi imza; k59 testleri kendi `make_account`'uyla aşmıştı). Bayrak
`sub_headers`'a eklendi (geriye-uyumlu, varsayılan False) — onay senaryoları artık
ortak yardımcıdan kurulabiliyor.

**Doğrulama.** Yeni dosya 74 test yeşil; tüm paket 604 → **678 yeşil**, regresyon
yok. Üründe görünür değişiklik yok — bu bir kanıt/sertleştirme turu.

## K-79 · Dil seçeneği (TR/EN): arayüz + sunucu mesajları + export [S+E]
Kullanıcı: sisteme Türkçe/İngilizce dil seçeneği eklensin.

**Kapsam kararı (kullanıcı).** Üç katman ölçüldü: (1) arayüz metinleri — 13,5k
satırlık frontend'e gömülü, i18n kütüphanesi yok; (2) sunucu mesajları — 107
`HTTPException detail` + motorun 22 çakışma cümlesi kurucusu; (3) kullanıcı
verisi — bölüm/ders/hoca adları. Kullanıcı **(1)+(2)** dedi; (3) kapsam DIŞI:
ders/hoca adlarının İngilizcesi DB'de yok (yalnız `Department.name_en`, resmî
sınav başlığı için) ve elle veri girişi ister. Veri Türkçe kalır, arayüz dili
değişir.

**Tercih CİHAZDA (localStorage), hesapta değil (kullanıcı kararı).** Tema
(açık/koyu) tercihiyle aynı desen — sunucu turu yok, anında geçiş, DB migration
gerekmez. Bedeli kabul edildi: aynı kullanıcı başka bilgisayarda dili tekrar
seçer. Sunucuya `Accept-Language` başlığıyla taşınır; başlık ortak API
istemcisinde TEK yerde eklenir (`request()` + `download()`), böylece export
istekleri de dili taşır.

**Sunucu hata mesajları KENARDA çevrilir — 107 raise yerine dokunulmaz.**
İki yol vardı: her `raise` yerini anahtara çevirmek (107 dokunuş; testlerde
Türkçe metne dayanan 23 iddia kırılır; büyük ve riskli diff) ya da tek bir
`HTTPException` handler'ının cevabı çıkışta TR→EN kataloğundan geçirmesi.
İkincisi seçildi: Türkçe metin KODDA KANONİK kalır, katalog tek dosyada durur,
mevcut testler varsayılan `tr` ile aynen geçer.
- Zayıf noktası: Türkçe metin anahtar olduğu için biri mesajı düzenlerse
  İngilizcesi sessizce Türkçeye düşer. **Bekçi testiyle kapatıldı** (K-78
  deseninin aynısı): koddaki her `detail=` metnini süpürüp katalogda karşılığı
  var mı diye bakan test. Katalog eksikse test kırılır.
- 16 dinamik (f-string) mesaj için katalogda desen (regex) girdileri var; sabit
  91 mesaj birebir eşleşir.

**Çakışma motoru: dil CONTEXTVAR ile taşınır — motor imzaları değişmez.**
Mesajlar motorun derininde kuruluyor: `build_result` orchestrator'da 12 yerden
çağrılıyor, `build_message` tek yerden. `lang` parametresini oraya kadar geçirmek
5 orchestrator imzası + 4 conflict_service girişi + Intern C'nin sahibi olduğu
motor sözleşmesi + 71 motor testi demekti. Bunun yerine dil, isteğe özgü AMBIENT
bir değer olarak `contextvars` ile taşınır: HTTP middleware başlıktan okuyup
bir kez set eder, `message.py` okur. Motorda tek satır imza değişmez.
- **Neden middleware, neden Depends DEĞİL:** FastAPI senkron `def` uçları ve
  senkron bağımlılıkları threadpool'da koşar; bir bağımlılıkta `set()` edilen
  contextvar o worker'ın kopyasında kalır, uca ULAŞMAZ. Async middleware'de
  set edilen değer ise threadpool'a kopyalanır (anyio context kopyası) —
  uçtan motora kadar görünür. Bu ayrım tuzaktır, bu yüzden yazıldı.
- Varsayılan `"tr"`: motor testleri (istek bağlamı olmadan) aynen çalışır.

**Nerede parametre, nerede ambient (kural).** Çağrı zinciri kısaysa AÇIK
parametre (export_service ← router: `lang` argümanı); zincir uzun ve sözleşme
başkasınınsa ambient (motor). Ambient'i "kolay" olduğu için değil, alternatifi
başkasının sözleşmesini kirlettiği için seçtik.

**Export dili takip eder (kullanıcı kararı).** Excel başlık/sütun adları seçili
dile göre üretilir. Not: resmî sınav programı başlığı `name_en`/`faculty_en`
alanlarını kullanmaya devam eder (K-09 formatı) — dil düğmesi ŞABLONU değil
ETİKETLERİ çevirir.

**Frontend mekanizması: kütüphane YOK, tipli sözlük.** İki dil için Context +
sözlük yeterli; `en` sözlüğü `typeof tr`'yi sağlamak zorunda, böylece eksik
anahtar DERLEME anında yakalanır (`tsc --noEmit` zaten doğrulama adımı).
Dil düğmesi sol raydaki tema düğmesinin yanında.

**Fazlar:** 1) mekanizma (frontend i18n iskeleti + backend katalog/middleware +
bekçi testi), 2) çakışma motoru mesajları, 3) arayüz metinleri (en büyük parça,
sayfa sayfa), 4) export başlıkları.

### K-79 tamamlanma notu (Faz 2-4)

**Faz 2 — çakışma motoru.** 22 kural + gün adları + bölüm etiketi çift dilli.
Dil `get_lang()` ile okunuyor, imzalara `lang` EKLENMEDİ. `_pick(tr, en)`
deseni: şablon sözlüğü yerine iki dil YAN YANA — eksik çeviri gözle görülür.
Bekçi testi 22 kuralın hepsi için TR ≠ EN doğruluyor; olmasa yeni bir kural
yalnız Türkçe mesajla eklenir ve `_pick` sessizce Türkçe dönerdi. Türkçe çıktı
BİREBİR korundu.

**Faz 4 — export.** Liste çıktıları (CSV + düz XLSX) tamamen çevrildi. Resmî
ızgaralar (üniversite formatındaki sınav programı + haftalık ızgara) K-09
şablonlarıdır, DOKUNULMADI — dil düğmesi kuruma giden belgeyi değiştirmemeli.
Test bu sınırı da koruyor. `lang` açık parametre (router → servis).

**Faz 3 — arayüz.** Tüm sayfalar ve bileşenler çevrildi. Yol boyunca üç kural
çıktı:
- **Kaçak ölçütü ALFABE DEĞİL KONUM.** "Türkçe harf ara" yaklaşımı `Derslik
  Ekle`, `Laboratuvar`, `Ortak`, `336 ders` gibi salt-ASCII Türkçe metinleri
  tamamen kaçırıyordu. Doğru ölçüt: UI prop'u + JSX iç metni + şablon dizesi.
- **Modül düzeyi sözlük okuyamaz** (bir kez çalışır, hook çağıramaz). Etiket
  haritaları sözlüğe taşındı; düz yardımcılar `(…, t: Dict)` parametresi aldı.
  Parametre VARSAYILANI da olmaz.
- **Renk/ikon modülde kalır, etiket sözlüğe gider** — renk dile bağlı değil.

**Çevrilmeyenler (bilinçli):** akademik unvanlar (backend CANONICAL_TITLES ile
eş tutulan VERİ), bölüm/ders/hoca adları (K-79 kapsam kararı), resmî XLSX
şablonları (K-09).

**Ek (tarih locale'i).** Faz 3'ün ilk turunda ATLANAN bir yüzey: `toLocaleString`
locale'i. Dört yerde `"tr-TR"` sabitti ve İngilizce arayüzde "15 Ağu 2026"
basıyordu. Kaçmasının sebebi öğreticidir — kaçak tarayıcısı Türkçe metin arıyor,
`"tr-TR"` ise Türkçe harf içermeyen bir KOD. Locale sözlüğe alındı (`t.locale`),
tarih yardımcıları sözlüğü parametre alıyor. **Sıralama/arama locale'i
(`localeCompare("tr")`) BİLEREK değişmedi:** veri Türkçe, sıralama verinin diline
göre doğru olmalı — arayüz dilinin sıralamayı bozması hata olurdu.

---

## K-80 · Yayın Merkezi: sadeleştirme + onaylanan programın görüntüsü

**Sorun.** K-77'de kurulan Yayın Merkezi bilgiyi gösteriyordu ama ayıklamıyordu:
adım çubuğu, her durumda duran "GÖNDEREN VE KARAR" kartı ve boş grup cümlesi yer
kaplayıp göz yoruyordu; buna karşılık incelerken gerçekten aranan iki bilgi
(hangi tür program, kim ne zaman gönderdi) sönük bir alt satırda kalıyordu. Ayrıca
"Yayında" grubunda gösterilecek bir program yoktu.

**Kaldırma ölçütü: her durumda mı duruyor, yoksa söyleyecek sözü olduğunda mı?**
Adım çubuğu durum rozetinin söylediğini üç kutuda tekrar ediyordu. Karar kartının
yarısı, kararı verilmemiş kayıtlarda "Henüz karar verilmedi" yazıyordu — yani en
sık görülen durumda hiçbir şey söylemiyordu. İkisi de kaldırıldı; sağ sütun artık
KOŞULLU: karar bizdeyse not kutusu, karar verilmişse kim/ne zaman/notu ne. Sütun
yoksa fark listesi tüm genişliği alıyor. Boş grup cümlesi de gitti (boş grup zaten
boş görünür), ama sonuçsuz ARAMA cevapsız bırakılmadı: kullanıcı bir şey yazdı.

**Onaylanan taslağın satırları artık SİLİNMİYOR.** K-59'da `apply_draft` farkı
yayına uyguladıktan sonra taslağın kopyalarını siliyordu; gerekçe "düzenlenebilir
görünen donmuş bir kopya yanıltıcı olur" idi. Kullanıcı isteği bunu tersine
çevirdi: "o taslağın onaylanmış hâlinin görüntülenmesi; o cohortta başka bir
taslak onaylandığında bu değişmeyecek". Arayüz bu kaydı bilerek SALT GÖRÜNTÜ
gösterdiği için eski gerekçe düştü.

İki mekanizma vardı — satırları korumak ya da onay anında JSON snapshot yazmak.
Satır koruma seçildi: migration yok, şema ikizi yok, ızgara mevcut tipleri aynen
alıyor. **Güvenli olmasının sebebi tek bir değişmez:** sistemde "yayında" HER
YERDE `draft_id IS NULL` demektir — kısmi UNIQUE indeksler dahil. Korunan satırlar
`draft_id` dolu olduğu için hiçbir sorgunun evrenine sızmaz. Ve görüntü sonraki
onaylardan ETKİLENMEZ: başka bir onay yayın satırlarına yazar, `draft_id` dolu
kopyalara dokunmaz. `test_k80_approved_snapshot.py` bu sınırların dördünü de
koruyor (kalıcılık, sızmama, yeni taslağın yalnız yayını kopyalaması, onaylanan
taslağın hâlâ donmuş olması).

**Onaylanan kayıtta fark ve çakışma BİLEREK gösterilmiyor.** İkisi de o anki
yayına karşı hesaplanır; donmuş bir görüntünün yanında canlı bir fark göstermek
"onaylandı ama 3 değişiklik var" gibi okunurdu. Onay anındaki fark zaten
`applied_summary`de dondurulmuştu (K-36 deseni) — gösterilen o.

**Karar notu tek alan, iki karar.** `/approve` ucu gövde alır oldu ve
`review_note`'u onayda da doldurur. Ayrı bir "onay notu" sütunu açılmadı: soru
ikisinde de aynı — kararı veren ne dedi? Durum hangisi olduğunu zaten söylüyor.
Zorunluluk ayrışıyor ama: **ret gerekçesiz anlamsızdır** (gönderen neyi
düzelteceğini bilemez), onay ise kendi başına yeterli bir cevaptır. Bu yüzden
onayda opsiyonel, rette zorunlu; gövdesiz onay da geçerli kalır. Notun yanında
NOTU YAZAN da gösteriliyor — not bir kişinin sözüdür.

**"DÖNEM" hücresi "BÖLÜM" oldu.** Yıl ve dönem başlıkta zaten yazıyordu; hücre
bilgiyi tekrar ediyordu. Bölüm kodu ise kaydı tek başına tanıtıyor ve dar kuyruk
sütununda kırpılmıyor (`DraftOut.department_code` eklendi). Kuyruk kartları da
koda geçti; **arama koda göre de çalışıyor** — görünen bir şeyin aranamaması
tutarsız olurdu.

**Reddedilende çakışma CANLI kalıyor (kullanıcı kararı).** Taslağın satırları
reddedildiği hâlde duruyor, ama çakışmalar o anki yayına karşı taranıyor: sahibi
bu taslağı düzeltip yeniden gönderecek, dolayısıyla güncel gerçeği görmesi doğru.

**Yol boyunca:** K-79'un "sıfır kaçak" iddiasında dört boşluk çıktı ("Ortak ders
— etkilenen", "Taslak silindi", "Silinemedi", "N engel giderilmeli") ve bir buton
metni. Hepsi konum ölçütüne uyuyordu, yani tarayıcı doğruydu — uygulaması eksik
kalmıştı. Kapatıldı.

### K-80 eki · görünürlük, oturum ve iki yükleme kusuru

**"Onaylananlar" grubu artık paylaşılıyor — kapsam SIFIRDAN tanımlanmadı.**
Grup yalnız kendi kayıtlarımı gösteriyordu; başka birinin onayladığı, benim
bölümümün programını değiştiren bir kayıt listede yoktu. K-59'un gizliliği
HAZIRLIK evresini korur (OPEN/PENDING/REJECTED), sonucunu değil: onaylanan
taslak yayına girmiş bir kayıttır ve yayındaki programı zaten görebilen birinin
onu kimin değiştirdiğini görememesi için sebep yok.

Kapsam sorusunun cevabı sistemde ZATEN vardı — Değişiklik Akışı
(`/schedule-changes`). Yeni bir kural icat etmek yerine o kural ortak bir
fonksiyona çıkarıldı (`approved_visibility_filter`): ADMIN workgroup'un
tamamını, alt hesap üyesi olduğu bölümleri + ortak ders üzerinden etkilenenleri,
üyeliksiz alt hesap hiçbirini. **İki yüzey aynı soruyu soruyorsa cevabın iki
sürümü olmamalı** — kopyalansaydı biri gün gelip ötekinden ayrılır ve gizlilik
sınırını kopya belirlerdi.

Okuma uçları (`/entries`, `/exams`, `GET /schedule-drafts/{id}`) genişledi;
yazma uçları ile `/diff` ve `/conflicts` sahiplik aramaya DEVAM ediyor: görme
hakkı düzenleme hakkı değildir, canlı fark da geçmiş kayıtta anlamsızdır.
Genişlemenin sınırını `test_unapproved_drafts_stay_private_even_from_admin`
koruyor.

**Sekmeler arası kimlik.** Bir sekmede admin açıkken başka sekmeden alt hesaba
geçilince ilk sekme eski listeyi göstermeye devam ediyordu. Sunucu tarafında
sızıntı YOK (token paylaşıldığı için istekler yeni kimlikle gidiyor ve 404
alıyor); kusur ekranda — ve paylaşılan bir bilgisayarda K-59'u GÖRSEL olarak
deliyor. `storage` dinleyicisi eklendi, kimlik değişiminde sayfa baştan
yükleniyor. Nokta atışı state tazelemesi seçilmedi: kimlik uygulamanın her
yerine dağılmış bir varsayımdır, tek tek tazelemek birini unutmaktır.
**Karşılaştırılan şey token DEĞİL kimlik** (`auth_uid`): keepalive token'ı 10
dakikada bir tazeliyor, token'a bakılsaydı iki açık sekme birbirini durmadan
yenilerdi.

**Mod sıçraması — düz bayrak yetmedi.** Taslak modundaki cohort'a dönünce ekran
önce yayını çizip taslağa atlıyordu. İlk düzeltme bir boolean'dı ve İŞE
YARAMADI: yükleme efekti taslak efektinden önce tanımlı, dolayısıyla cohort
değiştiği render'da bayrak hâlâ önceki cohort'tan kalma `true` oluyor. Bayrağı
cohort KİMLİĞİNE bağlamak (`modCozulen !== cohortKey`) yarışı kökten bitirdi;
istek günlüğünde doğrulandı (artık `/weekly-entries` hiç atılmıyor).

**Mantine'de `loading`, `disabled` görünümünü ezer.** "Değişiklikler"e basınca
"Onaya Gönder" bir an aktif görünüyordu: buton `loading={busy}` alıyordu ve
`busy` çubuğun ORTAK state'i. Bir butonun yüklenmesi başka bir butonu loading'e
sokmamalı — o butonun kendi async işi zaten yoktu.

**Izgara açıklaması gerçeğe uyduruldu.** `ProposedGrid` üç durum çiziyor (yeşil
eklendi, MAVİ TAŞINDI, gri değişmedi) ama açıklama ikisini anlatıyordu; mavi
rozetlerin ne demek olduğu okunamıyordu. Örnek renkler de gerçek rozetlerle
eşitlendi (filled/light).

### K-80 eki 2 · çakışma belirteci, kaldırılanlar, gönderim notu, iki kusur

**Bir kapı eklemek yarış getirdi.** Önceki turda konan "mod çözülene kadar
bekle" kapısı, Yayın Merkezi'nden "Programda düzenle" ile gelindiğinde ekranı
sonsuza dek yüklemede bırakıyordu (F5 açıyordu). Sebep: mod çözümleme efekti
bir sunucu turu içeriyor ve cohort her değiştiğinde yeniden koşuyor; URL
parametreleri `dep/year/sem`'i arka arkaya değiştirdiği için iki koşu üst üste
biniyor ve YENİSİ önce dönerse ESKİ cevabın `cozuldu`su kapıyı eski cohort'un
anahtarıyla kapatıyor. **Kural: içinde async iş olan bir efekt, cohort/kimlik
gibi bir anahtara bağlıysa `iptal` bayrağı ŞARTTIR** — kapının kendisi doğruydu,
eksiği iptal korumasıydı.

**"Programda gör" yanlış programa götürüyordu.** Yalnız cohort veriliyordu ve
K-73'ün mod hafızası ekranı o cohort'un açık taslağına düşürüyordu. Onaylanmış
bir kayıttan "Programda gör" deyip taslağa varmak doğrudan yanlış cevaptır.
Yayın yolu artık `mode=pub` taşıyor; iki ekran da bunu K-62'nin
`taslakSecimiAtla` bayrağıyla karşılıyor — yeni mekanizma icat edilmedi, aynı
soruya (bu gidişte taslağa atlama) verilmiş cevap yeniden kullanıldı.

**Çakışmalar program üzerinde işaretleniyor.** Liste zaten vardı ama "hangi
ders" sorusunu metinden okumak gerekiyordu. Motor `affected[]` içinde satır
id'sini veriyor; eşleşen rozetin sol kenarına ince dikey çizgi — hard kırmızı,
uyarı turuncu. **İki bilgi iki ayrı KANALDA:** rozetin rengi değişikliği
(yeşil/mavi), sol çubuk çakışmayı taşır. Aynı satır ikisine birden karışırsa
HARD kazanır; daha ağırı gizlenirse kullanıcı turuncuyu görüp önemsiz sanar.

**Kaldırılanlar ızgarada gösterilemez, o yüzden SAYILIR.** Tek "N değişiklik"
sayısı onları da içine katıyordu ve ızgarada karşılığı görünmediği için sayı
tutmuyormuş gibi duruyordu. Başlıkta "N kaldırılan ızgarada görünmez", listede
tür dökümü.

**Gönderim notu gösterilmiyordu.** `submit_note` K-59'dan beri kaydediliyordu
ama hiçbir ekranda okunmuyordu — onaylayıcı gönderenin gerekçesini göremiyordu.
Not artık modalın içinden çıkıp incelemenin yanına, karar notuyla simetrik bir
kutuya taşındı ve gönderildikten sonra aynı yerde okunur hâle geliyor. Modal
kaldırıldı: onaya göndermek geri alınabilir (withdraw), araya onay ekranı
koymak fazladan tıklamaydı.

**"1 değişiklik ama 3 mavi hücre" hata DEĞİL.** Bir yerleşim `slot_count` kadar
hücreye yayılır ve vurgu `start_slot`'tan okunur; 3 saatlik bir dersin taşınması
3 hücreyi birden boyar. Değişiklik sayısı yerleşimi sayar, hücreyi değil.

### K-80 eki 3 · eskimiş onay uyarısı ve tekrar temizliği

**Donmuş görüntü ile canlı yayın ayrışabilir — uyarı bunu söyler.** Onaylanan
kaydın ızgarası onay anına aittir; "Programda gör" ise güncel yayına götürür.
Arada aynı cohort için başka bir onay geçtiyse ikisi ayrışır ve kullanıcı
baktığı görüntünün hâlâ yürürlükte olduğunu sanar. Buton **engellenmiyor** —
güncel yayını görmek meşru bir istektir; uyarı yalnızca beklentiyi düzeltir.

Hesap İSTEMCİDE: "beni ilgilendiren onaylar" listesi zaten yüklü, ek bir sunucu
turu gerekmiyor ve göremediğim bir onayın uyarısını vermek de anlamsız olurdu
(kapsam dışıysa zaten benim işim değil). Karşılaştırma `kind`i içerir — sınav
onayı haftalık programı eskitmez (K-60).

**Tekrar eden açıklamalar kaldırıldı.** "ONAYLANAN PROGRAM / Onay anındaki hâli
— sonraki değişiklikler yansımaz" başlığı, kaydın onaylandığını durum rozetinin
ve karar kartının yanında ÜÇÜNCÜ kez söylüyordu; öteki görünümlerle aynı
"PROGRAM GÖRÜNTÜSÜ" başlığına indi. Not kutularının altındaki "X yazdı" satırı
da aynı sebeple gitti: kim olduğu hemen üstteki kartta yazılı.

**Kural olarak:** bir bilgi ekranda ikinci kez görünüyorsa, ikinci görünüm
kendini savunmak zorundadır — farklı bir soruyu cevaplamıyorsa gürültüdür.

### K-80 eki 4 · "Programda gör" yarışının kalıcı çözümü

Önceki turda `mode=pub` niyetini tek seferlik `taslakSecimiAtla` ref'iyle
taşımıştım; o cohort'ta KAYITLI taslak tercihi varken ekran yine taslağa
düşüyordu. Sebep aynı sınıf yarış: `setDep/setYear/setSem` peş peşe render
üretiyor, taslak-seçim efekti birden çok kez koşuyor, ref ilk koşuda tükenince
ikincisi `readScheduleMode`'dan taslak id'sini okuyup taslağı seçiyor.

**Kural: geçici niyeti ref ile taşımak, o niyeti okuyan efekt birden çok kez
koşabiliyorsa güvenilmezdir.** Ya niyeti KALICI kıl (idempotent), ya da efektin
son koşusuna kadar canlı tut. Burada kalıcı seçildi: `writeScheduleMode(...,
"pub")` K-73'ün tercihine yazıyor; efekt kaç kez koşarsa koşsun `readScheduleMode`
"pub" döndürüyor. Yan fayda: davranış doğru — kullanıcı yayını istedi, tercih
yayın oldu; taslağına "Taslağa Dön" ile döner (o da tercihi taslağa yazar).

### K-80 eki 5 · Çakışma Raporu ortak kabuğa taşındı

**Sekme yanlış araçtı.** HARD ve WARNING iki ayrı sekmeydi; sekme "ya o ya bu"
der, oysa şiddet bir SÜZGEÇ boyutudur ve "hepsini birden gör" en doğal istektir
— sekmede o seçenek yoktu. Segment (Tümü / Engel / Uyarı) hem seçenekleri hem
sayıları aynı anda gösteriyor.

**Süzgeç boyutları tamamlandı:** şiddet · cohort (bölüm + sınıf + dönem) · tür ·
kural. Dönem için backend'e dokunuldu: `affected` ref'i cohort'un yalnız iki
boyutunu taşıyordu, `semester` motor dict'inde ZATEN vardı ama dışarı
verilmiyordu.

**Seçenekler VERİDEN türetilir.** Yalnız gerçekten çakışması olan sınıf/dönem/
kural listelenir. Boş bir seçeneği seçtirip "sonuç yok" göstermek, kullanıcıyı
kendi verisi hakkında yanıltır — seçenek varsa sonuç da vardır.

**Kart yığını → tek liste.** Satır biçimi Yayın Merkezi'nin değişiklik
listesiyle aynı; 16 çakışma artık tek ekrana sığıyor. Sıralama HARD ÖNCE
(yayını engelleyen iş önce görülmeli), sonra kural koduna göre — aynı kuralın
vuruşları yan yana düşer ve çoğu zaman toplu çözülürler.

**Aynı işaret her ekranda aynı anlama gelir.** Satırın sol kenar çubuğu,
ızgaradaki çakışma belirtecinin dilini kullanır: kırmızı engel, turuncu uyarı.

**Boş durum ikiye ayrıldı:** gerçekten çakışma yok (iyi haber) ile süzgeç
sonuçsuz kaldı (ölçüt dar). İkisi aynı cümleyle geçiştirilemez.

**Test notu:** `affected` şeklini iki test birden kilitliyordu — biri motoru
monkeypatch'leyen sözleşme testi, öteki motorun kendi çıktısı. Monkeypatch'li
olan sabit bir sözlük döndürdüğü için alanın gerçekten taşınıp taşınmadığını
göremezdi; gerçek `_affected_ref` üzerinden koşan üçüncü bir test eklendi.

### K-80 eki 6 · Çakışma Raporu tablo oldu

**Liste → tablo.** Her çakışmanın aynı beş sorusu var: hangi tür, hangi kural,
ne oldu, hangi cohort'ta ve ne zaman, hangi öğeler. Sütun başlığı bu soruları
BİR KEZ sorar; liste biçiminde her satır kendi düzenini yeniden anlatıyordu.

**Cohort ve zaman alt alta, ve TEKİLLEŞTİRİLMİŞ.** Bir çakışma iki tarafı da
taşıyabiliyor (W1/W2 bölümler arası) ve yan yana dizilince hangi zamanın hangi
cohort'a ait olduğu karışıyor. Öte yandan iki taraf çoğu zaman aynı cohort ve
aynı saatte oluyor — kural zaten "aynı anda" diyor — o yüzden aynı satır iki
kez yazılmıyor.

**Zaman için backend'e alan eklendi.** Yerleşim zamanı mesajın METNİNDE zaten
geçiyordu ama sütuna çıkarmak metin ayrıştırmak demekti. Motor dict'i alanları
zaten tutuyor; ham veriyi vermek hem ucuz hem sağlam. **Biçimlendirme
istemcide:** gün adları dile bağlı (K-79) ve sunucunun metin üretmesi o metni
tek dile çivilerdi.

**Tarih/saat ISO STRING olarak çıkıyor, ham `date`/`time` DEĞİL.** İlk denemede
tam buradan kırıldı ve kırılma beklenmedik bir yerde patladı: `affected` yapısı
Pydantic'ten geçmeyen bir yoldan da dışarı çıkıyor — onaya gönderme 409'u
çakışmaları ham `JSONResponse` ile veriyor ve orada `json.dumps` bir `date`
görünce TypeError atıyor. **Ders: bir çıktı yapısı birden fazla yoldan
dışarı çıkıyorsa, en dar yolun kısıtına göre tasarlanmalı.** Ayrıca bekçi test
eklendi (ref ham `json.dumps`'tan geçebilmeli).

**Süzgeçler "Filtrele" popover'ında** (Dersler/Derslikler deseni); yan yana beş
açılır kutu çoğu zaman kullanılmadan yer kaplıyordu. **Şiddet segmenti hariç:**
o birincil boyut, durumu zaten görünür ve "Tümü"ye dönmek tek tık — bu yüzden
açık süzgeç sayacına da girmiyor, yoksa segmentten birini seçmek ekrana ilgisiz
bir "temizle" butonu düşürüyordu.

### K-80 eki 7 · Kural kataloğu ve sütunların anlamı

**Sütun adı ile içeriği eşleşmeliydi.** "Tür" sütunu haftalık/sınav ayrımını
gösteriyordu, oysa kullanıcının o başlıktan beklediği ŞİDDET'ti (engel/uyarı).
Haftalık-sınav ayrımı zaten kural kodundan (W/E/X) ve öğe rozetlerinin
renginden okunuyor — ayrı bir sütun istemiyor.

**Mesaj yerine kural ADI.** Motorun ürettiği mesaj hangi derslerin, hangi
saatte çakıştığını yazıyordu; ikisi de artık kendi sütununda duruyor,
dolayısıyla mesaj üçüncü kez aynı şeyi söylüyordu. Sütunda artık kuralın
okunur adı var ("Cohort — seçmeli ders çakışması"). **Tam mesaj ipucunda
korunuyor:** kapasite sayısı gibi mesaja özgü ayrıntı kaybolmasın — bilgiyi
silmek değil, öne çıkanı değiştirmek istiyorduk.

**Kural kataloğu ("?" pop-up'ı).** Tabloda kod görünüyor ama kodun ne demek
olduğunu öğrenmenin yolu dokümana gitmekti. 22 kuralın tamamı tek pop-up'ta:
kod · ad · bir cümlelik koşul, `docs/cakisma_kural_seti_1.md`den türetilmiş.
**Sıra motorun kod sırası değil KOLLARIN sırası** (W → E → X): kullanıcı bir
kuralı ararken hangi ekranla ilgili olduğunu bilir, kodun sayısını değil.
Açıklamalar bilerek tek cümle — 22 satırlık bir listede iki cümlelik
açıklamalar okunmaz.

**"Cohort / zaman" → "Etkilenen cohort", ve soluk değil.** Cohort, listeyi
tararken en çok bakılan yer ("bu beni ilgilendiriyor mu"); `dimmed` olması onu
ikincil gösteriyordu.

## K-81 · Çakışma Raporu: renk, sütun, sessizlik ve terimler [E]

**Kural kodu da ŞİDDETİ söylüyor.** "Tür" sütunu engel/uyarıyı zaten yazıyordu
ama kural kodu gri bir rozetti; kural KATALOĞUNDA ise şiddet hiç yoktu — 22
satırlık listede "hangileri yayını durdurur" sorusunun cevabı ancak açıklama
cümlelerini tek tek okuyarak çıkıyordu, oysa liste tam da göz gezdirmek için
var. Artık kod rozeti kırmızı (engel) / turuncu (uyarı): ızgaradaki çakışma
belirteci ve satırın sol kenar çubuğuyla AYNI dil (K-80).

**Sıra ve şiddet tek listede** (`RULE_CATALOG`). Ayrı bir şiddet haritası
olsaydı ikisi zamanla ayrışırdı — kural eklenir, birine yazılır ötekine
unutulur. Yan yana durunca eksik alan derleme hatası oluyor.

**"Etkilenen cohort" → "Cohort"; sütun 230 → 300px; yazı 12/normal →
12.5/500.** "Etkilenen" hiçbir ayrım yapmıyordu (tabloda etkilenmeyen cohort
zaten yazmaz) ama başlığı içerikten uzun tutuyordu. Asıl kusur sarmaydı:
"CENG · 3. Sınıf · Bahar · Per 09:30 - 12:15" 230px'e sığmayıp saati alt satıra
atıyor, tek bir bilgiyi ikiye bölüp satır yüksekliğini de düzensizleştiriyordu.
Genişlik tahmin değil — parçaların hepsi sınırlı (bölüm KODU, "N. Sınıf",
dönem, gün+saat), o yüzden `nowrap` güvenli. `minWidth` 880 → 950: bu sayı
sütun toplamıyla tutarlı kalmazsa dar ekranda kaydırma yerine sıkışma olur ve
tam da kapattığımız sarma geri gelir.

**Sonuçsuz filtre artık SESSİZ.** "Bu süzgece uyan çakışma yok" cümlesi,
üstteki segmentte "Engel (0)" yazarken aynı şeyi ikinci kez söylüyordu; sayacı
okuyan zaten biliyor, okumayana da cümle bir şey öğretmiyor. Boş çerçevenin
içine boş metin koymaktansa çerçeveyi hiç çizmemek dürüst — ekranda filtre
çubuğu ve sayaçlar kalıyor. **Gerçekten çakışma yok** hali korunuyor: o bir
haber (hem de iyi haber), söylenmeli. K-80'in "iki boşluk iki anlam" ayrımı
duruyor; değişen, ikinci boşluğun cümleye ihtiyacı olmadığının görülmesi.

**Terim temizliği — arayüzün tek kelimesi olmalı.**
- *süzgeç → filtre*: buton "Filtrele" derken temizleme "Süzgeci temizle"
  diyordu; aynı şeyin iki adı, kullanıcıya iki ayrı şeymiş gibi geliyor.
- *hoca → öğretim üyesi* (W2, E3, X3): menü, Öğretim Üyeleri sayfası ve W2'nin
  kendi açıklaması zaten resmî terimi kullanıyordu; yalnız kural ADI konuşma
  dilinde kalmıştı. Motorun ürettiği W2 mesajı da düzeltildi (ipuçunda görünür).
- *mükerrer → yinelenen* (W5, E2): Osmanlıca terim, kuralın ne dediğini
  anlatmak yerine önce kendini açıklatıyordu.
Adlar `docs/cakisma_kural_seti_1.md` tablolarında da güncellendi — arayüz ile
spec ayrışırsa katalog güvenilmez olur.

**Açık soru — W4'ün şiddeti [S bekliyor].** W4 bugün "en az biri seçmeli" olan
her cohort çakışmasını tek kovaya koyuyor (K-05). Oysa içinde iki farklı durum
var: *zorunlu × seçmeli*'de cohort'un TAMAMI zorunlu derste olmak zorundadır,
yani seçmeliye kimse gidemez — seçmeli fiilen kapanır; *seçmeli × seçmeli*'de
ise öğrenci birini seçer, bu normaldir ve seçmeli havuzlarında bilerek yapılır.
İkisi aynı uyarıyı üretiyor. Ayrıştırmak (W4a HARD / W4b WARNING) K-05'i
değiştirmek demektir; hoca kararı olduğu için koda dokunulmadı.

### K-81 eki · "Açıklama" sütunu — K-80'in mesaj kararının revizyonu [S]

K-80 motorun ürettiği tam mesajı tablodan çıkarıp satır ipucuna (tooltip)
almıştı; gerekçe, mesajın ders adlarını ve saati (kendi sütunlarında zaten
duran şeyleri) tekrar etmesiydi. **Hoca kararı [S]: mesaj görünür bir sütun
olarak geri gelsin.** Gerekçe: ipucu keşfedilebilir değil — kullanıcı üstüne
gelmeden orada bilgi olduğunu bilmiyor, dokunmatikte hover hiç yok.

Redundansı yok saymadık, ONA GÖRE STİLLEDİK: "Çakışma" sütunu kuralın ADINI
koyu/birincil verir ("ne tür sorun"), yeni "Açıklama" sütunu tam cümleyi
soluk/ikincil verir ("tam olarak ne oldu" — kapasite sayısı gibi yalnız mesajda
olan ayrıntı da burada). Tooltip kaldırıldı: aynı metni hem hover hem sütunla
vermek, üstelik "cursor: help"le hangi hücrede ipucu var diye yanıltarak,
gereksizdi.

Yerleşim: Çakışma sabit 210px'e alındı (Açıklama esnesin, cümle sarabildiği
kadar geniş yer alsın), `minWidth` 950 → 1180 (Tür 92 + Kural 104 + Çakışma 210
+ Cohort 300 + Öğeler 170 = 876, Açıklama'ya en az ~300).

**W4 ayrılmadı [S]:** K-81'in "açık soru"su (W4a HARD / W4b WARNING) hoca
tarafından kapatıldı — W4 tek kova, WARNING olarak kalıyor. K-05 değişmedi.

### K-81 eki 2 · Şiddet rengi, kalan "hoca"lar, Bölümler panel yüksekliği

**Engel ile uyarı ayırt edilemiyordu — sorun TON değil VARYANT'tı.** İkisi de
`variant="light"` idi; karanlık temada bu varyantın yazı rengi
`--mantine-color-red-light-color` = **#ffa8a8 (pembe)** ve
`orange-light-color` = **#ffc078 (şeftali)**. İkisi de aynı açıklıkta pastel,
yan yana gelince ayrılmıyorlar. "Daha koyu kırmızı" çözüm değildi: pastelin
yanındaki koyu kırmızı bu kez okunmazdı. Engel artık **DOLGU** (beyaz yazı,
kırmızı zemin), uyarı açık ton — fark ton farkı değil **biçim** farkı, renk
körlüğünde ve gri baskıda da ayrılıyor. Engelin daha yüksek sesle konuşması
semantik olarak da doğru: o, yayını durduran şey. Kural KODU rozeti çerçeveli
kaldı (Tür rozetiyle tekrar etmesin) ama doygun tondan (`red.5`/`orange.4`);
satırın sol kenarı da red-6 → red-7.

**Kalan iki "hoca" temizlendi.** K-81'de W2 düzeltilmişti ama motor mesajlarında
iki yer kalmıştı: E3 "Sınav hoca çakışması" → **"Sınav sorumlusu çakışması …
aynı öğretim üyesine sahip"**, X3 "Sınav-ders hoca uyarısı" → **"Sınav-ders
sorumlu uyarısı"**. Kural ADLARI zaten "sorumlu" diyordu; mesajlar adla
çelişiyordu. `test_overlap.py`'daki iki bekçi de yeni metne göre güncellendi —
metni değiştirip testi görmezden gelmek, bekçiyi işe yaramaz hale getirirdi.

*Not:* "öğretim görevlisi" değil "öğretim üyesi" kullanıldı — ikisi FARKLI
akademik unvan, ve arayüzün geri kalanı (menü, Öğretim Üyeleri sayfası, W2)
"öğretim üyesi" diyor. İki terimi karıştırmak, tek terime indirme amacını
bozardı.

**Bölümler sayfası: sol listenin altındaki ölü alan.** Liste
`mah="calc(100vh - 220px)"` ile sınırlıydı; 220 bir TAHMİNDİ ve yanlıştı —
liste gerçekte y=106'da başlıyor, yani kutu 114px fazla kısıtlanıyordu. Ekranda
iki kusur olarak görünüyordu: altta ~98px boşluk ve son bölümlerin gereksiz
kaydırma istemesi (son kart yarım kırpılmış boş bir kutu gibi duruyordu).
**Çözüm sabiti düzeltmek değil** (aynı tahmin, farklı sayı): panel `md`
üstünde yapışkan ve tam ekran yüksekliğinde, liste içinde `flex:1` ile artan
yeri kaplıyor — başlık/arama kutusu değişse bile hesap kendiliğinden doğru
kalıyor. Ölçüldü: alttaki boşluk 98px → 0, liste yüksekliği 528 → 626.
`min-height:0` şart, yoksa flex çocuğu içeriğinden küçülmez ve kaydırma
kutunun dışına taşar. Yan fayda: sağ panel uzunken liste görünürde kalıyor.

### K-81 eki 3 · Sınav derin-bağı, draft_id, hiza ve rozet dili

**Çakışma Raporu'ndaki sınav butonları çalışmıyordu — YARIŞ.** `/exams?highlight=`
efektinin ilk koşusu `courses` henüz BOŞKEN oluyordu; `fullCourse` bulunamadığı
için bölüm/sınıf/dönem ayarlanmıyor, ama `setWeek` yine de çalışıyor ve efektin
sonundaki `setSearchParams({})` highlight parametresini siliyordu. `courses`
yüklenince efekt tekrar koşuyor fakat bu kez `highlightIds` boş → erken dönüş.
Bildirilen kusur tam bu: **hafta doğru gidiyor, cohort seçili olanda kalıyor.**
Koruma (`!courses.length`) WeeklyPage'de vardı, ExamsPage'e yazılmamıştı —
haftalık butonlarının çalışıp sınav butonlarının çalışmamasının sebebi buydu.
*Ders:* iki ekran aynı deseni paylaşıyorsa koruma da paylaşılmalı; biri
düzeltilip öteki unutulduğunda kusur "bazen çalışıyor" diye görünür.

**`draft_id` gönderiliyor ama okunmuyordu.** Yayın Merkezi "Programda düzenle"
`?draft_id=<id>` ekliyor; her iki program ekranı da parametreyi okumadan
siliyor ve hangi taslağın açılacağını "bu cohortun İLK açık taslağı" tahmini
belirliyordu. Aynı cohortta iki taslak varsa yanlışı açılır. Artık URL'nin
istediği taslak açıkça seçiliyor ve K-73'ün hatırlanan tercihinin ÜSTÜNDE:
kullanıcı hangi taslağı düzenlemek istediğini bir tık önce söyledi.
Sınava özgü ikinci yarısı: takvim bir HAFTA gösteriyor ve o hafta
localStorage'dan geliyor; taslağın sınavları başka haftadaysa ekran boş
görünüyor ve akış "bozuk" diye okunuyordu. Taslakla gelindiğinde ilk sınavın
haftasına atlanıyor (bayrak tek seferlik — kullanıcı sonra hafta gezerse
yeniden yükleme onu geri sürüklemesin).

**Cohort ile "Çakışan öğeler" HİZALANDI.** Cohort satırları tekilleştiriliyor
("iki taraf aynı cohort ve saatteyse tekrar bilgi katmaz"), öğeler ise yan yana
diziliyordu. Sonuç: iki öğe, tek cohort satırı — hangi öğenin hangi cohort'a
ait olduğu okunamıyordu. Artık iki sütun da `affected`i AYNI SIRAYLA, öğe
başına bir satır yazıyor. **Tekrar eden cohort'lar da yazılıyor** — burada
tekrar gürültü değil, hizanın kendisi. Sabit satır yüksekliği şart: solda
12.5px metin, sağda compact-xs düğme var; doğal yükseklikleri farklı olduğu
için eşitlenmezse listeler birkaç öğeden sonra kayıyor.

**Kural rozeti de dolgulu.** Çerçeveli hâli aynı satırda iki farklı ağırlık
üretiyordu; Tür ve Kural rozetleri aynı şeyi (şiddeti) söylediğine göre aynı
biçimde söylemeleri doğru.

**Kural kataloğu hover'la da açılıyor.** Yalnız tıkla açılıyordu ve "?" ikonunun
tıklanabilir olduğu belli değildi. `HoverCard` DEĞİL kontrollü `Popover`:
katalog 22 satır ve kaydırılabilir, fare listeye inerken hedeften çıkıp
kapatabilirdi. Hover açar, **tık sabitler**, sabitken hover'dan çıkmak
kapatmaz; açılır kutu da hover'ı canlı tutuyor (aradaki boşlukta kapanmasın).

**Haftalıktaki kapsam ipucu kaldırıldı.** "Taslağınızın satırlarına dokunan
çakışmalar…" cümlesi K-62'de kapsam sorusuna cevaptı; artık her satır etkilenen
dersi ve cohort'unu kendisi yazdığı için sabit bir başlık gürültüsü olmuştu.

### K-81 eki 4 · Rozet geri alma, taslak butonu yanıp sönmesi, sınav ızgara adımı

**Kural rozeti ÇERÇEVELİYE döndü.** Bir tur dolgulu denendi (Tür rozetiyle aynı
biçim) ama aynı satırda iki dolu kırmızı blok fazla ağır durdu: satırda ilk
bakışta okunması gereken şey ŞİDDET, kural kodu ikincil. Çerçeve rengi taşıyıp
ağırlığı taşımıyor — istenen tam bu ayrım.

**"Taslak Aç" butonu bir an yanlış görünüyordu.** `mevcut` ("bu cohortta açık
taslağım var mı?") başlangıçta `null` ve sunucu turu bitene kadar null kalıyor;
buton ise null'ı "taslak yok" diye okuyup FİLLED **"Taslak Aç"** çiziyordu.
Yani cevap gelene dek ekranda yanlış ve TIKLANABİLİR bir buton duruyordu:
"Yayına Dön" dedikten hemen sonra hızlı tıklayan kullanıcı yeni taslak
yaratmayı deniyor ve sunucudan "bu cohort için zaten açık taslağınız var (#22)"
hatasını alıyordu. Hata doğruydu; kullanıcı o duruma hiç düşmemeliydi.
Üç seçenek vardı: (a) `loading` — etiket yine yanlış kalır, (b) etiketi son
bilinen değerde tutmak — cohort değişince o da yanlış, (c) cevap gelene kadar
**hiç çizmemek**. (c) seçildi: bilinmeyen bir durumun doğru görseli boşluktur.
`finally` şart — istek hata verse de kapı açılmalı, yoksa buton sonsuza dek
görünmez kalır.

**Sınav ızgarasının adımı 30 → 60 dakika.** Ekranda bir saat TEK hücre olarak
çiziliyor ama yerleştirme 30 dakikaya yuvarlıyordu; hücrenin alt yarısına
tıklamak o hücrenin yarısını seçiyor, üstelik hover işareti de yarım
yükseklikte çiziliyordu. Görülen kutu ile seçilen aralık uyuşmuyordu. Artık
adım hücrenin kendisi kadar: tıklanan hücre neyse o seçilir. Buçuklu saat hâlâ
mümkün — sınav formundaki saat alanından elle yazılır.

**Vitrin `--undo`'su taslakları da siliyor.** `schedule_drafts.department_id ->
departments.id` yabancı anahtarı var; kullanıcı ZZ cohort'unda "Taslak Aç"
derse temizlik IntegrityError ile kırılıyordu — yani tam da vitrin
KULLANILDIKTAN sonra. Gerçek durumda denendi: 12 ders, 14 sınav, 1 taslak
silindi, sayımlar başlangıca döndü.
