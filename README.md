# Akademik Program ve Sınav Çakışma Yönetim Sistemi

Akademik birimler için haftalık ders programı ve sınav takvimi hazırlama +
çakışma tespit sistemi. Manuel Excel yönetiminin yerini alır; program
kesinleşmeden önce derslik, öğretim üyesi ve sınıf çakışmalarını yakalar.

---

## Çalıştırma

Docker Desktop dışında hiçbir şey kurmanıza gerek yok — Python, Node ve
veritabanı konteynerlerin içinde gelir.

    git clone https://github.com/academic-scheduling/academic-scheduling-system.git
    cd academic-scheduling-system
    docker compose up

İlk açılış imajları derlediği için birkaç dakika sürer; sonraki açılışlar
saniyeler alır. Ardından:

| | |
|---|---|
| Arayüz | <http://localhost:8080> |
| Giriş | `admin@muh.example.edu.tr` / `admin1234` |
| API dokümanı | <http://localhost:8000/docs> |
| E-postalar | <http://localhost:8025> (Mailpit) |

Gönderilen hiçbir e-posta internete çıkmaz; davet ve şifre sıfırlama mailleri
Mailpit arayüzünde birikir.

---

## Hızlı deneme

Motorun ne yaptığını görmek için altı adım yeterli:

1. **Bölümler** → bir bölüm ekleyin (örn. `CENG`)
2. **Derslikler** → bir bina ve bir derslik tanımlayın; kapasitesini bilerek
   küçük tutun (örn. 30)
3. **Öğretim Üyeleri** → bir hoca ekleyin
4. **Dersler** → aynı sınıfa iki zorunlu ders açın, her birine **aynı hocayla**
   birer şube ekleyin ve beklenen öğrenci sayısını dersliğin kapasitesinden
   büyük verin (örn. 40)
5. **Haftalık Program** → bölüm, sınıf ve dönemi seçin
6. İki şubeyi **aynı gün, aynı saat, aynı dersliğe** yerleştirin

Motor anında üç engelleyici çakışma ve iki uyarı üretir:

| | |
|---|---|
| 🔴 W1 | İki ders aynı derslikte |
| 🔴 W2 | Aynı öğretim üyesi aynı anda iki yerde |
| 🔴 W3 | Aynı sınıfın iki zorunlu dersi çakışıyor |
| 🟡 W7 | Beklenen öğrenci sayısı derslik kapasitesini aşıyor |
| 🟡 W8 | Yerleşen saat toplamı dersin T+U+L değeriyle uyuşmuyor |

Ana sayfadaki sayaç engelleyici ve uyarı sayısını ayrı gösterir; **Çakışma
Raporu** her satırın hangi kuralı neden tetiklediğini yazar.

---

## Motor ne yakalar

Çakışma kuralları üç ailede toplanır ve her biri **engelleyici** ya da
**uyarı** olarak sınıflanır. Çakışma kaydı engellemez, **yayına almayı**
engeller (K-03): taslak üzerinde serbestçe çalışırsınız, engelleyici çakışma
kalmadan program yayına alınamaz ve reddedilirse gerekçesi listelenir.

Kuralların tam listesi ve gerekçeleri `docs/cakisma_kural_seti_1.md`
içindedir; aşağıdaki özet uygulamadaki kural kataloğunun aynısıdır.

**W — haftalık program**

| | |
|---|---|
| W1 | Aynı derslikte, aynı gün, kesişen saatlerde iki ders |
| W2 | Aynı öğretim üyesi, aynı gün, kesişen saatlerde iki ders |
| W3 | Aynı sınıfın iki **zorunlu** dersi çakışıyor — öğrenci ikisini de almak zorunda |
| W4 | Aynı sınıfın iki dersi çakışıyor, en az biri seçmeli |
| W5 | Aynı şubenin kesişen iki oturumu girilmiş |
| W6 | Gün 1-5 dışında ya da günün son slotunu aşan yerleşim |
| W7 | Şubenin beklenen öğrenci sayısı dersliğin kapasitesini aşıyor |
| W8 | Yerleşen saat toplamı dersin teori+uygulama+lab değeriyle uyuşmuyor |
| W9 | Yüz yüze derse derslik atanmamış |

**E — sınav takvimi**

| | |
|---|---|
| E1 | İki sınav aynı dersliği aynı tarih ve kesişen saatte kullanıyor |
| E2 | Aynı dersin aynı türden ikinci sınavı |
| E3 | Aynı sorumlu, aynı tarih ve kesişen saatte iki sınavda |
| E4a / E4b | Aynı sınıfın iki sınavı aynı anda (a: ikisi de zorunlu, b: en az biri seçmeli) |
| E5 / E5a | Sınav kontenjanı yetersiz / hiç girilmemiş |
| E6 | Sınav cumartesi ya da pazara denk geliyor |
| E7 | Bir derslik çıkarılsa bile kontenjan fazlasıyla yetiyor |
| E8 | Sınava hiç derslik seçilmemiş |
| E9 | Aynı kişi iki sınavda birden görevli, en az biri gözetmenlik |

**X — çapraz (sınav ↔ haftalık program)**

| | |
|---|---|
| X1 | Sınavın dersliği o saatte haftalık bir derse ayrılmış |
| X2 | Sınav, aynı sınıfın haftalık dersiyle aynı saate düşüyor |
| X3 | Sınav sorumlusu o saatte haftalık bir derste görünüyor |
| X4 | Sınavın gözetmeni o saatte haftalık bir derste görünüyor |

### Motorun bilerek sustuğu yerler

Asıl ustalık yanlış alarm üretmemektedir. Motor şu durumlarda **çakışma
bildirmez** ve bunların her biri ayrı bir karar maddesidir:

- Bir dersin ikinci şubesi farklı saatteyse, öğrenci uyumlu kombinasyonu
  seçebileceği için sınıf çakışması sayılmaz (K-15)
- Asenkron yürütülen ders, aynı hoca aynı saatte görünse bile hoca
  çakışması üretmez (K-19)
- Bir dersin sınavı kendi ders saatine denk geldiğinde çapraz uyarı çıkmaz
  (K-13)

Tasarım kararlarının tamamı `docs/karar_defteri_1.md` içindedir.

---

## Teknoloji

- **Backend:** FastAPI (Python 3.12), SQLAlchemy 2, Alembic, PostgreSQL 16
- **Frontend:** React 18, Vite, TypeScript, Mantine UI
- **Kimlik doğrulama:** JWT
- **E-posta:** Mailpit
- **Altyapı:** Docker Compose

Tasarım belgeleri `docs/` klasöründedir: karar defteri, çakışma kural seti,
veritabanı şeması, API kontratı, wireframe şartnamesi.
