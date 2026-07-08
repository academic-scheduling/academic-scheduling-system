import { useEffect, useState } from "react";
import { Container, Title, Text, Badge, Group } from "@mantine/core";

type Health = { status: string; database: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <Container py="xl">
      <Title order={2}>Akademik Program ve Sınav Çakışma Yönetimi</Title>
      <Text c="dimmed" mt="xs">
        Proje iskeleti — Hafta 1
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
    </Container>
  );
}
