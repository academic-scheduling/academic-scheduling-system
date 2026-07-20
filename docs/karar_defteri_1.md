# Proje Karar Defteri (Decision Log)

**Proje:** Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
**Son güncelleme:** 17 Temmuz 2026 (K-25/K-26: yetenek matrisi + bölüm görünürlüğü)
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