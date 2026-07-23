from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import get_db, get_current_user, require_lecturer_manager
from app.models import CourseSection, Exam, Lecturer, User
from app.normalize import normalize_lecturer_name
from app.schemas import LecturerCreate, LecturerUpdate, LecturerOut
from app.audit import build_change_summary, log_action

router = APIRouter(prefix="/lecturers", tags=["lecturers"])


@router.get("", response_model=list[LecturerOut])
def list_lecturers(
    search: str | None = Query(None, description="Autocomplete: normalized_name üzerinde arar"),
    include_inactive: bool = Query(
        False, description="K-28: pasifler de gelsin mi (yönetim ekranı için)"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Varsayılan yalnız aktifler: ders formundaki autocomplete pasife alınmış
    # hocayı ÖNERMEMELİ (K-08/K-28). Yönetim ekranı include_inactive=true geçer.
    q = db.query(Lecturer).filter(Lecturer.workgroup_id == user.workgroup_id)
    if not include_inactive:
        q = q.filter(Lecturer.active.is_(True))
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
    log_action(db, manager,"CREATE", "lecturer", lec.id, lec)
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

    ozet = build_change_summary(lec, data)
    for field, value in data.items():
        setattr(lec, field, value)
    log_action(db, manager,"UPDATE", "lecturer", lec.id, lec, ozet)
    db.commit()
    db.refresh(lec)
    return lec


@router.delete("/{lecturer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lecturer(
    lecturer_id: int,
    db: Session = Depends(get_db),
    manager: User = Depends(require_lecturer_manager),
):
    """Yalnız hiçbir yere bağlı olmayan öğretim üyesini siler (K-28).

    Şema zaten korur (lecturer_id FK'leri ondelete=RESTRICT); bu kontrol
    kullanıcının ham DB hatası yerine neyin engellediğini sayan bir mesaj
    görmesi için. Ders vermiş ama ayrılan hoca silinmez, pasife alınır.
    """
    lec = db.get(Lecturer, lecturer_id)
    if lec is None or lec.workgroup_id != manager.workgroup_id:
        raise HTTPException(status_code=404, detail="Öğretim üyesi bulunamadı")

    section_count = db.query(CourseSection).filter(
        CourseSection.lecturer_id == lec.id
    ).count()
    exam_count = db.query(Exam).filter(Exam.lecturer_id == lec.id).count()

    if section_count or exam_count:
        parcalar = []
        if section_count:
            parcalar.append(f"{section_count} şube")
        if exam_count:
            parcalar.append(f"{exam_count} sınav")
        raise HTTPException(
            status_code=409,
            detail=f"Bu öğretim üyesi silinemez: {' ve '.join(parcalar)} bağlı. "
                   "Önce bu bağlantıları kaldırın.",
        )

    log_action(db, manager, "DELETE", "lecturer", lec.id, lec)
    db.delete(lec)
    db.commit()