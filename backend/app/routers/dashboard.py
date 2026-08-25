from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import conflict_service
from app.conflicts.slots import SLOTS
from app.deps import get_current_user, get_db
from app.models import (
    Classroom, Course, CourseSection, Department, Exam, Lecturer,
    User, UserRole, UserStatus, WeeklyScheduleEntry,
)
from app.schemas import DashboardSummary, OccupancySummary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Ana sayfanın sayaç kartları (kontrat §10, K-33, K-82).

    K-82'ye kadar yalnız ADMIN'di, çünkü sayaçlar admin'e özel bir sayfada
    duruyordu. Dashboard ana sayfaya taşınınca soru yeniden soruldu: bu
    sayılardan hangisi gerçekten gizli? Cevap: bölüm/derslik/ders/sınav
    sayısını alt hesap zaten listeleyebiliyor (K-26), çakışmayı da görüyor
    (`/conflicts` herkese açık) — saymak yeni bir şey ifşa etmiyor. Yalnız
    KULLANICI sayaçları yönetim bilgisidir; onlar admin dışında None döner.

    Her sayaç workgroup ile sınırlıdır — K-04 izolasyonu burada da mutlak.
    """
    wg = user.workgroup_id

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

    # Sınav: ders → bölüm zinciri. `active` bayrağı yok; kapsamı K-60'tan beri
    # `draft_id` çizer — sayaç YAYINDAKİ sınav takvimini anlatır, kimsenin özel
    # taslağı fakültenin sınav sayısını şişirmemeli (haftalık sayacın eşi).
    exams = db.query(Exam).join(Course).join(Department).filter(
        Department.workgroup_id == wg, Exam.draft_id.is_(None)
    ).count()

    # Haftalık giriş: şube → ders → bölüm zinciri. Kart olarak çizilmiyor ama
    # kontrat §10 bu alanı zaten vaat etmişti, kaldırmak kırıcı olurdu (K-33).
    weekly_entries = (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection)
        .join(Course)
        .join(Department)
        .filter(Department.workgroup_id == wg,
                # K-59: sayaç YAYINDAKİ programı anlatır; kimsenin özel
                # taslağı fakültenin ders sayısını şişirmemeli.
                WeeklyScheduleEntry.draft_id.is_(None))
        .count()
    )

    def _active_users(role: UserRole) -> int | None:
        """Yalnız ACTIVE hesaplar (K-33).

        PENDING (davet edildi, hiç giriş yapmadı) ve DISABLED hesaplar
        sayılmaz — ikisi de bugün sisteme hiçbir şey yapamaz. Bekleyen
        davetler Yönetim sayfasındaki kullanıcı tablosunda rozetle görünür.

        K-82: admin değilse SORGU HİÇ ÇALIŞMAZ ve None döner. Sıfır dönmek
        yanlış olurdu — "kullanıcı yok" ile "sana gösterilmiyor" farklı
        şeyler; istemci None görünce kartı hiç çizmiyor.
        """
        if user.role != UserRole.ADMIN:
            return None
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


# Izgaranin sabitleri: zaman modelinin kendisi (slots.py 9 slot, brief §3.4
# calisma gunu Pzt-Cum). Sayi olarak degil, TEK KAYNAKTAN turetiliyor ki
# slot tanimi degisirse isi haritasi sessizce yanlislasmasin.
SLOT_COUNT = len(SLOTS)
DAY_COUNT = 5


@router.get("/occupancy", response_model=OccupancySummary)
def get_occupancy(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Haftalık derslik doluluk ısı haritası (K-82).

    `grid[slot-1][gün-1]` = o gün ve slotta DOLU olan ayrı derslik sayısı.
    Payda `classrooms`: aktif derslik sayısı (sayaç kartıyla aynı tanım).

    Üç kapsam kararı, üçü de sistemin başka yerlerindeki kuralların aynısı:

    * **Yalnız yayındaki program** (`draft_id IS NULL`) — kimsenin özel
      taslağı fakültenin doluluk haritasını şişirmemeli (K-59; sayaçlar da
      böyle sayıyor).
    * **Dersliksiz girişler sayılmaz.** Online derste derslik OLAMAZ (K-23),
      dolayısıyla `classroom_id IS NOT NULL` filtresi online'ı da eler —
      ayrıca `delivery_mode` bakmaya gerek yok.
    * **Hücrede AYRI derslik sayılır**, giriş değil. Aynı derslikte aynı saatte
      iki giriş zaten W1 çakışmasıdır; onu doluluk olarak iki kez saymak
      dersliği kapasitesinin üstünde dolu gösterirdi.

    Kapsam workgroup geneli — okuma zaten workgroup genelinde serbest (K-26).
    """
    wg = user.workgroup_id

    classrooms = db.query(Classroom).filter(
        Classroom.workgroup_id == wg, Classroom.active.is_(True)
    ).count()

    # Yalnız dört kolon: doluluk için ders adı, hoca, şube gerekmez. Ilişkiler
    # eager yüklenmediği için sorgu tek SELECT'te biter.
    rows = (
        db.query(
            WeeklyScheduleEntry.day_of_week,
            WeeklyScheduleEntry.start_slot,
            WeeklyScheduleEntry.slot_count,
            WeeklyScheduleEntry.classroom_id,
        )
        .join(CourseSection, WeeklyScheduleEntry.section_id == CourseSection.id)
        .join(Course, CourseSection.course_id == Course.id)
        .join(Department, Course.department_id == Department.id)
        .filter(
            Department.workgroup_id == wg,
            WeeklyScheduleEntry.draft_id.is_(None),
            WeeklyScheduleEntry.classroom_id.isnot(None),
        )
        .all()
    )

    # Once KUME topla, sonra say: bir giris birden cok slota yayilir
    # (slot_count) ve her slotta ayni dersligi doldurur.
    dolu: list[list[set[int]]] = [
        [set() for _ in range(DAY_COUNT)] for _ in range(SLOT_COUNT)
    ]
    for day, start, count, classroom_id in rows:
        if not 1 <= day <= DAY_COUNT:
            continue                      # veri bozuksa izgarayi tasirmayalim
        for slot in range(start, start + count):
            if 1 <= slot <= SLOT_COUNT:
                dolu[slot - 1][day - 1].add(classroom_id)

    return OccupancySummary(
        classrooms=classrooms,
        grid=[[len(gun) for gun in satir] for satir in dolu],
    )
