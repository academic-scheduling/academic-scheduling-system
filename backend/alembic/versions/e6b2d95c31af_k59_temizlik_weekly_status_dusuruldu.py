"""K-59 temizlik: weekly_schedule_entries.status + submitted_at dusuruldu

Adim 1'in migration'i (d3f8b1c47a09) tamamen eklemeliydi: `draft_id` geldi ama
eski `status`/`submitted_at` yerinde birakildi ki gecis boyunca eski akis
calismaya devam etsin ve agac her commit'te yesil kalsin. Yeni uclar (taslak +
onay) devreye girdigine ve eski YAZMA uclari kaldirildigina gore o kolonlarin
isi bitti.

**Neden dusuyorlar:** `draft_id IS NULL` = yayinda. `status` ayni gercegi ikinci
kez soylerdi ve er gec biri otekiyle celisirdi.

**"Kalan DRAFT satirlarini sil" adimi IPTAL EDILDI.** Plan yapilirken varsayim
suydu: DRAFT satirlar birinin yarim kalmis isi, SUBMITTED satirlar yayindaki
program. Gercek veride oyle cikmadi — import/seed her seyi `DRAFT` yazmis ve
adim 1'den beri bu satirlarin TAMAMI `draft_id IS NULL` oldugu icin uygulama
onlari YAYIN olarak gosteriyor. Status'e bakip silmek, programin tamamini
silmek olurdu (olcum: 19 yayin satirinin 19'u da status=DRAFT). Kolonu dusurmek
zaten dogru sonucu veriyor: satirlarin nerede oldugunu `draft_id` soyluyor.

`entry_status` TIPI DUSMEZ: sinavlar (K-16, ayri faz) hala kullaniyor.

Revision ID: e6b2d95c31af
Revises: d3f8b1c47a09
Create Date: 2026-08-10 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e6b2d95c31af"
down_revision: Union[str, None] = "d3f8b1c47a09"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_wse_status_submitted_consistency", "weekly_schedule_entries",
        type_="check",
    )
    op.drop_index("idx_wse_status", table_name="weekly_schedule_entries")
    op.drop_column("weekly_schedule_entries", "submitted_at")
    op.drop_column("weekly_schedule_entries", "status")


def downgrade() -> None:
    # Geri alinirsa TUM satirlar DRAFT olur: yayin/taslak ayrimi artik
    # `draft_id`'de; eski kolondan geri turetilecek bir bilgi yok.
    op.add_column(
        "weekly_schedule_entries",
        sa.Column(
            "status",
            postgresql.ENUM("DRAFT", "SUBMITTED", name="entry_status",
                            create_type=False),
            nullable=False, server_default=sa.text("'DRAFT'"),
        ),
    )
    op.add_column(
        "weekly_schedule_entries",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_wse_status", "weekly_schedule_entries", ["status"])
    op.create_check_constraint(
        "ck_wse_status_submitted_consistency", "weekly_schedule_entries",
        "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
    )
