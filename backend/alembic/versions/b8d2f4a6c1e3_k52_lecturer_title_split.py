"""K-52 lecturers.title + eski full_name'leri unvan/ad olarak ayir

Unvan artik full_name'in icine gomulu degil, kendi kolonunda. Bu migration:
  1. `title` kolonunu ekler (nullable, kanonik kisa form: "Doç. Dr." vb.),
  2. mevcut kayitlarin full_name'ini normalize.split_title ile ayirir → taninan
     bir unvanla basliyorsa unvan title'a tasinir, full_name saf ad kalir.

normalized_name unvani zaten soktugu icin dedup DEGISMEZ; sadece full_name
kisalir + title dolar. Taninmayan bir unvanla baslayan kayit (nadir) oldugu gibi
birakilir (veri kaybi yok, sadece o satirda title bos kalir).

Revision ID: b8d2f4a6c1e3
Revises: f7b3c1a9e2d4
Create Date: 2026-08-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.normalize import split_title


# revision identifiers, used by Alembic.
revision: str = 'b8d2f4a6c1e3'
down_revision: Union[str, None] = 'f7b3c1a9e2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'lecturers',
        sa.Column('title', sa.String(length=50), nullable=True),
    )
    # Eski birlesik full_name'leri ayikla. Ham SQL: ORM modeli bu migration
    # aninda yeni kolonu tanisa da eski kayitlar icin degeri henuz yok; dogrudan
    # tablodan okuyup guncelliyoruz.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, full_name FROM lecturers")
    ).fetchall()
    for lid, full_name in rows:
        title, name = split_title(full_name or "")
        if title is not None:
            bind.execute(
                sa.text(
                    "UPDATE lecturers SET title = :t, full_name = :n WHERE id = :i"
                ),
                {"t": title, "n": name, "i": lid},
            )


def downgrade() -> None:
    # full_name geri BIRLESTIRILMEZ (kayipsiz degil: kanonik form uretilmisti).
    # Geri alinirsa unvanlar kolonuyla birlikte gider; adlar unvansiz kalir.
    op.drop_column('lecturers', 'title')
