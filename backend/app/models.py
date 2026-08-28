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


# K-03'un `EntryStatus` (DRAFT/SUBMITTED) tipi BURADAN KALKTI. Haftalik onu
# K-59'da, sinav K-60'ta biraktı; kullanani kalmayinca tip de dustu. Satirin
# "yayinda mi" sorusunu artik tek bir gercek cevapliyor: `draft_id IS NULL`.


class DraftStatus(str, enum.Enum):
    """draft_status — cohort taslaginin yasam dongusu (K-59).

    Yerini aldigi sey K-03'un satir durumu DEGILDIR; farkli bir seviyede durur.
    O tek SATIRIN durumuydu, bu bir TASLAGIN durumu. Satirin durumu artik
    `draft_id`'den okunur (NULL = yayinda).
    """

    OPEN = "OPEN"           # sahibi duzenliyor
    PENDING = "PENDING"     # onay bekliyor -> DONDU, salt-okunur
    APPROVED = "APPROVED"   # onaylandi, farki yayina uygulandi (gecmis kaydi)
    REJECTED = "REJECTED"   # reddedildi; OPEN gibi duzenlenebilir, gerekce durur


class DraftKind(str, enum.Enum):
    """draft_kind — taslagin NEYI kapsadigi (K-60).

    Sinav takvimi de haftalik program gibi onay kapisinin arkasina alindi. Ayri
    bir mekanizma kurmak yerine ayni tabloya bir ayrac konuldu: yasam dongusu,
    oz-onay yasagi, kuyruk, inceleme ekrani, bayatlik bandi ve degisiklik akisi
    ikisi icin de AYNI.

    Taslak birimi her ikisinde de COHORT'tur. Sinav ders duzeyinde olsa da
    (K-16) ders `(department_id, year, semester)` + `extra_cohorts` tasidigi
    icin bir cohort'un sinavlari `cohort_course_filter` ile tam secilebilir --
    haftaligin kapsamini belirleyen filtrenin AYNISI.

    Haftalik ve sinav AYRI AYRI onaylanir: sinav donemi planlamasi ders
    programindan bagimsiz yurur, tek talepte birlestirmek "vize takvimini
    onaylatmak icin ders programini da onaylatmak" demeye gelirdi.
    """

    WEEKLY = "WEEKLY"
    EXAM = "EXAM"


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
    # K-59: taslagi YAYINA alma yetkisi. Digerlerinden farkli bir eksende durur —
    # otekiler "neyi yazabilirim", bu "baskasinin yazdigini yayina gecirebilir
    # miyim". Haftalik + sinav ortak: onaylamak alan uzmanligi degil gozetim rolu.
    can_approve_schedule: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # K-82: giris zaman damgalari. IKI kolon, cunku iki farkli soruya cevap
    # veriyorlar ve tek kolon ikisini birden veremez:
    #   last_login_at     -> "bu hesap en son ne zaman girdi" (Yonetim tablosu)
    #   previous_login_at -> "SIZ bundan onceki sefer ne zaman girdiniz"
    #                        (kimlik karti). Tek kolon olsaydi kullanicinin
    #                        kendi karti hep ICINDE BULUNDUGU oturumu gosterir,
    #                        yani her zaman "az once" yazardi.
    # Girste once eskisi previous'a kopyalanir, sonra last yazilir (auth.login).
    # Ikisi de nullable: hic giris yapmamis (PENDING) hesapta deger yoktur.
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    previous_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
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
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship(
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


class PasswordResetToken(Base):
    """password_reset_tokens — sifre sifirlama icin tek kullanimlik, sureli link.

    invitation_tokens'in ikizi ama AYRI tablo (K-43): davet token'i hesabi
    aktiflestirir, sifirlama token'i mevcut sifreyi degistirir. Tek tabloda
    'purpose' kolonuyla tutulsalardi bir davet token'iyla sifre sifirlama
    (veya tersi) mumkun olabilirdi; ayri tablo bu karismayi sema duzeyinde
    imkansiz kilar ve calisan davet akisinin kod yoluna hic dokunulmaz.

    Omru davetten KISADIR (PASSWORD_RESET_EXPIRE_HOURS, varsayilan 2 saat):
    sifirlama linki calinirsa hesabi dogrudan ele gecirir, davet linki ise
    zaten sahipsiz bir hesabi acar.
    """

    __tablename__ = "password_reset_tokens"

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

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


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
    # Resmi sinav programi basligi ingilizce basiliyor: bolumun ve fakultenin
    # ingilizce adi burada saklanir (or. "Computer Engineering" / "Faculty of
    # Engineering"). Bos ise export basliginda TR ad'a duser.
    name_en: Mapped[str | None] = mapped_column(String(200))
    faculty_en: Mapped[str | None] = mapped_column(String(200))
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
    # K-52 · Akademik unvan, ad'dan AYRI kolon. Once full_name'e gomuluydu
    # ("Doç. Dr. Ayşe Kaya"); artik full_name saf ad, title unvan. Kanonik kisa
    # form (bkz. normalize.canonical_title); web import site formunu ("Doktor
    # Öğretim Üyesi") kanonik forma eşler. normalized_name unvani zaten soktugu
    # icin dedup degismez. NULL = unvan girilmemis (40/a / eski kayit).
    title: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(254))
    is_external: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    source: Mapped[str] = mapped_column(String(20), server_default=text("'IMPORT'"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # Asli (kendi) bolum. Hoca karari: her hoca bir bolume aittir ama baska
    # bolumlerde de ders verebilir; "ders verdigi bolumler" sube->ders uzerinden
    # AYRICA turetilir. NULL = eski/import kayit (asli bolum henuz atanmadi).
    # SET NULL: bolum silinirse hoca kalir, aidiyeti bosalir.
    department_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="SET NULL")
    )
    # K-50 · Fakülte web import'unda detay sayfasindan okunan iki serbest-metin
    # birim. "Gorev Birimi" = fiilen ders verdigi bolum, "Kadro Birimi" = resmi
    # kadro; ikisi farkli olabilir (ornek: Gorev Insaat, Kadro Jeoloji). Bunlar
    # GORUNTU icindir; cakisma matematigi department_id/lecturer_id kullanir.
    # Elle eklenen kayitta NULL kalir. department_id, gorev_birimi'nden eslenir.
    duty_unit: Mapped[str | None] = mapped_column(String(200))
    cadre_unit: Mapped[str | None] = mapped_column(String(200))
    # K-71 · Akademik personel sayfasi (detay) URL'si. Web import'ta kisinin
    # detay sayfasindan (detail_url) alinir; elle eklerken opsiyonel girilir.
    # Yalniz GORUNTU (drawer'daki "Akademik sayfa" linki). NULL = girilmemis.
    detail_url: Mapped[str | None] = mapped_column(String(500))

    workgroup: Mapped["Workgroup"] = relationship(back_populates="lecturers")
    department: Mapped["Department | None"] = relationship()
    sections: Mapped[list["CourseSection"]] = relationship(
        back_populates="lecturer"
    )
    exams: Mapped[list["Exam"]] = relationship(back_populates="lecturer")
    # K-81: bu hocanin GOZETMEN olarak gorevli oldugu sinavlar. Ters yon
    # bilincli olarak taniml: `exam_invigilators` RESTRICT tasiyor, yani
    # "bu hoca silinebilir mi?" sorusunun uc bagimlisi var (sube, sinav,
    # gozetmenlik). Ucuncusu ORM'den okunamiyorsa sorgular onu sessizce
    # atlar ve silme ancak veritabani duzeyinde patlar.
    # `secondary` STRING olarak veriliyor: tablo bu siniftan SONRA
    # tanimlaniyor, nesne olarak referans vermek NameError verirdi.
    invigilated_exams: Mapped[list["Exam"]] = relationship(
        secondary="exam_invigilators", back_populates="invigilators"
    )


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
    # Kat — opsiyonel konum bilgisi (K-68). NULL = girilmemis. Motor okumaz.
    floor: Mapped[int | None] = mapped_column(Integer)
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
        # K-46: bir dersin 1-3 vizesi olabilir (final/büt tektir).
        CheckConstraint("midterm_count BETWEEN 1 AND 3", name="ck_courses_midterm_count"),
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
    # K-55: AKTS (ECTS) kredisi. NULLABLE — eski dersler ve elle ekleme AKTS'siz
    # olabilir; Bologna import'u her zaman doldurur. Ders düzeyindedir (T+U+L gibi
    # şubeler arası ortak), çakışma matematiğine girmez; yalnız bilgi/görüntü.
    ects: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # K-45: bileşen bazında online mı. Yalnız saati>0 olan bileşen için anlamlı;
    # saat 0 ise ilgili bayrak zorla false (router). "Online mı" ders düzeyinde
    # sabittir; SENKRON/ASENKRON ayrımı haftalık girişte seçilir (K-19 giriş
    # düzeyi delivery_mode korunur — bu bayraklar yalnız o seçimi yönlendirir).
    theory_online: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    practice_online: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    lab_online: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # K-46: dersin vize sayisi (1-3). Sinav eklerken "kacinci vize" bu sinira
    # kadar sorulur; final/but bu alandan bagimsiz, ders basina tektir.
    midterm_count: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    # K-48: ortak (servis) ders mi — Fizik/Matematik gibi birden cok bolumun aldigi
    # ders. Cakisma semantigi bu bayraktan DEGIL, cohort kumesinden gelir; bayrak
    # yalnizca ayri "Ortak Dersler" gorunumu + import isaretidir. Dersin KENDI
    # (department_id, year, semester) birincil cohort'u kalir; ek cohort'lar
    # course_cohorts'ta durur ve efektif cohort = birincil ∪ ek.
    is_common: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    department: Mapped["Department"] = relationship(back_populates="courses")
    sections: Mapped[list["CourseSection"]] = relationship(
        back_populates="course"
    )
    exams: Mapped[list["Exam"]] = relationship(back_populates="course")
    # Ek cohort'lar (birincil cohort haric). Ders silinince birlikte gider.
    extra_cohorts: Mapped[list["CourseCohort"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )


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


class CourseCohort(Base):
    """course_cohorts — ortak dersin EK cohort'lari (K-48).

    Bir ortak ders (courses.is_common) birden cok (bolum, yil, donem) cohort'una
    aittir. Dersin KENDI (department_id, year, semester)'i birincil cohort olarak
    courses satirinda kalir; bu tablo yalnizca EK cohort'lari tutar. Efektif cohort
    kumesi = birincil ∪ bu satirlar. Motorun cohort kurallari (W3/W4, E4a/E4b, X2)
    'ayni cohort mu' testini bu kume uzerinden KESISIM olarak yapar.

    Normal (ortak olmayan) dersin bu tabloda hic satiri yoktur -> efektif cohort
    tek elemanlidir -> bugunku davranis birebir korunur.
    """

    __tablename__ = "course_cohorts"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "department_id", "year", "semester",
            name="uq_course_cohorts_identity",
        ),
        CheckConstraint("year BETWEEN 1 AND 6", name="ck_course_cohorts_year_range"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    course_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("courses.id", ondelete="CASCADE")
    )
    # CASCADE: tuketen bolum silinirse (K-27 geregi zaten bos olmali) tuketim
    # satiri da gider. Ortak dersin kendisi sahibi bolume bagli kaldigindan silinmez.
    department_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="CASCADE")
    )
    year: Mapped[int] = mapped_column(SmallInteger)
    semester: Mapped[SemesterType] = mapped_column(
        Enum(SemesterType, name="semester_type")
    )

    course: Mapped["Course"] = relationship(back_populates="extra_cohorts")
    department: Mapped["Department"] = relationship()

    @property
    def department_name(self) -> str:
        """CourseCohortOut için: UI ek cohort'ta id değil bölüm adını gösterir."""
        return self.department.name


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


# Onaylanan taslagin ETKILEDIGI bolumler (K-59). Yalniz ortak ders (K-48)
# tasindiginda dolar: dersin efektif cohort'undaki, taslagin kendi bolumu
# DISINDAKI bolumler. Degisiklik akisi ("bolumunuzu etkileyen son degisiklikler")
# bu satirlar uzerinden calisir -- ayri bir bildirim tablosu YOKTUR.
draft_affected_departments = Table(
    "draft_affected_departments",
    Base.metadata,
    Column(
        "draft_id",
        BigInteger,
        ForeignKey("schedule_drafts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "department_id",
        BigInteger,
        ForeignKey("departments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Index("idx_draft_affected_department", "department_id"),
)


# K-83: onay talebinin ALICILARI. Taslak onaya gonderilirken gonderen, kendi
# bolumundeki onay yetkilileri (ve her bolumde yetkili olan ADMIN'ler) arasindan
# kimlere gittigini SECER; talep yalnizca bu satirlarda adi gecen hesaplarin
# kuyruguna duser.
#
# Neden ayri tablo: alici cok-a-cok (bir talep birden cok kisiye, bir kisi
# birden cok talebe). Taslakta tek bir `assigned_to` kolonu olsaydi "iki
# yetkiliden hangisi bakarsa baksin" diyemezdik — kuyruk tek kisiye kilitlenir,
# o kisi izinliyken talep beklerdi.
#
# CASCADE iki yonde de: taslak silinince adresleme anlamsiz kalir; hesap
# silinince (K-34'te zaten engelli) artik ona gonderilemez.
draft_approvers = Table(
    "draft_approvers",
    Base.metadata,
    Column(
        "draft_id",
        BigInteger,
        ForeignKey("schedule_drafts.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    # "Bana gelen talepler" sorgusu bu sutundan girer — kuyrugun sicak yolu.
    Index("idx_draft_approvers_user", "user_id"),
)


class ScheduleDraft(Base):
    """schedule_drafts — bir cohort'un OZEL, alternatif program hali (K-59).

    Bir taslak, bir cohort'un (bolum + yil + donem) bagimsiz ve TAM program
    halidir; acilirken o anki yayinin kopyasiyla dolar. Kopyalanan satirlar
    weekly_schedule_entries'te `draft_id` ile bu kayda baglanir.

    OZEL: yalniz sahibi gorur. Baska hesabin taslagi hicbir sorguya, hicbir
    cakisma evrenine girmez -- "taslaklar arasi cakisma" diye bir kavram yoktur.

    Taslagin acildigi ANDAKI hali SAKLANMAZ: fark her seferinde o anki yayina
    karsi canli hesaplanir. Bu yuzden taban anlik goruntusu, surum sayaci ve
    "bayat taban" kavrami bilerek yoktur (K-59).
    """

    __tablename__ = "schedule_drafts"
    __table_args__ = (
        CheckConstraint("year BETWEEN 1 AND 6", name="ck_schedule_drafts_year_range"),
        # Bir kullanici bir cohort icin ayni anda TEK aktif taslak tutar (K-59).
        # APPROVED disarida: onaylanan taslak gecmis kaydidir, yeni taslak
        # acmayi engellememeli. REJECTED iceride: reddedileni duzeltmek yerine
        # yanina yenisini acmak, gerekcenin kaybolmasi demek olurdu.
        # K-60: `kind` de anahtara girdi -- ayni cohort icin haftalik ve sinav
        # taslagi AYNI ANDA acilabilmeli; iki is birbirinden bagimsiz yuruyor.
        Index(
            "uq_schedule_drafts_active_per_owner",
            "created_by", "department_id", "year", "semester", "kind",
            unique=True,
            postgresql_where=text("status <> 'APPROVED'"),
        ),
        Index("idx_schedule_drafts_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Izolasyon (K-04) tek filtreyle kurulabilsin diye workgroup dogrudan tasinir;
    # department uzerinden turetilebilirdi ama her sorgu fazladan JOIN isterdi.
    workgroup_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workgroups.id", ondelete="CASCADE")
    )

    # --- cohort kimligi: taslagin kapsami ---
    department_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("departments.id", ondelete="CASCADE")
    )
    year: Mapped[int] = mapped_column(SmallInteger)
    semester: Mapped[SemesterType] = mapped_column(
        Enum(SemesterType, name="semester_type")
    )

    name: Mapped[str] = mapped_column(String(200))
    # K-60: taslak neyi kapsiyor -- haftalik program mi, sinav takvimi mi.
    # server_default WEEKLY: K-60 oncesi acilmis taslaklarin tamami haftalik.
    kind: Mapped[DraftKind] = mapped_column(
        Enum(DraftKind, name="draft_kind"), server_default=text("'WEEKLY'")
    )
    status: Mapped[DraftStatus] = mapped_column(
        Enum(DraftStatus, name="draft_status"), server_default=text("'OPEN'")
    )

    # CASCADE (diger tablolardaki created_by SET NULL iken): taslak sahibine
    # OZELDIR, sahipsiz taslagin anlami yok. Kullanici silmek zaten engelli (K-34).
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # --- onaya gonderim ---
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submit_note: Mapped[str | None] = mapped_column(Text)  # PR aciklamasi gibi

    # --- inceleme ---
    reviewed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)  # ret gerekcesi
    # Onay aninda yazilan insan-okur ozet ("MATH101 Car 1 -> Sal 3"). Taslagin
    # satirlari onaydan sonra yayina gectigi icin fark geriye donuk yeniden
    # hesaplanamaz; kayit kendi kendine yetsin diye ozet donduruluyor (K-36 deseni).
    applied_summary: Mapped[str | None] = mapped_column(Text)

    # --- iliskiler ---
    department: Mapped["Department"] = relationship()          # tek yonlu
    owner: Mapped["User"] = relationship(foreign_keys=[created_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
    entries: Mapped[list["WeeklyScheduleEntry"]] = relationship(
        back_populates="draft", passive_deletes=True
    )
    # K-60: EXAM taslaginin satirlari. Bir taslakta kind'a gore yalniz BIRI
    # dolar; ikisini tek koleksiyonda toplamak (polimorfik satir) iki farkli
    # yerlesim seklini ayni tabloya sikistirmak olurdu.
    exams: Mapped[list["Exam"]] = relationship(
        back_populates="draft", passive_deletes=True
    )
    affected_departments: Mapped[list["Department"]] = relationship(
        secondary=draft_affected_departments
    )
    # K-83: talebin gonderildigi onay yetkilileri. Her gonderimde YENIDEN
    # yazilir (geri cekip tekrar gonderirken eski adresleme yaniltmasin) ve
    # gonderenin KENDISI asla iceride olmaz — oz-onay yasak (K-59).
    approvers: Mapped[list["User"]] = relationship(secondary=draft_approvers)


class WeeklyScheduleEntry(Base):
    """weekly_schedule_entries — haftalik ders programindaki tek bir yerlesim.

    Subeye baglanir (K-14). session_type: bu yerlesim T/U/L'nin hangisini
    karsiliyor (K-20, W8 tamlik kurali). delivery_mode=ONLINE_ASYNC girisler
    normal gun/saat tasir ama cakisma karsilastirmalarina girmez (K-19).

    K-59: satirin "yayinda mi" sorusunu `draft_id` cevaplar (NULL = yayinda).
    Eski `status`/`submitted_at` kolonlari DUSTU — ayni gercegi soyleyen iki
    kolon er gec birbiriyle celisirdi. (K-60'ta sinav da ayni yola girdi.)
    """

    __tablename__ = "weekly_schedule_entries"
    __table_args__ = (
        CheckConstraint(
            "start_slot + slot_count - 1 <= 9", name="ck_wse_slot_overflow"
        ),
        Index("idx_wse_classroom_day", "classroom_id", "day_of_week"),
        Index("idx_wse_section", "section_id"),
        # Her sorgu ya yayini (draft_id IS NULL) ya tek bir taslagi suzecek.
        Index("idx_wse_draft", "draft_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # K-59: NULL = YAYINDA. Dolu = o taslagin ozel kopyasi.
    # CASCADE: taslak silinince kopyalari da gider (yayina hicbir etkisi yok).
    draft_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("schedule_drafts.id", ondelete="CASCADE")
    )
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
    draft: Mapped["ScheduleDraft | None"] = relationship(back_populates="entries")


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


# Sinav <-> gozetmen cok-a-cok baglantisi (K-81). exam_classrooms ile BIREBIR
# ayni desen: ek kolonu yok, o yuzden model sinifi degil sade Table.
#
# NEDEN AYRI TABLO, neden `lecturer_id` (sorumlu) buraya KATLANMADI:
# sorumlu ile gozetmen ayni sey degil. Sorumlu sinavin sahibi -- her sinavda
# TAM BIR tane olmak zorunda ve E3/X3 kurallari onun uzerine kurulu. Gozetmen
# istege bagli ve 0..N. Ikisini tek tabloya katlamak, sorumlunun zorunlulugunu
# tablo duzeyinde ifade edilemez hale getirir ve "sorumlu" diyen butun
# mesajlari/kurallari yeniden yazmayi gerektirirdi (yikici migration).
#
# RESTRICT: gozetmenligi olan hoca silinemez (sorumluyla ayni koruma).
# CASCADE: sinav silinince satirlar gider.
exam_invigilators = Table(
    "exam_invigilators",
    Base.metadata,
    Column(
        "exam_id",
        BigInteger,
        ForeignKey("exams.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "lecturer_id",
        BigInteger,
        ForeignKey("lecturers.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    # Birlesik birincil anahtar ayni hocayi ayni sinava iki kez eklemeyi zaten
    # engelliyor; bu indeks ters yonu (bir hocanin gozetmenlikleri) hizlandirir.
    Index("idx_exam_invigilators_lecturer", "lecturer_id"),
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
        # K-46: ayni ders ayni tipte birden cok sinav TASIYABILIR, ama her
        # (ders, tip, sira) tektir — ayni numarali vize iki kez girilemez.
        # Final/but'te exam_index hep 1 oldugundan bu kisit onlar icin "tek kayit"
        # anlamini korur (eski uq_exams_course_type ile ayni etki).
        #
        # K-60: bu kisit KOSULSUZ bir UniqueConstraint idi; taslak yayinin
        # KOPYASINI tasidigi icin kopyalama aninda ihlal ediliyordu. Iki KISMI
        # indekse bolundu. Tek bir dort kolonlu (…, draft_id) UNIQUE YETMEZ:
        # Postgres NULL'lari birbirine esit saymaz, o indeks altinda YAYINDA
        # ayni sinavin iki kopyasi gecerdi.
        Index(
            "uq_exams_course_type_index",     # ad korundu: yayindaki tekillik ayni kural
            "course_id", "exam_type", "exam_index",
            unique=True,
            postgresql_where=text("draft_id IS NULL"),
        ),
        Index(
            "uq_exams_course_type_index_draft",
            "course_id", "exam_type", "exam_index", "draft_id",
            unique=True,
            postgresql_where=text("draft_id IS NOT NULL"),
        ),
        CheckConstraint("exam_index BETWEEN 1 AND 3", name="ck_exams_exam_index"),
        CheckConstraint(
            "EXTRACT(ISODOW FROM exam_date) BETWEEN 1 AND 5",
            name="ck_exams_weekday_only",
        ),
        Index("idx_exams_date", "exam_date"),
        # Her sorgu ya yayini (draft_id IS NULL) ya tek bir taslagi suzecek.
        Index("idx_exams_draft", "draft_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # K-60: NULL = YAYINDA. Dolu = o taslagin ozel kopyasi. Haftalikla ayni
    # tek-gercek kurali — eski `status`/`submitted_at` kolonlari ve tutarlilik
    # CHECK'i DUSTU; ayni gercegi soyleyen iki kolon er gec celisirdi.
    # CASCADE: taslak silinince kopyalari da gider (yayina hicbir etkisi yok).
    draft_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("schedule_drafts.id", ondelete="CASCADE")
    )
    course_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("courses.id", ondelete="CASCADE")
    )
    exam_type: Mapped[ExamType] = mapped_column(Enum(ExamType, name="exam_type"))
    # K-46: "kacinci vize" (1-3). MIDTERM disi turlerde her zaman 1 (router zorlar).
    exam_index: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    exam_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time] = mapped_column(Time)
    duration_minutes: Mapped[int] = mapped_column(
        Integer, CheckConstraint("duration_minutes BETWEEN 10 AND 480")
    )
    lecturer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lecturers.id", ondelete="RESTRICT")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    draft: Mapped["ScheduleDraft | None"] = relationship(back_populates="exams")
    course: Mapped["Course"] = relationship(back_populates="exams")
    lecturer: Mapped["Lecturer"] = relationship(back_populates="exams")
    classrooms: Mapped[list["Classroom"]] = relationship(
        secondary=exam_classrooms
    )  # tek yonlu
    # K-81: gozetmenler. Tek yonlu ve `lecturer` (sorumlu) iliskisinden AYRI --
    # bir hoca ayni sinavda hem sorumlu hem gozetmen olamaz (router zorlar),
    # ama iki farkli sinavda iki farkli rolde olabilir; E9 tam bunu yakalar.
    invigilators: Mapped[list["Lecturer"]] = relationship(
        secondary=exam_invigilators, back_populates="invigilated_exams"
    )

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
    # CREATE/UPDATE/DELETE/SUBMIT + davet akisi: INVITE/ACTIVATE (K-37)
    # + sifre sifirlama: RESET_REQUEST/RESET_PASSWORD (K-43). Uzunluk 10'dan
    # 20'ye cikti — en uzun deger 14 karakter ('RESET_PASSWORD') ve 10'a
    # sigmiyordu.
    action: Mapped[str] = mapped_column(String(20))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    # Islem ANINDAKI insan-okur ad (K-36). Log'un kendi kendine yetmesini
    # saglar: silinen kayit konusabilsin, degistirilen ad o gunku haliyle
    # kalsin. Nullable, cunku kolondan ONCE yazilmis satirlarda yok.
    entity_label: Mapped[str | None] = mapped_column(String(200))
    # NEYIN degistigi: "Durum: Aktif → Pasif" (K-38). entity_label "hangi
    # kayit" sorusunu cevapliyor, bu alan "ne degisti" sorusunu. Yalniz
    # UPDATE'te dolar; CREATE/DELETE'te degisiklik kavrami yok.
    change_summary: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Tek yonlu (K-35): GET /audit-logs faili adiyla gosterir. User tarafinda
    # karsiligi YOK -- kullaniciyi silmek zaten engelli (K-34), audit satirlari
    # uzerinden gezinmeye ihtiyac yok.
    user: Mapped["User | None"] = relationship()
