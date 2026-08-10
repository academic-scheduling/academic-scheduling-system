import sys
from datetime import date, time as time_type
from app.db import engine, SessionLocal
from app.models import (
    Base, Workgroup, User, UserRole, UserStatus, Department,
    Building, Classroom, RoomType, Lecturer, Course, CourseSection,
    Slot, WeeklyScheduleEntry, SessionType, DeliveryMode, EntryStatus,
    Exam, ExamType, SemesterType
)
from app.security import hash_password

def seed_database():
    print("Veritabanı kontrol ediliyor...")
    db = SessionLocal()
    try:
        # 1. Workgroup ve Admin Kullanıcıları
        wg = db.query(Workgroup).first()
        if not wg:
            wg = Workgroup(id=1, name="Mühendislik Fakültesi", allowed_email_domain="muh.example.edu.tr")
            db.add(wg)
            db.flush()
            print("Workgroup 'Mühendislik Fakültesi' eklendi.")

        admin1 = db.query(User).filter(User.email == "admin@muh.example.edu.tr").first()
        if not admin1:
            admin1 = User(
                id=1,
                workgroup_id=wg.id,
                name="Sistem Yöneticisi",
                email="admin@muh.example.edu.tr",
                password_hash=hash_password("admin1234"),
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
            )
            db.add(admin1)
            db.flush()
            print("Admin 1 eklendi: admin@muh.example.edu.tr / admin1234")

        admin2 = db.query(User).filter(User.email == "admin@example.com").first()
        if not admin2:
            admin2 = User(
                id=2,
                workgroup_id=wg.id,
                name="Fakülte Yöneticisi",
                email="admin@example.com",
                password_hash=hash_password("admin1234"),
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
            )
            db.add(admin2)
            db.flush()
            print("Admin 2 eklendi: admin@example.com / admin1234")

        wg.created_by = admin1.id

        # 2. Slots (1..9)
        if db.query(Slot).count() == 0:
            slots_data = [
                (1, time_type.fromisoformat("08:30:00"), time_type.fromisoformat("09:15:00")),
                (2, time_type.fromisoformat("09:30:00"), time_type.fromisoformat("10:15:00")),
                (3, time_type.fromisoformat("10:30:00"), time_type.fromisoformat("11:15:00")),
                (4, time_type.fromisoformat("11:30:00"), time_type.fromisoformat("12:15:00")),
                (5, time_type.fromisoformat("12:30:00"), time_type.fromisoformat("13:15:00")),
                (6, time_type.fromisoformat("13:30:00"), time_type.fromisoformat("14:15:00")),
                (7, time_type.fromisoformat("14:30:00"), time_type.fromisoformat("15:15:00")),
                (8, time_type.fromisoformat("15:30:00"), time_type.fromisoformat("16:15:00")),
                (9, time_type.fromisoformat("16:30:00"), time_type.fromisoformat("17:15:00")),
            ]
            for s_no, start, end in slots_data:
                db.add(Slot(slot_no=s_no, start_time=start, end_time=end))
            print("Ders saatleri (Slots 1-9) eklendi.")

        # 3. Bölümler (Departments)
        dep_ceng = db.query(Department).filter(Department.code == "CENG").first()
        if not dep_ceng:
            dep_ceng = Department(id=1, workgroup_id=wg.id, code="CENG", name="Bilgisayar Mühendisliği")
            db.add(dep_ceng)
            db.flush()
            print("Bölüm 'Bilgisayar Mühendisliği' eklendi.")

        dep_eee = db.query(Department).filter(Department.code == "EEE").first()
        if not dep_eee:
            dep_eee = Department(id=2, workgroup_id=wg.id, code="EEE", name="Elektrik-Elektronik Mühendisliği")
            db.add(dep_eee)
            db.flush()
            print("Bölüm 'Elektrik-Elektronik Mühendisliği' eklendi.")

        dep_ie = db.query(Department).filter(Department.code == "IE").first()
        if not dep_ie:
            dep_ie = Department(id=3, workgroup_id=wg.id, code="IE", name="Endüstri Mühendisliği")
            db.add(dep_ie)
            db.flush()
            print("Bölüm 'Endüstri Mühendisliği' eklendi.")

        # 4. Bina ve Derslikler
        bldg = db.query(Building).first()
        if not bldg:
            bldg = Building(id=1, workgroup_id=wg.id, name="Mühendislik Binası")
            db.add(bldg)
            db.flush()

        cls101 = db.query(Classroom).filter(Classroom.room_code == "MB-101").first()
        if not cls101:
            cls101 = Classroom(id=1, workgroup_id=wg.id, building_id=bldg.id, room_code="MB-101", capacity=60, exam_capacity=30, room_type=RoomType.CLASSROOM)
            db.add(cls101)
            db.flush()

        cls102 = db.query(Classroom).filter(Classroom.room_code == "MB-102").first()
        if not cls102:
            cls102 = Classroom(id=2, workgroup_id=wg.id, building_id=bldg.id, room_code="MB-102", capacity=80, exam_capacity=40, room_type=RoomType.CLASSROOM)
            db.add(cls102)
            db.flush()

        cls201 = db.query(Classroom).filter(Classroom.room_code == "MB-201").first()
        if not cls201:
            cls201 = Classroom(id=3, workgroup_id=wg.id, building_id=bldg.id, room_code="MB-201", capacity=30, exam_capacity=15, room_type=RoomType.LAB)
            db.add(cls201)
            db.flush()

        cls301 = db.query(Classroom).filter(Classroom.room_code == "MB-301").first()
        if not cls301:
            cls301 = Classroom(id=4, workgroup_id=wg.id, building_id=bldg.id, room_code="MB-301", capacity=120, exam_capacity=60, room_type=RoomType.AMPHI)
            db.add(cls301)
            db.flush()

        print("Derslikler (MB-101, MB-102, MB-201 Lab, MB-301 Amfi) eklendi.")

        # 5. Öğretim Üyeleri
        lec_ahmet = db.query(Lecturer).filter(Lecturer.normalized_name == "AHMET YILMAZ").first()
        if not lec_ahmet:
            lec_ahmet = Lecturer(id=1, workgroup_id=wg.id, full_name="Prof. Dr. Ahmet Yılmaz", normalized_name="AHMET YILMAZ", email="ahmet.yilmaz@muh.example.edu.tr")
            db.add(lec_ahmet)
            db.flush()

        lec_ayse = db.query(Lecturer).filter(Lecturer.normalized_name == "AYSE KAYA").first()
        if not lec_ayse:
            lec_ayse = Lecturer(id=2, workgroup_id=wg.id, full_name="Doç. Dr. Ayşe Kaya", normalized_name="AYSE KAYA", email="ayse.kaya@muh.example.edu.tr")
            db.add(lec_ayse)
            db.flush()

        lec_mehmet = db.query(Lecturer).filter(Lecturer.normalized_name == "MEHMET DEMIR").first()
        if not lec_mehmet:
            lec_mehmet = Lecturer(id=3, workgroup_id=wg.id, full_name="Dr. Öğr. Üyesi Mehmet Demir", normalized_name="MEHMET DEMIR", email="mehmet.demir@muh.example.edu.tr")
            db.add(lec_mehmet)
            db.flush()

        lec_zeynep = db.query(Lecturer).filter(Lecturer.normalized_name == "ZEYNEP SAHIN").first()
        if not lec_zeynep:
            lec_zeynep = Lecturer(id=4, workgroup_id=wg.id, full_name="Dr. Zeynep Şahin", normalized_name="ZEYNEP SAHIN", email="zeynep.sahin@muh.example.edu.tr")
            db.add(lec_zeynep)
            db.flush()

        print("Öğretim üyeleri eklendi.")

        # 6. Dersler ve Şubeler
        c_ceng101 = db.query(Course).filter(Course.code == "CENG101").first()
        if not c_ceng101:
            c_ceng101 = Course(
                id=1, department_id=dep_ceng.id, year=1, semester=SemesterType.FALL,
                code="CENG101", name="Programlamaya Giriş", hours_theory=3, hours_practice=0, hours_lab=2
            )
            db.add(c_ceng101)
            db.flush()

        sec_ceng101_1 = db.query(CourseSection).filter(CourseSection.course_id == c_ceng101.id, CourseSection.section_no == 1).first()
        if not sec_ceng101_1:
            sec_ceng101_1 = CourseSection(id=1, course_id=c_ceng101.id, section_no=1, lecturer_id=lec_ahmet.id, expected_students=45, default_classroom_id=cls101.id)
            db.add(sec_ceng101_1)
            db.flush()

        sec_ceng101_2 = db.query(CourseSection).filter(CourseSection.course_id == c_ceng101.id, CourseSection.section_no == 2).first()
        if not sec_ceng101_2:
            sec_ceng101_2 = CourseSection(id=2, course_id=c_ceng101.id, section_no=2, lecturer_id=lec_ayse.id, expected_students=40, default_classroom_id=cls102.id)
            db.add(sec_ceng101_2)
            db.flush()

        c_ceng201 = db.query(Course).filter(Course.code == "CENG201").first()
        if not c_ceng201:
            c_ceng201 = Course(
                id=2, department_id=dep_ceng.id, year=2, semester=SemesterType.FALL,
                code="CENG201", name="Veri Yapıları ve Algoritmalar", hours_theory=3, hours_practice=0, hours_lab=0
            )
            db.add(c_ceng201)
            db.flush()

        sec_ceng201_1 = db.query(CourseSection).filter(CourseSection.course_id == c_ceng201.id, CourseSection.section_no == 1).first()
        if not sec_ceng201_1:
            sec_ceng201_1 = CourseSection(id=3, course_id=c_ceng201.id, section_no=1, lecturer_id=lec_ahmet.id, expected_students=50, default_classroom_id=cls101.id)
            db.add(sec_ceng201_1)
            db.flush()

        c_eee101 = db.query(Course).filter(Course.code == "EEE101").first()
        if not c_eee101:
            c_eee101 = Course(
                id=3, department_id=dep_eee.id, year=1, semester=SemesterType.FALL,
                code="EEE101", name="Elektrik Devreleri", hours_theory=4, hours_practice=0, hours_lab=0
            )
            db.add(c_eee101)
            db.flush()

        sec_eee101_1 = db.query(CourseSection).filter(CourseSection.course_id == c_eee101.id, CourseSection.section_no == 1).first()
        if not sec_eee101_1:
            sec_eee101_1 = CourseSection(id=4, course_id=c_eee101.id, section_no=1, lecturer_id=lec_zeynep.id, expected_students=60, default_classroom_id=cls301.id)
            db.add(sec_eee101_1)
            db.flush()

        c_ie101 = db.query(Course).filter(Course.code == "IE101").first()
        if not c_ie101:
            c_ie101 = Course(
                id=4, department_id=dep_ie.id, year=1, semester=SemesterType.FALL,
                code="IE101", name="Endüstri Mühendisliğine Giriş", hours_theory=3, hours_practice=0, hours_lab=0
            )
            db.add(c_ie101)
            db.flush()

        sec_ie101_1 = db.query(CourseSection).filter(CourseSection.course_id == c_ie101.id, CourseSection.section_no == 1).first()
        if not sec_ie101_1:
            sec_ie101_1 = CourseSection(id=5, course_id=c_ie101.id, section_no=1, lecturer_id=lec_mehmet.id, expected_students=40, default_classroom_id=cls102.id)
            db.add(sec_ie101_1)
            db.flush()

        print("Dersler ve Şubeler eklendi.")

        # 7. Haftalık Program Girişleri (Weekly Schedule Entries)
        if db.query(WeeklyScheduleEntry).count() == 0:
            entries = [
                # CENG101 Sec 1 - Teori: Pazartesi 2-4 (09:30 - 12:15) MB-101
                WeeklyScheduleEntry(id=1, section_id=sec_ceng101_1.id, classroom_id=cls101.id, day_of_week=1, start_slot=2, slot_count=3, session_type=SessionType.THEORY, delivery_mode=DeliveryMode.FACE_TO_FACE, created_by=admin1.id),
                # CENG101 Sec 1 - Lab: Çarşamba 6-7 (13:30 - 15:15) MB-201
                WeeklyScheduleEntry(id=2, section_id=sec_ceng101_1.id, classroom_id=cls201.id, day_of_week=3, start_slot=6, slot_count=2, session_type=SessionType.LAB, delivery_mode=DeliveryMode.FACE_TO_FACE, created_by=admin1.id),
                # CENG201 Sec 1 - Teori: Salı 2-4 (09:30 - 12:15) MB-101
                WeeklyScheduleEntry(id=3, section_id=sec_ceng201_1.id, classroom_id=cls101.id, day_of_week=2, start_slot=2, slot_count=3, session_type=SessionType.THEORY, delivery_mode=DeliveryMode.FACE_TO_FACE, created_by=admin1.id),
                # EEE101 Sec 1 - Teori: Perşembe 1-4 (08:30 - 12:15) MB-301
                WeeklyScheduleEntry(id=4, section_id=sec_eee101_1.id, classroom_id=cls301.id, day_of_week=4, start_slot=1, slot_count=4, session_type=SessionType.THEORY, delivery_mode=DeliveryMode.FACE_TO_FACE, created_by=admin1.id),
                # IE101 Sec 1 - Teori: Cuma 5-7 (12:30 - 15:15) MB-102
                WeeklyScheduleEntry(id=5, section_id=sec_ie101_1.id, classroom_id=cls102.id, day_of_week=5, start_slot=5, slot_count=3, session_type=SessionType.THEORY, delivery_mode=DeliveryMode.FACE_TO_FACE, created_by=admin1.id),
            ]
            for e in entries:
                db.add(e)
            db.flush()
            print("Haftalık ders programı kayıtları eklendi.")

        # 8. Sınavlar (Exams)
        if db.query(Exam).count() == 0:
            exams = [
                Exam(id=1, course_id=c_ceng101.id, exam_type=ExamType.MIDTERM, exam_date=date(2026, 11, 10), start_time=time_type.fromisoformat("10:00:00"), duration_minutes=90, lecturer_id=lec_ahmet.id, notes="Ortak Vize Sınavı", created_by=admin1.id),
                Exam(id=2, course_id=c_ceng201.id, exam_type=ExamType.MIDTERM, exam_date=date(2026, 11, 11), start_time=time_type.fromisoformat("14:00:00"), duration_minutes=120, lecturer_id=lec_ahmet.id, notes="Vize Sınavı", created_by=admin1.id),
                Exam(id=3, course_id=c_eee101.id, exam_type=ExamType.MIDTERM, exam_date=date(2026, 11, 12), start_time=time_type.fromisoformat("09:00:00"), duration_minutes=90, lecturer_id=lec_zeynep.id, notes="Vize Sınavı", created_by=admin1.id),
            ]
            for ex in exams:
                db.add(ex)
            db.flush()
            # CENG101 sınavını MB-101 ve MB-102 dersliklerine bağla
            ex_ceng = exams[0]
            ex_ceng.classrooms.append(cls101)
            ex_ceng.classrooms.append(cls102)
            # CENG201 MB-101
            exams[1].classrooms.append(cls101)
            # EEE101 MB-301
            exams[2].classrooms.append(cls301)

            print("Sınav programı kayıtları eklendi.")

        db.commit()
        print("\n✅ TÜM SEED DATA VERİLERİ VERİTABANINA BAŞARIYLA YÜKLENDİ!")
    except Exception as e:
        db.rollback()
        print(f"Hata oluştu: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
