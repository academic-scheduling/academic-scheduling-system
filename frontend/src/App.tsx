import { useEffect, useState } from "react";
import { Container, Title, Text, Badge, Group } from "@mantine/core";
import Login from "./Login";
import CompleteProfile from "./CompleteProfile";

type Health = { status: string; database: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);
  
  // Kullanıcının giriş yapıp yapmadığını tarayıcı hafızasından (token) kontrol ediyoruz
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('token'));

  // Arkada backend bağlantısının açık olup olmadığını yine de kontrol edelim (opsiyonel)
  useEffect(() => {
    fetch("http://localhost:8000/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <Container py="xl" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Üst Kısım: Proje Başlığı ve Sistem Durum Badgeleri */}
      <div style={{ marginBottom: "2rem" }}>
        <Title order={2}>Akademik Program ve Sınav Çakışma Yönetimi</Title>
        <Text c="dimmed" mt="xs">
          Proje iskeleti — Hafta 2 (Giriş ve Profil Ekranları)
        </Text>
        <Group mt="lg">
          <Badge color={health ? "green" : error ? "red" : "gray"}>
            Backend: {health ? health.status : error ? "erişilemiyor" : "kontrol ediliyor..."}
          </Badge>
          {health && (
            <Badge color={health.database === "up" ? "green" : "red"}>
              Veritabanı: {health.database}
            </Badge>
          )}
        </Group>
      </div>

      {/* Orta Kısım: Giriş Durumuna Göre Gösterilecek Sayfa */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
        {!isLoggedIn ? (
          // Giriş yapılmadıysa Login ekranını göster
          <Login onLoginSuccess={() => setIsLoggedIn(true)} />
        ) : (
          // Giriş başarılıysa Profil Tamamlama ekranını göster
          <CompleteProfile />
        )}
      </div>
    </Container>
  );
}