"""departments.name_en + faculty_en — resmi sinav programi ingilizce basligi icin

Resmi sinav programi ciktisi (universite formati) basligi ingilizce basar:
"... FACULTY OF ENGINEERING" / "DEPARTMENT OF COMPUTER ENGINEERING ...".
Bu adlar sistemde TR tutuldugundan ingilizce karsiliklari bolumde saklanir.
Ikisi de nullable; bos ise export TR ad'a duser.

Revision ID: d1f7a3b8c25e
Revises: c9e60a17f4b2
Create Date: 2026-07-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1f7a3b8c25e'
down_revision: Union[str, None] = 'c9e60a17f4b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('departments', sa.Column('name_en', sa.String(length=200), nullable=True))
    op.add_column('departments', sa.Column('faculty_en', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('departments', 'faculty_en')
    op.drop_column('departments', 'name_en')
