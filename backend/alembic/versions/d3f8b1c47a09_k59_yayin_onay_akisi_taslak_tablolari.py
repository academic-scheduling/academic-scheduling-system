"""K-59: yayin onay akisi — schedule_drafts + weekly.draft_id + can_approve_schedule

Program artik dogrudan yayinlanmaz: duzenleme OZEL bir cohort taslaginda yapilir,
yayina gecmesi icin `can_approve_schedule` yetkili birinin onayi gerekir.

Bu migration TAMAMEN EKLEMELIDIR — hicbir kolon dusmez, hicbir veri silinmez.
Mevcut akis (weekly_schedule_entries.status ile DRAFT/SUBMITTED) oldugu gibi
calismaya devam eder. `status`/`submitted_at` dusurulmesi ve artik taslak
satirlarinin silinmesi, yeni uclar devreye girdikten SONRA ayri bir temizlik
migration'ina birakildi; boylece her commit'te uygulama ve testler yesil kalir.

Revision ID: d3f8b1c47a09
Revises: a1e4c7f9d2b6
Create Date: 2026-08-10 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d3f8b1c47a09"
down_revision: Union[str, None] = "a1e4c7f9d2b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- yetki bayragi (K-25 fabrikasiyla ayni desen) --------------------
    # server_default false: mevcut hesaplarin hicbiri onaylayici DEGIL. Admin de
    # dahil kimse otomatik kazanmaz; yetki bilerek verilir.
    op.add_column(
        "users",
        sa.Column(
            "can_approve_schedule",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # --- taslak tablosu -------------------------------------------------
    # create_type=False: tipi ASAGIDA elle yaratiyoruz. Bayrak olmazsa
    # create_table ayni tipi ikinci kez CREATE etmeye kalkar (DuplicateObject) —
    # semester_type'ta oldugu gibi, ama orada tip zaten baska migration'dan geliyor.
    draft_status = postgresql.ENUM(
        "OPEN", "PENDING", "APPROVED", "REJECTED",
        name="draft_status", create_type=False,
    )
    draft_status.create(op.get_bind())

    op.create_table(
        "schedule_drafts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("workgroup_id", sa.BigInteger(), nullable=False),
        # cohort kimligi: taslagin kapsami
        sa.Column("department_id", sa.BigInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column(
            "semester",
            # Tip zaten var (courses/exams/course_cohorts kullaniyor) -> CREATE etme.
            postgresql.ENUM(
                "FALL", "SPRING", "SUMMER", name="semester_type", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "status", draft_status, nullable=False, server_default=sa.text("'OPEN'")
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # onaya gonderim
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submit_note", sa.Text(), nullable=True),
        # inceleme
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("applied_summary", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["workgroup_id"], ["workgroups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["department_id"], ["departments.id"], ondelete="CASCADE"
        ),
        # CASCADE: taslak sahibine OZELDIR, sahipsiz taslagin anlami yok.
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        # SET NULL: inceleyen hesap giderse taslagin gecmis kaydi durmaya devam etsin.
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint("year BETWEEN 1 AND 6", name="ck_schedule_drafts_year_range"),
    )

    # Bir kullanici bir cohort icin ayni anda TEK aktif taslak tutar.
    # APPROVED disarida: gecmis kaydi yeni taslak acmayi engellememeli.
    op.create_index(
        "uq_schedule_drafts_active_per_owner",
        "schedule_drafts",
        ["created_by", "department_id", "year", "semester"],
        unique=True,
        postgresql_where=sa.text("status <> 'APPROVED'"),
    )
    op.create_index("idx_schedule_drafts_status", "schedule_drafts", ["status"])

    # --- onaylanan taslagin etkiledigi bolumler (ortak ders, K-48) ------
    # Degisiklik akisi bu satirlar uzerinden calisir; ayri bildirim tablosu yok.
    op.create_table(
        "draft_affected_departments",
        sa.Column("draft_id", sa.BigInteger(), primary_key=True),
        sa.Column("department_id", sa.BigInteger(), primary_key=True),
        sa.ForeignKeyConstraint(
            ["draft_id"], ["schedule_drafts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["department_id"], ["departments.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "idx_draft_affected_department", "draft_affected_departments", ["department_id"]
    )

    # --- haftalik girisin taslak baglantisi ------------------------------
    # NULL = YAYINDA. Mevcut TUM satirlar NULL kalir; bugunku davranis degismez.
    op.add_column(
        "weekly_schedule_entries",
        sa.Column("draft_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_wse_draft_id",
        "weekly_schedule_entries",
        "schedule_drafts",
        ["draft_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("idx_wse_draft", "weekly_schedule_entries", ["draft_id"])


def downgrade() -> None:
    op.drop_index("idx_wse_draft", table_name="weekly_schedule_entries")
    op.drop_constraint("fk_wse_draft_id", "weekly_schedule_entries", type_="foreignkey")
    op.drop_column("weekly_schedule_entries", "draft_id")

    op.drop_index(
        "idx_draft_affected_department", table_name="draft_affected_departments"
    )
    op.drop_table("draft_affected_departments")

    op.drop_index("idx_schedule_drafts_status", table_name="schedule_drafts")
    op.drop_index("uq_schedule_drafts_active_per_owner", table_name="schedule_drafts")
    op.drop_table("schedule_drafts")
    # semester_type PAYLASIMLI tip -> dokunma; yalniz bu migration'in yarattigi
    # draft_status dusurulur.
    postgresql.ENUM(name="draft_status").drop(op.get_bind())

    op.drop_column("users", "can_approve_schedule")
