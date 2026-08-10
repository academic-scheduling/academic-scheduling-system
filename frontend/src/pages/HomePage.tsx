import { useEffect, useState } from "react";
import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { api } from "../api/client";
import ChangeFeed from "../components/ChangeFeed";

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
    <Stack gap="lg">
      <div>
        <Title order={3}>Ana Sayfa</Title>
        <Text c="dimmed" mt="xs">
          Sol menüden bir bölüm seçin.
        </Text>
      </div>

      {/* K-59: taslaklar özel ve onaylar arka planda olduğu için program
          haber verilmeden değişebiliyor. Akış, herkesin ilk gördüğü yerde
          durur. Kendini gösterecek bir şey yoksa hiç çizilmez. */}
      <ChangeFeed limit={5} />

      <Group>
        <Badge color={health ? "green" : error ? "red" : "gray"}>
          Backend: {health ? health.status : error ? "erişilemiyor" : "kontrol ediliyor..."}
        </Badge>
      </Group>
    </Stack>
  );
}
