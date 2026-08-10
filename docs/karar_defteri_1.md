# Proje Karar Defteri (Decision Log)

**Proje:** Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
**Son güncelleme:** 5 Ağustos 2026 (Not: W6/E2/E6 DB şemasıyla engelli · K-58: hızlı işlemler yetkiye göre kilitli)
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
- **Sınavlar.** K-16 gereği sınav ders düzeyindedir, cohort'a bağlanmaz; ortak
  dersin sınavı birçok cohort'a aittir. "Cohort taslağı" kavramı sınavda
  karşılıksız — sınav fazının taslak birimi ayrıca kararlaştırılacak
  (muhtemelen bölüm + sınav dönemi).
- **Bildirim merkezi.** Kişi başına okundu/okunmadı durumu + zil ikonu; uygulama
  içi akışın üstüne sonradan eklenebilir.
- **Cohort dışı düzenleme.** Taslaklar yalnız cohort modunda olduğu için derslik/
  hoca merceğinden düzenleme kalkar (mercekler görüntüleme olarak kalır). "Şu
  derslik tadilata girdi, boşalt" işi cohort cohort dolaşmayı gerektirir —
  bilerek kabul edildi.
- **Export.** "Resmî program" kavramı ancak bu fazla anlam kazanıyor; export'un
  varsayılan olarak yalnız yayını basması ayrıca ele alınacak.
