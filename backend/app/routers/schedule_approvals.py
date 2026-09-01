"""Onay uclari (K-59) — kuyruk, inceleme, onayla, reddet.

Bu dosya sistemin ASIL kapisi: yayindaki programa yazan TEK yer burasidir.
Taslak uclari (schedule_drafts.py) yalniz ozel kopyalara dokunur.

Dort kural:

1. **Oz-onay yasak, ADMIN dahil.** Kendi talebini onaylayan biri, onay
   adimini bastan anlamsiz kilar. Admin icin istisna YOK (kullanici karari):
   tek yetkilisi olan workgroup yayin yapamaz, ikinci bir onaylayici davet
   etmek zorundadir.
2. **Bayraktan ADMIN muaf, uyelikten de.** K-02/K-25'ten beri suregelen desen;
   muaf OLMADIGI tek sey (1).
3. **Onay aninda cakisma YENIDEN kosar.** Talep temizken baska bolum bir sey
   yayinlamis olabilir; o zaman onay engellenir ve onaylayici gerekceyi gorur.
4. **Onay, taslagin tamamini degil FARKINI uygular.** Boylece ayni cohortta
   baska birinin onaylanmis degisikligi sessizce silinmez.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, selectinload

from app.audit import log_action
from app.conflict_service import scan_draft
from app.draft_dispatch import service_for as _svc
from app.draft_service import (
    diff_affected_department_ids, publications_since_opened, touch_draft,
)
from app.deps import get_db, get_current_user, require_schedule_approver
from app.models import (
    Department, DraftKind, DraftStatus, Exam, ScheduleDraft, User, UserRole,
    WeeklyScheduleEntry,
)
from app.routers.exams import _eager_exam_query
from app.routers.schedule_changes import approved_visibility_filter
from app.routers.weekly_entries import _eager_entry_query
from app.schemas import (
    DraftApproveRequest, DraftApproveResponse, DraftOut, DraftRejectRequest,
    DraftReviewOut,
)

router = APIRouter(tags=["schedule-approvals"])


# ------------------------------------------------------------------
# Erisim
# ------------------------------------------------------------------

def _addressed_to(user: User):
    """K-83: bu talep BANA mi gonderildi?

    Gonderen, taslagi onaya verirken alicilari secer (`draft.approvers`).
    Kuyruk artik "yetkim var" degil "bana gonderildi" sorusunu soruyor —
    yetki hala gerekli ama tek basina yeterli degil.

    Ikinci kosul (`~any()`) ADRESSIZ talepleri kapsar; bu iki durumda olur:

      1. **Gecis.** K-83 gocunden ONCE gonderilmis bekleyen taleplerin alicisi
         yoktur. Onlari "adressiz" diye gizlemek, gecis aninda kuyrukta
         bekleyen isi gorunmez yapardi.
      2. **Havuz bostu.** Gonderim aninda adreslenebilecek KIMSE yoktu (henuz
         ikinci bir yetkili davet edilmemis). Sonradan yetki alan biri cikarsa
         talep ona gorunur — aksi halde is sonsuza dek kilitli kalirdi.

    Ikisinde de kural K-83 oncesine duser: bayrak + bolum uyeligi. Adresleme
    VAR ise (havuzda birileri vardi ve gonderen sectiyse) secim baglayicidir —
    secilmeyen yetkili talebi gormez.
    """
    return or_(
        ScheduleDraft.approvers.any(User.id == user.id),
        ~ScheduleDraft.approvers.any(),
    )


def _approvable_query(db: Session, user: User):
    """Onayima acik BEKLEYEN taslaklar.

    Uc boyut birlikte calisir:
      - **Bayrak** `can_approve_schedule` (ADMIN muaf) — K-25.
      - **Bolum uyeligi** (ADMIN muaf) — K-25. Adresleme sonradan degisen
        uyelikleri bilmez; bu yuzden uyelik gecmis bir secimin uzerinden
        DEGIL, her sorguda CANLI kontrol edilir.
      - **Adresleme** — talep bana gonderildi mi (K-83).

    Kendi talebim ayrica listelenir (bekledigini bilmelisin): gonderen asla
    kendi talebinin alicisi olmaz, dolayisiyla adresleme kosulundan gecemez.
    Onaylayamaz — o kapiyi `_ensure_not_self` kapatir.

    OPEN taslaklar girmez — onlar sahibine ozeldir; onay yetkisi yalnizca
    ONAYA GONDERILMIS taslagi gorme hakki verir.
    """
    q = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer),
                 selectinload(ScheduleDraft.approvers))
        .filter(ScheduleDraft.workgroup_id == user.workgroup_id,
                ScheduleDraft.status == DraftStatus.PENDING)
    )
    if user.role == UserRole.ADMIN:
        kapsam = _addressed_to(user)
    elif not user.can_approve_schedule:
        return q.filter(False)              # yetkisiz: kuyruk bos
    else:
        uyelikler = [m.department_id for m in user.memberships]
        kapsam = and_(ScheduleDraft.department_id.in_(uyelikler or [-1]),
                      _addressed_to(user))
    return q.filter(or_(ScheduleDraft.created_by == user.id, kapsam))


def _get_reviewable(db: Session, user: User, draft_id: int) -> ScheduleDraft:
    draft = _approvable_query(db, user).filter(ScheduleDraft.id == draft_id).first()
    if draft is None:
        # 404: bekleyen olmayan ya da kapsamimizda olmayan taslak. Ozel bir
        # taslagin varligi onay yetkisiyle de sizdirilmez (K-59).
        raise HTTPException(status_code=404, detail="Onay bekleyen taslak bulunamadı")
    return draft


def _ensure_not_self(user: User, draft: ScheduleDraft) -> None:
    if draft.created_by == user.id:
        raise HTTPException(
            status_code=403,
            detail="Kendi talebinizi onaylayamazsınız — başka bir onay yetkilisi "
                   "incelemeli",
        )


def _to_out(db: Session, draft: ScheduleDraft, *, live: bool = True) -> dict:
    """DraftOut govdesi. `live=False` onaydan SONRA kullanilir: kayit artik
    gecmistir, farki onay aninda `applied_summary`ye donmustur. Canli hesap
    O ANKI yayina karsi kosacagi icin sonraki onaylarla kayardi."""
    return {
        "id": draft.id,
        "department_id": draft.department_id,
        "department_name": draft.department.name,
        "department_code": draft.department.code,
        "year": draft.year,
        "semester": draft.semester,
        "kind": draft.kind,
        "name": draft.name,
        "status": draft.status,
        "entry_count": _svc(draft).draft_row_count(db, draft),
        "change_count": len(_svc(draft).compute_diff(db, draft)) if live else 0,
        "owner": draft.owner,
        "created_at": draft.created_at,
        "updated_at": draft.updated_at,
        "submitted_at": draft.submitted_at,
        "submit_note": draft.submit_note,
        "approvers": draft.approvers,           # K-83: talep kime gitti
        "reviewer": draft.reviewer,
        "reviewed_at": draft.reviewed_at,
        "review_note": draft.review_note,
        "applied_summary": draft.applied_summary,
    }


# ------------------------------------------------------------------
# Kuyruk ve inceleme
# ------------------------------------------------------------------

@router.get("/schedule-approvals", response_model=list[DraftOut])
def approval_queue(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Onay bekleyenler. Eskiden yeniye — bekleyen once gorulsun.

    Kendi talebin de listelenir (bekledigini bilmelisin) ama onaylanamaz;
    kapiyi `approve` ucu 403 ile kapatir.
    """
    drafts = _approvable_query(db, user).order_by(ScheduleDraft.submitted_at).all()
    return [_to_out(db, d) for d in drafts]


@router.get("/schedule-approvals/history", response_model=list[DraftOut])
def approval_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """ONAYLANMIS taslaklar — beni ilgilendirenler, yeniden eskiye (K-80).

    Kuyruktan (`/schedule-approvals`) farki iki turlu: durum APPROVED, ve
    gorunurluk onay YETKISINE degil DEGISIKLIK AKISI kapsamina bakar.

    Neden bu kapsam: onaylanan taslak artik ozel bir calisma degil, yayina
    girmis bir kayittir. Yayindaki programi zaten gorebilen birinin, o programi
    kimin ne zaman degistirdigini gorememesi icin bir sebep yok. K-59'un
    gizliligi HAZIRLIK evresini korur (OPEN/PENDING/REJECTED), sonucunu degil.

    Kapsam `/schedule-changes` ile AYNI fonksiyondan gelir — iki yuzey ayni
    soruyu soruyor, cevabin iki surumu olmamali.
    """
    q = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer),
                 selectinload(ScheduleDraft.approvers))
        .filter(ScheduleDraft.workgroup_id == user.workgroup_id,
                ScheduleDraft.status == DraftStatus.APPROVED)
    )
    gorunurluk = approved_visibility_filter(user)
    if gorunurluk is False:
        return []
    if gorunurluk is not None:
        q = q.filter(gorunurluk)
    drafts = q.order_by(ScheduleDraft.reviewed_at.desc()).all()
    # live=False: kayit gecmistir, farki `applied_summary`de dondu.
    return [_to_out(db, d, live=False) for d in drafts]


@router.get("/schedule-approvals/{draft_id}", response_model=DraftReviewOut)
def review_draft(
    draft_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_schedule_approver),
):
    """Inceleme: fark + onerilen izgara + cakisma tablosu.

    Fark O ANKI yayina karsi hesaplanir (K-59). Talep gonderildikten sonra
    program degistiyse onaylayici guncel gercege bakar — geri alinacak bir
    degisiklik varsa fark listesinde GORUNUR.

    K-60: onerilen taraf taslagin turune gore `entries` YA DA `exams` dolar;
    oteki bos kalir. Tek bir "satirlar" alaninda birlestirmek, iki farkli
    yerlesim seklini ayni kaba sikistirmak olurdu.
    """
    draft = _get_reviewable(db, user, draft_id)
    entries: list[WeeklyScheduleEntry] = []
    exams: list[Exam] = []
    if draft.kind is DraftKind.EXAM:
        exams = (
            _eager_exam_query(db, published_only=False)
            .filter(Exam.draft_id == draft.id)
            .order_by(Exam.exam_date, Exam.start_time)
            .all()
        )
    else:
        entries = (
            _eager_entry_query(db, published_only=False)
            .filter(WeeklyScheduleEntry.draft_id == draft.id)
            .order_by(WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot)
            .all()
        )
    sonraki_yayinlar = publications_since_opened(db, draft)
    return {
        "draft": _to_out(db, draft),
        "items": _svc(draft).compute_diff(db, draft),
        "entries": entries,
        "exams": exams,
        "conflicts": scan_draft(db, draft),
        "staleness": {
            "opened_at": draft.created_at,
            "publications_since": len(sonraki_yayinlar),
            "last_published_at": (
                sonraki_yayinlar[0].reviewed_at if sonraki_yayinlar else None
            ),
            "last_published_by": (
                sonraki_yayinlar[0].owner.name if sonraki_yayinlar else None
            ),
        },
    }


# ------------------------------------------------------------------
# Karar
# ------------------------------------------------------------------

@router.post("/schedule-approvals/{draft_id}/approve",
             response_model=DraftApproveResponse)
def approve_draft(
    draft_id: int,
    payload: DraftApproveRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_schedule_approver),
):
    """Taslagin farkini YAYINA uygular. Sistemin tek yayin yazma noktasi.

    K-80: karar notu onayda da yazilabilir. Govde OPSIYONELDIR (`| None = None`)
    — not zorunlu olmadigi gibi, gonderilmeyen govde de gecerli bir onaydir.
    """
    draft = _get_reviewable(db, user, draft_id)
    _ensure_not_self(user, draft)

    # Talep temizken gonderilmisti; arada baska bolum yayin yapmis olabilir.
    tablo = scan_draft(db, draft)
    if tablo["hard"]:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "Bu talep güncel programla çakışıyor — onaylanamaz",
                     "conflicts": tablo["hard"]},
        )

    svc = _svc(draft)
    uygulanan = svc.apply_draft(db, draft)

    draft.status = DraftStatus.APPROVED
    draft.reviewed_by = user.id
    draft.reviewed_at = datetime.now(timezone.utc)
    # K-80: `review_note` artik "karar notu" — retten de onaydan da doldurulur.
    # Ayni alan, cunku soru ayni: KARARI VEREN ne dedi? Durum zaten hangisi
    # oldugunu soyluyor, ikinci bir sutun ayrim katmazdi.
    draft.review_note = payload.note if payload else None
    draft.applied_summary = svc.build_applied_summary(uygulanan)
    # Ortak ders tasindiysa etkilenen bolumler burada donar; degisiklik akisi
    # ("bolumunuzu etkileyen son degisiklikler") bu satirlari okur.
    etkilenen = diff_affected_department_ids(uygulanan, draft)
    if etkilenen:
        draft.affected_departments = (
            db.query(Department).filter(Department.id.in_(etkilenen)).all()
        )

    log_action(db, user, "APPROVE", "schedule_draft", draft.id, draft,
               draft.applied_summary)
    touch_draft(draft)
    db.commit()
    db.refresh(draft)
    return {
        "draft": _to_out(db, draft, live=False),
        "applied": uygulanan,
        "warnings": tablo["warnings"],
    }


@router.post("/schedule-approvals/{draft_id}/reject", response_model=DraftOut)
def reject_draft(
    draft_id: int,
    payload: DraftRejectRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_schedule_approver),
):
    """Talebi gerekceyle reddeder: PENDING -> REJECTED.

    Taslak SILINMEZ; sahibi gerekceyi gorup duzeltir ve yeniden gonderir
    (REJECTED, OPEN gibi duzenlenebilir bir durumdur, K-59).
    """
    draft = _get_reviewable(db, user, draft_id)
    _ensure_not_self(user, draft)

    draft.status = DraftStatus.REJECTED
    draft.reviewed_by = user.id
    draft.reviewed_at = datetime.now(timezone.utc)
    draft.review_note = payload.note
    log_action(db, user, "REJECT", "schedule_draft", draft.id, draft,
               "Durum: Onay bekliyor → Reddedildi")
    touch_draft(draft)
    db.commit()
    db.refresh(draft)
    return _to_out(db, draft)
