# API Kontrat Taslağı (v0.2 — 13 Temmuz hoca toplantısı revizyonu, K-14..K-20)

**Amaç:** Frontend/backend'in ayrışmadan önce anlaştığı sözleşme (doküman WP0 + risk maddesi).
**Durum:** Taslak — ekip ilk toplantıda gözden geçirip dondurur. Değişiklik = karar defterine kayıt.
**Genel kurallar:**
- Tüm istekler (login hariç) `Authorization: Bearer <JWT>` başlığı taşır.
- Workgroup izolasyonu token'dan gelir; istemci hiçbir yerde workgroup_id GÖNDERMEZ.
- Tarihler `YYYY-MM-DD`, saatler `HH:MM` (24 saat).
- Hata formatı her yerde aynı: `{ "detail": "insan okur mesaj" }` + uygun HTTP kodu
  (400 doğrulama, 401 kimliksiz, 403 yetkisiz, 404 yok, 409 çakışma/kural ihlali).

---

## 0. Ortak Nesne: ConflictResult (C'nin motoru bunu üretir, B bunu çizer)

```json
{
  "severity": "HARD" | "WARNING",
  "rule_id": "W1" | ... | "W8" | "E1" | ... | "E7" | "X1" | "X2" | "X3",
  "message": "Derslik çakışması: CENG2001-1 ve MATH1001-2 ...",
  "affected": [
    { "type": "weekly_entry" | "exam", "id": 42, "course_code": "CENG2001-1" }
  ]
}
```
Bu şekil kural setindeki (cakisma_kural_seti.md) yapıya birebir bağlıdır.

---

## 1. Auth

### POST /auth/login
İstek: `{ "email": "...", "password": "..." }`
Cevap 200: `{ "access_token": "...", "user": { "id": 1, "name": "...", "role": "ADMIN" | "SUB_ACCOUNT", "can_manage_classrooms": false } }`
Hata 401: geçersiz bilgiler.

### POST /auth/complete-invitation
Davet e-postasındaki linkten gelinir. İstek: `{ "token": "...", "password": "..." }`
Cevap 200: hesap ACTIVE olur → `{ "message": "Hesap aktifleştirildi" }`
Hata 400: token süresi dolmuş / kullanılmış.

---

## 2. Kullanıcılar ve Davet (yalnız ADMIN)

### POST /users/invite
İstek: `{ "name": "...", "email": "...", "role": "SUB_ACCOUNT", "department_ids": [1,2], "can_manage_classrooms": true }`  ← K-02
Cevap 201: `{ "id": 5, "status": "PENDING" }` (e-posta Mailpit'e düşer)
Hata 400: e-posta izinli domainde değil.

### POST /users/{id}/resend-invitation → 200
### GET /users → kullanıcı listesi (bölüm atamalarıyla)

---

## 3. Bölümler (yalnız ADMIN yazabilir)

### GET /departments → `[ { "id", "name", "code" } ]`
### POST /departments — İstek: `{ "name": "...", "code": "CENG" }` → 201
### PATCH /departments/{id} → 200

---

## 4. Hocalar (K-08: yönetilen entity)

### GET /lecturers?search=ay
Autocomplete için. Cevap: `[ { "id": 3, "full_name": "Doç. Dr. Ayşe Kaya", "is_external": false } ]`
`search` normalized_name üzerinde arar.

### POST /lecturers (yalnız ADMIN — 40/a elle ekleme)
İstek: `{ "full_name": "...", "email": null, "is_external": true }` → 201
Hata 409: normalized_name zaten var.

Not: Fakülte sayfasından toplu import bir API endpoint'i DEĞİL, backend'de
çalıştırılan tek seferlik script'tir (`scripts/import_lecturers.py`).

---

## 5. Binalar ve Derslikler (ADMIN veya can_manage_classrooms=true)

### GET /buildings → `[ { "id", "name", "active" } ]`   ← K-18
### POST /buildings — İstek: `{ "name": "Mühendislik Fakültesi" }` → 201 · Hata 409: ad zaten var
### PATCH /buildings/{id} — ad düzeltme / pasife alma

### GET /classrooms → `[ { "id", "building": { "id", "name" }, "room_code", "capacity", "exam_capacity", "active" } ]`
### POST /classrooms — İstek: `{ "building_id": 1, "room_code": "B-201", "capacity": 90, "exam_capacity": 40 }` → 201
  ← capacity zorunlu (K-07); exam_capacity zorunlu ve <= capacity (K-17, boşluklu oturma)
  Hata 400: exam_capacity > capacity.
### PATCH /classrooms/{id} — pasife alma dahil: `{ "active": false }` (silme yok — K-02 soft delete)

---

## 6. Dersler ve Şubeler (K-14; alt hesap: yalnız atanmış bölümleri)

### GET /courses?department_id=&year=&semester=&search=
Cevap (ders + şubeleri iç içe):
```json
[ { "id": 4, "code": "CENG2001", "name": "...", "year": 2, "semester": "SPRING",
    "department_id": 1, "is_elective": false,
    "hours_theory": 3, "hours_practice": 2, "hours_lab": 0,
    "active": true,
    "sections": [
      { "id": 7, "section_no": 1, "lecturer": { "id": 3, "full_name": "..." },
        "expected_students": 55, "default_classroom_id": null, "active": true }
    ] } ]
```

### POST /courses   (ders — kod düzeyi)
İstek: `{ "department_id": 1, "year": 2, "semester": "SPRING", "code": "CENG2001",
  "name": "...", "is_elective": false,
  "hours_theory": 3, "hours_practice": 2, "hours_lab": 0 }`   ← T+U+L (K-20)
Cevap 201 · Hata 409: kod+bölüm+yıl+dönem zaten var.

### PATCH /courses/{id} · pasife alma: `{ "active": false }`

### POST /courses/{id}/sections   (şube)
İstek: `{ "section_no": 2, "lecturer_id": 3, "expected_students": 45,
  "default_classroom_id": null }`   ← aynı hoca birden çok şubeye girebilir (K-14)
Cevap 201 · Hata 409: bu derste bu şube no zaten var.

### PATCH /course-sections/{id} · DELETE /course-sections/{id} (girişi yoksa)

---

## 7. Haftalık Program — save/submit ayrımı (K-03'ün kalbi)

### GET /weekly-entries?department_id=&year=&semester=&classroom_id=&lecturer_id=
Cevap: `[ { "id", "section": { "id", "section_no", "course": {...} },
  "classroom": {...} | null, "day_of_week": 1, "start_slot": 3, "slot_count": 2,
  "session_type": "THEORY" | "PRACTICE" | "LAB",
  "delivery_mode": "FACE_TO_FACE" | "ONLINE_SYNC" | "ONLINE_ASYNC",
  "status": "DRAFT" | "SUBMITTED" } ]`

### POST /weekly-entries   (KAYIT — asla engellemez)
İstek: `{ "section_id": 7, "classroom_id": 2 | null, "day_of_week": 1,
  "start_slot": 3, "slot_count": 2,
  "session_type": "THEORY", "delivery_mode": "FACE_TO_FACE" }`
  ← session_type: bu yerleştirme T/U/L'nin hangisini karşılıyor (K-20)
  ← delivery_mode: ONLINE_ASYNC girişler normal gün/saat taşır ama çakışma
    karşılaştırmalarına girmez (K-19)
Cevap 201: `{ "entry": {...status:"DRAFT"...}, "conflicts": [ConflictResult, ...] }`
→ conflicts DOLU OLSA BİLE kayıt başarılıdır; B bunları bilgi amaçlı gösterir.

### PATCH /weekly-entries/{id}  (yalnız DRAFT girişte çalışır)
Hata 409: giriş SUBMITTED — önce draft'a çevrilmeli.

### POST /weekly-entries/{id}/revert-to-draft → 200 (SUBMITTED → DRAFT)

### POST /weekly-entries/submit   (KAPI BEKÇİSİ)
İstek: `{ "entry_ids": [12, 13, 14] }`
Cevap 200: `{ "submitted": [12,13,14], "warnings": [ConflictResult...] }`
  → WARNING'ler submit'i durdurmaz, görünür kalır.
  → W8 tamlık uyarısı (yerleşen saat ≠ T+U+L) yalnız burada üretilir,
    save'de üretilmez (K-20).
Cevap 409: `{ "detail": "Hard çakışma nedeniyle submit reddedildi",
  "conflicts": [ConflictResult...] }` → hiçbir giriş submit edilmez (hep-veya-hiç).

### DELETE /weekly-entries/{id} (yalnız DRAFT)

---

## 8. Sınavlar — aynı save/submit deseni (K-16: sınav DERS düzeyinde, şubeden bağımsız)

### GET /exams?department_id=&exam_type=&date_from=&date_to=&classroom_id=&year=&semester=&lecturer_id=
Cevap girişleri: `{ "id", "course": { "id", "code", "name" }, "exam_type", "exam_date",
  "start_time", "duration_minutes", "classrooms": [ { "id", "building", "room_code", "exam_capacity" } ],
  "lecturer": {...}, "total_expected_students": 100, "status" }`
  ← total_expected_students = dersin tüm aktif şubelerinin toplamı (K-16)

### POST /exams
İstek: `{ "course_id": 4, "exam_type": "MIDTERM", "exam_date": "2026-11-12",
  "start_time": "18:00", "duration_minutes": 90, "classroom_ids": [2, 5],
  "lecturer_id": 3, "notes": null }`      ← 18:00 GEÇERLİ (K-06: saat kısıtı yok)
  ← course_id artık DERS id'sidir (şube değil); tüm şubeler aynı sınava girer (K-16)
  ← classroom_ids: çoklu derslik (K-17); boş liste = derslik henüz atanmadı
Cevap 201: `{ "exam": {...}, "conflicts": [...] }` · Hata 400: hafta sonu tarihi.
  → conflicts, kontenjan uyarılarını da içerir: toplam exam_capacity yetersiz (E5)
    veya gereksiz fazla derslik (E7) → WARNING (K-17).
### POST /exams/submit — haftalıkla aynı sözleşme
### POST /exams/{id}/revert-to-draft · DELETE /exams/{id} (yalnız DRAFT)

---

## 9. Çakışma Raporu

### GET /conflicts
Tam tarama (doküman §3.6). Cevap: `{ "hard": [ConflictResult...], "warnings": [ConflictResult...] }`
- ADMIN: tüm workgroup (K-04).
- SUB_ACCOUNT: yalnız atanmış bölümleri.

---

## 10. Dashboard

### GET /dashboard/summary
Cevap: `{ "departments": 2, "courses": 24, "classrooms": 5,
  "weekly_entries": 61, "exams": 18, "unresolved_hard": 3, "unresolved_warnings": 7 }`

---

## 11. Export

### GET /export/weekly?format=xlsx&department_id=&year=&semester=
### GET /export/exams?format=xlsx|pdf&exam_type=&date_from=&date_to=
Cevap: dosya indirme (Content-Disposition: attachment).
Format ayrıntıları Hafta 3'te netleşir (K-09) — endpoint imzası şimdiden sabit.

---

## Mock Rehberi (Stajyer B için)

Hafta 1-2'de B, bu kontrattaki cevap şekillerini aynen taklit eden sahte
fonksiyonlar kullanır. Örnek: POST /weekly-entries mock'u, kasıtlı olarak bir
`conflicts` dolu senaryo da içermeli ki çakışma gösterimi UI'da erken test edilsin.
Gerçek API hazır oldukça mock'lar teker teker gerçek adreslere çevrilir.

## Değişiklik Kuralı
Kontrat donduktan sonra herhangi bir alan/endpoint değişikliği:
1) üç stajyerin haberdar olması, 2) bu dosyada güncelleme, 3) karar defterine not.
Sessiz değişiklik = birleşme anında kırılma (dokümanın uyardığı risk).
