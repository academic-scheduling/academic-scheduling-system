from app.conflicts.engine import (
    w1_classroom_conflict, w2_lecturer_conflict,
    w5_duplicate_session,
    w6_out_of_window, w7_capacity,
    courses_conflict, is_async,
    e1_exam_classroom_conflict, e2_duplicate_exam,
    e3_exam_lecturer_conflict, e4_exam_cohort_conflict,
    e5_exam_capacity, e5a_missing_exam_capacity,
    e6_exam_out_of_window, e7_excess_capacity,
    x1_exam_weekly_classroom_conflict, x2_exam_weekly_course_conflict,
    x3_exam_weekly_lecturer_conflict,
)
from app.conflicts.message import build_result


def scan_weekly(entries):
    results = []

    # W6 (pencere): asenkron DAHIL tum girislere uygulanir (K-19 istisnasi)
    for e in entries:
        hit = w6_out_of_window(e)
        if hit:
            results.append(build_result(hit["rule_id"], hit["severity"], e))

    # ON-ELEME (K-19): asenkron girisler diger karsilastirmalara girmez
    active = [e for e in entries if not is_async(e)]

    # W7 (kapasite) tekil: yalniz aktif girisler
    for e in active:
        hit = w7_capacity(e)
        if hit:
            results.append(build_result(hit["rule_id"], hit["severity"], e))

    # Ciftli kurallar (W1, W2, W5): yalniz aktif girisler
    for i in range(len(active)):
        for j in range(i + 1, len(active)):
            a, b = active[i], active[j]
            for rule in (w1_classroom_conflict, w2_lecturer_conflict, w5_duplicate_session):
                hit = rule(a, b)
                if hit:
                    results.append(build_result(hit["rule_id"], hit["severity"], a, b))

    # Cohort (W3/W4): yalniz aktif girisler
    results += scan_cohort(active)

    return results


def scan_exams(exams):
    """Sinav evreni taramasi: tekil (E5/E5a/E6/E7) + ciftli (E1/E2/E3/E4).
    Sinavlarda asenkron yoktur, on-eleme gerekmez."""
    results = []
    # tekil kurallar: her sinav kendi basina
    for e in exams:
        for rule in (e5_exam_capacity, e5a_missing_exam_capacity,
                     e6_exam_out_of_window, e7_excess_capacity):
            hit = rule(e)
            if hit:
                results.append(build_result(hit["rule_id"], hit["severity"], e))
    # ciftli kurallar: her benzersiz sinav cifti (i<j)
    for i in range(len(exams)):
        for j in range(i + 1, len(exams)):
            a, b = exams[i], exams[j]
            for rule in (e1_exam_classroom_conflict, e2_duplicate_exam,
                         e3_exam_lecturer_conflict, e4_exam_cohort_conflict):
                hit = rule(a, b)
                if hit:
                    results.append(build_result(hit["rule_id"], hit["severity"], a, b))
    return results


def scan_cross(exams, weeklies, check_exam_vs_course):
    """Capraz tarama: her sinav x her haftalik ders icin X1/X2/X3.
    K-06: bayrak kapaliysa hic calismaz.
    K-19: asenkron haftalik girisler on-elenir.
    K-13 (ayni ders atlamasi) kural fonksiyonlarinda."""
    results = []
    if not check_exam_vs_course:          # K-06: bayrak kapali -> X calismaz
        return results
    active_weeklies = [w for w in weeklies if not is_async(w)]   # K-19
    for exam in exams:
        for weekly in active_weeklies:
            for rule in (x1_exam_weekly_classroom_conflict,
                         x2_exam_weekly_course_conflict,
                         x3_exam_weekly_lecturer_conflict):
                hit = rule(exam, weekly)
                if hit:
                    results.append(build_result(hit["rule_id"], hit["severity"], exam, weekly))
    return results  


def scan_cohort(entries):
    results = []

    # Asama 1: cohort'a gore grupla -> (bolum, yil, donem) -> girisler
    cohorts = {}
    for e in entries:
        key = (e["department_id"], e["year"], e["semester"])
        if key not in cohorts:
            cohorts[key] = []
        cohorts[key].append(e)

    # Asama 2 + 3: her cohort'u kendi icinde islet
    for cohort_entries in cohorts.values():
        # ders_id -> {is_elective, rep (temsili giris), sections: {section_id: [oturumlar]}}
        courses = {}
        for e in cohort_entries:
            cid = e["course_id"]
            if cid not in courses:
                courses[cid] = {"is_elective": e["is_elective"], "rep": e, "sections": {}}
            sid = e["section_id"]
            if sid not in courses[cid]["sections"]:
                courses[cid]["sections"][sid] = []
            courses[cid]["sections"][sid].append(e)

        # Asama 3: cohort icindeki her FARKLI ders cifti (i<j)
        cids = list(courses.keys())
        for i in range(len(cids)):
            for j in range(i + 1, len(cids)):
                A = courses[cids[i]]
                B = courses[cids[j]]
                if courses_conflict(list(A["sections"].values()),
                                    list(B["sections"].values())):
                    if not A["is_elective"] and not B["is_elective"]:
                        rule_id, severity = "W3", "HARD"
                    else:
                        rule_id, severity = "W4", "WARNING"
                    results.append(build_result(rule_id, severity, A["rep"], B["rep"]))
    return results


def scan_completeness(entries):
    """W8 (K-20): subenin session_type bazinda yerlesen slot toplami dersin
    T/U/L degerinden farkliysa WARNING. Asenkron oturumlar DAHILDIR.
    Yalniz submit yolundan cagrilir (save'de degil)."""
    results = []
    # section_id -> {rep, hours, placed}
    sections = {}
    for e in entries:
        sid = e["section_id"]
        if sid not in sections:
            sections[sid] = {
                "rep": e,
                "hours": {"THEORY": e["hours_theory"],
                          "PRACTICE": e["hours_practice"],
                          "LAB": e["hours_lab"]},
                "placed": {"THEORY": 0, "PRACTICE": 0, "LAB": 0},
            }
        sections[sid]["placed"][e["session_type"]] += e["slot_count"]

    for sec in sections.values():
        for stype in ("THEORY", "PRACTICE", "LAB"):
            required = sec["hours"][stype]
            placed = sec["placed"][stype]
            if required == 0 and placed == 0:
                continue                    # bilesen yok -> kontrol etme
            if placed != required:
                results.append(build_result("W8", "WARNING", sec["rep"]))
                break                       # sube basina bir W8 yeter
    return results