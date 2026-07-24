import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Group, Loader, Paper, Select, Stack, Text, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../lib/slots";
import type {
  ConflictScan, Course, Department, SemesterType, WeeklyEntry,
} from "../api/types";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];
const SLOT_END = ["", "09:15", "10:15", "11:15", "12:15", "13:15", "14:15", "15:15", "16:15", "17:15"];
const YEARS = ["1", "2", "3", "4"];
const ROW_H = 46;                 // bir slot satırının yüksekliği (px)

/** Bir günün girişlerini yan yana ŞERİTLERE böler (takvim yerleşimi).
 *  Kesişen girişler farklı şeride düşer; her kesişim kümesi kendi şerit
 *  sayısını bilir, böylece kalabalık olmayan slotlardaki kart tam genişlik kalır. */
type Placed = WeeklyEntry & { lane: number; lanes: number };

function layoutDay(entries: WeeklyEntry[]): Placed[] {
  const sorted = [...entries].sort(
    (a, b) => a.start_slot - b.start_slot || a.id - b.id,
  );
  const end = (e: WeeklyEntry) => e.start_slot + e.slot_count - 1;
  const out: Placed[] = [];
  let cluster: WeeklyEntry[] = [];
  let clusterEnd = 0;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];           // her şeridin son bitiş slotu
    const laneOf = new Map<number, number>();
    for (const e of cluster) {
      let lane = laneEnds.findIndex((le) => le < e.start_slot);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = end(e);
      laneOf.set(e.id, lane);
    }
    const lanes = laneEnds.length;
    for (const e of cluster) out.push({ ...e, lane: laneOf.get(e.id)!, lanes });
    cluster = [];
  };

  for (const e of sorted) {
    if (cluster.length && e.start_slot > clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, end(e));
  }
  flush();
  return out;
}

export default function WeeklyPage() {
  const { user } = useAuth();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [dep, setDep] = useState<string | null>(null);
  const [year, setYear] = useState<string>("2");        // seed BM 2. sınıf'ı hemen aydınlatır
  const [sem, setSem] = useState<SemesterType>("FALL");

  const [entries, setEntries] = useState<WeeklyEntry[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [scan, setScan] = useState<ConflictScan>({ hard: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bölüm listesi bir kez (cohort seçicinin ilk boyutu).
  useEffect(() => {
    api.get<Department[]>("/departments")
      .then((d) => {
        setDepartments(d);
        if (d.length) setDep(String(d[0].id));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Bölümler yüklenemedi"));
  }, []);

  // Cohort değişince grid + palet + çakışma taraması yeniden çekilir.
  useEffect(() => {
    if (!dep) return;
    const qs = `department_id=${dep}&year=${year}&semester=${sem}`;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<WeeklyEntry[]>(`/weekly-entries?${qs}`),
      api.get<Course[]>(`/courses?${qs}`),
      api.get<ConflictScan>("/conflicts"),
    ])
      .then(([e, c, s]) => { setEntries(e); setCourses(c); setScan(s); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Program yüklenemedi"))
      .finally(() => setLoading(false));
  }, [dep, year, sem]);

  // course_id → is_elective (kart etiketlemesi için; weekly-entries bunu döndürmez).
  const electiveOf = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const c of courses) m.set(c.id, c.is_elective);
    return m;
  }, [courses]);

  // Çakışan girişlerin id'leri (kart rengi). Sert > uyarı önceliği.
  const { hardIds, warnIds } = useMemo(() => {
    const h = new Set<number>(), w = new Set<number>();
    for (const c of scan.hard)
      for (const a of c.affected) if (a.type === "weekly_entry") h.add(a.id);
    for (const c of scan.warnings)
      for (const a of c.affected) if (a.type === "weekly_entry") w.add(a.id);
    return { hardIds: h, warnIds: w };
  }, [scan]);

  const byDay = useMemo(() => {
    const m = new Map<number, Placed[]>();
    for (const d of DAYS) m.set(d, layoutDay(entries.filter((e) => e.day_of_week === d)));
    return m;
  }, [entries]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={3}>Haftalık Program</Title>
        <Group gap="xs">
          <Select
            label="Bölüm" size="xs" w={200} value={dep} onChange={setDep}
            data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))}
          />
          <Select
            label="Yıl" size="xs" w={90} value={year} onChange={(v) => v && setYear(v)}
            data={YEARS.map((y) => ({ value: y, label: `${y}. sınıf` }))}
          />
          <Select
            label="Dönem" size="xs" w={110} value={sem}
            onChange={(v) => v && setSem(v as SemesterType)}
            data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
              value: s, label: SEMESTER_LABELS[s],
            }))}
          />
        </Group>
      </Group>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      <Group align="flex-start" gap="md" wrap="nowrap">
        {/* Palet: cohort'un ders/şubeleri (sürükle-bırak sonraki adımda) */}
        <Paper withBorder p="sm" w={190} style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed" mb={8}>Derslerim</Text>
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">Bu cohort'ta ders yok.</Text>}
            {courses.flatMap((c) =>
              c.sections.map((s) => (
                <Paper key={s.id} withBorder p={6} radius="sm"
                  style={{ cursor: "grab", fontSize: 12 }}>
                  <Group gap={4} justify="space-between" wrap="nowrap">
                    <Text size="xs" fw={500}>{c.code}-{s.section_no}</Text>
                    {c.is_elective && <Badge size="xs" variant="light" color="grape">seçmeli</Badge>}
                  </Group>
                  <Text size="10px" c="dimmed" truncate>{c.name}</Text>
                </Paper>
              )),
            )}
          </Stack>
        </Paper>

        {/* Grid: zaman cetveli + 5 gün, günler takvim yerleşimiyle */}
        <Paper withBorder p="sm" style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 520 }}>
              {/* zaman cetveli */}
              <div style={{ width: 44, flexShrink: 0 }}>
                <div style={{ height: 24 }} />
                {SLOTS.map((s) => (
                  <div key={s} style={{
                    height: ROW_H, fontSize: 10, color: "var(--mantine-color-dimmed)",
                    textAlign: "right", paddingRight: 4, paddingTop: 2,
                  }}>{SLOT_START[s]}</div>
                ))}
              </div>
              {/* gün sütunları */}
              {DAYS.map((d) => (
                <div key={d} style={{ flex: 1, minWidth: 92 }}>
                  <div style={{
                    height: 24, textAlign: "center", fontSize: 12,
                    color: "var(--mantine-color-dimmed)",
                  }}>{DAY_SHORT[d]}</div>
                  <div style={{ position: "relative", height: ROW_H * 9 }}>
                    {/* slot çizgileri */}
                    {SLOTS.map((s) => (
                      <div key={s} style={{
                        position: "absolute", top: (s - 1) * ROW_H, left: 0, right: 0,
                        height: ROW_H, borderTop: "0.5px solid var(--mantine-color-default-border)",
                      }} />
                    ))}
                    {/* kartlar */}
                    {byDay.get(d)!.map((e) => (
                      <EntryCard key={e.id} e={e}
                        elective={electiveOf.get(e.section.course.id) ?? false}
                        hard={hardIds.has(e.id)} warn={warnIds.has(e.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Paper>
      </Group>

      <Group gap="lg" style={{ fontSize: 11, color: "var(--mantine-color-dimmed)" }}>
        <Legend swatch={{ background: "var(--mantine-color-blue-light)" }} label="Yayınlanmış" />
        <Legend swatch={{ border: "1px dashed var(--mantine-color-default-border)" }} label="Taslak" />
        <Legend swatch={{ background: "var(--mantine-color-red-light)" }} label="Çakışma (engel)" />
        <Legend swatch={{ background: "var(--mantine-color-orange-light)" }} label="Uyarı" />
        <Legend swatch={{ border: "1px dashed var(--mantine-color-blue-4)" }} label="Online (dersliksiz)" />
      </Group>
    </Stack>
  );
}

function Legend({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <Group gap={4}>
      <span style={{ display: "inline-block", width: 20, height: 11, borderRadius: 3,
        border: "1px solid var(--mantine-color-default-border)", ...swatch }} />
      <span>{label}</span>
    </Group>
  );
}

function EntryCard({ e, elective, hard, warn }: {
  e: Placed; elective: boolean; hard: boolean; warn: boolean;
}) {
  const online = e.delivery_mode !== "FACE_TO_FACE";
  const draft = e.status === "DRAFT";

  // Renk önceliği: sert çakışma > uyarı > online > (yayın/taslak).
  let style: React.CSSProperties;
  if (hard) style = { background: "var(--mantine-color-red-light)", border: "1px solid var(--mantine-color-red-4)" };
  else if (warn) style = { background: "var(--mantine-color-orange-light)", border: "1px solid var(--mantine-color-orange-4)" };
  else if (online) style = { border: "1px dashed var(--mantine-color-blue-4)", background: "transparent" };
  else if (draft) style = { border: "1px dashed var(--mantine-color-default-border)", background: "transparent" };
  else style = { background: "var(--mantine-color-blue-light)", border: "1px solid var(--mantine-color-blue-4)" };

  const gap = 2;
  const widthPct = 100 / e.lanes;

  return (
    <div style={{
      position: "absolute",
      top: (e.start_slot - 1) * ROW_H + 1,
      height: e.slot_count * ROW_H - 2,
      left: `calc(${e.lane * widthPct}% + ${gap}px)`,
      width: `calc(${widthPct}% - ${gap * 2}px)`,
      borderRadius: 6, padding: "2px 4px", fontSize: 11, lineHeight: 1.2,
      overflow: "hidden", ...style,
    }}>
      <div style={{ fontWeight: 500 }}>{e.section.course.code}-{e.section.section_no}</div>
      <div style={{ fontSize: 10, opacity: 0.85 }}>
        {online ? "online" : e.classroom?.room_code ?? "—"}
        {elective ? " · seçmeli" : ""}
      </div>
    </div>
  );
}
