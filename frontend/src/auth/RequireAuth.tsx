import { Navigate, Outlet } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import { useAuth } from "./AuthContext";

export default function RequireAuth() {
  const { user, loading } = useAuth();

  // Açılış kontrolü (/auth/me) sürerken KARAR VERME: kullanıcıyı ne login'e
  // at ne içeriği göster. "Bilmiyorum" durumunun ekrandaki karşılığı spinner.
  if (loading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />; // eşleşen alt route'u (HomePage vb.) çiz
}