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

/** Kontrat §3 · GET /departments elemanı */
export type Department = {
  id: number;
  name: string;
  code: string;
  active: boolean;
};

/** Kontrat §4 · GET /lecturers elemanı (K-28: active dahil) */
export type Lecturer = {
  id: number;
  full_name: string;
  /** Unvansız, küçük harf ad — alfabetik sıralama bunun üzerinden yapılır (K-28). */
  normalized_name: string;
  is_external: boolean;
  active: boolean;
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

export type SectionLecturerRef = { id: number; full_name: string };

export type CourseSection = {
  id: number;
  section_no: number;
  lecturer: SectionLecturerRef;
  expected_students: number;
  default_classroom_id: number | null;
  active: boolean;
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
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
  active: boolean;
  sections: CourseSection[];
};
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
};

/** K-25'in beş yetenek bayrağı — form ve rozet listelerinin tek kaynağı. */
export const CAPABILITIES = [
  { key: "can_manage_courses", label: "Dersler" },
  { key: "can_manage_weekly", label: "Haftalık Program" },
  { key: "can_manage_exams", label: "Sınavlar" },
  { key: "can_manage_classrooms", label: "Derslikler" },
  { key: "can_manage_lecturers", label: "Öğretim Üyeleri" },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

/** Kontrat §12 · işlem kayıtları (K-35). */
export type AuditAction =
  | "CREATE" | "UPDATE" | "DELETE" | "SUBMIT"
  | "INVITE" | "ACTIVATE";          // davet akışı (K-37)

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
  SUBMIT: { label: "Yayınladı", color: "violet" },
  // K-37: davet akışı. ACTIVATE'in faili davet edilen kişinin kendisidir.
  INVITE: { label: "Davet etti", color: "cyan" },
  ACTIVATE: { label: "Hesabını açtı", color: "teal" },
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
