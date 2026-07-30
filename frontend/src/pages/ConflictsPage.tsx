import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert, Badge, Button, Card, Group, Loader, Paper, Stack, Tabs, Text, Title,
} from "@mantine/core";
import { IconAlertTriangle, IconArrowRight, IconExternalLink, IconShieldX } from "@tabler/icons-react";
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
    <Stack gap="md">
      {conflicts.map((c, i) => {
        const isExam = c.affected.some((a) => a.type === "exam");
        const allTargetIds = c.affected.map((a) => a.id).join(",");
        const allTargetPath = `${isExam ? "/exams" : "/weekly"}?highlight=${allTargetIds}&rule=${c.rule_id}`;

        return (
          <Card key={`${c.rule_id}-${i}`} withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                <Group gap="xs">
                  <Badge color={severity === "HARD" ? "red" : "orange"} size="sm">
                    {severity === "HARD" ? "ENGEL" : "UYARI"}
                  </Badge>
                  <Badge variant="outline" color="gray" size="sm">
                    Kural {c.rule_id}
                  </Badge>
                  <Badge variant="dot" color={isExam ? "violet" : "blue"} size="sm">
                    {isExam ? "Sınav Çakışması" : "Haftalık Ders Çakışması"}
                  </Badge>
                </Group>

                {c.affected.length > 0 && (
                  <Button
                    component={Link}
                    to={allTargetPath}
                    size="xs"
                    variant="light"
                    color="blue"
                    rightSection={<IconExternalLink size={14} />}
                  >
                    Tümünü Takvimde Göster ({c.affected.length} Kayıt)
                  </Button>
                )}
              </Group>

              <Text size="sm" fw={500}>
                {c.message}
              </Text>

              {c.affected.length > 0 && (
                <Paper withBorder p="xs" radius="sm" style={{ background: "var(--mantine-color-gray-0)" }}>
                  <Text size="xs" c="dimmed" fw={600} mb={6}>
                    ÇAKIŞAN DERSLER & KAYITLAR:
                  </Text>

                  <Stack gap={6}>
                    {c.affected.map((item, idx) => {
                      const itemIsExam = item.type === "exam";
                      const itemPath = `${itemIsExam ? "/exams" : "/weekly"}?highlight=${item.id}&rule=${c.rule_id}`;
                      const label = item.course_code
                        ? `${item.course_code} — ${itemIsExam ? "Sınav Girişi" : "Haftalık Ders Girişi"}`
                        : `${itemIsExam ? "Sınav" : "Haftalık Giriş"} #${item.id}`;

                      return (
                        <Paper
                          key={idx}
                          withBorder
                          p="xs"
                          radius="xs"
                          style={{ background: "#FFFFFF" }}
                        >
                          <Group justify="space-between" align="center" wrap="nowrap">
                            <Group gap="xs">
                              <Badge
                                size="xs"
                                color={itemIsExam ? "violet" : "blue"}
                                variant="light"
                              >
                                {itemIsExam ? "SINAV" : "DERS"}
                              </Badge>
                              <Text size="xs" fw={600}>
                                {label}
                              </Text>
                            </Group>

                            <Button
                              component={Link}
                              to={itemPath}
                              size="compact-xs"
                              variant="subtle"
                              color="blue"
                              rightSection={<IconArrowRight size={12} />}
                            >
                              Takvimde Göster
                            </Button>
                          </Group>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Paper>
              )}
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
