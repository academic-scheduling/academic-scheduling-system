"""K-48: ortak (servis) dersler — courses.is_common + course_cohorts

Fizik/Matematik/Turkce gibi birden cok bolumun aldigi ortak dersler icin. Bir
dersin cohort'u artik tek (bolum, yil, donem) degil, bir KUME: dersin kendi
birincil cohort'u (courses satirinda) + course_cohorts'taki ek cohort'lar.
Motorun cohort kurallari (W3/W4, E4a/E4b, X2) 'ayni cohort mu' testini bu kume
uzerinden kesisim olarak yapar.

server_default='false': mevcut dersler ortak DEGIL; ek cohort satiri olmadigindan
efektif cohort'lari tek elemanli kalir -> davranis birebir korunur.

Revision ID: c7e2a9f4b6d1
Revises: a3c9e1f5b7d2
Create Date: 2026-07-31 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c7e2a9f4b6d1"
down_revision: Union[str, None] = "a3c9e1f5b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("is_common", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "course_cohorts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("course_id", sa.BigInteger(), nullable=False),
        sa.Column("department_id", sa.BigInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column(
            "semester",
            # Tip zaten var (courses/exams kullaniyor) -> yeniden CREATE TYPE etme.
            postgresql.ENUM("FALL", "SPRING", "SUMMER", name="semester_type", create_type=False),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "course_id", "department_id", "year", "semester",
            name="uq_course_cohorts_identity",
        ),
        sa.CheckConstraint("year BETWEEN 1 AND 6", name="ck_course_cohorts_year_range"),
    )


def downgrade() -> None:
    op.drop_table("course_cohorts")
    op.drop_column("courses", "is_common")
