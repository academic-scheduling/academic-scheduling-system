# messages.py — çakışma sonuçları için insan-okur Türkçe açıklamalar
from app.conflicts.slots import slot_range_to_times

DAY_NAMES = {1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma"}


# ---------- ortak etiket yardımcıları ----------

def course_label(session):
    # "CENG2001-1"
    return f"{session['course_code']}-{session['section_no']}"


def weekly_time_label(session):
    # "Pazartesi 10:30-12:15"
    start, end = slot_range_to_times(session["start_slot"], session["slot_count"])
    return f"{DAY_NAMES[session['day_of_week']]} {start.strftime('%H:%M')}-{end.strftime('%H:%M')}"


def exam_time_label(exam):
    # "2026-06-15 10:00-11:30"
    start = exam["start_time"]
    start_m = start.hour * 60 + start.minute
    end_m = start_m + exam["duration_minutes"]
    end_h, end_min = divmod(end_m, 60)
    return f"{exam['exam_date']} {start.strftime('%H:%M')}-{end_h:02d}:{end_min:02d}"


# ---------- haftalık dersler kural mesajları ----------

def _msg_w1(a, b):
    return (f"Derslik çakışması: {course_label(a)} ve {course_label(b)}, "
            f"{weekly_time_label(a)}'te aynı dersliği kullanıyor.")


def _msg_w2(a, b):
    return (f"Hoca çakışması: {course_label(a)} ve {course_label(b)}, "
            f"{weekly_time_label(a)}'te aynı hocaya sahip.")


def _msg_w3(a, b):
    return (f"Öğrenci grubu çakışması: {course_label(a)} ve {course_label(b)}, zorunlu dersleri "
            f"{weekly_time_label(a)}'te aynı öğrenci grubuna sahip.")

def _msg_w4(a, b):
    return (f"Öğrenci grubu çakışması: {course_label(a)} ve {course_label(b)}, dersleri "
            f"{weekly_time_label(a)}'te aynı öğrenci grubuna sahip.")

def _msg_w5(a, b):
    return (f"Tekrarlayan ders çakışması: {course_label(a)} ve {course_label(b)}, "
            f"{weekly_time_label(a)}'te aynı dersi içeriyor.")

def _msg_w6(a, b):
    return (f"Pencere dışı: {course_label(a)} geçerli gün/saat dışında planlanmış "
            f"(gün {a['day_of_week']}, slot {a['start_slot']}, {a['slot_count']} slot).")

def _msg_w7(a, b):
    return (f"Kapasite aşımı: {course_label(a)} beklenen öğrenci sayısı "
            f"({a['expected_students']}) derslik kapasitesini aşıyor.")
     
# ------------------------------------sınav kuralları mesajları --------------------------------------------

def _msg_e1(a, b):
    return (f"Sınav derslik çakışması: {course_label(a)} ve {course_label(b)}, derslerinin sınavları "
            f"{a['exam_date']} tarihinde aynı dersliği kullanıyor.") 

def _msg_e2(a, b): 
    return (f"Mükerrer sınav: {course_label(a)} dersinin "
            f"{a['exam_type']} sınavı zaten tanımlı.")

def _msg_e3(a, b):
    return (f"Sınav hoca çakışması: {course_label(a)} ve {course_label(b)} sınavları, "
            f"{exam_time_label(a)}'te aynı sorumluya sahip.")

def _msg_e4a(a, b):   
    return (f"Cohort sınav çakışması: {a['department_id']}. bölüm {a['year']}. sınıf "
            f"{a['semester']} zorunlu dersleri sınavları {course_label(a)} ve {course_label(b)},  "
            f"{exam_time_label(a)}'te çakışıyor.")

def _msg_e4b(a, b):  
    return (f"Cohort sınav çakışması: {a['department_id']}. bölüm {a['year']}. sınıf "
            f"{a['semester']} sınavları {course_label(a)} ve {course_label(b)}, "
            f"{exam_time_label(a)}'te çakışıyor.")

def _msg_e5(a, b):
    return (f"Sınav kapasite aşımı: {course_label(a)} beklenen öğrenci sayısı "
            f"({a['expected_students']}) toplam derslik kapasitesini aşıyor.")

def _msg_e6(a, b):
    return (f"Hafta sonu sınavı: {course_label(a)} sınavı {a['exam_date']} "
            f"tarihinde hafta sonuna denk geliyor.")

# ---------- çapraz kural mesajları (sınav × ders) ----------

def _msg_x1a(exam, weekly):
    return (f"Sınav-ders derslik çakışması: {course_label(exam)} sınavı ({exam_time_label(exam)}), "
            f"farklı bir dersin ({course_label(weekly)}, {weekly_time_label(weekly)}) "
            f"dersliğini işgal ediyor.")

def _msg_x1b(exam, weekly):
    return (f"Bilgi: {course_label(exam)} sınavı, kendi dersinin saatinde "
            f"({weekly_time_label(weekly)}) yapılıyor.")

def _msg_x2(exam, weekly):
    return (f"Sınav-ders cohort çakışması: {course_label(exam)} sınavı, aynı grubun "
            f"{course_label(weekly)} dersiyle ({weekly_time_label(weekly)}) çakışıyor.")

def _msg_x3(exam, weekly):
    return (f"Sınav-ders hoca çakışması: {course_label(exam)} sınav sorumlusu, "
            f"{course_label(weekly)} dersinde ({weekly_time_label(weekly)}) aynı anda görünüyor.")


    
# ---------- dispatch sözlüğü ----------

MESSAGE_BUILDERS = {
    # haftalık ders kuralları
    "W1": _msg_w1,
    "W2": _msg_w2,
    "W3": _msg_w3,
    "W4": _msg_w4,
    "W5": _msg_w5,
    "W6": _msg_w6,
    "W7": _msg_w7,
    # sınav kuralları
    "E1": _msg_e1,
    "E2": _msg_e2,
    "E3": _msg_e3,
    "E4a": _msg_e4a,
    "E4b": _msg_e4b,
    "E5": _msg_e5,
    "E6": _msg_e6,
    # çapraz (sınav × ders)
    "X1a": _msg_x1a,
    "X1b": _msg_x1b,
    "X2": _msg_x2,
    "X3": _msg_x3,
}


def build_message(rule_id, a, b=None):
    builder = MESSAGE_BUILDERS.get(rule_id)
    if builder is None:
        return f"Çakışma: {rule_id}"
    return builder(a, b)