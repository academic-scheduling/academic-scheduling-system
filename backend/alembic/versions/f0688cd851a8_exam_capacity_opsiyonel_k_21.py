"""exam_capacity opsiyonel (K-21)

Revision ID: f0688cd851a8
Revises: f4a9c1d27b3e
Create Date: 2026-07-14 14:29:53.386487

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f0688cd851a8'
down_revision: Union[str, None] = 'f4a9c1d27b3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # [K-21] exam_capacity artik opsiyonel: NULL = sinav dersligi degil/henuz girilmedi
    op.alter_column('classrooms', 'exam_capacity', nullable=True)


def downgrade() -> None:
    # NULL'lari eski varsayilana (capacity) cekip NOT NULL'a geri don
    op.execute("UPDATE classrooms SET exam_capacity = capacity WHERE exam_capacity IS NULL")
    op.alter_column('classrooms', 'exam_capacity', nullable=False)