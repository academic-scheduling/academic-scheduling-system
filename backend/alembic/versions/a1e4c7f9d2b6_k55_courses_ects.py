"""K-55 courses.ects (AKTS) kolonu

Ders duzeyinde AKTS/ECTS kredisi. NULLABLE — mevcut dersler ve elle ekleme
AKTS'siz olabilir; Bologna import'u doldurur. Cakisma matematigine girmez
(T+U+L gibi bilgi alani). Downgrade kolonu birakir.

Revision ID: a1e4c7f9d2b6
Revises: b8d2f4a6c1e3
Create Date: 2026-08-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1e4c7f9d2b6'
down_revision: Union[str, None] = 'b8d2f4a6c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'courses',
        sa.Column('ects', sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('courses', 'ects')
