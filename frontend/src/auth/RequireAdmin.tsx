import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Yalnız ADMIN route'ları (şimdilik /dashboard).
 *
 *  RequireAuth'un içinde kullanılır, yani user'ın dolu olduğu garanti —
 *  loading kontrolüne gerek yok. Amaç kullanıcıyı 403 duvarına çarptırmamak;
 *  gerçek koruma backend'de.
 */
export default function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}