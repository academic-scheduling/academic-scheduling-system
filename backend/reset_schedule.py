"""Program ve sinav verisini SIFIRLAR — iskelet veri (bolum/hesap/hoca/derslik/
ders) yerinde kalir.

Amac: gercek programi elle kurmaya bastan baslamak. Seed betikleri veri URETIR,
bu betik yalnizca PROGRAM katmanini siler; kimlik ve katalog katmanina dokunmaz.

SILER:
  - weekly_schedule_entries (yayin + butun taslak kopyalari)
  - exams + exam_classrooms (yayin + taslak)
  - schedule_drafts + draft_affected_departments (acik VE onaylanmis)
    → onaylanmis taslak ayni zamanda "son degisiklikler" akisinin kaynagidir
      (K-59), silinince akis da temizlenir
  - audit_logs (tamami)

DOKUNMAZ:
  workgroups, users, department_memberships, departments, lecturers,
  buildings, classrooms, courses, course_sections, course_cohorts, slots

Kullanim (bilerek zahmetli — yanlislikla calismasin):
    python reset_schedule.py --evet-sil
    python reset_schedule.py --evet-sil --dersi-sil DENEME
"""

import argparse
import sys

from sqlalchemy import text

from app.db import SessionLocal

# Silme SIRASI onemli: FK'lar CASCADE tanimli ama sirali gitmek, bir kisit
# degisirse hatanin nerede oldugunu belli eder.
SILINECEKLER = [
    ("weekly_schedule_entries", "haftalık yerleşim"),
    ("exams", "sınav"),                        # exam_classrooms CASCADE ile gider
    ("schedule_drafts", "taslak"),             # draft_affected_departments CASCADE
    ("audit_logs", "denetim kaydı"),
]

KORUNANLAR = [
    ("departments", "bölüm"),
    ("users", "kullanıcı"),
    ("lecturers", "öğretim üyesi"),
    ("buildings", "bina"),
    ("classrooms", "derslik"),
    ("courses", "ders"),
    ("course_sections", "ders şubesi"),
    ("course_cohorts", "ek cohort"),
    ("slots", "slot"),
]


def say(db, tablo: str) -> int:
    return db.execute(text(f"select count(*) from {tablo}")).scalar() or 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--evet-sil", action="store_true",
                    help="Onay. Verilmezse betik yalnız ÖLÇER, silmez.")
    ap.add_argument("--dersi-sil", action="append", default=[], metavar="KOD",
                    help="Ek olarak silinecek ders kodu (şubeleri ve ek "
                         "cohort'larıyla). Birden çok kez verilebilir.")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        print("=== ÖNCE ===")
        for tablo, ad in SILINECEKLER:
            print(f"  {ad:<20}: {say(db, tablo)}")

        if not args.evet_sil:
            print("\n(yalnız ölçüm — silmek için --evet-sil ekleyin)")
            return 0

        # Sinav-derslik bagi CASCADE ile gidiyor; yine de once sayalim ki
        # cikti "kac bag koptu" sorusunu cevaplasin.
        bag = say(db, "exam_classrooms")

        for tablo, _ in SILINECEKLER:
            db.execute(text(f"delete from {tablo}"))

        for kod in args.dersi_sil:
            # course_sections ve course_cohorts CASCADE ile gider.
            n = db.execute(text("delete from courses where code = :k"),
                           {"k": kod}).rowcount
            print(f"  ders silindi: {kod} ({n} kayıt)")

        db.commit()

        print(f"  sınav-derslik bağı  : {bag} (CASCADE ile gitti)")
        print("\n=== SONRA ===")
        for tablo, ad in SILINECEKLER:
            print(f"  {ad:<20}: {say(db, tablo)}")
        print("\n=== KORUNANLAR ===")
        for tablo, ad in KORUNANLAR:
            print(f"  {ad:<20}: {say(db, tablo)}")
        print("\nProgram ve sınav takvimi boş. Gerçek veriyi elle kurabilirsiniz.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
