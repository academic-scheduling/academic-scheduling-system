"""K-36 audit_logs.entity_label

Islem anindaki insan-okur ad log satirina yazilir; boylece silinen kaydin
adi kaybolmaz ve degistirilen ad o gunku haliyle kalir (K-36).

Nullable: bu kolondan ONCE yazilmis satirlarda deger yok ve geriye donuk
uretilemez -- silinmis kayitlarin adi zaten hicbir yerde durmuyor. Eski
satirlar okuma aninda cozulmeye devam eder (varliklari duruyorsa).

Revision ID: a7c41e9b2d18
Revises: 19183785ee11
Create Date: 2026-07-23 13:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c41e9b2d18'
down_revision: Union[str, None] = '19183785ee11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'audit_logs',
        sa.Column('entity_label', sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('audit_logs', 'entity_label')
