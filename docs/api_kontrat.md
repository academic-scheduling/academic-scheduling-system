# API Kontrat Taslağı (v0.2 — 13-14 Temmuz hoca toplantısı revizyonu, K-14..K-24)

**Amaç:** Frontend/backend'in ayrışmadan önce anlaştığı sözleşme (doküman WP0 + risk maddesi).
**Durum:** Taslak — ekip ilk toplantıda gözden geçirip dondurur. Değişiklik = karar defterine kayıt.
**Genel kurallar:**
- Tüm istekler `Authorization: Bearer <JWT>` başlığı taşır. Tek istisna, kimliğin
  henüz oluşmadığı üç public uçtur: `POST /auth/login`, `GET /auth/invitation/{token}`,
  `POST /auth/complete-invitation`.
- Workgroup izolasyonu token'dan gelir; istemci hiçbir yerde workgroup_id GÖNDERMEZ.
- **Okuma/yazma ayrımı (K-25, K-26):** Workgroup içindeki her kullanıcı, tüm
  bölümlerin verisini OKUR. Yazma yetkisi iki koşula bağlıdır:
  (a) ilgili **yetenek bayrağı**, (b) bölüme ait kaynaklarda ayrıca **bölüm üyeliği**.
  ADMIN her ikisinden de muaftır. Yetkisiz yazma → **403**.
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
Cevap 200:
```json
{ "access_token": "...",
  "user": { "id": 1, "name": "...", "role": "ADMIN" | "SUB_ACCOUNT",
    "department_ids": [1, 2],
    "can_manage_courses": false, "can_manage_weekly": false,
    "can_manage_exams": false, "can_manage_classrooms": false,
    "can_manage_lecturers": false } }
```
← Yetenek bayrakları (K-25) + kullanıcının atandığı bölümler (K-26): UI
  "bu kaydı düzenleyebilir miyim?" sorusunu bu iki alandan cevaplar.
  ADMIN'de tüm bayraklar `true` döner (rol muafiyeti istemciye yansıtılır),
  `department_ids` boş gelir — admin zaten tüm bölümlerde yetkilidir.
Hata 401: geçersiz bilgiler.

### GET /auth/invitation/{token}   ← K-24
Hesap tamamlama ekranı AÇILIRKEN çağrılır: token'ı doğrular ve sahibini döner.
Token'ı **tüketmez** — yakan tek uç `complete-invitation`'dır.
Cevap 200: `{ "email": "ceng@muh.example.edu.tr", "name": "Bilgisayar Sorumlusu" }`
  ← e-posta ekranda salt-okunur gösterilir (wireframe §2); rol/bölüm DÖNMEZ.
Hata 400: `{ "detail": "Geçersiz davet bağlantısı" | "Davet bağlantısı zaten kullanılmış" | "Davet süresi dolmuş" }`
  → B bu üç durumda form yerine tam sayfa hata gösterir (wireframe §2).
Not: 404 kullanılmaz — token'ın varlığı/yokluğu ayırt edilmez (POST ile aynı desen).

### POST /auth/complete-invitation
Davet e-postasındaki linkten gelinir. İstek: `{ "token": "...", "password": "..." }`
Cevap 200: hesap ACTIVE olur → `{ "message": "Hesap aktifleştirildi" }`
Hata 400: token geçersiz / süresi dolmuş / kullanılmış (mesajlar GET ile aynı).
Not: GET ön-doğrulama yapmış olsa bile bu uç tüm kontrolleri TEKRAR eder —
  GET ile POST arasında token süresi dolabilir/kullanılabilir (K-24).

### GET /auth/me
Açılışta oturum kurtarma: elindeki token'ın hâlâ geçerli olup olmadığını ve
sahibinin kim olduğunu söyler. Cevap 200: login cevabındaki `user` nesnesinin
**aynısı** (yetenek bayrakları + `department_ids` dahil — tek şekil, tek tip).
Hata 401: token geçersiz/süresi dolmuş → istemci oturumu düşürür.

**Davet linkinin adresi:** `backend/app/mailer.py` maili
`{FRONTEND_BASE_URL}/activate?token=<ham token>` olarak kurar. Frontend'in
`/activate` route'u token'ı **query string'den** okur; değişirse mailer da değişir.

---

## 2. Kullanıcılar ve Davet (yalnız ADMIN)

### POST /users/invite
İstek:
```json
{ "name": "...", "email": "...", "role": "SUB_ACCOUNT",
  "department_ids": [1, 2],
  "can_manage_courses": true, "can_manage_weekly": true,
  "can_manage_exams": false, "can_manage_classrooms": false,
  "can_manage_lecturers": false }
```
← Yetenek bayrakları davet anında tek tek seçilir (K-25); hepsi opsiyonel,
  varsayılan `false`. `role: "ADMIN"` verilirse bayraklar YOK SAYILIR —
  admin her yetkiye zaten sahiptir.
← `role: "ADMIN"` verilirse **`department_ids` de yok sayılır** (K-34): admin
  her bölümde zaten yetkilidir, üyelik satırı yazmak rol düşürülürse sessiz
  yetki bırakır.
← `department_ids` çoklu olabilir: bir alt hesap birden çok bölümden sorumlu
  olabilir (K-26). Yazma yetkisi bu bölümlerle sınırlıdır; okuma değil.
Cevap 201: `{ "id": 5, "status": "PENDING" }` (e-posta Mailpit'e düşer)
Hata 400: e-posta izinli domainde değil / geçersiz bölüm seçimi.

### POST /users/{id}/resend-invitation → 200
Yalnız `PENDING`. Eski kullanılmamış token'lar geçersiz kılınır, yenisi gönderilir.

### GET /users → kullanıcı listesi (bölüm atamalarıyla)
`[ { "id", "name", "email", "role", "status", "department_ids", "can_manage_*" } ]`
`status`: `PENDING` (davet edildi, giriş yapmadı) · `ACTIVE` · `DISABLED`.

### PATCH /users/{id}   ← K-34
İstek (hepsi opsiyonel): `{ "name", "role", "department_ids", "status",
  "can_manage_courses", "can_manage_weekly", "can_manage_exams",
  "can_manage_classrooms", "can_manage_lecturers" }`
← **E-posta değiştirilemez** — kimliktir, davet token'ı ona bağlıdır. Yanlış
  e-postanın çözümü daveti silip yeniden göndermektir.
← `status` yalnız `ACTIVE` | `DISABLED` alır. `PENDING`'e geri dönülemez:
  tamamlanmış bir hesap "tamamlanmamış" yapılamaz.
← `role: "ADMIN"` verilirse yetenek bayrakları `false`'a çekilir (K-25) **ve
  mevcut bölüm atamaları silinir** (K-34) — yükseltilen alt hesabın birikmiş
  üyelikleri kalırsa, ileride tekrar düşürüldüğünde sessizce yetkili olur.
Cevap 200 · Hata 400: kendi rolünü/durumunu değiştiremezsin (K-34) ·
  404: başka workgroup.

### DELETE /users/{id}   ← K-34
Yalnız **`PENDING`** hesap kalıcı silinir (yanlış adrese giden davet).
Cevap 204 · Hata 409: `{ "detail": "Kullanılmış hesap silinemez: işlem
  kayıtlarındaki izi kaybolur. Erişimi kapatın (status: DISABLED)." }`
Not: `audit_logs.user_id` FK'si `ON DELETE SET NULL` — silme hata vermez,
  sessizce log'un "kim" bilgisini siler. Engel bu yüzden uygulama katmanında.

---

## 3. Bölümler (yalnız ADMIN yazabilir)

### GET /departments → `[ { "id", "name", "code", "active" } ]`
### POST /departments — İstek: `{ "name": "...", "code": "CENG" }` → 201
### PATCH /departments/{id} — ad/kod düzeltme + pasife alma: `{ "active": false }`
### DELETE /departments/{id}   ← K-27 (yalnız ADMIN)
Yalnız **boş** bölüm silinir: bağlı ders veya kullanıcı ataması olmamalı.
Cevap 204: silindi.
Hata 409: `{ "detail": "Bu bölüm silinemez: 3 ders ve 2 kullanıcı ataması bağlı. Önce bunları kaldırın." }`
Hata 404: bölüm yok veya başka workgroup'a ait.
Not: `PATCH {active:false}` (soft delete) API'de durmaya devam eder ama
bölüm ekranı artık kullanmaz (K-27).

---

## 4. Öğretim Üyeleri (K-08: yönetilen entity · yazma: `can_manage_lecturers`)

### GET /lecturers?search=ay&include_inactive=false
Cevap: `[ { "id": 3, "full_name": "Doç. Dr. Ayşe Kaya", "normalized_name": "ayşe kaya",
  "is_external": false, "active": true } ]`
`search` normalized_name üzerinde arar.
- `normalized_name` (unvansız, küçük harf) istemciye de dönülür: listeyi
  **alfabetik sıralamak** için gerekir. `full_name` unvanla başladığından ona
  göre sıralamak "Doç. < Öğr. < Prof." gibi anlamsız bir düzen üretir (K-28).
  Normalizasyon kuralının tek kaynağı backend'dir; istemci onu tekrar yazmaz.
- **Varsayılan yalnız aktifleri döner** — ders formundaki autocomplete bu davranışa
  dayanır (pasife alınan hoca yeni derse atanamasın).
- `include_inactive=true`: pasifler de gelir. Yönetim ekranı bunu kullanır —
  pasif hocayı görüp geri aktifleştirebilmek için (K-28).

### POST /lecturers (ADMIN veya `can_manage_lecturers` — 40/a elle ekleme)
İstek: `{ "full_name": "...", "email": null, "is_external": true }` → 201
Hata 409: normalized_name zaten var.

### PATCH /lecturers/{id} (ADMIN veya `can_manage_lecturers`)
Ad düzeltme / pasife alma: `{ "full_name": "...", "email": "...", "is_external": true, "active": false }`
(hepsi opsiyonel). full_name değişirse normalized_name yeniden hesaplanır.
Hata 409: yeni ad başka bir hocanın normalized_name'iyle çakışıyor.
Not: pasife alınan hoca (`active=false`) autocomplete'te (`GET /lecturers?search=`) görünmez.

### DELETE /lecturers/{id}   ← K-28 (ADMIN veya `can_manage_lecturers`)
Yalnız **hiçbir yere bağlı olmayan** öğretim üyesi silinir.
Cevap 204: silindi.
Hata 409: `{ "detail": "Bu öğretim üyesi silinemez: 2 şube ve 1 sınav bağlı. Önce bu bağlantıları kaldırın." }`
Hata 404: kayıt yok veya başka workgroup'a ait.
Not: Şema zaten korur (`course_sections.lecturer_id` ve `exams.lecturer_id`
  → **ondelete=RESTRICT**); uç bu kontrolü önden yapıp insan-okur mesaj üretir.
Not: Silme ile pasife alma FARKLI işlerdir — ders vermiş ama ayrılan hoca
  silinemez (RESTRICT), `active=false` ile autocomplete'ten çıkarılır (K-28).

Not: Fakülte sayfasından toplu import bir API endpoint'i DEĞİL, backend'de
çalıştırılan tek seferlik script'tir (`scripts/import_lecturers.py`).

---

## 5. Binalar ve Derslikler (yazma: ADMIN veya `can_manage_classrooms`)

### GET /buildings → `[ { "id", "name", "is_external", "active" } ]`   ← K-18, K-30
### POST /buildings — İstek: `{ "name": "Mühendislik Fakültesi", "is_external": false }` → 201 · Hata 409: ad zaten var
  ← `is_external` (K-30): fakülte dışı bina etiketi, opsiyonel, varsayılan false
### PATCH /buildings/{id} — ad düzeltme / fakülte dışı işaretleme / pasife alma
### DELETE /buildings/{id}   ← K-29
Yalnız **hiç dersliği olmayan** bina silinir.
Cevap 204 · Hata 409: `{ "detail": "Bu bina silinemez: 3 derslik bağlı. Önce onları kaldırın." }`

### GET /classrooms → `[ { "id", "building": { "id", "name", "is_external" }, "room_code",
  "room_type": "CLASSROOM" | "AMPHI" | "LAB", "capacity", "exam_capacity", "active" } ]`
### POST /classrooms — İstek: `{ "building_id": 1, "room_code": "B-201", "room_type": "AMPHI",
  "capacity": 90, "exam_capacity": 40 | null }` → 201
  ← `room_type` (K-31): opsiyonel, varsayılan `CLASSROOM`. Enum dışı değer → 422.
    Bilgi/filtre amaçlı; çakışma motoru bu alanı OKUMAZ.
  ← capacity zorunlu (K-07); exam_capacity OPSİYONEL (K-21) — girilirse <= capacity,
    girilmezse NULL kalır; sınav yeri seçiminde NULL'lu derslik WARNING üretir
### PATCH /classrooms/{id} — pasife alma dahil: `{ "active": false }`
### DELETE /classrooms/{id}   ← K-29
Yalnız **hiçbir yere bağlı olmayan** derslik silinir: haftalık giriş, sınav ve
şubenin varsayılan dersliği olarak kullanılmamış olmalı.
Cevap 204 · Hata 409: `{ "detail": "Bu derslik silinemez: 2 haftalık giriş ve 1 sınav bağlı. Önce bu bağlantıları kaldırın." }`
Not: Kullanılmış derslik silinmez, `PATCH {active:false}` ile pasife alınır (K-29).

---

## 6. Dersler ve Şubeler (K-14; yazma: `can_manage_courses` + bölüm üyeliği)

### GET /courses?department_id=&year=&semester=&search=
Workgroup'un **tüm** bölümlerinin dersleri döner — alt hesap da dahil (K-26).
Bölüme göre daraltmak isteyen istemci `department_id` filtresini kullanır.
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
### DELETE /courses/{id}   ← K-32
Yalnız **hiç şubesi ve hiç sınavı olmayan** ders silinir.
Cevap 204 · Hata 409: `{ "detail": "Bu ders silinemez: 2 şube ve 1 sınav bağlı. Önce bunları kaldırın." }`
Not: Sınav K-16 gereği ders düzeyindedir; şubesiz bir dersin sınavı olabilir,
  o yüzden iki koşul da aranır. Kullanımdaki ders `PATCH {active:false}` ile pasife alınır.

### POST /courses/{id}/sections   (şube)
İstek: `{ "section_no": 2, "lecturer_id": 3, "expected_students": 45,
  "default_classroom_id": null }`   ← aynı hoca birden çok şubeye girebilir (K-14)
Cevap 201 · Hata 409: bu derste bu şube no zaten var.

### PATCH /course-sections/{id} · DELETE /course-sections/{id} (girişi yoksa)

---

## 7. Haftalık Program — save/submit ayrımı (K-03'ün kalbi)
Yazma: `can_manage_weekly` + girişin dersinin bölümüne üyelik (K-25).

### GET /weekly-entries?department_id=&year=&semester=&classroom_id=&lecturer_id=
Workgroup'un **tüm** bölümlerinin girişleri döner (K-26) — çakışmayı çözebilmek
için başka bölümün doluluğunu görmek şarttır.
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
Hata 400: `delivery_mode` FACE_TO_FACE değilken `classroom_id` dolu
  (K-23: hibrit ders yok — online girişte derslik NULL olmalı).
Hata 400: `start_slot + slot_count - 1 > 9` (slot penceresi taşması).

### PATCH /weekly-entries/{id}  (yalnız DRAFT girişte çalışır)
Hata 409: giriş SUBMITTED — önce draft'a çevrilmeli.
Hata 400: POST ile aynı doğrulamalar; kontrol gelen + mevcut alanların
  birleşimi üzerinden yapılır (K-23, slot taşması).

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
Yazma: `can_manage_exams` + sınavın dersinin bölümüne üyelik (K-25).
`GET /exams` workgroup'un tüm bölümlerini döner (K-26).

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
### PATCH /exams/{id}  (yalnız DRAFT girişte çalışır — K-22)
Alanlar POST ile aynı, hepsi opsiyonel; `classroom_ids` verilirse liste tam değişir.
Cevap 200: `{ "exam": {...}, "conflicts": [...] }`
Hata 409: sınav SUBMITTED — önce draft'a çevrilmeli.

### POST /exams/submit — haftalıkla aynı sözleşme
### POST /exams/{id}/revert-to-draft · DELETE /exams/{id} (yalnız DRAFT)

---

## 9. Çakışma Raporu

### GET /conflicts
Tam tarama (doküman §3.6). Cevap: `{ "hard": [ConflictResult...], "warnings": [ConflictResult...] }`
- Workgroup'un TÜMÜ taranır ve tüm sonuçlar herkese döner (K-04 + K-26).
- Alt hesabın çakışmayı çözebilmesi için karşı tarafı görmesi şarttır; ayrıca
  motor mesajları zaten diğer bölümün ders/derslik/saat bilgisini içerir.
- Çözme (düzenleme) yetkisi yine bayrak + üyelikle sınırlıdır.
- **Yetki notu:** dashboard özeti (§10) yalnız ADMIN'dir, bu uç DEĞİL — alt hesap
  da okur (K-26). İki ucun yetkisi bilerek farklıdır.
- Sonuç **canlı hesaplanır**, tabloda saklanmaz: çakışmanın id'si ve zaman
  damgası yoktur, "en yeni çakışma" diye bir sıralama mümkün değildir.
- Motor bağlanana dek iki liste de **boş** döner (`conflict_service` stub —
  A-3/A-4). Cevap şekli şimdiden sabit, B mock'unu buna göre kurabilir.

---

## 10. Dashboard

### GET /dashboard/summary   ← K-33 (yalnız ADMIN)
Cevap:
```json
{ "departments": 2, "classrooms": 5, "lecturers": 9, "courses": 24,
  "admins": 1, "sub_accounts": 3,
  "weekly_entries": 61, "exams": 18,
  "unresolved_hard": 3, "unresolved_warnings": 7 }
```
← **Yalnız aktif kayıtlar sayılır** (K-33): `active=false` bölüm/derslik/
  öğretim üyesi/ders sayaca girmez — ekranlardaki liste uzunluklarıyla tutsun.
← `admins` / `sub_accounts`: yalnız `status="ACTIVE"` hesaplar. PENDING davet
  ve DISABLED hesap sayılmaz (ikisi de sisteme bir şey yapamaz).
← `exams` ve `weekly_entries`: `active` bayrağı yok, DRAFT + SUBMITTED birlikte
  sayılır (K-03).
← `unresolved_hard` / `unresolved_warnings`: motor bağlanana dek **ikisi de 0**
  döner (`conflict_service` stub — A-3/A-4). Alan adları şimdiden sabit.
← Dashboard sekiz kart çizer; `weekly_entries` kart olarak gösterilmez ama
  alan korunur (haftalık program ekranı gelince eklenecek).

---

## 12. İşlem Kayıtları (audit log)   ← K-35

### GET /audit-logs?limit=20&offset=0&user_id=&action=&entity_type=&date_from=&date_to=
Yalnız ADMIN. Yeniden eskiye sıralı.
```json
{ "total": 2613,
  "items": [
    { "id": 9120, "created_at": "2026-07-23T09:14:22Z",
      "user": { "id": 3, "name": "Ayşe Yılmaz" },
      "action": "DELETE", "entity_type": "course", "entity_id": 12,
      "entity_label": "CENG2001 — İstatistik" } ] }
```
← `action`: `CREATE` · `UPDATE` · `DELETE` · `SUBMIT`
← `entity_type`: `department` · `building` · `classroom` · `lecturer` ·
  `course` · `course_section` · `exam` · `weekly_entry` · `user`
← `entity_label`: okuma anında ilgili tablodan çözülür. **Kayıt silinmişse
  `null`** döner (K-35) — UI o zaman `#12` gösterir. Yazma anında denormalize
  etmek sonraki iş; cevap şekli o zaman da değişmez.
← Sayfalama ZORUNLU (log tek büyür): `limit` varsayılan 20, en fazla 100.
← İzolasyon `user_id → users.workgroup_id` join'iyle; `audit_logs`'ta
  `workgroup_id` kolonu yok.

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
