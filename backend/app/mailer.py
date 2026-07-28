import smtplib
from email.message import EmailMessage
from app.config import settings

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

    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to_email
    msg["Subject"] = "Akademik Planlama Sistemi - Hesap Daveti"
    msg.set_content(
        f"Merhaba {to_name},\n\n"
        f"Akademik planlama sistemine davet edildiniz. "
        f"Hesabınızı aktifleştirip şifrenizi belirlemek için:\n\n"
        f"{activation_link}\n\n"
        f"Bu bağlantı {settings.invitation_expire_hours // 24} gün geçerlidir.\n"
    )

    # timeout: Mailpit aynı makinede olduğu için gecikme sorun değildi; uzaktaki
    # bir sağlayıcı yanıt vermezse timeout'suz bağlantı isteği süresiz askıda
    # bırakır ve davet ucu hiç dönmez.
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_starttls:
            server.starttls()
        # Kullanıcı adı boşsa login() çağırmıyoruz: Mailpit kimlik doğrulama
        # desteklemediği için boş login denemesi bağlantıyı düşürürdü.
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)
