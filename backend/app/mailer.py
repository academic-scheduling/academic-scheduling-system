"""Sistemin tek e-posta cikis noktasi.

Her mail iki bicimde birden gonderilir (multipart/alternative): duz metin ve
HTML. Alicinin istemcisi hangisini destekliyorsa onu gosterir. Duz metin
sadece bir yedek degil, sartname geregi: HTML'i kapatan istemciler, ekran
okuyucular ve bazi kurumsal filtreler duz metni okur; HTML'i olmayan bir mail
ise "otomatik uretilmis, ozensiz" izlenimi birakir ve spam puanina katki yapar.
"""

import html
import smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from app.config import settings

# E-posta istemcilerinin cogu harici stylesheet, <style> blogu ve web font
# yuklemez; guvenilir olan tek yontem her elemana satir ici stil vermektir.
# Yerlesim de <div>/flex ile degil <table> ile kurulur (Outlook'un Word tabanli
# motoru modern CSS'i uygulamaz). Asagisi bu yuzden "eski moda" gorunur.
_YAZI_TIPI = (
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "Helvetica, Arial, sans-serif"
)
_METIN = "#1f2933"
_SOLUK = "#6b7280"
_CIZGI = "#e3e6ea"
_VURGU = "#2f6feb"


def _html_sayfa(
    baslik: str,
    paragraflar: list[str],
    buton_metni: str,
    buton_url: str,
    dipnotlar: list[str],
) -> str:
    """Ortak HTML iskeleti — davet ve sifre sifirlama ayni gorunumu paylasir.

    paragraflar ve dipnotlar HTML olarak DEGIL duz metin olarak beklenir;
    burada kacislanir. Kullanici adi ve e-posta adresi veritabanindan gelir,
    yani icinde `<` gecen bir isim maili bozabilir ya da istenmeyen isaretleme
    enjekte edebilir. Kacislama cagiranin hatirlamasi gereken bir sey olmasin
    diye tek yerde, burada yapilir.
    """
    def p(metin: str) -> str:
        return (
            f'<tr><td style="padding:0 32px 16px;font-family:{_YAZI_TIPI};'
            f'font-size:15px;line-height:1.6;color:{_METIN};">'
            f"{html.escape(metin)}</td></tr>"
        )

    def dipnot(metin: str) -> str:
        return (
            f'<tr><td style="padding:0 32px 12px;font-family:{_YAZI_TIPI};'
            f'font-size:13px;line-height:1.6;color:{_SOLUK};">'
            f"{html.escape(metin)}</td></tr>"
        )

    guvenli_url = html.escape(buton_url, quote=True)

    return f"""<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{html.escape(baslik)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
       style="max-width:600px;width:100%;background-color:#ffffff;
              border:1px solid {_CIZGI};border-radius:8px;">

  <tr><td style="padding:28px 32px 0;font-family:{_YAZI_TIPI};font-size:12px;
                 letter-spacing:0.08em;text-transform:uppercase;color:{_SOLUK};">
    Akademik Planlama Sistemi
  </td></tr>

  <tr><td style="padding:10px 32px 20px;font-family:{_YAZI_TIPI};font-size:20px;
                 line-height:1.35;font-weight:600;color:#111827;">
    {html.escape(baslik)}
  </td></tr>

  {"".join(p(x) for x in paragraflar)}

  <tr><td style="padding:8px 32px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background-color:{_VURGU};border-radius:6px;">
        <a href="{guvenli_url}"
           style="display:inline-block;padding:12px 26px;font-family:{_YAZI_TIPI};
                  font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
          {html.escape(buton_metni)}
        </a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 32px 8px;font-family:{_YAZI_TIPI};font-size:13px;
                 line-height:1.6;color:{_SOLUK};">
    Düğme çalışmazsa aşağıdaki adresi tarayıcınızın adres çubuğuna yapıştırın:
  </td></tr>
  <tr><td style="padding:0 32px 24px;font-family:{_YAZI_TIPI};font-size:13px;
                 line-height:1.5;color:{_VURGU};word-break:break-all;">
    {guvenli_url}
  </td></tr>

  <tr><td style="padding:0 32px;"><div style="height:1px;background-color:{_CIZGI};
       line-height:1px;font-size:0;">&nbsp;</div></td></tr>
  <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>

  {"".join(dipnot(x) for x in dipnotlar)}

  <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"""


def _send(
    to_email: str,
    subject: str,
    body: str,
    reply_to: str | None = None,
    html_body: str | None = None,
) -> None:
    """Tek SMTP gonderim yolu — davet ve sifre sifirlama ayni yerden gecer.

    Baglanti/TLS/kimlik mantigi tek yerde dursun: ikinci bir mail turu
    eklenirken ayni bloklar kopyalanirsa biri duzeltildiginde digeri
    unutulur (ornegin timeout).

    reply_to (K-84): doldurulursa alicinin "Yanitla" tusu bu adrese gider.
    Gonderen (From) HER ZAMAN sistemin kendi hesabi kalir. Davet edenin
    adresini From'a yazmak ilk bakista daha dogal gorunur ama calismaz:
    alici sunucusu "bu sunucu bu adres adina gondermeye yetkili mi?" diye
    sorar (SPF/DKIM), cevap hayir olur ve mail spam'e duser ya da reddedilir.
    Bu yuzden kimin davet ettigi bilgisi From'da degil, Reply-To basliginda
    ve mailin metninde tasinir.

    html_body: verilirse mail multipart/alternative olur. Sira onemli --
    once duz metin (set_content), sonra HTML (add_alternative): RFC 2046,
    en zengin bicimin SONDA olmasini soyler, istemciler de sonuncuyu secer.
    """
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to_email
    msg["Subject"] = subject

    # Date ve Message-ID: RFC 5322 bunlari sart kosar ama ne EmailMessage ne de
    # smtplib.send_message kendiliginden eklemez. Cogu saglayici eksikse kendisi
    # tamamlar; tamamlamayan bir aliciya dustugunde ya da spam puani hesaplanirken
    # eksiklik aleyhe isler. Uretmesi bedava, bu yuzden kendimiz koyuyoruz.
    # Message-ID'nin alan adi gonderen adresinden turetilir — varsayilan davranis
    # makinenin host adini kullanir ve sunucunun ic adini disari sizdirir.
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=settings.mail_from.rsplit("@", 1)[-1])

    if reply_to:
        msg["Reply-To"] = reply_to

    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

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

    Reply-To YOK (davetten farki): sifre sifirlamayi bir kisi degil kullanicinin
    kendisi baslatir, yanitlanacak bir muhatap yoktur.
    """
    reset_link = f"{settings.frontend_base_url}/reset-password?token={raw_token}"
    saat = settings.password_reset_expire_hours

    paragraflar = [
        f"Merhaba {to_name},",
        "Hesabınız için şifre sıfırlama talebinde bulunuldu. "
        "Yeni şifrenizi belirlemek için aşağıdaki bağlantıyı kullanın.",
    ]
    dipnotlar = [
        f"Bu bağlantı {saat} saat geçerlidir ve yalnızca bir kez kullanılabilir.",
        "Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz; "
        "şifreniz değişmez.",
    ]

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
        html_body=_html_sayfa(
            "Şifre sıfırlama",
            paragraflar,
            "Yeni şifremi belirle",
            reset_link,
            dipnotlar,
        ),
    )


def send_invitation_email(
    to_email: str,
    to_name: str,
    raw_token: str,
    inviter_name: str | None = None,
    inviter_email: str | None = None,
) -> None:
    """Aktivasyon linkli davet maili gönderir.

    Aynı fonksiyon iki ortamda da çalışır:
      - Geliştirme: Mailpit (kimlik doğrulama yok, TLS yok) — .env'de bu üç
        ayar boş kaldığı için _send'deki iki blok atlanır, davranış eskisiyle
        birebir aynı kalır.
      - Gerçek SMTP: SMTP_STARTTLS=true + SMTP_USER/SMTP_PASSWORD doldurulur.
        Sağlayıcıların tamamı şifrelenmemiş ve kimliksiz gönderimi reddeder.

    inviter_name / inviter_email (K-84): daveti gönderen yöneticinin kimliği.
    İkisi de opsiyonel — verilmezse mail eski metniyle, eski davranışıyla
    gider (mevcut testler ve olası başka çağrılar bundan etkilenmez).
    Verildiğinde: metne "X sizi davet etti" satırı girer ve yanıtlar davet
    edene yönlenir. Davet edilen kişinin muhatabı sistem değil, kendisini
    davet eden kişidir — "bu maili neden aldım?" sorusunun cevabı mailin
    içinde olmalı.
    """
    activation_link = f"{settings.frontend_base_url}/activate?token={raw_token}"
    gun = settings.invitation_expire_hours // 24

    if inviter_name:
        davet_satiri = f"{inviter_name} sizi akademik planlama sistemine davet etti."
    else:
        davet_satiri = "Akademik planlama sistemine davet edildiniz."

    govde = (
        f"Merhaba {to_name},\n\n"
        f"{davet_satiri} "
        f"Hesabınızı aktifleştirip şifrenizi belirlemek için:\n\n"
        f"{activation_link}\n\n"
        f"Bu bağlantı {gun} gün geçerlidir.\n"
    )
    dipnotlar = [f"Bu bağlantı {gun} gün geçerlidir."]

    if inviter_email:
        govde += (
            f"\nBu davetle ilgili sorularınız için bu e-postayı "
            f"yanıtlayabilirsiniz ({inviter_email}).\n"
        )
        dipnotlar.append(
            f"Bu davetle ilgili sorularınız için bu e-postayı yanıtlayabilirsiniz "
            f"({inviter_email})."
        )

    _send(
        to_email,
        "Akademik Planlama Sistemi - Hesap Daveti",
        govde,
        reply_to=inviter_email,
        html_body=_html_sayfa(
            "Hesap daveti",
            [
                f"Merhaba {to_name},",
                f"{davet_satiri} Hesabınızı aktifleştirip şifrenizi belirlemek "
                f"için aşağıdaki düğmeyi kullanın.",
            ],
            "Hesabımı aktifleştir",
            activation_link,
            dipnotlar,
        ),
    )
