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