from pydantic import BaseModel, ConfigDict, Field
from app.models import UserRole, UserStatus

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