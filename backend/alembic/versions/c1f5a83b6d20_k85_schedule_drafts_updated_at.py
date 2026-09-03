"""K-85: schedule_drafts.updated_at — taslagin SON DEGISIKLIK zamani

Neden yeni bir kolon: tabloda yalniz created_at / submitted_at / reviewed_at
vardi ve ucu de YASAM DONGUSU olaylari. Bir taslagin ICINDE ders eklemek,
tasimak ya da silmek hicbir zaman damgasi birakmiyordu -- girislerin kendi
created_at'i taşımayı ve silmeyi kacirir. Ana sayfadaki "son 4 kayit" listesi
"en son ne uzerinde calistim" sorusunu cevapladigi icin bu olculebilir olmali.

Neden onupdate=now() DEGIL: kolon taslak satirinin kendisi guncellenince
tetiklenirdi; oysa degisiklikler COCUK tablolarda oluyor (weekly_schedule_entries,
exams). Bu yuzden yazma uclarinda ACIK olarak dokunuluyor (_touch).

Geriye donuk kayit: mevcut satirlar yasam dongusunun EN SON olayiyla dolduruluyor
(reviewed_at > submitted_at > created_at). now() ile doldurmak butun eski
taslaklari "az once degismis" gibi gosterirdi.

Revision ID: c1f5a83b6d20
Revises: b8e4d2f7c913
Create Date: 2026-09-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1f5a83b6d20'
down_revision: Union[str, None] = 'b8e4d2f7c913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default: mevcut satirlar icin NOT NULL'i saglar; hemen ardindan
    # gercek degerlerle doldurulup varsayilan BIRAKILIR (yeni satirlar da
    # dogal olarak "simdi" ile acilir).
    op.add_column(
        'schedule_drafts',
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.execute("""
        update schedule_drafts
           set updated_at = greatest(created_at,
                                     coalesce(submitted_at, created_at),
                                     coalesce(reviewed_at, created_at))
    """)
    # Ana sayfa listesi bu kolona gore siralayip 4 satir aliyor.
    op.create_index('idx_schedule_drafts_updated', 'schedule_drafts', ['updated_at'])


def downgrade() -> None:
    op.drop_index('idx_schedule_drafts_updated', table_name='schedule_drafts')
    op.drop_column('schedule_drafts', 'updated_at')
