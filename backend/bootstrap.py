"""Konteyner ilk acilis adimi: sema kur, bos veritabanina demo verisi koy.

NEDEN AYRI BIR SERVIS
---------------------
Migration'i backend imajinin CMD'sine koymak cazip ama yanlis: birden fazla
backend konteyneri acilirsa hepsi ayni migration'i ayni anda kosar. Ayri ve
tek seferlik bir servis olarak calisinca hem bu yaris yok, hem migration
basarisiz olursa sebebi kendi log'unda ayri durur (backend'in acilis
gurultusune karismaz). backend/Dockerfile'in yorumu da bunu soyluyordu.

NE YAPAR
--------
  1. Veritabanini bekler (konteyner db'den once hazir olabilir).
  2. alembic upgrade head.
  3. Veritabani BOSSA demo verisini kurar. Doluysa DOKUNMAZ -- seed_demo.py
     ilk is olarak TRUNCATE atiyor; onu her aciliste kosturmak, sistemi
     kapatip acan herkesin verisini silerdi.

Depoyu klonlayan biri icin sonuc: `docker compose up` sonrasi acilan sistem
bos degil, cakisma senaryolariyla dolu bir fakulte -- yani ilk bakista ne ise
yaradigi gorulur.
"""

import subprocess
import sys
import time

from sqlalchemy import inspect, text

from app.config import settings
from app.db import engine


def veritabanini_bekle(saniye: int = 60) -> None:
    """db konteyneri saglikli olsa da baglanti birkac saniye gecikebilir."""
    son_hata = None
    for _ in range(saniye):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("veritabani hazir")
            return
        except Exception as e:          # noqa: BLE001 - sebebi asagida basiliyor
            son_hata = e
            time.sleep(1)
    sys.exit(f"Veritabanina {saniye} saniyede baglanilamadi: {son_hata}")


def kos(*komut: str) -> None:
    print(f"$ {' '.join(komut)}")
    sonuc = subprocess.run(komut)
    if sonuc.returncode != 0:
        sys.exit(f"Komut basarisiz (kod {sonuc.returncode}): {' '.join(komut)}")


def veritabani_bos_mu() -> bool:
    """Kullanici tablosu yoksa ya da hic kayit yoksa bos sayilir."""
    if "users" not in inspect(engine).get_table_names():
        return True
    with engine.connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one() == 0


def main() -> None:
    veritabanini_bekle()

    bos_baslangic = veritabani_bos_mu()
    kos(sys.executable, "-m", "alembic", "upgrade", "head")

    if not bos_baslangic:
        print("\nVeritabaninda veri var — demo verisi KURULMADI (mevcut veri korundu).")
        print("Sifirdan demo istiyorsaniz: docker compose down -v && docker compose up")
        return

    print("\nVeritabani bos — demo verisi kuruluyor...")
    kos(sys.executable, "seed_demo.py", "--yes")

    print(f"""
┌──────────────────────────────────────────────────────────────┐
│  SISTEM HAZIR                                                │
│                                                              │
│  Arayuz     : http://localhost:8080                          │
│  API dokuman: http://localhost:8000/docs                     │
│  E-postalar : http://localhost:8025   (Mailpit)              │
│                                                              │
│  Giris      : admin@muh.example.edu.tr  /  admin1234         │
│                                                              │
│  Gonderilen hicbir e-posta internete cikmaz; hepsi Mailpit   │
│  arayuzunde birikir.                                         │
└──────────────────────────────────────────────────────────────┘
""")
    if settings.smtp_host != "mailpit":
        print(f"NOT: SMTP_HOST={settings.smtp_host} — Mailpit disinda bir sunucu "
              f"ayarlanmis, mailler gercekten gonderilecek.")


if __name__ == "__main__":
    main()
