import { useEffect, useState } from "react";
import {
  Alert, Badge, Card, Group, Loader, Paper, Stack, Tabs, Text, Title,
} from "@mantine/core";
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
            Sistemdeki çözülmemiş hard (engelleyici) ve warning (uyarı) çakışmaları.
          </Text>
        </div>
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
        const conflictingCourses = Array.from(
          new Set(c.affected.map((a) => a.course_code).filter(Boolean))
        );

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
              </Stack>

              {conflictingCourses.length > 0 && (
                <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
                  <Text size="xs" c="dimmed" fw={500}>Çakışan Dersler</Text>
                  <Group gap={4} wrap="wrap" justify="flex-end">
                    {conflictingCourses.map((code, idx) => (
                      <Badge key={idx} variant="light" color="blue" size="sm">
                        {code}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}
