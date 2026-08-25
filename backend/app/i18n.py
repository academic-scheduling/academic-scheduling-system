"""K-79 · Dil (TR/EN) altyapısı: istek dilini taşır ve sunucu metinlerini çevirir.

Üç iş yapar:
  1. `Accept-Language` başlığından isteğin dilini çözer.
  2. Dili İSTEK KAPSAMLI ambient bir değere (contextvar) koyar — çakışma motoru
     imzasına dokunmadan dili okuyabilsin diye.
  3. Türkçe `HTTPException` metinlerini çıkışta İngilizceye çevirir (katalog).

**Neden Türkçe metin kodda KANONİK kalıyor (K-79).** Alternatif, 107 `raise`
yerini bir anahtara çevirmekti; bu hem büyük ve riskli bir diff, hem de testlerde
Türkçe metne dayanan 23 iddiayı kırardı. Bunun yerine mesaj çıkışta çevriliyor:
kod okunur kalıyor, katalog tek dosyada duruyor, mevcut testler varsayılan `tr`
ile aynen geçiyor.

Bedeli: Türkçe metin katalogun ANAHTARI. Biri mesajı düzenlerse İngilizcesi
sessizce Türkçeye düşer. Bunu `tests/test_k79_i18n_catalog.py` bekçisi kapatır —
koddaki her `detail=` metnini süpürüp katalogda karşılığı var mı diye bakar.
"""

import re
from contextvars import ContextVar

Lang = str  # "tr" | "en"

DEFAULT_LANG: Lang = "tr"
SUPPORTED: tuple[Lang, ...] = ("tr", "en")

# --------------------------------------------------------------------------
# İstek dili — ambient (contextvar)
# --------------------------------------------------------------------------
# **Neden contextvar, neden parametre DEĞİL (K-79).** Çakışma mesajları motorun
# derininde kuruluyor: `build_result` orchestrator'da 12 yerden çağrılıyor.
# `lang`'i oraya kadar geçirmek 5 orchestrator imzası + 4 conflict_service
# girişi + Intern C'nin sahibi olduğu motor sözleşmesi + 71 motor testi demekti.
# Dil gerçekten de isteğe özgü AMBIENT bir değer (her fonksiyonun umursadığı bir
# girdi değil), o yüzden burada duruyor.
#
# **Neden middleware'de set ediliyor, Depends'te DEĞİL:** FastAPI senkron `def`
# uçlarını ve senkron bağımlılıkları threadpool'da koşturur; bir BAĞIMLILIKTA
# set edilen contextvar o worker'ın context kopyasında kalır ve uca ULAŞMAZ.
# Async middleware'de set edilen değer ise threadpool'a kopyalanır — uçtan
# motora kadar görünür. Bu ayrım sessiz bir tuzaktır (test ederken "bazen
# çalışıyor" gibi görünür), o yüzden yazıya geçti.
_current_lang: ContextVar[Lang] = ContextVar("current_lang", default=DEFAULT_LANG)


def set_lang(lang: Lang) -> None:
    _current_lang.set(lang if lang in SUPPORTED else DEFAULT_LANG)


def get_lang() -> Lang:
    """O anki isteğin dili. İstek bağlamı yoksa (testler, betikler) "tr"."""
    return _current_lang.get()


def parse_accept_language(header: str | None) -> Lang:
    """`Accept-Language` başlığından desteklenen ilk dili seçer.

    Tam RFC 4647 pazarlığı DEĞİL, kasıtlı olarak: istemcimiz başlığı kendi
    koyuyor ("tr" ya da "en"). Yine de tarayıcının doğal başlığı da
    ("en-US,en;q=0.9,tr;q=0.8") anlaşılır olsun diye q-sırası korunarak
    taranıyor — böylece başlık elle set edilmese de makul bir dil seçilir.
    """
    if not header:
        return DEFAULT_LANG
    parcalar = []
    for i, ham in enumerate(header.split(",")):
        parca = ham.strip()
        if not parca:
            continue
        etiket, _, nitelik = parca.partition(";")
        q = 1.0
        if nitelik.strip().startswith("q="):
            try:
                q = float(nitelik.strip()[2:])
            except ValueError:
                q = 0.0
        # i: eşit q'da başlıktaki sıra korunsun (sort kararlı olsun diye).
        parcalar.append((-q, i, etiket.strip().lower()))
    for _, _, etiket in sorted(parcalar):
        kok = etiket.split("-")[0]          # "en-US" -> "en"
        if kok in SUPPORTED:
            return kok
    return DEFAULT_LANG


# --------------------------------------------------------------------------
# Hata mesajı kataloğu: TR -> EN
# --------------------------------------------------------------------------
# Anahtar = koddaki Türkçe metnin BİREBİR kendisi. Bekçi testi bu sözlüğün
# koddaki her `detail=` metnini kapsadığını doğrular.
ERRORS: dict[str, str] = {
    # --- auth / oturum ---
    "Not authenticated": "Not authenticated",
    "Invalid authentication credentials": "Invalid authentication credentials",
    "User not found": "User not found",
    "User account is not active": "User account is not active",
    "Admin privileges required": "Admin privileges required",
    "E-posta veya şifre hatalı": "Incorrect email or password",
    "Hesap aktif değil": "Account is not active",
    "Kullanıcı hesabı aktif değil": "User account is not active",
    "Doğrulama başarısız, lütfen tekrar deneyin":
        "Verification failed, please try again",

    # --- davet / şifre sıfırlama (K-43/K-44) ---
    "Geçersiz davet bağlantısı": "Invalid invitation link",
    "Davet süresi dolmuş": "The invitation has expired",
    "Davet bağlantısı zaten kullanılmış": "This invitation link has already been used",
    "Geçersiz sıfırlama bağlantısı": "Invalid reset link",
    "Sıfırlama bağlantısının süresi dolmuş": "The reset link has expired",
    "Sıfırlama bağlantısı zaten kullanılmış": "This reset link has already been used",

    # --- yetenek bayrakları (deps.py) ---
    "Ders yönetim yetkisi gerekli": "Course management permission required",
    "Derslik yönetim yetkisi gerekli": "Classroom management permission required",
    "Öğretim üyesi yönetim yetkisi gerekli": "Lecturer management permission required",
    "Program onaylama yetkisi gerekli": "Schedule approval permission required",
    "Haftalık program yönetim yetkisi gerekli":
        "Weekly schedule management permission required",
    "Sınav yönetim yetkisi gerekli": "Exam management permission required",

    # --- bölüm / üyelik ---
    "Bölüm bulunamadı": "Department not found",
    "Geçersiz bölüm seçimi": "Invalid department selection",
    "Bu bölümde yetkiniz yok": "You have no permission in this department",
    "Bu derste yetkiniz yok": "You have no permission for this course",

    # --- ders / şube ---
    "Ders bulunamadı": "Course not found",
    "Şube bulunamadı": "Section not found",
    "Geçersiz hoca seçimi": "Invalid lecturer selection",
    "Geçersiz derslik seçimi": "Invalid classroom selection",
    # K-81 · gözetmenler
    "Geçersiz gözetmen seçimi": "Invalid invigilator selection",
    "Aynı gözetmen birden çok kez eklenemez":
        "The same invigilator cannot be added more than once",
    "Sınav sorumlusu aynı zamanda gözetmen olarak eklenemez":
        "The exam supervisor cannot also be added as an invigilator",
    "Geçersiz cohort bölümü": "Invalid cohort department",
    "Bu derste bu şube no zaten var": "This section number already exists for this course",
    "Dersin kendi cohort'u ek olarak eklenemez (zaten kapsanıyor)":
        "The course's own cohort cannot be added as extra (already covered)",
    "Aynı cohort iki kez verildi": "The same cohort was given twice",

    # --- hoca / derslik / bina ---
    "Hoca bulunamadı": "Lecturer not found",
    "Öğretim üyesi bulunamadı": "Lecturer not found",
    "Derslik bulunamadı": "Classroom not found",
    "Bina bulunamadı": "Building not found",

    # --- taslak / onay (K-59/K-60) ---
    "Taslak bulunamadı": "Draft not found",
    "Onay bekleyen taslak bulunamadı": "No pending draft found",
    "Kendi talebinizi onaylayamazsınız — başka bir onay yetkilisi incelemeli":
        "You cannot approve your own request — another approver must review it",
    "Taslak onay bekliyor — düzenlemek için önce geri çekin":
        "The draft is pending approval — withdraw it first to edit",
    "Onaylanmış taslak geçmiş kaydıdır, değiştirilemez":
        "An approved draft is a historical record and cannot be changed",
    "Onay bekleyen taslak silinemez — önce geri çekin":
        "A draft pending approval cannot be deleted — withdraw it first",
    "Onaylanmış taslak geçmiş kaydıdır, silinemez":
        "An approved draft is a historical record and cannot be deleted",
    "Taslak onay beklemiyor": "The draft is not pending approval",
    "Taslak yayındaki programla aynı — onaya gönderilecek değişiklik yok":
        "The draft matches the published schedule — there is no change to submit",
    "Taslakta böyle bir yerleşim yok": "No such placement in this draft",
    "Taslakta böyle bir sınav yok": "No such exam in this draft",
    "Bu ders taslağın kapsamında değil (bölüm + sınıf + dönem)":
        "This course is outside the draft's scope (department + year + semester)",
    "Bu şubenin aynı gün ve saatte aynı türde bir oturumu zaten var":
        "This section already has a session of the same type at the same day and time",

    # --- haftalık program (K-20/K-23) ---
    "Haftalık giriş bulunamadı": "Weekly entry not found",
    "Geçersiz şube seçimi": "Invalid section selection",
    "Online girişte derslik seçilemez (K-23: hibrit ders yok)":
        "A classroom cannot be selected for an online session (no hybrid sessions)",
    "Slot penceresi aşıldı (start_slot + slot_count - 1 ≤ 9 olmalı)":
        "Slot window exceeded (start_slot + slot_count - 1 must be ≤ 9)",

    # --- sınavlar (K-06/K-16) ---
    "Geçersiz ders seçimi": "Invalid course selection",
    "Sınav tarihi hafta içi olmalı (K-06: hafta sonu sınav yok)":
        "The exam date must be a weekday (no weekend exams)",

    # --- ders / bölüm / bina / derslik benzersizlik ---
    "Bu bölüm+yıl+dönemde bu ders kodu zaten kayıtlı":
        "This course code is already registered for this department/year/semester",
    "Ortak olmayan derse ek cohort eklenemez — önce dersi ortak işaretleyin":
        "Extra cohorts cannot be added to a non-common course — mark it common first",
    "Şubenin haftalık program girişi var; önce girişleri silin":
        "The section has weekly schedule entries; delete them first",
    "Bu bölüm kodu zaten kayıtlı": "This department code is already registered",
    "Bu bina adı zaten kayıtlı": "This building name is already registered",
    "Bu binada bu oda kodu zaten kayıtlı":
        "This room code is already registered in this building",
    "Geçersiz bina seçimi": "Invalid building selection",
    "Sınav kontenjanı normal kapasiteyi aşamaz":
        "Exam capacity cannot exceed the regular capacity",
    "Geçerli bir hoca adı girilmeli": "A valid lecturer name is required",

    # --- kullanıcı yönetimi (WP6) ---
    "Kullanıcı bulunamadı": "User not found",
    "Bu e-posta zaten kayıtlı": "This email is already registered",
    "E-posta izinli domainde değil": "The email is not in the allowed domain",
    "Yalnızca bekleyen davetler yeniden gönderilebilir":
        "Only pending invitations can be resent",
    "Kendi rolünüzü veya erişim durumunuzu değiştiremezsiniz. "
    "Bunu başka bir admin yapmalı.":
        "You cannot change your own role or access status. "
        "Another admin must do this.",
    "Kullanılmış hesap silinemez: işlem kayıtlarındaki izi kaybolur. "
    "Erişimi kapatın (status: DISABLED).":
        "A used account cannot be deleted: its trail in the audit log would be lost. "
        "Disable its access instead (status: DISABLED).",

    # --- Bologna import (K-64) ---
    "Bologna sayfası çekilemedi": "Could not fetch the Bologna page",
    "Sayfada ders bulunamadı — URL doğru mu?":
        "No courses found on the page — is the URL correct?",
}

# Dinamik (f-string) mesajlar: birebir eşleşemezler, desenle çevrilir.
# Her girdi (derlenmiş desen, İngilizce şablon) — `\1`, `\2` yakalanan parçalar.
ERROR_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^Bu bina silinemez: (\d+) derslik bağlı\.(.*)$"),
     r"This building cannot be deleted: \1 classroom(s) attached.\2"),
    (re.compile(r"^Bu derslik silinemez: (.+?) bağlı\.(.*)$"),
     r"This classroom cannot be deleted: \1 attached.\2"),
    (re.compile(r"^Bu ders silinemez: (.+?) bağlı\.(.*)$"),
     r"This course cannot be deleted: \1 attached.\2"),
    (re.compile(r"^'(.+?)' ortak dersi zaten bu bölüm/sınıf/dönemde kayıtlı$"),
     r"The common course '\1' is already registered for this department/year/semester"),
]


def translate_error(message: str, lang: Lang) -> str:
    """Bir `detail` metnini hedef dile çevirir; karşılığı yoksa AYNEN döndürür.

    Sessiz düşüş bilinçli: çevirisi olmayan bir mesaj yüzünden istek patlamaz,
    kullanıcı Türkçe metni görür. Kapsamı bekçi testi güvence altına alır.
    """
    if lang == DEFAULT_LANG:
        return message
    birebir = ERRORS.get(message)
    if birebir is not None:
        return birebir
    for desen, sablon in ERROR_PATTERNS:
        if desen.match(message):
            return desen.sub(sablon, message)
    return message
