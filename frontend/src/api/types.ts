// Kontrat (docs/api_kontrat.md) cevap şekillerinin TypeScript karşılığı.
// backend/app/schemas.py ile birebir eş tutulur; orada değişen burada değişir.

/** Kontrat §1 · UserPublic.role */
export type Role = "ADMIN" | "SUB_ACCOUNT";

/** Kontrat §1 · login cevabındaki `user` ve GET /auth/me cevabı */
export type User = {
  id: number;
  name: string;
  role: Role;
  can_manage_classrooms: boolean;
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