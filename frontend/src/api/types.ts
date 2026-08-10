// Kontrat (docs/api_kontrat.md) cevap şekillerinin TypeScript karşılığı.
// backend/app/schemas.py ile birebir eş tutulur; orada değişen burada değişir.

/** Kontrat §1 · UserPublic.role */
export type Role = "ADMIN" | "SUB_ACCOUNT";

/** Kontrat §1 · login cevabındaki `user` ve GET /auth/me cevabı.
 *
 *  K-25: yetenek bayrakları — ADMIN'de hepsi true gelir (rol muafiyeti
 *  sunucuda uygulanır, cevaba yansıtılır), yani UI'da ayrıca rol kontrolü
 *  yapmaya gerek yoktur.
 *  K-26: department_ids YAZMA kapsamıdır; okuma zaten tüm workgroup'ta serbest.
 */
export type User = {
  id: number;
  name: string;
  role: Role;
  department_ids: number[];
  can_manage_courses: boolean;
  can_manage_weekly: boolean;
  can_manage_exams: boolean;
  can_manage_classrooms: boolean;
  can_manage_lecturers: boolean;
  can_approve_schedule: boolean;      // K-59: taslağı yayına alma
};

/** Kontrat §1 · POST /auth/login cevabı */
export type LoginResponse = {
  access_token: string;
  user: User;
};

/** Kontrat §1 · GET /auth/invitation/{token} cevabı (K-24) */
export type InvitationPreview = {
  email: string;
  name: string;
};

/** Kontrat §1 · POST /auth/complete-invitation cevabı (ve tüm {message} cevapları) */
export type MessageResponse = {
  message: string;
};

/** Kontrat §1 · GET /auth/reset/{token} cevabı (K-43).
 *  Davet önizlemesinden dar: yalnız e-posta, ad yok. */
export type PasswordResetPreview = {
  email: string;
};

/** Kontrat §3 · GET /departments elemanı */
export type Department = {
  id: number;
  name: string;
  code: string;
  active: boolean;
  /** Resmi sınav programı başlığı için İngilizce ad + fakülte (opsiyonel). */
  name_en: string | null;
  faculty_en: string | null;
};

/** Kontrat §4 · GET /lecturers elemanı (K-28: active dahil) */
export type Lecturer = {
  id: number;
  /** K-52: yalnız ad (unvansız). Unvan ayrı `title` alanında. */
  full_name: string;
  /** K-52: akademik unvan ("Prof. Dr."), ad'dan ayrı. null = girilmemiş. */
  title: string | null;
  /** Unvansız, küçük harf ad — alfabetik sıralama bunun üzerinden yapılır (K-28). */
  normalized_name: string;
  /** K-52: e-posta (opsiyonel; web import doldurur ya da elle girilir). */
  email: string | null;
  is_external: boolean;
  active: boolean;
  /** Asli (kendi) bölüm. Hoca başka bölümlerde de ders verebilir; bu aidiyettir.
   *  null = eski/import kayıt, henüz atanmadı. */
  department_id: number | null;
  /** K-50: web import'ta detay sayfasından okunan birimler. Görev = fiilen
   *  ders verdiği bölüm, Kadro = resmi kadro; ikisi farklı olabilir. Elle
   *  eklenen kayıtta null. */
  duty_unit: string | null;
  cadre_unit: string | null;
};

/** K-50 · POST /lecturers/import/preview cevabındaki tek aday satır. */
export type ImportRow = {
  full_name: string;
  /** K-52: siteden kanonikleştirilen unvan ("Dr. Öğr. Üyesi"), ad'dan ayrı. */
  title: string | null;
  normalized_name: string;
  duty_unit: string | null;
  cadre_unit: string | null;
  email: string | null;
  department_id: number | null;
  department_label: string | null;
  detail_url: string;
};

/** K-50 · önizleme cevabı — hiçbir şey yazılmadan sistemdeki farkı gösterir. */
export type ImportPreview = {
  new: ImportRow[];
  already_present: number;
  list_total: number;
};

/** K-50 · commit cevabı. */
export type ImportCommit = {
  created: Lecturer[];
  skipped: string[];
};

/** Kontrat §5 · GET /buildings elemanı (K-18, K-30) */
export type Building = {
  id: number;
  name: string;
  /** K-30: fakülte dışı bina. Yalnız etiket+filtre; motor davranışını değiştirmez. */
  is_external: boolean;
  active: boolean;
};

/** Derslik cevabına gömülü kısa bina gösterimi */
export type BuildingRef = {
  id: number;
  name: string;
  is_external: boolean;
};

/** K-31 · dersliğin fiziksel türü. Motor okumaz; bilgi + filtre. */
export type RoomType = "CLASSROOM" | "AMPHI" | "LAB";

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  CLASSROOM: "Sınıf",          // ekranın adı "Derslikler" olduğu için tip "Sınıf"
  AMPHI: "Amfi",
  LAB: "Laboratuvar",
};

/** Kontrat §5 · GET /classrooms elemanı */
export type Classroom = {
  id: number;
  building: BuildingRef;
  room_code: string;
  room_type: RoomType;
  capacity: number;
  /** K-21: opsiyonel — boşsa sınav yerleşiminde uyarı üretir */
  exam_capacity: number | null;
  active: boolean;
};

export type SemesterType = "FALL" | "SPRING" | "SUMMER";

export const SEMESTER_LABELS: Record<SemesterType, string> = {
  FALL: "Güz",
  SPRING: "Bahar",
  SUMMER: "Yaz",
};

export type SessionType = "THEORY" | "PRACTICE" | "LAB";
export type DeliveryMode = "FACE_TO_FACE" | "ONLINE_SYNC" | "ONLINE_ASYNC";
export type EntryStatus = "DRAFT" | "SUBMITTED";

/** Kontrat §7 · GET /weekly-entries elemanı */
export type WeeklyEntry = {
  id: number;
  section: { id: number; section_no: number; course: { id: number; code: string; name: string } };
  classroom: Classroom | null;
  day_of_week: number;
  start_slot: number;
  slot_count: number;
  session_type: SessionType;
  delivery_mode: DeliveryMode;
  status: EntryStatus;
};

/** Kontrat §8 · Sınav türleri (K-16: sınav DERS düzeyindedir, şubeden bağımsız) */
export type ExamType = "MIDTERM" | "FINAL" | "MAKEUP";

export const EXAM_TYPE_LABELS: Record<ExamType, string> = {
  MIDTERM: "Vize", FINAL: "Final", MAKEUP: "Bütünleme",
};

/** Sınav cevabının içine gömülen kısa ders gösterimi. */
export type CourseRef = { id: number; code: string; name: string };

/** K-17: sınav dersliği `exam_capacity` taşır — `capacity` DEĞİL (boşluklu oturma). */
export type ExamClassroomRef = {
  id: number;
  building: BuildingRef;
  room_code: string;
  exam_capacity: number | null;
};

/** Kontrat §8 · GET /exams elemanı */
export type Exam = {
  id: number;
  course: CourseRef;
  exam_type: ExamType;
  /** K-46: kaçıncı vize (1-3). Final/büt'te her zaman 1. */
  exam_index: number;
  /** YYYY-MM-DD — haftalık programdan farkı: gerçek takvim tarihi */
  exam_date: string;
  /** HH:MM — slot yok, saat kısıtı yok (K-06: 17:30 sonrası serbest) */
  start_time: string;
  duration_minutes: number;
  /** Çoklu derslik (K-17); boş liste = derslik henüz atanmadı */
  classrooms: ExamClassroomRef[];
  lecturer: SectionLecturerRef;
  /** Türetilir: dersin aktif şubelerinin expected_students toplamı (K-16) */
  total_expected_students: number;
  notes: string | null;
  status: EntryStatus;
};

/** POST/PATCH cevabı: conflicts dolu olsa bile kayıt BAŞARILIDIR (K-03). */
export type ExamSaveResponse = { exam: Exam; conflicts: ConflictResult[] };

/** Şube/sınav cevabına gömülü hoca. Backend tam LecturerOut döner; burada
 *  yalnız gösterim için gereken alanlar. K-52: unvan ayrı geldiği için
 *  `lecturerLabel` ile ad'la birleştirilir. */
export type SectionLecturerRef = { id: number; full_name: string; title: string | null };

/** Hoca gösterim adı: unvan + ad ("Doç. Dr. Ayşe Kaya"). Unvan yoksa yalnız ad.
 *  K-52: unvan ayrı kolonda tutulur; ekranlarda birlikte gösterilir. */
export function lecturerLabel(l: { full_name: string; title: string | null }): string {
  return l.title ? `${l.title} ${l.full_name}` : l.full_name;
}

export type CourseSection = {
  id: number;
  section_no: number;
  lecturer: SectionLecturerRef;
  expected_students: number;
  default_classroom_id: number | null;
  active: boolean;
};

/** K-48 · Ortak dersin EK cohort'u (aldığı bir başka bölüm+yıl+dönem). */
export type CourseCohort = {
  id: number;
  department_id: number;
  department_name: string;
  year: number;
  semester: SemesterType;
};

/** Kontrat §6 · GET /courses elemanı (ders + şubeleri iç içe) */
export type Course = {
  id: number;
  department_id: number;
  year: number;
  semester: SemesterType;
  code: string;
  name: string;
  is_elective: boolean;
  /** K-48: ortak (servis) ders mi — Fizik/Matematik gibi çok bölümün aldığı. */
  is_common: boolean;
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
  /** K-55: AKTS/ECTS kredisi. null = girilmemiş (eski/elle eklenen ders). */
  ects: number | null;
  /** K-45: bileşen bazında online mı. Saati 0 olan bileşende her zaman false.
   *  Senkron/asenkron ayrımı haftalık girişte (delivery_mode) seçilir. */
  theory_online: boolean;
  practice_online: boolean;
  lab_online: boolean;
  /** K-46: dersin vize sayısı (1-3). Final/büt bundan bağımsız, tektir. */
  midterm_count: number;
  active: boolean;
  sections: CourseSection[];
  /** K-48: ortak dersin ek cohort'ları (normal derste boş). */
  extra_cohorts: CourseCohort[];
};

/** K-57: Ders bu cohort'ta mı — BİRİNCİL ∪ EK cohort. Ortak (servis) ders, onu
 *  tüketen bölümün cohort'undan da sayılır (yalnız ilk atandığı bölümden değil).
 *  Haftalık/Sınav paletleri ve Dersler filtresi bunu kullanır. */
export function courseInCohort(
  c: Course, departmentId: number, year: number, semester: SemesterType,
): boolean {
  if (c.department_id === departmentId && c.year === year && c.semester === semester) return true;
  return c.extra_cohorts.some(
    (ec) => ec.department_id === departmentId && ec.year === year && ec.semester === semester);
}

/** K-57: "Ortak dersler" görünümü — bölümün bu dönemde ALDIĞI ortak dersler
 *  (birincil ∪ ek cohort; yıl fark etmez, dönem eşleşir). */
export function courseCommonForDept(
  c: Course, departmentId: number, semester: SemesterType,
): boolean {
  if (!c.is_common) return false;
  if (c.department_id === departmentId && c.semester === semester) return true;
  return c.extra_cohorts.some(
    (ec) => ec.department_id === departmentId && ec.semester === semester);
}
/** Kontrat §10 · GET /dashboard/summary (K-33).
 *
 *  Sekiz kart çizilir; `weekly_entries` kart değildir ama kontrat onu vaat
 *  ettiği için alan burada da durur (haftalık program ekranı gelince kart olur).
 *  Çakışma alanları motor bağlanana dek 0 döner — K-33'te kayıtlı sınırlama.
 */
export type DashboardSummary = {
  departments: number;
  classrooms: number;
  lecturers: number;
  courses: number;
  admins: number;
  sub_accounts: number;
  weekly_entries: number;
  exams: number;
  unresolved_hard: number;
  unresolved_warnings: number;
};

/** Kontrat §0 · ConflictResult — motorun ürettiği, UI'ın çizdiği ortak nesne. */
export type ConflictSeverity = "HARD" | "WARNING";

export type ConflictAffectedRef = {
  type: "weekly_entry" | "exam";
  id: number;
  course_code: string | null;
  /** Bu öğenin bölümü/sınıfı — rapor ve Bölümler sayacı süzmeyi bununla yapar.
   *  Motor eski girişlerde üretmezse null. */
  department_id: number | null;
  year: number | null;
};

export type ConflictResult = {
  severity: ConflictSeverity;
  rule_id: string;                  // "W1".."W8" | "E1".."E7" | "X1".."X3"
  message: string;
  affected: ConflictAffectedRef[];
};

/** Kontrat §9 · GET /conflicts — tam tarama, iki kovaya ayrılmış.
 *
 *  Ayrımı sunucu yapar (K-05): hard submit'i engeller, warning engellemez.
 *  Sonuç canlı hesaplanır, saklanmaz — çakışmanın zaman damgası yoktur.
 */
export type ConflictScan = {
  hard: ConflictResult[];
  warnings: ConflictResult[];
};

/** Kontrat §2 · kullanıcı yaşam döngüsü.
 *
 *  PENDING: davet edildi, hiç giriş yapmadı → daveti silinebilir (K-34).
 *  ACTIVE / DISABLED: hesap kullanılmış → silinmez, erişimi kapatılır.
 */
export type UserStatus = "PENDING" | "ACTIVE" | "DISABLED";

/** Kontrat §2 · GET /users elemanı.
 *
 *  `User`den (auth) farkı: e-posta ve durum taşır, bayrakları OLDUĞU GİBİ
 *  verir. /auth/me'deki "ADMIN'de hepsi true" dönüşümü burada YOKTUR —
 *  yönetim ekranı DB'deki gerçeği göstermeli (K-34).
 */
export type ManagedUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  department_ids: number[];
  can_manage_courses: boolean;
  can_manage_weekly: boolean;
  can_manage_exams: boolean;
  can_manage_classrooms: boolean;
  can_manage_lecturers: boolean;
  can_approve_schedule: boolean;      // K-59
};

/** Yetenek bayrakları — form ve rozet listelerinin tek kaynağı (K-25, K-59).
 *
 *  İlk beşi "neyi YAZABİLİRİM" der. Sonuncusu farklı bir eksende durur:
 *  "başkasının yazdığını YAYINA geçirebilir miyim" (K-59). Bu yüzden ayrı
 *  bir grup olarak işaretlenir; form onu ayrı başlık altında gösterir. */
export const CAPABILITIES = [
  { key: "can_manage_courses", label: "Dersler", group: "write" },
  { key: "can_manage_weekly", label: "Haftalık Program", group: "write" },
  { key: "can_manage_exams", label: "Sınavlar", group: "write" },
  { key: "can_manage_classrooms", label: "Derslikler", group: "write" },
  { key: "can_manage_lecturers", label: "Öğretim Üyeleri", group: "write" },
  { key: "can_approve_schedule", label: "Program Onaylama", group: "approve" },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

/** Kontrat §12 · işlem kayıtları (K-35). */
export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "SUBMIT"
  | "APPROVE" | "REJECT" | "WITHDRAW"     // yayın onay akışı (K-59)
  | "INVITE" | "ACTIVATE"           // davet akışı (K-37)
  | "RESET_REQUEST" | "RESET_PASSWORD";   // şifre sıfırlama (K-43)

export type AuditEntityType =
  | "department" | "building" | "classroom" | "lecturer"
  | "course" | "course_section" | "exam" | "weekly_entry" | "user";

export type AuditLog = {
  id: number;
  created_at: string;
  user: { id: number; name: string } | null;
  action: AuditAction;
  entity_type: string;
  entity_id: number;
  /** HANGİ kayıt — işlem anındaki ad (K-36). */
  entity_label: string | null;
  /** NE değişti — "Durum: Aktif → Pasif" (K-38). Yalnız UPDATE'te dolu. */
  change_summary: string | null;
};

/** Sayfalı cevap: `total` sayfanın değil, filtre kümesinin büyüklüğü. */
export type AuditLogPage = {
  total: number;
  items: AuditLog[];
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, { label: string; color: string }> = {
  CREATE: { label: "Ekledi", color: "green" },
  UPDATE: { label: "Düzenledi", color: "blue" },
  DELETE: { label: "Sildi", color: "red" },
  // K-59: "SUBMIT" artık YAYINLAMAK değil ONAYA GÖNDERMEK demek. Yayına geçiren
  // tek eylem APPROVE. Eski satırlar da bu etiketle görünür; o dönemde submit
  // gerçekten yayınlamaktı, ama iki ayrı etiket taşımak logu okunmaz yapardı.
  SUBMIT: { label: "Onaya gönderdi", color: "violet" },
  APPROVE: { label: "Onayladı (yayına aldı)", color: "green" },
  REJECT: { label: "Reddetti", color: "red" },
  WITHDRAW: { label: "Geri çekti", color: "gray" },
  // K-37: davet akışı. ACTIVATE'in faili davet edilen kişinin kendisidir.
  INVITE: { label: "Davet etti", color: "cyan" },
  ACTIVATE: { label: "Hesabını açtı", color: "teal" },
  // K-43: şifre sıfırlama. İkisinin de faili hesabın sahibidir. Talep ve
  // gerçekleşme AYRI satırlar: "link istendi ama kullanılmadı" durumu
  // denetimde görünmeli (istenmeyen talep = olası saldırı işareti).
  RESET_REQUEST: { label: "Şifre sıfırlama istedi", color: "orange" },
  RESET_PASSWORD: { label: "Şifresini yeniledi", color: "grape" },
};

/** Varlık türlerinin Türkçe karşılığı — filtre ve satır metni tek kaynaktan. */
export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  department: "Bölüm",
  building: "Bina",
  classroom: "Derslik",
  lecturer: "Öğretim üyesi",
  course: "Ders",
  course_section: "Şube",
  exam: "Sınav",
  weekly_entry: "Haftalık giriş",
  user: "Kullanıcı",
};


/* ==================================================================
 * Program taslakları ve onay akışı (K-59)
 * ================================================================== */

/** Taslağın yaşam döngüsü. REJECTED, OPEN gibi DÜZENLENEBİLİR bir durumdur —
 *  ret gerekçesi üstünde durur, sahibi düzeltip yeniden gönderir. */
export type DraftStatus = "OPEN" | "PENDING" | "APPROVED" | "REJECTED";

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  OPEN: "Taslak", PENDING: "Onay bekliyor",
  APPROVED: "Onaylandı", REJECTED: "Reddedildi",
};

export const DRAFT_STATUS_COLORS: Record<DraftStatus, string> = {
  OPEN: "yellow", PENDING: "blue", APPROVED: "green", REJECTED: "red",
};

export type DraftUserRef = { id: number; name: string };

export type ScheduleDraft = {
  id: number;
  department_id: number;
  department_name: string;
  year: number;
  semester: SemesterType;
  name: string;
  status: DraftStatus;
  entry_count: number;
  /** Yayına göre kaç fark var. CANLI hesaplanır (K-59) — taslak açıldığındaki
   *  hale göre değil, O ANKİ yayına göre. */
  change_count: number;
  owner: DraftUserRef;
  created_at: string;
  submitted_at: string | null;
  submit_note: string | null;
  reviewer: DraftUserRef | null;
  reviewed_at: string | null;
  review_note: string | null;
  applied_summary: string | null;
};

export type DraftPlacement = {
  day_of_week: number;
  start_slot: number;
  slot_count: number;
  classroom_id: number | null;
  classroom_label: string | null;
  delivery_mode: DeliveryMode;
};

export type DraftDiffItem = {
  kind: "ADDED" | "REMOVED" | "MOVED";
  section_id: number;
  course_code: string;
  course_name: string;
  section_no: number;
  session_type: SessionType;
  /** K-48: ders başka cohort'lar tarafından da alınıyor. Taşımadan/silmeden
   *  önce uyarı gösterilir — konumu onların programını da etkiler. */
  is_shared: boolean;
  affected_departments: { id: number; name: string }[];
  before: DraftPlacement | null;
  after: DraftPlacement | null;
};

export const DIFF_KIND_LABELS: Record<DraftDiffItem["kind"], string> = {
  ADDED: "Eklendi", REMOVED: "Kaldırıldı", MOVED: "Taşındı",
};

export const DIFF_KIND_COLORS: Record<DraftDiffItem["kind"], string> = {
  ADDED: "green", REMOVED: "red", MOVED: "blue",
};

export type DraftDiff = { draft_id: number; items: DraftDiffItem[] };

export type DraftClearResponse = { deleted: number; preserved_shared: number };

/** Taslak açıldıktan sonra programın kaç kez değiştiği (K-59).
 *  Fark zaten satır satır gösterir; bu, onaylayıcıya dikkatli bakması
 *  gerektiğini söyleyen üst düzey işaret. */
export type DraftStaleness = {
  opened_at: string;
  publications_since: number;
  last_published_at: string | null;
  last_published_by: string | null;
};

export type DraftReview = {
  draft: ScheduleDraft;
  items: DraftDiffItem[];
  entries: WeeklyEntry[];
  conflicts: ConflictScan;
  staleness: DraftStaleness;
};

export type DraftApproveResponse = {
  draft: ScheduleDraft;
  applied: DraftDiffItem[];
  warnings: ConflictResult[];
};
