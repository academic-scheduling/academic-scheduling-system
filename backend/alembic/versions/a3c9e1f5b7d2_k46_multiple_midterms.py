"""K-46: cok vizeli dersler — courses.midterm_count + exams.exam_index

Bir ders 1-3 vize tasiyabilir (final/but tektir). exams UNIQUE kisiti
(course_id, exam_type) -> (course_id, exam_type, exam_index) olur; boylece
ayni numarali vize iki kez girilemez ama 1./2./3. vize bir arada durabilir.
MIDTERM disi turlerde exam_index hep 1 (router zorlar), dolayisiyla onlar icin
eski "ders basina tek sinav" davranisi aynen korunur.

server_default='1': mevcut satirlar kirilmasin — tum eski dersler 1 vize, tum
eski sinavlar 1. sira olarak doldurulur.

Revision ID: a3c9e1f5b7d2
Revises: b2d4f6a8c1e3
Create Date: 2026-07-31 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3c9e1f5b7d2"
down_revision: Union[str, None] = "b2d4f6a8c1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("midterm_count", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.create_check_constraint(
        "ck_courses_midterm_count", "courses", "midterm_count BETWEEN 1 AND 3"
    )

    op.add_column(
        "exams",
        sa.Column("exam_index", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.create_check_constraint(
        "ck_exams_exam_index", "exams", "exam_index BETWEEN 1 AND 3"
    )
    # Tek vize varsayimini kaldir: sira alani UNIQUE'a girer.
    op.drop_constraint("uq_exams_course_type", "exams", type_="unique")
    op.create_unique_constraint(
        "uq_exams_course_type_index",
        "exams",
        ["course_id", "exam_type", "exam_index"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_exams_course_type_index", "exams", type_="unique")
    op.create_unique_constraint(
        "uq_exams_course_type", "exams", ["course_id", "exam_type"]
    )
    op.drop_constraint("ck_exams_exam_index", "exams", type_="check")
    op.drop_column("exams", "exam_index")
    op.drop_constraint("ck_courses_midterm_count", "courses", type_="check")
    op.drop_column("courses", "midterm_count")
