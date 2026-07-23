# messages.py — çakışma sonuçları için insan-okur Türkçe açıklamalar
from app.conflicts.slots import slot_range_to_times

DAY_NAMES = {1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma"}


# ---------- ortak etiket yardımcıları ----------

def course_label(session):
    # "CENG2001-1" — haftalık oturum: ders kodu + şube no
    return f"{session['course_code']}-{session['section_no']}"


def exam_label(exam):
    """Sınav etiketi: yalnız ders kodu, şube YOK.

    Sınav ders düzeyindedir (K-16) — tüm şubeler aynı sınava girer, dolayısıyla
    şube numarası taşımaz. Sınav mesajlarında course_label() kullanılamaz:
    exam dict'inde `section_no` yoktur, çağrılırsa KeyError verir.
    """
    return exam["course_code"]


def dept_label(obj):
    """Cohort mesajlarında bölüm: adı varsa ad, yoksa id'ye düşer.

    Kural seti şablonu bölüm ADI istiyor ("Bilgisayar Mühendisliği 2. sınıf").
    Adı adaptör besler (department_name); beslenmediği durumda mesaj ham id ile
    de anlaşılır kalsın diye tolere ediyoruz.
    """
    name = obj.get("department_name")
    return name if name else f"{obj['department_id']}. bölüm"


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
    return (f"Cohort çakışması: {dept_label(a)} {a['year']}. sınıf {a['semester']} "
            f"zorunlu dersleri {course_label(a)} ve {course_label(b)}, "
            f"{weekly_time_label(a)}'te çakışıyor.")

def _msg_w4(a, b):
    return (f"Cohort uyarısı: {dept_label(a)} {a['year']}. sınıf {a['semester']} "
            f"dersleri {course_label(a)} ve {course_label(b)} (en az biri seçmeli), "
            f"{weekly_time_label(a)}'te çakışıyor.")

def _msg_w5(a, b):
    return (f"Tekrarlayan ders çakışması: {course_label(a)} ve {course_label(b)}, "
            f"{weekly_time_label(a)}'te aynı dersi içeriyor.")

def _msg_w6(a, b):
    return (f"Pencere dışı: {course_label(a)} geçerli gün/saat dışında planlanmış "
            f"(gün {a['day_of_week']}, slot {a['start_slot']}, {a['slot_count']} slot).")

def _msg_w7(a, b):
    return (f"Kapasite aşımı: {course_label(a)} beklenen öğrenci sayısı "
            f"({a['expected_students']}) derslik kapasitesini aşıyor.")

def _msg_w8(a, b):
    return (f"Ders saati tamlığı: {course_label(a)} şubesinin yerleşen slot toplamı "
            f"dersin T+U+L değeriyle uyuşmuyor (eksik veya fazla).")
     
# ------------------------------------sınav kuralları mesajları --------------------------------------------

def _msg_e1(a, b):
    return (f"Sınav çakışması: {exam_label(a)} ve {exam_label(b)} sınavları, "
            f"{exam_time_label(a)}'te ortak derslik kullanıyor.")

def _msg_e2(a, b):
    return (f"Mükerrer sınav: {exam_label(a)} dersinin "
            f"{a['exam_type']} sınavı zaten tanımlı.")

def _msg_e3(a, b):
    return (f"Sınav hoca çakışması: {exam_label(a)} ve {exam_label(b)} sınavları, "
            f"{exam_time_label(a)}'te aynı sorumluya sahip.")

def _msg_e4a(a, b):
    return (f"Cohort sınav çakışması: {dept_label(a)} {a['year']}. sınıf "
            f"{a['semester']} zorunlu dersleri {exam_label(a)} ve {exam_label(b)} "
            f"sınavları {exam_time_label(a)}'te çakışıyor.")

def _msg_e4b(a, b):
    return (f"Cohort sınav uyarısı: {dept_label(a)} {a['year']}. sınıf "
            f"{a['semester']} sınavları {exam_label(a)} ve {exam_label(b)} "
            f"(en az biri seçmeli), {exam_time_label(a)}'te çakışıyor.")

def _msg_e5(a, b):
    return (f"Sınav kontenjanı yetersiz: {exam_label(a)} sınavına girecek "
            f"{a['expected_students']} öğrenci, seçili dersliklerin toplam sınav "
            f"kontenjanını aşıyor — ek derslik seçin.")


def _msg_e5a(a, b):
    return (f"Sınav kontenjanı girilmemiş: {exam_label(a)} sınavı için seçili "
            f"dersliklerden en az birinin sınav kontenjanı boş; önce derslik "
            f"kaydına kontenjanı girin.")


def _msg_e6(a, b):
    return (f"Hafta sonu sınavı: {exam_label(a)} sınavı {a['exam_date']} "
            f"tarihinde hafta sonuna denk geliyor.")


def _msg_e7(a, b):
    return (f"Gereksiz derslik: {exam_label(a)} sınavı için seçilen dersliklerden "
            f"en küçüğü çıkarılsa da kalan kontenjan {a['expected_students']} "
            f"öğrenciye yetiyor.")

# ---------- çapraz kural mesajları (sınav × ders) ----------

def _msg_x1(exam, weekly):
    return (f"Sınav-ders çakışması: {exam_label(exam)} sınavı ({exam_time_label(exam)}), "
            f"aynı derslikteki {course_label(weekly)} dersiyle "
            f"({weekly_time_label(weekly)}) çakışıyor.")

def _msg_x2(exam, weekly):
    return (f"Sınav-ders cohort uyarısı: {exam_label(exam)} sınavı, aynı grubun "
            f"{course_label(weekly)} dersiyle ({weekly_time_label(weekly)}) çakışıyor.")

def _msg_x3(exam, weekly):
    return (f"Sınav-ders hoca uyarısı: {exam_label(exam)} sınav sorumlusu, "
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
    "W8": _msg_w8,  
    # sınav kuralları
    "E1": _msg_e1,
    "E2": _msg_e2,
    "E3": _msg_e3,
    "E4a": _msg_e4a,
    "E4b": _msg_e4b,
    "E5": _msg_e5,
    "E5a": _msg_e5a,
    "E6": _msg_e6,
    "E7": _msg_e7,
    # çapraz (sınav × ders)
    "X1": _msg_x1,
    "X2": _msg_x2,
    "X3": _msg_x3,
}


def build_message(rule_id, a, b=None):
    builder = MESSAGE_BUILDERS.get(rule_id)
    if builder is None:
        return f"Çakışma: {rule_id}"
    return builder(a, b)

def _affected_ref(obj):
    """ConflictResult.affected içindeki tek öğe (kontrat §0)."""
    if obj.get("type") == "exam":
        code = obj["course_code"]      # sınav ders düzeyinde (K-16) — şube yok
    else:
        code = course_label(obj)       # "CENG2001-1" (kod + şube_no)
    return {"type": obj["type"], "id": obj["id"], "course_code": code}


def build_result(rule_id, severity, a, b=None):
    """Bir kural vuruşunu tam ConflictResult'a çevirir."""
    affected = [_affected_ref(a)]
    if b is not None:                  # tekil kurallar (W6/W7/E5/E6...) tek nesne
        affected.append(_affected_ref(b))
    return {
        "severity": severity,
        "rule_id": rule_id,
        "message": build_message(rule_id, a, b),
        "affected": affected,
    }