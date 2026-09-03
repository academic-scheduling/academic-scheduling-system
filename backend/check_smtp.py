"""Mail ayarlarini tek komutla dogrular ve gercek bir test maili gonderir.

    python check_smtp.py hedef@gmail.com
    python check_smtp.py hedef@gmail.com --debug     # ham SMTP konusmasi

Neden ayri bir script: davet akisini bastan kurup mail beklemek, yanlis giden
seyin SMTP mi, token mi, yetki mi oldugunu belirsiz birakir. Bu script yalniz
SMTP katmanini dener; gecerse mail tarafi bitmis demektir.

Uygulamanin kendi ayarlarini (app/config.py -> .env) okur, yani burada gecen
ayar uygulamada da gecer.
"""

import smtplib
import socket
import sys

from app.config import _ENV_DOSYASI, settings
from app.mailer import _send


def _maskele(deger: str) -> str:
    if not deger:
        return "(bos)"
    return deger[:2] + "*" * max(len(deger) - 4, 4) + deger[-2:]


def ayarlari_yazdir() -> None:
    # Once .env gercekten okunabildi mi: bu yol yanlissa ya da dosya yoksa
    # pydantic-settings sessizce atlar ve HER ayar kod varsayilanina duser.
    # "Ayarlari degistirdim ama hicbir sey degismedi" vakalarinin sebebi budur.
    print(f".env yolu : {_ENV_DOSYASI}")
    print(f"  bulundu : {'EVET' if _ENV_DOSYASI.is_file() else 'HAYIR — hicbir ayar okunmadi!'}")
    print()
    print("Okunan ayarlar (.env):")
    print(f"  SMTP_HOST      : {settings.smtp_host}")
    print(f"  SMTP_PORT      : {settings.smtp_port}")
    print(f"  SMTP_STARTTLS  : {settings.smtp_starttls}")
    print(f"  SMTP_USER      : {settings.smtp_user or '(bos — kimlik dogrulama yapilmayacak)'}")
    print(f"  SMTP_PASSWORD  : {_maskele(settings.smtp_password)}")
    print(f"  MAIL_FROM      : {settings.mail_from}")
    print()


def onden_uyar() -> None:
    """Gondermeden once yakalanabilecek hatalar — mesaji netlestirir."""
    if settings.smtp_user and settings.mail_from != settings.smtp_user:
        print("UYARI: MAIL_FROM ile SMTP_USER farkli.")
        print(f"       MAIL_FROM={settings.mail_from}  SMTP_USER={settings.smtp_user}")
        print("       Gmail sahibi olmadiginiz bir adresten gondermenize izin")
        print("       vermez; gonderim reddedilir ya da adres degistirilir.")
        print()

    if settings.smtp_host == "localhost" and settings.smtp_port == 1025:
        print("BILGI: Su an Mailpit ayarlarindasiniz — mail internete cikmayacak,")
        print("       http://localhost:8025 adresinde gorunecek. Gercek gonderim")
        print("       icin .env'deki 'GERCEK SMTP' blogunu doldurun.")
        print()


def main() -> int:
    argumanlar = [a for a in sys.argv[1:] if a != "--debug"]
    ayrintili = "--debug" in sys.argv
    if len(argumanlar) != 1:
        print(__doc__)
        return 2

    hedef = argumanlar[0]
    ayarlari_yazdir()
    onden_uyar()

    if ayrintili:
        # Ham SMTP konusmasi: hangi adimda takildigini gizlemeden gosterir.
        import smtplib as _s
        print("--- SMTP konusmasi ---")
        with _s.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as srv:
            srv.set_debuglevel(1)
            if settings.smtp_starttls:
                srv.starttls()
            if settings.smtp_user:
                srv.login(settings.smtp_user, settings.smtp_password)
        print("--- konusma bitti ---\n")

    print(f"Test maili gonderiliyor -> {hedef}")
    try:
        _send(
            hedef,
            "Akademik Planlama Sistemi - SMTP test",
            "Bu bir test mailidir.\n\n"
            "Bu maili okuyabiliyorsaniz sistemin mail yapilandirmasi calisiyor:\n"
            f"  sunucu : {settings.smtp_host}:{settings.smtp_port}\n"
            f"  gonderen: {settings.mail_from}\n\n"
            "Bu maile cevap verirseniz asagidaki adrese ulasir.\n",
            reply_to=settings.mail_from,
        )
    except smtplib.SMTPAuthenticationError as e:
        print("\nHATA: Kimlik dogrulama reddedildi.")
        print("  En sik sebep: normal Gmail sifresi kullanilmis olmasi.")
        print("  Gmail'de UYGULAMA SIFRESI gerekir (once 2 Adimli Dogrulama acilir,")
        print("  sonra Google Hesabi > Guvenlik > Uygulama Sifreleri'nden uretilir).")
        print("  16 haneli sifre bosluklu gosterilir; bosluklari silerek yazin.")
        print(f"\n  Sunucunun dedigi: {e}")
        return 1
    except smtplib.SMTPSenderRefused as e:
        print("\nHATA: Gonderen adres reddedildi.")
        print("  MAIL_FROM, SMTP_USER ile ayni olmali — sahibi olmadiginiz bir")
        print("  adresten gonderemezsiniz.")
        print(f"\n  Sunucunun dedigi: {e}")
        return 1
    except smtplib.SMTPRecipientsRefused as e:
        print("\nHATA: Alici adres reddedildi. Adresi kontrol edin.")
        print(f"\n  Sunucunun dedigi: {e}")
        return 1
    except (socket.timeout, TimeoutError):
        print("\nHATA: Sunucuya baglanilamadi (zaman asimi).")
        print("  Host/port yanlis olabilir ya da aginiz 587 portunu engelliyor")
        print("  olabilir (bazi kampus/kurum aglari SMTP portlarini kapatir).")
        return 1
    except (ConnectionRefusedError, OSError) as e:
        print("\nHATA: Baglanti kurulamadi.")
        print("  Mailpit ayarlarindaysaniz Mailpit calismiyor olabilir")
        print("  (docker compose up -d mailpit).")
        print(f"\n  Ayrinti: {e}")
        return 1

    print("\nBASARILI: mail gonderildi.")
    if settings.smtp_host == "localhost":
        print("Mailpit arayuzunden okuyun: http://localhost:8025")
    else:
        print("Gelen kutusunu kontrol edin (ilk gonderimlerde spam klasorune de bakin).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
