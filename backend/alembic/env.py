"""Alembic ortam betigi (env.py).

Her 'alembic ...' komutunda calisir. Gorevi:
  1) Uygulama ayarlarindan (settings) veritabani URL'ini almak
  2) Modellerin kayit defterini (Base.metadata) 'hedef sema' olarak vermek
Boylece autogenerate, modeller ile veritabanini karsilastirip fark uretebilir.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# --- Projeye ozgu eklemeler ---
# prepend_sys_path = . (alembic.ini) sayesinde 'app' paketi import edilebilir.
from app.config import settings
from app.models import Base

# Alembic Config nesnesi: alembic.ini'deki degerlere erisim saglar.
config = context.config

# Baglanti URL'ini alembic.ini'deki yer tutucu yerine settings'ten aliyoruz
# (guvenlik: sifre koda/ini'ye gomulmez, tek kaynak .env/settings).
config.set_main_option("sqlalchemy.url", settings.database_url)

# Log yapilandirmasi (alembic.ini icindeki [loggers] vb.).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate'in 'olmasi gereken sema' olarak bakacagi hedef:
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Baglanti kurmadan, sadece SQL metni ureten mod (--sql)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,  # sutun tipi degisikliklerini de farket
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Gercek veritabanina baglanip migration'lari uygulayan normal mod."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
