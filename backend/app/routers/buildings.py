from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user, require_classroom_manager
from app.models import Building, User
from app.schemas import BuildingCreate, BuildingUpdate, BuildingOut
from app.audit import log_action

router = APIRouter(prefix="/buildings", tags=["buildings"])


@router.get("", response_model=list[BuildingOut])
def list_buildings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(Building)
        .filter(Building.workgroup_id == user.workgroup_id)
        .order_by(Building.name)
        .all()
    )


@router.post("", response_model=BuildingOut, status_code=status.HTTP_201_CREATED)
def create_building(
    payload: BuildingCreate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_classroom_manager),
):
    clash = db.query(Building).filter(
        Building.workgroup_id == manager.workgroup_id,
        Building.name == payload.name,
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail="Bu bina adı zaten kayıtlı")

    bld = Building(workgroup_id=manager.workgroup_id, name=payload.name)
    db.add(bld)
    db.flush()
    log_action(db, manager, "CREATE", "building", bld.id)
    db.commit()
    db.refresh(bld)
    return bld


@router.patch("/{building_id}", response_model=BuildingOut)
def update_building(
    building_id: int,
    payload: BuildingUpdate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_classroom_manager),
):
    bld = db.get(Building, building_id)
    if bld is None or bld.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Bina bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] != bld.name:
        clash = db.query(Building).filter(
            Building.workgroup_id == manager.workgroup_id,
            Building.name == data["name"],
            Building.id != bld.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Bu bina adı zaten kayıtlı")

    for field, value in data.items():
        setattr(bld, field, value)
    log_action(db, manager, "UPDATE", "building", bld.id)
    db.commit()
    db.refresh(bld)
    return bld