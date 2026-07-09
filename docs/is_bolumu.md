# Ekip İş Bölümü ve Branch Planı

**Ekip:** 3 stajyer · **Süre:** kalan 3 hafta · **Kaynak:** proje dokümanı §7-8 + karar defteri
**Kural:** Branch, işe başlanacağı gün `main`'in güncel halinden açılır — önceden toplu açılmaz.
İsimlendirme: `feature/<wp>-<kısa-ad>` · Branch 2 günden uzun yaşamaz · Merge = PR + 1 onay.

---

## Roller (doküman §8 uyarlaması)

| Kim | Rol | Sorumluluk alanı | Sahip olduğu WP'ler |
|---|---|---|---|
| **Intern A** | Backend/Auth Lideri | API, auth, davet akışı, veritabanı modelleri/migration, yetkilendirme, workgroup izolasyonu | WP1 (tam), WP2 (ortak) |
| **Intern B** | Frontend/Ürün Lideri | Tüm UI: formlar, grid, dashboard, sınav görünümleri, filtreler, export arayüzü, wireframe'ler | WP6 (tam), WP2-3-4 (ortak) |
| **Intern C** | Zamanlama/QA Lideri | Çakışma motoru, slot modeli, seed data, unit testler, çakışma raporu, demo senaryoları | WP5 (tam), WP3-4 (ortak) |

Koordinasyon bağları (doküman şartı):
- A ↔ B: API kontratı (docs/api_kontrat.md) — değişiklik ikisinin onayıyla
- A ↔ C: motorun endpoint'lere entegrasyonu (save/submit çağrıları)
- B ↔ C: ConflictResult nesnesinin UI'da gösterimi

---

## Görev Sırası ve Branch Planı

### HAFTA 2 — Çekirdek veri + haftalık program

**Intern A** (sıra önemli: modeller herkesten önce bitmeli, çünkü B ve C'nin
gerçek verisi bu tablolardan gelecek)
1. `feature/wp0-db-models` — SQLAlchemy modelleri + Alembic migration (schema.sql v0.2 → gerçek tablolar)
2. `feature/wp1-auth` — JWT login, şifre hash, get_current_user, rol guard
3. `feature/wp1-invitations` — davet token'ı, Mailpit'e mail, hesap tamamlama
4. `feature/wp2-crud-api` — bölüm/hoca/derslik/ders CRUD endpoint'leri + workgroup izolasyonu

**Intern B** (1-2. işlerde mock veriyle çalışır, A'nın CRUD'u bitince gerçeğe bağlar)
1. `feature/wp0-wireframes` — 9 ekranın Excalidraw çizimi (docs/wireframe_sartnamesi.md'den) → docs/wireframes/
2. `feature/wp2-auth-ui` — login + hesap tamamlama sayfaları (mock ile başlar)
3. `feature/wp2-crud-ui` — ders/derslik/bölüm listeleri ve formları (hoca autocomplete dahil)
4. `feature/wp3-weekly-grid` — haftalık grid görünümü (DRAFT/SUBMITTED görsel ayrımı)

**Intern C** (en bağımsız hat — kimseyi beklemez)
1. `feature/wp5-overlap-core` — temel kesişim matematiği + slot modeli + sınır testleri
2. `feature/wp5-weekly-rules` — W1-W7 kuralları + unit testleri (docs/cakisma_kural_seti.md'den)
3. `feature/wp0-seed-script` — scripts/seed.py (docs/seed_data_plani.md'den; A'nın modelleri bitince)
4. `feature/wp3-save-integration` — motorun weekly-entries save/submit endpoint'lerine bağlanması (A ile birlikte)

### HAFTA 3 — Sınavlar + tam motor + raporlar

**Intern A**
5. `feature/wp4-exam-api` — sınav CRUD + save/submit endpoint'leri
6. `feature/wp2-permissions` — yetki sertleştirme + izinsiz erişim testleri

**Intern B**
5. `feature/wp4-exam-ui` — sınav formu/listesi/filtreleri
6. `feature/wp6-conflict-report` — çakışma rapor sayfası (HARD/WARNING)
7. `feature/wp6-dashboard` — sayaçlar + çakışma özeti

**Intern C**
5. `feature/wp5-exam-rules` — E1-E6 kuralları + testler
6. `feature/wp5-cross-rules` — X1-X3 (sınav×ders) kuralları + testler
7. `feature/wp6-export` — Excel export (openpyxl; B ile format, hoca ile şablon görüşmesi)

### HAFTA 4 — Sağlamlaştırma + demo (herkes)

- `fix/...` branch'leri — bug düzeltmeleri (herkes kendi alanında)
- Intern A: deployment hazırlığı (Hafta 3 sonunda başlamalı — doküman risk maddesi)
- Intern B: UI cilası + kullanılabilirlik düzeltmeleri
- Intern C: demo senaryosu provası + test kapsamı tamamlama
- Ortak: README güncelleme, final sunum hazırlığı

---

## Günlük İşleyiş Kuralları

1. Güne başlarken: `git checkout main` → `git pull` → yeni işe başlıyorsan branch'ini o an aç.
2. Gün içinde küçük commit'ler at (`feat:`, `fix:`, `test:` önekleriyle).
3. İş bitince PR aç, açıklamaya ne yaptığını yaz, ekipten 1 onay al, merge et, branch'i sil.
4. En geç 2 günde bir main'e entegre ol — büyük birikmiş PR yok.
5. API kontratında değişiklik gerekirse: önce üçünüz konuşun, sonra docs/api_kontrat.md
   güncellensin, sonra kod. Sessiz değişiklik yasak.
6. Haftayı çalışan demo ile kapatın — yarım özellik olabilir, kırık main olamaz.

## Bağımlılık Haritası (kim kimi bekler)

- ✅ Beklemesiz başlayabilir: A→db-models, B→wireframes, C→overlap-core (üçü aynı gün paralel)
- B'nin gerçek veri bağlaması → A'nın crud-api'sini bekler (o zamana dek mock)
- C'nin seed script'i → A'nın db-models'ını bekler (o zamana dek motoru saf Python'da test eder)
- C'nin save-integration'ı → A'nın crud-api'si + kendi weekly-rules'u bitince
- B'nin conflict-report'u → ConflictResult şekli kontratta sabit olduğu için mock ile erken başlayabilir

---

## Ek: Git ve Branch Rehberi (yeni başlayanlar için)

Bu ekip Git kullanıyor. Aşağıdaki kavramları bilmeyen varsa önce bunu okusun.

### Temel kavramlar

- **Repository (repo):** Projenin geçmişini hatırlayan klasörü. Her dosyanın her
  versiyonunu, kimin ne zaman değiştirdiğini saklar.
- **Commit:** Bir kayıt noktası / fotoğraf. Bir şeyler değiştirip commit'lediğinde
  o anki hali not düşerek kaydedersin. İstediğin an eski bir commit'e dönebilirsin.
- **Branch (dal):** Projenin paralel bir kopyasında çalışmak. Ana proje `main`
  dalıdır (gövde). Herkes `main`'den kendine bir yan dal açar, orada kendi işini
  yapar, kimseyi rahatsız etmez. Üç kişi aynı anda `main`'de çalışsaydı sürekli
  birbirinin dosyasını ezerdi; branch bunu önler.
- **Merge (birleştirme):** Dalda işini bitirince, değişiklikleri `main`'e geri
  kaynatmak.
- **PR (Pull Request):** "Dalımdaki işi bitirdim, main'e almak istiyorum, önce
  bakar mısınız?" demenin resmi yolu. Merge'den önce bir ekip arkadaşı kodu
  inceleyip onaylar. Böylece kimse tek başına kontrolsüz kod eklemez.

### Neden `main`'de doğrudan çalışmıyoruz?

`main` her zaman ÇALIŞIR durumda olmalı (her hafta çalışan demo kuralı).
Yarım kod doğrudan `main`'e girerse herkesin projesi bozulur. Bu yüzden herkes
kendi dalında çalışır, iş bitince PR ile main'e kaynar.

### Günlük döngü (her iş için tekrarlanır)

```
# 1. Güne başlarken main'i güncelle
git checkout main
git pull

# 2. Yeni işe başlıyorsan, main'in güncel halinden dalını aç
git checkout -b feature/wp1-auth        # kendi görevinin adıyla

# 3. Çalış, ilerledikçe küçük commit'ler at
git add .
git commit -m "feat: login endpoint eklendi"

# 4. Dalını GitHub'a gönder
git push -u origin feature/wp1-auth      # ilk push'ta -u origin ekle

# 5. GitHub'da PR aç (web arayüzünden):
#    - "Compare & pull request" butonuna bas
#    - Ne yaptığını yaz, bir ekip arkadaşını reviewer seç
#    - 1 onay gelince "Merge" butonuna bas
#    - Merge sonrası dalı sil (GitHub sil butonunu gösterir)
```

### Önemli kurallar

- **Branch'i işe başlayınca aç, önceden toplu açma.** Erken açılan dal bayatlar
  (main ilerler, dalın eski kalır). İhtiyaç oldukça, o günün güncel main'inden aç.
- **Branch 2 günden uzun yaşamasın.** Uzun yaşayan dalı main'e kaynatmak zorlaşır.
- **Küçük ve sık commit + sık PR.** Büyük birikmiş değişiklik yerine küçük parçalar.
- **Doğrudan main'e push yok.** Her şey PR'dan ve 1 onaydan geçer.

### Komut ezberlemek istemeyenler için

Bu döngünün çoğu GitHub web arayüzünden veya VS Code'un Git panelinden düğmelerle
de yapılabilir. Sadece kod yazıp commit atma kısmı bilgisayarında olur. GitHub
Desktop uygulaması da komutsuz bir alternatiftir.

### İsimlendirme (bu projede)

- Özellik dalları: `feature/<wp>-<kısa-ad>`  → örn. `feature/wp5-weekly-rules`
- Hata düzeltme dalları: `fix/<kısa-ad>`      → örn. `fix/login-token-suresi`
- Commit önekleri: `feat:` (yeni özellik), `fix:` (düzeltme), `test:` (test),
  `docs:` (belge), `chore:` (yapılandırma), `refactor:` (düzenleme)
