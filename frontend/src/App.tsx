import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./auth/RequireAuth";
import RequireAdmin from "./auth/RequireAdmin";
import AppLayout from "./layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import ActivatePage from "./pages/ActivatePage";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import DepartmentsPage from "./pages/DepartmentsPage";
import LecturersPage from "./pages/LecturersPage";
import ClassroomsPage from "./pages/ClassroomsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/courses" element={<PlaceholderPage title="Dersler" />} />
          <Route path="/classrooms" element={<ClassroomsPage />} />
          <Route path="/lecturers" element={<LecturersPage />} />
          <Route path="/weekly" element={<PlaceholderPage title="Haftalık Program" />} />
          <Route path="/exams" element={<PlaceholderPage title="Sınavlar" />} />
          <Route path="/conflicts" element={<PlaceholderPage title="Çakışma Raporu" />} />

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