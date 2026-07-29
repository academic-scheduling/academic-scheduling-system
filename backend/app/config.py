from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Tum ayarlar .env dosyasindan okunur (guvenlik sarti: hard-code yok)."""

    database_url: str = "postgresql+psycopg://app:app_dev_password@localhost:5432/scheduling"
    secret_key: str = "dev-only-secret"
    allowed_email_domains: str = "muh.example.edu.tr"
    smtp_host: str = "localhost"
    smtp_port: int = 1025

    # Mailpit ne kimlik dogrulama ne TLS ister; gercek saglayicilarin hepsi
    # ikisini de sart kosar. Bos birakilirsa dev davranisi aynen surer,
    # doldurulursa gercek SMTP'ye gecilir -- brief'in "kod yapisi gercek SMTP
    # yapilandirmasina izin versin" sarti kodu degistirmeden karsilanir.
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    invitation_expire_hours: int = 168          # 7 gün = 7 * 24

    # Sifre sifirlama linki davetten KISA omurludur (K-43): calinan bir
    # sifirlama linki AKTIF bir hesabi dogrudan ele gecirir; davet linki ise
    # henuz sahibi olmayan bir hesabi acar. 2 saat, kullanicinin postasini
    # acip tiklamasi icin fazlasiyla yeterli.
    password_reset_expire_hours: int = 2

    # K-44 · CAPTCHA. BOS = dogrulama atlanir (yerel gelistirme ve testler
    # internetsiz calissin). Uretimde asagidaki denetci ZORUNLU tutar.
    recaptcha_secret_key: str = ""

    # K-44 · Ayni hesap icin saatte en fazla kac sifirlama maili. CAPTCHA'yi
    # elle gecen birine karsi ikinci katman: mail bombardimanini durdurur.
    password_reset_max_per_hour: int = 3
    frontend_base_url: str = "http://localhost:5173"
    mail_from: str = "no-reply@muh.example.edu.tr"

    # Tarayicinin API'yi hangi kaynaklardan cagirabilecegi. Dev'de Vite sunucusu,
    # yayinda gercek alan adi. Virgulle ayrilir (allowed_email_domains ile ayni desen).
    cors_origins: str = "http://localhost:5173"

    # "production" degerinde, asagidaki dogrulama dev varsayilanlariyla
    # acilmayi reddeder. Varsayilan "development" oldugu icin mevcut yerel
    # kurulumlar ve testler bundan etkilenmez.
    environment: str = "development"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @model_validator(mode="after")
    def _uretim_ayarlari_gercek_mi(self) -> "Settings":
        """Yayinda dev varsayilanlariyla acilmayi reddeder.

        Sessizce dev degeriyle yayina cikmak, sessiz kalan en pahali hatadir:
        'dev-only-secret' ile imzalanan JWT'yi kaynak koda bakan herkes taklit
        edip admin olabilir. Uygulamanin hic acilmamasi, acilip guvensiz
        calismasindan iyidir -- bu yuzden uyari degil, hata.
        """
        if not self.is_production:
            return self

        hatalar: list[str] = []

        if self.secret_key == "dev-only-secret":
            hatalar.append("SECRET_KEY hala dev varsayilani")
        elif len(self.secret_key) < 32:
            # HS256 imzasinin gucu anahtarin uzunlugu kadardir; kisa anahtar
            # cevrimdisi denemeyle kirilabilir.
            hatalar.append("SECRET_KEY en az 32 karakter olmali")

        if "app_dev_password" in self.database_url:
            hatalar.append("DATABASE_URL hala dev sifresini tasiyor")

        if "localhost" in self.frontend_base_url:
            # Davet mailindeki aktivasyon linki buradan uretilir; localhost
            # kalirsa davet edilen kisi kendi makinesine yonlendirilir.
            hatalar.append("FRONTEND_BASE_URL hala localhost")

        if any("localhost" in o for o in self.cors_origin_list):
            hatalar.append("CORS_ORIGINS hala localhost iceriyor")

        if not self.recaptcha_secret_key:
            # K-44: CAPTCHA dogrulamasi anahtar yokken ATLANIR. Bu, yerel
            # gelistirmede dogru davranis ama yayinda public bir ucu
            # (forgot-password) korumasiz birakir — sessizce degil, acilista
            # patlayarak fark edilmeli.
            hatalar.append("RECAPTCHA_SECRET_KEY bos (sifre sifirlama korumasiz kalir)")

        if hatalar:
            raise ValueError(
                "ENVIRONMENT=production ile acilamaz — " + "; ".join(hatalar)
            )
        return self


settings = Settings()
