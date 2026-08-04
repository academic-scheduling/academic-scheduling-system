"""K-50 lecturers.duty_unit + cadre_unit (fakulte web import)

Detay sayfasindan okunan iki serbest-metin birim: "Gorev Birimi" (fiilen ders
verdigi bolum) ve "Kadro Birimi" (resmi kadro). Ikisi farkli olabilir; ikisi de
GORUNTU icindir, cakisma matematigi department_id/lecturer_id kullanir.

Nullable: elle eklenen (40/a) ve K-50 oncesi kayitlarda deger yoktur.

Revision ID: f7b3c1a9e2d4
Revises: c7e2a9f4b6d1
Create Date: 2026-07-29 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b3c1a9e2d4'
down_revision: Union[str, None] = 'c7e2a9f4b6d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'lecturers',
        sa.Column('duty_unit', sa.String(length=200), nullable=True),
    )
    op.add_column(
        'lecturers',
        sa.Column('cadre_unit', sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('lecturers', 'cadre_unit')
    op.drop_column('lecturers', 'duty_unit')
