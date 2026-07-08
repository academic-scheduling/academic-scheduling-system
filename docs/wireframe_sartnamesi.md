# Wireframe Şartnamesi (v0.1)

**Amaç:** Stajyer B'nin Excalidraw'da çizeceği 9 ekranın içerik/davranış tanımı.
Wireframe low-fidelity olacak (kutu + etiket düzeyi); bu belge "her ekranda ne var,
hangi kararı yansıtıyor" sorusunu cevaplar. Çizimler docs/wireframes/ klasörüne PNG export edilir.

Genel kurallar:
- Her ekranda üst bar: uygulama adı, kullanıcı adı + rolü, çıkış.
- Sol menü: Dashboard, Bölümler*, Kullanıcılar*, Hocalar*, Derslikler, Dersler,
  Haftalık Program, Sınavlar, Çakışma Raporu. (* = yalnız ADMIN görür)
- Alt hesap yalnız atanmış bölümlerinin verisini görür (K-02/K-04); menüde
  görünürlük değil, veride filtreleme esastır.

---

## 1. Login
- E-posta + şifre alanı, "Giriş" butonu.
- Hata durumu: alanların altında kırmızı mesaj ("E-posta veya şifre hatalı").
- Not: kayıt ol linki YOK — hesaplar yalnız davetle açılır (doküman 2.2).

## 2. Hesap Tamamlama (davet linkinden gelinen sayfa)
- Salt-okunur e-posta (token'dan çözülür), yeni şifre + şifre tekrar.
- "Hesabı Aktifleştir" butonu.
- Süresi dolmuş/kullanılmış token durumu: form yerine tam sayfa hata + "Yöneticinizden
  daveti yeniden göndermesini isteyin" metni.

## 3. Admin Dashboard
- 6 sayaç kartı: Bölüm, Ders, Derslik, Haftalık Oturum, Sınav, Çözülmemiş Çakışma.
- Çakışma kartı iki alt sayı: HARD (kırmızı) / WARNING (sarı) — tıklayınca Çakışma Raporu'na gider.
- "Son işlemler" listesi (audit log'dan son 5 kayıt) — opsiyonel, yer varsa.

## 4. Bölümler & Kullanıcı Daveti (ADMIN)
- Sol: bölüm listesi (ad, kod) + "Bölüm Ekle" formu.
- Sağ: kullanıcı listesi (ad, e-posta, rol, durum: PENDING/ACTIVE, bölümleri).
- "Kullanıcı Davet Et" modalı: ad, e-posta, rol, bölüm çoklu seçim,
  **"Derslik yönetebilir" onay kutusu (K-02)**.
- PENDING kullanıcı satırında "Daveti Yeniden Gönder" butonu.

## 5. Dersler
- Üstte filtreler: bölüm, yıl, dönem, arama kutusu.
- Tablo: kod+şube, ad, yıl/dönem, hoca, beklenen öğrenci, seçmeli mi, durum.
- "Ders Ekle" formu (modal veya ayrı sayfa):
  - bölüm (alt hesapta yalnız atanmışlar), yıl, dönem, kod, şube no, ad
  - **hoca: autocomplete alan (K-08)** — yazınca /lecturers?search önerileri düşer;
    serbest metin KABUL EDİLMEZ, listeden seçim zorunlu. "Listede yok" durumu için
    admin'e yönlendiren yardım metni.
  - **beklenen öğrenci: zorunlu sayı alanı (K-07)**
  - seçmeli mi: onay kutusu
  - varsayılan derslik: opsiyonel seçim

## 6. Derslikler
- Tablo: bina, kod, kapasite, aktif/pasif.
- "Derslik Ekle" formu: bina, kod, **kapasite (zorunlu, K-07)**.
- Silme YOK; satırda "Pasife Al" anahtarı (K-02 soft delete).
- Bu sayfa yalnız ADMIN veya can_manage_classrooms=true kullanıcıya yazılabilir;
  diğerlerine salt-okunur.

## 7. Haftalık Program Grid'i (EN KRİTİK EKRAN)
- Üstte filtreler: bölüm, yıl, dönem (cohort görünümü) + derslik/hoca alternatif görünümleri.
- Grid: sütunlar Pzt-Cum, satırlar 9 slot (08:30 ... 16:30).
- Hücre içeriği: ders kodu-şube, derslik (veya "Online"), hoca soyadı.
- **Durum görselleştirme (K-03):**
  - SUBMITTED giriş: dolu arka plan + kilit ikonu.
  - DRAFT giriş: kesikli kenarlık + soluk arka plan.
  - Çakışmalı giriş (son kontrole göre): kırmızı kenarlık + uyarı ikonu;
    üzerine gelince çakışma mesajı tooltip'te.
- Boş hücreye tıkla → "Oturum Ekle" formu (ders seçimi, derslik, slot sayısı).
  Kaydet → cevaptaki conflicts listesi varsa panel/toast ile göster (kayıt yine olur).
- DRAFT girişe tıkla → düzenle/sil. SUBMITTED girişe tıkla → salt-okunur detay +
  "Taslağa Çevir" butonu (onay diyaloğu ile).
- Sağ üstte **"Submit" butonu + rozet: bekleyen taslak sayısı**.
  Submit → başarılıysa yeşil bildirim; HARD çakışma varsa modal: çakışma listesi
  (ConflictResult mesajları) + hiçbir girişin submit edilmediği notu (hep-veya-hiç).

## 8. Sınavlar
- Filtreler: bölüm, sınav tipi (Vize/Final/Büt), tarih aralığı, derslik, yıl, dönem, hoca.
- Liste görünümü: tarih, saat, süre, ders, tip, derslik, hoca, durum (DRAFT/SUBMITTED).
- "Sınav Ekle" formu: ders, tip, **tarih (hafta sonu seçilemez — K-06)**, başlangıç saati
  (**kısıtsız; 18:00 geçerli**), süre, derslik (opsiyonel — online), sorumlu hoca (autocomplete), not.
- Kaydet/submit davranışı haftalık grid ile birebir aynı desen.

## 9. Çakışma Raporu
- İki sekme/bölüm: HARD (kırmızı başlık) ve WARNING (sarı başlık), sayılarıyla.
- Her satır: severity rozeti, kural kodu (W3, E1...), insan-okur mesaj,
  etkilenen girişlere gitme linki ("Grid'de göster").
- "Tam Tarama Çalıştır" butonu (GET /conflicts'i tetikler).
- ADMIN tüm bölümleri görür; alt hesap yalnız kendi bölümlerini (K-04).
- Export butonları bu sayfada DEĞİL; grid ve sınav sayfalarının üstünde
  ("Excel'e Aktar" / "PDF'e Aktar" — K-09).
