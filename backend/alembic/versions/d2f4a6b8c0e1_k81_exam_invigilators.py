"""K-81: exam_invigilators — sinav gozetmenleri (0..N, istege bagli)

Sadece EKLEME: `exams` tablosuna dokunulmuyor, `lecturer_id` (sorumlu) oldugu
gibi kaliyor. Bu yuzden geri alma da veri kaybetmiyor -- yalniz gozetmen
atamalari gider, sinavlarin kendisi ve sorumlulari duruyor.

Revision ID: d2f4a6b8c0e1
Revises: c1a2b3d4e5f6
"""

import sqlalchemy as sa
from alembic import op

revision = "d2f4a6b8c0e1"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exam_invigilators",
        sa.Column("exam_id", sa.BigInteger(), nullable=False),
        sa.Column("lecturer_id", sa.BigInteger(), nullable=False),
        # CASCADE: sinav silinince gozetmen satirlari da gider.
        sa.ForeignKeyConstraint(["exam_id"], ["exams.id"], ondelete="CASCADE"),
        # RESTRICT: gozetmenligi olan hoca silinemez -- sorumluyla ayni koruma.
        sa.ForeignKeyConstraint(["lecturer_id"], ["lecturers.id"], ondelete="RESTRICT"),
        # Birlesik PK ayni hocayi ayni sinava iki kez eklemeyi engeller.
        sa.PrimaryKeyConstraint("exam_id", "lecturer_id"),
    )
    # Ters yon: "bu hoca nerelerde gozetmen?" -- E9 taramasi ve hoca silme
    # kontrolu bu yonden okuyor.
    op.create_index(
        "idx_exam_invigilators_lecturer", "exam_invigilators", ["lecturer_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_exam_invigilators_lecturer", table_name="exam_invigilators")
    op.drop_table("exam_invigilators")
