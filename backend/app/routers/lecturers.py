from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user, require_lecturer_manager
from app.models import Lecturer, User
from app.normalize import normalize_lecturer_name
from app.schemas import LecturerCreate, LecturerUpdate, LecturerOut
from app.audit import log_action

router = APIRouter(prefix="/lecturers", tags=["lecturers"])


@router.get("", response_model=list[LecturerOut])
def list_lecturers(
    search: str | None = Query(None, description="Autocomplete: normalized_name üzerinde arar"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Lecturer).filter(
        Lecturer.workgroup_id == user.workgroup_id,
        Lecturer.active.is_(True),
    )
    if search:
        # Aranan terimi de normalize et: kullanici "Doç. Ayşe" yazsa da bulsun
        q = q.filter(Lecturer.normalized_name.contains(normalize_lecturer_name(search)))
    return q.order_by(Lecturer.full_name).all()


@router.post("", response_model=LecturerOut, status_code=status.HTTP_201_CREATED)
def create_lecturer(
    payload: LecturerCreate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    normalized = normalize_lecturer_name(payload.full_name)
    if not normalized:
        raise HTTPException(status_code=400, detail="Geçerli bir hoca adı girilmeli")

    clash = db.query(Lecturer).filter(
        Lecturer.workgroup_id == manager.workgroup_id,
        Lecturer.normalized_name == normalized,
    ).first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"Bu hoca zaten kayıtlı: {clash.full_name}",
        )

    lec = Lecturer(
        workgroup_id=manager.workgroup_id,
        full_name=payload.full_name,
        normalized_name=normalized,
        email=payload.email,
        is_external=payload.is_external,
        source="MANUAL",          # elle eklenen 40/a; web import'u IMPORT yazar
    )
    db.add(lec)
    db.flush()
    log_action(db, manager,"CREATE", "lecturer", lec.id)
    db.commit()
    db.refresh(lec)
    return lec


@router.patch("/{lecturer_id}", response_model=LecturerOut)
def update_lecturer(
    lecturer_id: int,
    payload: LecturerUpdate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    lec = db.get(Lecturer, lecturer_id)
    if lec is None or lec.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Hoca bulunamadı")

    data = payload.model_dump(exclude_unset=True)

    # full_name degisirse normalized_name yeniden hesaplanir ve cakisma kontrol edilir.
    if "full_name" in data:
        normalized = normalize_lecturer_name(data["full_name"])
        if not normalized:
            raise HTTPException(status_code=400, detail="Geçerli bir hoca adı girilmeli")
        if normalized != lec.normalized_name:
            clash = db.query(Lecturer).filter(
                Lecturer.workgroup_id == manager.workgroup_id,
                Lecturer.normalized_name == normalized,
                Lecturer.id != lec.id,
            ).first()
            if clash:
                raise HTTPException(
                    status_code=409,
                    detail=f"Bu hoca zaten kayıtlı: {clash.full_name}",
                )
        lec.normalized_name = normalized

    for field, value in data.items():
        setattr(lec, field, value)
    log_action(db, manager,"UPDATE", "lecturer", lec.id)
    db.commit()
    db.refresh(lec)
    return lec