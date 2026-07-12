# Proje Karar Defteri (Decision Log)

**Proje:** Akademik Ders Programı ve Sınav Çakışma Yönetim Sistemi
**Son güncelleme:** 7 Temmuz 2026
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

## Açık / Ertelenen Konular
1. Online derslerin derslik ve cohort davranışı (K-10)
2. XLSX/PDF ayrıntılı format şablonu (K-09) — Hafta 3
3. `expected_students` zorunlu mu opsiyonel mi — ekip önerisi zorunlu, onay bekliyor (K-07)
4. Lecturer import'unun kaynağı olan fakülte sayfasının URL'i ve veri yapısı (K-08)

## K-12 · Sınav/çapraz kural severity'leri [E]
Kural setindeki üç açık severity kararı onaylandı:
- **E3** (sınav hoca/sorumlu çakışması) → **HARD** (haftalık W2 ile tutarlı; hoca aynı anda iki sınavda olamaz).
- **E4** (cohort sınav çakışması) → K-05 mantığı sınavlara da uygulanır: zorunlu×zorunlu = **HARD**, seçmeli dahil = **WARNING**.
- **X2 / X3** (sınav×ders cohort ve hoca çakışması) → **WARNING** (vize haftasında ders fiilen yapılmayabilir; engellemek aşırı katı olur). X1 (derslik) HARD kalır.

## K-13 · Sınav×ders (X kuralları) aynı ders istisnası [E]
X1/X2/X3 çapraz kuralları çalışırken, sınavın dersi ile haftalık ders girişinin
dersi **aynıysa** (`exam.course_id == weekly_entry.course_id`) o karşılaştırma
**atlanır** — çakışma üretmez.
**Gerekçe:** Bir dersin sınavı, o dersin normal haftalık yerinde/saatinde/hocasıyla
yapıldığında oda, cohort ve hoca "çakışması" görünür ama gerçek değildir: çakışan
iki nesne aynı derse aittir, öğrenciler zaten o saatte o dersteydi. İstisna olmazsa
"dersin sınavını kendi yerinde yapmak" gibi tamamen normal bir durum yanlışlıkla
3 uyarı birden üretir. Gerçek çakışma ancak sınav BAŞKA bir dersin
oda/cohort/hoca alanına girdiğinde doğar.
