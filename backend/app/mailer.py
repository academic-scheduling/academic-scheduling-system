import smtplib
from email.message import EmailMessage
from app.config import settings

def send_invitation_email(to_email: str, to_name: str, raw_token: str) -> None:
    """Mailpit'e (dev SMTP) aktivasyon linkli davet maili gönderir."""
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

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.send_message(msg)
