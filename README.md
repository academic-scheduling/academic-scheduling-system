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


### 1. Backend kütüphaneleri

    cd backend
    python -m venv .venv
    .venv\Scripts\activate          # Windows
    source .venv/bin/activate       # Mac/Linux
    pip install -r requirements.txt

Windows'ta `activate` "running scripts is disabled" hatası verirse, PowerShell'i
yönetici açıp bir kez: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 2. Frontend kütüphaneleri

    cd frontend
    npm install

`npm install` sonunda çıkan "vulnerabilities" ve "new version" uyarıları
zararsızdır; `npm audit fix --force` ÇALIŞTIRMAYIN (kurulumu bozabilir).

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
