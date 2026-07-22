from app.conflicts.engine import (
    w1_classroom_conflict, w2_lecturer_conflict,
    w5_duplicate_session,
    w6_out_of_window, w7_capacity,
    courses_conflict,
)
from app.conflicts.message import build_result


def scan_weekly(entries):
    results = []
    # 1) TEKIL kurallar: her giris kendi basina (W6 pencere, W7 kapasite)
    for e in entries:
        for rule in (w6_out_of_window, w7_capacity):
            hit = rule(e)
            if hit:
                results.append(build_result(hit["rule_id"], hit["severity"], e))
    # 2) CIFTLI kurallar: her benzersiz (a, b) cifti (i<j)
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            a, b = entries[i], entries[j]
            for rule in (w1_classroom_conflict, w2_lecturer_conflict,
                         w5_duplicate_session):
                hit = rule(a, b)
                if hit:
                    results.append(build_result(hit["rule_id"], hit["severity"], a, b))
    results += scan_cohort(entries)
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