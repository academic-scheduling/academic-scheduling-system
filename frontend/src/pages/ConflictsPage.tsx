import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert, Badge, Button, Card, Group, Loader, Paper, Stack, Tabs, Text, Title, Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconRefresh } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type { ConflictResult, ConflictScan } from "../api/types";

export default function ConflictsPage() {
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("hard");

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Kontrat §9 & K-26: Workgroup'un TÜMÜ taranır ve sonuçlar eksiksiz gösterilir.
      // Alt hesabın çakışmayı çözebilmesi için karşı tarafı (diğer bölümü) görmesi şarttır.
      const conflictsRes = await api.get<ConflictScan>("/conflicts");
      setScan(conflictsRes);
      if (isManualRefresh) {
        notifications.show({
          color: "green",
          title: "Tam Tarama Tamamlandı",
          message: "Çakışma raporu güncellendi.",
        });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Çakışmalar yüklenemedi");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const hardConflicts = scan?.hard ?? [];
  const warningConflicts = scan?.warnings ?? [];

  if (loading && !scan) return <Loader mt="xl" />;
  if (error) return <Alert color="red" mt="md">{error}</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <div>
          <Title order={2} fw={500}>Çakışma Raporu</Title>
          <Text size="sm" c="dimmed" mt={2}>
            Sistemdeki çözülmemiş hard (engelleyici) ve warning (uyarı) çakışmaları.
          </Text>
        </div>
        <Button
          leftSection={<IconRefresh size={16} />}
          loading={refreshing}
          onClick={() => loadData(true)}
          variant="light"
        >
          Tam Tarama Çalıştır
        </Button>
      </Group>

      <Tabs value={activeTab} onChange={setActiveTab} radius="md">
        <Tabs.List mb="md">
          <Tabs.Tab
            value="hard"
            rightSection={
              <Badge color="red" variant="light" size="sm">
                {hardConflicts.length}
              </Badge>
            }
          >
            HARD Engeller
          </Tabs.Tab>
          <Tabs.Tab
            value="warnings"
            rightSection={
              <Badge color="orange" variant="light" size="sm">
                {warningConflicts.length}
              </Badge>
            }
          >
            WARNING Uyarılar
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="hard">
          <ConflictList
            conflicts={hardConflicts}
            severity="HARD"
            emptyMessage="Çözülmemiş engelleyici (HARD) çakışma bulunamadı."
          />
        </Tabs.Panel>

        <Tabs.Panel value="warnings">
          <ConflictList
            conflicts={warningConflicts}
            severity="WARNING"
            emptyMessage="Çözülmemiş uyarı (WARNING) seviyesinde çakışma bulunamadı."
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function ConflictList({
  conflicts,
  severity,
  emptyMessage,
}: {
  conflicts: ConflictResult[];
  severity: "HARD" | "WARNING";
  emptyMessage: string;
}) {
  if (conflicts.length === 0) {
    return (
      <Paper p="lg" withBorder radius="md">
        <Text c="dimmed" size="sm">{emptyMessage}</Text>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      {conflicts.map((c, i) => {
        const isExam = c.affected.some((a) => a.type === "exam");
        const basePath = isExam ? "/exams" : "/weekly";
        const targetAffected = isExam
          ? c.affected.find((a) => a.type === "exam")
          : c.affected.find((a) => a.type === "weekly_entry");
        const highlightParam = targetAffected ? `?highlight=${targetAffected.id}&rule=${c.rule_id}` : "";
        const targetPath = `${basePath}${highlightParam}`;

        return (
          <Card key={`${c.rule_id}-${i}`} withBorder padding="md" radius="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Group gap="xs">
                  <Badge color={severity === "HARD" ? "red" : "orange"} size="sm">
                    {severity === "HARD" ? "ENGEL" : "UYARI"}
                  </Badge>
                  <Badge variant="outline" color="gray" size="sm">
                    {c.rule_id}
                  </Badge>
                </Group>
                <Text size="sm" fw={500}>{c.message}</Text>
                {c.affected.length > 0 && (
                  <Group gap={6} wrap="wrap">
                    {c.affected.map((a, idx) => (
                      <Badge key={idx} variant="dot" color="blue" size="xs">
                        {a.course_code ?? `${a.type} #${a.id}`}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Stack>

              <Tooltip label={isExam ? "Sınav Takviminde Göster" : "Haftalık Programda Göster"}>
                <Button
                  component={Link}
                  to={targetPath}
                  size="xs"
                  variant="light"
                  rightSection={<IconArrowRight size={14} />}
                >
                  Grid'de Göster
                </Button>
              </Tooltip>
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}
