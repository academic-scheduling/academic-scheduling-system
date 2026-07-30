"""lecturers.department_id — ogretim uyesinin kendi (asli) bolumu

Hoca karari: her ogretim uyesinin bir asli bolumu olur; farkli bolumlerde de
ders verebilir. "Ders verdigi bolumler" zaten sube->ders->bolum uzerinden
turetiliyordu; bu kolon AYRI bir kavram: aidiyet.

NULLABLE: mevcut hocalar (seed + web import) asli bolum tasimadan yaratildi;
NOT NULL yapmak bu satirlari kirardi. Form yeni kayitlarda zorunlu tutar,
eski kayitlar duzenlenene kadar NULL kalir.

ondelete=SET NULL: asli bolum silinirse hoca silinmez, yalnizca aidiyeti
bosalir (yeniden atanabilir). Boylece bolum silme akisi engellenmez.

Revision ID: b2d4f6a8c1e3
Revises: c7e9a02b4d31
Create Date: 2026-07-30 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2d4f6a8c1e3"
down_revision: Union[str, None] = "c7e9a02b4d31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "lecturers",
        sa.Column("department_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_lecturers_department_id",
        "lecturers",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_lecturers_department_id", "lecturers", type_="foreignkey")
    op.drop_column("lecturers", "department_id")
