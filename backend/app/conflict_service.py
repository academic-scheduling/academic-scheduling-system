"""Cakisma motoru dikisi (K-22).

Sinav endpoint'leri motoru YALNIZCA bu modul uzerinden cagirir; motorun
kendisi WP5'in isidir (sahibi: Stajyer C, docs/cakisma_kural_seti_1.md).
C'nin motoru hazir olunca entegrasyon SADECE bu dosyada yapilir —
router'lara dokunulmaz.

Donen eleman sekli kontrat §0 ConflictResult'tir (dict olarak):
    {"severity": "HARD"|"WARNING", "rule_id": "E1"..,
     "message": "...", "affected": [{"type","id","course_code"}]}

TODO(Intern C): stub'lari gercek motorla degistir.
  - save ani: tum kurallar calisir, sonuc bilgilendirir, kaydi ENGELLEMEZ (K-03)
  - submit ani: HARD varsa submit reddedilir (hep-veya-hic)
  - sinav kurallari: E1-E7 + X1-X3 (workgroup.check_exam_vs_course acikken)
  - karsilastirma evreni: workgroup'taki DRAFT + SUBMITTED tum girisler

Stub aktifken bilinen sinirlama: submit hicbir zaman HARD engeli gormez
(karar defteri K-22'de kayitli).
"""

from sqlalchemy.orm import Session

from app.models import Exam


def check_exams_save(db: Session, exam: Exam) -> list[dict]:
    """Tek sinavin kayit ani kontrolu. Stub: her zaman temiz."""
    return []


def check_exams_submit(db: Session, exams: list[Exam]) -> list[dict]:
    """Submit kumesinin kontrolu (kume ici + mevcut girislere karsi).

    Stub: her zaman temiz. Gercek motor HARD iceren liste dondurdugunde
    router submit'i 409 ile reddeder.
    """
    return []
