# wp5-overlap-core İnceleme Notları

**Tarih:** 15 Temmuz 2026 · **İnceleyen:** Intern A · **İncelenen:** `feature/wp5-overlap-core` (Intern C)
**Referanslar:** docs/api_kontrat.md §0, docs/cakisma_kural_seti_1.md v1.4, docs/karar_defteri_1.md (K-13..K-22)

---

## 0. Onay durumu — v1.3/v1.4 artık bağlayıcı

Kural setindeki **"Açık Kararlar 2"** maddesi (v1.3/v1.4 değişiklik seti: şube-farkındalıklı
W3/W4, asenkron ön-eleme, W8, ders düzeyi sınav, E1/E5/E5a/E7) bu belgeyle birlikte
**ONAYLANDI kabul edilir ve kapanmıştır**. Motor bu spesifikasyona göre güncellenecek —
aşağıdaki maddeler "öneri" değil, yapılması gereken işlerdir.

## 1. Genel değerlendirme: temel sağlam

Branch'in özü doğru ve değerli:

- **Sınır matematiği birebir doğru:** `startA < endB and startB < endA` — uç uca biten/başlayan
  oturumlar temiz sayılıyor (dokümanın açıkça test şartı koştuğu boundary case, testleri mevcut).
- **Saf Python, DB'siz tasarım** kural setinin şartına uygun; slot tablosu (§5.1) birebir doğru.
- **E1 çoklu-derslik küme kesişimi** (K-17) doğru kurulmuş; W1 NULL-derslik atlaması (K-10),
  W3/W4 ve E4a/E4b severity ayrımları (K-05, K-12) doğru.
- 71 unit test; pozitif/negatif/sınır/atlama sınıfları şablona uygun.
- `message.py` insan-okur Türkçe mesaj katmanı hazırda bekliyor — iyi ayrıştırılmış.

**Merge önerisi:** Branch bu haliyle PR edilip merge edilebilir. Motor henüz hiçbir
endpoint'ten çağrılmadığı için main'in davranışını değiştirmez; aşağıdaki düzeltmeler
sonraki branch'lerde yapılır. Yalnız §4'teki iki tek-satırlık temizlik merge'den önce yapılmalı.

---

## 2. Intern C'nin yapması gerekenler

### 2.1 Çıktı şekli kontrat §0'a tamamlanmalı (en öncelikli)

Motor şu an `{"rule_id", "severity"}` dönüyor. Kontratın B'ye söz verdiği şekil:

```json
{ "severity": "HARD|WARNING", "rule_id": "...", "message": "...",
  "affected": [{ "type": "weekly_entry|exam", "id": 42, "course_code": "CENG2001-1" }] }
```

Yapılacaklar:
- `message.py` motora bağlanmalı (`build_message` çağrısı sonuç üretimine dahil edilmeli).
- `affected` listesi üretilmeli — çakışan girişlerin id + course_code'u. W3/W4'te
  `affected`, uyumsuzluğu kanıtlayan somut oturum çiftlerini içermeli (kural seti şartı,
  B raporda "hangi oturumlar" gösterecek).
- **Orkestratör fonksiyonu** yazılmalı: "aday giriş(ler)i, workgroup'un DRAFT+SUBMITTED
  tüm girişlerine karşı tara, ConflictResult listesi dön." Bugünkü fonksiyonlar hep tek
  çift değerlendiriyor; evren taraması katmanı yok. (Bu fonksiyonun API'ye bağlanması
  Intern A'ya bırakılacak — C yalnız saf-Python tarama fonksiyonunu sağlar.)

### 2.2 Şube modeli işlenmelİ — K-14/K-15

`WeeklySession`/dict yapısında `section_id` yok; motor v1.2'nin "tek courses tablosu"
dünyasına göre yazılmış. Düzeltmeler:
- Oturum verisine `section_id` eklenmeli.
- **W5** `course_id` değil `section_id` üzerinden bakmalı. Mevcut haliyle aynı dersin
  iki FARKLI şubesinin çakışan oturumları W5 üretir — kural seti bunun tam tersini söyler:
  "şubeler alternatiftir, W5 de W3/W4 de ÜRETİLMEZ". Bu bir yanlış pozitif kaynağı.
- **W3/W4 şube-farkındalıklı kombinasyon mantığına** geçmeli: aynı cohort'taki iki ders
  için tüm aktif şube çiftleri kurulur; **en az bir uyumlu (a,b) çifti varsa çakışma
  yoktur**, tüm çiftler uyumsuzsa W3/W4 üretilir (kural setinde örnekli anlatım mevcut).

### 2.3 Asenkron ön-eleme — K-19

`delivery_mode` motor verisinde hiç yok. Eklenmeli ve ön-eleme uygulanmalı:
taraflarından biri `ONLINE_ASYNC` olan her çift W1-W5, W7 ve X1-X3'te atlanır.
İstisnalar: W6 asenkron için de çalışır; W8 toplamına asenkron oturumlar dahildir.
`ONLINE_SYNC`'te muafiyet yoktur (W2, W3/W4 normal çalışır).

### 2.4 E5 yanlış alan okuyor; E5a ve E7 eksik — K-17/K-21

- **E5** `room["capacity"]` kullanıyor; doğrusu **`exam_capacity`** (boşluklu oturma
  kontenjanı). Kural seti altını çizerek "capacity DEĞİL" diyor.
- **E5a** eklenmeli: seçili dersliklerden birinin `exam_capacity`'si NULL ise
  "kontenjan girilmemiş" WARNING'i; NULL'lu derslik varken E5 toplam karşılaştırması
  YAPILMAZ (önce eksik veri uyarısı).
- **E7** eklenmeli: en küçük `exam_capacity`'li derslik çıkarıldığında kalan toplam
  hâlâ yetiyorsa israf WARNING'i. (Eşik kriteri için hoca onayı beklemede — karar
  defteri açık konu 5; eşiği parametreleştirmek yeterli, onay çıkınca değer sabitlenir.)

### 2.5 X1b kaldırılmalı — K-13 ihlali + kontrat dışı rule_id

Aynı dersin sınavı kendi dersinin yerinde/saatinde yapıldığında motor `X1b` WARNING
üretiyor. K-13 açık: bu karşılaştırma **tamamen atlanır, hiçbir şey üretilmez**
("bilgi" uyarısı dahi). Ayrıca `X1a`/`X1b` kontrat §0 enum'unda yok — B'nin UI'ı
tanımaz. `X1a` → `X1` olarak sadeleşmeli, `X1b` silinmeli. X2/X3'teki aynı-ders
atlaması doğru kurulmuş, korunmalı. (E4a/E4b sorun değil — kural setinde resmî ID'ler.)

### 2.6 X kuralları MIDTERM'e sabitlenmemeli — K-06

`exam_weekly_overlap` MIDTERM dışındaki sınava düz `False` dönüyor. Doğrusu:
X1-X3, `workgroup.check_exam_vs_course` bayrağına bağlıdır (sınav tipine değil).
Motor DB bilmediği için bayrak tarama fonksiyonuna **parametre** olarak geçilmeli;
bayrağın DB'den okunup geçirilmesi Intern A'ya bırakılacak.

### 2.7 W8 tamlık kuralı eksik — K-20

Şubenin `session_type` bazında SUM(slot_count) ≠ dersin T/U/L değeri → WARNING.
Yalnız submit anında çalışır, save'de sessiz. Asenkron oturumlar toplama dahildir;
hours değeri 0 olan bileşen için giriş yoksa kontrol edilmez.

---

## 3. Intern A'ya bırakılacak kısımlar (C yapmayacak)

Bu maddeler motorla temas eder ama API/DB tarafıdır — Intern A üstlenecek:

- `app/conflict_service.py` adaptörünün doldurulması: ORM nesnelerinden motor
  dict'lerinin kurulması, sınav save/submit kablolaması (K-22 dikişi).
- `weekly-entries` endpoint'lerinin yazılması ve motorun oraya bağlanması
  (entegrasyon adımı C ile birlikte yürür, koordinasyon A'da).
- `GET /conflicts` tam tarama endpoint'i ve `check_exam_vs_course` bayrağının
  DB'den okunup motora geçirilmesi.

## 4. Küçük temizlikler (merge'den önce, tek satırlık)

- `engine.py` başındaki **ölü import**: `from email.mime import base` — silinmeli.
- `.vscode/settings.json` repoya girmiş — kaldırılıp `.gitignore`'a eklenmeli.

Ertelenebilir küçükler: `WeeklySession` dataclass'ı tanımlı ama hiçbir fonksiyon
kullanmıyor (ya dict'lerin yerine geçmeli ya silinmeli); W6'da `start_slot < 1`
kontrolü yok (DB CHECK koruyor, yine de motor mesaj üretebilmeli).
