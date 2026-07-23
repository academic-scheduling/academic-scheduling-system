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

from app.models import Exam, WeeklyScheduleEntry


def check_exams_save(db: Session, exam: Exam) -> list[dict]:
    """Tek sinavin kayit ani kontrolu. Stub: her zaman temiz."""
    return []


def check_exams_submit(db: Session, exams: list[Exam]) -> list[dict]:
    """Submit kumesinin kontrolu (kume ici + mevcut girislere karsi).

    Stub: her zaman temiz. Gercek motor HARD iceren liste dondurdugunde
    router submit'i 409 ile reddeder.
    """
    return []


def check_weekly_save(db: Session, entry: WeeklyScheduleEntry) -> list[dict]:
    """Tek haftalik girisin kayit ani kontrolu. Stub: her zaman temiz.

    Gercek motor (WP5, Stajyer C) W1-W7 kurallarini calistirir; sonuc
    BILGILENDIRIR, kaydi ENGELLEMEZ (K-03). W8 tamlik kurali burada
    URETILMEZ — yalniz submit aninda (K-20).
    """
    return []


def scan_workgroup(db: Session, workgroup_id: int) -> dict[str, list[dict]]:
    """Workgroup'un TAMAMINI tarar (kontrat §9 + §10'un sayaclari).

    Tek cagri iki tuketiciyi besler: dashboard ozeti yalnizca len() alir,
    GET /conflicts (A-4) ayni listeleri oldugu gibi doner. Ikisi ayri ayri
    tarasaydi ayni anda farkli sayi gosterebilirlerdi.

    Stub: her zaman temiz. Sonucu K-33'te kayitli bilinen sinirlama —
    dashboard motor baglanana dek "0 / 0" gosterir, yani "cakisma yok" gibi
    okunur; oysa henuz bakilmadi.
    """
    return {"hard": [], "warnings": []}


def check_weekly_submit(db: Session, entries: list[WeeklyScheduleEntry]) -> list[dict]:
    """Submit kumesinin kontrolu (kume ici + mevcut girislere karsi).

    Gercek motor HARD iceren liste dondurdugunde router submit'i 409 ile
    reddeder (hep-veya-hic). W8 tamlik WARNING'i YALNIZ burada uretilir (K-20):
    subenin session_type bazinda yerlesen slot toplami T+U+L'den farkliysa.
    Karsilastirma evreni: workgroup'taki DRAFT + SUBMITTED tum girisler.

    Stub: her zaman temiz.
    """
    return []