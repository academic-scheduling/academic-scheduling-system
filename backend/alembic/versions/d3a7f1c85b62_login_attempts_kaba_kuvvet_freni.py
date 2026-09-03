"""login_attempts — basarisiz giris denemesi defteri (kaba kuvvet freni)

NEDEN VAR
---------
Sifre sifirlama ucu iki katmanla korunuyordu (K-44: CAPTCHA + saatlik sinir),
ama /auth/login hicbiriyle korunmuyordu: yanlis parola hicbir yere yazilmadigi
icin sinirsizca denenebiliyordu. Belgelenmis bir varsayilan yonetici parolasi
da bulundugundan, acik uctaki en ucuz saldiri buydu.

Sifirlamada sayac icin ayri tabloya gerek yoktu (her talep zaten
password_reset_tokens'a bir satir yaziyordu). Giriste boyle dogal bir defter
yok -- basarisiz deneme hicbir iz birakmiyordu. Bu tablo o izi acar.

E-POSTA NEDEN HAM DEGIL
-----------------------
Tablo var olmayan adresleri de kaydeder (saldirgan rastgele adres dener). Ham
biriktirmek, sisteme hic kayitli olmayan insanlarin adreslerinden bir liste
uretirdi. sha256 saymaya yeter, listeyi uretmez.

Revision ID: d3a7f1c85b62
Revises: c1f5a83b6d20
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3a7f1c85b62'
down_revision: Union[str, None] = 'c1f5a83b6d20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "login_attempts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        # sha256 hex = 64 karakter, sabit.
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        # 45 karakter: IPv6'nin en uzun metin gosterimi
        # (IPv4-gomulu bicim, "::ffff:255.255.255.255").
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # Iki sayim da (adrese gore, IP'ye gore) zaman penceresiyle birlikte yapilir;
    # bilesik indeksler o iki sorguyu tek gecisde karsilar.
    op.create_index(
        "idx_login_attempts_email", "login_attempts", ["email_hash", "created_at"]
    )
    op.create_index("idx_login_attempts_ip", "login_attempts", ["ip", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_login_attempts_ip", table_name="login_attempts")
    op.drop_index("idx_login_attempts_email", table_name="login_attempts")
    op.drop_table("login_attempts")
