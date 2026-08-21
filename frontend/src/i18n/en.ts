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

    title: "Academic Scheduling",
    emailPlaceholder: "name@muh.example.edu.tr",
    loginButton: "Sign in",
    invalidEmail: "Enter a valid email address",
    passwordRequired: "Password cannot be empty",
    unexpectedError: "An unexpected error occurred",

    forgotTitle: "Forgot My Password",
    forgotHelp:
      "Enter your account's email address and we'll send you a link to " +
      "set a new password.",
    forgotSubmit: "Send Reset Link",
    sentTitle: "Link Sent",
    sentAlert: "If the email is registered, a password reset link has been sent.",
    sentDetail:
      "Please check your inbox. The link is valid for a short time and can be " +
      "used only once.",
    backToLogin: "Back to sign in",

    resetTitle: "Set a New Password",
    newPassword: "New password",
    newPasswordAgain: "New password (again)",
    resetSubmit: "Update Password",
    resetDone: "Your password has been updated. You can sign in now.",
    resetLinkDeadTitle: "Reset link is invalid",
    resetLinkDeadDetail:
      "Links are valid for a short time and can be used only once. You can " +
      "request a new one.",
    requestNewLink: "Request a new link",
    noResetCode: "The link contains no reset code.",
    resetLinkUnverified: "The link could not be verified.",

    passwordsDoNotMatch: "Passwords do not match",
    passwordTooShort: (min: number) =>
      `Password must be at least ${min} characters`,

    activateTitle: "Complete Your Account",
    activateSubmit: "Activate Account",
    activateDone: "Your account has been activated. You can sign in now.",
    inviteLinkDeadTitle: "Invitation link is invalid",
    inviteLinkDeadDetail: "Ask your administrator to resend the invitation.",
    noInviteCode: "The link contains no invitation code.",
    inviteUnverified: "The invitation could not be verified.",
    passwordAgain: "Password (again)",

    captchaFailed:
      "The verification component could not be loaded. An ad/privacy blocker " +
      "or a network restriction may be blocking access to Google; check and " +
      "reload the page.",
  },

  session: {
    idleTitle: "Are you still there?",
    idleBody: (minutes: number) =>
      `There has been no activity for ${minutes} minutes. For your security your session will be closed in`,
    idleSeconds: (seconds: number) => `${seconds} seconds`,
    idleTail: ". Do you want to continue?",
    extend: "Stay signed in",
    countdown: "Session warning",
  },

  home: {
    title: "Home",
    subtitle: "Choose a section from the menu on the left.",
    backend: "Backend",
    backendUnreachable: "unreachable",
    backendChecking: "checking...",
  },
};
