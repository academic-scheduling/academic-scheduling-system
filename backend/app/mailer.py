import smtplib
from email.message import EmailMessage
from app.config import settings

def _send(to_email: str, subject: str, body: str) -> None:
    """Tek SMTP gonderim yolu — davet ve sifre sifirlama ayni yerden gecer.

    Baglanti/TLS/kimlik mantigi tek yerde dursun: ikinci bir mail turu
    eklenirken ayni bloklar kopyalanirsa biri duzeltildiginde digeri
    unutulur (ornegin timeout).
    """
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    # timeout: Mailpit aynı makinede olduğu için gecikme sorun değildi; uzaktaki
    # bir sağlayıcı yanıt vermezse timeout'suz bağlantı isteği süresiz askıda
    # bırakır ve uç hiç dönmez.
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_starttls:
            server.starttls()
        # Kullanıcı adı boşsa login() çağırmıyoruz: Mailpit kimlik doğrulama
        # desteklemediği için boş login denemesi bağlantıyı düşürürdü.
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send_password_reset_email(to_email: str, to_name: str, raw_token: str) -> None:
    """Sifre sifirlama linkli mail (K-43).

    Link davet mailiyle ayni deseni izler; yalnizca route ve omur farkli.
    Frontend'in /reset-password route'u token'i query string'den okur —
    degisirse burasi da degisir (davet mailindeki /activate ile ayni sozlesme).
    """
    reset_link = f"{settings.frontend_base_url}/reset-password?token={raw_token}"
    saat = settings.password_reset_expire_hours
    _send(
        to_email,
        "Akademik Planlama Sistemi - Şifre Sıfırlama",
        f"Merhaba {to_name},\n\n"
        f"Hesabınız için şifre sıfırlama talebinde bulunuldu. "
        f"Yeni şifrenizi belirlemek için:\n\n"
        f"{reset_link}\n\n"
        f"Bu bağlantı {saat} saat geçerlidir ve yalnızca bir kez kullanılabilir.\n\n"
        f"Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; "
        f"şifreniz değişmez.\n",
    )


def send_invitation_email(to_email: str, to_name: str, raw_token: str) -> None:
    """Aktivasyon linkli davet maili gönderir.

    Aynı fonksiyon iki ortamda da çalışır:
      - Geliştirme: Mailpit (kimlik doğrulama yok, TLS yok) — .env'de bu üç
        ayar boş kaldığı için aşağıdaki iki blok atlanır, davranış eskisiyle
        birebir aynı kalır.
      - Gerçek SMTP: SMTP_STARTTLS=true + SMTP_USER/SMTP_PASSWORD doldurulur.
        Sağlayıcıların tamamı şifrelenmemiş ve kimliksiz gönderimi reddeder.
    """
    activation_link = f"{settings.frontend_base_url}/activate?token={raw_token}"
    _send(
        to_email,
        "Akademik Planlama Sistemi - Hesap Daveti",
        f"Merhaba {to_name},\n\n"
        f"Akademik planlama sistemine davet edildiniz. "
        f"Hesabınızı aktifleştirip şifrenizi belirlemek için:\n\n"
        f"{activation_link}\n\n"
        f"Bu bağlantı {settings.invitation_expire_hours // 24} gün geçerlidir.\n",
    )
