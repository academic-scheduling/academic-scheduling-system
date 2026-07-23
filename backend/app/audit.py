"""Audit iz kaydi (K: audit_logs — kim, neyi, ne zaman).

Cagiran endpoint commit'ten ONCE cagirir; kayit ayni transaction'da gider
(islem basarisizsa iz de yazilmaz — yalanci iz kalmaz).

K-36: iz artik islem ANINDAKI insan-okur adi da tasir. Boylece log kendi
kendine yeter — silinen kaydin adi kaybolmaz, degistirilen ad o gunku
haliyle kalir.
"""
from sqlalchemy.orm import Session

from app.models import (
    AuditLog, Building, Classroom, Course, CourseSection, Department,
    Exam, Lecturer, User, WeeklyScheduleEntry,
)


def build_label(nesne) -> str | None:
    """Varliktan insan-okur ad uretir (K-36).

    TEK YER: hem yazma ani (log_action) hem de eski satirlar icin okuma
    anindaki geri dusus (audit_logs router) ayni bicimi kullansin. Ikiye
    ayrilsaydi ayni kayit iki farkli adla gorunebilirdi.

    Silmeden ONCE cagrilir; nesne o an hala yuklu oldugu icin iliskili
    alanlara (course.code gibi) erisilebilir.
    """
    if isinstance(nesne, Department):
        return f"{nesne.code} — {nesne.name}"
    if isinstance(nesne, Building):
        return nesne.name
    if isinstance(nesne, Classroom):
        return f"{nesne.building.name} {nesne.room_code}"
    if isinstance(nesne, Lecturer):
        return nesne.full_name
    if isinstance(nesne, Course):
        return f"{nesne.code} — {nesne.name}"
    if isinstance(nesne, CourseSection):
        return f"{nesne.course.code} Şube {nesne.section_no}"
    if isinstance(nesne, Exam):
        return f"{nesne.course.code} {nesne.exam_type.value}"
    if isinstance(nesne, WeeklyScheduleEntry):
        return f"{nesne.section.course.code} Şube {nesne.section.section_no}"
    if isinstance(nesne, User):
        return nesne.name
    return None


# Alan adlarinin Turkce karsiligi. Burada olmayan alan ozete GIRMEZ:
# "hangi alanlar denetime deger" karari bilincli olsun, sessizce her sey
# dokulmesin (sifre hash'i, normalized_name gibi turetilmis alanlar dahil).
FIELD_LABELS: dict[str, str] = {
    "name": "Ad",
    "full_name": "Ad",
    "code": "Kod",
    "room_code": "Derslik kodu",
    "status": "Durum",
    "role": "Rol",
    "active": "Aktiflik",
    "is_external": "Fakülte dışı",
    "is_elective": "Seçmeli",
    "capacity": "Kapasite",
    "exam_capacity": "Sınav kapasitesi",
    "expected_students": "Beklenen öğrenci",
    "room_type": "Derslik türü",
    "section_no": "Şube no",
    "hours_theory": "Teori saati",
    "hours_practice": "Uygulama saati",
    "hours_lab": "Lab saati",
    "day_of_week": "Gün",
    "start_slot": "Başlangıç slotu",
    "slot_count": "Slot sayısı",
    "session_type": "Oturum türü",
    "delivery_mode": "Yapılış şekli",
    "exam_date": "Tarih",
    "start_time": "Saat",
    "duration_minutes": "Süre (dk)",
    "notes": "Not",
    # K-25 yetenek bayraklari: hangi yetkinin acilip kapandigi denetimin
    # tam da bakmak isteyecegi sey.
    "can_manage_courses": "Ders yetkisi",
    "can_manage_weekly": "Haftalık program yetkisi",
    "can_manage_exams": "Sınav yetkisi",
    "can_manage_classrooms": "Derslik yetkisi",
    "can_manage_lecturers": "Öğretim üyesi yetkisi",
}

# Enum degerlerinin Turkce karsiligi (UI'daki etiketlerle ayni kelimeler).
VALUE_LABELS: dict[str, str] = {
    "ACTIVE": "Aktif", "PENDING": "Davetli", "DISABLED": "Pasif",
    "ADMIN": "Admin", "SUB_ACCOUNT": "Alt hesap",
    "CLASSROOM": "Sınıf", "AMPHI": "Amfi", "LAB": "Laboratuvar",
    "FALL": "Güz", "SPRING": "Bahar", "SUMMER": "Yaz",
    "DRAFT": "Taslak", "SUBMITTED": "Yayınlandı",
    "THEORY": "Teori", "PRACTICE": "Uygulama",
    "FACE_TO_FACE": "Yüz yüze", "ONLINE_SYNC": "Çevrimiçi eşzamanlı",
    "ONLINE_ASYNC": "Çevrimiçi asenkron",
    "MIDTERM": "Vize", "FINAL": "Final", "MAKEUP": "Bütünleme",
}


def _bicimle(deger) -> str:
    """Tek bir degeri okunur metne cevirir."""
    if deger is None:
        return "yok"
    if isinstance(deger, bool):
        return "evet" if deger else "hayır"
    ham = getattr(deger, "value", deger)          # Enum ise .value
    metin = str(ham)
    if metin in VALUE_LABELS:
        return VALUE_LABELS[metin]
    return metin if len(metin) <= 40 else metin[:39] + "…"


def build_change_summary(nesne, data: dict) -> str | None:
    """Degisen alanlari "Alan: eski → yeni" biciminde ozetler (K-38).

    MUTASYONDAN ONCE cagrilmali: eski degerler hala nesnenin uzerinde.

    Yalnizca GERCEKTEN degisen alanlar yazilir — istemci bir alani ayni
    degeriyle gonderdiginde "Ad: X → X" gibi gurultu uretilmez.

    Liste/iliski alanlari (department_ids gibi) bilerek DISARIDA: tek satirlik
    ozete sigmiyorlar ve FIELD_LABELS'ta karsiliklari yok.
    """
    parcalar: list[str] = []
    for alan, yeni in data.items():
        etiket = FIELD_LABELS.get(alan)
        if etiket is None:
            continue
        eski = getattr(nesne, alan, None)
        if eski == yeni:
            continue
        parcalar.append(f"{etiket}: {_bicimle(eski)} → {_bicimle(yeni)}")
    if not parcalar:
        return None
    ozet = " · ".join(parcalar)
    return ozet if len(ozet) <= 300 else ozet[:299] + "…"


def log_action(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    entity_id: int,
    entity=None,
    change_summary: str | None = None,
) -> None:
    """action: CREATE / UPDATE / DELETE / SUBMIT.

    `entity`: islemin uygulandigi ORM nesnesi. Adi buradan uretilir ve
    satira YAZILIR (K-36) — okuma aninda tabloya bakilmaz, cunku o tablo
    o kaydi kaybetmis olabilir.

    Varsayilani None: veren bir cagri yeri unutulursa iz yine yazilir,
    yalnizca adsiz kalir. Iz kaybetmektense adsiz iz iyidir.

    `change_summary`: yalniz UPDATE'te anlamli — NEYIN degistigini soyler
    (K-38). entity_label "hangi kayit", bu alan "ne degisti" sorusunu
    cevaplar; ikisi ayri sutunda durur ki tek metne sikistirilmasin.
    """
    db.add(AuditLog(
        user_id=user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=build_label(entity) if entity is not None else None,
        change_summary=change_summary,
    ))
