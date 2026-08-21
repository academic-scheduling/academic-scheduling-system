/** K-79: İngilizce sözlük.
 *
 *  `: Dict` ANNOTASYONU BEKÇİDİR: `tr.ts`'e yeni bir anahtar eklenip buraya
 *  eklenmezse `tsc --noEmit` kırılır. Eksik anahtar çalışma zamanında
 *  "undefined" olarak ekrana sızamaz.
 */

import type { Dict } from "./tr";

export const en: Dict = {
  nav: {
    home: "Home",
    dashboard: "Dashboard",
    departments: "Departments",
    courses: "Courses",
    classrooms: "Classrooms",
    lecturers: "Lecturers",
    weekly: "Weekly Schedule",
    exams: "Exams",
    publishing: "Publishing Center",
    conflicts: "Conflict Report",
  },

  layout: {
    appName: "Academic Scheduling",
    collapse: "Collapse menu",
    expand: "Expand menu",
    toLightMode: "Switch to light mode",
    toDarkMode: "Switch to dark mode",
    logout: "Log out",
    logoutFrom: (email: string) => `Log out (${email})`,
    language: "Language",
    switchToEnglish: "Switch to English",
    switchToTurkish: "Türkçeye geç",
    roleAdmin: "Administrator",
    roleSubAccount: "Sub-account",
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    close: "Close",
    add: "Add",
    search: "Search",
    loading: "Loading…",
    noRecords: "No records",
    export: "Export",
    downloadFailed: "Download failed",
    confirm: "Confirm",
    back: "Back",
    all: "All",
    yes: "Yes",
    no: "No",
    unknownError: (status: number) => `Unexpected error (HTTP ${status})`,
    serverUnreachable: "Cannot reach the server — is the backend running?",
    sessionExpired: "Your session has expired — please sign in again",
    invalidValue: "Invalid value",
  },

  auth: {
    email: "Email",
    password: "Password",
    login: "Sign in",
    forgotPassword: "Forgot my password",
  },
};
