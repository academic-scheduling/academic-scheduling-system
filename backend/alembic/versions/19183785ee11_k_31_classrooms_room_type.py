"""K-31 classrooms.room_type

Revision ID: 19183785ee11
Revises: 295cea40dd89
Create Date: 2026-07-21 15:35:45.566778

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '19183785ee11'
down_revision: Union[str, None] = '295cea40dd89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Autogenerate yalniz add_column uretti; PostgreSQL'de ENUM TIPI once
    # ACIKCA yaratilmali (aksi halde: type "room_type" does not exist).
    room_type = sa.Enum('CLASSROOM', 'AMPHI', 'LAB', name='room_type')
    room_type.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'classrooms',
        sa.Column(
            'room_type',
            room_type,
            server_default=sa.text("'CLASSROOM'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('classrooms', 'room_type')
    # Tipi de birakma: kolon gidince yetim kalir, ikinci upgrade'de cakisir.
    sa.Enum(name='room_type').drop(op.get_bind(), checkfirst=True)
