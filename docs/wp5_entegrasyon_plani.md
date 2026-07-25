# WP5 Çakışma Motoru — Entegrasyon Planı ve İnceleme

**Tarih:** 22 Temmuz 2026 · **Yazan:** Intern C (motor sahibi)
**Kapsam:** `feature/wp5-engine-v14` motorunun projeye (`conflict_service.py` →
router'lar) bağlanması. **Referanslar:** docs/cakisma_kural_seti_1.md v1.4,
docs/api_kontrat.md §0/§7/§8/§9, docs/karar_defteri_1.md (K-03, K-13..K-26).

> **Kapsam sınırı:** Bu belge C'nin motorunu tarif eder ve A'nın entegrasyonuna
> yol gösterir. Adaptör + endpoint kablolaması **Intern A**'nın işidir (K-22);
> motorun saf-Python kısmı (kurallar + 4 tarama fonksiyonu) hazırdır.

---

## 1. Motorun bugünkü hali (inceleme özeti)

Motor üç katman, hepsi saf Python (FastAPI/DB import etmez):

| Dosya | Sorumluluk |
|---|---|
| `app/conflicts/engine.py` | Kural fonksiyonları (W1-W8, E1-E7, X1-X3) + kesişim matematiği. Her kural `{"rule_id","severity"}` veya `None` döner. |
| `app/conflicts/message.py` | `build_result()` → kontrat §0 `ConflictResult`; `build_message()` insan-okur mesaj. |
| `app/conflicts/orchestrator.py` | **Evren taraması** — 4 giriş noktası (aşağıda). |
| `app/conflicts/slots.py` | Slot ↔ saat tablosu. |

### 1.1 Tarama fonksiyonları (A'nın çağıracağı API)

| Fonksiyon | İmza | Kapsadığı kurallar |
|---|---|---|
| `scan_weekly(entries)` | `list[dict] → list[ConflictResult]` | W1, W2, W5 (çiftli); W6, W7 (tekil); W3/W4 (cohort, `scan_cohort` içeride). Asenkron ön-eleme dahil (K-19). |
| `scan_exams(exams)` | `list[dict] → list[ConflictResult]` | E1-E4 (çiftli); E5, E5a, E6, E7 (tekil). |
| `scan_cross(exams, weeklies, check_exam_vs_course)` | `(list, list, bool) → list` | X1, X2, X3. Bayrak kapalıysa boş; asenkron haftalık ön-elenir (K-19); K-13 aynı-ders atlaması kuralda. |
| `scan_completeness(entries)` | `list[dict] → list[ConflictResult]` | W8 (tamlık). **Asenkron DAHİL** (K-20). Yalnız submit'te çağrılır. |

### 1.2 Çıktı şekli (kontrat §0)

```json
{ "severity": "HARD" | "WARNING",
  "rule_id": "W1" | ... | "X3",
  "message": "Derslik çakışması: CENG2001-1 ve ...",
  "affected": [ { "type": "weekly_entry" | "exam", "id": 42, "course_code": "CENG2001-1" } ] }
```

### 1.3 Test durumu
107 unit test yeşil (pozitif/negatif/sınır/atlama + orkestratör senaryoları).

---

## 2. Entegrasyon dikişi: `conflict_service.py`

Router'lar motoru **yalnızca** bu 4 fonksiyon üzerinden çağırır (bugün stub, `[]` döner):

| Seam fonksiyonu | Çağıran endpoint | An |
|---|---|---|
| `check_weekly_save(db, entry)` | `POST/PATCH /weekly-entries` | Kayıt — asla engellemez (K-03) |
| `check_weekly_submit(db, entries)` | `POST /weekly-entries/submit` | Submit — HARD reddeder |
| `check_exams_save(db, exam)` | `POST/PATCH /exams` | Kayıt |
| `check_exams_submit(db, exams)` | `POST /exams/submit` | Submit |

Router'lar dönen listeyi `severity`'ye göre ayırır (`hard`/`warnings`); HARD varsa
submit 409 ile reddedilir (hep-veya-hiç). **Motor yalnızca çakışmaları bulur;
engelleme kararı router'da.** Entegrasyon SADECE `conflict_service.py`'de yapılır,
router'lara dokunulmaz.

---

## 3. Adaptör: ORM nesnesi → motor dict'i

Motorun kalbi: ORM nesnelerini motorun beklediği düz dict'e çevirmek.

### 3.1 `WeeklyScheduleEntry` → weekly dict

| dict alanı | Kaynak | Not |
|---|---|---|
| `id` | `entry.id` | affected için (satır PK'si) |
| `type` | `"weekly_entry"` | sabit |
| `section_id` | `entry.section_id` | W5, cohort |
| `course_id` | `entry.section.course_id` | cohort/W5 |
| `classroom_id` | `entry.classroom_id` | W1/W7; None olabilir |
| `day_of_week` / `start_slot` / `slot_count` | `entry.*` | zaman |
| `lecturer_id` | `entry.section.lecturer_id` | W2 |
| `department_id` / `year` / `semester` | `entry.section.course.*` | cohort; `semester` **string** (`.value`) |
| `is_elective` | `entry.section.course.is_elective` | W3/W4 severity |
| `expected_students` | `entry.section.expected_students` | W7 |
| `capacity` | `entry.classroom.capacity` (varsa) | W7 |
| `course_code` / `section_no` | `entry.section.course.code` / `entry.section.section_no` | mesaj/affected |
| `session_type` / `delivery_mode` | `entry.*` (`.value`) | W8 / asenkron |
| `hours_theory` / `hours_practice` / `hours_lab` | `entry.section.course.*` | W8 |

### 3.2 `Exam` → exam dict

| dict alanı | Kaynak | Not |
|---|---|---|
| `id` | `exam.id` | affected |
| `type` | `"exam"` | sabit |
| `course_id` | `exam.course_id` | E2/E4/K-13 |
| `exam_type` | `exam.exam_type` (`.value`) | E2 |
| `exam_date` / `start_time` / `duration_minutes` | `exam.*` | zaman (E1/E3/E6) |
| `lecturer_id` | `exam.lecturer_id` | E3 |
| `department_id` / `year` / `semester` / `is_elective` | `exam.course.*` | E4 |
| `expected_students` | `exam.total_expected_students` | **property** (aktif şubelerin toplamı, K-16) |
| `course_code` | `exam.course.code` | mesaj/affected |
| `rooms` | `[{"classroom_id": c.id, "exam_capacity": c.exam_capacity} for c in exam.classrooms]` | E1/E5/E5a/E7 |

> ⚠️ **Exam mesaj tuzağı:** `message.py`'deki `_msg_e1/e3/...` `course_label(exam)`
> çağırıyor; bu `section_no` bekliyor. Sınav ders düzeyinde (K-16), şube yok. İki
> seçenek: (a) adaptör exam dict'ine geçici `section_no` koymaz ve exam mesaj
> builder'ları `course_code`'a çevrilir (temiz), (b) geçici olarak dict'e
> `section_no=1` konur. **(a) önerilir** — açık konu (bkz. §7).

### 3.3 Adaptör kod taslağı (conflict_service.py)

```python
def _weekly_to_dict(e: WeeklyScheduleEntry) -> dict:
    s, c = e.section, e.section.course
    return {
        "id": e.id, "type": "weekly_entry",
        "section_id": e.section_id, "course_id": c.id,
        "classroom_id": e.classroom_id,
        "day_of_week": e.day_of_week, "start_slot": e.start_slot, "slot_count": e.slot_count,
        "lecturer_id": s.lecturer_id,
        "department_id": c.department_id, "year": c.year, "semester": c.semester.value,
        "is_elective": c.is_elective, "expected_students": s.expected_students,
        "capacity": e.classroom.capacity if e.classroom else None,
        "course_code": c.code, "section_no": s.section_no,
        "session_type": e.session_type.value, "delivery_mode": e.delivery_mode.value,
        "hours_theory": c.hours_theory, "hours_practice": c.hours_practice, "hours_lab": c.hours_lab,
    }
```

---

## 4. Karşılaştırma evreni (workgroup izolasyonu)

Her iki anda da aday, workgroup'un **DRAFT + SUBMITTED tüm girişlerine** karşı
test edilir (kural seti; K-26 tümünü okur). Router'lardaki mevcut desen:

```python
def _weekly_universe(db: Session, workgroup_id: int) -> list[WeeklyScheduleEntry]:
    return (
        db.query(WeeklyScheduleEntry)
        .join(CourseSection).join(Course).join(Department)
        .filter(Department.workgroup_id == workgroup_id)
        .options(
            selectinload(WeeklyScheduleEntry.section).selectinload(CourseSection.course),
            selectinload(WeeklyScheduleEntry.classroom),
        ).all()
    )
```
Workgroup: `entry.section.course.department.workgroup_id` (veya `user.workgroup_id`).
Sınav evreni analog: `Exam → course → department → workgroup`, `exam.classrooms` eager.

---

## 5. Her anda ne çalışır

### 5.1 `check_weekly_save(db, entry)` — aday odaklı
1. `wg = entry.section.course.department.workgroup_id`
2. Evren dict'leri = `_weekly_universe(db, wg)` → map (aday zaten içinde, DRAFT kaydedildi).
3. `results = scan_weekly(evren)` **+** (bayrak açıksa) `scan_cross(exam_evreni, evren, flag)`.
4. **Yalnız adayı içerenleri döndür:**
   `[c for c in results if any(a["id"] == entry.id and a["type"]=="weekly_entry" for a in c["affected"])]`
   (Save sadece bu girişin çakışmalarını gösterir; W8 save'de ÜRETİLMEZ — K-20.)

### 5.2 `check_weekly_submit(db, entries)` — küme odaklı
1. Evren dict'leri (yukarıdaki gibi).
2. `results = scan_weekly(evren)` + `scan_completeness(submit_kümesinin_şube_girişleri)` (W8, yalnız burada) + `scan_cross(exam_evreni, evren, flag)`.
3. **Submit kümesinden herhangi birini içerenleri döndür** (id ∈ entry_ids).
4. Router: HARD varsa 409, yoksa WARNING'lerle geçer.

### 5.3 `check_exams_save` / `check_exams_submit`
Simetrik: `scan_exams(sınav_evreni)` (+ submit'te cross: `scan_cross(sınav_evreni, haftalık_evren, flag)`), aday/küme id'sine göre filtrele. Sınavda W8 yok, tamlık yok.

> **Not — cross iki taraftan:** X çakışması hem haftalık submit'te (yeni ders, var
> olan sınavla çakışır) hem sınav submit'te değerlendirilmeli. Her iki seam de
> `scan_cross`'u çağırır; sadece filtrenin "hangi id" tarafı değişir.

---

## 6. `check_exam_vs_course` bayrağı (K-06)

`scan_cross`'un 3. parametresi. Motor DB bilmez; bayrak **workgroup'tan okunup
geçirilir**: `workgroup.check_exam_vs_course` (models.py'de mevcut, `Boolean`).
Adaptör bunu DB'den çeker ve `scan_cross(..., flag)` olarak verir.

---

## 7. Açık konular / dikkat noktaları

1. **Kontrat §0 enum senkronu** — motor `E4a/E4b/E5a` üretiyor; kontrat §0 enum'u
   `"E1" | ... | "E7"` yazıyor, bunları açıkça saymıyor. B'nin UI'ı tanımayabilir.
   → api_kontrat.md'ye `E4a/E4b/E5a` eklenmeli (üç stajyer onayı + karar defteri).
2. **Exam mesajlarında `course_label`/`section_no`** — §3.2'deki tuzak; exam mesaj
   builder'larını `course_code`'a çevirmek en temizi.
3. **Mesajlarda bölüm ADI yok** — `_msg_w3/_msg_e4a` `department_id` (ham sayı)
   yazıyor; kural seti şablonu bölüm adı istiyor. Adaptör dict'e `department_name`
   beslerse mesajlar iyileşir (küçük mesaj + dict değişikliği).
4. **W3/W4 `affected` ince ayar** — kural seti "somut çakışan oturum çiftleri"
   istiyor; motor şu an temsili giriş veriyor. Ertelenebilir.
5. **Aday-odaklı filtrelemenin maliyeti** — evren büyükse `scan_weekly` O(n²).
   MVP ölçeğinde sorun değil; gerekirse aday-vs-evren'e özel bir yardımcı eklenir.

---

## 8. Intern A için adım adım checklist

> **DURUM: TAMAMLANDI** — `feature/wp5-motor-entegrasyon` (24 Temmuz, K-39).
> Aşağıdaki maddelerin hepsi yapıldı; §7'deki açık konulardan 1, 2, 3 ve 4
> kapatıldı (5 — O(n²) maliyeti — bilinen sınırlama olarak K-39'da kayıtlı).
> Uçtan uca doğrulama: `tests/test_wp5_entegrasyon.py` (13 test), tam paket 330 yeşil.

- [ ] `conflict_service.py`: `_weekly_to_dict`, `_exam_to_dict` adaptörleri.
- [ ] `_weekly_universe`, `_exam_universe` sorguları (workgroup izolasyonu + eager).
- [ ] 4 seam fonksiyonunu doldur (§5): stub `[]` yerine gerçek tarama + aday filtresi.
- [ ] `scan_cross`'a `workgroup.check_exam_vs_course` bayrağını geçir.
- [ ] W8 yalnız `check_weekly_submit`'te (`scan_completeness`), save'de değil (K-20).
- [ ] wp3/wp4 testlerindeki monkeypatch senaryolarını gerçek motorla yeşil tut.
- [ ] `GET /conflicts` (kontrat §9): tüm workgroup'u tara → `{hard, warnings}`
      (`scan_weekly` + `scan_exams` + `scan_cross` + `scan_completeness`).

## 9. Entegrasyon test stratejisi
- Adaptör birim testi: bir ORM nesnesi → beklenen dict (alan alan).
- Uçtan uca: seed veriden bilinen çakışma → endpoint 201/409 doğru davranır.
- İzolasyon: başka workgroup'un girişi evrene GİRMEZ.
- Kural seti test şablonundaki senaryolar API üzerinden koşulur (C-6).
```
