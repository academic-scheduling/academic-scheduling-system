import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./auth/RequireAuth";
import LoginPage from "./pages/LoginPage";
import ActivatePage from "./pages/ActivatePage";
import HomePage from "./pages/HomePage";

export default function App() {
  return (
    <Routes>
      {/* Public: kimlik istemeyen iki adres (kontrat §1) */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />

      {/* Korumalı alan: RequireAuth'tan geçmeyen giremez.
          Yeni korumalı ekran = buraya bir satır Route. */}
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
      </Route>

      {/* Tanınmayan her adres ana sayfaya */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}