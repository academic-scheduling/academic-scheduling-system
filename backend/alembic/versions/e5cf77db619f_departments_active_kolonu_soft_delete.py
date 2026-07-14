"""departments.active kolonu (soft delete)

Revision ID: e5cf77db619f
Revises: f0688cd851a8
Create Date: 2026-07-14 18:02:41.203608

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5cf77db619f'
down_revision: Union[str, None] = 'f0688cd851a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # departments soft delete icin active kolonu (K-02 tutarliligi).
    # server_default=true: mevcut satirlar otomatik aktif isaretlenir.
    op.add_column(
        'departments',
        sa.Column('active', sa.Boolean(), server_default=sa.text('true'),
                  nullable=False),
    )


def downgrade() -> None:
    op.drop_column('departments', 'active')
