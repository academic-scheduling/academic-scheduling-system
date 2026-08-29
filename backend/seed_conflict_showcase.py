"""Geçici çakışma vitrini — Çakışma Raporu'nu incelemek için kurgulanmış veri.

NEDEN VAR
---------
Çakışma Raporu sayfası şu an yalnız dört kural gösteriyor (W4/W7/W8/W9), çünkü
gerçek veride öteki durumlar yok ve sistemde HİÇ SINAV YOK — bu yüzden bütün
E ve X kuralları sessiz. Sayfanın renk/sıralama/filtre davranışını tam görmek
için her kuralın en az bir örneği lazım.

`seed_demo.py` bunu yapar AMA veritabanını TRUNCATE eder; gerçek mühendislik
verisi gider. Bu script EKLEMELİ çalışır: hiçbir mevcut kaydı okumaz,
değiştirmez, silmez.

GEÇİCİ VE GERİ ALINABİLİR
-------------------------
Ürettiği her kayıt "ZZ" önekli ve tek bir geçici bölümün (`ZZ`) altında
toplanır: kendi binası, kendi derslikleri, kendi hocaları. Bu yüzden temizlik
tahmine dayanmıyor — `--undo` tam olarak bu adaya dokunur, gerçek veriye
dokunamaz.

    python seed_conflict_showcase.py           # kurar + doğrular
    python seed_conflict_showcase.py --undo    # eklediklerini siler
    python seed_conflict_showcase.py --verify  # yalnız tarar, veri yazmaz

DENETİM KAYDINA YAZMIYOR
------------------------
`seed_demo.py` her kaydı audit log'a yazar (İşlem Kayıtları ekranı boş
kalmasın diye). Burada BİLEREK yazmıyoruz: bu veri geçici, denetim kaydına
22 satır sahte "oluşturma" izi bırakıp sonra silmek, denetim kaydının kendi
amacını (gerçekte ne olduğunun izi) bozardı.

GİREMEYEN ÜÇ KURAL
------------------
W6 (pencere dışı slot), E2 (yinelenen sınav tipi) ve E6 (hafta sonu sınavı)
veritabanı kısıtıyla (CHECK / UNIQUE) engelleniyor — INSERT zaten reddedilir.
Motorda bu kurallar var; yalnız veri yoluyla gösterilemiyorlar.
"""

import argparse
import sys
from datetime import date, time

from sqlalchemy.orm import Session

from app.conflict_service import scan_workgroup
from app.db import SessionLocal
from app.models import (
    Building, Classroom, Course, CourseSection, DeliveryMode, Department,
    Exam, ExamType, Lecturer, RoomType, ScheduleDraft, SemesterType,
    SessionType, WeeklyScheduleEntry,
)
from app.normalize import normalize_lecturer_name

WORKGROUP_ID = 1
ADMIN_ID = 1

# Adanın işareti. Tek bir yerde duruyor ki kurma ve silme aynı tanımı görsün.
DEP_CODE = "ZZ"
DEP_NAME = "ZZ Geçici Çakışma Vitrini"
BUILDING_NAME = "ZZ Geçici Blok"
ROOM_PREFIX = "ZZ-"
LECTURER_PREFIX = "ZZ Test"

# Sınav haftası: 14-18 Aralık 2026, hepsi hafta içi. Hafta sonu tarihi DB
# CHECK'i tarafından reddedilir (E6'nın giremeyişinin sebebi), o yüzden
# aşağıda ayrıca doğruluyoruz — tarih sabitini biri elle değiştirirse
# script anlaşılmaz bir IntegrityError yerine net bir mesajla dursun.
PZT, SAL, CAR, PER, CUM = (date(2026, 12, d) for d in (14, 15, 16, 17, 18))

# Bu vitrinin sözleşmesi: ZZ adası tam olarak bu kuralları üretmeli.
# Sayı da önemli — "fazla" da hatadır, kurgu kaymış demektir.
BEKLENEN: dict[str, int] = {
    "W1": 1, "W2": 2, "W3": 1, "W4": 1, "W5": 1, "W7": 1, "W8": 1, "W9": 1,
    "E1": 1, "E3": 1, "E4a": 1, "E4b": 2, "E5": 1, "E5a": 2, "E7": 1, "E8": 1,
    "X1": 1, "X2": 1, "X3": 1,
}

# W2 neden 2? Biri kurgulanmış (Salı, aynı hoca iki bölümde), öteki W5'in
# kaçınılmaz yoldaşı: aynı şubenin kesişen iki oturumu, tanımı gereği aynı
# hocayı da iki yerde gösterir. Ayrıştırmak için kuralı değiştirmek gerekirdi.
# E5a neden 2? ZZ-LAB'ın sınav kontenjanı NULL ve iki sınav onu kullanıyor
# (biri E5a'nın kendisi için, öteki X kurallarını taşıyan sınav).


# ======================================================================
# Kurulum
# ======================================================================

def kur(db: Session) -> None:
    if db.query(Department).filter_by(workgroup_id=WORKGROUP_ID, code=DEP_CODE).first():
        sys.exit(f"ZATEN KURULU: '{DEP_CODE}' bolumu var. Once --undo calistirin.")

    # --- bölüm, bina, derslikler ---
    dep = Department(workgroup_id=WORKGROUP_ID, name=DEP_NAME, code=DEP_CODE)
    db.add(dep)
    db.flush()

    bina = Building(workgroup_id=WORKGROUP_ID, name=BUILDING_NAME)
    db.add(bina)
    db.flush()

    def derslik(kod, kap, sinav_kap, tur=RoomType.CLASSROOM):
        c = Classroom(workgroup_id=WORKGROUP_ID, building_id=bina.id,
                      room_code=ROOM_PREFIX + kod, room_type=tur,
                      capacity=kap, exam_capacity=sinav_kap)
        db.add(c)
        db.flush()
        return c

    # Kapasiteler kurguya göre seçildi:
    #   101 (50) geniş  · 102 (20) dar → E5'i o tetikler
    #   103 (40) orta   · LAB (10 / sınav kontenjanı NULL) → W7 ve E5a
    r101 = derslik("101", 60, 50)
    r102 = derslik("102", 60, 20)
    r103 = derslik("103", 60, 40)
    rlab = derslik("LAB", 10, None, RoomType.LAB)

    # --- hocalar ---
    def hoca(ad):
        lec = Lecturer(workgroup_id=WORKGROUP_ID, full_name=f"{LECTURER_PREFIX} {ad}",
                       normalized_name=normalize_lecturer_name(f"{LECTURER_PREFIX} {ad}"),
                       source="MANUAL", is_external=False, department_id=dep.id)
        db.add(lec)
        db.flush()
        return lec

    L1, L2, L3, L4 = hoca("Bir"), hoca("Iki"), hoca("Uc"), hoca("Dort")

    # --- dersler + şubeler ---
    # YIL, çakışmayı YÖNETME aracı: cohort kuralları (W3/W4) yalnız aynı
    # bölüm+yıl+dönem içinde çalışır. W1/W2'nin taraflarını farklı yıllara
    # koyunca o çiftler cohort kuralı ÜRETMEZ ve her kural tek başına okunur.
    def ders(kod, ad, yil, *, secmeli=False, t=2):
        c = Course(department_id=dep.id, year=yil, semester=SemesterType.SPRING,
                   code=kod, name=ad, is_elective=secmeli,
                   hours_theory=t, hours_practice=0, hours_lab=0, midterm_count=1)
        db.add(c)
        db.flush()
        return c

    def sube(dersi, hoca_, ogrenci):
        s = CourseSection(course_id=dersi.id, section_no=1,
                          lecturer_id=hoca_.id, expected_students=ogrenci)
        db.add(s)
        db.flush()
        return s

    # 1. sınıf — cohort kuralları ve tekil kusurlar burada
    d101 = ders("ZZ101", "ZZ Zorunlu Bir", 1)
    d102 = ders("ZZ102", "ZZ Zorunlu Iki", 1)
    d103 = ders("ZZ103", "ZZ Secmeli Bir", 1, secmeli=True)
    d104 = ders("ZZ104", "ZZ Eksik Saat", 1, t=3)        # 2 slot yerleşecek → W8
    d105 = ders("ZZ105", "ZZ Dersliksiz", 1)             # derslik NULL → W9
    d106 = ders("ZZ106", "ZZ Kalabalik", 1)              # 60 > LAB 10 → W7
    d107 = ders("ZZ107", "ZZ Yinelenen", 1, t=3)         # iki oturum → W5
    d108 = ders("ZZ108", "ZZ Sinavi Derste", 1)          # X1/X2/X3 taşıyıcısı
    # Üst sınıflar — yalnız W1/W2'nin karşı tarafını cohort'tan ayırmak için
    d201 = ders("ZZ201", "ZZ Ikinci Sinif Bir", 2)
    d202 = ders("ZZ202", "ZZ Ikinci Sinif Iki", 2)
    d301 = ders("ZZ301", "ZZ Ucuncu Sinif", 3)
    d401 = ders("ZZ401", "ZZ Dorduncu Sinif", 4)

    s101 = sube(d101, L1, 15)
    s102 = sube(d102, L2, 30)
    s103 = sube(d103, L2, 25)
    s104 = sube(d104, L3, 45)     # 45 > ZZ-102 sınav kontenjanı (20) → E5
    s105 = sube(d105, L3, 20)
    s106 = sube(d106, L3, 60)     # 60 > ZZ-LAB kapasite (10) → W7
    s107 = sube(d107, L4, 20)
    s108 = sube(d108, L1, 20)
    s201 = sube(d201, L1, 30)
    s202 = sube(d202, L4, 15)
    s301 = sube(d301, L2, 30)
    s401 = sube(d401, L4, 20)

    # --- haftalık program ---
    def giris(subesi, derslik_, gun, baslangic, adet,
              mod=DeliveryMode.FACE_TO_FACE):
        e = WeeklyScheduleEntry(
            section_id=subesi.id,
            classroom_id=derslik_.id if derslik_ else None,
            day_of_week=gun, start_slot=baslangic, slot_count=adet,
            session_type=SessionType.THEORY, delivery_mode=mod,
            created_by=ADMIN_ID,   # draft_id NULL = yayında
        )
        db.add(e)
        db.flush()
        return e

    # PAZARTESİ
    giris(s101, r101, 1, 1, 2)      # 08:30-10:15
    giris(s102, r102, 1, 2, 2)      # 09:30-11:15 → W3 (iki zorunlu, 1. sınıf)
    giris(s201, r103, 1, 6, 2)      # 2. sınıf
    giris(s301, r103, 1, 6, 2)      # 3. sınıf → W1 (aynı derslik, cohort AYRI)

    # SALI
    giris(s103, r102, 2, 1, 2)
    giris(s104, r103, 2, 2, 2)      # → W4 (biri seçmeli) · ayrıca W8 (3 saat, 2 slot)
    giris(s202, r101, 2, 6, 2)      # L4
    giris(s401, r102, 2, 6, 2)      # L4 → W2 (aynı hoca, cohort ve derslik AYRI)

    # ÇARŞAMBA
    giris(s106, rlab, 3, 1, 2)      # → W7 (60 > 10)
    giris(s105, None, 3, 5, 2)      # → W9 (yüz yüze ama dersliksiz)

    # PERŞEMBE — aynı şubenin kesişen iki oturumu
    giris(s107, r101, 4, 1, 2)
    giris(s107, r102, 4, 2, 1)      # → W5 (+ kaçınılmaz W2: aynı şube = aynı hoca)

    # CUMA
    giris(s108, r101, 5, 1, 2)

    # --- sınavlar (hepsi MIDTERM: K-41, X kuralları yalnız vizede çalışır) ---
    for gun in (PZT, SAL, CAR, PER, CUM):
        if gun.weekday() > 4:
            sys.exit(f"KURGU HATASI: {gun} hafta sonu; DB CHECK reddeder.")

    def sinav(dersi, hoca_, tarih, saat, dakika, derslikler):
        x = Exam(course_id=dersi.id, exam_type=ExamType.MIDTERM, exam_index=1,
                 exam_date=tarih, start_time=saat, duration_minutes=dakika,
                 lecturer_id=hoca_.id, created_by=ADMIN_ID)
        x.classrooms = derslikler
        db.add(x)
        db.flush()
        return x

    # Akşam sınavları (17:30 sonrası) BİLEREK: sınavda saat penceresi yoktur
    # (K-06) ve o saatte hiçbir haftalık ders olmadığı için X kuralları susar.
    # Böylece E kuralları tek başına, X'in gürültüsü olmadan okunur.
    sinav(d201, L1, PZT, time(18, 0), 90, [r101])
    sinav(d301, L2, PZT, time(18, 30), 90, [r101])   # → E1 (ortak ZZ-101)

    sinav(d202, L4, SAL, time(18, 0), 60, [r102])
    sinav(d401, L4, SAL, time(18, 0), 60, [r103])    # → E3 (aynı sorumlu L4)

    sinav(d101, L1, CAR, time(18, 0), 60, [r102])
    sinav(d102, L2, CAR, time(18, 0), 60, [r103])    # → E4a (iki zorunlu, 1. sınıf)
    sinav(d103, L3, CAR, time(18, 0), 60, [r101])    # → E4b ×2 (seçmeli, ötekilerle)

    # ÇARŞABA SABAHI — çapraz kuralların tamamı tek sınavdan.
    # ZZ106 o saatte ZZ-LAB'da, hocası L3, cohort 1. sınıf. Sınav BAŞKA bir
    # dersin (ZZ108) sınavı olduğu için K-13 istisnası devreye girmez.
    sinav(d108, L3, CAR, time(9, 0), 60, [rlab])
    # ↑ X1 (derslik işgali) · X2 (cohort) · X3 (sorumlu derste) · E5a (kontenjan NULL)

    sinav(d104, L1, PER, time(18, 0), 60, [r102])    # → E5 (20 < 45)
    sinav(d105, L2, PER, time(20, 0), 60, [rlab])    # → E5a (kontenjan girilmemiş)
    sinav(d106, L3, CUM, time(18, 0), 60, [r101, r102, r103])
    # ↑ E7: en küçük oda (20) çıkınca kalan 90 >= 60+10 → bariz fazlalık
    sinav(d107, L4, CUM, time(20, 0), 60, [])        # → E8 (hiç derslik yok)

    db.commit()
    print(f"• ZZ adasi kuruldu: 1 bolum, 1 bina, 4 derslik, 4 hoca, "
          f"12 ders, 13 haftalik giris, 12 sinav.")


# ======================================================================
# Temizlik
# ======================================================================

def geri_al(db: Session) -> None:
    """ZZ adasını siler. Yabancı anahtar sırası: yapraklardan köke."""
    dep = db.query(Department).filter_by(workgroup_id=WORKGROUP_ID, code=DEP_CODE).first()
    if not dep:
        print(f"• '{DEP_CODE}' bolumu yok — silinecek bir sey yok.")
        return

    # K-81: ZZ bölümünde AÇILMIŞ program taslakları da silinmeli. Vitrin bunları
    # üretmiyor ama kullanıcı ekranda "Taslak Aç" diyerek üretebiliyor ve
    # `schedule_drafts.department_id -> departments.id` yabancı anahtarı var:
    # taslak dururken bölümü silmek IntegrityError verir, yani --undo tam da
    # vitrin kullanıldıktan sonra kırılırdı. Taslağın KENDİ satırları da
    # (draft_id dolu haftalık/sınav kayıtları) bu bölümün derslerine bağlı
    # olduğu için aşağıdaki ders temizliğiyle birlikte gidiyor.
    taslak_ids = [d.id for d in db.query(ScheduleDraft).filter_by(department_id=dep.id)]

    ders_ids = [c.id for c in db.query(Course).filter_by(department_id=dep.id)]
    sube_ids = [s.id for s in db.query(CourseSection).filter(
        CourseSection.course_id.in_(ders_ids))] if ders_ids else []

    # Sınavlar: derslik bağını (exam_classrooms) ORM üzerinden çöz, yoksa
    # ara tabloda öksüz satır kalır.
    sinavlar = db.query(Exam).filter(Exam.course_id.in_(ders_ids)).all() if ders_ids else []
    for x in sinavlar:
        x.classrooms = []
    db.flush()
    for x in sinavlar:
        db.delete(x)
    # Sınav silmeleri BURADA flush edilmeli: aşağıdaki toplu `courses` silmesi
    # veritabanı düzeyinde sınavları da götürüyor ve ORM sonradan flush edince
    # "12 satır silinecekti, 0 eşleşti" uyarısı veriyordu. Sonuç aynı, ama
    # sıra doğru olunca uyarı da olmuyor.
    db.flush()

    if sube_ids:
        db.query(WeeklyScheduleEntry).filter(
            WeeklyScheduleEntry.section_id.in_(sube_ids)).delete(synchronize_session=False)
        db.query(CourseSection).filter(
            CourseSection.id.in_(sube_ids)).delete(synchronize_session=False)
    if ders_ids:
        db.query(Course).filter(Course.id.in_(ders_ids)).delete(synchronize_session=False)

    db.query(Classroom).filter(
        Classroom.workgroup_id == WORKGROUP_ID,
        Classroom.room_code.like(f"{ROOM_PREFIX}%")).delete(synchronize_session=False)
    db.query(Building).filter(
        Building.workgroup_id == WORKGROUP_ID,
        Building.name == BUILDING_NAME).delete(synchronize_session=False)
    db.query(Lecturer).filter(
        Lecturer.workgroup_id == WORKGROUP_ID,
        Lecturer.full_name.like(f"{LECTURER_PREFIX}%")).delete(synchronize_session=False)
    if taslak_ids:
        db.query(ScheduleDraft).filter(
            ScheduleDraft.id.in_(taslak_ids)).delete(synchronize_session=False)
    db.delete(dep)

    db.commit()
    print(f"• ZZ adasi silindi ({len(ders_ids)} ders, {len(sinavlar)} sinav, "
          f"{len(taslak_ids)} taslak).")


# ======================================================================
# Doğrulama
# ======================================================================

def _zz_mi(sonuc) -> bool:
    """Çakışma ZZ adasına mı ait? Etkilenen öğelerin ders kodundan bakılır."""
    return any((a.get("course_code") or "").startswith("ZZ") for a in sonuc["affected"])


def dogrula(db: Session) -> bool:
    rapor = scan_workgroup(db, WORKGROUP_ID)
    tum = rapor["hard"] + rapor["warnings"]
    zz = [r for r in tum if _zz_mi(r)]

    sayim: dict[str, int] = {}
    for r in zz:
        sayim[r["rule_id"]] = sayim.get(r["rule_id"], 0) + 1

    print(f"\n• Tam tarama: {len(rapor['hard'])} engel, {len(rapor['warnings'])} uyari "
          f"(bunlarin {len(zz)} tanesi ZZ adasindan).")
    print("  ZZ: " + ("  ".join(f"{k}x{v}" for k, v in sorted(sayim.items())) or "(yok)"))

    eksik = {k: v for k, v in BEKLENEN.items() if sayim.get(k, 0) != v}
    fazla = {k: v for k, v in sayim.items() if k not in BEKLENEN}
    if not eksik and not fazla:
        print(f"• DOGRULAMA GECTI: {len(BEKLENEN)} kural beklendigi sayida uretildi.")
        print("  (W6/E2/E6 giremez — DB CHECK/UNIQUE engelliyor.)")
        return True

    for k, bekl in sorted(eksik.items()):
        print(f"! {k}: beklenen {bekl}, bulunan {sayim.get(k, 0)}")
    for k, v in sorted(fazla.items()):
        print(f"! {k}: beklenmiyordu ama {v} kez cikti")
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--undo", action="store_true", help="Eklenen ZZ verisini siler.")
    ap.add_argument("--verify", action="store_true", help="Yalniz tarar, veri yazmaz.")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.undo:
            geri_al(db)
            return
        if not args.verify:
            kur(db)
        if not dogrula(db):
            sys.exit("\nVITRIN KIRIK: veri kurgusu ile motor uyusmuyor.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
