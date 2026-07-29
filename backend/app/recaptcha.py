"""Google reCAPTCHA v2 dogrulamasi (K-44).

Sifre sifirlama ucu public ve HER cagrida mail gonderiyor; kimliksiz bir
ucun otomatik istismara acik olmasi demek. CAPTCHA bu istismarin ilk
katmanini keser (ikinci katman: e-posta basina saatlik talep siniri).

TASARIM: anahtar tanimli DEGILSE dogrulama ATLANIR.
  - Yerel gelistirme ve testler internet olmadan calisir (mevcut 15 test
    ve demo makinesi bundan etkilenmez).
  - Yayinda korumasiz kalmamasi icin config.py'nin uretim denetcisi
    ENVIRONMENT=production iken bu anahtari ZORUNLU tutar.
Yani "acik unutuldu" hatasi sessizce degil, acilista patlayarak fark edilir.
"""

import httpx

from app.config import settings

VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"


def is_enabled() -> bool:
    """Dogrulama devrede mi? Secret bos ise degil (yerel gelistirme)."""
    return bool(settings.recaptcha_secret_key)


def verify_captcha(token: str | None, remote_ip: str | None = None) -> bool:
    """Istemciden gelen CAPTCHA cevabini Google'a dogrulatir.

    Doner: True = gecti (veya dogrulama kapali), False = gecmedi.

    Ag hatasinda False doner — "Google'a ulasamadik" durumunda istegi
    GECIRMEK, korumayi Google'i erisilemez kilarak (veya sadece sansla)
    atlatilabilir hale getirirdi. Kapali kapi acik kapidan iyidir; kullanici
    tekrar dener.
    """
    if not is_enabled():
        return True

    if not token:
        return False

    data = {"secret": settings.recaptcha_secret_key, "response": token}
    if remote_ip:
        # Opsiyonel ama Google oneriyor: ayni token'in baska bir IP'den
        # tekrar kullanilmasini tespit etmesine yardim eder.
        data["remoteip"] = remote_ip

    try:
        # timeout: mailer'daki ayni gerekce — yanit vermeyen bir ucun
        # istegi suresiz askida birakmasi kabul edilemez.
        response = httpx.post(VERIFY_URL, data=data, timeout=10)
        response.raise_for_status()
        return bool(response.json().get("success", False))
    except Exception:
        return False
