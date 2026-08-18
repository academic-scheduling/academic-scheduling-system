"""K-68 derslik kat alani (opsiyonel)

Revision ID: b8e4f1a09c2d
Revises: c4a70f2d9e83
Create Date: 2026-08-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e4f1a09c2d'
down_revision: Union[str, None] = 'c4a70f2d9e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # [K-68] kat: opsiyonel konum bilgisi (NULL = girilmemis). Motor okumaz.
    op.add_column('classrooms', sa.Column('floor', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('classrooms', 'floor')
