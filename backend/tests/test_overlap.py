
from datetime import date
from datetime import time
from app.conflicts.engine import w1_classroom_conflict
from app.conflicts.engine import intervals_overlap
from app.conflicts.slots import slot_range_to_times
from app.conflicts.engine import w2_lecturer_conflict 
from app.conflicts.engine import w5_duplicate_session
from app.conflicts.engine import w6_out_of_window
from app.conflicts.engine import w7_capacity
from app.conflicts.engine import w9_missing_classroom
from app.conflicts.engine import e8_missing_classroom
from app.conflicts.engine import e1_exam_classroom_conflict
from app.conflicts.engine import e2_duplicate_exam
from app.conflicts.engine import e3_exam_lecturer_conflict
from app.conflicts.engine import e4_exam_cohort_conflict
from app.conflicts.engine import e5_exam_capacity
from app.conflicts.engine import e6_exam_out_of_window
from app.conflicts.engine import x1_exam_weekly_classroom_conflict
from app.conflicts.engine import x2_exam_weekly_course_conflict
from app.conflicts.engine import x3_exam_weekly_lecturer_conflict
from app.conflicts.message import build_message, build_result
from app.conflicts.orchestrator import scan_weekly
from app.conflicts.engine import sections_conflict
from app.conflicts.engine import courses_conflict
from app.conflicts.orchestrator import scan_cohort
from app.conflicts.engine import is_async
from app.conflicts.engine import e5a_missing_exam_capacity
from app.conflicts.engine import e7_excess_capacity
from app.conflicts.orchestrator import scan_completeness
from app.conflicts.orchestrator import scan_exams
from app.conflicts.orchestrator import scan_cross
from app.conflicts.engine import effective_cohorts, shared_cohort




def base_session():
    # tüm kurallarda kullanılacak geçerli bir temel oturum üretir
    return {
        "course_id": 1, "classroom_id": 10, "day_of_week": 1,
        "start_slot": 3, "slot_count": 2, "lecturer_id": 5,
        "department_id": 2, "year": 2, "semester": "FALL",
        "is_elective": False, "expected_students": 40, "capacity": 30, 
        "course_code": "CENG2001",'section_no': 1 ,"id": 1, 
        "type": "weekly_entry", "section_id": 100, "delivery_mode": "FACE_TO_FACE","session_type": "THEORY", "hours_theory": 3, "hours_practice": 0, "hours_lab": 0,
    }


def test_build_result_shape():
    a = base_session(); a["id"] = 10
    b = base_session(); b["id"] = 11; b["course_code"] = "MATH1001"
    hit = w1_classroom_conflict(a, b)          # {rule_id, severity}
    result = build_result(hit["rule_id"], hit["severity"], a, b)
    assert result["severity"] == "HARD"
    assert result["rule_id"] == "W1"
    assert "Derslik çakışması" in result["message"]
    # affected artık bölüm/sınıf da taşır (rapor + Bölümler sayacı süzmesi için).
    assert result["affected"] == [
        {"type": "weekly_entry", "id": 10, "course_code": "CENG2001-1",
         "department_id": 2, "year": 2},
        {"type": "weekly_entry", "id": 11, "course_code": "MATH1001-1",
         "department_id": 2, "year": 2},
    ]
  

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


def test_sections_conflict_overlap():
    # iki subenin birer oturumu ayni gun+slotta -> True
    assert sections_conflict([base_session()], [base_session()]) is True


def test_sections_conflict_no_overlap():
    b = base_session(); b["day_of_week"] = 3        # farkli gun
    assert sections_conflict([base_session()], [b]) is False


def test_sections_conflict_multi_session():
    # A'nin iki oturumu var; sadece ikincisi B ile kesisiyor -> yine True
    a1 = base_session(); a1["day_of_week"] = 1
    a2 = base_session(); a2["day_of_week"] = 2
    b  = base_session(); b["day_of_week"]  = 2       # a2 ile kesisir
    assert sections_conflict([a1, a2], [b]) is True   


def test_w5_duplicate_session():
    # aynı şube (aynı section_id), aynı gün, kesişen slot → WARNING (W5)
    a = base_session()
    b = base_session()          # section_id ikisinde de 100 → aynı şube
    result = w5_duplicate_session(a, b)
    assert result is not None
    assert result["rule_id"] == "W5"
    assert result["severity"] == "WARNING"

  
def test_scan_cohort_same_course_no_conflict():
    # ayni ders (course_id=1) cohort'ta tek basina -> ders cifti yok -> W3/W4 YOK
    a = base_session(); a["id"] = 1; a["course_id"] = 1; a["section_id"] = 100
    b = base_session(); b["id"] = 2; b["course_id"] = 1; b["section_id"] = 101
    assert scan_cohort([a, b]) == []
  

def test_w5_different_course_no_conflict():
    # farklı ders → çakışma yok
    a = base_session()
    b = base_session()
    b["course_id"] = 2          # farklı ders
    result = w5_duplicate_session(a, b)
    assert result is None

def test_w5_same_course_different_section_no_conflict():
    # ayni ders (course_id=1) ama FARKLI sube -> subeler alternatif -> W5 YOK
    a = base_session()
    b = base_session(); b["section_id"] = 200
    assert w5_duplicate_session(a, b) is None


def test_w5_touching_slots_no_conflict():
    # aynı ders ama slotlar uç uca → çakışma yok
    a = base_session()
    b = base_session()
    b["start_slot"] = 5         # a: 3-4, b: 5 → değmiyor
    result = w5_duplicate_session(a, b)
    assert result is None


def test_w5_different_course_no_conflict():
    a = base_session()
    b = base_session()
    b["course_id"] = 2
    b["section_id"] = 200     # farkli ders -> farkli sube (yeni satir)
    assert w5_duplicate_session(a, b) is None


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


def test_w8_incomplete_theory():
    # 3+0+0 ders, teori 2 slot -> eksik -> W8
    e = base_session()
    e["session_type"] = "THEORY"; e["slot_count"] = 2
    e["hours_theory"] = 3; e["hours_practice"] = 0; e["hours_lab"] = 0
    assert any(r["rule_id"] == "W8" for r in scan_completeness([e]))

def test_w8_complete_no_warning():
    # 3+0+0, teori 3 slot -> tam; lab yok (L=0) -> sessiz -> W8 YOK
    e = base_session()
    e["session_type"] = "THEORY"; e["slot_count"] = 3
    e["hours_theory"] = 3; e["hours_practice"] = 0; e["hours_lab"] = 0
    assert scan_completeness([e]) == []

def test_w8_excess_theory():
    # 3+0+0, teori 4 slot -> fazla -> W8
    e = base_session()
    e["session_type"] = "THEORY"; e["slot_count"] = 4
    e["hours_theory"] = 3; e["hours_practice"] = 0; e["hours_lab"] = 0
    assert any(r["rule_id"] == "W8" for r in scan_completeness([e]))

def test_w8_async_counted():
    # 2 slot yuz yuze + 1 slot asenkron THEORY = 3 -> tam -> W8 YOK (asenkron dahil, K-20)
    e1 = base_session(); e1["section_id"] = 100
    e1["session_type"] = "THEORY"; e1["slot_count"] = 2
    e1["hours_theory"] = 3; e1["hours_practice"] = 0; e1["hours_lab"] = 0
    e2 = base_session(); e2["section_id"] = 100
    e2["session_type"] = "THEORY"; e2["slot_count"] = 1; e2["delivery_mode"] = "ONLINE_ASYNC"
    e2["hours_theory"] = 3; e2["hours_practice"] = 0; e2["hours_lab"] = 0
    assert scan_completeness([e1, e2]) == []
  

def test_courses_conflict_all_pairs_overlap():
    # A tek sube (Pzt), B tek sube (Pzt) -> tek cift, cakisik -> cakisma VAR
    a = [[base_session()]]
    b = [[base_session()]]
    assert courses_conflict(a, b) is True

def test_courses_conflict_compatible_combo_exists():
    # A: sube1 Pzt, sube2 Sali ; B: sube1 Pzt, sube2 Sali
    # (A1,B2) uyumlu -> cakisma YOK -> False
    a1 = base_session(); a1["day_of_week"] = 1
    a2 = base_session(); a2["day_of_week"] = 2
    b1 = base_session(); b1["day_of_week"] = 1
    b2 = base_session(); b2["day_of_week"] = 2
    assert courses_conflict([[a1], [a2]], [[b1], [b2]]) is False

def test_courses_conflict_single_section_no_overlap():
    # tek subeli iki ders, farkli gun -> uyumlu -> False
    b = base_session(); b["day_of_week"] = 3
    assert courses_conflict([[base_session()]], [[b]]) is False


def test_scan_weekly_cohort_compatible_combo():
    # section-aware: uyumlu kombinasyon varsa scan_weekly de W3/W4 URETMEZ
    a1 = base_session(); a1["id"]=1; a1["course_id"]=1; a1["section_id"]=100; a1["day_of_week"]=1
    a2 = base_session(); a2["id"]=2; a2["course_id"]=1; a2["section_id"]=101; a2["day_of_week"]=2
    b1 = base_session(); b1["id"]=3; b1["course_id"]=2; b1["section_id"]=200; b1["day_of_week"]=1
    b2 = base_session(); b2["id"]=4; b2["course_id"]=2; b2["section_id"]=201; b2["day_of_week"]=2
    results = scan_weekly([a1, a2, b1, b2])
    assert not any(r["rule_id"] in ("W3", "W4") for r in results)  


def test_is_async_true():
    e = base_session(); e["delivery_mode"] = "ONLINE_ASYNC"
    assert is_async(e) is True

def test_is_async_false_face_to_face():
    assert is_async(base_session()) is False        # base'de FACE_TO_FACE

def test_is_async_false_sync():
    e = base_session(); e["delivery_mode"] = "ONLINE_SYNC"
    assert is_async(e) is False                     # senkron muaf DEGIL

  
def test_scan_weekly_async_skips_pairwise():
    # asenkron giris, ayni derslik+saatteki normal derse ragmen W1/W2/W5 URETMEZ (K-19)
    a = base_session(); a["id"] = 1; a["delivery_mode"] = "ONLINE_ASYNC"
    b = base_session(); b["id"] = 2                      # FACE_TO_FACE
    results = scan_weekly([a, b])
    assert not any(r["rule_id"] in ("W1", "W2", "W5") for r in results)

def test_scan_weekly_async_still_gets_w6():
    # asenkron da olsa pencere disi -> W6 URETILIR (istisna)
    a = base_session(); a["id"] = 1; a["delivery_mode"] = "ONLINE_ASYNC"; a["day_of_week"] = 6
    assert any(r["rule_id"] == "W6" for r in scan_weekly([a]))

def test_scan_weekly_async_skips_cohort():
    # asenkron ders, ayni cohort'taki baska zorunlu derse ragmen W3 URETMEZ
    a = base_session(); a["id"]=1; a["course_id"]=1; a["section_id"]=100; a["delivery_mode"]="ONLINE_ASYNC"
    b = base_session(); b["id"]=2; b["course_id"]=2; b["section_id"]=200
    results = scan_weekly([a, b])
    assert not any(r["rule_id"] in ("W3", "W4") for r in results)
  
#-----------------------------------------exam rules tests-----------------------------------------

def base_exam():
    # tüm sınav kurallarında kullanılacak geçerli bir temel sınav
    return {
        "course_id": 1, "exam_type": "FINAL",
        "rooms": [{"classroom_id": 10, "exam_capacity": 30}],   # <-- artık liste
        "exam_date": date(2026, 6, 15), "start_time": time(10, 0),
        "duration_minutes": 90, "lecturer_id": 5,
        "department_id": 2, "year": 2, "semester": "FALL",
        "is_elective": False, "expected_students": 40, "course_code": "CENG2001",
        "id": 1, "type": "exam",
        # section_no BILEREK YOK: sinav ders duzeyindedir (K-16), subesi olmaz.
        # Eskiden sahte "section_no": 1 vardi ve mesaj katmanindaki gercek hatayi
        # (course_label(exam) -> KeyError) gizliyordu. Adaptor de bu alani
        # uretmez; fixture artik gercek veriyle ayni sekle sahip.
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


def test_e2_different_midterm_index_no_conflict():
    # K-46: aynı ders + aynı tip ama FARKLI sıra (1. vs 2. vize) → mükerrer değil
    a = base_exam(); a["exam_type"] = "MIDTERM"; a["exam_index"] = 1
    b = base_exam(); b["exam_type"] = "MIDTERM"; b["exam_index"] = 2
    assert e2_duplicate_exam(a, b) is None
    # aynı sıra → yine E2
    b["exam_index"] = 1
    assert e2_duplicate_exam(a, b)["rule_id"] == "E2"


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
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 30}]
    result = e5_exam_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E5"
    assert result["severity"] == "WARNING"


def test_e5_within_capacity_ok():
    # beklenen öğrenci sayısı kapasiteyi aşmıyor → çakışma yok
    a = base_exam()
    a["expected_students"] = 20
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 30}]
    assert e5_exam_capacity(a) is None


def test_e5_uses_exam_capacity_not_capacity():
    a = base_exam()
    a["expected_students"] = 40
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 30,        "capacity": 200}]
    # exam_capacity(30) < 40 -> E5 cikar; yanlislikla capacity(200) okunsa E5 CIKMAZDI
    result = e5_exam_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E5"


def test_multiple_rooms_total_capacity():
    # çok sınıflı: toplam kapasiteyi aşan öğrenci sayısı → WARNING
    a = base_exam()
    a["expected_students"] = 100
    a["rooms"] = [
        {"classroom_id": 10, "exam_capacity": 30},
        {"classroom_id": 11, "exam_capacity": 40},
        {"classroom_id": 12, "exam_capacity": 20},
    ]
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

  
def test_e5a_null_exam_capacity_warning():
    a = base_exam()
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": None}]
    result = e5a_missing_exam_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E5a"
    assert result["severity"] == "WARNING"

def test_e5a_all_filled_no_warning():
    a = base_exam()
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 30}]
    assert e5a_missing_exam_capacity(a) is None

def test_e5a_empty_rooms_skipped():
    a = base_exam()
    a["rooms"] = []
    assert e5a_missing_exam_capacity(a) is None

def test_e5_skipped_when_null_capacity():
    # NULL'lu derslik varken E5 hesaplanmaz (once E5a) -> E5 None
    a = base_exam()
    a["expected_students"] = 100
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": None},
                  {"classroom_id": 11, "exam_capacity": 40}]
    assert e5_exam_capacity(a) is None
  

def test_e6_weekend_hard():
    # sınav tarihi hafta sonu  → HARD
    a = base_exam()
    a["exam_date"] = date(2026, 6, 14)  # Cumartesi
    result = e6_exam_out_of_window(a)
    assert result is not None
    assert result["rule_id"] == "E6"
    assert result["severity"] == "HARD"


def test_e7_excess_capacity_warning():
    # 40+40+40=120, expected 60; en kucuk(40) cikinca 80 >= 60+10=70 -> E7 (K-40)
    a = base_exam()
    a["expected_students"] = 60
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 40},
                  {"classroom_id": 11, "exam_capacity": 40},
                  {"classroom_id": 12, "exam_capacity": 40}]
    result = e7_excess_capacity(a)
    assert result is not None
    assert result["rule_id"] == "E7"

def test_e7_margin_suppresses_marginal_waste():
    # 40+40+40=120, expected 75; en kucuk cikinca 80. margin=10 -> 80 >= 85? HAYIR.
    # margin=0 olsaydi (80>=75) E7 verirdi; guvenlik payi bunu bastirir (K-40).
    a = base_exam()
    a["expected_students"] = 75
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 40},
                  {"classroom_id": 11, "exam_capacity": 40},
                  {"classroom_id": 12, "exam_capacity": 40}]
    assert e7_excess_capacity(a) is None

def test_e7_no_excess_all_needed():
    # 40+40=80, expected 75; en kucuk(40) cikinca 40 < 75 -> israf YOK
    a = base_exam()
    a["expected_students"] = 75
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 40},
                  {"classroom_id": 11, "exam_capacity": 40}]
    assert e7_excess_capacity(a) is None

def test_e7_single_room_skipped():
    a = base_exam()
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": 40}]
    assert e7_excess_capacity(a) is None

def test_e7_null_capacity_skipped():
    # NULL varsa once E5a -> E7 susar
    a = base_exam()
    a["rooms"] = [{"classroom_id": 10, "exam_capacity": None},
                  {"classroom_id": 11, "exam_capacity": 40}]
    assert e7_excess_capacity(a) is None


def test_x1_different_course_conflict():
    # farklı dersler, aynı oda, kesişen saat → HARD
    a = base_exam()
    a["exam_type"] = "MIDTERM"      # çapraz kontrol sadece MIDTERM'de çalışır
    b = base_session()
    b["course_id"] = 2             # farklı ders
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is not None
    assert result["rule_id"] == "X1"
    assert result["severity"] == "HARD"


def test_x1_same_course_skipped():
    # K-13: sinav ile haftalik ders ayni derse ait -> ATLA
    a = base_exam()
    a["exam_type"] = "MIDTERM"
    b = base_session()
    b["course_id"] = 1             # ayni ders
    assert x1_exam_weekly_classroom_conflict(a, b) is None  


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


def test_x1_works_for_any_exam_type():
    # K-06: X kurallari sinav tipine bagli DEGIL; FINAL sinavi da X1 uretir
    a = base_exam(); a["exam_type"] = "FINAL"
    b = base_session(); b["course_id"] = 2      # farkli ders (K-13 atlamasin)
    result = x1_exam_weekly_classroom_conflict(a, b)
    assert result is not None
    assert result["rule_id"] == "X1"


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

# ------------------------------------------- mesaj testleri -----------------------------------------------------                  

def test_message_w1():
    a = base_session()
    b = base_session()
    msg = build_message("W1", a, b)
    assert "Derslik çakışması" in msg
    assert "CENG2001-1" in msg          # course_label çalışıyor mu


def test_message_w6_single_arg():
    a = base_session()
    a["day_of_week"] = 6                 # pencere dışı
    msg = build_message("W6", a)         # tekil kural, b vermiyoruz
    assert "Pencere dışı" in msg


def test_message_unknown_rule_fallback():
    a = base_session()
    msg = build_message("ZZ", a)         # tanımsız kural
    assert "ZZ" in msg                   # yedek metin devrede mi


def test_message_w8():
    assert "Ders saati tamlığı" in build_message("W8", base_session())

# ---------- sınav (E) mesaj testleri ----------

def test_message_e1():
    a = base_exam()
    b = base_exam()
    msg = build_message("E1", a, b)
    assert "Sınav çakışması" in msg
    assert "CENG2001" in msg
    assert "CENG2001-1" not in msg                 # K-16: sınavda şube no YOK


def test_message_e2():
    a = base_exam()
    b = base_exam()
    assert "Mükerrer sınav" in build_message("E2", a, b)


def test_message_e3():
    a = base_exam()
    b = base_exam()
    assert "hoca çakışması" in build_message("E3", a, b).lower()


def test_message_e4():
    a = base_exam()
    b = base_exam()
    assert "cohort" in build_message("E4a", a, b).lower()   # E4a ve E4b aynı fonksiyona


def test_message_e5():
    a = base_exam()
    assert "kontenjan" in build_message("E5", a).lower()     # tekil, b yok


def test_message_e6():
    a = base_exam()
    assert "Hafta sonu" in build_message("E6", a)


def test_message_e7():
    assert "Gereksiz derslik" in build_message("E7", base_exam())


# ---------- çapraz (X) mesaj testleri: a=sınav, b=ders ----------

def test_message_x1():
    exam = base_exam()
    weekly = base_session()
    assert "Sınav-ders çakışması" in build_message("X1", exam, weekly)


def test_message_x2():
    exam = base_exam()
    weekly = base_session()
    assert "cohort" in build_message("X2", exam, weekly).lower()


def test_message_x3():
    exam = base_exam()
    weekly = base_session()
    assert "hoca" in build_message("X3", exam, weekly).lower()    

# ----------------------------------------- orchestrator testleri ---------------------------------

def test_scan_weekly_detects_w1():
    a = base_session(); a["id"] = 1
    b = base_session(); b["id"] = 2
    results = scan_weekly([a, b])
    rule_ids = [r["rule_id"] for r in results]
    assert "W1" in rule_ids                       # ayni derslik + gun + slot
    w1 = next(r for r in results if r["rule_id"] == "W1")
    assert {ref["id"] for ref in w1["affected"]} == {1, 2}   # affected iki girisi de gosteriyor


def test_scan_weekly_empty():
    assert scan_weekly([]) == []


def test_scan_weekly_no_conflict():
    a = base_session(); a["id"] = 1; a["expected_students"] = 20
    b = base_session(); b["id"] = 2; b["expected_students"] = 20
    b["day_of_week"] = 3                           # farkli gun -> zaman cakismasi yok
    assert scan_weekly([a, b]) == []


def test_scan_cohort_w3_both_mandatory():
    a = base_session(); a["id"] = 1; a["course_id"] = 1; a["section_id"] = 100
    b = base_session(); b["id"] = 2; b["course_id"] = 2; b["section_id"] = 200
    # ayni cohort (dept2/yil2/FALL), ayni gun+slot, ikisi de zorunlu -> W3
    assert any(r["rule_id"] == "W3" for r in scan_cohort([a, b]))

def test_scan_cohort_w4_one_elective():
    a = base_session(); a["id"] = 1; a["course_id"] = 1; a["section_id"] = 100
    b = base_session(); b["id"] = 2; b["course_id"] = 2; b["section_id"] = 200
    b["is_elective"] = True
    assert any(r["rule_id"] == "W4" for r in scan_cohort([a, b]))

def test_scan_cohort_compatible_combo_no_conflict():
    # Ders A: sube100 Pzt, sube101 Sali ; Ders B: sube200 Pzt, sube201 Sali
    # (A-Sali, B-Pzt) gibi uyumlu kombinasyon var -> W3/W4 YOK [K-15]
    a1 = base_session(); a1["id"]=1; a1["course_id"]=1; a1["section_id"]=100; a1["day_of_week"]=1
    a2 = base_session(); a2["id"]=2; a2["course_id"]=1; a2["section_id"]=101; a2["day_of_week"]=2
    b1 = base_session(); b1["id"]=3; b1["course_id"]=2; b1["section_id"]=200; b1["day_of_week"]=1
    b2 = base_session(); b2["id"]=4; b2["course_id"]=2; b2["section_id"]=201; b2["day_of_week"]=2
    results = scan_cohort([a1, a2, b1, b2])
    assert not any(r["rule_id"] in ("W3", "W4") for r in results)

def test_scan_cohort_different_cohort_no_conflict():
    a = base_session(); a["id"]=1; a["course_id"]=1; a["section_id"]=100
    b = base_session(); b["id"]=2; b["course_id"]=2; b["section_id"]=200; b["year"]=3
    # farkli yil -> farkli cohort -> karsilastirilmaz
    assert scan_cohort([a, b]) == []


def test_scan_exams_detects_e1():
    # iki sinav ayni derslik+tarih+saat, farkli ders -> E1
    a = base_exam(); a["id"] = 1; a["course_id"] = 1
    b = base_exam(); b["id"] = 2; b["course_id"] = 2
    assert any(r["rule_id"] == "E1" for r in scan_exams([a, b]))

def test_scan_exams_empty():
    assert scan_exams([]) == []

def test_scan_exams_single_rule_e6():
    # tek sinav hafta sonunda -> E6
    a = base_exam(); a["id"] = 1; a["exam_date"] = date(2026, 6, 14)   # Pazar
    assert any(r["rule_id"] == "E6" for r in scan_exams([a]))

def test_scan_cross_flag_off_no_results():
    # bayrak kapali -> hicbir X kurali calismaz (K-06)
    exam = base_exam(); exam["course_id"] = 1
    weekly = base_session(); weekly["course_id"] = 2
    assert scan_cross([exam], [weekly], False) == []

def test_scan_cross_detects_x1():
    # bayrak acik, VIZE, farkli ders, ortak oda+zaman -> X1
    exam = base_exam(); exam["course_id"] = 1; exam["exam_type"] = "MIDTERM"
    weekly = base_session(); weekly["course_id"] = 2
    assert any(r["rule_id"] == "X1" for r in scan_cross([exam], [weekly], True))

def test_scan_cross_only_midterms():
    """K-41: final ve butunlemede ders yapilmaz -> X kurallari calismaz.

    Ayni kurgu VIZE'de X1 uretiyor (ustteki test); tek fark sinav turu.
    """
    weekly = base_session(); weekly["course_id"] = 2
    for tur in ("FINAL", "MAKEUP"):
        exam = base_exam(); exam["course_id"] = 1; exam["exam_type"] = tur
        assert scan_cross([exam], [weekly], True) == [], f"{tur} X kurallarina girmemeli"

def test_scan_cross_async_weekly_skipped():
    # asenkron haftalik giris X kurallarina girmez (K-19)
    exam = base_exam(); exam["course_id"] = 1; exam["exam_type"] = "MIDTERM"
    weekly = base_session(); weekly["course_id"] = 2; weekly["delivery_mode"] = "ONLINE_ASYNC"
    assert scan_cross([exam], [weekly], True) == []


# ==================================================================
# K-48: ortak (servis) dersler — çok-cohort'lu çakışma
# ==================================================================

def _cohort(dep_id, dep_name, year, sem="FALL"):
    return {"department_id": dep_id, "department_name": dep_name,
            "year": year, "semester": sem}


def test_effective_cohorts_fallback_single():
    # 'cohorts' anahtarı olmayan (normal) dict -> skaler alanlardan tek eleman.
    a = base_session()                     # department_id=2, year=2, FALL
    cs = effective_cohorts(a)
    assert len(cs) == 1
    assert (cs[0]["department_id"], cs[0]["year"], cs[0]["semester"]) == (2, 2, "FALL")


def test_shared_cohort_intersection():
    a = base_session(); a["cohorts"] = [_cohort(99, "EEE", 2), _cohort(2, "CENG", 2)]
    b = base_session(); b["cohorts"] = [_cohort(2, "CENG", 2)]
    sc = shared_cohort(a, b)
    assert sc is not None and sc["department_id"] == 2      # ortak: CENG-2
    # kesişim yoksa None
    c = base_session(); c["cohorts"] = [_cohort(7, "ME", 3)]
    assert shared_cohort(a, c) is None


def test_scan_cohort_common_course_crosses_into_shared_cohort():
    # Ortak ders X (birincil EEE-2, EK CENG-2), normal ders Y (CENG-2), aynı
    # gün/slot. Paylaşılan CENG-2 cohort'unda W3 doğar. Skaler eşitlik olsaydı
    # (X birincil EEE) çakışma GÖRÜLMEZDİ — K-48'in kanıtı.
    x = base_session(); x["id"] = 1; x["course_id"] = 10; x["section_id"] = 100
    x["department_id"] = 99; x["cohorts"] = [_cohort(99, "EEE", 2), _cohort(2, "CENG", 2)]
    y = base_session(); y["id"] = 2; y["course_id"] = 20; y["section_id"] = 200
    y["department_id"] = 2; y["cohorts"] = [_cohort(2, "CENG", 2)]
    results = scan_cohort([x, y])
    assert len(results) == 1
    assert results[0]["rule_id"] == "W3" and results[0]["severity"] == "HARD"
    assert "CENG" in results[0]["message"]                 # paylaşılan cohort adı
    # affected paylaşılan cohort'un bölümünü taşır (rapor süzmesi için)
    assert any(ref["department_id"] == 2 for ref in results[0]["affected"])


def test_scan_cohort_common_course_unshared_no_conflict():
    # X ortak (EEE-2 + CENG-2), Y yalnız ME-2 -> ortak cohort yok -> W3 YOK.
    x = base_session(); x["id"] = 1; x["course_id"] = 10; x["section_id"] = 100
    x["cohorts"] = [_cohort(99, "EEE", 2), _cohort(2, "CENG", 2)]
    y = base_session(); y["id"] = 2; y["course_id"] = 20; y["section_id"] = 200
    y["cohorts"] = [_cohort(7, "ME", 2)]
    assert scan_cohort([x, y]) == []


def test_scan_cohort_common_pair_two_shared_cohorts_dedup():
    # İki ortak ders iki cohort'u (EEE-2, CENG-2) paylaşıyor, çakışık.
    # Her grupta üretilir ama ders düzeyinde tek W3 kalmalı (tekilleştirme).
    x = base_session(); x["id"] = 1; x["course_id"] = 10; x["section_id"] = 100
    x["cohorts"] = [_cohort(99, "EEE", 2), _cohort(2, "CENG", 2)]
    y = base_session(); y["id"] = 2; y["course_id"] = 20; y["section_id"] = 200
    y["cohorts"] = [_cohort(99, "EEE", 2), _cohort(2, "CENG", 2)]
    results = scan_cohort([x, y])
    assert len(results) == 1 and results[0]["rule_id"] == "W3"


def test_e4_common_exam_shared_cohort_hard():
    # Ortak dersin sınavı (birincil EEE-1, ek CENG-1) ile normal CENG-1 zorunlu
    # dersin sınavı aynı anda -> paylaşılan CENG-1'de E4a HARD.
    a = base_exam(); a["course_id"] = 10; a["year"] = 1; a["department_id"] = 99
    a["cohorts"] = [_cohort(99, "EEE", 1), _cohort(2, "CENG", 1)]
    b = base_exam(); b["course_id"] = 20; b["year"] = 1; b["department_id"] = 2
    b["cohorts"] = [_cohort(2, "CENG", 1)]
    hit = e4_exam_cohort_conflict(a, b)
    assert hit is not None and hit["rule_id"] == "E4a" and hit["severity"] == "HARD"
    assert hit["cohort"]["department_id"] == 2              # paylaşılan CENG-1


def test_e4_common_exam_unshared_no_conflict():
    a = base_exam(); a["course_id"] = 10; a["cohorts"] = [_cohort(99, "EEE", 1)]
    b = base_exam(); b["course_id"] = 20; b["cohorts"] = [_cohort(2, "CENG", 1)]
    assert e4_exam_cohort_conflict(a, b) is None


def test_x2_common_exam_shared_cohort_warning():
    # Ortak dersin vizesi (ek EEE-2 cohort'u), EEE-2 haftalık dersiyle çakışıyor.
    exam = base_exam(); exam["exam_type"] = "MIDTERM"; exam["course_id"] = 10
    exam["cohorts"] = [_cohort(2, "CENG", 2), _cohort(99, "EEE", 2)]
    weekly = base_session(); weekly["course_id"] = 20
    weekly["cohorts"] = [_cohort(99, "EEE", 2)]
    weekly["day_of_week"] = date(2026, 6, 15).isoweekday()  # sınav tarihinin günü
    weekly["start_slot"] = 3; weekly["slot_count"] = 2       # 10:30-12:15, sınav 10:00-11:30
    hit = x2_exam_weekly_course_conflict(exam, weekly)
    assert hit is not None and hit["rule_id"] == "X2"
    assert hit["cohort"]["department_id"] == 99             # paylaşılan EEE-2

# ============================================================
# K-70: eksik derslik uyarilari (W9 / E8)
# ============================================================

def test_w9_face_to_face_missing_classroom_warns():
    # yuz yuze oturum + derslik yok -> W9 WARNING
    a = base_session(); a["classroom_id"] = None
    hit = w9_missing_classroom(a)
    assert hit is not None and hit["rule_id"] == "W9" and hit["severity"] == "WARNING"


def test_w9_face_to_face_with_classroom_silent():
    # yuz yuze + derslik var -> W9 yok
    assert w9_missing_classroom(base_session()) is None


def test_w9_online_missing_classroom_silent():
    # online oturum dersliksizdir, bu bir eksiklik degildir -> W9 yok
    for mode in ("ONLINE_SYNC", "ONLINE_ASYNC"):
        a = base_session(); a["classroom_id"] = None; a["delivery_mode"] = mode
        assert w9_missing_classroom(a) is None, mode


def test_e8_missing_classroom_warns():
    # sinava hic derslik secilmemis -> E8 WARNING
    a = base_exam(); a["rooms"] = []
    hit = e8_missing_classroom(a)
    assert hit is not None and hit["rule_id"] == "E8" and hit["severity"] == "WARNING"


def test_e8_with_classroom_silent():
    assert e8_missing_classroom(base_exam()) is None


def test_scan_weekly_emits_w9():
    # orchestrator kablolamasi: dersliksiz yuz yuze giris tam taramada W9 uretir
    a = base_session(); a["classroom_id"] = None
    results = scan_weekly([a])
    assert any(r["rule_id"] == "W9" for r in results)


def test_scan_exams_emits_e8():
    a = base_exam(); a["rooms"] = []
    results = scan_exams([a])
    assert any(r["rule_id"] == "E8" for r in results)


# ============================================================
# K-70: donemler-arasi (guz/bahar) karsilastirma yapilmaz
# ============================================================

def test_scan_weekly_cross_semester_no_w1():
    # ayni derslik + ayni gun/slot ama FALL vs SPRING -> sahte W1 URETILMEZ
    a = base_session(); a["id"] = 1; a["section_id"] = 100; a["semester"] = "FALL"
    b = base_session(); b["id"] = 2; b["section_id"] = 200; b["course_id"] = 9
    b["semester"] = "SPRING"
    results = scan_weekly([a, b])
    assert not any(r["rule_id"] == "W1" for r in results)


def test_scan_weekly_same_semester_still_w1():
    # kontrol: ayni donemde ayni derslik/saat -> W1 hala uretilir
    a = base_session(); a["id"] = 1; a["section_id"] = 100
    b = base_session(); b["id"] = 2; b["section_id"] = 200; b["course_id"] = 9
    results = scan_weekly([a, b])
    assert any(r["rule_id"] == "W1" for r in results)


def test_scan_exams_no_semester_gate():
    # K-70: sinav-sinav'da DONEM KAPISI YOK. Sinav somut tarih uzerinde calisir;
    # ayni tarih/saat/derslik ise donem etiketi ne olursa olsun E1 uretilir.
    # (Gercek veride ayni takvim gunu tek doneme aittir; bu test kapinin sinav
    # tarafinda uygulanmadigini kanitlar.)
    a = base_exam(); a["id"] = 1; a["semester"] = "FALL"
    b = base_exam(); b["id"] = 2; b["course_id"] = 9; b["semester"] = "SPRING"
    results = scan_exams([a, b])
    assert any(r["rule_id"] == "E1" for r in results)


def test_scan_cross_cross_semester_no_x1():
    # FALL vizesi ile SPRING haftalik dersi ayni derslik/gun/saat -> X1 URETILMEZ
    exam = base_exam(); exam["exam_type"] = "MIDTERM"; exam["semester"] = "FALL"
    weekly = base_session(); weekly["course_id"] = 9; weekly["semester"] = "SPRING"
    weekly["classroom_id"] = 10                             # sinavla ayni derslik
    weekly["day_of_week"] = date(2026, 6, 15).isoweekday()
    weekly["start_slot"] = 3; weekly["slot_count"] = 2
    results = scan_cross([exam], [weekly], check_exam_vs_course=True)
    assert not any(r["rule_id"] == "X1" for r in results)


def test_scan_cross_same_semester_still_x1():
    # kontrol: ayni donemde X1 hala uretilir
    exam = base_exam(); exam["exam_type"] = "MIDTERM"; exam["semester"] = "FALL"
    weekly = base_session(); weekly["course_id"] = 9; weekly["semester"] = "FALL"
    weekly["classroom_id"] = 10
    weekly["day_of_week"] = date(2026, 6, 15).isoweekday()
    weekly["start_slot"] = 3; weekly["slot_count"] = 2
    results = scan_cross([exam], [weekly], check_exam_vs_course=True)
    assert any(r["rule_id"] == "X1" for r in results)
