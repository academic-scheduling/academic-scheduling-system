/** K-79: Türkçe sözlük — DİLİN KAYNAĞI (source of truth).
 *
 *  Şekil kararı: düz "a.b.c" anahtarları yerine İÇ İÇE NESNE, ve değişken
 *  içeren metinler FONKSİYON. Sebebi tip güvenliği: `en.ts` bu nesnenin
 *  `typeof`'unu sağlamak zorunda, dolayısıyla eksik anahtar da, yanlış imzalı
 *  bir metin de (`(n: number) => string` yerine düz string) DERLEME anında
 *  yakalanır. `tsc --noEmit` zaten doğrulama adımımız — bekçiyi bedavaya
 *  aldık, çalışma zamanında "anahtar bulunamadı" diye bir hâl yok.
 *
 *  Bölümler ekran/alan bazlı: `nav` (menü), `common` (her yerde geçen eylemler),
 *  `auth`, `layout`. Faz 3'te sayfa sayfa genişleyecek.
 */

export const tr = {
  nav: {
    home: "Ana Sayfa",
    dashboard: "Dashboard",
    departments: "Bölümler",
    courses: "Dersler",
    classrooms: "Derslikler",
    lecturers: "Öğretim Üyeleri",
    weekly: "Haftalık Program",
    exams: "Sınavlar",
    publishing: "Yayın Merkezi",
    conflicts: "Çakışma Raporu",
  },

  layout: {
    appName: "Akademik Program",
    collapse: "Menüyü daralt",
    expand: "Menüyü genişlet",
    toLightMode: "Aydınlık moda geç",
    toDarkMode: "Karanlık moda geç",
    logout: "Çıkış yap",
    logoutFrom: (email: string) => `Çıkış yap (${email})`,
    language: "Dil",
    switchToEnglish: "Switch to English",
    switchToTurkish: "Türkçeye geç",
    roleAdmin: "Yönetici",
    roleSubAccount: "Alt hesap",
  },

  common: {
    save: "Kaydet",
    cancel: "İptal",
    delete: "Sil",
    edit: "Düzenle",
    close: "Kapat",
    add: "Ekle",
    search: "Ara",
    loading: "Yükleniyor…",
    noRecords: "Kayıt yok",
    export: "Dışa Aktar",
    downloadFailed: "İndirme başarısız",
    confirm: "Onayla",
    back: "Geri",
    all: "Tümü",
    yes: "Evet",
    no: "Hayır",
    unknownError: (status: number) => `Beklenmeyen hata (HTTP ${status})`,
    serverUnreachable: "Sunucuya ulaşılamıyor — backend çalışıyor mu?",
    sessionExpired: "Oturum süresi doldu — lütfen tekrar giriş yapın",
    invalidValue: "Geçersiz değer",
  },

  auth: {
    email: "E-posta",
    password: "Şifre",
    login: "Giriş yap",
    forgotPassword: "Şifremi unuttum",
  },
};

/** `en.ts`'in sağlamak zorunda olduğu şekil.
 *
 *  `as const` BİLEREK yok: literal tipleri dondurursa `nav.home`'un tipi
 *  `"Ana Sayfa"` olur ve `en.ts` aynı TÜRKÇE metni yazmak zorunda kalırdı.
 *  `as const`suz metinler `string`'e genişler, fonksiyon imzaları korunur —
 *  istediğimiz tam olarak bu.
 */
export type Dict = typeof tr;
