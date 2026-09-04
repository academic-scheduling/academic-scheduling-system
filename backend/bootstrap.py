"""Konteyner ilk acilis adimi: semayi kur, sisteme girilebilir hale getir.

NE KURAR, NE KURMAZ
-------------------
Sistem BOS acilir. Bolum, derslik, ders, hoca, program -- hicbiri yok; onlari
kullanan kendi girer. Depoda hicbir icerik verisi bulunmaz.

Tek istisna acilis asgarisidir: bir workgroup ve bir yonetici hesabi. Bunlar
"veri" degil, sistemin kilididir -- olmadan giris ekraninda gecerli hicbir
parola bulunmaz ve uygulama kimse tarafindan kullanilamaz (bir modemin
varsayilan yonetici parolasi gibi dusunun; ilk isiniz onu degistirmek olmali).

Ders saatleri (Slot 1-9) buradan gelmez, migration'in icindedir: onlar
yapilandirma degil, semanin parcasi olan referans veridir.

NEDEN AYRI BIR SERVIS
---------------------
Migration'i backend imajinin CMD'sine koymak cazip ama yanlis: birden fazla
backend konteyneri acilirsa hepsi ayni migration'i ayni anda kosar. Ayri ve
tek seferlik bir servis olarak calisinca hem bu yaris yok, hem migration
basarisiz olursa sebebi kendi log'unda ayri durur.
"""

import os
import subprocess
import sys
import time

from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal, engine
from app.models import User, UserRole, UserStatus, Workgroup
from app.security import hash_password

# Varsayilanlar belgelenmistir (README) ve ortam degiskeniyle degistirilebilir.
# Yayina cikan bir kurulumda ikisinin de verilmesi beklenir.
YONETICI_EPOSTA = os.getenv("ADMIN_EMAIL", "admin@muh.example.edu.tr")
YONETICI_PAROLA = os.getenv("ADMIN_PASSWORD", "admin1234")
CALISMA_GRUBU = os.getenv("WORKGROUP_NAME", "Fakülte")


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


def yoneticiyi_kur() -> bool:
    """Workgroup ve yonetici hesabi yoksa olusturur. Doner: yeni kuruldu mu.

    Idempotent: var olan kuruluma dokunmaz. Boylece her `docker compose up`
    guvenle calisir, mevcut veri ve parolalar korunur.
    """
    db = SessionLocal()
    try:
        if db.query(User).filter(User.role == UserRole.ADMIN).first() is not None:
            return False

        wg = db.query(Workgroup).first()
        if wg is None:
            # Davet edilebilecek adreslerin uzantisi yoneticinin adresinden
            # turetilir: yonetici kendi kurumundan kisileri davet edebilsin.
            uzanti = YONETICI_EPOSTA.rsplit("@", 1)[-1]
            wg = Workgroup(name=CALISMA_GRUBU, allowed_email_domain=uzanti)
            db.add(wg)
            db.flush()

        yonetici = User(
            workgroup_id=wg.id,
            name="Sistem Yöneticisi",
            email=YONETICI_EPOSTA,
            password_hash=hash_password(YONETICI_PAROLA),
            role=UserRole.ADMIN,
            status=UserStatus.ACTIVE,
        )
        db.add(yonetici)
        db.flush()
        wg.created_by = yonetici.id
        db.commit()
        return True
    finally:
        db.close()


def main() -> None:
    veritabanini_bekle()
    kos(sys.executable, "-m", "alembic", "upgrade", "head")

    yeni = yoneticiyi_kur()
    if not yeni:
        print("\nYonetici hesabi zaten var — dokunulmadi.")
        return

    print(f"""
┌──────────────────────────────────────────────────────────────┐
│  SISTEM HAZIR (bos)                                          │
│                                                              │
│  Arayuz     : http://localhost:8080                          │
│  API dokuman: http://localhost:8000/docs                     │
│  E-postalar : http://localhost:8025   (Mailpit)              │
│                                                              │
│  Giris      : {YONETICI_EPOSTA:<47}│
│  Parola     : {YONETICI_PAROLA:<47}│
│                                                              │
│  Sistemde henuz veri yok: bolum, derslik, ders ve programi   │
│  giris yaptiktan sonra kendiniz olusturursunuz.              │
│                                                              │
│  Gonderilen hicbir e-posta internete cikmaz; hepsi Mailpit   │
│  arayuzunde birikir.                                         │
└──────────────────────────────────────────────────────────────┘
""")
    print("ONEMLI: yukaridaki parola belgelenmis bir varsayilandir. Kendi "
          "kurulumunuzda ADMIN_EMAIL ve ADMIN_PASSWORD ortam degiskenleriyle "
          "degistirin ya da giris yaptiktan sonra parolayi guncelleyin.")

    if settings.smtp_host != "mailpit":
        print(f"\nNOT: SMTP_HOST={settings.smtp_host} — Mailpit disinda bir sunucu "
              f"ayarlanmis, mailler gercekten gonderilecek.")


if __name__ == "__main__":
    main()
