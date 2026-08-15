"""K-71 lecturers.detail_url (akademik personel sayfasi linki)

Web import'ta kisinin detay sayfasindan (detail_url) alinir; elle eklerken
opsiyonel girilir. Yalniz GORUNTU (drawer'daki "Akademik sayfa" linki).

Nullable: elle eklenen ve bu goc oncesi kayitlarda deger yoktur.

Revision ID: c1a2b3d4e5f6
Revises: b8e4f1a09c2d
Create Date: 2026-08-14 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, None] = 'b8e4f1a09c2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'lecturers',
        sa.Column('detail_url', sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('lecturers', 'detail_url')
