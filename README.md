# Akademik Program ve Sınav Çakışma Yönetim Sistemi

Akademik birimler için haftalık ders programı ve sınav takvimi hazırlama +
çakışma tespit sistemi. Manuel Excel yönetiminin yerini alır; program
kesinleşmeden önce derslik, öğretim üyesi ve sınıf çakışmalarını yakalar.

---

## 5 dakikada dene

Docker Desktop dışında hiçbir şey kurmanıza gerek yok — Python, Node ve
veritabanı konteynerlerin içinde gelir.

    git clone https://github.com/academic-scheduling/academic-scheduling-system.git
    cd academic-scheduling-system
    docker compose up

İlk açılış imajları derlediği için birkaç dakika sürer; sonraki açılışlar
saniyeler alır. Ardından:

| | |
|---|---|
| Arayüz | <http://localhost:8080> |
| Giriş | `admin@muh.example.edu.tr` / `admin1234` |
| API dokümanı | <http://localhost:8000/docs> |
| E-postalar | <http://localhost:8025> (Mailpit) |

**Sistem boş açılır.** Bölüm, derslik, ders ve program yoktur; hepsini siz
oluşturursunuz. Depoda hiçbir içerik verisi dağıtılmaz.

Yönetici parolası belgelenmiş bir varsayılandır — kendi kurulumunuzda
`ADMIN_EMAIL` ve `ADMIN_PASSWORD` ortam değişkenleriyle değiştirin.

### Motoru en hızlı nasıl görürsünüz

Boş sistemde şu altı adım yeterli:

1. **Bölümler** → bir bölüm ekleyin (örn. `CENG`)
2. **Derslikler** → bir bina ve bir derslik tanımlayın; kapasitesini bilerek
   küçük tutun (örn. 30)
3. **Öğretim Üyeleri** → bir hoca ekleyin
4. **Dersler** → aynı sınıfa iki zorunlu ders açın, her birine **aynı hocayla**
   birer şube ekleyin ve beklenen öğrenci sayısını dersliğin kapasitesinden
   büyük verin (örn. 40)
5. **Haftalık Program** → bölüm, sınıf ve dönemi seçin (ekran sizin için bir
   taslak açar)
6. İki şubeyi **aynı gün, aynı saat, aynı dersliğe** yerleştirin

Motor anında üç engelleyici çakışma ve iki uyarı üretir:

| | |
|---|---|
| 🔴 W1 | İki ders aynı derslikte |
| 🔴 W2 | Aynı öğretim üyesi aynı anda iki yerde |
| 🔴 W3 | Aynı sınıfın iki zorunlu dersi çakışıyor |
| 🟡 W7 | Beklenen öğrenci sayısı derslik kapasitesini aşıyor |
| 🟡 W8 | Yerleşen saat toplamı dersin T+U+L değeriyle uyuşmuyor |

Ana sayfadaki sayaç engelleyici ve uyarı sayısını ayrı gösterir; **Çakışma
Raporu** her satırın hangi kuralı neden tetiklediğini yazar. Taslağı yayına
almayı deneyin: engelleyici çakışma varken `submit` reddedilir ve gerekçeyi
listeler (K-03).

Gönderilen hiçbir e-posta internete çıkmaz; davet ve şifre sıfırlama mailleri
Mailpit arayüzünde birikir.

---

## Motor ne yakalar

Çakışma kuralları üç ailede toplanır ve her biri **engelleyici** ya da
**uyarı** olarak sınıflanır. Çakışma kaydı engellemez, **yayına almayı**
engeller (K-03): taslak üzerinde serbestçe çalışırsınız, `submit` ancak
engelleyici çakışma kalmadığında geçer ve reddedilirse gerekçeyi listeler.

Kuralların tam listesi ve gerekçeleri `docs/cakisma_kural_seti_1.md`
içindedir; aşağıdaki özet uygulamadaki kural kataloğunun aynısıdır.

**W — haftalık program**

| | |
|---|---|
| W1 | Aynı derslikte, aynı gün, kesişen saatlerde iki ders |
| W2 | Aynı öğretim üyesi, aynı gün, kesişen saatlerde iki ders |
| W3 | Aynı sınıfın iki **zorunlu** dersi çakışıyor — öğrenci ikisini de almak zorunda |
| W4 | Aynı sınıfın iki dersi çakışıyor, en az biri seçmeli |
| W5 | Aynı şubenin kesişen iki oturumu girilmiş |
| W6 | Gün 1-5 dışında ya da günün son slotunu aşan yerleşim |
| W7 | Şubenin beklenen öğrenci sayısı dersliğin kapasitesini aşıyor |
| W8 | Yerleşen saat toplamı dersin teori+uygulama+lab değeriyle uyuşmuyor |
| W9 | Yüz yüze derse derslik atanmamış |

**E — sınav takvimi**

| | |
|---|---|
| E1 | İki sınav aynı dersliği aynı tarih ve kesişen saatte kullanıyor |
| E2 | Aynı dersin aynı türden ikinci sınavı |
| E3 | Aynı sorumlu, aynı tarih ve kesişen saatte iki sınavda |
| E4a / E4b | Aynı sınıfın iki sınavı aynı anda (a: ikisi de zorunlu, b: en az biri seçmeli) |
| E5 / E5a | Sınav kontenjanı yetersiz / hiç girilmemiş |
| E6 | Sınav cumartesi ya da pazara denk geliyor |
| E7 | Bir derslik çıkarılsa bile kontenjan fazlasıyla yetiyor |
| E8 | Sınava hiç derslik seçilmemiş |
| E9 | Aynı kişi iki sınavda birden görevli, en az biri gözetmenlik |

**X — çapraz (sınav ↔ haftalık program)**

| | |
|---|---|
| X1 | Sınavın dersliği o saatte haftalık bir derse ayrılmış |
| X2 | Sınav, aynı sınıfın haftalık dersiyle aynı saate düşüyor |
| X3 | Sınav sorumlusu o saatte haftalık bir derste görünüyor |
| X4 | Sınavın gözetmeni o saatte haftalık bir derste görünüyor |

### Motorun bilerek sustuğu yerler

Asıl ustalık yanlış alarm üretmemektedir. Motor şu durumlarda **çakışma
bildirmez** ve bunların her biri ayrı bir karar maddesidir:

- Bir dersin ikinci şubesi farklı saatteyse, öğrenci uyumlu kombinasyonu
  seçebileceği için sınıf çakışması sayılmaz (K-15)
- Asenkron yürütülen ders, aynı hoca aynı saatte görünse bile hoca
  çakışması üretmez (K-19)
- Bir dersin sınavı kendi ders saatine denk geldiğinde çapraz uyarı çıkmaz
  (K-13)

Tasarım kararlarının tamamı `docs/karar_defteri_1.md` içindedir.

---

## Teknoloji

- **Backend:** FastAPI (Python 3.12), SQLAlchemy 2, Alembic, PostgreSQL 16
- **Frontend:** React 18, Vite, TypeScript, Mantine UI
- **Kimlik doğrulama:** JWT
- **E-posta:** Mailpit (geliştirme) · herhangi bir SMTP sağlayıcı (yayın)
- **Altyapı:** Docker Compose

Tasarım belgeleri `docs/` klasöründedir: karar defteri, çakışma kural seti,
veritabanı şeması, API kontratı, wireframe şartnamesi.

---

## Geliştirme kurulumu

Yukarıdaki Docker yolu **sistemi denemek** içindir. Kod yazacaksanız backend
ve frontend'i doğrudan çalıştırmak çok daha hızlıdır: anında yeniden yükleme,
hata ayıklayıcı, saniyelik geri bildirim. Docker'ın içinde her değişiklik bir
yeniden derleme demektir.

Gerekenler: Docker Desktop, Python 3.12+, Node.js 20+.

### 1. Ortam değişkenleri

Repo kökünde:

    copy .env.example .env      # Windows
    cp .env.example .env        # Mac/Linux

Geliştirme için varsayılanlar değiştirmeden çalışır. `.env` asla commit edilmez.

### 2. Backend kütüphaneleri

    cd backend
    python -m venv .venv
    .venv\Scripts\activate          # Windows
    source .venv/bin/activate       # Mac/Linux
    pip install -r requirements.txt

### 3. Frontend kütüphaneleri

    cd frontend
    npm install

`npm audit` uyarıları geliştirme bağımlılıklarından gelir ve zararsızdır;
`npm audit fix --force` **çalıştırmayın** (kurulumu bozabilir).

### 4. Veritabanı ve şema

Şema Alembic migration'larıyla yönetilir; uygulama tabloları kendisi
oluşturmaz. Bu adım atlanırsa backend açılır ama her istek "tablo yok" hatası
verir (sağlık rozeti yine yeşil görünür — o yalnız bağlantıyı sınar).

    docker compose up -d db mailpit    # repo kökünde
    cd backend
    .venv\Scripts\activate
    alembic upgrade head

Yeni migration içeren bir değişiklik çektiğinizde `alembic upgrade head`
komutunu tekrarlayın.

---

## Geliştirirken çalıştırma

Üç şey aynı anda çalışır: bağımlılıklar Docker'da, backend ve frontend
doğrudan. En rahat yöntem VS Code'un entegre terminalinde iki sekme açmak.

**Terminal 0 — bağımlılıklar** (bir kez, arka planda):

    docker compose up -d db mailpit

> Servis adlarını yazmak önemli: düz `docker compose up` backend ve
> frontend'i de başlatır ve 8000 portunu kapar, aşağıdaki uvicorn açılamaz.

**Terminal 1 — backend:**

    cd backend
    .venv\Scripts\activate
    uvicorn app.main:app --reload --port 8000

**Terminal 2 — frontend:**

    cd frontend
    npm run dev

<http://localhost:5173> açıldığında iki yeşil rozet ("Backend: ok",
"Veritabanı: up") görünüyorsa zincirin tamamı çalışıyor demektir.

---

## Portlar

| Servis | Port | Ne zaman |
|---|---|---|
| Arayüz (nginx) | 8080 | `docker compose up` |
| Arayüz (Vite dev) | 5173 | geliştirme |
| Backend (FastAPI) | 8000 | her ikisi |
| PostgreSQL | 5432 | her ikisi |
| Mailpit arayüz / SMTP | 8025 / 1025 | her ikisi |

## Sorun giderme

| Belirti | Olası sebep / çözüm |
|---|---|
| `docker compose up` "daemon not running" | Docker Desktop açık değil; başlatıp tam açılmasını bekleyin |
| "port already in use" (8000) | Hem konteyner backend'i hem yerel uvicorn çalışıyor; birini durdurun |
| Rozet "Veritabanı: down" | `docker compose up -d db` çalışmıyor |
| Rozet "Backend: erişilemiyor" | Backend süreci kapalı |
| Kod değiştirdim, konteynerde görünmüyor | İmaj yeniden derlenmeli: `docker compose up -d --build backend` |
| Sistem boş açıldı | Beklenen davranış — veriyi siz girersiniz |
| `activate` script hatası (Windows) | PowerShell'de `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

Yararlı komutlar:

    docker compose up -d          # arka planda başlat
    docker compose ps             # ne çalışıyor, sağlık durumu ne
    docker compose logs -f backend
    docker compose down           # durdur (veri korunur)
    docker compose down -v        # DİKKAT: veritabanını da siler

---

## Ortam değişkenleri

Tümü repo kökündeki `.env` dosyasından okunur (`.env.example` şablondur).
Hiçbir sır kaynak koda gömülmez. Docker ile çalıştırırken değerler
`docker-compose.yml` içinden verilir; `.env` okunmaz (konteyner içinde
`localhost` konteynerin kendisi olduğu için o dosyadaki adresler yanlış olurdu).

| Değişken | Varsayılan (dev) | Açıklama |
|---|---|---|
| `DATABASE_URL` | yerel Postgres | SQLAlchemy bağlantı adresi |
| `SECRET_KEY` | `change-me-in-real-env` | JWT imza anahtarı. **Yayında mutlaka değişmeli** (en az 32 karakter) |
| `ADMIN_EMAIL` | `admin@muh.example.edu.tr` | İlk açılışta kurulan yönetici hesabı |
| `ADMIN_PASSWORD` | `admin1234` | Aynı hesabın parolası. **Kendi kurulumunuzda değiştirin** |
| `WORKGROUP_NAME` | `Fakülte` | İlk açılışta kurulan çalışma grubunun adı |
| `ALLOWED_EMAIL_DOMAINS` | `muh.example.edu.tr,gmail.com,...` | Davet edilebilecek e-posta alan adları (virgüllü) |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | Dev'de Mailpit |
| `SMTP_USER` / `SMTP_PASSWORD` | boş | Gerçek SMTP kimlik bilgileri. Boşsa giriş denenmez |
| `SMTP_STARTTLS` | `false` | Gerçek sağlayıcılarda `true` |
| `MAIL_FROM` | `no-reply@muh.example.edu.tr` | Gönderen adresi. Gerçek SMTP'de `SMTP_USER` ile aynı olmalı |
| `INVITATION_EXPIRE_HOURS` | `168` | Davet bağlantısının ömrü (7 gün) |
| `PASSWORD_RESET_EXPIRE_HOURS` | `2` | Sıfırlama bağlantısının ömrü. Davetten bilerek kısa (K-43): çalınan sıfırlama linki aktif bir hesabı doğrudan ele geçirir |
| `PASSWORD_RESET_MAX_PER_HOUR` | `3` | Aynı hesaba saatlik sıfırlama maili sınırı (K-44). Aşılırsa cevap değişmez, yalnızca mail gitmez |
| `RECAPTCHA_SECRET_KEY` | boş | reCAPTCHA v2 gizli anahtarı (K-44). **Boşsa doğrulama atlanır** — yerel geliştirme internetsiz çalışır. `ENVIRONMENT=production` iken boşsa uygulama açılmaz |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | Davet mailindeki aktivasyon linki buradan üretilir |
| `CORS_ORIGINS` | `http://localhost:5173` | API'yi çağırabilecek kaynaklar (virgüllü). Docker'da tek origin olduğu için gerekmez |
| `ENVIRONMENT` | `development` | `production` yapılırsa dev varsayılanlarıyla açılmayı reddeder |

Frontend'in iki değişkeni `frontend/.env` dosyasındadır:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `VITE_API_BASE_URL` | (tanımsız) | Tanımsızken `/api` kullanılır; geliştirmede Vite proxy'si, yayında nginx aynı yolu backend'e taşır |
| `VITE_RECAPTCHA_SITE_KEY` | (tanımsız) | reCAPTCHA v2 site anahtarı. Tanımsızken kutu çizilmez. Backend'in `RECAPTCHA_SECRET_KEY`'i ile **çift halinde** ayarlanır |

### Gerçek e-posta gönderimi

Varsayılan kurulumda mailler Mailpit'te kalır ve internete çıkmaz. Gerçek
gönderim için beş değişken yeterlidir, kod değişmez:

    SMTP_HOST=smtp.example.com
    SMTP_PORT=587
    SMTP_USER=hesap@example.com
    SMTP_PASSWORD=...
    SMTP_STARTTLS=true
    MAIL_FROM=hesap@example.com     # SMTP_USER ile AYNI olmalı

`MAIL_FROM` neden aynı olmalı: sağlayıcılar sahibi olmadığınız bir adresten
göndermenize izin vermez. Sahip olmadığınız bir alan adından gönderilen mail
alıcı tarafında SPF/DKIM denetiminden kalır ve spam'e düşer.

Davet maili, daveti gönderen yöneticinin adını taşır ve `Reply-To` başlığı
ona ayarlanır — böylece davet edilen kişi doğrudan muhatabına yanıt verir.

### CAPTCHA'yı açmak (K-44)

Şifre sıfırlama formundaki "Ben robot değilim" kutusu varsayılan olarak
**kapalıdır** — anahtar tanımlı değilken ne çizilir ne doğrulanır, böylece
yerel kurulum ve internetsiz demo etkilenmez.

Açmak için <https://www.google.com/recaptcha/admin> adresinden bir **v2
("I'm not a robot")** anahtar çifti alıp ikisini birlikte doldurun:

    RECAPTCHA_SECRET_KEY=...        # repo kökündeki .env  (backend)
    VITE_RECAPTCHA_SITE_KEY=...     # frontend/.env        (istemci)

Yalnız biri doldurulursa form çalışmaz: istemci token göndermezken sunucu
bekler (veya tersi). Google'ın herkese açık test anahtarları **her token'ı
geçirir, gerçek koruma sağlamaz** — yalnızca akışı denemek içindir.

---

## Yayına alma

Kod hazırlığı tamamdır; `docker compose` ile ayağa kalkan yığın yayın için de
başlangıç noktasıdır. Yayına çıkarken:

1. `SECRET_KEY` için rastgele bir değer üretin:
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`
2. `ADMIN_EMAIL` / `ADMIN_PASSWORD` değerlerini kendinize göre ayarlayın
3. Veritabanı parolasını değiştirin (`docker-compose.yml` içindeki değer
   yalnız yerel deneme içindir)
4. `FRONTEND_BASE_URL`'i gerçek adresle doldurun — davet linkleri buradan üretilir
5. Gerçek SMTP bilgilerini girin
6. `RECAPTCHA_SECRET_KEY` / `VITE_RECAPTCHA_SITE_KEY` çiftini alın
7. `ENVIRONMENT=production` yapın

Son adım bir emniyet kilididir: uygulama, yukarıdaki dev varsayılanlarından
herhangi biri kalmışsa **açılmayı reddeder** ve hangisinin eksik olduğunu
söyler. Sessizce güvensiz çalışmaktansa hiç açılmaması tercih edilmiştir.

---

## Testler

    cd backend
    .venv\Scripts\activate
    python -m pytest -q

Testler ayrı bir veritabanında (`<db>_test`) koşar; geliştirme verinize
dokunmaz. Hiçbir test gerçek e-posta gönderemez — SMTP katmanı test oturumu
boyunca kapatılır (K-86).

## Lisans

MIT — ayrıntı için `LICENSE` dosyasına bakın.
