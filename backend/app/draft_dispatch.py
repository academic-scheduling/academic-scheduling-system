"""Taslak turune gore is mantigi secimi (K-60).

Ayri bir modul olmasinin tek sebebi cevrimsel import: `exam_draft_service`
zaten `draft_service`'ten kind-agnostik yardimcilar aliyor, dolayisiyla
dagitici o ikisinin ustunde durmali. Iki router da (taslak ve onay) buradan
cagirir.

Iki servis modulu AYNI adlari tasir — `copy_published_into_draft`,
`clear_draft`, `compute_diff`, `apply_draft`, `build_applied_summary`,
`draft_row_count` — ve bu kasitlidir: ortak uclar (ac / temizle / fark /
gonder / onayla) tek satirla dogru kola gider. Paylasilan sey SEKIL'dir;
hesaplarin kendisi ayridir, cunku eslestirme mantiklari gercekten farkli
(haftalikta grup ici sirali eslestirme, sinavda tekil anahtar - K-60).
"""

from app import draft_service, exam_draft_service
from app.models import DraftKind, ScheduleDraft


def service_for(draft: ScheduleDraft):
    return exam_draft_service if draft.kind is DraftKind.EXAM else draft_service
