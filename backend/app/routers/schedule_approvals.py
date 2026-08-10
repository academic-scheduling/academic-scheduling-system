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
from sqlalchemy.orm import Session, selectinload

from app.audit import log_action
from app.conflict_service import scan_draft
from app.draft_service import (
    apply_draft, build_applied_summary, compute_diff,
    diff_affected_department_ids, publications_since_opened,
)
from app.deps import get_db, get_current_user, require_schedule_approver
from app.models import (
    Department, DraftStatus, ScheduleDraft, User, UserRole, WeeklyScheduleEntry,
)
from app.routers.weekly_entries import _eager_entry_query
from app.schemas import (
    DraftApproveResponse, DraftOut, DraftRejectRequest, DraftReviewOut,
)

router = APIRouter(tags=["schedule-approvals"])


# ------------------------------------------------------------------
# Erisim
# ------------------------------------------------------------------

def _approvable_query(db: Session, user: User):
    """Onayima acik BEKLEYEN taslaklar (K-25 iki boyut: bayrak + bolum uyeligi).

    OPEN taslaklar girmez — onlar sahibine ozeldir; onay yetkisi yalnizca
    ONAYA GONDERILMIS taslagi gorme hakki verir.
    """
    q = (
        db.query(ScheduleDraft)
        .options(selectinload(ScheduleDraft.department),
                 selectinload(ScheduleDraft.owner),
                 selectinload(ScheduleDraft.reviewer))
        .filter(ScheduleDraft.workgroup_id == user.workgroup_id,
                ScheduleDraft.status == DraftStatus.PENDING)
    )
    if user.role != UserRole.ADMIN:
        if not user.can_approve_schedule:
            return q.filter(False)          # yetkisiz: kuyruk bos
        uyelikler = [m.department_id for m in user.memberships]
        q = q.filter(ScheduleDraft.department_id.in_(uyelikler or [-1]))
    return q


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
    """DraftOut govdesi. `live=False` onaydan SONRA kullanilir: taslagin
    satirlari yayina gecip silindigi icin canli fark hesabi anlamsizdir
    (bos taslak "her sey kaldirildi" gibi gorunurdu)."""
    return {
        "id": draft.id,
        "department_id": draft.department_id,
        "department_name": draft.department.name,
        "year": draft.year,
        "semester": draft.semester,
        "name": draft.name,
        "status": draft.status,
        "entry_count": (
            db.query(WeeklyScheduleEntry)
            .filter(WeeklyScheduleEntry.draft_id == draft.id).count()
        ),
        "change_count": len(compute_diff(db, draft)) if live else 0,
        "owner": draft.owner,
        "created_at": draft.created_at,
        "submitted_at": draft.submitted_at,
        "submit_note": draft.submit_note,
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
    """
    draft = _get_reviewable(db, user, draft_id)
    entries = (
        _eager_entry_query(db, published_only=False)
        .filter(WeeklyScheduleEntry.draft_id == draft.id)
        .order_by(WeeklyScheduleEntry.day_of_week, WeeklyScheduleEntry.start_slot)
        .all()
    )
    sonraki_yayinlar = publications_since_opened(db, draft)
    return {
        "draft": _to_out(db, draft),
        "items": compute_diff(db, draft),
        "entries": entries,
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
    db: Session = Depends(get_db),
    user: User = Depends(require_schedule_approver),
):
    """Taslagin farkini YAYINA uygular. Sistemin tek yayin yazma noktasi."""
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

    uygulanan = apply_draft(db, draft)

    draft.status = DraftStatus.APPROVED
    draft.reviewed_by = user.id
    draft.reviewed_at = datetime.now(timezone.utc)
    draft.applied_summary = build_applied_summary(uygulanan)
    # Ortak ders tasindiysa etkilenen bolumler burada donar; degisiklik akisi
    # ("bolumunuzu etkileyen son degisiklikler") bu satirlari okur.
    etkilenen = diff_affected_department_ids(uygulanan, draft)
    if etkilenen:
        draft.affected_departments = (
            db.query(Department).filter(Department.id.in_(etkilenen)).all()
        )

    log_action(db, user, "APPROVE", "schedule_draft", draft.id, draft,
               draft.applied_summary)
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
    db.commit()
    db.refresh(draft)
    return _to_out(db, draft)
