"""Demo seed — motorun TAMAMINI gösteren kurgulanmış veri.

NE İŞE YARAR
------------
Boş bir sistemde ekranların çoğu boş görünür ve çakışma motoru — projenin asıl
değeri — hiç konuşmaz. Bu script, her kaydı belirli bir kuralı tetiklemek için
konumlandırılmış bir fakülte kurar. Veri rastgele DEĞİLDİR: bir dersin günü ya
da dersliği değiştirilirse aşağıdaki kuralların biri susar.

NE YAPAR
--------
  1. Veritabanındaki TÜM veriyi siler (test koşularından biriken çöp dahil).
  2. Bir fakülte, kullanıcılar, iki bölüm, hocalar, derslikler, dersler+şubeler,
     haftalık program ve vize takvimi ekler.
  3. Her kaydı gerçek API'deki gibi audit log'a yazar — İşlem Kayıtları ekranı
     boş kalmasın, "kim neyi ekledi" izi görünsün.
  4. SONUNDA MOTORU ÇALIŞTIRIP KENDİNİ DOĞRULAR: beklenen kural kümesi
     çıkmazsa hata verip çıkar (aşağıya bak).

NEDEN KENDİNİ DOĞRULUYOR
------------------------
Seed sessizce anlamsızlaşabilir. Nitekim oldu: K-41 ile X kuralları yalnız
vizede çalışır hale gelince, sınavları FINAL olan eski seed X1/X2/X3'ü hiç
tetiklemez oldu ve bu iki gün fark edilmedi. Doğrulama bloğu varsa seed
çalıştığı an patlar, demo sırasında değil.

TETİKLENEMEYEN ÜÇ KURAL
-----------------------
W6 (pencere dışı slot), E2 (mükerrer sınav tipi) ve E6 (hafta sonu sınavı)
seed'e GİREMEZ: üçünü de veritabanı kısıtı (CHECK / UNIQUE) engeller, INSERT
zaten reddedilir. Motorun bu kuralları vardır ama demoda API üzerinden
denenerek gösterilir (README demo adımları).

ÇALIŞTIRMA (backend/ klasöründen, docker db ayaktayken)
-------------------------------------------------------
    python seed_demo.py            # hedef veritabanını gösterip onay ister
    python seed_demo.py --yes      # onay sormadan (otomasyon için)

Giriş: admin@muh.example.edu.tr / admin1234
"""

import argparse
import sys
from datetime import date, datetime, time, timezone

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.audit import log_action
from app.config import settings
from app.conflict_service import scan_workgroup
from app.db import SessionLocal, engine
from app.models import (
    Building, Classroom, Course, CourseSection, Department,
    DepartmentMembership, DeliveryMode, EntryStatus, Exam, ExamType, Lecturer,
    SemesterType, SessionType, Slot, User, UserRole, UserStatus,
    WeeklyScheduleEntry, Workgroup,
)
from app.normalize import normalize_lecturer_name
from app.security import hash_password

# Slot referans tablosu (conflicts/slots.py ile birebir) — haftalık grid,
# çapraz kurallar ve export bunu kullanır.
SLOT_TIMES = [
    (1, time(8, 30), time(9, 15)), (2, time(9, 30), time(10, 15)),
    (3, time(10, 30), time(11, 15)), (4, time(11, 30), time(12, 15)),
    (5, time(12, 30), time(13, 15)), (6, time(13, 30), time(14, 15)),
    (7, time(14, 30), time(15, 15)), (8, time(15, 30), time(16, 15)),
    (9, time(16, 30), time(17, 15)),
]

# TRUNCATE edilecek tablolar — CASCADE bağımlılıkları da temizler,
# RESTART IDENTITY id sayaçlarını 1'e döndürür. Sabit id'ler demoda
# "3 numaralı kayıt" demeyi anlamlı kılar.
TABLES = (
    "workgroups, users, invitation_tokens, departments, department_memberships, "
    "lecturers, buildings, classrooms, courses, course_sections, "
    "weekly_schedule_entries, exams, exam_classrooms, audit_logs, slots"
)

# Vize haftası: 13-17 Nisan 2026, hepsi hafta içi (Pzt-Cum).
# Sınavlar MIDTERM olmak ZORUNDA: K-41 gereği X kuralları yalnız vizede çalışır.
PZT, SAL, CAR, PER, CUM = (date(2026, 4, d) for d in (13, 14, 15, 16, 17))

# SUBMITTED kayıtların submitted_at damgası (DB kısıtı zorunlu kılıyor).
SIMDI = datetime.now(timezone.utc)

# Seed'in sözleşmesi: tam tarama bu kural kümesini üretmeli. Ne eksik ne fazla.
# Fazlası da hatadır — istenmeyen bir çakışma sızdıysa veri kurgusu bozulmuş
# demektir ve demo sırasında açıklanamayan bir satır çıkar.
BEKLENEN_KURALLAR = {
    "W1", "W2", "W3", "W4", "W5", "W7", "W8",
    "E1", "E3", "E4a", "E4b", "E5", "E5a", "E7",
    "X1", "X2", "X3",
}

# Kurgunun ikinci yarısı: motorun SUSMASI gereken üç yer. Kural kümesi testi
# bunları yakalayamaz (kurallar başka kayıtlardan zaten üretiliyor), o yüzden
# ayrıca iddia ediliyor. Bir atlama koşulu yanlışlıkla kaldırılırsa sessizce
# fazladan çakışma üretilir; asıl tehlike budur.
SESSIZ_KALMALI = [
    ("K-15 sube uyumlulugu: CENG2001 x CENG2030 W3 URETMEMELI "
     "(sube 2 farkli saatte, ogrenci uyumlu kombinasyonu secebilir)",
     lambda kural, kodlar: kural == "W3" and {"CENG2001", "CENG2030"} <= kodlar),

    ("K-19 asenkron on-eleme: CENG2053 hicbir haftalik kurala GIRMEMELI "
     "(Kaya ile ayni saatte ama asenkron oldugu icin karsilastirmaya girmez)",
     lambda kural, kodlar: kural.startswith("W") and "CENG2053" in kodlar),

    ("K-13 ayni ders istisnasi: CENG2020 hicbir capraz kurala GIRMEMELI "
     "(vizesi kendi dersinin saatinde, sahte cakisma uretilmemeli)",
     lambda kural, kodlar: kural.startswith("X") and "CENG2020" in kodlar),
]


# ======================================================================
# Güvenlik kapısı
# ======================================================================

def guvenlik_kapisi(onay_atla: bool) -> None:
    """TRUNCATE geri alınamaz; yanlış veritabanına yöneltilirse ekibin tüm
    verisini siler. Bu yüzden iki kapı var."""
    if settings.is_production:
        sys.exit("REDDEDILDI: ENVIRONMENT=production. Bu script demo aracidir, "
                 "yayin veritabaninda calistirilamaz.")

    url = make_url(settings.database_url)   # şifreyi ekrana basmadan ayrıştırır
    hedef = f"{url.host or 'localhost'}:{url.port or 5432}/{url.database}"
    print(f"HEDEF VERITABANI: {hedef}")
    print("Bu veritabanindaki TUM veri silinecek.")

    if onay_atla:
        print("(--yes verildi, onay sorulmadi)\n")
        return

    if input("Devam etmek icin 'EVET' yazin: ").strip() != "EVET":
        sys.exit("Iptal edildi.")
    print()


# ======================================================================
# 1) Sıfırlama
# ======================================================================

def reset():
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            table_list = [t.strip() for t in TABLES.split(",")]
            for table in reversed(table_list):
                conn.execute(text(f"DELETE FROM {table}"))
        else:
            conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    print("• Veritabani sifirlandi.")


# ======================================================================
# 2) Veri kurulumu
# ======================================================================

def seed():
    db = SessionLocal()

    _counters = {}
    def next_id(cls):
        _counters[cls] = _counters.get(cls, 0) + 1
        return _counters[cls]

    for no, bas, bit in SLOT_TIMES:
        db.add(Slot(slot_no=no, start_time=bas, end_time=bit))

    # --- fakülte + admin ---
    # check_exam_vs_course=True: X kurallarının birinci kapısı (K-06).
    wg = Workgroup(id=next_id(Workgroup), name="Mühendislik Fakültesi",
                   allowed_email_domain="muh.example.edu.tr",
                   check_exam_vs_course=True)
    db.add(wg)
    db.flush()

    admin = User(id=next_id(User), workgroup_id=wg.id, name="Fakülte Yöneticisi",
                 email="admin@muh.example.edu.tr",
                 password_hash=hash_password("admin1234"),
                 role=UserRole.ADMIN, status=UserStatus.ACTIVE)
    db.add(admin)
    db.flush()
    wg.created_by = admin.id

    def log(action, tip, nesne):
        log_action(db, admin, action, tip, nesne.id, nesne)

    # --- bölümler ---
    ceng = Department(id=next_id(Department), workgroup_id=wg.id, name="Bilgisayar Mühendisliği", code="CENG")
    eee = Department(id=next_id(Department), workgroup_id=wg.id, name="Elektrik-Elektronik Mühendisliği", code="EEE")
    db.add_all([ceng, eee])
    db.flush()
    log("CREATE", "department", ceng)
    log("CREATE", "department", eee)

    # --- hocalar ---
    # asli_bolum: hocanın kendi bölümü (yeni alan). Dış görevlide None olabilir.
    def hoca(ad, *, harici=False, kaynak="IMPORT", asli_bolum=None):
        lec = Lecturer(id=next_id(Lecturer), workgroup_id=wg.id, full_name=ad,
                       normalized_name=normalize_lecturer_name(ad),
                       source=kaynak, is_external=harici,
                       department_id=asli_bolum.id if asli_bolum else None)
        db.add(lec)
        db.flush()
        log("CREATE", "lecturer", lec)
        return lec

    # Kaya asli olarak CENG'li ama EEE'de de ders veriyor (W2 taşıyıcısı) — asli
    # bölüm ile "ders verdiği bölüm" ayrımının canlı örneği.
    kaya = hoca("Doç. Dr. Ayşe Kaya", asli_bolum=ceng)
    demir = hoca("Prof. Dr. Mehmet Demir", asli_bolum=eee)   # EEE'li ama CENG'de de ders verir
    arslan = hoca("Dr. Elif Arslan", asli_bolum=ceng)        # online ders
    sahin = hoca("Dr. Can Şahin", asli_bolum=ceng)
    yildiz = hoca("Öğr. Gör. Zeynep Yıldız", harici=True, kaynak="MANUAL")  # 40/a, asli bölümsüz

    # --- bina + derslikler ---
    # Kapasiteler bilinçli: LAB-1 tek "küçük" oda, W7 yalnız orada tetiklensin.
    # exam_capacity ayrı bir eksen (K-17): E5/E7 bunu okur, W7 capacity'yi.
    a_blok = Building(id=next_id(Building), workgroup_id=wg.id, name="A Blok")
    b_blok = Building(id=next_id(Building), workgroup_id=wg.id, name="B Blok")
    db.add_all([a_blok, b_blok])
    db.flush()
    log("CREATE", "building", a_blok)
    log("CREATE", "building", b_blok)

    def derslik(bina, kod, kap, sinav_kap):
        c = Classroom(id=next_id(Classroom), workgroup_id=wg.id, building_id=bina.id, room_code=kod,
                      capacity=kap, exam_capacity=sinav_kap)
        db.add(c)
        db.flush()
        log("CREATE", "classroom", c)
        return c

    a101 = derslik(a_blok, "A-101", 120, 60)
    b201 = derslik(b_blok, "B-201", 60, 50)
    b202 = derslik(b_blok, "B-202", 60, 20)
    b203 = derslik(b_blok, "B-203", 60, 40)
    lab1 = derslik(b_blok, "LAB-1", 30, None)   # exam_capacity NULL → E5a

    # Mühendislik Fakültesi gerçek derslik listesi (kaynak: fakülte derslik
    # durumu taraması, sıra 2-18). Kod'un ilk harfi bloğu verir (C/F).
    # Sınav kontenjanı belgede yok → kural gereği normal kapasitenin yarısı
    # (K-17 boşluklu oturma). 80→40, 50→25.
    c_blok = Building(id=next_id(Building), workgroup_id=wg.id, name="C Blok")
    f_blok = Building(id=next_id(Building), workgroup_id=wg.id, name="F Blok")
    db.add_all([c_blok, f_blok])
    db.flush()
    log("CREATE", "building", c_blok)
    log("CREATE", "building", f_blok)

    for kod, kap in [("C-B-07", 80), ("C-B-08", 80), ("C-B-09", 80),
                     ("C-Z-04", 50), ("C-Z-05", 50), ("C-Z-06", 50), ("C-Z-07", 50),
                     ("C-1-03", 50), ("C-1-04", 50), ("C-1-05", 80)]:
        derslik(c_blok, kod, kap, kap // 2)
    for kod, kap in [("F-1-03", 50), ("F-1-04", 50),
                     ("F-Z-04", 50), ("F-Z-05", 50), ("F-Z-06", 50),
                     ("F-B-07", 80), ("F-B-08", 80)]:
        derslik(f_blok, kod, kap, kap // 2)

    # --- dersler + şubeler ---
    # hours değerleri yerleşen slot sayısıyla BİLİNÇLİ olarak eşitlendi; tek
    # istisna CENG2052 (3 saat gerekli, 2 slot yerleşmiş) → W8 oradan çıkar.
    def ders(bolum, kod, ad, *, secmeli=False, t=2, u=0, l=0):
        c = Course(id=next_id(Course), department_id=bolum.id, year=2, semester=SemesterType.SPRING,
                   code=kod, name=ad, is_elective=secmeli,
                   hours_theory=t, hours_practice=u, hours_lab=l)
        db.add(c)
        db.flush()
        log("CREATE", "course", c)
        return c

    def sube(dersi, no, hoca_, ogrenci):
        s = CourseSection(id=next_id(CourseSection), course_id=dersi.id, section_no=no,
                          lecturer_id=hoca_.id, expected_students=ogrenci)
        db.add(s)
        db.flush()
        log("CREATE", "course_section", s)
        return s

    c2001 = ders(ceng, "CENG2001", "İstatistik")
    c2003 = ders(ceng, "CENG2003", "Diferansiyel Denklemler")
    c2020 = ders(ceng, "CENG2020", "Veri Yapıları", t=2, u=2)     # T+U → W8 kanıtı
    c2030 = ders(ceng, "CENG2030", "Algoritmalar", t=3)           # İKİ şubeli → K-15
    c2051 = ders(ceng, "CENG2051", "Yapay Zekaya Giriş", secmeli=True)
    c2052 = ders(ceng, "CENG2052", "Oyun Programlama", secmeli=True, t=3)  # W8
    c2053 = ders(ceng, "CENG2053", "Web Programlama", secmeli=True)        # asenkron
    e2010 = ders(eee, "EEE2010", "Devre Analizi")
    e2015 = ders(eee, "EEE2015", "Sinyaller")

    s2001 = sube(c2001, 1, kaya, 55)
    s2003 = sube(c2003, 1, demir, 55)
    s2020 = sube(c2020, 1, sahin, 55)
    s2030_1 = sube(c2030, 1, sahin, 30)
    s2030_2 = sube(c2030, 2, demir, 30)
    s2051 = sube(c2051, 1, arslan, 25)
    s2052 = sube(c2052, 1, yildiz, 20)
    s2053 = sube(c2053, 1, kaya, 20)
    e2010_1 = sube(e2010, 1, yildiz, 45)
    e2015_1 = sube(e2015, 1, kaya, 45)

    # --- kullanıcılar ---
    def alt_hesap(ad, eposta, bolumler, **yetkiler):
        u = User(id=next_id(User), workgroup_id=wg.id, name=ad, email=eposta,
                 password_hash=hash_password("althesap123"),
                 role=UserRole.SUB_ACCOUNT, status=UserStatus.ACTIVE, **yetkiler)
        db.add(u)
        db.flush()
        for b in bolumler:
            db.add(DepartmentMembership(user_id=u.id, department_id=b.id))
        # Gerçek davet akışının izi (K-37): admin davet etti, kullanıcı aktifleşti.
        log_action(db, admin, "INVITE", "user", u.id, u)
        log_action(db, u, "ACTIVATE", "user", u.id, u)
        return u

    # İki alt hesabın derslik yetkisi bilinçli olarak farklı: K-02'nin iki yüzü
    # de demoda gösterilebilsin.
    alt_hesap("Bilgisayar Sorumlusu", "ceng@muh.example.edu.tr", [ceng],
              can_manage_courses=True, can_manage_weekly=True,
              can_manage_exams=True, can_manage_classrooms=True)
    alt_hesap("Elektrik Sorumlusu", "eee@muh.example.edu.tr", [eee],
              can_manage_courses=True, can_manage_weekly=True,
              can_manage_exams=True, can_manage_classrooms=False)

    # Davet akışı demosu: aktifleşmemiş kullanıcı. Şifresi yok, giremez.
    bekleyen = User(id=next_id(User), workgroup_id=wg.id, name="Yeni Öğretim Üyesi",
                    email="pending@muh.example.edu.tr",
                    password_hash="", role=UserRole.SUB_ACCOUNT,
                    status=UserStatus.PENDING, can_manage_weekly=True)
    db.add(bekleyen)
    db.flush()
    log_action(db, admin, "INVITE", "user", bekleyen.id, bekleyen)

    # --- haftalık program ---
    def giris(subesi, derslik_, gun, baslangic, adet, *,
              tur=SessionType.THEORY, mod=DeliveryMode.FACE_TO_FACE):
        e = WeeklyScheduleEntry(
            id=next_id(WeeklyScheduleEntry),
            section_id=subesi.id, classroom_id=derslik_.id if derslik_ else None,
            day_of_week=gun, start_slot=baslangic, slot_count=adet,
            session_type=tur, delivery_mode=mod,
            # K-59: haftalık satırın status/submitted_at kolonu YOK.
            # draft_id NULL = yayında; seed doğrudan yayın üretir.
            created_by=admin.id,
        )
        db.add(e)
        db.flush()
        log("CREATE", "weekly_entry", e)
        return e


    # PAZARTESİ — cohort ve hoca çakışmaları
    giris(s2001, b201, 1, 1, 2)      # çapa: 08:30-10:15
    giris(s2003, b202, 1, 2, 2)              # → W3 (aynı cohort, ikisi zorunlu)
    giris(e2015_1, a101, 1, 1, 2)   # → W2 (Kaya iki bölümde aynı anda)
    giris(s2030_1, b203, 1, 1, 3)   # CENG2030 şube 1
    # CENG2030 şube 2 PERŞEMBE'de: CENG2001 ile uyumlu bir kombinasyon KALIR,
    # bu yüzden CENG2001 × CENG2030 W3 ÜRETMEZ (K-15 kanıtı).

    # Asenkron: Kaya, Pazartesi aynı saatte ÜÇÜNCÜ bir derste görünüyor.
    # W2 üretmez çünkü asenkron girişler ön-elenir (K-19).
    giris(s2053, None, 1, 1, 2, mod=DeliveryMode.ONLINE_ASYNC)

    # SALI — seçmeli uyarısı, online ders, derslik çakışması
    giris(s2051, None, 2, 2, 2, mod=DeliveryMode.ONLINE_SYNC)  # derslik NULL (K-23)
    giris(s2052, lab1, 2, 3, 2)              # → W4 (ikisi seçmeli, slot 3 kesişir)
    giris(s2020, b202, 2, 5, 2, tur=SessionType.PRACTICE)
    giris(e2010_1, b202, 2, 5, 2)            # → W1 (aynı derslik, aynı slotlar)

    # ÇARŞAMBA — kapasite
    giris(s2020, lab1, 3, 1, 2)     # → W7 (55 öğrenci > LAB-1 kapasite 30)

    # PERŞEMBE — mükerrer oturum
    giris(s2030_2, b201, 4, 3, 2)
    giris(s2030_2, b202, 4, 4, 1)            # → W5 (aynı şube) + W2 (aynı hoca)

    # --- sınavlar (hepsi MIDTERM — K-41) ---
    def sinav(dersi, hoca_, tarih, saat, sure, derslikler):
        x = Exam(id=next_id(Exam), course_id=dersi.id, exam_type=ExamType.MIDTERM,
                 exam_date=tarih, start_time=saat, duration_minutes=sure,
                 lecturer_id=hoca_.id,
                 # Sınavlarda status/submitted_at DURUYOR (K-16, sınav fazı ayrı);
                 # seed taslak sınav üretir → submitted_at boş.
                 created_by=admin.id)
        x.classrooms = derslikler
        db.add(x)
        db.flush()
        log("CREATE", "exam", x)
        return x

    # ÇARŞAMBA akşamı — sınavlarda saat penceresi YOKTUR (K-06), 18:00 geçerli.
    # 17:30 sonrası olduğu için hiçbir haftalık dersle kesişemez → X sessiz.
    sinav(c2001, kaya, CAR, time(18, 0), 90, [a101])
    sinav(c2003, demir, CAR, time(18, 30), 90, [a101])   # → E1 (ortak A-101) + E4a
    sinav(c2051, arslan, CAR, time(18, 0), 60, [b201])   # → E4b ×2 (seçmeli)
    sinav(e2015, kaya, CAR, time(18, 0), 90, [b202, b203])   # → E3 (Kaya)

    # ÇARŞAMBA sabahı — K-13 KANITI: dersin kendi vizesi kendi saatinde.
    # CENG2020 Çarşamba 08:30'da LAB-1'de ders yapıyor; vizesi de aynı anda.
    # Aynı ders olduğu için X1/X2/X3 hiçbiri tetiklenmez.
    sinav(c2020, sahin, CAR, time(8, 30), 60, [b203])    # → E5 (40 < 55)

    # PAZARTESİ sabahı — çapraz kuralların tamamı
    sinav(e2010, yildiz, PZT, time(9, 0), 60, [b201])
    # ↑ X1: B-201'de o saatte CENG2001 dersi var (fiziksel imkânsızlık)
    #   X2: aynı EEE cohort'unun EEE2015 dersi o saatte
    sinav(c2053, kaya, PZT, time(9, 0), 60, [lab1])
    # ↑ E5a: LAB-1'in sınav kontenjanı girilmemiş (NULL)
    #   X2: CENG cohort'unun üç dersi o saatte
    #   X3: Kaya o saatte derste (CENG2001 ve EEE2015)

    # CUMA — kontenjan israfı
    sinav(c2052, yildiz, CUM, time(13, 30), 60, [a101, b201, b202])
    # ↑ E7: en küçük oda (20) çıkınca kalan 110, öğrenci 20 → bariz fazlalık

    db.commit()
    db.close()
    print("• Demo verisi, islem kayitlari ve kullanicilar eklendi.")


# ======================================================================
# 3) Kendini doğrulama
# ======================================================================

def _ders_kodlari(sonuc) -> set[str]:
    """Sonucun etkilediği DERS kodları.

    Haftalık girişler kodu "CENG2001-1" (şube ekli), sınavlar "CENG2001"
    biçiminde taşır — sınav ders düzeyinde olduğu için (K-16). Karşılaştırma
    ders düzeyinde yapılacağı için şube eki atılır.
    """
    kodlar = set()
    for a in sonuc["affected"]:
        kod = a.get("course_code")
        if kod:
            kodlar.add(kod.split("-")[0])
    return kodlar


def dogrula() -> bool:
    """Motoru gerçekten çalıştırıp iki şeyi birden sınar: beklenen kuralların
    hepsi çıktı mı, ve susması gerekenler sustu mu?"""
    db = SessionLocal()
    try:
        rapor = scan_workgroup(db, 1)
    finally:
        db.close()

    tum = rapor["hard"] + rapor["warnings"]
    bulunan = {r["rule_id"] for r in tum}
    eksik = BEKLENEN_KURALLAR - bulunan
    fazla = bulunan - BEKLENEN_KURALLAR

    print(f"\n• Motor taramasi: {len(rapor['hard'])} HARD, "
          f"{len(rapor['warnings'])} WARNING")

    sayim = {}
    for r in tum:
        sayim[r["rule_id"]] = sayim.get(r["rule_id"], 0) + 1
    print("  " + "  ".join(f"{k}×{v}" for k, v in sorted(sayim.items())))

    sorunlar = []
    if eksik:
        sorunlar.append(f"EKSIK (seed bu kurallari tetiklemeliydi): {sorted(eksik)}")
    if fazla:
        sorunlar.append(f"FAZLA (istenmeyen cakisma sizdi): {sorted(fazla)}")

    # Negatif iddialar: susması gereken yerler
    for aciklama, ihlal_mi in SESSIZ_KALMALI:
        ihlaller = [r for r in tum if ihlal_mi(r["rule_id"], _ders_kodlari(r))]
        if ihlaller:
            sorunlar.append(f"SUSMALIYDI — {aciklama}\n    "
                            + ", ".join(f"{r['rule_id']} {sorted(_ders_kodlari(r))}"
                                        for r in ihlaller))

    if not sorunlar:
        print(f"• DOGRULAMA GECTI: {len(BEKLENEN_KURALLAR)} kural uretildi, "
              f"{len(SESSIZ_KALMALI)} atlama kosulu sessiz kaldi.")
        return True

    for s in sorunlar:
        print(f"! {s}")
    return False


def main():
    ayrist = argparse.ArgumentParser(description="Demo verisi kurar.")
    ayrist.add_argument("--yes", action="store_true",
                        help="Onay sorma (otomasyon icin).")
    args = ayrist.parse_args()

    guvenlik_kapisi(args.yes)
    reset()
    seed()
    if not dogrula():
        sys.exit("\nSEED KIRIK: veri kurgusu ile motor uyusmuyor.")

    print("""
┌───────────────────────────────────────────────────────────────┐
│  DEMO HAZIR                                                   │
│  Admin:       admin@muh.example.edu.tr  /  admin1234          │
│  Alt hesap:   ceng@ ve eee@ (.../althesap123)                 │
│  Bekleyen:    pending@  — davet akisi demosu icin             │
│                                                               │
│  Haftalik program (2025-26 Bahar, 2. sinif):                  │
│   W1  Sali 12:30  EEE2010 ↔ CENG2020 — ayni derslik (B-202)   │
│   W2  Pzt  08:30  CENG2001 ↔ EEE2015 — Kaya iki yerde         │
│   W3  Pzt  09:30  CENG2001 ↔ CENG2003 — ayni sinif, zorunlu   │
│   W4  Sali 10:30  CENG2051 ↔ CENG2052 — secmeli, uyari        │
│   W5  Per  11:30  CENG2030-2 mukerrer oturum                  │
│   W7  Car  08:30  CENG2020 (55) > LAB-1 kapasite (30)         │
│   W8       CENG2052: 3 saat gerekli, 2 slot yerlesmis         │
│                                                               │
│  Vize takvimi (13-17 Nisan 2026):                             │
│   E1  Car 18:00  CENG2001 ↔ CENG2003 — ortak derslik A-101    │
│   E3  Car 18:00  CENG2001 ↔ EEE2015 — ayni hoca (Kaya)        │
│   E4a Car 18:00  ayni sinif, iki zorunlu sinav                │
│   E4b Car 18:00  secmeli dahil — uyari                        │
│   E5  Car 08:30  CENG2020: B-203 kontenjani (40) < 55         │
│   E5a Pzt 09:00  LAB-1'in sinav kontenjani girilmemis         │
│   E7  Cum 13:30  CENG2052: 3 derslik, 20 ogrenci — israf      │
│   X1  Pzt 09:00  EEE2010 vizesi, B-201'de ders varken         │
│   X2  Pzt 09:00  ayni sinifin dersi sinav saatinde            │
│   X3  Pzt 09:00  Kaya hem sinavda hem derste                  │
│                                                               │
│  SESSIZ KALMASI GEREKENLER (kurgunun ikinci yarisi):          │
│   • CENG2001 × CENG2030 → W3 YOK: sube 2 uyumlu (K-15)        │
│   • CENG2053 asenkron   → W2 YOK: on-eleme (K-19)             │
│   • CENG2020 vizesi kendi saatinde → X YOK (K-13)             │
│                                                               │
│  API'den denenerek gosterilenler (DB kisiti engelliyor):      │
│   W6 pencere disi slot · E2 mukerrer vize · E6 hafta sonu     │
└───────────────────────────────────────────────────────────────┘""")


if __name__ == "__main__":
    main()
