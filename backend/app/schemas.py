from pydantic import BaseModel, ConfigDict, Field
from app.models import UserRole, UserStatus
from app.models import UserRole, UserStatus, SemesterType

class LoginRequest(BaseModel):
    email: str
    password: str

class UserPublic(BaseModel):
    id: int
    name: str
    role: UserRole
    can_manage_classrooms: bool
    model_config = ConfigDict(from_attributes=True)

class TokenResponse(BaseModel):
    access_token: str
    user: UserPublic

# --- Davet (WP1-invitations) ---

class InviteRequest(BaseModel):
    name: str = Field(..., description="Davet edilecek kullanıcının adı")    
    email: str = Field(..., description="Davet edilecek kullanıcının e-posta adresi")
    role: UserRole = UserRole.SUB_ACCOUNT
    department_ids: list[int] = []    
    can_manage_classrooms: bool = Field(
        False, description="Kullanıcıya sınıf yönetim yetkisi verilsin mi?"
    )

class InviteResponse(BaseModel):
    id: int
    status: UserStatus
    model_config = ConfigDict(from_attributes=True)

class CompleteInvitationRequest(BaseModel):
    token: str = Field(..., description="Davet tokeni")
    password: str = Field(min_length=8, description="Kullanıcının belirleyeceği şifre")

class MessageResponse(BaseModel):
    message: str

class UserListItem(BaseModel):
    id: int
    name: str
    email: str
    role: UserRole
    status: UserStatus
    can_manage_classrooms: bool
    department_ids: list[int] = []
    model_config = ConfigDict(from_attributes=True)

# --- Bölümler (WP2) ---

class DepartmentCreate(BaseModel):
    name: str
    code: str

class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None

class DepartmentOut(BaseModel):
    id: int
    name: str
    code: str
    model_config = ConfigDict(from_attributes=True)

# --- Lecturers (WP2) ---

class LecturerCreate(BaseModel):
    full_name: str
    email: str | None = None
    is_external: bool = False

class LecturerOut(BaseModel):
    id: int
    full_name: str
    is_external: bool
    model_config = ConfigDict(from_attributes=True)

# --- Binalar (WP2, K-18) ---

class BuildingCreate(BaseModel):
    name: str

class BuildingUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None

class BuildingOut(BaseModel):
    id: int
    name: str
    active: bool
    model_config = ConfigDict(from_attributes=True)

class BuildingRef(BaseModel):
    """Derslik cevabının içine gömülen kısa bina gösterimi."""
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)


# --- Derslikler (WP2, K-07/K-17) ---

class ClassroomCreate(BaseModel):
    building_id: int
    room_code: str
    capacity: int = Field(gt=0)           # K-07: zorunlu ve pozitif
    exam_capacity: int | None = Field(None, gt=0)   # K-21: opsiyonel

class ClassroomUpdate(BaseModel):
    building_id: int | None = None
    room_code: str | None = None
    capacity: int | None = Field(None, gt=0)
    exam_capacity: int | None = Field(None, gt=0)
    active: bool | None = None

class ClassroomOut(BaseModel):
    id: int
    building: BuildingRef                 # iç içe nesne — kontrat şekli
    room_code: str
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