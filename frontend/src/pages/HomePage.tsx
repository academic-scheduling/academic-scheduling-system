import { useEffect, useState } from "react";
import { Badge, Group, Text, Title } from "@mantine/core";
import { api } from "../api/client";

type Health = { status: string; database: string };

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get<Health>("/health")
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <>
      <Title order={3}>Ana Sayfa</Title>
      <Text c="dimmed" mt="xs">
        Sol menüden bir bölüm seçin.
      </Text>
      <Group mt="lg">
        <Badge color={health ? "green" : error ? "red" : "gray"}>
          Backend: {health ? health.status : error ? "erişilemiyor" : "kontrol ediliyor..."}
        </Badge>
      </Group>
    </>
  );
}