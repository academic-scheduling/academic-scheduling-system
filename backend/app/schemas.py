from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.models import UserRole, UserStatus, SemesterType
from app.models import EntryStatus, ExamType, DeliveryMode, SessionType, RoomType
from app.models import DraftStatus

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
    can_approve_schedule: bool = False      # K-59: taslağı yayına alma
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
            # K-59: ADMIN bayraktan muaftır (başkasının talebini onaylayabilir).
            # ÖZ-ONAY yasağından muaf DEĞİLDİR — onu sunucu ayrıca denetler.
            self.can_approve_schedule = True
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
    can_approve_schedule: bool = False      # K-59


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

class ForgotPasswordRequest(BaseModel):
    """POST /auth/forgot-password (K-43, K-44)."""
    email: str = Field(..., description="Hesabın e-posta adresi")
    # K-44: Google reCAPTCHA v2 cevabı. Opsiyonel, çünkü anahtar tanımlı
    # değilken (yerel geliştirme) doğrulama atlanır ve istemci bu alanı hiç
    # göndermez. Anahtar tanımlıyken eksikliği 400 ile reddedilir.
    captcha_token: str | None = Field(
        default=None, description="reCAPTCHA v2 istemci cevabı (g-recaptcha-response)"
    )

class ResetPasswordRequest(BaseModel):
    """POST /auth/reset-password (K-43). Davet tamamlamanın ikizi."""
    token: str = Field(..., description="Şifre sıfırlama tokeni")
    password: str = Field(min_length=8, description="Yeni şifre")

class PasswordResetPreview(BaseModel):
    """GET /auth/reset/{token} cevabı (K-43).

    Yalnız e-posta: sıfırlama ekranı "hangi hesap" olduğunu salt-okunur
    gösterir. Ad bile DIŞARIDA — davet önizlemesinden (K-24) daha dar,
    çünkü burada karşı taraf hesabın sahibi olduğunu henüz kanıtlamadı;
    token'ı ele geçirene kişi adı sızdırmanın bir faydası yok.
    """
    email: str
    model_config = ConfigDict(from_attributes=True)

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
    can_approve_schedule: bool | None = None      # K-59


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
    can_approve_schedule: bool = False      # K-59
    model_config = ConfigDict(from_attributes=True)

# --- Bölümler (WP2) ---

class DepartmentCreate(BaseModel):
    name: str
    code: str
    name_en: str | None = None       # resmi sinav programi ingilizce basligi icin
    faculty_en: str | None = None

class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    active: bool | None = None
    name_en: str | None = None
    faculty_en: str | None = None

class DepartmentOut(BaseModel):
    id: int
    name: str
    code: str
    active: bool
    name_en: str | None = None
    faculty_en: str | None = None
    model_config = ConfigDict(from_attributes=True)

# --- Lecturers (WP2) ---

class LecturerCreate(BaseModel):
    full_name: str                            # K-52: yalnız ad (unvansız)
    title: str | None = None                  # K-52: akademik unvan, ayrı alan
    email: str | None = None
    is_external: bool = False
    # Asli bölüm. API'de opsiyonel (import ve eski akışlar bölümsüz kayıt
    # üretebilir); ekleme formu zorunlu tutar.
    department_id: int | None = None

class LecturerUpdate(BaseModel):
    full_name: str | None = None
    title: str | None = None                  # K-52
    email: str | None = None
    is_external: bool | None = None
    active: bool | None = None
    department_id: int | None = None

class LecturerOut(BaseModel):
    id: int
    full_name: str
    title: str | None = None                  # K-52: unvan (ad'dan ayrı)
    normalized_name: str                      # K-28: unvansız ad — istemci sıralaması bunu kullanır
    email: str | None = None                  # K-52: LecturerOut'ta artık dönüyor (formda opsiyonel)
    is_external: bool
    active: bool                              # K-28: yönetim ekranı pasifi ayırt eder
    department_id: int | None = None          # asli bölüm (frontend ad'a kendi eşler)
    duty_unit: str | None = None              # K-50: Görev Birimi (web import)
    cadre_unit: str | None = None             # K-50: Kadro Birimi (web import)
    model_config = ConfigDict(from_attributes=True)


# --- Öğretim üyesi web import (K-50) ---

class ImportRow(BaseModel):
    """Önizlemedeki (ve commit'e geri gönderilen) tek aday satır."""
    full_name: str                            # K-52: yalnız ad (unvansız)
    title: str | None = None                  # K-52: siteden kanonikleştirilen unvan
    normalized_name: str
    duty_unit: str | None = None
    cadre_unit: str | None = None
    email: str | None = None
    department_id: int | None = None          # görev biriminden eşlenen bölüm
    department_label: str | None = None        # "CENG — Bilgisayar Müh." veya None
    detail_url: str

class ImportPreviewOut(BaseModel):
    """`POST /lecturers/import/preview` cevabı — hiçbir şey yazılmaz."""
    new: list[ImportRow]                       # sistemde olmayan, eklenebilecek kişiler
    already_present: int                       # ada göre zaten kayıtlı olanların sayısı
    list_total: int                            # liste sayfasında bulunan toplam kişi

class ImportCommitIn(BaseModel):
    """Kullanıcının önizlemeden seçip onayladığı satırlar."""
    rows: list[ImportRow]

class ImportCommitOut(BaseModel):
    created: list[LecturerOut]
    skipped: list[str]                         # bu arada eklenmiş/çakışan adlar (TOCTOU)

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

# --- Ortak (servis) ders cohort'ları (K-48) ---

class CourseCohortIn(BaseModel):
    """Ortak dersin EK cohort'u: aldığı bir başka (bölüm, yıl, dönem)."""
    department_id: int
    year: int = Field(ge=1, le=6)
    semester: SemesterType

class CourseCohortOut(BaseModel):
    id: int
    department_id: int
    department_name: str                      # UI'da id değil ad gösterir
    year: int
    semester: SemesterType
    model_config = ConfigDict(from_attributes=True)

class CourseCreate(BaseModel):
    department_id: int
    year: int = Field(ge=1, le=6)
    semester: SemesterType                    # enum: FALL/SPRING/SUMMER — Pydantic doğrular
    code: str
    name: str
    is_elective: bool = False
    is_common: bool = False                   # K-48: ortak (servis) ders mi
    hours_theory: int = Field(0, ge=0)        # K-20: T+U+L, varsayılan 0
    hours_practice: int = Field(0, ge=0)
    hours_lab: int = Field(0, ge=0)
    ects: int | None = Field(None, ge=0)      # K-55: AKTS, opsiyonel
    # K-45: bileşen online mı. Saati 0 olan bileşenin bayrağı router'da
    # zorla false'a çekilir (anlamsız veri tutulmaz).
    theory_online: bool = False
    practice_online: bool = False
    lab_online: bool = False
    midterm_count: int = Field(1, ge=1, le=3)   # K-46: 1-3 vize (final/büt tek)

class CourseUpdate(BaseModel):
    # Kimlik alanları (department/year/semester) PATCH'le DEĞİŞMEZ —
    # yanlış girildiyse ders pasife alınıp yeniden açılır. code/name/T+U+L düzeltilebilir.
    code: str | None = None
    name: str | None = None
    is_elective: bool | None = None
    is_common: bool | None = None             # K-48
    # K-48: ek cohort'ların TAM listesi (verilirse mevcut ek cohort'lar bununla
    # değiştirilir). Yalnız is_common ders için anlamlı; boş liste = ek cohort yok.
    cohorts: list[CourseCohortIn] | None = None
    hours_theory: int | None = Field(None, ge=0)
    hours_practice: int | None = Field(None, ge=0)
    hours_lab: int | None = Field(None, ge=0)
    ects: int | None = Field(None, ge=0)      # K-55: AKTS düzeltilebilir
    theory_online: bool | None = None
    practice_online: bool | None = None
    lab_online: bool | None = None
    midterm_count: int | None = Field(None, ge=1, le=3)   # K-46
    active: bool | None = None

class CourseOut(BaseModel):
    id: int
    department_id: int
    year: int
    semester: SemesterType
    code: str
    name: str
    is_elective: bool
    is_common: bool                           # K-48
    hours_theory: int
    hours_practice: int
    hours_lab: int
    ects: int | None                          # K-55: AKTS (null = girilmemiş)
    theory_online: bool
    practice_online: bool
    lab_online: bool
    midterm_count: int                        # K-46
    active: bool
    sections: list[SectionOut]                # ders + şubeleri iç içe — kontrat şekli
    extra_cohorts: list[CourseCohortOut] = [] # K-48: ortak dersin ek cohort'ları
    model_config = ConfigDict(from_attributes=True)


# --- Çakışma sonucu (kontrat §0 — C'nin motoru üretir, B çizer) ---

class ConflictAffectedRef(BaseModel):
    type: Literal["weekly_entry", "exam"]
    id: int
    course_code: str | None = None
    # Çakışma raporu + Bölümler sayacı bölüm/sınıf süzmesi için (kırılgan kod
    # eşleştirmesi yerine id). Motor eski girişlerde üretmezse None kalır.
    department_id: int | None = None
    year: int | None = None

class ConflictResultOut(BaseModel):
    severity: Literal["HARD", "WARNING"]
    rule_id: str                              # "W1".."W8" | "E1".."E7" | "X1".."X3"
    message: str
    affected: list[ConflictAffectedRef] = []


class ConflictScanOut(BaseModel):
    """GET /conflicts cevabi (kontrat 9).

    Tam tarama sonucu ikiye ayrilmis halde doner: hard submit'i engeller,
    warning engellemez (K-05). Ayrimi sunucu yapar, UI yalnizca cizer.
    """
    hard: list[ConflictResultOut] = []
    warnings: list[ConflictResultOut] = []


# --- Sınavlar (WP4, K-16/K-17/K-22) ---

class ExamCreate(BaseModel):
    course_id: int                            # DERS id'si — şube değil (K-16)
    exam_type: ExamType
    # K-46: kaçıncı vize (1-3). Yalnız MIDTERM'de anlamlı; final/büt'te router
    # zorla 1 yapar. Üst sınır course.midterm_count'a karşı router'da denetlenir.
    exam_index: int = Field(1, ge=1, le=3)
    exam_date: date
    start_time: time                          # saat kısıtı yok, 18:00 geçerli (K-06)
    duration_minutes: int = Field(ge=10, le=480)
    classroom_ids: list[int] = []             # çoklu derslik; boş = henüz atanmadı (K-17)
    lecturer_id: int
    notes: str | None = None

class ExamUpdate(BaseModel):
    # course_id PATCH'le DEĞİŞMEZ (sınavın kimliği) — yanlışsa DRAFT silinip yeniden açılır.
    exam_type: ExamType | None = None
    exam_index: int | None = Field(None, ge=1, le=3)   # K-46
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
    exam_index: int                           # K-46: kaçıncı vize (final/büt'te 1)
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

# --- Program taslaklari (K-59) ---

class DraftCreate(BaseModel):
    """Taslak bir COHORT uzerinde acilir (K-59) — kapsami bu uclu belirler."""
    department_id: int
    year: int = Field(ge=1, le=6)
    semester: SemesterType
    name: str | None = None          # boş bırakılırsa sunucu üretir

class DraftRename(BaseModel):
    name: str = Field(min_length=1, max_length=200)

class DraftClearRequest(BaseModel):
    # K-59: ortak dersler varsayılan olarak KORUNUR — silmek üç bölümün
    # programından ders düşürebilir, bu yüzden açıkça istenmeli.
    include_shared: bool = False

class DraftSubmitRequest(BaseModel):
    note: str | None = Field(None, max_length=2000)   # PR açıklaması gibi

class DraftUserRef(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)

class DraftOut(BaseModel):
    id: int
    department_id: int
    department_name: str
    year: int
    semester: SemesterType
    name: str
    status: DraftStatus
    entry_count: int                              # taslaktaki yerleşim sayısı
    change_count: int                             # yayına göre kaç fark var
    owner: DraftUserRef
    created_at: datetime
    submitted_at: datetime | None = None
    submit_note: str | None = None
    reviewer: DraftUserRef | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    # Onay anında dondurulan özet — onaylandıktan sonra fark yeniden
    # hesaplanamaz (taslağın satırları yayına geçip silinir), kayıt kendi
    # kendine yetsin diye saklanır (K-36 deseni).
    applied_summary: str | None = None

class DraftPlacementOut(BaseModel):
    day_of_week: int
    start_slot: int
    slot_count: int
    classroom_id: int | None
    classroom_label: str | None
    delivery_mode: DeliveryMode

class DraftAffectedDepartmentOut(BaseModel):
    id: int
    name: str

class DraftDiffItemOut(BaseModel):
    """Tek bir değişiklik satırı — inceleme ekranının okuduğu birim."""
    kind: Literal["ADDED", "REMOVED", "MOVED"]
    section_id: int
    course_code: str
    course_name: str
    section_no: int
    session_type: SessionType
    is_shared: bool                               # K-48 ortak ders mi
    affected_departments: list[DraftAffectedDepartmentOut] = []
    before: DraftPlacementOut | None = None
    after: DraftPlacementOut | None = None

class DraftDiffOut(BaseModel):
    draft_id: int
    items: list[DraftDiffItemOut] = []

class DraftSubmitResponse(BaseModel):
    draft: DraftOut
    warnings: list[ConflictResultOut] = []        # engellemez, görünür kalır

class DraftRejectRequest(BaseModel):
    # Gerekçesiz ret işe yaramaz: gönderen neyi düzelteceğini bilemez.
    note: str = Field(min_length=1, max_length=2000)

class DraftStalenessOut(BaseModel):
    """Taslak açıldıktan sonra programın kaç kez değiştiği (K-59).

    Taslak, açıldığı andaki yayının kopyasıdır ve eskiyebilir; sahibinin
    dokunmadığı satırlar bile arada başkasının onayı geçtiyse farkta "geri
    alınacak değişiklik" olarak belirir. Fark bunu zaten satır satır gösterir;
    bu, onaylayıcıya DİKKATLİ BAKMASI gerektiğini söyleyen üst düzey işaret.
    """
    opened_at: datetime
    publications_since: int
    last_published_at: datetime | None = None
    last_published_by: str | None = None

class DraftReviewOut(BaseModel):
    """İnceleme ekranının tek çağrıda ihtiyaç duyduğu her şey.

    Yayındaki ızgara ayrı uçtan (`GET /weekly-entries`) gelir; burada
    ÖNERİLEN taraf + fark + çakışma + bayatlık işareti durur.
    """
    draft: DraftOut
    items: list[DraftDiffItemOut] = []
    entries: list[WeeklyEntryOut] = []            # önerilen ızgara
    conflicts: ConflictScanOut
    staleness: DraftStalenessOut

class ScheduleChangeOut(BaseModel):
    """Değişiklik akışının bir satırı (K-59).

    Kaynağı onaylanmış taslak kaydının kendisidir — ayrı bildirim tablosu yok.
    `summary` onay anında dondurulmuştur: taslağın satırları yayına geçip
    silindiği için fark geriye dönük yeniden hesaplanamaz (K-36 deseni).
    """
    id: int
    department_id: int
    department_name: str
    year: int
    semester: SemesterType
    summary: str | None                       # "1 taşındı, 1 kaldırıldı · ..."
    published_at: datetime | None
    published_by: str                         # değişikliği yapan (taslak sahibi)
    approved_by: str | None                   # yayına alan onay yetkilisi
    # K-48: ortak ders taşındıysa dolu — bu değişiklik onların programına da düştü.
    affected_departments: list[DraftAffectedDepartmentOut] = []


class DraftApproveResponse(BaseModel):
    draft: DraftOut
    applied: list[DraftDiffItemOut] = []          # yayına ne geçti
    warnings: list[ConflictResultOut] = []

class DraftClearResponse(BaseModel):
    deleted: int
    preserved_shared: int                         # korunan ortak ders yerleşimi


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


# --- Islem kayitlari (WP6, K-35) ---

class AuditActorOut(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)

class AuditLogOut(BaseModel):
    id: int
    created_at: datetime
    user: AuditActorOut | None            # K-34 sayesinde pratikte hic null olmaz
    action: str
    entity_type: str
    entity_id: int
    entity_label: str | None              # HANGI kayit (K-36)
    change_summary: str | None            # NE degisti: "Durum: Aktif → Pasif" (K-38)

class AuditLogPage(BaseModel):
    """Sayfali cevap: log tek buyuyen tablodur, hepsi donmez (K-35)."""
    total: int
    items: list[AuditLogOut]
