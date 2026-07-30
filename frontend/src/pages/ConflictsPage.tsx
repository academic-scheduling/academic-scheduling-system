import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert, Badge, Button, Card, Group, Loader, Paper, Stack, Tabs, Text, Title,
} from "@mantine/core";
import { IconAlertTriangle, IconArrowRight, IconShieldX } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type { ConflictResult, ConflictScan } from "../api/types";

export default function ConflictsPage() {
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("hard");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Kontrat §9 & K-26: Workgroup'un TÜMÜ taranır ve sonuçlar gösterilir.
      const conflictsRes = await api.get<ConflictScan>("/conflicts");
      setScan(conflictsRes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Çakışmalar yüklenemedi");
    } finally {
      setLoading(false);
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
            Sistemdeki çözülmemiş tüm hard (engelleyici) ve warning (uyarı) çakışmaları.
          </Text>
        </div>

        <Group gap="xs">
          <Badge size="lg" color="red" variant="light" leftSection={<IconShieldX size={14} />}>
            {hardConflicts.length} HARD Engel
          </Badge>
          <Badge size="lg" color="orange" variant="light" leftSection={<IconAlertTriangle size={14} />}>
            {warningConflicts.length} WARNING Uyarı
          </Badge>
        </Group>
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
            HARD Engeller (Yayınlamayı Engeller)
          </Tabs.Tab>
          <Tabs.Tab
            value="warnings"
            rightSection={
              <Badge color="orange" variant="light" size="sm">
                {warningConflicts.length}
              </Badge>
            }
          >
            WARNING Uyarılar (Bilgilendirme)
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="hard">
          <ConflictList
            conflicts={hardConflicts}
            severity="HARD"
            emptyMessage="Çözülmemiş engelleyici (HARD) çakışma bulunamadı. Program yayınlanmaya hazır!"
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
        const targetAffectedList = isExam
          ? c.affected.filter((a) => a.type === "exam")
          : c.affected.filter((a) => a.type === "weekly_entry");
        const highlightIdsStr = targetAffectedList.map((a) => a.id).join(",");
        const highlightParam = highlightIdsStr ? `?highlight=${highlightIdsStr}&rule=${c.rule_id}` : "";
        const targetPath = `${basePath}${highlightParam}`;

        return (
          <Card key={`${c.rule_id}-${i}`} withBorder padding="md" radius="md">
            <Stack gap="xs">
              <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                <Group gap="xs">
                  <Badge color={severity === "HARD" ? "red" : "orange"} size="sm">
                    {severity === "HARD" ? "ENGEL" : "UYARI"}
                  </Badge>
                  <Badge variant="outline" color="gray" size="sm">
                    Kural {c.rule_id}
                  </Badge>
                  <Badge variant="dot" color={isExam ? "violet" : "blue"} size="sm">
                    {isExam ? "Sınav Çakışması" : "Ders Programı Çakışması"}
                  </Badge>
                </Group>

                {targetAffectedList.length > 0 && (
                  <Button
                    component={Link}
                    to={targetPath}
                    size="xs"
                    variant="light"
                    color="blue"
                    rightSection={<IconArrowRight size={14} />}
                  >
                    Çakışmaya Git
                  </Button>
                )}
              </Group>

              <Text size="sm" fw={500}>{c.message}</Text>

              {c.affected.length > 0 && (
                <Group gap={6} align="center" wrap="wrap">
                  <Text size="xs" c="dimmed" fw={500}>Etkilenen Kayıtlar:</Text>
                  {c.affected.map((a, idx) => (
                    <Badge key={idx} variant="light" color={a.type === "exam" ? "violet" : "blue"} size="xs">
                      {a.type === "exam" ? "Sınav" : "Haftalık Ders"}: {a.course_code ?? `#${a.id}`}
                    </Badge>
                  ))}
                </Group>
              )}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
