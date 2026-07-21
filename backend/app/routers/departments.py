from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user, require_admin
from app.models import Course, Department, DepartmentMembership, User
from app.schemas import DepartmentCreate, DepartmentUpdate, DepartmentOut
from app.audit import log_action

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        db.query(Department)
        .filter(Department.workgroup_id == user.workgroup_id)
        .order_by(Department.code)
        .all()
    )


@router.post("", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    exists = db.query(Department).filter(
        Department.workgroup_id == admin.workgroup_id,
        Department.code == payload.code,
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Bu bölüm kodu zaten kayıtlı")

    dep = Department(
        workgroup_id=admin.workgroup_id,   # istemciden DEĞİL, token'dan
        name=payload.name,
        code=payload.code,
    )
    db.add(dep)
    db.flush()
    log_action(db, admin, "CREATE", "department", dep.id)
    db.commit()
    db.refresh(dep)
    return dep


@router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    dep = db.get(Department, department_id)
    if dep is None or dep.workgroup_id != admin.workgroup_id:
        raise HTTPException(status_code=404, detail="Bölüm bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] != dep.code:
        clash = db.query(Department).filter(
            Department.workgroup_id == admin.workgroup_id,
            Department.code == data["code"],
            Department.id != dep.id,
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="Bu bölüm kodu zaten kayıtlı")

    for field, value in data.items():
        setattr(dep, field, value)
    log_action(db, admin, "UPDATE", "department", dep.id)
    db.commit()
    db.refresh(dep)
    return dep

@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Yalnız BOŞ bölümü kalıcı siler (K-27).

    departments'a FK ile bağlanan tek şey courses ve department_memberships;
    ikisi de yoksa CASCADE'in silecek hiçbir şeyi kalmaz. Biri varsa 409 —
    mesaj neyin engellediğini sayarak söyler ki kullanıcı ne yapacağını bilsin.
    """
    dep = db.get(Department, department_id)
    if dep is None or dep.workgroup_id != admin.workgroup_id:
        raise HTTPException(status_code=404, detail="Bölüm bulunamadı")

    course_count = db.query(Course).filter(Course.department_id == dep.id).count()
    member_count = (
        db.query(DepartmentMembership)
        .filter(DepartmentMembership.department_id == dep.id)
        .count()
    )
    if course_count or member_count:
        parcalar = []
        if course_count:
            parcalar.append(f"{course_count} ders")
        if member_count:
            parcalar.append(f"{member_count} kullanıcı ataması")
        raise HTTPException(
            status_code=409,
            detail=f"Bu bölüm silinemez: {' ve '.join(parcalar)} bağlı. "
                   "Önce bunları kaldırın.",
        )

    log_action(db, admin, "DELETE", "department", dep.id)
    db.delete(dep)
    db.commit()