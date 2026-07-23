# Proje Karar Defteri (Decision Log)

**Proje:** Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
**Son güncelleme:** 23 Temmuz 2026 (K-37: davet akışı loglanır — INVITE/ACTIVATE)
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

## Açık / Ertelenen Konular
1. ~~Online derslerin derslik ve cohort davranışı (K-10)~~ → K-19 ile kapandı
2. XLSX/PDF ayrıntılı format şablonu (K-09) — Hafta 3
3. `expected_students` zorunlu mu opsiyonel mi — ekip önerisi zorunlu, onay bekliyor (K-07)
4. Lecturer import'unun kaynağı olan fakülte sayfasının URL'i ve veri yapısı (K-08)
5. E7 israf uyarısının eşiği ("bir derslik çıkarılsa hâlâ yetiyor" kriteri) —
   ekip önerisi kural setinde, hoca onayı beklenebilir (K-17)
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