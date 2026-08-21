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

    // CRUD ekranlarının ortak metinleri — üç sayfada birebir tekrar ediyordu.
    dismiss: "Vazgeç",
    actionFailed: "İşlem başarısız",
    loadFailed: "Veriler yüklenemedi",
    permanentDeleteWarning: "kalıcı olarak silinecek. Bu işlem geri alınamaz.",
    admin: "Yönetici",
    subAccount: "Alt Hesap",
    allPermissions: "Tüm yetkiler",
    viewOnly: "Yalnız görüntüleme",
    name: "İsim",
    clean: "temiz",
    open: "Aç",
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

  // Sunucu enum'larının ekran etiketleri. Eskiden `api/types.ts`'te modül
  // düzeyinde sabit haritalardı; modül düzeyi hook çağıramadığı için dil
  // değişimini göremiyorlardı. Etiket oldukları için yerleri BURASI.
  enums: {
    roomType: {
      CLASSROOM: "Sınıf",          // ekranın adı "Derslikler", tip "Sınıf"
      AMPHI: "Amfi",
      LAB: "Laboratuvar",
    },
    semester: { FALL: "Güz", SPRING: "Bahar", SUMMER: "Yaz" },
    examType: { MIDTERM: "Vize", FINAL: "Final", MAKEUP: "Bütünleme" },
    capability: {
      can_manage_courses: "Dersler",
      can_manage_weekly: "Haftalık Program",
      can_manage_exams: "Sınavlar",
      can_manage_classrooms: "Derslikler",
      can_manage_lecturers: "Öğretim Üyeleri",
      can_approve_schedule: "Program Onaylama",
    },
    auditAction: {
      CREATE: "Ekledi",
      UPDATE: "Düzenledi",
      DELETE: "Sildi",
      SUBMIT: "Onaya gönderdi",
      APPROVE: "Onayladı (yayına aldı)",
      REJECT: "Reddetti",
      WITHDRAW: "Geri çekti",
      INVITE: "Davet etti",
      ACTIVATE: "Hesabını açtı",
      RESET_REQUEST: "Şifre sıfırlama istedi",
      RESET_PASSWORD: "Şifresini yeniledi",
    },
    auditEntity: {
      department: "Bölüm",
      building: "Bina",
      classroom: "Derslik",
      lecturer: "Öğretim üyesi",
      course: "Ders",
      course_section: "Şube",
      exam: "Sınav",
      weekly_entry: "Haftalık giriş",
      user: "Kullanıcı",
    },
  },

  departments: {
    title: "Bölümler",
    add: "Bölüm Ekle",
    edit: "Bölümü Düzenle",
    deleteTitle: "Bölümü Sil",
    deleteModal: "Bölümü sil",
    newOne: "Yeni Bölüm",
    nameLabel: "Bölüm Adı",
    namePlaceholder: "Bilgisayar Mühendisliği",
    codeLabel: "Bölüm Kodu",
    nameRequired: "Bölüm adı boş olamaz",
    codeRequired: "Bölüm kodu boş olamaz",
    created: "Bölüm eklendi",
    updated: "Bölüm güncellendi",
    deleted: "Bölüm silindi",
    deleteFailed: "Bölüm silinemedi",
    noMatch: "Eşleşen bölüm yok.",
    empty: "Henüz bölüm yok.",
    pickOne: "Genel bakışını görmek için bir bölüm seçin.",
    overview: "Genel Bakış",
    managers: "Bölüm Yetkilileri",
    noManagers: "Bu bölüme atanmış yetkili hesap yok.",
    conflicts: "Çakışmalar",
    conflictHint: "engel / uyarı",
    lecturers: "Öğretim Üyeleri",
    quickActions: "Hızlı İşlemler",
    addCourseDenied: "Bu bölümde ders ekleme yetkiniz yok",
    addLecturerDenied: "Öğretim üyesi ekleme yetkiniz yok",
    addLecturer: "Öğretim Üyesi Ekle",
    openWeekly: "Haftalık Programı Aç",
    openExams: "Sınav Takvimini Aç",
  },

  classrooms: {
    title: "Derslikler",
    add: "Derslik Ekle",
    searchPlaceholder: "Derslik kodu ara",
    roomCount: (n: number) => `${n} derslik`,
    noMatch: "Filtreye uyan derslik yok.",
    filter: "Filtre",
    clear: "Temizle",
    roomLabel: "Derslik",
    floor: "Kat",
    capacity: "Kapasite",
    location: "Konum",
    buildingsTitle: "Binalar",
    code: "Kod",
    groundFloor: "Zemin kat",
    floorNo: (n: number) => `${n}. kat`,
    buildingAdded: "Bina eklendi",
    buildingDeleted: "Bina silindi",
    scheduleTitle: "Derslik Programı",
    needBuilding:
      "Derslik eklemeden önce bir bina tanımlamalısınız — derslik bir binaya " +
      "bağlıdır (K-18). \"Binaları Yönet\" ile başlayın.",
    manageBuildings: "Binaları Yönet",
    // Süzgeçler
    building: "Bina",
    allBuildings: "Tüm binalar",
    externalOnly: "Yalnız fakülte dışı",
    external: "fakülte dışı",
    externalParen: (name: string) => `${name} (fakülte dışı)`,
    minCapacity: "En az kapasite",
    anyCapacity: "Kapasite farketmez",
    minPeople: (n: number) => `${n}+ kişi`,
    hideClosed: "Kapalı derslikleri gizle",
    closedHidden: "Kapalılar gizli",
    empty: "Henüz derslik yok.",

    // Tablo
    type: "Tür",
    examCapacity: "Sınav Kont.",
    examCapacityLong: "Sınav Kontenjanı",
    weeklyUsage: "Haftalık Kullanım",
    classLevel: "Sınıf",
    downloadSchedule: "Programı İndir",

    // Form / modal
    edit: "Dersliği Düzenle",
    editShort: "Dersliği düzenle",
    deleteModal: "Dersliği sil",
    searchOrPick: "Ara veya seç",
    buildingNotFound: "Bina bulunamadı",
    pickBuilding: "Bina seçin",
    roomCodeRequired: "Oda kodu boş olamaz",
    capacityPositive: "Kapasite 0'dan büyük olmalı",
    examCapacityTooBig: "Sınav kontenjanı kapasiteyi aşamaz (K-21)",
    examCapacityHelp:
      "Boşluklu oturma düzeni. Opsiyonel (K-21) — boş bırakılırsa sınav " +
      "yerleşiminde uyarı çıkar.",
    deleteHint:
      'Programa veya sınava girmiş bir derslik silinemez; onun yerine "Pasife al" kullanın.',

    updated: "Derslik güncellendi",
    disabled: "Derslik pasife alındı",
    enabled: "Derslik aktifleştirildi",
    activate: "Aktifleştir",

    // Drawer
    placedCourses: "YERLEŞTİRİLEN DERSLER",
    noCourses: "Bu derslikte planlanmış ders yok.",
    section: "Şube",
    studentCount: (n: number) => ` · ${n} öğrenci`,
    overCapacity: " · kapasite aşımı",
    weeklyCourse: "Haftalık ders",
    examCapShort: "Sınav kont.",

    // Binalar
    buildingNameRequired: "Bina adı boş olamaz",
    buildingUpdated: "Bina güncellendi",
    noBuildings: "Henüz bina yok.",
    externalBuilding: "Fakülte dışı bina",
    editNamed: (name: string) => `Düzenle: ${name}`,
  },

  lecturers: {
    title: "Öğretim Üyeleri",
    add: "Öğretim Üyesi Ekle",
    edit: "Öğretim Üyesini Düzenle",
    newOne: "Yeni Öğretim Üyesi",
    deleteModal: "Öğretim üyesini sil",
    nameRequired: "Ad soyad boş olamaz",
    namePlaceholder: "Ayşe Kaya",
    pickUnit: "Kadro birimi seçin",
    pickUnitLong: "Kadro birimini seçin",
    invalidEmail: "Geçerli bir e-posta girin",
    invalidUrl: "Geçerli bir bağlantı girin (http:// ile başlamalı)",
    optional: "Seçin (opsiyonel)",
    detailPage: "Akademik personel sayfası",
    external: "Dış görevli",
    external40a: "Dış görevli (40/a)",
    external40aOption: "40/a — dış görevli",

    created: "Öğretim üyesi eklendi",
    updated: "Öğretim üyesi güncellendi",
    deleted: "Öğretim üyesi silindi",
    deactivated: "Pasife alındı — ders formunda artık önerilmez",
    reactivated: "Yeniden aktifleştirildi",
    activate: "Aktifleştir",
    deleteHint:
      'Derse veya sınava bağlıysa silinmez; onun yerine "Pasife al" kullanın.',

    department: "Bölüm",
    allDepartments: "Tüm bölümler",
    allTitles: "Tüm unvanlar",
    hideInactive: "Pasif kayıtları gizle",
    noMatch: "Filtreye uyan öğretim üyesi yok.",
    empty: "Henüz öğretim üyesi yok.",
    personCount: (n: number) => `${n} kişi`,

    // İçe aktarma (K-50/K-72)
    importTitle: "Siteden Öğretim Üyesi İçe Aktar",
    importCta: "İçe Aktar",
    importTip: "Fakülte akademik personel sayfasından yeni öğretim üyelerini getir",
    importFailed: "İçe aktarma başarısız",
    scanning: "Fakülte sayfası taranıyor…",
    scanFailHint:
      "Kaynak site geçici olarak erişilemez olabilir ya da sayfa yapısı " +
      "değişmiş olabilir. Sorun sürerse yöneticinize bildirin.",
    noChange: "Değişiklik yok",
    nUpdated: (n: number) => `${n} güncellendi`,
    nSkipped: (n: number) => `${n} atlandı`,
    foundSummary: (total: number, known: number, fresh: number) =>
      `Listede ${total} kişi bulundu · ${known} zaten kayıtlı · ${fresh} yeni`,
    updatableSuffix: (n: number) => ` · ${n} güncellenebilir`,
    nothingToImport: "Eklenecek ya da güncellenecek kayıt yok — liste sistemle güncel.",
    newLecturers: "Yeni öğretim üyeleri",
    selectAll: "Tümünü seç",
    selected: "seçili",
    departmentOr40a: "Bölüm ya da 40/a",
    missingInfoTitle: "Eksik bilgisi tamamlanacaklar",
    missingInfoHelp1: "Sistemde kayıtlı ama detay sayfası / e-postası eksik olanlar.",
    missingInfoHelp2: "Yalnız boş alanlar doldurulur, mevcut bilgi değişmez.",
    willBeFilled: (alanlar: string) => `— ${alanlar} doldurulacak`,
    unresolvedWarn: (n: number) =>
      `${n} seçili kişinin bölümü belirlenmedi — bölüm seçin ya da 40/a işaretleyin, aksi halde eklenmez.`,
    updateN: (n: number) => `${n} güncelle`,

    // Drawer
    weeklyHours: "Haftalık saat",
    unit: "GÖREV BİRİMİ",
    openLink: "Aç ↗",
    noCoursesThisTerm: "Bu dönem programda ders yok.",
    coursesTaught: "VERDİĞİ DERSLER",
    weeklyScheduleLabel: "HAFTALIK PROGRAM",
    sectionStudents: (sube: number, ogrenci: number) => `Şube ${sube} · ${ogrenci} öğrenci`,
    notScheduled: "programda değil",
    noAssignedCourses: "Bu dönem atanmış ders yok.",
    editInfo: "Bilgileri düzenle",
    downloadSchedule: "Programı İndir",
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
