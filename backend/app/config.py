from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Tum ayarlar .env dosyasindan okunur (guvenlik sarti: hard-code yok)."""

    database_url: str = "postgresql+psycopg://app:app_dev_password@localhost:5432/scheduling"
    secret_key: str = "dev-only-secret"
    allowed_email_domain: str = "muh.example.edu.tr"
    smtp_host: str = "localhost"
    smtp_port: int = 1025

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()