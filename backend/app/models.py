"""
SQLAlchemy ORM modelleri.

Bu dosya schema.sql tasariminin Python karsiligidir (v0.3, K-01..K-20).
  - Enum tipleri: schema.sql'deki CREATE TYPE ... AS ENUM karsiliklari
  - Kimlik/organizasyon + cekirdek veri + program/sinav tablolari
  - relationship(): Python tarafinda nesne uzerinden gezinme (DB'yi degistirmez)

v0.2 -> v0.3 (13 Temmuz hoca toplantisi, karar defteri K-14..K-20):
  - courses ikiye ayrildi: Course (ders, kod duzeyi) + CourseSection (sube)
  - Exam ders duzeyine baglandi (subeden bagimsiz tek sinav) ve coklu
    derslige gecti (exam_classrooms)
  - Building tablosu; Classroom.building metni yerine building_id FK
  - Classroom.exam_capacity (bosluklu oturma kontenjani)
  - WeeklyScheduleEntry: section_id + session_type (T/U/L) + delivery_mode

Not: name="..." parametreli enum'lar, PostgreSQL'deki tip adiyla BIREBIR
ayni olmali; Alembic dogru enum tipini bu isimle uretir.
"""

import enum
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Tum model siniflarinin ortak atasi.

    Base.metadata, tanimlanan tum tablolarin kayit defteridir.
    Alembic ileride bu deftere bakip migration uretir.
    """

    pass


# ==================================================================
# Enum tipleri  (schema.sql'deki CREATE TYPE ... AS ENUM karsiliklari)
# ==================================================================


class UserRole(str, enum.Enum):
    """user_role — hesap turu."""

    ADMIN = "ADMIN"
    SUB_ACCOUNT = "SUB_ACCOUNT"


class UserStatus(str, enum.Enum):
    """user_status — kullanici yasam dongusu."""

    PENDING = "PENDING"      # davet edildi, henuz aktiflesmedi
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class SemesterType(str, enum.Enum):
    """semester_type — donem."""

    FALL = "FALL"
    SPRING = "SPRING"
    SUMMER = "SUMMER"


class ExamType(str, enum.Enum):
    """exam_type — sinav turu."""

    MIDTERM = "MIDTERM"
    FINAL = "FINAL"
    MAKEUP = "MAKEUP"


class EntryStatus(str, enum.Enum):
    """entry_status — DRAFT/SUBMITTED yasam dongusu (K-03)."""

    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"


class SessionType(str, enum.Enum):
    """session_type — haftalik girisin karsiladigi T/U/L bileseni (K-20)."""

    THEORY = "THEORY"
    PRACTICE = "PRACTICE"
    LAB = "LAB"


class RoomType(str, enum.Enum):
    """room_type — dersligin fiziksel turu (K-31).

    Bugun yalniz bilgi/filtre amacli; cakisma motoru bu alani OKUMAZ.
    (Ileride "LAB oturumu LAB olmayan derslikte" uyarisi icin veri hazir.)
    """

    CLASSROOM = "CLASSROOM"
    AMPHI = "AMPHI"
    LAB = "LAB"


class DeliveryMode(str, enum.Enum):
    """delivery_mode — girisin islenis bicimi (K-19).

    ONLINE_ASYNC girisler normal gun/saat tasir ama cakisma
    karsilastirmalarina girmez.
    """

    FACE_TO_FACE = "FACE_TO_FACE"
    ONLINE_SYNC = "ONLINE_SYNC"
    ONLINE_ASYNC = "ONLINE_ASYNC"


# ==================================================================
# Kimlik / organizasyon tablolari
# ==================================================================


class Workgroup(Base):
    """workgroups — bir fakulte/calisma grubu; her seyin en ust cati birimi."""

    __tablename__ = "workgroups"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(50), server_default=text("'FACULTY'"))
    allowed_email_domain: Mapped[str] = mapped_column(String(100))
    check_exam_vs_course: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true")
    )
    # Dairesel FK: workgroups -> users. use_alter=True => ayri ALTER TABLE ile eklenir.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_workgroups_created_by",
        ),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # --- iliskiler ---
    # users <-> workgroup: users.workgroup_id uzerinden. Iki FK oldugu icin
    # foreign_keys ile hangi FK'yi kullandigimizi ACIKCA belirtiyoruz.
    users: Mapped[list["User"]] = relationship(
        back_populates="workgroup", foreign_keys="User.workgroup_id"
    )
    # creator: workgroups.created_by uzerinden, tek yonlu (geri baglama yok).
    creator: Mapped["User | None"] = relationship(
        foreign_keys="Workgroup.created_by"
    )
    departments: Mapped[list["Department"]] = relationship(
        back_populates="workgroup"
    )
    lecturers: Mapped[list["Lecturer"]] = relationship(back_populates="workgroup")
    buildings: Mapped[list["Building"]] = relationship(back_populates="workgroup")
    classrooms: Mapped[list["Classroom"]] = relationship(back_populates="workgroup")


class User(Base):
    """users — sisteme giren hesaplar (ADMIN veya SUB_ACCOUNT)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workgroup_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status"), server_default=text("'PENDING'")
    )
    can_manage_classrooms: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    can_manage_courses: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    can_manage_weekly: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    can_manage_exams: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    can_manage_lecturers: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @property
    def department_ids(self) -> list[int]:
        """Üyelik tablosundan türetilir — UserPublic/UserListItem bunu okur (K-26).

        Kolon DEĞİL: kaynağı department_memberships. Property olması sayesinde
        Pydantic'in from_attributes'ı otomatik alır, router'larda elle
        kurulmasına gerek kalmaz.
        """
        return [m.department_id for m in self.memberships]

    # --- iliskiler ---
    workgroup: Mapped["Workgroup | None"] = relationship(
        back_populates="users", foreign_keys="User.workgroup_id"
    )
    # passive_deletes=True: silmeyi VERITABANINA birak (K-34).
    # Iki tabloda da FK zaten ON DELETE CASCADE. Bu bayrak olmadan SQLAlchemy
    # "yardimci" olmaya calisip once cocuk satirlarin user_id'sini NULL'a
    # cekiyor; invitation_tokens.user_id NOT NULL oldugu icin silme
    # IntegrityError ile patliyordu.
    invitation_tokens: Mapped[list["InvitationToken"]] = relationship(
        back_populates="user", passive_deletes=True
    )
    memberships: Mapped[list["DepartmentMembership"]] = relationship(
        back_populates="user", passive_deletes=True
    )


class InvitationToken(Base):
    """invitation_tokens — hesap aktivasyonu icin tek kullanimlik davet linki."""

    __tablename__ = "invitation_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE")
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="invitation_tokens")


class Department(Base):
    """departments — bir calisma grubu icindeki bolum (or. Bilgisayar Muh.)."""

    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint(
            "workgroup_id", "code", name="uq_departments_workgroup_code"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workgroup_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    workgroup: Mapped["Workgroup"] = relationship(back_populates="departments")
    courses: Mapped[list["Course"]] = relationship(back_populates="department")
    memberships: Mapped[list["DepartmentMembership"]] = relationship(
        back_populates="department"
    )


class DepartmentMembership(Base):
    """department_memberships — kullanici <-> bolum baglantisi (cok-a-cok).

    Composite primary key: (user_id, department_id).
    """

    __tablename__ = "department_memberships"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    department_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("departments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="memberships")
    department: Mapped["Department"] = relationship(back_populates="memberships")


# ==================================================================
# Cekirdek veri tablolari
# ==================================================================


class Lecturer(Base):
    """lecturers — yonetilen hoca listesi (K-08; serbest metin yerine)."""

    __tablename__ = "lecturers"
    __table_args__ = (
        UniqueConstraint(
            "workgroup_id",
            "normalized_name",
            name="uq_lecturers_workgroup_normname",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workgroup_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )
    full_name: Mapped[str] = mapped_column(String(200))
    normalized_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254))
    is_external: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    source: Mapped[str] = mapped_column(String(20), server_default=text("'IMPORT'"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    workgroup: Mapped["Workgroup"] = relationship(back_populates="lecturers")
    sections: Mapped[list["CourseSection"]] = relationship(
        back_populates="lecturer"
    )
    exams: Mapped[list["Exam"]] = relationship(back_populates="lecturer")


class Building(Base):
    """buildings — yonetilen bina listesi (K-18; serbest metin yerine)."""

    __tablename__ = "buildings"
    __table_args__ = (
        UniqueConstraint("workgroup_id", "name", name="uq_buildings_workgroup_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workgroup_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(100))
    # K-30: fakulte disi bina etiketi. Yalniz gorsel/filtre amacli; cakisma
    # motoru acisindan oda odadir, kural degistirmez.
    is_external: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    workgroup: Mapped["Workgroup"] = relationship(back_populates="buildings")
    classrooms: Mapped[list["Classroom"]] = relationship(back_populates="building")


class Classroom(Base):
    """classrooms — derslikler.

    capacity: ders kapasitesi (W7). exam_capacity: bosluklu oturma duzeninde
    sinav kontenjani (K-17; E5/E7 bu alani kullanir, capacity'yi DEGIL).
    exam_capacity opsiyoneldir: NULL = sinav dersligi degil / kontenjan henuz
    girilmedi (K-21); girilmisse CHECK ile capacity'yi asamaz.
    """

    __tablename__ = "classrooms"
    __table_args__ = (
        UniqueConstraint("building_id", "room_code", name="uq_classrooms_location"),
        CheckConstraint("capacity > 0", name="ck_classrooms_capacity_positive"),
        CheckConstraint(
            "exam_capacity > 0 AND exam_capacity <= capacity",
            name="ck_classrooms_exam_capacity_range",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    workgroup_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )
    # RESTRICT: dersligi olan bina silinemez (once derslikler tasinmali).
    building_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("buildings.id", ondelete="RESTRICT")
    )
    room_code: Mapped[str] = mapped_column(String(30))
    # K-31: fiziksel tur. Bilgi/filtre amacli; motor okumaz.
    room_type: Mapped[RoomType] = mapped_column(
        Enum(RoomType, name="room_type"), server_default=text("'CLASSROOM'")
    )
    capacity: Mapped[int] = mapped_column(Integer)
    exam_capacity: Mapped[int | None] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    workgroup: Mapped["Workgroup"] = relationship(back_populates="classrooms")
    building: Mapped["Building"] = relationship(back_populates="classrooms")


class Course(Base):
    """courses — DERS, kod duzeyi (K-14).

    Ad, secmelilik ve T+U+L saatleri subeler arasinda ORTAKTIR; sube
    duzeyindeki alanlar CourseSection'dadir. Sinav bu tabloya baglanir (K-16).
    """

    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint(
            "department_id",
            "year",
            "semester",
            "code",
            name="uq_courses_identity",
        ),
        CheckConstraint("year BETWEEN 1 AND 6", name="ck_courses_year_range"),
        CheckConstraint("hours_theory >= 0", name="ck_courses_hours_theory"),
        CheckConstraint("hours_practice >= 0", name="ck_courses_hours_practice"),
        CheckConstraint("hours_lab >= 0", name="ck_courses_hours_lab"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    department_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="CASCADE")
    )
    year: Mapped[int] = mapped_column(SmallInteger)
    semester: Mapped[SemesterType] = mapped_column(
        Enum(SemesterType, name="semester_type")
    )
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    is_elective: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # T+U+L (K-20): degerler oldugu gibi alinir, U/L ayrimi sorgulanmaz.
    hours_theory: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("0")
    )
    hours_practice: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("0")
    )
    hours_lab: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    department: Mapped["Department"] = relationship(back_populates="courses")
    sections: Mapped[list["CourseSection"]] = relationship(
        back_populates="course"
    )
    exams: Mapped[list["Exam"]] = relationship(back_populates="course")


class CourseSection(Base):
    """course_sections — SUBE (K-14).

    Hoca, beklenen ogrenci ve varsayilan derslik sube duzeyindedir.
    Ayni hoca birden cok subeye girebilir. Haftalik program girisleri
    subeye baglanir.
    """

    __tablename__ = "course_sections"
    __table_args__ = (
        UniqueConstraint("course_id", "section_no", name="uq_sections_course_no"),
        CheckConstraint("section_no > 0", name="ck_sections_no_positive"),
        CheckConstraint(
            "expected_students > 0", name="ck_sections_expected_positive"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("courses.id", ondelete="CASCADE")
    )
    section_no: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    # RESTRICT: hocanin hala subesi varsa hoca SILINEMEZ (K-08).
    lecturer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lecturers.id", ondelete="RESTRICT")
    )
    expected_students: Mapped[int] = mapped_column(Integer)  # CHECK: > 0 (K-07)
    # SET NULL: derslik silinirse sube kalir, sadece varsayilan bosalir.
    default_classroom_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("classrooms.id", ondelete="SET NULL")
    )
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    course: Mapped["Course"] = relationship(back_populates="sections")
    lecturer: Mapped["Lecturer"] = relationship(back_populates="sections")
    default_classroom: Mapped["Classroom | None"] = relationship()  # tek yonlu
    schedule_entries: Mapped[list["WeeklyScheduleEntry"]] = relationship(
        back_populates="section"
    )


class Slot(Base):
    """slots — sabit ders saati referans tablosu (1..9). Veri adim 8'de seed edilir."""

    __tablename__ = "slots"
    __table_args__ = (
        CheckConstraint("slot_no BETWEEN 1 AND 9", name="ck_slots_range"),
    )

    slot_no: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


# ==================================================================
# Program / sinav girisleri + audit
# ==================================================================


class WeeklyScheduleEntry(Base):
    """weekly_schedule_entries — haftalik ders programindaki tek bir yerlesim.

    Subeye baglanir (K-14). session_type: bu yerlesim T/U/L'nin hangisini
    karsiliyor (K-20, W8 tamlik kurali). delivery_mode=ONLINE_ASYNC girisler
    normal gun/saat tasir ama cakisma karsilastirmalarina girmez (K-19).
    """

    __tablename__ = "weekly_schedule_entries"
    __table_args__ = (
        CheckConstraint(
            "start_slot + slot_count - 1 <= 9", name="ck_wse_slot_overflow"
        ),
        CheckConstraint(
            "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
            name="ck_wse_status_submitted_consistency",
        ),
        Index("idx_wse_classroom_day", "classroom_id", "day_of_week"),
        Index("idx_wse_section", "section_id"),
        Index("idx_wse_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    section_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("course_sections.id", ondelete="CASCADE")
    )
    classroom_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("classrooms.id", ondelete="RESTRICT")
    )
    day_of_week: Mapped[int] = mapped_column(
        SmallInteger, CheckConstraint("day_of_week BETWEEN 1 AND 5")
    )
    start_slot: Mapped[int] = mapped_column(
        SmallInteger, CheckConstraint("start_slot BETWEEN 1 AND 9")
    )
    slot_count: Mapped[int] = mapped_column(
        SmallInteger, CheckConstraint("slot_count >= 1"), server_default=text("1")
    )
    session_type: Mapped[SessionType] = mapped_column(
        Enum(SessionType, name="session_type"), server_default=text("'THEORY'")
    )
    delivery_mode: Mapped[DeliveryMode] = mapped_column(
        Enum(DeliveryMode, name="delivery_mode"),
        server_default=text("'FACE_TO_FACE'"),
    )
    status: Mapped[EntryStatus] = mapped_column(
        Enum(EntryStatus, name="entry_status"), server_default=text("'DRAFT'")
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    section: Mapped["CourseSection"] = relationship(
        back_populates="schedule_entries"
    )
    classroom: Mapped["Classroom | None"] = relationship()  # tek yonlu


# Sinav <-> derslik cok-a-cok baglantisi (K-17). Ek kolonu olmadigi icin
# ayri model sinifi yerine sade Table olarak tanimlandi.
# RESTRICT: sinavi olan derslik silinemez; CASCADE: sinav silinince satirlar gider.
exam_classrooms = Table(
    "exam_classrooms",
    Base.metadata,
    Column(
        "exam_id",
        BigInteger,
        ForeignKey("exams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "classroom_id",
        BigInteger,
        ForeignKey("classrooms.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Index("idx_exam_classrooms_classroom", "classroom_id"),
)


class Exam(Base):
    """exams — bir DERSIN bir sinavi (vize/final/butunleme).

    K-16: sinav ders duzeyindedir (subeden bagimsiz; tum subeler ayni sinava
    girer). Ogrenci sayisi turetilir: dersin aktif subelerinin
    expected_students toplami.
    K-17: birden cok derslikte yapilabilir (classrooms listesi); dersliksiz
    sinav = bos liste (eski nullable classroom_id'nin yerini alir).
    """

    __tablename__ = "exams"
    __table_args__ = (
        UniqueConstraint("course_id", "exam_type", name="uq_exams_course_type"),
        CheckConstraint(
            "EXTRACT(ISODOW FROM exam_date) BETWEEN 1 AND 5",
            name="ck_exams_weekday_only",
        ),
        CheckConstraint(
            "(status = 'SUBMITTED') = (submitted_at IS NOT NULL)",
            name="ck_exams_status_submitted_consistency",
        ),
        Index("idx_exams_date", "exam_date"),
        Index("idx_exams_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("courses.id", ondelete="CASCADE")
    )
    exam_type: Mapped[ExamType] = mapped_column(Enum(ExamType, name="exam_type"))
    exam_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time] = mapped_column(Time)
    duration_minutes: Mapped[int] = mapped_column(
        Integer, CheckConstraint("duration_minutes BETWEEN 10 AND 480")
    )
    lecturer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lecturers.id", ondelete="RESTRICT")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[EntryStatus] = mapped_column(
        Enum(EntryStatus, name="entry_status"), server_default=text("'DRAFT'")
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    course: Mapped["Course"] = relationship(back_populates="exams")
    lecturer: Mapped["Lecturer"] = relationship(back_populates="exams")
    classrooms: Mapped[list["Classroom"]] = relationship(
        secondary=exam_classrooms
    )  # tek yonlu

    @property
    def total_expected_students(self) -> int:
        """K-16: dersin AKTIF subelerinin expected_students toplami (turetilir)."""
        return sum(
            s.expected_students for s in self.course.sections if s.active
        )


class AuditLog(Base):
    """audit_logs — kim, neyi, ne zaman degistirdi izi."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(10))  # CREATE/UPDATE/DELETE/SUBMIT
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
