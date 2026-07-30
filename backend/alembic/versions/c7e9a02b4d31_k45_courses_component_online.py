"""K-45 courses.{theory,practice,lab}_online

Bileşen bazında online bayrağı (K-45). Ders düzeyinde sabittir; senkron/asenkron
ayrımı haftalık girişte seçilir. Saati 0 olan bileşenin bayrağı router'da
zorla false tutulur.

Revision ID: c7e9a02b4d31
Revises: d1f7a3b8c25e
Create Date: 2026-07-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e9a02b4d31"
down_revision: Union[str, None] = "d1f7a3b8c25e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("courses", sa.Column(
        "theory_online", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("courses", sa.Column(
        "practice_online", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("courses", sa.Column(
        "lab_online", sa.Boolean(), server_default=sa.text("false"), nullable=False))


def downgrade() -> None:
    op.drop_column("courses", "lab_online")
    op.drop_column("courses", "practice_online")
    op.drop_column("courses", "theory_online")
