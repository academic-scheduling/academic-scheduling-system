from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.deps import get_db, get_current_user, require_classroom_manager
from app.models import (
    Building, Classroom, CourseSection, User, WeeklyScheduleEntry, exam_classrooms,
)
from app.schemas import ClassroomCreate, ClassroomUpdate, ClassroomOut
from app.audit import log_action

router = APIRouter(prefix="/classrooms", tags=["classrooms"])


def _get_owned_building(db: Session, building_id: int, workgroup_id: int) -> Building:
    """building_id bizim workgroup'un mu? Değilse 400 — çapraz-FK izolasyonu."""
    bld = db.get(Building, building_id)
    if bld is None or bld.workgroup_id != workgroup_id:
        raise HTTPException(status_code=400, detail="Geçersiz bina seçimi")
    return bld


@router.get("", response_model=list[ClassroomOut])
def list_classrooms(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(Classroom)
        .options(selectinload(Classroom.building))   # N+1 sorgu önlemi
        .filter(Classroom.workgroup_id == user.workgroup_id)
        .order_by(Classroom.room_code)
        .all()
    )


@router.post("", response_model=ClassroomOut, status_code=status.HTTP_201_CREATED)
def create_classroom(
    payload: ClassroomCreate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_classroom_manager),
):
    _get_owned_building(db, payload.building_id, manager.workgroup_id)

    if payload.exam_capacity is not None and payload.exam_capacity > payload.capacity:          # K-21
        raise HTTPException(
            status_code=400,
            detail="Sınav kontenjanı normal kapasiteyi aşamaz",
        )

    clash = db.query(Classroom).filter(
        Classroom.building_id == payload.building_id,
        Classroom.room_code == payload.room_code,
    ).first()
    if clash:
        raise HTTPException(status_code=409, detail="Bu binada bu oda kodu zaten kayıtlı")

    cls = Classroom(workgroup_id=manager.workgroup_id, **payload.model_dump())
    db.add(cls)
    db.flush()
    log_action(db, manager, "CREATE", "classroom", cls.id)
    db.commit()
    db.refresh(cls)
    return cls


@router.patch("/{classroom_id}", response_model=ClassroomOut)
def update_classroom(
    classroom_id: int,
    payload: ClassroomUpdate,
    db: Session = Depends(get_db),
    manager: User = Depends(require_classroom_manager),
):
    cls = db.get(Classroom, classroom_id)
    if cls is None or cls.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Derslik bulunamadı")

    data = payload.model_dump(exclude_unset=True)

    if "building_id" in data:
        _get_owned_building(db, data["building_id"], manager.workgroup_id)

    # K-17 çapraz alan kuralı: kısmi güncellemede EFEKTİF (yeni ∪ mevcut)
    # değerler üzerinden kontrol edilmeli.
    new_capacity = data.get("capacity", cls.capacity)
    new_exam_capacity = data.get("exam_capacity", cls.exam_capacity)
    if new_exam_capacity is not None and new_exam_capacity > new_capacity:
        raise HTTPException(
            status_code=400,
            detail="Sınav kontenjanı normal kapasiteyi aşamaz",
        )

    # Bina/oda ikilisi değişiyorsa tekillik kontrolü de efektif değerlerle
    new_building_id = data.get("building_id", cls.building_id)
    new_room_code = data.get("room_code", cls.room_code)
    if (new_building_id, new_room_code) != (cls.building_id, cls.room_code):
        clash = db.query(Classroom).filter(
            Classroom.building_id == new_building_id,
            Classroom.room_code == new_room_code,
            Classroom.id != cls.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Bu binada bu oda kodu zaten kayıtlı")

    for field, value in data.items():
        setattr(cls, field, value)
    log_action(db, manager, "UPDATE", "classroom", cls.id)
    db.commit()
    db.refresh(cls)
    return cls

@router.delete("/{classroom_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    manager: User = Depends(require_classroom_manager),
):
    """Yalniz hicbir yere bagli olmayan dersligi siler (K-29).

    Sema zaten korur: weekly_schedule_entries ve exam_classrooms FK'leri
    RESTRICT. default_classroom_id ise SET NULL — teknik olarak silme yalniz
    subenin tercihini temizler ama sessiz yan etki olmasin diye o da engel
    sayilir. Kullanilmis derslik silinmez, PATCH {active:false} ile pasife alinir.
    """
    cls = db.get(Classroom, classroom_id)
    if cls is None or cls.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Derslik bulunamadı")

    weekly_count = db.query(WeeklyScheduleEntry).filter(
        WeeklyScheduleEntry.classroom_id == cls.id
    ).count()
    exam_count = db.query(exam_classrooms).filter(
        exam_classrooms.c.classroom_id == cls.id
    ).count()
    default_count = db.query(CourseSection).filter(
        CourseSection.default_classroom_id == cls.id
    ).count()

    if weekly_count or exam_count or default_count:
        parcalar = []
        if weekly_count:
            parcalar.append(f"{weekly_count} haftalık giriş")
        if exam_count:
            parcalar.append(f"{exam_count} sınav")
        if default_count:
            parcalar.append(f"{default_count} şubenin varsayılan dersliği")
        raise HTTPException(
            status_code=409,
            detail=f"Bu derslik silinemez: {' ve '.join(parcalar)} bağlı. "
                   "Önce bu bağlantıları kaldırın.",
        )

    log_action(db, manager, "DELETE", "classroom", cls.id)
    db.delete(cls)
    db.commit()
