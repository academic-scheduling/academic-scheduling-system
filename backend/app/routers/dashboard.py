from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import conflict_service
from app.deps import get_db, require_admin
from app.models import (
    Classroom, Course, CourseSection, Department, Exam, Lecturer,
    User, UserRole, UserStatus, WeeklyScheduleEntry,
)
from app.schemas import DashboardSummary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Dashboard'un en üst bloğundaki sayaçlar (kontrat §10, K-33).

    Yalnız ADMIN: alt hesabın dashboard'u yok, menüde de gizli.
    Her sayaç workgroup ile sınırlıdır — K-04 izolasyonu burada da mutlak.
    """
    wg = admin.workgroup_id

    # Workgroup'a DOĞRUDAN bağlı üç varlık: tek filtre yeter.
    # active.is_(True) → pasife alınan kayıt sayılmaz (K-33): pasif kayıt
    # ilgili ekranın listesinden de düşüyor, iki yer aynı sayıyı göstersin.
    departments = db.query(Department).filter(
        Department.workgroup_id == wg, Department.active.is_(True)
    ).count()
    classrooms = db.query(Classroom).filter(
        Classroom.workgroup_id == wg, Classroom.active.is_(True)
    ).count()
    lecturers = db.query(Lecturer).filter(
        Lecturer.workgroup_id == wg, Lecturer.active.is_(True)
    ).count()

    # Ders tablosunda workgroup_id YOK; bölüm üzerinden bağlanır (K-33).
    courses = db.query(Course).join(Department).filter(
        Department.workgroup_id == wg, Course.active.is_(True)
    ).count()

    # Sınav: ders → bölüm zinciri. `active` bayrağı yok, yerine DRAFT/SUBMITTED
    # var (K-03); taslak sınav da gerçek bir kayıttır, ikisi birlikte sayılır.
    exams = db.query(Exam).join(Course).join(Department).filter(
        Department.workgroup_id == wg
    ).count()

    # Haftalık giriş: şube → ders → bölüm zinciri. Kart olarak çizilmiyor ama
    # kontrat §10 bu alanı zaten vaat etmişti, kaldırmak kırıcı olurdu (K-33).
    weekly_entries = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection)
        .join(Course)
        .join(Department)
        .filter(Department.workgroup_id == wg)
        .count()
    )

    def _active_users(role: UserRole) -> int:
        """Yalnız ACTIVE hesaplar (K-33).

        PENDING (davet edildi, hiç giriş yapmadı) ve DISABLED hesaplar
        sayılmaz — ikisi de bugün sisteme hiçbir şey yapamaz. Bekleyen
        davetler alttaki kullanıcı tablosunda rozetle görünür.
        """
        return db.query(User).filter(
            User.workgroup_id == wg,
            User.role == role,
            User.status == UserStatus.ACTIVE,
        ).count()

    # Motor dikişinden geçer (K-22 deseni): router motoru doğrudan çağırmaz,
    # böylece A-3/A-4 entegrasyonunda yalnız conflict_service değişir.
    # Stub aktifken ikisi de 0 — K-33'te kayıtlı bilinen sınırlama.
    scan = conflict_service.scan_workgroup(db, wg)

    return DashboardSummary(
        departments=departments,
        classrooms=classrooms,
        lecturers=lecturers,
        courses=courses,
        admins=_active_users(UserRole.ADMIN),
        sub_accounts=_active_users(UserRole.SUB_ACCOUNT),
        weekly_entries=weekly_entries,
        exams=exams,
        unresolved_hard=len(scan["hard"]),
        unresolved_warnings=len(scan["warnings"]),
    )
