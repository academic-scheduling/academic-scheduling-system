import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert, Badge, Button, Card, Group, Loader, Paper, Select, Stack, Tabs, Text, Title,
} from "@mantine/core";
import { IconAlertTriangle, IconArrowRight, IconShieldX } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type { ConflictResult, ConflictScan, Department } from "../api/types";
import { useT } from "../i18n";

// "Filtre yok" için sabit sentinel: Mantine Select value'su null olamayacağı
// yerlerde "hepsi" seçeneği listede görünsün diye (× ikonu fark edilmiyor).
const ALL = "__all__";

export default function ConflictsPage() {
  const t = useT();
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("hard");

  // Bölüm süzgeci Bölümler sayacından ?department_id= ile önceden gelebilir.
  const [searchParams, setSearchParams] = useSearchParams();
  const [deptFilter, setDeptFilter] = useState<string | null>(
    searchParams.get("department_id"),
  );
  const [yearFilter, setYearFilter] = useState<string | null>(
    searchParams.get("year"),
  );

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Kontrat §9 & K-26: Workgroup'un TÜMÜ taranır ve sonuçlar gösterilir.
      const [conflictsRes, deps] = await Promise.all([
        api.get<ConflictScan>("/conflicts"),
        api.get<Department[]>("/departments"),
      ]);
      setScan(conflictsRes);
      setDepartments(deps);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.conflicts.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Deep-link parametrelerini bir kez tüket: state'e alındı, URL'de yapışmasın.
  useEffect(() => {
    if (!searchParams.has("department_id") && !searchParams.has("year")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("year");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Süzme: bir çakışma, etkilenen öğelerinden HERHANGİ biri seçili bölüme/sınıfa
  // aitse listede kalır. Bölümler-arası bir çakışma (W1/W2) iki tarafı da
  // taşıdığından, o bölümü seçince görünür — çözebilmek için karşı tarafı da
  // görmek gerekir (K-26).
  const applyFilter = (list: ConflictResult[]) => {
    const dep = deptFilter ? Number(deptFilter) : null;
    const yr = yearFilter ? Number(yearFilter) : null;
    if (dep === null && yr === null) return list;
    return list.filter((c) =>
      (dep === null || c.affected.some((a) => a.department_id === dep)) &&
      (yr === null || c.affected.some((a) => a.year === yr)));
  };

  const hardConflicts = useMemo(() => applyFilter(scan?.hard ?? []),
    [scan, deptFilter, yearFilter]);   // eslint-disable-line react-hooks/exhaustive-deps
  const warningConflicts = useMemo(() => applyFilter(scan?.warnings ?? []),
    [scan, deptFilter, yearFilter]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Sınıf seçenekleri veriden türetilir: yalnız gerçekten çakışması olan
  // sınıflar listelensin, boş seçenek olmasın.
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const c of [...(scan?.hard ?? []), ...(scan?.warnings ?? [])]) {
      for (const a of c.affected) if (a.year != null) years.add(a.year);
    }
    return [...years].sort((x, y) => x - y);
  }, [scan]);

  const filtered = deptFilter !== null || yearFilter !== null;

  if (loading && !scan) return <Loader mt="xl" />;
  if (error) return <Alert color="red" mt="md">{error}</Alert>;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Title order={2} fw={500}>{t.conflicts.title}</Title>

        <Group gap="xs">
          <Badge size="lg" color="red" variant="light" leftSection={<IconShieldX size={14} />}>
            {t.conflicts.hardBadge(hardConflicts.length)}
          </Badge>
          <Badge size="lg" color="orange" variant="light" leftSection={<IconAlertTriangle size={14} />}>
            {t.conflicts.warnBadge(warningConflicts.length)}
          </Badge>
        </Group>
      </Group>

      {/* --- Filtre çubuğu --- */}
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label={t.conflicts.department}
          w={260}
          data={[
            { value: ALL, label: t.conflicts.allDepartments },
            ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` })),
          ]}
          value={deptFilter ?? ALL}
          onChange={(v) => setDeptFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
        />
        <Select
          label={t.conflicts.classYear}
          w={160}
          data={[
            { value: ALL, label: t.conflicts.allYears },
            ...yearOptions.map((y) => ({ value: String(y), label: t.conflicts.yearN(y) })),
          ]}
          value={yearFilter ?? ALL}
          onChange={(v) => setYearFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
        />
        {filtered && (
          <Button variant="subtle" color="gray" onClick={() => { setDeptFilter(null); setYearFilter(null); }}>
            {t.conflicts.clearFilter}
          </Button>
        )}
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
            {t.conflicts.tabHard}
          </Tabs.Tab>
          <Tabs.Tab
            value="warnings"
            rightSection={
              <Badge color="orange" variant="light" size="sm">
                {warningConflicts.length}
              </Badge>
            }
          >
            {t.conflicts.tabWarn}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="hard">
          <ConflictList
            conflicts={hardConflicts}
            severity="HARD"
            emptyMessage={filtered
              ? t.conflicts.emptyHardFiltered
              : t.conflicts.emptyHard}
          />
        </Tabs.Panel>

        <Tabs.Panel value="warnings">
          <ConflictList
            conflicts={warningConflicts}
            severity="WARNING"
            emptyMessage={filtered
              ? t.conflicts.emptyWarnFiltered
              : t.conflicts.emptyWarn}
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
  const t = useT();
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

        return (
          <Card key={`${c.rule_id}-${i}`} withBorder padding="md" radius="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
              <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs">
                  <Badge color={severity === "HARD" ? "red" : "orange"} size="sm">
                    {severity === "HARD" ? t.conflicts.blocking : t.conflicts.warning}
                  </Badge>
                  <Badge variant="outline" color="gray" size="sm">
                    {t.conflicts.rule} {c.rule_id}
                  </Badge>
                  <Badge variant="dot" color={isExam ? "violet" : "blue"} size="sm">
                    {isExam ? t.conflicts.examConflict : t.conflicts.weeklyConflict}
                  </Badge>
                </Group>
                <Text size="sm" fw={500}>{c.message}</Text>
              </Stack>

              {/* Çakışan öğeler sağda; tıklayınca ilgili programda vurgulanır. */}
              {c.affected.length > 0 && (
                <Group gap="xs" justify="flex-end" wrap="wrap" style={{ flexShrink: 0, maxWidth: "45%" }}>
                  {c.affected.map((item, idx) => {
                    const itemIsExam = item.type === "exam";
                    const itemPath = `${itemIsExam ? "/exams" : "/weekly"}?highlight=${item.id}&rule=${c.rule_id}`;
                    const label = item.course_code ?? `${itemIsExam ? t.conflicts.exam : t.conflicts.course} #${item.id}`;

                    return (
                      <Button
                        key={idx}
                        component={Link}
                        to={itemPath}
                        size="xs"
                        variant="light"
                        color={itemIsExam ? "violet" : "blue"}
                        rightSection={<IconArrowRight size={12} />}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </Group>
              )}
            </Group>
          </Card>
        );
      })}
    </Stack>
  );
}
