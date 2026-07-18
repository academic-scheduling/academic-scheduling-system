import { useEffect, useState } from "react";
import { Badge, Button, Container, Group, Text, Title } from "@mantine/core";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Health = { status: string; database: string };

export default function HomePage() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Health>("/health")
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <Container py="xl">
      <Title order={2}>Akademik Program ve Sınav Çakışma Yönetimi</Title>
      <Text c="dimmed" mt="xs">
        Geçici ana sayfa — gerçek dashboard sonraki adımlarda.
      </Text>
      <Group mt="lg">
        <Badge color={health ? "green" : error ? "red" : "gray"}>
          Backend: {health ? health.status : error ? "erişilemiyor" : "kontrol ediliyor..."}
        </Badge>
        <Badge color="blue">{user?.name} · {user?.role}</Badge>
        <Button variant="light" size="xs" onClick={logout}>
          Çıkış
        </Button>
      </Group>
    </Container>
  );
}