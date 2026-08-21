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

    title: "Akademik Program Yönetimi",
    emailPlaceholder: "ad@muh.example.edu.tr",
    loginButton: "Giriş",
    invalidEmail: "Geçerli bir e-posta adresi girin",
    passwordRequired: "Şifre boş olamaz",
    unexpectedError: "Beklenmeyen bir hata oluştu",

    // Şifre sıfırlama (K-43/K-44)
    forgotTitle: "Şifremi Unuttum",
    forgotHelp:
      "Hesabınızın e-posta adresini girin; şifrenizi yenilemeniz için bir " +
      "bağlantı gönderelim.",
    forgotSubmit: "Sıfırlama Bağlantısı Gönder",
    sentTitle: "Bağlantı Gönderildi",
    sentAlert: "E-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi.",
    sentDetail:
      "Gelen kutunuzu kontrol edin. Bağlantı kısa süre geçerlidir ve yalnızca " +
      "bir kez kullanılabilir.",
    backToLogin: "Girişe dön",

    resetTitle: "Yeni Şifre Belirleyin",
    newPassword: "Yeni şifre",
    newPasswordAgain: "Yeni şifre (tekrar)",
    resetSubmit: "Şifreyi Güncelle",
    resetDone: "Şifreniz güncellendi. Şimdi giriş yapabilirsiniz.",
    resetLinkDeadTitle: "Sıfırlama bağlantısı geçersiz",
    resetLinkDeadDetail:
      "Bağlantılar kısa süre geçerlidir ve bir kez kullanılır. Yeni bir " +
      "bağlantı isteyebilirsiniz.",
    requestNewLink: "Yeni bağlantı iste",
    noResetCode: "Bağlantıda sıfırlama kodu yok.",
    resetLinkUnverified: "Bağlantı doğrulanamadı.",

    passwordsDoNotMatch: "Şifreler eşleşmiyor",
    passwordTooShort: (min: number) => `Şifre en az ${min} karakter olmalı`,

    // Davet ile hesap açma
    activateTitle: "Hesabınızı Tamamlayın",
    activateSubmit: "Hesabı Aktifleştir",
    activateDone: "Hesabınız aktifleştirildi. Şimdi giriş yapabilirsiniz.",
    inviteLinkDeadTitle: "Davet bağlantısı geçersiz",
    inviteLinkDeadDetail: "Yöneticinizden daveti yeniden göndermesini isteyin.",
    noInviteCode: "Bağlantıda davet kodu yok.",
    inviteUnverified: "Davet doğrulanamadı.",
    passwordAgain: "Şifre (tekrar)",

    captchaFailed:
      "Doğrulama bileşeni yüklenemedi. Reklam/gizlilik engelleyicisi ya da ağ " +
      "kısıtı Google'a erişimi kesiyor olabilir; kontrol edip sayfayı yenileyin.",
  },

  // Boşta-kalma uyarısı (K-47). Cümle üç parçaya bölük çünkü ORTADAKİ sayaç
  // kalın yazılıyor ve iki dilde cümlenin dizilişi farklı:
  //   TR: "... oturumunuz **30 saniye** içinde kapatılacak."
  //   EN: "... will be closed in **30 seconds**."
  // `idleTail`'in başındaki boşluk/nokta farkı BİLEREK: JSX'te araya boşluk
  // konmuyor, her dil kendi bağlacını taşıyor.
  session: {
    idleTitle: "Oturumunuz sürüyor mu?",
    idleBody: (minutes: number) =>
      `${minutes} dakikadır işlem yapılmadı. Güvenlik için oturumunuz`,
    idleSeconds: (seconds: number) => `${seconds} saniye`,
    idleTail: " içinde kapatılacak. Devam etmek istiyor musunuz?",
    extend: "Oturumu uzat",
    countdown: "Oturum uyarısı",
  },

  home: {
    title: "Ana Sayfa",
    subtitle: "Sol menüden bir bölüm seçin.",
    backend: "Backend",
    backendUnreachable: "erişilemiyor",
    backendChecking: "kontrol ediliyor...",
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
