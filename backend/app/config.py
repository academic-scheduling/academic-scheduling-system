from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Tum ayarlar .env dosyasindan okunur (guvenlik sarti: hard-code yok)."""

    database_url: str = "postgresql+psycopg://app:app_dev_password@localhost:5432/scheduling"
    secret_key: str = "dev-only-secret"
    allowed_email_domains: str = "muh.example.edu.tr"
    smtp_host: str = "localhost"
    smtp_port: int = 1025

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    invitation_expire_hours: int = 168          # 7 gün = 7 * 24
    frontend_base_url: str = "http://localhost:5173"
    mail_from: str = "no-reply@muh.example.edu.tr"

settings = Settings()