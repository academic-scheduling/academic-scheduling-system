"""K-60 temizlik: exams.status/submitted_at dusuruldu, entry_status tipi kalkti

Sinav takvimi de onay kapisinin arkasina alindi; eski K-03 yasam dongusunun
sinavdaki son izleri burada siliniyor. Bu migration, K-60'in ilk (tamamen
eklemeli) migration'inin ikinci yarisi: yeni uclar devreye girdikten SONRA
calisir, boylece her commit'te agac yesil kaldi.

Dusenler:
  - `exams.status` + `exams.submitted_at`
  - `ck_exams_status_submitted_consistency` (kolonlarla birlikte gider)
  - `idx_exams_status`
  - `entry_status` TIPI: haftalik onu K-59'da birakti, sinav burada birakti;
    kullanani kalmadigi olculdu.

**Veri silinmiyor.** K-59'un dersi burada da gecerli: gercek veride
import/seed her sinavi `DRAFT` yazmis, yani `status`'e bakip satir silmek
yayindaki sinav takviminin TAMAMINI silerdi. Kolonu dusurmek zaten dogru
sonucu veriyor — satirin "yayinda mi" cevabi K-60'tan beri `draft_id IS NULL`.

Revision ID: c4a70f2d9e83
Revises: b7d3e0a15c92
Create Date: 2026-08-11 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4a70f2d9e83"
down_revision: Union[str, None] = "b7d3e0a15c92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("idx_exams_status", table_name="exams")
    # CHECK kolonlara bagli; kolonlar dusmeden once acikca kaldirilir.
    op.drop_constraint(
        "ck_exams_status_submitted_consistency", "exams", type_="check"
    )
    op.drop_column("exams", "submitted_at")
    op.drop_column("exams", "status")

    # Tipin son kullanicisi de gitti. `draft_status` PAYLASILAN degil, ayri bir
    # tip -- ona dokunulmuyor.
    postgresql.ENUM(name="entry_status").drop(op.get_bind())


def downgrade() -> None:
    entry_status = postgresql.ENUM(
        "DRAFT", "SUBMITTED", name="entry_status", create_type=False
    )
    entry_status.create(op.get_bind())

    # Geri donuste tum satirlar DRAFT olur: hangi sinavin bir zamanlar
    # SUBMITTED oldugu bilgisi kolonla birlikte gitti ve `draft_id`'den
    # turetilemez (yayinda olmak "gonderilmis olmak" demek degil). Bu, geri
    # donusun KAYIPLI oldugunun bilincli kabulu.
    op.add_column(
        "exams",
        sa.Column("status", entry_status, nullable=False,
                  server_default=sa.text("'DRAFT'")),
    )
    op.add_column(
        "exams",
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_exams_status_submitted_consistency",
        "exams",
        "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
    )
    op.create_index("idx_exams_status", "exams", ["status"])
