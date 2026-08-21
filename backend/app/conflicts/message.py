# messages.py — çakışma sonuçları için insan-okur açıklamalar (TR/EN, K-79)
#
# **Dil nereden geliyor (K-79).** `get_lang()` isteğe özgü AMBIENT bir değer
# okur (contextvar); imzalara `lang` parametresi EKLENMEDİ. Sebebi: `build_result`
# orchestrator'da 12 yerden çağrılıyor, parametre geçirmek 5 orchestrator imzası
# + 4 conflict_service girişi + motor sözleşmesi + 71 motor testi demekti.
# İstek bağlamı yokken (motor testleri, betikler) varsayılan "tr" — yani mevcut
# Türkçe çıktı BİREBİR korunur.
from app.conflicts.slots import slot_range_to_times
from app.i18n import get_lang

DAY_NAMES = {1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma"}
DAY_NAMES_EN = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}


def _pick(tr_text: str, en_text: str) -> str:
    """Dile göre iki hazır metinden birini seçer.

    Şablon sözlüğü + parametre sözlüğü yerine bu desen bilinçli: iki dil YAN
    YANA duruyor, bir kuralın çevirisi eksik kalırsa gözle görülür ve her mesaj
    kendi f-string'ini okunur biçimde yazabilir (kuralların parametreleri
    birbirinden çok farklı — ortak şablon sözlüğü hepsini eğip bükerdi).
    """
    return en_text if get_lang() == "en" else tr_text


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
    if name:
        return name          # bölüm ADI veri; çevrilmez (K-79 kapsam dışı)
    return _pick(f"{obj['department_id']}. bölüm", f"department {obj['department_id']}")


def weekly_time_label(session):
    # "Pazartesi 10:30-12:15" / "Monday 10:30-12:15"
    start, end = slot_range_to_times(session["start_slot"], session["slot_count"])
    gunler = DAY_NAMES_EN if get_lang() == "en" else DAY_NAMES
    return f"{gunler[session['day_of_week']]} {start.strftime('%H:%M')}-{end.strftime('%H:%M')}"


def exam_time_label(exam):
    # "2026-06-15 10:00-11:30"
    start = exam["start_time"]
    start_m = start.hour * 60 + start.minute
    end_m = start_m + exam["duration_minutes"]
    end_h, end_min = divmod(end_m, 60)
    return f"{exam['exam_date']} {start.strftime('%H:%M')}-{end_h:02d}:{end_min:02d}"


# ---------- haftalık dersler kural mesajları ----------

def _msg_w1(a, b):
    A, B, T = course_label(a), course_label(b), weekly_time_label(a)
    return _pick(
        f"Derslik çakışması: {A} ve {B}, {T}'te aynı dersliği kullanıyor.",
        f"Classroom conflict: {A} and {B} use the same classroom at {T}.")


def _msg_w2(a, b):
    A, B, T = course_label(a), course_label(b), weekly_time_label(a)
    return _pick(
        f"Hoca çakışması: {A} ve {B}, {T}'te aynı hocaya sahip.",
        f"Lecturer conflict: {A} and {B} have the same lecturer at {T}.")


def _msg_w3(a, b):
    D, Y, S = dept_label(a), a["year"], a["semester"]
    A, B, T = course_label(a), course_label(b), weekly_time_label(a)
    return _pick(
        f"Cohort çakışması: {D} {Y}. sınıf {S} zorunlu dersleri {A} ve {B}, "
        f"{T}'te çakışıyor.",
        f"Cohort conflict: required courses {A} and {B} of {D} year {Y} {S} "
        f"overlap at {T}.")

def _msg_w4(a, b):
    D, Y, S = dept_label(a), a["year"], a["semester"]
    A, B, T = course_label(a), course_label(b), weekly_time_label(a)
    return _pick(
        f"Cohort uyarısı: {D} {Y}. sınıf {S} dersleri {A} ve {B} "
        f"(en az biri seçmeli), {T}'te çakışıyor.",
        f"Cohort warning: courses {A} and {B} of {D} year {Y} {S} "
        f"(at least one elective) overlap at {T}.")

def _msg_w5(a, b):
    A, B, T = course_label(a), course_label(b), weekly_time_label(a)
    return _pick(
        f"Tekrarlayan ders çakışması: {A} ve {B}, {T}'te aynı dersi içeriyor.",
        f"Repeated course conflict: {A} and {B} contain the same course at {T}.")

def _msg_w6(a, b):
    A, G, SL, N = course_label(a), a["day_of_week"], a["start_slot"], a["slot_count"]
    return _pick(
        f"Pencere dışı: {A} geçerli gün/saat dışında planlanmış "
        f"(gün {G}, slot {SL}, {N} slot).",
        f"Outside the window: {A} is scheduled outside valid days/hours "
        f"(day {G}, slot {SL}, {N} slot(s)).")

def _msg_w7(a, b):
    A, N = course_label(a), a["expected_students"]
    return _pick(
        f"Kapasite aşımı: {A} beklenen öğrenci sayısı ({N}) derslik kapasitesini "
        f"aşıyor.",
        f"Capacity exceeded: the expected number of students for {A} ({N}) "
        f"exceeds the classroom capacity.")

def _msg_w8(a, b):
    A = course_label(a)
    return _pick(
        f"Ders saati tamlığı: {A} şubesinin yerleşen slot toplamı dersin T+U+L "
        f"değeriyle uyuşmuyor (eksik veya fazla).",
        f"Course hour completeness: the total placed slots for section {A} do not "
        f"match the course's T+P+L value (too few or too many).")

def _msg_w9(a, b):
    A, T = course_label(a), weekly_time_label(a)
    return _pick(
        f"Derslik girilmemiş: {A} yüz yüze dersine ({T}) derslik atanmamış.",
        f"No classroom assigned: the face-to-face session {A} ({T}) has no "
        f"classroom.")
     
# ------------------------------------sınav kuralları mesajları --------------------------------------------

def _msg_e1(a, b):
    A, B, T = exam_label(a), exam_label(b), exam_time_label(a)
    return _pick(
        f"Sınav çakışması: {A} ve {B} sınavları, {T}'te ortak derslik kullanıyor.",
        f"Exam conflict: the {A} and {B} exams share a classroom at {T}.")

def _msg_e2(a, b):
    A, TIP = exam_label(a), a["exam_type"]
    return _pick(
        f"Mükerrer sınav: {A} dersinin {TIP} sınavı zaten tanımlı.",
        f"Duplicate exam: a {TIP} exam is already defined for {A}.")

def _msg_e3(a, b):
    A, B, T = exam_label(a), exam_label(b), exam_time_label(a)
    return _pick(
        f"Sınav hoca çakışması: {A} ve {B} sınavları, {T}'te aynı sorumluya sahip.",
        f"Exam lecturer conflict: the {A} and {B} exams have the same supervisor "
        f"at {T}.")

def _msg_e4a(a, b):
    D, Y, S = dept_label(a), a["year"], a["semester"]
    A, B, T = exam_label(a), exam_label(b), exam_time_label(a)
    return _pick(
        f"Cohort sınav çakışması: {D} {Y}. sınıf {S} zorunlu dersleri {A} ve {B} "
        f"sınavları {T}'te çakışıyor.",
        f"Cohort exam conflict: the {A} and {B} exams of required courses of "
        f"{D} year {Y} {S} overlap at {T}.")

def _msg_e4b(a, b):
    D, Y, S = dept_label(a), a["year"], a["semester"]
    A, B, T = exam_label(a), exam_label(b), exam_time_label(a)
    return _pick(
        f"Cohort sınav uyarısı: {D} {Y}. sınıf {S} sınavları {A} ve {B} "
        f"(en az biri seçmeli), {T}'te çakışıyor.",
        f"Cohort exam warning: the {A} and {B} exams of {D} year {Y} {S} "
        f"(at least one elective) overlap at {T}.")

def _msg_e5(a, b):
    A, N = exam_label(a), a["expected_students"]
    return _pick(
        f"Sınav kontenjanı yetersiz: {A} sınavına girecek {N} öğrenci, seçili "
        f"dersliklerin toplam sınav kontenjanını aşıyor — ek derslik seçin.",
        f"Insufficient exam capacity: the {N} students taking the {A} exam exceed "
        f"the total exam capacity of the selected classrooms — add a classroom.")


def _msg_e5a(a, b):
    A = exam_label(a)
    return _pick(
        f"Sınav kontenjanı girilmemiş: {A} sınavı için seçili dersliklerden en az "
        f"birinin sınav kontenjanı boş; önce derslik kaydına kontenjanı girin.",
        f"Exam capacity missing: at least one classroom selected for the {A} exam "
        f"has no exam capacity; set it on the classroom record first.")


def _msg_e6(a, b):
    A, TARIH = exam_label(a), a["exam_date"]
    return _pick(
        f"Hafta sonu sınavı: {A} sınavı {TARIH} tarihinde hafta sonuna denk geliyor.",
        f"Weekend exam: the {A} exam falls on a weekend on {TARIH}.")


def _msg_e7(a, b):
    A, N = exam_label(a), a["expected_students"]
    return _pick(
        f"Gereksiz derslik: {A} sınavı için seçilen dersliklerden en küçüğü "
        f"çıkarılsa da kalan kontenjan {N} öğrenciye yetiyor.",
        f"Redundant classroom: even if the smallest classroom selected for the {A} "
        f"exam were removed, the remaining capacity would still fit {N} students.")

def _msg_e8(a, b):
    A = exam_label(a)
    return _pick(
        f"Derslik girilmemiş: {A} sınavına derslik atanmamış — önce bir derslik seçin.",
        f"No classroom assigned: the {A} exam has no classroom — select one first.")

# ---------- çapraz kural mesajları (sınav × ders) ----------

def _msg_x1(exam, weekly):
    X, XT = exam_label(exam), exam_time_label(exam)
    C, CT = course_label(weekly), weekly_time_label(weekly)
    return _pick(
        f"Sınav-ders çakışması: {X} sınavı ({XT}), aynı derslikteki {C} dersiyle "
        f"({CT}) çakışıyor.",
        f"Exam-course conflict: the {X} exam ({XT}) overlaps with the {C} session "
        f"({CT}) in the same classroom.")

def _msg_x2(exam, weekly):
    X, C, CT = exam_label(exam), course_label(weekly), weekly_time_label(weekly)
    return _pick(
        f"Sınav-ders cohort uyarısı: {X} sınavı, aynı grubun {C} dersiyle "
        f"({CT}) çakışıyor.",
        f"Exam-course cohort warning: the {X} exam overlaps with the same cohort's "
        f"{C} session ({CT}).")

def _msg_x3(exam, weekly):
    X, C, CT = exam_label(exam), course_label(weekly), weekly_time_label(weekly)
    return _pick(
        f"Sınav-ders hoca uyarısı: {X} sınav sorumlusu, {C} dersinde ({CT}) "
        f"aynı anda görünüyor.",
        f"Exam-course lecturer warning: the supervisor of the {X} exam is also "
        f"in the {C} session ({CT}) at the same time.")


    
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
    "W9": _msg_w9,
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
    "E8": _msg_e8,
    # çapraz (sınav × ders)
    "X1": _msg_x1,
    "X2": _msg_x2,
    "X3": _msg_x3,
}


def build_message(rule_id, a, b=None):
    builder = MESSAGE_BUILDERS.get(rule_id)
    if builder is None:
        return _pick(f"Çakışma: {rule_id}", f"Conflict: {rule_id}")
    return builder(a, b)

def _affected_ref(obj):
    """ConflictResult.affected içindeki tek öğe (kontrat §0).

    department_id + year taşınır: çakışma raporu ve Bölümler sayacı "bu çakışma
    hangi bölümü/sınıfı etkiliyor" diye süzebilsin. Motor dict'i (hem haftalık
    hem sınav) bu iki alanı zaten üretiyor; burada dışarı veriliyor. Ders koduna
    göre eşleştirme kırılgandır (kod bölümler arası tekrar edebilir) — bu yüzden
    id taşınıyor.
    """
    if obj.get("type") == "exam":
        code = obj["course_code"]      # sınav ders düzeyinde (K-16) — şube yok
    else:
        code = course_label(obj)       # "CENG2001-1" (kod + şube_no)
    return {
        "type": obj["type"],
        "id": obj["id"],
        "course_code": code,
        "department_id": obj.get("department_id"),
        "year": obj.get("year"),
    }


def build_result(rule_id, severity, a, b=None, cohort=None):
    """Bir kural vuruşunu tam ConflictResult'a çevirir.

    cohort (K-48): cohort kurallarında (W3/W4/E4a/E4b/X2) çakışmanın gerçekleştiği
    ORTAK cohort. Ortak (servis) derste `a`'nın birincil cohort'u paylaşılan
    cohort'tan farklı olabilir; mesaj paylaşılan cohort'un bölüm/yıl/dönemini
    yazmalı. Verildiğinde `a`'nın bir kopyasına bu alanlar bindirilir; hiçbir
    mesaj kurucusunun imzası değişmez. Normal derste cohort=None -> eski davranış.
    """
    a_msg = a
    if cohort is not None:
        a_msg = {**a,
                 "department_id": cohort.get("department_id"),
                 "department_name": cohort.get("department_name"),
                 "year": cohort.get("year"),
                 "semester": cohort.get("semester")}
    affected = [_affected_ref(a_msg)]
    if b is not None:                  # tekil kurallar (W6/W7/E5/E6...) tek nesne
        affected.append(_affected_ref(b))
    return {
        "severity": severity,
        "rule_id": rule_id,
        "message": build_message(rule_id, a_msg, b),
        "affected": affected,
    }