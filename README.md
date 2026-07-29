# Akademik Program ve Sınav Çakışma Yönetim Sistemi

Akademik birimler için haftalık ders programı ve sınav takvimi hazırlama +
çakışma tespit sistemi. Manuel Excel yönetiminin yerini alır; program
kesinleşmeden önce derslik/hoca/kohort çakışmalarını yakalar.

## Teknoloji

- Backend: FastAPI (Python 3.12), SQLAlchemy 2, Alembic, PostgreSQL 16
- Frontend: React 18, Vite, TypeScript, Mantine UI
- Kimlik doğrulama: JWT
- E-posta (geliştirme): Mailpit (sandbox)
- Altyapı: Docker Compose

Tasarım belgeleri `docs/` klasöründedir: karar defteri, çakışma kural seti,
veritabanı şeması, API kontratı, wireframe şartnamesi, seed data planı.

## Gereksinimler

Makinende kurulu olmalı: Docker Desktop, Python 3.12+, Node.js 20+.

---

## İlk Kurulum (her üye bir kez yapar)

Repoyu klonladıktan sonra kütüphaneler repoda GELMEZ (`.venv` ve
`node_modules` bilinçli olarak dışlanmıştır); her üye kendi makinesinde kurar.

### 1. Ortam değişkenleri
Repo kökünde:

    copy .env.example .env      # Windows
    cp .env.example .env        # Mac/Linux

Geliştirme için `.env` içindeki varsayılan değerler çalışır; değiştirmeye
gerek yoktur. `.env` ASLA commit edilmez.

### 2. Backend kütüphaneleri

    cd backend
    python -m venv .venv
    .venv\Scripts\activate          # Windows
    source .venv/bin/activate       # Mac/Linux
    pip install -r requirements.txt

Windows'ta `activate` "running scripts is disabled" hatası verirse, PowerShell'i
yönetici açıp bir kez: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 3. Frontend kütüphaneleri

    cd frontend
    npm install

`npm install` sonunda çıkan "vulnerabilities" ve "new version" uyarıları
zararsızdır; `npm audit fix --force` ÇALIŞTIRMAYIN (kurulumu bozabilir).

### 4. Veritabanı tablolarını oluştur

Şema Alembic migration'larıyla yönetilir; uygulama tabloları kendisi
oluşturmaz. Bu adım atlanırsa backend açılır ama **her istek tablo yok
hatası verir** (sağlık rozeti yine yeşil görünür — o yalnız bağlantıyı
sınar, tabloları değil).

Önce veritabanı ayakta olmalı, sonra migration:

    docker compose up -d              # repo kökünde
    cd backend
    .venv\Scripts\activate            # Windows (Mac/Linux: source .venv/bin/activate)
    alembic upgrade head

Yeni migration içeren bir değişiklik çektiğinde `alembic upgrade head`
komutunu tekrar çalıştır.

### 5. Demo verisi (isteğe bağlı ama önerilir)

    cd backend
    python seed_demo.py

Boş bir sistemde ekranların çoğu boş görünür. Bu script gerçekçi bir fakülte,
iki bölüm, hocalar, derslikler, dersler ve **bilerek kurulmuş çakışmalar**
ekler — demo senaryolarının dayandığı veri budur.

> Dikkat: script çalışmadan önce veritabanındaki **tüm veriyi siler**.

---

## Her Çalıştırmada (üç süreç)

Üç şey aynı anda çalışır durumda olmalı. En rahat yöntem: VS Code'un entegre
terminalinde `+` ile üç sekme açıp her birinde bir komut çalıştırmak.

### Terminal 1 — Altyapı (Docker)
Repo kökünde:

    docker compose up

`-d` eklersen (`docker compose up -d`) arka planda çalışır ve terminali geri
verir; durdurmak için `docker compose down`.
Mailpit posta kutusu: http://localhost:8025

### Terminal 2 — Backend

    cd backend
    .venv\Scripts\activate          # Windows (Mac/Linux: source .venv/bin/activate)
    uvicorn app.main:app --reload --port 8000

Kontrol: http://localhost:8000/health → {"status":"ok","database":"up"}
API dokümantasyonu (Swagger): http://localhost:8000/docs

### Terminal 3 — Frontend

    cd frontend
    npm run dev

Uygulama: http://localhost:5173

---

## Çalışıyor mu? (başarı ölçütü)

http://localhost:5173 açıldığında iki YEŞİL rozet görünüyorsa kurulum tamamdır:
"Backend: ok" ve "Veritabanı: up". Bu, tarayıcı → frontend → backend → Postgres
zincirinin tamamının çalıştığını kanıtlar.

## Sorun Giderme

| Belirti | Olası sebep / çözüm |
|---|---|
| `docker compose up` "daemon not running" | Docker Desktop açık değil; başlat, tam açılmasını bekle |
| Rozet "Veritabanı: down" | Docker (Terminal 1) çalışmıyor veya `.env` yok |
| Rozet "Backend: erişilemiyor" | Backend (Terminal 2) çalışmıyor |
| "port already in use" | O portu kullanan eski süreç var; kapat veya `docker compose down` |
| `activate` script hatası (Windows) | Yukarıdaki `Set-ExecutionPolicy` komutunu çalıştır |
| `npm run dev` "command not found" | `frontend/` klasöründe misin? `npm install` yapıldı mı? |

## Portlar

| Servis | Port |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (FastAPI) | 8000 |
| PostgreSQL | 5432 |
| Mailpit arayüz / SMTP | 8025 / 1025 |

---

## Test kullanıcıları

`seed_demo.py` çalıştırıldıktan sonra kullanılabilir hesaplar:

| Rol | E-posta | Şifre | Ne yapabilir |
|---|---|---|---|
| Admin | `admin@muh.example.edu.tr` | `admin1234` | Her şey: bölüm/hoca/derslik yönetimi, kullanıcı daveti, tüm bölümlerin programı |
| Alt hesap | `ceng@muh.example.edu.tr` | `althesap123` | Yalnız CENG bölümü · derslik yönetimi **açık** |
| Alt hesap | `eee@muh.example.edu.tr` | `althesap123` | Yalnız EEE bölümü · derslik yönetimi **kapalı** |
| Bekleyen davet | `pending@muh.example.edu.tr` | — | Aktifleşmemiş; giriş yapamaz. Davet akışı demosu için. |

İki alt hesabın derslik yetkisi bilinçli olarak farklı (K-02): aynı ekranın
yetkiliye ve yetkisize nasıl göründüğü yan yana gösterilebilsin. Yazma
yetkileri kullanıcı bazlı bayraklarla ayrılır (K-25); matrisi görmek için
admin ile **Kullanıcılar** ekranına bak.

---

## Demo adımları

Seed verisi rastgele değildir: her kayıt belirli bir kuralı tetiklemek için
konumlandırılmıştır. Tam tarama **8 HARD + 15 WARNING** üretir.

1. **Giriş:** http://localhost:5173 → `admin@muh.example.edu.tr` / `admin1234`
2. **Panel:** çözülmemiş çakışma sayaçları dolu gelir.
3. **Haftalık Program** (CENG / 2. sınıf / Bahar):
   - 🔴 **W2** Pzt 08:30 — Kaya aynı anda iki bölümde ders veriyor
   - 🔴 **W3** Pzt 09:30 — CENG2001 ile CENG2003, aynı sınıfın iki zorunlu dersi
   - 🔴 **W1** Sal 12:30 — CENG2020 ile EEE2010 aynı derslikte (B-202)
   - 🟡 **W4** Sal 10:30 — iki seçmeli çakışıyor, uyarı seviyesinde
   - 🟡 **W7** Çar 08:30 — 55 öğrenci, LAB-1 kapasitesi 30
4. **Çakışmayı çöz:** bir kartı boş slota sürükle, listeden düştüğünü gör.
5. **Yayınla:** submit dene → engelleyici çakışma varsa 409 döner ve
   **gerekçe listelenir** (K-03: çakışma kaydı engellemez, submit'i engeller).
6. **Sınav Takvimi** (13-17 Nisan 2026 vize haftası):
   - 🔴 **E1** Çar 18:00 — iki vize aynı derslikte (A-101)
   - 🔴 **E3** Çar 18:00 — aynı hoca iki sınavda birden
   - 🔴 **X1** Pzt 09:00 — vize, o saatte ders yapılan dersliğe konmuş
   - 🟡 **E5a** Pzt 09:00 — LAB-1'in sınav kontenjanı girilmemiş
   - 🟡 **E7** Cum 13:30 — 20 öğrenci için üç derslik ayrılmış
7. **Motorun sustuğu yerler** (asıl ustalık burada — yanlış alarm üretmemek):
   - CENG2030'un ikinci şubesi farklı saatte → W3 **yok**, öğrenci uyumlu
     kombinasyonu seçebilir (K-15)
   - CENG2053 asenkron → aynı hoca aynı saatte olmasına rağmen W2 **yok** (K-19)
   - CENG2020 vizesi kendi dersinin saatinde → çapraz uyarı **yok** (K-13)
8. **İşlem Kayıtları:** admin ile her değişikliğin iz kaydını gör.
9. **Davet akışı:** Kullanıcılar → `pending@` kaydını gör → yeni davet gönder →
   maili http://localhost:8025 (Mailpit) adresinden aç → şifre belirle.
10. **API'den denenen üç kural** (veritabanı kısıtı seed'e girmelerini engeller):
    W6 pencere dışı slot · E2 mükerrer vize · E6 hafta sonu sınavı

---

## Ortam değişkenleri

Tümü repo kökündeki `.env` dosyasından okunur (`.env.example` şablondur).
Hiçbir sır kaynak koda gömülmez.

| Değişken | Varsayılan (dev) | Açıklama |
|---|---|---|
| `DATABASE_URL` | yerel Postgres | SQLAlchemy bağlantı adresi. Ekip ortak veritabanı kullanacaksa yalnız bu değişir. |
| `SECRET_KEY` | `change-me-in-real-env` | JWT imza anahtarı. **Yayında mutlaka değişmeli** (en az 32 karakter). |
| `ALLOWED_EMAIL_DOMAINS` | `muh.example.edu.tr,gmail.com` | Davet edilebilecek e-posta alan adları (virgüllü). |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Dev'de Mailpit. |
| `SMTP_USER` / `SMTP_PASSWORD` | boş | Gerçek SMTP kimlik bilgileri. Boşsa giriş denenmez (Mailpit kimlik doğrulama istemez). |
| `SMTP_STARTTLS` | `false` | Gerçek sağlayıcılarda `true`. |
| `INVITATION_EXPIRE_HOURS` | `168` | Davet bağlantısının geçerlilik süresi (7 gün). |
| `PASSWORD_RESET_EXPIRE_HOURS` | `2` | Şifre sıfırlama bağlantısının süresi. Davetten bilerek kısa (K-43): çalınan sıfırlama linki aktif bir hesabı doğrudan ele geçirir. |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | Davet mailindeki aktivasyon linki buradan üretilir. |
| `MAIL_FROM` | `no-reply@muh.example.edu.tr` | Gönderen adresi. |
| `CORS_ORIGINS` | `http://localhost:5173` | API'yi çağırabilecek kaynaklar (virgüllü). |
| `ENVIRONMENT` | `development` | `production` yapılırsa dev varsayılanlarıyla açılmayı reddeder. |

Frontend'in tek değişkeni `frontend/.env` dosyasındadır:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `VITE_API_BASE_URL` | (tanımsız) | Tanımsızken `/api` kullanılır ve Vite proxy'si devreye girer. Yayında backend'in gerçek adresi yazılır. |

---

## Yayına alma (WP7)

Yayın için gereken kod hazırlığı yapılmıştır; **hangi platformda
barındırılacağı henüz karara bağlanmamıştır**.

Hazır olanlar:

- `backend/Dockerfile` — Render, Railway, Fly.io ve kendi sunucumuz için ortak
  başlangıç noktası
- Tüm yapılandırma ortam değişkenlerinden okunur; kodda sabit adres kalmadı
- `ENVIRONMENT=production` ile açılışta dev varsayılanları reddedilir
- Gerçek SMTP'ye geçiş kod değişikliği gerektirmez, `.env` doldurmak yeterli

Yayına çıkarken yapılacaklar:

1. `SECRET_KEY` için rastgele bir değer üret:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`
2. Barındırılan bir Postgres oluştur, `DATABASE_URL`'i ona çevir
3. Migration'ları çalıştır: `alembic upgrade head`
   (platformun "release / pre-deploy command" alanına yazılır)
4. `CORS_ORIGINS` ve `FRONTEND_BASE_URL`'i gerçek adreslerle doldur
5. Frontend'i `VITE_API_BASE_URL` ayarlı derle: `npm run build` → `dist/`
6. `ENVIRONMENT=production` yap

**Ekip aynı veriyi görsün istiyorsanız** tam yayına gerek yok: ortak bir
Postgres açıp herkesin `.env` dosyasındaki `DATABASE_URL`'ini oraya çevirmek
yeterlidir. Backend'ler herkesin kendi makinesinde kalır.

## Önemli
requirements.txt'e dokunan bir değişiklik çektikten sonra her zaman `pip install -r requirements.txt` çalıştır. 