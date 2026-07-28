# Backend calisma imaji.
#
# Render, Railway, Fly.io ve kendi sunucumuz -- hangisi secilirse secilsin
# baslangic noktasi bu dosya. Barindirma karari beklenmeden yazilabilmesinin
# sebebi bu: platformlar arasindaki fark imajin ICINDE degil, disinda
# (ortam degiskenleri ve ag ayarlari).

FROM python:3.12-slim

# Python'un konteynerdeki iki alisilmis ayari:
#   PYTHONDONTWRITEBYTECODE: .pyc yazma, imaji sisirir ve kalici degil
#   PYTHONUNBUFFERED: log'lar tamponda beklemesin, platform panelinde aninda gorunsun
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Once yalniz requirements kopyalanir: kaynak kod degistiginde bu katman
# onbellekten gelir ve pip install bastan calismaz.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Belgeleme amacli; asil portu platform $PORT ile bildirir.
EXPOSE 8000

# Migration'lar burada CALISMAZ. Iki sebep:
#   1) Ayni anda birden fazla konteyner acilirsa hepsi ayni migration'i kosar.
#   2) Migration basarisiz olursa sebebi ayri bir adimda gormek daha kolaydir.
# Platformun "release/pre-deploy command" alanina su yazilir:
#   alembic upgrade head
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
