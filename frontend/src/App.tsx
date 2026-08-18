import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./auth/RequireAuth";
import RequireAdmin from "./auth/RequireAdmin";
import AppLayout from "./layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import ActivatePage from "./pages/ActivatePage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import WeeklyPage from "./pages/WeeklyPage";
import ExamsPage from "./pages/ExamsPage";
import DepartmentsPage from "./pages/DepartmentsPage";
import LecturersPage from "./pages/LecturersPage";
import ClassroomsPage from "./pages/ClassroomsPage";
import CoursesPage from "./pages/CoursesPage";
import ConflictsPage from "./pages/ConflictsPage";
import PublishingCenterPage from "./pages/PublishingCenterPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />
      {/* Şifre sıfırlama (K-43) — davet uçları gibi PUBLIC: şifresini
          unutan kullanıcı tanımıyla giriş yapamaz. */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/classrooms" element={<ClassroomsPage />} />
          <Route path="/lecturers" element={<LecturersPage />} />
          <Route path="/weekly" element={<WeeklyPage />} />
          <Route path="/exams" element={<ExamsPage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          {/* K-77: Taslaklarım + Onay Bekleyenler tek "Yayın Merkezi" sayfasında
              birleşti. Eski yollar korunur (derin bağlantılar kırılmasın) ve
              query'yi (draft_id vb.) taşıyarak yönlenir. */}
          <Route path="/publishing" element={<PublishingCenterPage />} />
          <Route path="/drafts" element={<Navigate to={`/publishing${window.location.search}`} replace />} />
          <Route path="/approvals" element={<Navigate to={`/publishing${window.location.search}`} replace />} />

          {/* Yalnız ADMIN — üçüncü kabuk katmanı */}
          <Route element={<RequireAdmin />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}