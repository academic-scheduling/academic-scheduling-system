# Güncel Yol Haritası — Intern A ve Intern C

**Tarih:** 15 Temmuz 2026 (Hafta 3 ortası) · **Yazan:** Intern A
**Amaç:** is_bolumu.md'deki plandan bağımsız, reponun BUGÜNKÜ gerçek durumuna göre
kalan işlerin sırası.

## Bugünkü durum fotoğrafı

**Backend'de VAR:** auth + JWT, davet akışı, bölüm/hoca/bina/derslik/ders+şube CRUD,
workgroup izolasyonu, audit log, sınav API'si (wp4 — PR aşamasında, motor stub'lı).
**Motor tarafında VAR:** kesişim matematiği + W/E/X kurallarının v1.2 iskeleti + 71 test
(wp5-overlap-core — PR aşamasında; v1.4 uyumu için düzeltme listesi:
docs/wp5_overlap_core_inceleme.md).

**Henüz YOK:** haftalık program endpoint'leri (kontrat §7 — tamamı), motorun API'ye
bağlanması, GET /conflicts (§9), dashboard (§10), export (§11), seed script,
yetki sertleştirme testleri, deployment hazırlığı.

---

## Intern A — sıradaki işler (backend)

### A-1. wp4-exam-api PR + merge (bugün)
Zincirin ilk dominosu: K-22 dikişi ve kontrat değişikliği main'e girmeden
entegrasyon işleri başlayamaz.

### A-2. Haftalık program API'si — kontrat §7 (bugün/yarın başla, ~2 gün)
Backend'in en büyük eksiği; hem B'nin grid'i hem C'nin W kuralları buna muhtaç:
- `GET /weekly-entries` (5 filtre) · `POST` (DRAFT kayıt + conflicts alanı)
- `PATCH /weekly-entries/{id}` (yalnız DRAFT) · `DELETE` (yalnız DRAFT)
- `POST /weekly-entries/submit` (hep-veya-hiç) · `POST .../{id}/revert-to-draft`
- Motor çağrıları wp4'teki desenle `conflict_service.py` dikişinden (stub'la başlar,
  W8'in yalnız submit'te üretileceği unutulmamalı — K-20)
- Test paketi wp4 şablonuyla: yetki, izolasyon, yaşam döngüsü, kablolama monkeypatch'i

### A-3. Motor entegrasyonu — C ile ortak (C'nin revizyonu bitince, ~1 gün)
`conflict_service.py` stub'ının gerçek motorla doldurulması:
- ORM → motor dict adaptörü (sınav + haftalık); `rooms` listesine `exam_capacity`
  beslenmesi (capacity DEĞİL)
- `check_exam_vs_course` bayrağının workgroup'tan okunup motora geçirilmesi
- wp4/wp3 testlerindeki monkeypatch senaryolarının gerçek motorla yeşil kalması

### A-4. GET /conflicts + GET /dashboard/summary — kontrat §9-10 (~1 gün)
- Tam tarama: C'nin orkestratörünü çağırır; ADMIN tüm workgroup, alt hesap yalnız
  atanmış bölümleri (K-04)
- Dashboard sayaçları + unresolved_hard/warnings (B'nin iki sayfasının veri kaynağı)

### A-5. Yetki sertleştirme + izinsiz erişim testleri (Hafta 4 başı)
Brief §6.3/§10.2 şartı: her endpoint'te server-side yetki denetiminin sistematik
testi — rol matrisi × endpoint tablosu, URL id değiştirme saldırı senaryoları,
SUBMITTED kayıtlara yazma denemeleri.

### A-6. Deployment hazırlığı (Hafta 3 SONUNDA başlamalı — brief risk maddesi)
Docker Compose ile tek komut ayağa kalkış, env değişkenleri belgesi, README kurulum
adımları. Brief'in uyarısı açık: son güne bırakılan deployment, demo'yu riske atar.

---

## Intern C — sıradaki işler (motor + QA)

### C-1. wp5-overlap-core PR + merge (bugün; iki tek-satırlık temizlikle)
Ölü import ve .vscode dosyası çıkarılıp PR açılır. Motor henüz çağrılmadığından
bu haliyle merge güvenli; düzeltmeler sonraki branch'te.

### C-2. Motor v1.4 revizyonu (~2 gün — ayrıntılar inceleme belgesinde)
docs/wp5_overlap_core_inceleme.md §2'deki yedi başlık: kontrat çıktısı + orkestratör,
şube modeli, asenkron ön-eleme, E5/E5a/E7, K-13, X bayrağı, W8. Bu iş bitmeden
entegrasyon (A-3) başlayamaz — zincirin kritik halkası.

### C-3. Seed script — docs/seed_data_plani.md (~1 gün, C-2 ile paralel yapılabilir)
Gerçekçi demo verisi: bölümler, hocalar, derslikler, dersler+şubeler, haftalık
girişler, sınavlar, BİLEREK eklenmiş çakışma senaryoları. Demo ve B'nin UI testleri
bu veriye muhtaç; A'nın tüm modelleri hazır, bekleyen bir şey yok.

### C-4. Entegrasyon — A ile ortak (A-3'ün aynısı, ~1 gün)
Motor tarafından: orkestratörün imzasının sabitlenmesi, adaptör testlerinde A'ya destek,
uçtan uca senaryoların (kural seti test şablonundaki senaryolar) API üzerinden koşulması.

### C-5. Excel export — kontrat §11 (Hafta 4 başı, ~1,5 gün)
openpyxl ile XLSX: haftalık program + sınav takvimi. Format şablonu için hoca
görüşmesi gerekiyor (K-09'da ertelenmişti — randevuyu şimdiden istemek akıllıca).
E7 eşiğinin hoca onayı da aynı görüşmede kapatılabilir (açık konu 5).

### C-6. Demo senaryoları + test kapsamı (Hafta 4)
Brief §10.3'teki 6 senaryonun provası; çakışma tespitini "kanıtlayan" gösterim
akışının yazılması; eksik test sınıflarının tamamlanması.

---

## Bağımlılık haritası (kim kimi bekler)

- **Beklemesiz başlar:** A-2 (weekly API) ve C-2 (motor revizyonu) ve C-3 (seed) — paralel
- A-3/C-4 (entegrasyon) → A-1 merge + C-2 bitmiş olmalı
- A-4 (conflicts/dashboard) → entegrasyon bitmiş olmalı (orkestratör gerekli)
- C-5 (export) → yalnız hoca format görüşmesini bekler
- B'nin çakışma raporu/dashboard sayfaları → A-4'ü bekler (o güne dek kontrat mock'u)

## Kaba takvim

| Gün | Intern A | Intern C |
|---|---|---|
| 15-16 Tem (Çar-Per) | wp4 merge + weekly API | wp5 merge + motor revizyonu (+ seed) |
| 17 Tem (Cum) | weekly API bitiş + testler | motor revizyonu bitiş |
| 20-21 Tem (Pzt-Sal) | entegrasyon (ortak) → conflicts + dashboard | entegrasyon (ortak) → export başlangıç |
| 22-24 Tem (Çar-Cum) | yetki sertleştirme + deployment | export bitiş + demo senaryoları |

Hafta 4'ün son iki günü bilinçli boş: brief'in "hardening + prova" payı.
