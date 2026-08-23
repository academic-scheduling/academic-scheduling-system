"""Degisiklik akisi (K-59) — "bolumunuzu etkileyen son program degisiklikleri".

**Neden var:** taslaklar OZELDIR ve onaylar arka planda gerceklesir. Bu
sistemden once program pratikte duragandi; simdi ayagin altinda degisiyor ve
kimsenin haberi olmuyor. Ortak ders (K-48) bunun en keskin ornegi: CE'nin
onayi MATH ve EEE'nin programini da degistirebiliyor.

**Ayri bir bildirim tablosu YOKTUR** (kullanici karari: yalniz uygulama ici
akis, e-posta yok). Onaylanan taslak kaydinin KENDISI degisiklik kaydidir:
`applied_summary` onay aninda dondurulmus insan-okur ozeti, cohort kimligi
kimin programi oldugunu, `affected_departments` ise ortak ders uzerinden
etkilenen bolumleri tasir.

Okundu/okunmadi durumu YOK — bu bir akis, bildirim merkezi degil. Kisi basina
durum tutmak ayri bir ozellik (K-59 acik uclar).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.deps import get_current_user, get_db
from app.models import (
    Department, DraftKind, DraftStatus, ScheduleDraft, SemesterType, User, UserRole,
)
from app.schemas import ScheduleChangeOut

router = APIRouter(tags=["schedule-changes"])


def approved_visibility_filter(user: User):
    """"Onaylanmis bir degisikligi gormeye hakkim var mi?" — TEK yerde (K-80).

    Bu kural K-59'da bu dosyada dogmustu; K-80'de Yayin Merkezi'nin
    "Onaylananlar" grubu da ayni soruyu sormaya basladi. Iki yerde kopyalanirsa
    biri gunun birinde otekinden ayrilir ve gizlilik sinirini KOPYA belirler —
    o yuzden burada tek surum durur.

    Cevabin sekli: `None` = kisit yok (ADMIN), `False` = hicbir sey (uyeliksiz
    alt hesap), aksi halde SQLAlchemy kosulu.

    Iki yoldan "beni ilgilendirir": degisiklik KENDI bolumumdeydi, ya da baska
    bir bolumun onayi ORTAK DERS uzerinden benim bolumumu etkiledi (K-48).
    """
    if user.role == UserRole.ADMIN:
        return None                       # K-04 cizgisi: workgroup'un tamami
    uyelikler = [m.department_id for m in user.memberships]
    if not uyelikler:
        return False                      # gormesi gereken bir sey yok
    return or_(
        ScheduleDraft.department_id.in_(uyelikler),
        ScheduleDraft.affected_departments.any(Department.id.in_(uyelikler)),
    )


@router.get("/schedule-changes", response_model=list[ScheduleChangeOut])
def list_recent_changes(
    limit: int = Query(10, ge=1, le=50),
    # K-73: akis artik sayfa basina bolunur (haftalik degisiklikler Haftalik
    # ekranda, sinav degisiklikleri Sinav ekranda) ve DraftBar'in "yayin bilgisi"
    # pop-up'i tek cohort'un son onayini ister. Hepsi opsiyonel; verilmezse
    # eski davranis (tur ve cohort suzgeci yok).
    kind: DraftKind | None = Query(None),
    department_id: int | None = Query(None),
    year: int | None = Query(None),
    semester: SemesterType | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Beni ilgilendiren son yayin degisiklikleri, yeniden eskiye.

    "Beni ilgilendiren" iki yoldan olur:
      - degisiklik KENDI bolumumun bir cohort'unda yapildi, ya da
      - baska bir bolumun onayi ORTAK DERS uzerinden benim bolumumu etkiledi.

    ADMIN workgroup'un tamamini gorur (K-04 ile ayni cizgi). Uyeligi olmayan
    alt hesap bos liste alir — gormesi gereken bir sey yoktur.
    """
    q = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer),
                 selectinload(ScheduleDraft.affected_departments))
        .filter(ScheduleDraft.workgroup_id == user.workgroup_id,
                ScheduleDraft.status == DraftStatus.APPROVED)
    )
    if kind is not None:
        q = q.filter(ScheduleDraft.kind == kind)
    # Cohort suzgeci (DraftBar pop-up'i): degisiklik AKISINDAN farkli olarak
    # ORTAK DERS etkisini KATMAZ — burada "bu cohort'un yayindaki halini kim
    # duzenledi/onayladi" sorulur, o cohort'un dogrudan onayi istenir.
    if department_id is not None:
        q = q.filter(ScheduleDraft.department_id == department_id)
    if year is not None:
        q = q.filter(ScheduleDraft.year == year)
    if semester is not None:
        q = q.filter(ScheduleDraft.semester == semester)
    gorunurluk = approved_visibility_filter(user)
    if gorunurluk is False:
        return []
    if gorunurluk is not None:
        q = q.filter(gorunurluk)

    drafts = q.order_by(ScheduleDraft.reviewed_at.desc()).limit(limit).all()
    return [
        {
            "id": d.id,
            "department_id": d.department_id,
            "department_name": d.department.name,
            "year": d.year,
            "semester": d.semester,
            # K-60: akista haftalik ve sinav onaylari BIR ARADA akiyor; okuyanin
            # hangisinin degistigini ozetten tahmin etmesi beklenemez.
            "kind": d.kind,
            "summary": d.applied_summary,
            "published_at": d.reviewed_at,
            "published_by": d.owner.name,
            "approved_by": d.reviewer.name if d.reviewer else None,
            "affected_departments": [
                {"id": x.id, "name": x.name} for x in d.affected_departments
            ],
        }
        for d in drafts
    ]
