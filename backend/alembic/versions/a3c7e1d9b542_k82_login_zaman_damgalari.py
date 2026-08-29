"""K-82 users.last_login_at + previous_login_at

Iki kolon, iki ayri soru:
  last_login_at     -> "bu hesap en son ne zaman girdi" (Yonetim tablosu sutunu)
  previous_login_at -> "siz bundan onceki sefer ne zaman girdiniz" (kimlik karti)

Tek kolonla yetinilseydi kullanicinin kendi kimlik karti hep ICINDE BULUNDUGU
oturumun zamanini gosterirdi ("az once"), yani hicbir sey anlatmazdi.

Ikisi de nullable: davet edilmis ama hic giris yapmamis (PENDING) hesapta ve
bu goc oncesi var olan hesaplarda deger yoktur.

Revision ID: a3c7e1d9b542
Revises: d2f4a6b8c0e1
Create Date: 2026-08-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c7e1d9b542'
down_revision: Union[str, None] = 'd2f4a6b8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('previous_login_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'previous_login_at')
    op.drop_column('users', 'last_login_at')
