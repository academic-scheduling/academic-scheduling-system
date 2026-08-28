"""K-83 draft_approvers — onay talebinin alicilari

K-83 oncesi onaya gonderilen taslak, o bolumde onay yetkisi olan HERKESIN
(ve her adminin) kuyruguna dusuyordu; gonderenin adres uzerinde soz hakki
yoktu. Bu tablo talebi adresli hale getirir: gonderen, tasla in bolumundeki
onay yetkilileri + tum adminler arasindan alicilari secer, kuyruk yalnizca
burada adi gecenlere acilir.

Ayri tablo, cunku iliski cok-a-cok: bir talep birden cok yetkiliye gider
("hangisi once bakarsa"), bir yetkili birden cok talep alir. Taslakta tek bir
`assigned_to` kolonu kuyrugu tek kisiye kilitler, o kisi izinliyken is durur.

Geriye donuk kayit: goc SIRASINDA var olan PENDING taslaklar icin alici
uretilmez. Bunun yerine tablo bos kalir ve kuyruk sorgusu (K-83) alicisi
olmayan bekleyen talebi ESKI kurala gore (bayrak + bolum uyeligi) gosterir;
boylece gecis aninda beklemedeki hicbir talep goruntlerden dusmez.

Revision ID: b8e4d2f7c913
Revises: a3c7e1d9b542
Create Date: 2026-08-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e4d2f7c913'
down_revision: Union[str, None] = 'a3c7e1d9b542'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'draft_approvers',
        sa.Column('draft_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(['draft_id'], ['schedule_drafts.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('draft_id', 'user_id'),
    )
    # "Bana gelen talepler" sorgusunun girdigi sutun — kuyrugun sicak yolu.
    op.create_index('idx_draft_approvers_user', 'draft_approvers', ['user_id'])


def downgrade() -> None:
    op.drop_index('idx_draft_approvers_user', table_name='draft_approvers')
    op.drop_table('draft_approvers')
