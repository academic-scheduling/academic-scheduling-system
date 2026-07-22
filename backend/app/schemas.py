from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.models import UserRole, UserStatus, SemesterType
from app.models import EntryStatus, ExamType, DeliveryMode, SessionType, RoomType

class LoginRequest(BaseModel):
    email: str
    password: str

class UserPublic(BaseModel):
    id: int
    name: str
    role: UserRole
    department_ids: list[int] = []          # K-26: yazma kapsamı
    can_manage_courses: bool = False        # K-25: yetenek bayrakları
    can_manage_weekly: bool = False
    can_manage_exams: bool = False
    can_manage_classrooms: bool = False
    can_manage_lecturers: bool = False
    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _admin_has_every_capability(self):
        """ADMIN'de tüm bayraklar true raporlanır (kontrat §1).

        DB'de admin'in bayrakları false'tur ve öyle kalır — deps.py rol
        muafiyetiyle geçirir. Bu dönüşüm yalnız İSTEMCİ İÇİN: UI her yerde
        "role === 'ADMIN' || can_manage_x" yazmak zorunda kalmasın, tek
        koşul yetsin. Yetkinin otoritesi yine sunucudadır.
        """
        if self.role == UserRole.ADMIN:
            self.can_manage_courses = True
            self.can_manage_weekly = True
            self.can_manage_exams = True
            self.can_manage_classrooms = True
            self.can_manage_lecturers = True
        return self

class TokenResponse(BaseModel):
    access_token: str
    user: UserPublic

# --- Davet (WP1-invitations) ---

class InviteRequest(BaseModel):
    name: str = Field(..., description="Davet edilecek kullanıcının adı")
    email: str = Field(..., description="Davet edilecek kullanıcının e-posta adresi")
    role: UserRole = UserRole.SUB_ACCOUNT
    department_ids: list[int] = []
    # K-25: yetenek bayrakları davet anında tek tek seçilir.
    # role=ADMIN geldiğinde router bunları YOK SAYAR (admin zaten hepsine sahip).
    can_manage_courses: bool = False
    can_manage_weekly: bool = False
    can_manage_exams: bool = False
    can_manage_classrooms: bool = False
    can_manage_lecturers: bool = False

class InviteResponse(BaseModel):
    id: int
    status: UserStatus
    model_config = ConfigDict(from_attributes=True)

class CompleteInvitationRequest(BaseModel):
    token: str = Field(..., description="Davet tokeni")
    password: str = Field(min_length=8, description="Kullanıcının belirleyeceği şifre")

class InvitationPreview(BaseModel):
    """GET /auth/invitation/{token} cevabı (K-24).

    Yalnız e-posta + ad: hesap tamamlama ekranı e-postayı salt-okunur gösterir.
    Rol/bölüm/workgroup bilerek DIŞARIDA — token'ı ele geçirene sızdırılmaz.
    """
    email: str
    name: str
    model_config = ConfigDict(from_attributes=True)

class MessageResponse(BaseModel):
    message: str

class UserUpdate(BaseModel):
    """PATCH /users/{id} — hepsi opsiyonel, yalnız gönderilen alan değişir (K-34).

    `email` BİLEREK yok: kimliktir ve davet token'ı ona bağlıdır. Yanlış
    e-postanın çözümü düzenleme değil, daveti silip yeniden göndermektir.

    `status` yalnız ACTIVE|DISABLED alır — PENDING'e geri dönülemez, çünkü
    tamamlanmış bir hesap "henüz tamamlanmamış" haline getirilemez.
    """
    name: str | None = None
    role: UserRole | None = None
    department_ids: list[int] | None = None
    status: Literal[UserStatus.ACTIVE, UserStatus.DISABLED] | None = None
    can_manage_courses: bool | None = None
    can_manage_weekly: bool | None = None
    can_manage_exams: bool | None = None
    can_manage_classrooms: bool | None = None
    can_manage_lecturers: bool | None = None


class UserListItem(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    status: UserStatus
    department_ids: list[int] = []
    can_manage_courses: bool = False
    can_manage_weekly: bool = False
    can_manage_exams: bool = False
    can_manage_classrooms: bool = False
    can_manage_lecturers: bool = False
    model_config = ConfigDict(from_attributes=True)

# --- Bölümler (WP2) ---

class DepartmentCreate(BaseModel):
    name: str
    code: str

class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    active: bool | None = None

class DepartmentOut(BaseModel):
    id: int
    name: str
    code: str
    active: bool
    model_config = ConfigDict(from_attributes=True)

# --- Lecturers (WP2) ---

class LecturerCreate(BaseModel):
    full_name: str
    email: str | None = None
    is_external: bool = False

class LecturerUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    is_external: bool | None = None
    active: bool | None = None

class LecturerOut(BaseModel):
    id: int
    full_name: str
    normalized_name: str                      # K-28: unvansız ad — istemci sıralaması bunu kullanır
    is_external: bool
    active: bool                              # K-28: yönetim ekranı pasifi ayırt eder
    model_config = ConfigDict(from_attributes=True)

# --- Binalar (WP2, K-18) ---

class BuildingCreate(BaseModel):
    name: str
    is_external: bool = False                 # K-30: fakülte dışı bina

class BuildingUpdate(BaseModel):
    name: str | None = None
    is_external: bool | None = None
    active: bool | None = None

class BuildingOut(BaseModel):
    id: int
    name: str
    is_external: bool
    active: bool
    model_config = ConfigDict(from_attributes=True)

class BuildingRef(BaseModel):
    """Derslik cevabının içine gömülen kısa bina gösterimi."""
    id: int
    name: str
    is_external: bool                         # K-30: derslik tablosunda rozet için
    model_config = ConfigDict(from_attributes=True)


# --- Derslikler (WP2, K-07/K-17) ---

class ClassroomCreate(BaseModel):
    building_id: int
    room_code: str
    room_type: RoomType = RoomType.CLASSROOM   # K-31: amfi / lab / derslik
    capacity: int = Field(gt=0)           # K-07: zorunlu ve pozitif
    exam_capacity: int | None = Field(None, gt=0)   # K-21: opsiyonel

class ClassroomUpdate(BaseModel):
    building_id: int | None = None
    room_code: str | None = None
    room_type: RoomType | None = None          # K-31
    capacity: int | None = Field(None, gt=0)
    exam_capacity: int | None = Field(None, gt=0)
    active: bool | None = None

class ClassroomOut(BaseModel):
    id: int
    building: BuildingRef                 # iç içe nesne — kontrat şekli
    room_code: str
    room_type: RoomType                   # K-31
    capacity: int
    exam_capacity: int | None
    active: bool
    model_config = ConfigDict(from_attributes=True)


# --- Dersler ve Şubeler (WP2, K-14/K-20) ---

class SectionCreate(BaseModel):
    section_no: int = Field(gt=0)
    lecturer_id: int
    expected_students: int = Field(gt=0)      # K-07: zorunlu
    default_classroom_id: int | None = None

class SectionUpdate(BaseModel):
    section_no: int | None = Field(None, gt=0)
    lecturer_id: int | None = None
    expected_students: int | None = Field(None, gt=0)
    default_classroom_id: int | None = None
    active: bool | None = None

class SectionOut(BaseModel):
    id: int
    section_no: int
    lecturer: LecturerOut                     # iç içe hoca — kontrat şekli
    expected_students: int
    default_classroom_id: int | None
    active: bool
    model_config = ConfigDict(from_attributes=True)

class CourseCreate(BaseModel):
    department_id: int
    year: int = Field(ge=1, le=6)
    semester: SemesterType                    # enum: FALL/SPRING/SUMMER — Pydantic doğrular
    code: str
    name: str
    is_elective: bool = False
    hours_theory: int = Field(0, ge=0)        # K-20: T+U+L, varsayılan 0
    hours_practice: int = Field(0, ge=0)
    hours_lab: int = Field(0, ge=0)

class CourseUpdate(BaseModel):
    # Kimlik alanları (department/year/semester) PATCH'le DEĞİŞMEZ —
    # yanlış girildiyse ders pasife alınıp yeniden açılır. code/name/T+U+L düzeltilebilir.
    code: str | None = None
    name: str | None = None
    is_elective: bool | None = None
    hours_theory: int | None = Field(None, ge=0)
    hours_practice: int | None = Field(None, ge=0)
    hours_lab: int | None = Field(None, ge=0)
    active: bool | None = None

class CourseOut(BaseModel):
    id: int
    department_id: int
    year: int
    semester: SemesterType
    code: str
    name: str
    is_elective: bool
    hours_theory: int
    hours_practice: int
    hours_lab: int
    active: bool
    sections: list[SectionOut]                # ders + şubeleri iç içe — kontrat şekli
    model_config = ConfigDict(from_attributes=True)


# --- Çakışma sonucu (kontrat §0 — C'nin motoru üretir, B çizer) ---

class ConflictAffectedRef(BaseModel):
    type: Literal["weekly_entry", "exam"]
    id: int
    course_code: str | None = None

class ConflictResultOut(BaseModel):
    severity: Literal["HARD", "WARNING"]
    rule_id: str                              # "W1".."W8" | "E1".."E7" | "X1".."X3"
    message: str
    affected: list[ConflictAffectedRef] = []


# --- Sınavlar (WP4, K-16/K-17/K-22) ---

class ExamCreate(BaseModel):
    course_id: int                            # DERS id'si — şube değil (K-16)
    exam_type: ExamType
    exam_date: date
    start_time: time                          # saat kısıtı yok, 18:00 geçerli (K-06)
    duration_minutes: int = Field(ge=10, le=480)
    classroom_ids: list[int] = []             # çoklu derslik; boş = henüz atanmadı (K-17)
    lecturer_id: int
    notes: str | None = None

class ExamUpdate(BaseModel):
    # course_id PATCH'le DEĞİŞMEZ (sınavın kimliği) — yanlışsa DRAFT silinip yeniden açılır.
    exam_type: ExamType | None = None
    exam_date: date | None = None
    start_time: time | None = None
    duration_minutes: int | None = Field(None, ge=10, le=480)
    classroom_ids: list[int] | None = None    # verilirse liste TAM değişir (K-22)
    lecturer_id: int | None = None
    notes: str | None = None

class CourseRef(BaseModel):
    """Sınav cevabının içine gömülen kısa ders gösterimi."""
    id: int
    code: str
    name: str
    model_config = ConfigDict(from_attributes=True)

class ExamClassroomRef(BaseModel):
    """Kontrat §8: sınav dersliği — exam_capacity ile (capacity DEĞİL, K-17)."""
    id: int
    building: BuildingRef
    room_code: str
    exam_capacity: int | None
    model_config = ConfigDict(from_attributes=True)

class ExamOut(BaseModel):
    id: int
    course: CourseRef
    exam_type: ExamType
    exam_date: date
    start_time: time
    duration_minutes: int
    classrooms: list[ExamClassroomRef]
    lecturer: LecturerOut
    total_expected_students: int              # türetilir: aktif şubelerin toplamı (K-16)
    notes: str | None
    status: EntryStatus
    model_config = ConfigDict(from_attributes=True)

class ExamSaveResponse(BaseModel):
    """POST/PATCH cevabı: conflicts dolu olsa bile kayıt başarılıdır (K-03)."""
    exam: ExamOut
    conflicts: list[ConflictResultOut]

class ExamSubmitRequest(BaseModel):
    exam_ids: list[int] = Field(min_length=1)

class ExamSubmitResponse(BaseModel):
    submitted: list[int]
    warnings: list[ConflictResultOut]


# --- Haftalık Program (WP3, K-03/K-14/K-19/K-20) ---

class WeeklyEntryCreate(BaseModel):
    section_id: int                           # yerleşim şubeye bağlanır (K-14)
    classroom_id: int | None = None           # senkron/asenkron online'da NULL olabilir (K-19)
    day_of_week: int = Field(ge=1, le=5)      # Pzt-Cum
    start_slot: int = Field(ge=1, le=9)       # slot 1-9
    slot_count: int = Field(1, ge=1)          # ardışık slot sayısı, varsayılan 1
    session_type: SessionType                 # T/U/L'nin hangisini karşılıyor (K-20)
    delivery_mode: DeliveryMode               # yüz yüze / senkron / asenkron (K-19)

class WeeklyEntryUpdate(BaseModel):
    # section_id PATCH'le DEĞİŞMEZ (yerleşimin kimliği) — yanlışsa DRAFT silinip yeniden yerleştirilir.
    classroom_id: int | None = None
    day_of_week: int | None = Field(None, ge=1, le=5)
    start_slot: int | None = Field(None, ge=1, le=9)
    slot_count: int | None = Field(None, ge=1)
    session_type: SessionType | None = None
    delivery_mode: DeliveryMode | None = None

class WeeklySectionRef(BaseModel):
    """Haftalık cevabın içine gömülen kısa şube gösterimi (kontrat §7)."""
    id: int
    section_no: int
    course: CourseRef                         # id/code/name — satır 239'daki ref yeniden kullanılıyor
    model_config = ConfigDict(from_attributes=True)

class WeeklyEntryOut(BaseModel):
    id: int
    section: WeeklySectionRef
    classroom: ClassroomOut | None            # W7 kapasite kuralı capacity'yi ister
    day_of_week: int
    start_slot: int
    slot_count: int
    session_type: SessionType
    delivery_mode: DeliveryMode
    status: EntryStatus
    model_config = ConfigDict(from_attributes=True)

class WeeklyEntrySaveResponse(BaseModel):
    """POST/PATCH cevabı: conflicts dolu olsa bile kayıt başarılıdır (K-03)."""
    entry: WeeklyEntryOut
    conflicts: list[ConflictResultOut]

class WeeklyEntrySubmitRequest(BaseModel):
    entry_ids: list[int] = Field(min_length=1)

class WeeklyEntrySubmitResponse(BaseModel):
    submitted: list[int]
    warnings: list[ConflictResultOut]

# --- Dashboard (WP6, K-33) ---

class DashboardSummary(BaseModel):
    """GET /dashboard/summary cevabi (kontrat 10, K-33).

    Sekiz kart cizilir; weekly_entries kart degil ama alan korunuyor
    (kontrat onu zaten vaat etmisti, kaldirmak kirici degisiklik olurdu).
    """
    departments: int
    classrooms: int
    lecturers: int
    courses: int
    admins: int
    sub_accounts: int
    weekly_entries: int
    exams: int
    unresolved_hard: int
    unresolved_warnings: int


class ConflictScanOut(BaseModel):
    """GET /conflicts cevabi (kontrat 9).

    Tam tarama sonucu ikiye ayrilmis halde doner: hard submit'i engeller,
    warning engellemez (K-05). Ayrimi sunucu yapar, UI yalnizca cizer.
    """
    hard: list[ConflictResultOut] = []
    warnings: list[ConflictResultOut] = []
