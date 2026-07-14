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