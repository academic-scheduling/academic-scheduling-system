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