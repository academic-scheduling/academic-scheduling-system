# saat ve slot düzlemi için 2 ayrı fonksiyon yazılmıştır. Biri saat aralıklarının çakışıp çakışmadığını kontrol eder, diğeri ise slot aralıklarının çakışıp çakışmadığını kontrol eder. 
# bu dosta asla FastAPI,SQLAlchemy veya veritabanı import etmez.
# a ve b birer dersin gösterimidir.

from app.conflicts.slots import slot_range_to_times


def intervals_overlap(start_a, end_a, start_b, end_b):
    """
    Check if two intervals [start_a, end_a] and [start_b, end_b] overlap.
    """
    return start_a < end_b and start_b < end_a  

def slot_ranges_overlap(start_a, count_a, start_b, count_b):
    """
    Check if two slot ranges overlap.
    """
    end_a = start_a + count_a - 1
    end_b = start_b + count_b - 1
    
    return start_a <= end_b and start_b <= end_a

def weekly_sessions_overlap(a, b):
       return a["day_of_week"] == b["day_of_week"] and slot_ranges_overlap(
           a["start_slot"], a["slot_count"], b["start_slot"], b["slot_count"]
       )


def sections_conflict(sessions_a, sessions_b):
    """İki şubenin oturum listeleri: HERHANGİ bir çift kesişiyorsa True."""
    for sa in sessions_a:
        for sb in sessions_b:
            if weekly_sessions_overlap(sa, sb):
                return True
    return False


def first_overlapping_sessions(sections_a, sections_b):
    """Çakışmayı KANITLAYAN somut oturum çiftini bulur (kural seti §A notu).

    W3/W4 ders (kod) düzeyinde üretilir ama `affected` temsili bir giriş yerine
    gerçekten kesişen iki oturumu taşımalı ki B raporda "hangi oturumlar"
    gösterebilsin. courses_conflict() True dönmüşse böyle bir çift mutlaka
    vardır; yine de bulunamazsa None döner (çağıran tarafta yedek var).
    """
    for sa_sessions in sections_a:
        for sb_sessions in sections_b:
            for sa in sa_sessions:
                for sb in sb_sessions:
                    if weekly_sessions_overlap(sa, sb):
                        return sa, sb
    return None
  

def w1_classroom_conflict(a, b):
    # 1) Atlama koşulu [K-10]: taraflardan biri online ise (derslik yok) kontrol anlamsız
    if a["classroom_id"] is None or b["classroom_id"] is None:
        return None

    # 2) Aynı dersliği mi kullanıyorlar VE zamanları kesişiyor mu?
    if a["classroom_id"] == b["classroom_id"] and weekly_sessions_overlap(a, b):
        return {"rule_id": "W1", "severity": "HARD"}

    # 3) Yukarıdaki tutmadıysa çakışma yok
    return None

def w2_lecturer_conflict(a, b):
    # 1) Aynı öğretim üyesi mi? VE zamanları kesişiyor mu?
    if a["lecturer_id"] == b["lecturer_id"] and weekly_sessions_overlap(a, b):
        return {"rule_id": "W2", "severity": "HARD"}

    # 2) Yukarıdaki tutmadıysa çakışma yok
    return None


def w5_duplicate_session(a, b):
    # 1) Aynı ders mi? VE aynı gün ve slotlarda mı?
    if (
        a["section_id"] == b["section_id"]
        and weekly_sessions_overlap(a, b)  
    ):
        return {"rule_id": "W5", "severity": "WARNING"}

    # 2) Yukarıdaki tutmadıysa çakışma yok
    return None


def w6_out_of_window(a):
    # tekil kural: tek oturumun zaman penceresini kontrol eder
    last_slot = a["start_slot"] + a["slot_count"] - 1
    # gün Pzt-Cuma dışında VEYA son slot 9'u aşıyorsa pencere dışı
    if a["day_of_week"] < 1 or a["day_of_week"] > 5 or last_slot > 9:
        return {"rule_id": "W6", "severity": "HARD"}
    return None


def w7_capacity(a):
    # tekil kural: tek oturumun derslik kapasitesini kontrol eder
    # atlama: online ders (derslik yok) → karşılaştıracak kapasite yok
    if a["classroom_id"] is None:
        return None
    # beklenen öğrenci sayısı kapasiteyi aşıyorsa uyarı
    if a["expected_students"] > a["capacity"]:
        return {"rule_id": "W7", "severity": "WARNING"}
    return None
  

def courses_conflict(sections_a, sections_b):
    """İki dersin şubeleri: EN AZ BİR uyumlu (kesişmeyen) şube çifti varsa
    çakışma YOK (False). Hiç uyumlu çift yoksa çakışma VAR (True) [K-15]."""
    for sa_sessions in sections_a:
        for sb_sessions in sections_b:
            if not sections_conflict(sa_sessions, sb_sessions):
                return False      # uyumlu kombinasyon bulundu -> ogrenci secebilir
    return True                   # hic uyumlu cift yok -> ders cakismasi

def is_async(entry):
    """K-19: ONLINE_ASYNC giris cakisma karsilastirmalarina girmez."""
    return entry.get("delivery_mode") == "ONLINE_ASYNC"  
#----------------------------------------exam collision tests-------------------------------------------------------------------

def minutes_since_midnight(t):
    # bir time nesnesini gece yarısından itibaren toplam dakikaya çevirir
    return t.hour * 60 + t.minute


def exam_sessions_overlap(a, b):
    # farklı tarihlerdeki sınavlar asla çakışmaz
    if a["exam_date"] != b["exam_date"]:
        return False
    # aynı tarih: başlangıç ve bitişleri dakikaya çevirip kesişimi kontrol et
    start_a = minutes_since_midnight(a["start_time"])
    end_a = start_a + a["duration_minutes"]
    start_b = minutes_since_midnight(b["start_time"])
    end_b = start_b + b["duration_minutes"]
    return intervals_overlap(start_a, end_a, start_b, end_b)


def _room_ids(exam):
    # sınavın dersliklerini bir set olarak döndürür
    return {room["classroom_id"] for room in exam["rooms"]}


def e1_exam_classroom_conflict(a, b):
    # 1) Ortak derslik var mı? VE zamanları kesişiyor mu?
    shared_rooms = _room_ids(a) & _room_ids(b)
    # ortak derslik VAR ve saatleri kesişiyorsa → HARD
    if shared_rooms and exam_sessions_overlap(a, b):
        return {"rule_id": "E1", "severity": "HARD"}
    return None


def e2_duplicate_exam(a, b):
    # 1) Aynı ders mi? 
    if a["course_id"] == b["course_id"] and a["exam_type"] == b["exam_type"]:
        return {"rule_id": "E2", "severity": "HARD"}
    return None


def e3_exam_lecturer_conflict(a, b):
    # 1) Aynı öğretim üyesi mi? VE zamanları kesişiyor mu?
    if a["lecturer_id"] == b["lecturer_id"] and exam_sessions_overlap(a, b):
        return {"rule_id": "E3", "severity": "HARD"}
    return None


def e4_exam_cohort_conflict(a, b):
    # 1) Aynı öğrenci grubu mu? VE zamanları kesişiyor mu?
    if a["course_id"] == b["course_id"]:
        return None  
    
    same_cohort = (
       a["department_id"] == b["department_id"]
       and a["year"] == b["year"]
       and a["semester"] == b["semester"]
    )

    if same_cohort and exam_sessions_overlap(a, b): 
        if not a["is_elective"] and not b["is_elective"]:
            return {"rule_id": "E4a", "severity": "HARD"}
        else:
            return {"rule_id": "E4b", "severity": "WARNING"}
        

def e5_exam_capacity(a):
    # tekil kural: tek sınavın derslik kapasitesini kontrol eder
    # atlama: online ders (derslik yok) → karşılaştıracak kapasite yok
    if not a["rooms"]:
         return None
    if any(room["exam_capacity"] is None for room in a["rooms"]):
        return None      # NULL'lu derslik varken E5 hesaplanmaz (once E5a)  
    # beklenen öğrenci sayısı toplam kapasiteyi aşıyorsa uyarı
    total_capacity = sum(room["exam_capacity"] for room in a["rooms"])   # capacity -> exam_capacity
    if a["expected_students"] > total_capacity:
        return {"rule_id": "E5", "severity": "WARNING"}
    return None


def e5a_missing_exam_capacity(a):
    """K-21: secili dersliklerden birinin exam_capacity'si NULL -> WARNING."""
    if not a["rooms"]:
        return None
    if any(room["exam_capacity"] is None for room in a["rooms"]):
        return {"rule_id": "E5a", "severity": "WARNING"}
    return None


def e6_exam_out_of_window(a):
    # hafta sonu sınavları  → HARD
    if a["exam_date"].weekday() >= 5:
        return {"rule_id": "E6", "severity": "HARD"}
      

def e7_excess_capacity(a, margin=0):
    """K-17: en kucuk exam_capacity'li derslik cikarilinca kalan hala
    yetiyorsa israf -> WARNING. margin: hoca onayi bekleyen esik (varsayilan 0)."""
    rooms = a["rooms"]
    if len(rooms) <= 1:                                        # cikarilacak fazlalik yok
        return None
    if any(room["exam_capacity"] is None for room in rooms):  # NULL varsa once E5a
        return None
    total = sum(room["exam_capacity"] for room in rooms)
    smallest = min(room["exam_capacity"] for room in rooms)
    if total - smallest >= a["expected_students"] + margin:
        return {"rule_id": "E7", "severity": "WARNING"}
    return None


def exam_weekly_overlap(exam, weekly):
    # K-06: X kurallari sinav TIPINE degil, check_exam_vs_course BAYRAGINA baglidir.
    # Bayrak orkestratorde uygulanir; bu fonksiyon yalnizca gun+saat kesisimini hesaplar
    exam_day = exam["exam_date"].weekday() + 1
    if exam_day != weekly["day_of_week"]:
        return False  # farklı günlerdeyse çakışamaz
    
    # haftalık dersin slotlarını gerçek saate çevir, sonra dakikaya
    w_start, w_end = slot_range_to_times(weekly["start_slot"], weekly["slot_count"])
    w_start_m = minutes_since_midnight(w_start)
    w_end_m = minutes_since_midnight(w_end)

    # sınavın saat aralığını dakikaya çevir
    exam_start = minutes_since_midnight(exam["start_time"])
    exam_end = exam_start + exam["duration_minutes"]

    # aynı gün, gerçek saat düzleminde kesişiyorlar mı?
    return intervals_overlap(exam_start, exam_end, w_start_m, w_end_m)


def x1_exam_weekly_classroom_conflict(exam, weekly):
    if weekly["classroom_id"] is None:
        return None
    # K-13: sinavin dersi ile haftalik dersin dersi ayniysa -> ATLA (hicbir sey uretme)
    if exam["course_id"] == weekly["course_id"]:
        return None
    # farkli ders + ortak derslik + zaman kesisimi -> gercek derslik isgali
    if weekly["classroom_id"] in _room_ids(exam) and exam_weekly_overlap(exam, weekly):
        return {"rule_id": "X1", "severity": "HARD"}
    return None


def x2_exam_weekly_course_conflict(exam, weekly):
    # midterm , aynı cohortun derslerinden biriyle çakışıyor -> WARNING
    if exam["course_id"] == weekly["course_id"]:
        return None  # aynı dersin sınavı kendi dersiyle çakışıyorsa → X1
    
    same_cohort = (
       exam["department_id"] == weekly["department_id"]
       and exam["year"] == weekly["year"]
       and exam["semester"] == weekly["semester"]
    )  

    if same_cohort and exam_weekly_overlap(exam, weekly):
        return {"rule_id": "X2", "severity": "WARNING"}
    
    return None


def x3_exam_weekly_lecturer_conflict(exam, weekly):
    # midterm, sınav sorumlusunun dersiyle çakışıyor -> WARNING
    if exam["course_id"] == weekly["course_id"]:
        return None  # aynı dersin sınavı kendi dersiyle çakışıyorsa → X1

    if exam["lecturer_id"] == weekly["lecturer_id"] and exam_weekly_overlap(exam, weekly):
        return {"rule_id": "X3", "severity": "WARNING"}
    return None