"""K-43 password_reset_tokens + audit action uzunlugu

Revision ID: a1fc8eee1f4c
Revises: b8d52fa03c47
Create Date: 2026-07-29 10:14:33.154930

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1fc8eee1f4c'
down_revision: Union[str, None] = 'b8d52fa03c47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # K-43 · Sifre sifirlama.
    #
    # 1) password_reset_tokens: invitation_tokens'in ikizi ama AYRI tablo.
    #    Tek tabloda 'purpose' kolonuyla tutulsalardi bir davet token'iyla
    #    sifre sifirlama (veya tersi) mumkun olurdu; ayri tablo bu karismayi
    #    sema duzeyinde imkansiz kilar. ondelete=CASCADE: hesap silinince
    #    (yalniz PENDING silinebilir, K-34) token'i da gider.
    #
    # 2) audit_logs.action 10 -> 20 karakter: yeni eylemler RESET_REQUEST (13)
    #    ve RESET_PASSWORD (14) VARCHAR(10)'a SIGMIYORDU. Genisletme veri
    #    kaybetmez (mevcut degerlerin en uzunu 'ACTIVATE' = 8).
    op.create_table('password_reset_tokens',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('user_id', sa.BigInteger(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.alter_column('audit_logs', 'action',
               existing_type=sa.VARCHAR(length=10),
               type_=sa.String(length=20),
               existing_nullable=False)
    # ### end Alembic commands ###


def downgrade() -> None:
    # DIKKAT: action kolonu 20 -> 10'a donerken RESET_* satirlari varsa
    # Postgres bu ALTER'i reddeder (veri sigmaz). Geri alinacaksa once o
    # satirlar temizlenmeli; sessiz veri kaybi yerine acik hata dogru davranis.
    op.alter_column('audit_logs', 'action',
               existing_type=sa.String(length=20),
               type_=sa.VARCHAR(length=10),
               existing_nullable=False)
    op.drop_table('password_reset_tokens')
    # ### end Alembic commands ###
