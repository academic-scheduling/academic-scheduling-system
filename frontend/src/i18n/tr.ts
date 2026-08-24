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
    diffKind: { ADDED: "Eklendi", REMOVED: "Kaldırıldı", MOVED: "Taşındı" },
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
    role: "Rol",
    permissions: "Yetkiler",
    inactive: "Pasif",
    addCourse: "Ders Ekle",
    courses: "Dersler",
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
    closed: "Kapalı",
    weeklyUsageCaps: "HAFTALIK KULLANIM",
    weeklyScheduleCaps: "HAFTALIK PROGRAM",
    externalCaps: "Fakülte dışı",
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
    searchPlaceholder: "Ad, soyad veya e-posta ara",
    titleLabel: "Unvan",
    fullName: "Ad Soyad",
    emailPlaceholder: "ayse.kaya@mu.edu.tr (opsiyonel)",
    homeUnit: "Kadro birimi",
    homeUnitCaps: "Kadro Birimi",
    inactive: "Pasif",
    course: "Ders",
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

  conflicts: {
    title: "Çakışma Raporu",
    loadFailed: "Çakışmalar yüklenemedi",
    allDepartments: "Tüm bölümler",
    allYears: "Tüm sınıflar",
    allSemesters: "Tüm dönemler",
    allKinds: "Tüm türler",
    allRules: "Tüm kurallar",
    yearN: (y: number) => `${y}. Sınıf`,
    clearFilter: "Süzgeci temizle",
    emptyAll: "Çözülmemiş çakışma yok — program yayınlanmaya hazır.",
    emptyFiltered: "Bu süzgece uyan çakışma yok.",
    blocking: "Engel",
    warning: "Uyarı",
    rule: "Kural",
    examConflict: "Sınav",
    weeklyConflict: "Haftalık",
    exam: "Sınav",
    course: "Ders",
    // Dashboard kartı bunu okuyor (rapor sayfası kendi boş metnini kullanır).
    none: "Çakışma bulunamadı.",
    // K-80: süzgeçler "Filtrele" popover'ında toplandı (Dersler deseni).
    filter: "Filtrele",
    department: "Bölüm",
    classYear: "Sınıf",
    semester: "Dönem",
    // Tablo sütunları — her çakışmanın aynı beş sorusu.
    colKind: "Tür",
    colRule: "Kural",
    colConflict: "Çakışma",
    colCohort: "Cohort / zaman",
    colItems: "Çakışan öğeler",
  },

  dashboard: {
    loadFailed: "Dashboard yüklenemedi",
    departments: "Bölümler",
    classrooms: "Derslikler",
    lecturers: "Öğretim Üyeleri",
    courses: "Dersler",
    admins: "Admin",
    subAccounts: "Alt Hesap",
    exams: "Sınavlar",
    conflictCard: "Çakışma (engel / uyarı)",
    conflictsTitle: "Çakışmalar",
    seeAll: (n: number) => `Tümünü gör (${n})`,
  },

  users: {
    name: "Ad",
    statusCol: "Durum",
    permissions: "Yetkiler",
    you: "(siz)",
    allShort: "tümü",
    noMatch: "Filtreye uyan kullanıcı yok.",
    title: "Kullanıcılar",
    invite: "+ Kullanıcı Davet Et",
    inviteTitle: "Kullanıcı Davet Et",
    editNamed: (name: string) => `Düzenle: ${name}`,
    searchPlaceholder: "Ad veya e-posta ara",
    allRoles: "Tüm roller",
    allStatuses: "Tüm durumlar",
    roleAdmin: "Admin",
    roleSub: "Alt hesap",
    status: { PENDING: "Davetli", ACTIVE: "Aktif", DISABLED: "Pasif" },
    readOnly: "sadece okuma",

    resendInvite: "Daveti yeniden gönder",
    cancelInvite: "Daveti iptal et",
    disableAccess: "Erişimi kapat",
    enableAccess: "Erişimi aç",

    fullName: "Ad Soyad",
    emailPlaceholder: "ad.soyad@muh.example.edu.tr",
    role: "Rol",
    cannotChangeOwnRole:
      "Kendi rolünüzü değiştiremezsiniz — bunu başka bir admin yapmalı",
    departments: "Bölümler",
    pick: "Seçin",
    approvePermission: "Onay yetkisi",
    approveDescription:
      "Başkalarının taslaklarını inceleyip yayına alabilir. Kendi talebini onaylayamaz.",
    sendInvite: "Daveti Gönder",

    nameRequired: "Ad boş olamaz",
    emailRequired: "E-posta boş olamaz",
    loadFailed: "Kullanıcılar yüklenemedi",
    updated: "Kullanıcı güncellendi",
    invited: "Davet gönderildi — kullanıcı bağlantıdan hesabını tamamlayacak",
    resent: (email: string) => `Davet yeniden gönderildi: ${email}`,
    sendFailed: "Gönderilemedi",
    accessDisabled: "Erişim kapatıldı",
    accessEnabled: "Erişim yeniden açıldı",

    deleteInviteBody: (name: string, email: string) =>
      `${name} (${email}) için gönderilen davet silinecek.`,
    deleteInviteHint:
      "Davet bağlantısı çalışmaz hale gelir. Kişi henüz giriş yapmadığı için " +
      "geriye hiçbir kaydı kalmaz.",
    deleteInviteCta: "Daveti Sil",
    disableBody: (name: string) => `${name} sisteme giremeyecek.`,
    disableHint:
      "Etki anında: açık oturumu varsa ilk isteğinde düşer. Hesap silinmez — " +
      "işlem kayıtlarındaki izi korunur, istendiğinde yeniden açılabilir.",
    disableCta: "Erişimi Kapat",
  },

  audit: {
    title: "İşlem Kayıtları",
    time: "Zaman",
    who: "Kim",
    action: "Eylem",
    entityType: "Tür",
    record: "Kayıt",
    change: "Değişiklik",
    noMatch: "Filtreye uyan işlem kaydı yok.",
    loadFailed: "Kayıtlar yüklenemedi",
    allUsers: "Tüm kullanıcılar",
    allActions: "Tüm eylemler",
    allTypes: "Tüm türler",
  },

  courses: {
    title: "Dersler",
    add: "Ders Ekle",
    importCta: "İçe Aktar",
    edit: "Dersi Düzenle",
    editShort: "Dersi düzenle",
    deleteModal: "Dersi sil",
    empty: "Henüz ders yok.",
    noMatch: "Filtreye uyan ders yok.",
    searchPlaceholder: "Kod veya ders adı ara",
    filter: "Filtre",
    clear: "Temizle",
    courseCount: (n: number) => `${n} ders`,

    // Süzgeçler
    yearN: (y: number) => `${y}. sınıf`,
    department: "Bölüm",
    allDepartments: "Tüm bölümler",
    lecturer: "Öğretim üyesi",
    allLecturers: "Tüm öğretim üyeleri",
    courseType: "Ders türü",
    allTypes: "Tüm türler",
    semester: "Dönem",
    allSemesters: "Tüm dönemler",
    hideInactive: "Pasif dersleri gizle",
    common: "Ortak",
    hideInactiveCourses: "Pasif dersleri gizle",
    inactive: "Pasif",
    onlineComponents: "Online bileşenler",
    takenBy: "ALDIĞI GRUPLAR",
    sectionsTitle: "ŞUBELER",
    notScheduled: "programda değil",
    required: "Zorunlu",
    elective: "Seçmeli",

    // Tablo
    code: "Kod",
    name: "Ders Adı",
    type: "Tür",
    ects: "AKTS",
    hours: "T+U+L",
    classYear: "Sınıf",
    sections: "Şube",
    noSections: "şube yok",
    sectionCount: (n: number) => `${n} şube`,

    // Form
    pick: "Seçin",
    codeRequired: "Ders kodu boş olamaz",
    nameRequired: "Ders adı boş olamaz",
    pickDepartment: "Bölüm seçin",
    identityLocked: "Dersin kimliği — değiştirilemez (kontrat §6)",
    codeLabel: "Ders Kodu",
    nameLabel: "Ders Adı",
    namePlaceholder: "İstatistik",
    typeLabel: "Ders Türü",
    typeHelp: "Seçmelide cohort çakışması uyarıdır, zorunluda submit engeli (K-05)",
    theory: "Teori (T)",
    practice: "Uygulama (U)",
    lab: "Lab (L)",
    ectsHelp: "Dersin AKTS/ECTS kredisi (opsiyonel).",
    midtermCount: "Vize sayısı",
    midtermHelp: "Bir dersin 1-3 vizesi olabilir. Final ve bütünleme her zaman tektir.",
    theoryOnline: "Teori online",
    practiceOnline: "Uygulama online",
    labOnline: "Lab online",
    commonCourse: "Ortak ders",

    commonAddHint:
      "Aynı kodlu bir ortak ders varsa bu kayıt onun altında toplanır. " +
      "Aldığı diğer grupları kaydettikten sonra Düzenle'den ekleyebilirsiniz.",
    cohortHint:
      "Bu dersi alan diğer bölüm/sınıf/dönem grupları. Dersin kendi bölümünü " +
      "eklemeye gerek yok — zaten kapsanıyor.",
    cohortDup:
      "Bu grup zaten ekli (bölüm + sınıf + dönem). Farklı bir sınıf/dönem ya da " +
      "bölüm seçin.",
    addCohort: "+ Cohort ekle",
    removeCohort: "Cohort'u kaldır",
    duplicateCohort:
      "Aynı grup (bölüm + sınıf + dönem) birden çok kez eklenmiş — tekrarları kaldırın.",

    updated: "Ders güncellendi",
    updatedReset:
      "Ders güncellendi — programa etki eden alan değiştiği için haftalık ve " +
      "sınav yerleşimleri sıfırlandı. Yeniden yerleştirin.",
    created: "Ders eklendi — şimdi şube ekleyin",
    commonSaved: "Ortak ders kaydedildi",

    // Drawer / şubeler
    yearSemester: "Sınıf / Dönem",
    multiCohort: "çok gruplu",
    midterm: "Vize",
    midtermN: (n: number) => `${n} vize`,
    onlineComponent: (parcalar: string) => `Online bileşen: ${parcalar}`,
    addSection: "Şube ekle",
    noSectionsYet: "Henüz şube yok — ders programa girmeden şube eklenmeli.",
    editSectionNamed: (no: number) => `Düzenle: Şube ${no}`,
    newSection: "Yeni şube",
    sectionNo: "Şube No",
    expectedStudents: "Beklenen Öğrenci",
    lecturerLabel: "Öğretim Üyesi",
    notFound: "Bulunamadı",
    pickLecturer: "Öğretim üyesi seçin",
    sectionNoPositive: "Şube no 0'dan büyük olmalı",
    expectedPositive: "Beklenen öğrenci 0'dan büyük olmalı",
    sectionUpdated: "Şube güncellendi",
    sectionCreated: "Şube eklendi",
    sectionDeleted: "Şube silindi",
    deleteSection: "Şubeyi sil",
  },

  exams: {
    commonCourses: "Ortak dersler",
    title: "Sınav Takvimi",
    loadFailed: "Sınavlar yüklenemedi",

    // Ay adları — tarih biçimleme (JS Intl yerine sabit liste: mevcut davranış korunuyor)
    monthsShort: ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
                  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"],
    monthsLong: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
                 "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],

    // Vurgulama (derin bağlantı)
    highlightTitle: (rule: string) => `Çakışan Sınavlar Vurgulandı (${rule})`,
    highlightBody: (codes: string) =>
      `${codes} — YAYINDAKİ sınav takviminde gösteriliyor.`,
    conflict: "Çakışma",
    highlightNotFound: "Vurgulanacak sınav bulunamadı.",

    noConflictFor: (baslik: string) => `${baslik} — çakışma yok`,
    conflictList: (n: number, kurallar: string) => `${n} çakışma: ${kurallar}`,
    undone: (etiket: string) => `Geri alındı: ${etiket}`,

    removeConfirm: (kod: string, tur: string) =>
      `${kod} ${tur} sınavı taslaktan çıkarılsın mı?\n\n` +
      `Yayındaki takvimden ancak onaylandığında düşer.`,
    removeLabel: (kod: string, tur: string) => `${kod} ${tur} çıkarma`,
    removed: "Sınav taslaktan çıkarıldı",
    removeFailed: "Çıkarılamadı",
    moveLabel: (kod: string, tur: string) => `${kod} ${tur} taşıma`,
    moved: "Sınav taşındı",
    moveFailed: "Taşınamadı",
    editLabel: (kod: string, tur: string) => `${kod} ${tur} düzenleme`,

    draftOpened: (n: number) =>
      `Taslak açıldı — yayındaki sınav takviminin kopyası (${n} sınav). ` +
      `Değişiklikleriniz yalnız size görünür, onaylanınca yayına geçer.`,
    draftFailed: "Taslak açılamadı",

    yearN: (y: number) => `${y}. sınıf`,
    prevWeek: "Önceki hafta",
    nextWeek: "Sonraki hafta",
    thisWeek: "Bu Hafta",
    undoTip: (n: number) => `Son taslak değişikliğini geri al${n ? ` (${n})` : ""}`,
    undo: "Geri Al",
    exportMidterm: "Vize Programı (Excel)",
    exportFinal: "Final + Bütünleme (Excel)",
    searchCourse: "Ders ara",
    noCourseInYear: "Bu sınıfta ders yok.",
    elective: "Seçmeli",

    conflictsTitle: "Sınav çakışmaları",
    noConflicts: "Sınav takviminde çakışma yok.",

    prevMonth: "Önceki ay",
    nextMonth: "Sonraki ay",
    hasExamThisWeek: "Bu haftada sınav var",

    cardEditable: (kod: string, bas: string, bit: string) =>
      `${kod} · ${bas}-${bit} · düzenlemek için tıkla, taşımak için sürükle`,
    cardReadOnly: (kod: string, bas: string, bit: string, ogrenci: number) =>
      `${kod} · ${bas}-${bit} · ${ogrenci} öğrenci`,
    publishedSuffix: " · yayında — değiştirmek için taslak açın",
    deleteExam: "Sınavı sil",
    noClassroom: "Derslik atanmadı",
    hardTip: "Engelleyici çakışma — Çakışmalar bölümüne gitmek için tıklayın",
    warnTip: "Uyarı — Çakışmalar bölümüne gitmek için tıklayın",

    updated: "Sınav güncellendi",
    added: "Sınav taslağa eklendi",
    addTitle: "Sınav ekle",
    course: "Ders",
    pickCourse: "Ders seç",
    noCourse: "Ders yok",
    examType: "Sınav türü",
    whichMidterm: "Kaçıncı vize",
    registered: " · kayıtlı",
    date: "Tarih",
    weekendError: "Hafta sonu (Cumartesi/Pazar) sınav günü olarak seçilemez (K-06)",
    start: "Başlangıç",
    duration: "Süre (dk)",
    classrooms: "Derslikler",
    pickClassrooms: "Derslik seç (birden çok olabilir)",
    capacityOf: (n: number) => ` · ${n} kişi`,
    supervisor: "Sorumlu",
    pickLecturer: "Öğretim üyesi seç",
    note: "Not",
    optional: "isteğe bağlı",

    publishTitle: "Sınavları yayınla",
    publishBody: (n: number) =>
      `${n} taslak sınav yayınlanacak. Yayınlananlar kilitlenir; ` +
      `düzenlemek için tekrar taslağa çevirmen gerekir.`,
    publishRejected: "Yayınlama reddedildi",
    publishBlocked:
      "Engelleyici çakışmalar var — hiçbir sınav yayınlanmadı. Düzeltip tekrar dene.",
    noClassroomShort: " · derslik yok",
    publishFailed: "Yayınlanamadı",
    retry: "Tekrar dene",
    publish: "Yayınla",
  },

  weekly: {
    relevantCohort: "ilgili cohort",
    commonCourses: "Ortak dersler",

    title: "Haftalık Program",
    loadFailed: "Program yüklenemedi",
    notLoaded: "Yüklenemedi",

    session: { THEORY: "Teori", PRACTICE: "Uygulama", LAB: "Lab" },
    delivery: {
      FACE_TO_FACE: "Yüz yüze",
      ONLINE_SYNC: "Online (eşzamanlı)",
      ONLINE_ASYNC: "Online (asenkron)",
    },

    highlightTitle: (rule: string) => `Çakışan Dersler Vurgulandı (${rule})`,
    highlightBody: (codes: string, gorunum: string) =>
      `${codes} — YAYINDAKİ programda, ${gorunum} görünümüne geçildi.`,
    yearN: (y: number) => `${y}. sınıf`,
    conflict: "Çakışma",
    highlightNotFound: "Vurgulanacak kayıt bulunamadı.",

    draftOpened: (n: number) =>
      `Taslak açıldı — yayındaki programın kopyası (${n} yerleşim). ` +
      `Değişiklikleriniz yalnız size görünür, onaylanınca yayına geçer.`,
    draftFailed: "Taslak açılamadı",
    undone: (etiket: string) => `Geri alındı: ${etiket}`,
    noConflictFor: (baslik: string) => `${baslik} — çakışma yok`,
    conflictList: (n: number, kurallar: string) => `${n} çakışma: ${kurallar}`,

    sharedCourseTitle: (kod: string) => `${kod} ORTAK bir derstir.`,
    sharedCourseBody: (fiil: string) =>
      `Bu dersi ${fiil}, onu alan diğer bölümlerin programını da etkiler:`,
    sharedCourseAsk: "Devam edilsin mi? (Değişiklik onaylanana kadar yayına geçmez.)",
    verbMove: "taşımak",
    verbRemove: "kaldırmak",
    moveLabel: (kod: string, sube: number) => `${kod}-${sube} taşıma`,
    moved: "Giriş taşındı",
    moveFailed: "Taşınamadı",
    deleteConfirm: (kod: string, sube: number) => `${kod}-${sube} girişi silinsin mi?`,
    deleted: "Giriş silindi",

    undoTip: (n: number) => `Son taslak değişikliğini geri al${n ? ` (${n})` : ""}`,
    undo: "Geri Al",
    searchCourse: "Ders ara",
    noCourseInYear: "Bu sınıfta ders yok.",
    noMatch: "Eşleşen ders yok.",
    noSections: "şube yok",
    noSectionsTitle: (kod: string) => `${kod} — şube yok`,
    noSectionsBody:
      "Programa eklemek için önce Dersler sekmesinden bu derse şube ekleyin.",
    elective: "Seçmeli",

    conflictsTitle: "Çakışmalar",
    conflictsDraftHint:
      "Taslağınızın satırlarına dokunan çakışmalar — karşı taraf başka bir " +
      "sınıfın yayındaki dersi olabilir.",
    conflictsPublishedHint: "Yayındaki programın çakışmaları.",
    noConflicts: "Haftalık programda çakışma yok.",

    sectionOption: (no: number, hoca: string, ogrenci: number) =>
      `Şube ${no} — ${hoca} · ${ogrenci} öğrenci`,
    saved: "Giriş kaydedildi (taslak)",
    editLabel: (kod: string, sube: number) => `${kod}-${sube} düzenleme`,
    updated: "Giriş güncellendi",

    sectionsCount: (n: number) => `${n} şube`,
    roomsCount: (n: number) => ` · ${n} derslik`,
    online: "online",
    parallelSections: (n: number) => `${n} paralel şube — listelemek için tıkla`,
    cardEditable: "Düzenlemek için tıkla, taşımak için sürükle",
    deleteEntry: "Girişi sil",
    hardTip: "Engelleyici çakışma — Çakışmalar bölümüne gitmek için tıklayın",
    warnTip: "Uyarı — Çakışmalar bölümüne gitmek için tıklayın",
    groupTitle: (kod: string, gun: string, saat: string, n: number) =>
      `${kod} · ${gun} ${saat} · ${n} şube`,

    course: "Ders",
    pickCourse: "Ders seç",
    noCourse: "Ders yok",
    section: "Şube",
    pickSection: "Şube seç",
    pickCourseFirst: "Önce ders seçin",
    onlyOneSection: "Bu dersin tek şubesi var",
    noSectionOption: "Şube yok",
    sessionType: "Oturum türü (T/U/L)",
    deliveryType: "Çevrimiçi türü",
    classroom: "Derslik",
    pickClassroom: "Derslik seç",
    noClassroom: "Derslik yok",
    slotCount: "Slot sayısı",
    addEntry: (gun: string, saat: string) => `Ders ekle · ${gun} ${saat}`,
    blockersShort: "engel",
    warningsShort: "uyarı",
  },

  // K-79: `toLocaleString` locale'i de dile bağlı — 4 yerde "tr-TR"
  // sabitti, İngilizce arayüzde Türkçe ay adı basıyordu.
  locale: "tr-TR",

  days: {
    weekdayShort: ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"],
    minutesShort: "dk",
    short: { 1: "Pzt", 2: "Sal", 3: "Çar", 4: "Per", 5: "Cum" } as Record<number, string>,
    long: { 1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma" } as Record<number, string>,
  },

  draft: {
    identical: "Taslak yayındaki programla birebir aynı.",
    colChange: "Değişim",
    colCourse: "Ders",
    colBefore: "Önce",
    colAfter: "Sonra",
    sectionOf: (kod: string, sube: number) => `${kod} · Şube ${sube}`,
    noExams: "Taslakta hiç sınav yok.",
    movedTag: "taşındı",
    // K-80: K-79'dan kaçmış iki metin — sınav listesindeki "eklendi"
    // rozeti ve öğrenci sayısı ("120 öğrenci") sabit Türkçeydi.
    addedTag: "eklendi",
    studentCount: (n: number) => `${n} öğrenci`,
    noClassroom: "Derslik atanmadı",
    undoFailed: "Geri alınamadı",
    // Taslak türü / satır adı. `rowsPlural` AYRI bir girdi: Türkçede
    // "{satırAdı}lar" diye ek getiriliyordu, İngilizcede çoğul öyle çalışmıyor.
    kind: { WEEKLY: "haftalık program", EXAM: "sınav takvimi" },
    row: { WEEKLY: "yerleşim", EXAM: "sınav" },
    rowsPlural: { WEEKLY: "yerleşimler", EXAM: "sınavlar" },
    status: {
      OPEN: "Taslak", PENDING: "Onay bekliyor",
      APPROVED: "Onaylandı", REJECTED: "Reddedildi",
    },

    publishedOf: (tur: string) => `Yayındaki ${tur}`,
    publishInfo: "Yayın bilgisi",
    loading: "Yükleniyor…",
    noApprovedChange: (tur: string) =>
      `Bu ${tur} için henüz onaylı bir değişiklik yok. Değişiklik için taslak açın.`,
    editedBy: "Düzenleyen:",
    approvedBy: "Onaylayan:",
    publishedAt: "Yayınlanma:",

    diffFailed: "Fark alınamadı",
    withdrawn: "Talep geri çekildi — taslak yeniden düzenlenebilir",
    withdrawFailed: "Geri çekilemedi",
    deleteConfirm: (ad: string, tur: string) =>
      `"${ad}" taslağı silinsin mi? Yayındaki ${tur} etkilenmez.`,
    deleted: "Taslak silindi",
    deleteFailed: "Silinemedi",
    pickCohortFirst:
      "Önce bölüm ve sınıf seçin (ortak dersler görünümünde taslak açılmaz)",
    returnToDraftTip: (n: number) =>
      `Bu cohort için açık taslağınıza döner (${n} değişiklik)`,
    openDraftTip: (tur: string) =>
      `Yayındaki ${tur} kopyalanarak açılır; yalnız siz görürsünüz`,
    returnToDraft: "Taslağa Dön",
    openDraft: "Taslak Aç",
    seeDiff: "Farkı Gör",
    emptyDraft: "Taslağı boşalt",
    clear: "Temizle",
    deleteDraft: "Taslağı sil",
    withdraw: "Geri Çek",
    backToPublished: "Yayına Dön",
    submitTip: "Onay yetkilisi inceleyip yayına alacak",
    submitDeniedTip: (tur: string) =>
      `Onaya göndermek için ${tur} yetkisi ve bu bölümde üyelik gerekir`,
    submit: "Onaya Gönder",

    clearBody: (satirlar: string, tur: string) =>
      `Taslaktaki tüm ${satirlar} silinecek. Yayındaki ${tur} etkilenmez.`,
    clearShared: "Ortak dersleri de sil",
    clearSharedHelp:
      "Bu cohort'taki ortak (servis) dersler de silinsin — onları alan diğer " +
      "bölümlerin taslağını da etkileyebilir. İşaretlemezseniz ortak dersler korunur.",
    empty: "Boşalt",
    cleared: (n: number, satir: string) => `${n} ${satir} silindi`,
    preservedShared: (n: number) => ` · ${n} ortak ders korundu`,
    clearFailed: "Temizlenemedi",

    diffTitle: (tur: string) => `Yayındaki ${tur} ile fark`,
    submitted: "Onaya gönderildi",
    submittedWarnings: (n: number) =>
      `${n} uyarı var ama engellemiyor — onaylayıcı görecek`,
    submittedOk: "Bir onay yetkilisi inceleyip yayına alacak",
    submitFailed: "Gönderilemedi",
    submitTitle: "Onaya gönder",
    noteLabel: "Not (isteğe bağlı)",
    noteHelp: "Onaylayıcı bunu görecek — neden değiştirdiğinizi yazın",
    notePlaceholder: "Örn. 3. sınıf laboratuvarı Çarşamba kapalı olduğu için kaydırıldı",
    submitBlockedTitle: "Gönderilemedi — hard çakışma",
    retry: "Tekrar dene",
    send: "Gönder",

    pendingNote:
      "Onay bekliyor — inceleme sürerken taslak kilitlidir. Düzenlemek için geri çekin.",
    rejected: "Reddedildi",
  },

  publishing: {
    blockersCaps: "ENGEL",
    warningsCaps: "UYARI",
    title: "Yayın Merkezi",
    loadFailed: "Yayın Merkezi yüklenemedi",
    cohortName: (bolum: string, yil: number, donem: string) =>
      `${bolum} · ${yil}. sınıf · ${donem}`,

    groups: {
      PENDING: "Onay bekleyenler",
      // K-80: bu grupta yalnız KENDİ taslaklarımız listeleniyor (K-59
      // gizliliği) — başlık bunu söylesin.
      OPEN: "Taslaklarınız",
      REJECTED: "Reddedilenler",
      // K-80: "Yayında" bir DURUM adıydı; grup ise artık "beni ilgilendiren
      // onaylar"ı topluyor (başkalarınınki dahil), yani eylemin adı doğru.
      APPROVED: "Onaylananlar",
    },
    // K-80: bu kuyrukta ARAMA YOK (neyin arandığı belirsizdi: bölüm mü,
    // gönderen mi, tarih mi) ve boş grup cümlesi de kaldırıldı — boş grup
    // zaten boş görünüyor. Daraltmayı tür süzgeci yapıyor.
    changeCount: (n: number) => `${n} değişiklik`,
    yourRequest: "kendi talebiniz",
    pickOne: "İncelemek için soldan bir kayıt seçin.",
    loading: "Yükleniyor…",
    detailFailed: "İnceleme yüklenemedi",

    published: "Yayına alındı",
    appliedN: (n: number) => `${n} değişiklik uygulandı`,
    warningsRemain: (n: number) => ` · ${n} uyarı görünür kaldı`,
    approveFailed: "Onaylanamadı",
    withdrawn: "Talep geri çekildi — taslak yeniden düzenlenebilir",
    withdrawFailed: "Geri çekilemedi",
    deleteConfirm: (ad: string) =>
      `"${ad}" taslağı silinsin mi? Yayındaki program etkilenmez.`,
    // K-80: K-79'dan kaçmış dört sabit metin. Dördü de kaçak tarayıcısının
    // "konum" ölçütüne uyuyordu ama gözden kaçmıştı; katalog burada kapanıyor.
    deleted: "Taslak silindi",
    deleteFailed: "Silinemedi",
    blockersToFix: (n: number) => `${n} engel giderilmeli`,
    sharedAffected: (bolumler: string) => `Ortak ders — etkilenen: ${bolumler}`,

    examSchedule: "Sınav takvimi",
    weeklySchedule: "Haftalık ders programı",
    // K-80: "kim, ne zaman" başlıkta vurgulanıyor. İsim ile fiilin sırası
    // dile bağlı olduğu için (TR "Ali gönderdi", EN "Sent by Ali") parçalanmaz,
    // tek şablon kalır ve vurgu satırın tamamına verilir.
    sentByOn: (kim: string, ne_zaman: string) => `${kim} gönderdi · ${ne_zaman}`,
    openedByOn: (kim: string, ne_zaman: string) => `${kim} açtı · ${ne_zaman}`,

    staleTitle: "Bu taslak güncel olmayabilir",
    staleBody: (tarih: string, tur: string) =>
      `Taslak ${tarih} tarihinde açıldı; yayındaki ${tur} o tarihten sonra`,
    staleTimes: (n: number) => `${n} kez`,
    staleUpdated: "güncellendi",
    staleLastBy: (kim: string) => ` (son: ${kim})`,
    staleTail: "Aşağıdaki listede onaylanırsa",
    staleWillRevert: "geri alınacak",
    staleTail2: "değişiklikler de olabilir.",

    statChange: "DEĞİŞİKLİK",
    // K-80: "DÖNEM" yerine BÖLÜM — dönem başlıkta zaten yazıyor, bölümün
    // kodu ise kaydı tek başına tanıtan bilgi.
    statDepartment: "BÖLÜM",
    gridTitle: "PROGRAM GÖRÜNTÜSÜ",
    // K-80: ızgarada ÜÇ durum var (ProposedGrid: yeşil eklendi, mavi taşındı,
    // gri değişmedi) ama açıklama ikisini anlatıyordu — mavi rozetlerin ne
    // demek olduğu okunamıyordu.
    legendAdded: "eklenen",
    legendMoved: "taşınan",
    legendExisting: "değişmeyen",
    legendBlocking: "engel",
    legendWarning: "uyarı",
    // K-80: kaldırılan satır ızgarada gösterilemez (artık bir yeri yok);
    // sessizce yutmak yerine sayısı söyleniyor, dökümü listede.
    removedNotShown: (n: number) => `${n} kaldırılan ızgarada görünmez`,
    changeBreakdown: (eklenen: number, tasinan: number, kaldirilan: number) =>
      `${eklenen} eklendi · ${tasinan} taşındı · ${kaldirilan} kaldırıldı`,
    changesTitle: "DEĞİŞİKLİKLER",
    conflictCheck: "ÇAKIŞMA KONTROLÜ",

    // K-80 · kuyruk tür süzgeci
    kindAll: "Tümü",
    kindWeekly: "Haftalık",
    kindExam: "Sınav",

    // K-80 · onaylanan kaydın dondurulmuş görüntüsü
    // K-80: onaylanan görüntü DONMUŞ, "Programda gör" ise canlı yayına
    // götürür. Arada başka bir onay geçtiyse bu ikisi ayrışır.
    superseded: "bu cohort sonradan güncellendi",
    supersededTip: (kim: string, ne_zaman: string) =>
      `Bu onaydan sonra aynı cohort için ${kim} tarafından hazırlanan bir değişiklik daha yayına alındı (${ne_zaman}). Yukarıdaki görüntü bu onayın anlık hâlidir; "Programda gör" güncel yayını açar.`,
    appliedChangesTitle: "YAYINA ALINAN DEĞİŞİKLİKLER",

    hardBlocks: "Hard çakışma çözülmeden onaylanamaz",
    approveTip: "Değişiklikleri yayına al",
    approve: "Onayla ve yayınla",
    reject: "Reddet",
    withdraw: "Geri çek",
    selfApprove: "Kendi talebinizi onaylayamazsınız — başka bir onay yetkilisi incelemeli.",
    editInSchedule: "Programda düzenle",
    submitForApproval: "Onaya gönder",
    viewInSchedule: "Programda gör",

    chAdded: "EKLENDİ",
    chMoved: "TAŞINDI",
    chRemoved: "KALDIRILDI",
    identical: "Taslak yayındaki programla birebir aynı.",
    sectionOf: (kod: string, sube: number) => `${kod} · Şube ${sube}`,

    noBlockers: "Engelleyici çakışma yok.",
    rejectedByConflict: "Onaylanamadı — talep güncel programla çakışıyor:",

    decidedByReject: "REDDEDEN",
    decidedByApprove: "ONAYLAYAN",

    // K-80 · karar notu: kutu artık kalıcı, onayda da reddetmede de aynı not.
    decisionNoteTitle: "KARAR NOTU",
    // K-80: yardım cümlesi kutunun altından kalktı; "opsiyonel" başlığın
    // yanında duruyor — bilgi aynı yerde, satır kazanılıyor.
    decisionNoteOptional: "KARAR NOTU (opsiyonel)",
    // K-80: gönderim notu artık modalda değil, incelemenin yanında —
    // yazılırken ve gönderildikten sonra AYNI yerde duruyor.
    submitNoteOptional: "ONAYLAYICIYA NOT (opsiyonel)",
    submitNoteTitle: "GÖNDERENİN NOTU",
    decisionNotePlaceholder: "Gönderene iletilecek not",
    rejectNeedsNote: "Reddetmek için gerekçe yazın",
    rejected: "Talep reddedildi — gerekçe gönderene iletildi",
    rejectFailed: "Reddedilemedi",

    submitted: "Onaya gönderildi",
    submitBlocked: (kurallar: string) =>
      `Hard çakışma nedeniyle gönderilemedi: ${kurallar}`,
    submitFailed: "Gönderilemedi",
  },

  changeFeed: {
    title: "Bölümünüzü etkileyen son değişiklikler",
    open: "Aç",
    examSchedule: "sınav takvimi",
    weeklySchedule: "ders programı",
  },

  courseInfo: {
    commonCourseHours: (T: number, U: number, L: number) =>
      `Ortak ders · T${T}+U${U}+L${L}`,
    hoursOf: (T: number, U: number, L: number) => `T${T}+U${U}+L${L}`,
    ectsOf: (n: number) => ` · ${n} AKTS`,
    required: "Zorunlu",
    sectionsCount: (n: number) => `Şubeler (${n})`,
    sharedCourseDepts: (n: number) => `ortak ders — ${n} bölüm`,
    yearSemester: (yil: number, donem: string) => `${yil}. sınıf · ${donem} · `,
    elective: "Seçmeli",
    common: "Ortak",
    exams: "Sınavlar",
    noExams: "Sınav eklenmedi.",
    noSections: "Şube yok — Dersler'den ekleyin.",
  },

  import: {
    title: "Bologna'dan Ders İçe Aktar",
    pickTitle: "Dersleri Seç ve İçe Aktar",
    doneTitle: "İçe Aktarma Tamamlandı",
    done: (ders: number, sube: number) =>
      `${ders} ders eklendi, ${sube} şube açıldı`,
    failed: "İçe aktarma başarısız",
    alreadySectioned: (n: number) => ` · ${n} tanesi zaten şubeli`,
    duplicateNamed: (n: number) => ` · ${n} aynı adlı (aşağıda)`,
    selectAll: "Tümünü seç",
    code: "Kod",
    name: "Ad",
    classYear: "Sınıf",
    semester: "Dönem",
    type: "Tür",
    lecturerSection: "Hoca / Şube",
    targetDepartment: "Hedef bölüm",
    targetHelp:
      "Bologna'daki bölümün dersleri bu bölüme eklenir. Karşılığı yoksa önce " +
      "Bölümler'den oluşturun.",
    pickDepartment: "Bölüm seçin",
    urlLabel: "Bologna sayfası adresi",
    urlHelp: "Bölümün bilgi paketi ders sayfasının URL'ini yapıştırın (…curSunit=… içermeli).",
    pickRow: (kod: string) => `${kod} seç`,
    editRow: (kod: string) => `${kod} düzenle`,
    sectioned: "şubeli",
    registeredNoSection: "kayıtlı · şubesiz",
    elective: "Seçmeli",
    required: "Zorunlu",
    common: "Ortak",
    alreadySectionedTag: "zaten şubeli",
    midterm: "Vize",
    commonCourse: "Ortak ders",
    lecturerNotFound: "hoca bulunamadı",
    unmatched: "eşleşmedi — hoca seç",
  },

  miniWeek: { empty: "Programda ders yok." },

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
