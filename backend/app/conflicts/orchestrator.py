from app.conflicts.engine import (
    w1_classroom_conflict, w2_lecturer_conflict,
    w5_duplicate_session,
    w6_out_of_window, w7_capacity,
    courses_conflict, is_async,          # is_async eklendi
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