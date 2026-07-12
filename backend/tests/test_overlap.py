from asyncio import base_events
from datetime import date
from datetime import time
from email.mime import base
from pickle import FROZENSET
from re import A
from unittest import result
from app.conflicts.engine import w1_classroom_conflict
from app.conflicts.engine import intervals_overlap
from app.conflicts.slots import slot_range_to_times
from app.conflicts.engine import w2_lecturer_conflict
from app.conflicts.engine import w3_w4_cohort_conflict   
from app.conflicts.engine import w5_duplicate_session
from app.conflicts.engine import w6_out_of_window
from app.conflicts.engine import w7_capacity
from app.conflicts.engine import e1_exam_classroom_conflict
from app.conflicts.engine import e2_duplicate_exam
from app.conflicts.engine import e3_exam_lecturer_conflict
from app.conflicts.engine import e4_exam_cohort_conflict
from app.conflicts.engine import e5_exam_capacity
from app.conflicts.engine import e6_exam_out_of_window
from app.conflicts.engine import x1_exam_weekly_classroom_conflict
from app.conflicts.engine import x2_exam_weekly_course_conflict
from app.conflicts.engine import x3_exam_weekly_lecturer_conflict

def base_session():
    # tüm kurallarda kullanılacak geçerli bir temel oturum üretir
    return {
        "course_id": 1, "classroom_id": 10, "day_of_week": 1,
        "start_slot": 3, "slot_count": 2, "lecturer_id": 5,
        "department_id": 2, "year": 2, "semester": "FALL",
        "is_elective": False, "expected_students": 40, "capacity": 30,
    }

def test_intervals_overlap():
    # Test 09:15 biten x 09:15 başlayan --> TEMİZ
    assert intervals_overlap(time(8, 30), time(9, 15), time(9, 15), time(10, 0)) == False  
    assert intervals_overlap(time(9, 30), time(10, 15), time(8, 30), time(10, 15)) == True
    assert intervals_overlap(time(8, 30), time(9, 15), time(9, 30), time(10, 15)) == False  

def test_slot_range_to_times():
    # Test 1: 1 slot
    assert slot_range_to_times(1, 1) == (time(8, 30), time(9, 15))
    
    # Test 2: 2 slots
    assert slot_range_to_times(1, 2) == (time(8, 30), time(10, 15))
    
    # Test 3: Invalid slot number
    try:
        slot_range_to_times(0, 1)
        assert False, "Expected ValueError for invalid start slot"  
    except ValueError:
        pass
    
    try:
        slot_range_to_times(1, 10)
        assert False, "Expected ValueError for invalid end slot"
    except ValueError:
        pass
    
    # Test 4: Start slot greater than end slot
    try:
        slot_range_to_times(3,-1)
        assert False, "Expected ValueError for start slot greater than end slot"
    except ValueError:
        pass

def test_w1_same_classroom_conflict():
    # aynı derslik, aynı gün, kesişen slot → HARD
    a = base_session()
    b = base_session()
    result = w1_classroom_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "W1"


def test_w1_different_classroom_no_conflict():
    # farklı derslik → çakışma yok
    a = base_session()
    b = base_session()
    b["classroom_id"] = 99
    assert w1_classroom_conflict(a, b) is None


def test_w1_null_classroom_skipped():
    # bir taraf online (derslik None) → atlama [K-10] → çakışma yok
    a = base_session()
    b = base_session()
    b["classroom_id"] = None
    assert w1_classroom_conflict(a, b) is None


def test_w1_adjacent_slots_no_conflict():
    # aynı derslik ama slotlar uç uca (a: 3-4, b: 5) → çakışma yok
    a = base_session()
    b = base_session()
    b["start_slot"] = 5
    b["slot_count"] = 1
    assert w1_classroom_conflict(a, b) is None

def test_w2_same_lecturer_conflict():
    a = base_session()
    b = base_session()  
    result = w2_lecturer_conflict(a, b)
    assert result is not None
    assert result['severity'] == "HARD"


def test_w2_different_lecturer_no_conflict():  # farklı hoca → None
    a = base_session()
    b = base_session()
    b["lecturer_id"] = 6  # farklı hoca
    result = w2_lecturer_conflict(a, b)
    assert result is None


def test_w2_different_day_no_conflict():       # farklı gün → None
    a = base_session()
    b = base_session()
    b["day_of_week"] = 2  # farklı gün
    result = w2_lecturer_conflict(a, b)
    assert result is None


def test_w2_adjacent_slots_no_conflict():      # uç uca slot → None
    a = base_session()
    b = base_session()
    b["start_slot"] = 5  # a: 3-4, b: 5-6 → uç uca
    result = w2_lecturer_conflict(a, b)
    assert result is None


def test_w3_both_mandatory_hard():
    # aynı cohort, ikisi de zorunlu, kesişen slot → HARD (W3)
    a = base_session()
    b = base_session()
    b["course_id"] = 2          # farklı ders (yoksa atlama devreye girer)
    result = w3_w4_cohort_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "W3"


def test_w4_one_elective_warning():
    # aynı cohort ama biri seçmeli → WARNING (W4)
    a = base_session()
    b = base_session()
    b["course_id"] = 2
    b["is_elective"] = True     
    result = w3_w4_cohort_conflict(a, b)
    assert result is not None
    assert result["severity"] == "WARNING"
    assert result["rule_id"] == "W4"


def test_cohort_different_cohort_no_conflict():
    # farklı yıl → aynı cohort değil → None
    a = base_session()
    b = base_session()
    b["course_id"] = 2
    b["year"] = 3              
    result = w3_w4_cohort_conflict(a, b)
    assert result is None   
    

def test_cohort_same_course_skipped():
    # aynı course_id → atlama (W5'in işi) → None
    a = base_session()
    b = base_session()          # course_id ikisinde de 1 → aynı ders
    result = w3_w4_cohort_conflict(a, b)
    assert result is None


def test_cohort_adjacent_slots_no_conflict():
    # aynı cohort ama slotlar uç uca → None
    a = base_session()
    b = base_session()
    b["course_id"] = 2
    b["start_slot"] = 5
    b["slot_count"] = 1         # a: 3-4, b: 5 → değmiyor
    result = w3_w4_cohort_conflict(a, b)
    assert result is None


def test_w5_duplicate_session():
    # aynı ders, aynı gün, kesişen slot → WARNING (W5)
    a = base_session()
    b = base_session()          # course_id ikisinde de 1 → aynı ders
    result = w3_w4_cohort_conflict(a, b)
    assert result is None        # W3/W4 atladı
    result = w5_duplicate_session(a, b)
    assert result is not None
    assert result["rule_id"] == "W5"
    assert result["severity"] == "WARNING"


def test_w5_different_course_no_conflict():
    # farklı ders → çakışma yok
    a = base_session()
    b = base_session()
    b["course_id"] = 2          # farklı ders
    result = w5_duplicate_session(a, b)
    assert result is None


def test_w5_touching_slots_no_conflict():
    # aynı ders ama slotlar uç uca → çakışma yok
    a = base_session()
    b = base_session()
    b["start_slot"] = 5         # a: 3-4, b: 5 → değmiyor
    result = w5_duplicate_session(a, b)
    assert result is None


def test_w6_valid_session():
    a = base_session()
    result = w6_out_of_window(a)
    assert result is None  # Pzt-Cuma ve slotlar 1-9 arasında


def test_w6_weekend_hard():
    a = base_session()
    a["day_of_week"] = 6  # Cumartesi
    result = w6_out_of_window(a)
    assert result is not None
    assert result["rule_id"] == "W6"
    assert result["severity"] == "HARD"


def test_w6_last_slot_boundary_ok():
    a = base_session()
    a["start_slot"] = 9
    a["slot_count"] = 1  # son slot 9 → sınırda ama geçerli
    result = w6_out_of_window(a)
    assert result is None


def test_w7_over_capacity_warning():
    a = base_session()
    a["expected_students"] = 40
    a["capacity"] = 30  # kapasiteyi aşan öğrenci sayısı
    result = w7_capacity(a)
    assert result is not None
    assert result["rule_id"] == "W7"
    assert result["severity"] == "WARNING"


def test_w7_within_capacity_ok():
    # beklenen 20 <= kapasite 30 → çakışma yok
    a = base_session()
    a["expected_students"] = 20
    assert w7_capacity(a) is None    


def test_w7_null_classroom_skipped():
    # online ders (derslik None) → kapasite kontrolü atlanır → çakışma yok
    a = base_session()
    a["classroom_id"] = None          # öğrenci sayısı kapasiteyi aşsa bile atlanır
    assert w7_capacity(a) is None

#-----------------------------------------exam rules tests-----------------------------------------

def base_exam():
    # tüm sınav kurallarında kullanılacak geçerli bir temel sınav
    return {
        "course_id": 1, "exam_type": "FINAL",
        "rooms": [{"classroom_id": 10, "capacity": 30}],   # <-- artık liste
        "exam_date": date(2026, 6, 15), "start_time": time(10, 0),
        "duration_minutes": 90, "lecturer_id": 5,
        "department_id": 2, "year": 2, "semester": "FALL",
        "is_elective": False, "expected_students": 40,
    }


def test_e1_same_classroom_conflict():
    # aynı derslik, aynı gün, farklı sınavlar → HARD
    a = base_exam()
    b = base_exam()
    b["exam_id"] = 2  # farklı sınav
    result = e1_exam_classroom_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "E1"


def test_e1_shared_room_among_multiple_conflict():
    # çok sınıflı: a=[10,11], b=[11,12] → 11 ortak → HARD 
    a = base_exam()
    b = base_exam()
    a["rooms"] = [{"classroom_id": 10, "capacity": 30},
                  {"classroom_id": 11, "capacity": 30}]
    b["rooms"] = [{"classroom_id": 11, "capacity": 30},
                  {"classroom_id": 12, "capacity": 30}]
    result = e1_exam_classroom_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"



def test_e1_different_date_no_conflict():
    # aynı derslik ama farklı tarih → çakışma yok
    a = base_exam()
    b = base_exam()
    b["exam_date"] = date(2026, 6, 16)     # bir gün sonrası
    assert e1_exam_classroom_conflict(a, b) is None


def test_e1_adjacent_times_no_conflict():
    # aynı derslik, aynı tarih ama saatler uç uca:
    # a 10:00–11:30 (90 dk), b 11:30 başlıyor → değmiyor → çakışma yok
    a = base_exam()
    b = base_exam()
    b["start_time"] = time(11, 30)
    assert e1_exam_classroom_conflict(a, b) is None


def test_e2_duplicate_exam_conflict():
    # aynı ders, aynı sınav türü
    a = base_exam()
    b = base_exam()
    result = e2_duplicate_exam(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "E2"


def test_e2_different_exam_type_no_conflict():
    # aynı ders ama farklı sınav türü → çakışma yok
    a = base_exam()
    b = base_exam()
    b["exam_type"] = "MIDTERM"
    assert e2_duplicate_exam(a, b) is None


def test_e2_different_course_no_conflict():
    # farklı ders → çakışma yok
    a = base_exam()
    b = base_exam()
    b["course_id"] = 2
    assert e2_duplicate_exam(a, b) is None  


def test_e2_same_course_different_date_conflict():
    # aynı ders, aynı sınav türü ama farklı tarih → çakışma var
    a = base_exam()
    b = base_exam()
    b["exam_date"] = date(2026, 6, 16)
    assert e2_duplicate_exam(a, b) is not None  


def test_e3_same_lecturer_conflict():
    # aynı öğretim üyesi, kesişen saatler → HARD
    a = base_exam()
    b = base_exam()
    result = e3_exam_lecturer_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "E3"


def test_e3_different_lecturer_no_conflict():
    # farklı öğretim üyesi → çakışma yok
    a = base_exam()
    b = base_exam()
    b["lecturer_id"] = 6
    assert e3_exam_lecturer_conflict(a, b) is None


def test_e3_different_date_no_conflict():
    # aynı öğretim üyesi ama farklı tarih → çakışma yok
    a = base_exam()
    b = base_exam()
    b["exam_date"] = date(2026, 6, 16)
    assert e3_exam_lecturer_conflict(a, b) is None


def test_e4_same_cohort_conflict():
    # aynı cohort, kesişen saatler, ikisi de zorunlu → HARD
    a = base_exam()
    b = base_exam()
    b["course_id"] = 2          # farklı ders (yoksa atlama devreye girer)
    result = e4_exam_cohort_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "E4a"


def test_e4_one_elective_warning():
    # aynı cohort, kesişen saatler, biri seçmeli → WARNING
    a = base_exam()
    b = base_exam()
    b["course_id"] = 2          # farklı ders (yoksa atlama devreye girer)
    b["is_elective"] = True     # biri seçmeli
    result = e4_exam_cohort_conflict(a, b)
    assert result is not None
    assert result["severity"] == "WARNING"
    assert result["rule_id"] == "E4b"


def test_e4_different_cohort_no_conflict():
    # farklı cohort → çakışma yok
    a = base_exam()
    b = base_exam()
    b["course_id"] = 2          # farklı ders (yoksa atlama devreye girer)
    b["year"] = 3               # farklı yıl → farklı cohort
    result = e4_exam_cohort_conflict(a, b)
    assert result is None


def test_e4_same_course_skipped():
    # aynı ders → atlama (E2'nin işi) → çakışma yok
    a = base_exam()
    b = base_exam()          # course_id ikisinde de 1 → aynı ders
    result = e4_exam_cohort_conflict(a, b)
    assert result is None


def test_e5_over_capacity_warning():
    # beklenen öğrenci sayısı kapasiteyi aşıyor → WARNING
    a = base_exam()
    a["expected_students"] = 40
    a["rooms"] = [{"classroom_id": 10, "capacity": 30}]
    result = e5_exam_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E5"
    assert result["severity"] == "WARNING"


def test_e5_within_capacity_ok():
    # beklenen öğrenci sayısı kapasiteyi aşmıyor → çakışma yok
    a = base_exam()
    a["expected_students"] = 20
    a["rooms"] = [{"classroom_id": 10, "capacity": 30}]
    assert e5_exam_capacity(a) is None


def test_multiple_rooms_total_capacity():
    # çok sınıflı: toplam kapasiteyi aşan öğrenci sayısı → WARNING
    a = base_exam()
    a["expected_students"] = 100
    a["rooms"] = [
        {"classroom_id": 10, "capacity": 30},
        {"classroom_id": 11, "capacity": 40},
        {"classroom_id": 12, "capacity": 20}
    ]  # toplam kapasite = 90 < 100
    result = e5_exam_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E5"
    assert result["severity"] == "WARNING"


def test_e5_null_classroom_skipped():
    # online sınav (rooms boş) → kapasite kontrolü atlanır → çakışma yok
    a = base_exam()
    a["rooms"] = []  # online sınav
    assert e5_exam_capacity(a) is None


def test_e6_in_of_window_():
    # sınav tarihi hafta içi  → çakışma yok
    a = base_exam()
    result = e6_exam_out_of_window(a)
    assert result is None


def test_e6_weekend_hard():
    # sınav tarihi hafta sonu  → HARD
    a = base_exam()
    a["exam_date"] = date(2026, 6, 14)  # Cumartesi
    result = e6_exam_out_of_window(a)
    assert result is not None
    assert result["rule_id"] == "E6"
    assert result["severity"] == "HARD"


def test_x1_different_course_conflict():
    # farklı dersler, aynı oda, kesişen saat → HARD
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM'de çalışır
    b = base_session()
    b["course_id"] = 2             # farklı ders
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is not None
    assert result["severity"] == "HARD"


def test_x1_same_course_and_exam_no_conflict():
    # aynı dersin sınavı ve dersi → WARNİNG 
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b["course_id"] = 1             # aynı ders
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is not None  
    assert result["severity"] == "WARNING"  


def test_x1_final_exam_no_conflict():
    # final sınavları sadece final sınavlarıyla çakışabilir → çakışma yok
    a = base_exam()
    a["exam_type"] = "FINAL"        # final sınavı
    b = base_session()
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is None


def test_x1_different_classroom_no_conflict():
    # farklı derslik → çakışma yok
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b["classroom_id"] = 99         # farklı derslik
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is None


def test_x1_different_time_no_conflict():
    # aynı derslik, farklı saatler → çakışma yok
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b["start_slot"] = 5             # a: 3-4, b: 5 → değmiyor
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is None


def test_x2_same_cohort_different_course():
    # aynı cohort, farklı dersler, kesişen saatler → X2 
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b["course_id"] = 2             # farklı ders
    result = x2_exam_weekly_course_conflict(a, b)
    assert result is not None
    assert result["severity"] == "WARNING"


def test_x2_different_cohort_no_conflict():
    # farklı cohort → çakışma yok
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b["course_id"] = 2             # farklı ders
    b["year"] = 3                   # farklı yıl → farklı cohort
    result = x2_exam_weekly_course_conflict(a, b)
    assert result is None


def test_x2_same_course_skipped():
    # aynı ders → atlama (X1'in işi) → çakışma yok
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()              # course_id ikisinde de 1 → aynı ders
    result = x2_exam_weekly_course_conflict(a, b)
    assert result is None


def test_x2_final_exam_no_conflict():
    # final sınavları sadece final sınavlarıyla çakışabilir → çakışma yok
    a = base_exam()
    a["exam_type"] = "FINAL"        # final sınavı
    b = base_session()
    result = x2_exam_weekly_course_conflict(a, b)
    assert result is None


def test_x3_same_lecturer_conflict():
    # aynı öğretim üyesi, kesişen saatler → X3 
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b['course_id'] = 2                  # farklı ders
    b['lecturer_id'] = 5                # aynı öğretim üyesi
    result = x3_exam_weekly_lecturer_conflict(a, b)
    assert result is not None
    assert result["severity"] == "WARNING"


def test_x3_different_lecturer_no_conflict():
    # farklı öğretim üyesi → çakışma yok
    a = base_exam()
    a['exam_type'] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()
    b['lecturer_id'] = 6                # farklı öğretim üyesi
    b['course_id'] = 2                  # farklı ders
    result = x3_exam_weekly_lecturer_conflict(a, b)
    assert result is None


def test_x3_same_course_skipped():
    # aynı ders → atlama (X2'nin işi) → çakışma yok
    a = base_exam()
    a['exam_type'] = "MIDTERM"      # çapraz kontrol sadece MIDTERM
    b = base_session()              # course_id ikisinde de 1 → aynı ders
    result = x3_exam_weekly_lecturer_conflict(a, b)
    assert result is None


def test_x3_final_exam_no_conflict():
    # final sınavları sadece final sınavlarıyla çakışabilir → çakışma yok
    a = base_exam()
    a['exam_type'] = "FINAL"        # final sınavı
    b = base_session()
    b['course_id'] = 2                  # farklı ders
    b['lecturer_id'] = 5                # aynı öğretim üyesi
    result = x3_exam_weekly_lecturer_conflict(a, b)
    assert result is None