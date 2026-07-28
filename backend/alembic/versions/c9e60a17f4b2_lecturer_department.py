"""lecturers.department_id — hocanin bagli oldugu bolum

Hoca artik bir bolume baglanir (bilgi/etiket). Nullable + SET NULL: bolum
silinirse hoca kalir, bagi bosalir. Hoca baska bolumlerin subelerine de
atanabilir (K-08 paylasim); bu kolon kisit degil, asil bolum etiketidir.

Revision ID: c9e60a17f4b2
Revises: b8d52fa03c47
Create Date: 2026-07-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9e60a17f4b2'
down_revision: Union[str, None] = 'b8d52fa03c47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'lecturers',
        sa.Column('department_id', sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        'fk_lecturers_department_id',
        'lecturers', 'departments',
        ['department_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_lecturers_department_id', 'lecturers', type_='foreignkey')
    op.drop_column('lecturers', 'department_id')
