"""K-60: sinav onay akisi — schedule_drafts.kind + exams.draft_id

Sinav takvimi de onay kapisinin arkasina aliniyor. Ayri bir mekanizma degil,
mevcut taslak tablosuna bir ayrac (`kind`) konuyor: yasam dongusu, oz-onay
yasagi, kuyruk ve inceleme ekrani ikisi icin de ayni kaliyor.

Bu migration TAMAMEN EKLEMELIDIR (K-59'un dersi): hicbir kolon dusmez, hicbir
veri silinmez. Mevcut sinav akisi (exams.status ile DRAFT/SUBMITTED, /exams/
submit ucu) oldugu gibi calismaya devam eder. `status`/`submitted_at`/CHECK'in
dusurulmesi ve eski uclarin kaldirilmasi, yeni uclar devreye girdikten SONRA
ayri bir temizlik migration'ina birakildi; boylece her commit'te agac yesil.

DIKKAT — `uq_exams_course_type_index`: bugun (course_id, exam_type, exam_index)
uzerinde KOSULSUZ bir UNIQUE constraint. Taslak yayinin KOPYASINI tasiyacagi
icin kopyalama aninda bu kisit ihlal edilir. Iki KISMI indekse bolunuyor.
Tek bir dort kolonlu (…, draft_id) UNIQUE YETMEZ: Postgres NULL'lari birbirine
esit saymaz, o indeks altinda YAYINDA ayni sinavin iki kopyasi gecerdi.

Revision ID: b7d3e0a15c92
Revises: e6b2d95c31af
Create Date: 2026-08-10 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b7d3e0a15c92"
down_revision: Union[str, None] = "e6b2d95c31af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- taslagin ayraci ------------------------------------------------
    draft_kind = postgresql.ENUM("WEEKLY", "EXAM", name="draft_kind", create_type=False)
    draft_kind.create(op.get_bind())

    # server_default WEEKLY: K-60 oncesi acilmis TUM taslaklar haftalik.
    # nullable=False guvenli, cunku varsayilan mevcut satirlari dolduruyor.
    op.add_column(
        "schedule_drafts",
        sa.Column(
            "kind", draft_kind, nullable=False, server_default=sa.text("'WEEKLY'")
        ),
    )

    # Aktif taslak tekilligi artik kind'i da iceriyor: ayni cohort icin
    # haftalik ve sinav taslagi AYNI ANDA acilabilmeli.
    op.drop_index("uq_schedule_drafts_active_per_owner", table_name="schedule_drafts")
    op.create_index(
        "uq_schedule_drafts_active_per_owner",
        "schedule_drafts",
        ["created_by", "department_id", "year", "semester", "kind"],
        unique=True,
        postgresql_where=sa.text("status <> 'APPROVED'"),
    )

    # --- sinavin taslak baglantisi --------------------------------------
    # NULL = YAYINDA. Mevcut TUM satirlar NULL kalir; bugunku davranis degismez.
    op.add_column("exams", sa.Column("draft_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_exams_draft_id",
        "exams",
        "schedule_drafts",
        ["draft_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("idx_exams_draft", "exams", ["draft_id"])

    # --- K-46 tekilligi: constraint -> iki kismi indeks ------------------
    op.drop_constraint("uq_exams_course_type_index", "exams", type_="unique")
    # Ad KORUNDU: yayindaki tekillik hala ayni kural, yalniz kapsami daraldi.
    op.create_index(
        "uq_exams_course_type_index",
        "exams",
        ["course_id", "exam_type", "exam_index"],
        unique=True,
        postgresql_where=sa.text("draft_id IS NULL"),
    )
    op.create_index(
        "uq_exams_course_type_index_draft",
        "exams",
        ["course_id", "exam_type", "exam_index", "draft_id"],
        unique=True,
        postgresql_where=sa.text("draft_id IS NOT NULL"),
    )


def downgrade() -> None:
    # Kismi indeksleri geri kosulsuz constraint'e cevirmek, taslak satirlari
    # DURUYORSA basarisiz olur (ayni ucluden birden cok satir). Bu dogru
    # davranis: veri kaybetmektense migration patlasin. Once taslaklar silinmeli.
    op.drop_index("uq_exams_course_type_index_draft", table_name="exams")
    op.drop_index("uq_exams_course_type_index", table_name="exams")
    op.create_unique_constraint(
        "uq_exams_course_type_index", "exams", ["course_id", "exam_type", "exam_index"]
    )

    op.drop_index("idx_exams_draft", table_name="exams")
    op.drop_constraint("fk_exams_draft_id", "exams", type_="foreignkey")
    op.drop_column("exams", "draft_id")

    op.drop_index("uq_schedule_drafts_active_per_owner", table_name="schedule_drafts")
    op.create_index(
        "uq_schedule_drafts_active_per_owner",
        "schedule_drafts",
        ["created_by", "department_id", "year", "semester"],
        unique=True,
        postgresql_where=sa.text("status <> 'APPROVED'"),
    )

    op.drop_column("schedule_drafts", "kind")
    postgresql.ENUM(name="draft_kind").drop(op.get_bind())
