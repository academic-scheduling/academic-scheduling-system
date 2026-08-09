"""Cohort sorgu yardimcilari — bolum + yil + donem uclusuyle ders suzme.

Bu modul `app/routers/courses.py`'den CIKARILDI (K-59). Sebep: ayni filtreye
artik `conflict_service` de ihtiyac duyuyor (taslagin kapsadigi dersleri
belirlemek icin) ve bir SERVIS'in bir ROUTER'dan import etmesi bagimliligi ters
cevirir — courses.py bir gun conflict_service'e ihtiyac duydugunda dongu olur.
Notr bir modul iki tarafi da besler.
"""

from sqlalchemy import and_, or_

from app.models import Course, CourseCohort, SemesterType


def cohort_course_filter(
    department_id: int, year: int | None, semester: SemesterType | None
):
    """K-57: cohort üyeliği filtresi = BİRİNCİL ∪ EK cohort.

    Bir cohort görünümünde (Dersler / Haftalık / Sınav — bölüm+yıl+dönem seçili)
    year/semester eşleşmesi hem birincile HEM ek cohort'a uygulanır. Böylece ortak
    (servis) ders, onu TÜKETEN bölümün cohort'undan da gelir — yalnız ilk atandığı
    (birincil) bölümden değil. Eski filtre `Course.department_id == X` idi ve ek
    cohort'la tüketilen ortak dersleri (ENG/MATH/PHYS...) kohortun listesinden
    düşürüyordu (kullanıcı: "8 ders olması gerekirken 2 çıkıyor").

    Course entity'si sorguya JOIN'li olmalı; `extra_cohorts.any(...)` korele EXISTS
    üretir (join'den bağımsız çalışır).

    K-59: bu filtre aynı zamanda **bir taslağın kapsamını** tanımlar — taslak,
    açılırken tam olarak bu derslerin yerleşimlerini kopyalar. Çakışma evreni de
    bu filtreyi ters çevirerek (`~`) "yayının taslak dışında kalan kısmı"nı bulur.
    """
    primary = [Course.department_id == department_id]
    extra = [CourseCohort.department_id == department_id]
    if year is not None:
        primary.append(Course.year == year)
        extra.append(CourseCohort.year == year)
    if semester is not None:
        primary.append(Course.semester == semester)
        extra.append(CourseCohort.semester == semester)
    return or_(and_(*primary), Course.extra_cohorts.any(and_(*extra)))
