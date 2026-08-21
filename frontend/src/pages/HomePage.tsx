import { useEffect, useState } from "react";
import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { api } from "../api/client";
import ChangeFeed from "../components/ChangeFeed";
import { useT } from "../i18n";

type Health = { status: string; database: string };

export default function HomePage() {
  const t = useT();
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
        <Title order={3}>{t.home.title}</Title>
        <Text c="dimmed" mt="xs">
          {t.home.subtitle}
        </Text>
      </div>

      {/* K-59: taslaklar özel ve onaylar arka planda olduğu için program
          haber verilmeden değişebiliyor. Akış, herkesin ilk gördüğü yerde
          durur. Kendini gösterecek bir şey yoksa hiç çizilmez. */}
      <ChangeFeed limit={5} />

      <Group>
        <Badge color={health ? "green" : error ? "red" : "gray"}>
          {t.home.backend}: {health ? health.status
            : error ? t.home.backendUnreachable : t.home.backendChecking}
        </Badge>
      </Group>
    </Stack>
  );
}
