"""K-38 audit_logs.change_summary

UPDATE satirlarinda NEYIN degistigi: "Durum: Aktif → Pasif" (K-38).
entity_label "hangi kayit" sorusunu cevapliyordu; bu kolon "ne degisti"
sorusunu cevaplar. Ikisi ayri sutunda durur, tek metne sikistirilmaz.

Nullable: CREATE/DELETE satirlarinda degisiklik kavrami yok, ayrica bu
kolondan once yazilmis UPDATE satirlarinda deger uretilemez (eski degerler
hicbir yerde saklanmiyordu).

Revision ID: b8d52fa03c47
Revises: a7c41e9b2d18
Create Date: 2026-07-23 14:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d52fa03c47'
down_revision: Union[str, None] = 'a7c41e9b2d18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'audit_logs',
        sa.Column('change_summary', sa.String(length=300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('audit_logs', 'change_summary')
