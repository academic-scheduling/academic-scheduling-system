import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput,
  Paper, Select, Stack, Text, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../lib/slots";
import type {
  Classroom, ConflictResult, ConflictScan, Course, DeliveryMode, Department,
  SemesterType, SessionType, WeeklyEntry,
} from "../api/types";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];
const YEARS = ["1", "2", "3", "4"];
const ROW_H = 46;

const SESSION_LABELS: Record<SessionType, string> = { THEORY: "Teori", PRACTICE: "Uygulama", LAB: "Lab" };
const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  FACE_TO_FACE: "Yüz yüze", ONLINE_SYNC: "Online (eşzamanlı)", ONLINE_ASYNC: "Online (asenkron)",
};

type Placed = WeeklyEntry & { lane: number; lanes: number };
type DragPayload = { sectionId: number; courseId: number; label: string };
type PlaceTarget = { drag: DragPayload; day: number; slot: number };

/** Bir günün girişlerini yan yana şeritlere böler (takvim yerleşimi, K-15 paralel). */
function layoutDay(entries: WeeklyEntry[]): Placed[] {
  const sorted = [...entries].sort((a, b) => a.start_slot - b.start_slot || a.id - b.id);
  const end = (e: WeeklyEntry) => e.start_slot + e.slot_count - 1;
  const out: Placed[] = [];
  let cluster: WeeklyEntry[] = [];
  let clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<number, number>();
    for (const e of cluster) {
      let lane = laneEnds.findIndex((le) => le < e.start_slot);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = end(e);
      laneOf.set(e.id, lane);
    }
    for (const e of cluster) out.push({ ...e, lane: laneOf.get(e.id)!, lanes: laneEnds.length });
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
  const [year, setYear] = useState<string>("2");
  const [sem, setSem] = useState<SemesterType>("FALL");

  const [entries, setEntries] = useState<WeeklyEntry[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [scan, setScan] = useState<ConflictScan>({ hard: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null);   // "day-slot"
  const [target, setTarget] = useState<PlaceTarget | null>(null);   // bırakma modalı

  const canWrite = canWriteIn(user, "can_manage_weekly", dep ? Number(dep) : undefined);

  useEffect(() => {
    Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Classroom[]>("/classrooms"),
    ])
      .then(([d, c]) => { setDepartments(d); setClassrooms(c); if (d.length) setDep(String(d[0].id)); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Yüklenemedi"));
  }, []);

  const reload = () => {
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
  };
  useEffect(reload, [dep, year, sem]);

  const electiveOf = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const c of courses) m.set(c.id, c.is_elective);
    return m;
  }, [courses]);

  const { hardIds, warnIds } = useMemo(() => {
    const h = new Set<number>(), w = new Set<number>();
    for (const c of scan.hard) for (const a of c.affected) if (a.type === "weekly_entry") h.add(a.id);
    for (const c of scan.warnings) for (const a of c.affected) if (a.type === "weekly_entry") w.add(a.id);
    return { hardIds: h, warnIds: w };
  }, [scan]);

  const byDay = useMemo(() => {
    const m = new Map<number, Placed[]>();
    for (const d of DAYS) m.set(d, layoutDay(entries.filter((e) => e.day_of_week === d)));
    return m;
  }, [entries]);

  const onDrop = (day: number, slot: number) => {
    setOverCell(null);
    if (drag && canWrite) setTarget({ drag, day, slot });
    setDrag(null);
  };

  const deleteEntry = async (e: WeeklyEntry) => {
    if (!window.confirm(`${e.section.course.code}-${e.section.section_no} girişi silinsin mi?`)) return;
    try {
      await api.delete(`/weekly-entries/${e.id}`);
      notifications.show({ message: "Giriş silindi", color: "gray" });
      reload();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Silinemedi" });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Title order={3}>Haftalık Program</Title>
        <Group gap="xs">
          <Select label="Bölüm" size="xs" w={200} value={dep} onChange={setDep}
            data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
          <Select label="Yıl" size="xs" w={90} value={year} onChange={(v) => v && setYear(v)}
            data={YEARS.map((y) => ({ value: y, label: `${y}. sınıf` }))} />
          <Select label="Dönem" size="xs" w={110} value={sem} onChange={(v) => v && setSem(v as SemesterType)}
            data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({ value: s, label: SEMESTER_LABELS[s] }))} />
        </Group>
      </Group>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      <Group align="flex-start" gap="md" wrap="nowrap">
        <Paper withBorder p="sm" w={190} style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed" mb={8}>
            Derslerim {canWrite ? "· gride sürükle" : "· (yazma yetkiniz yok)"}
          </Text>
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">Bu cohort'ta ders yok.</Text>}
            {courses.flatMap((c) =>
              c.sections.map((s) => (
                <Paper key={s.id} withBorder p={6} radius="sm"
                  draggable={canWrite}
                  onDragStart={(ev) => {
                    ev.dataTransfer.effectAllowed = "copy";
                    ev.dataTransfer.setData("text/plain", String(s.id));
                    setDrag({ sectionId: s.id, courseId: c.id, label: `${c.code}-${s.section_no}` });
                  }}
                  onDragEnd={() => setDrag(null)}
                  style={{ cursor: canWrite ? "grab" : "default", fontSize: 12 }}>
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

        <Paper withBorder p="sm" style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 520 }}>
              <div style={{ width: 44, flexShrink: 0 }}>
                <div style={{ height: 24 }} />
                {SLOTS.map((s) => (
                  <div key={s} style={{ height: ROW_H, fontSize: 10, color: "var(--mantine-color-dimmed)", textAlign: "right", paddingRight: 4, paddingTop: 2 }}>{SLOT_START[s]}</div>
                ))}
              </div>
              {DAYS.map((d) => (
                <div key={d} style={{ flex: 1, minWidth: 92 }}>
                  <div style={{ height: 24, textAlign: "center", fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{DAY_SHORT[d]}</div>
                  <div style={{ position: "relative", height: ROW_H * 9 }}>
                    {/* Bırakma hücreleri (kartların ALTINDA; kartlar pointer-events:none) */}
                    {SLOTS.map((s) => {
                      const key = `${d}-${s}`;
                      return (
                        <div key={s}
                          onDragOver={(ev) => { if (drag && canWrite) { ev.preventDefault(); setOverCell(key); } }}
                          onDragLeave={() => setOverCell((c) => (c === key ? null : c))}
                          onDrop={(ev) => { ev.preventDefault(); onDrop(d, s); }}
                          style={{
                            position: "absolute", top: (s - 1) * ROW_H, left: 0, right: 0, height: ROW_H,
                            borderTop: "0.5px solid var(--mantine-color-default-border)",
                            background: overCell === key ? "var(--mantine-color-blue-light)" : undefined,
                          }} />
                      );
                    })}
                    {byDay.get(d)!.map((e) => (
                      <EntryCard key={e.id} e={e}
                        elective={electiveOf.get(e.section.course.id) ?? false}
                        hard={hardIds.has(e.id)} warn={warnIds.has(e.id)}
                        canDelete={canWrite && e.status === "DRAFT"}
                        onDelete={() => deleteEntry(e)} />
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

      {target && (
        <PlaceModal target={target} classrooms={classrooms} onClose={() => setTarget(null)}
          onSaved={(conflicts) => {
            setTarget(null);
            reload();
            if (conflicts.length) {
              const hard = conflicts.filter((c) => c.severity === "HARD").length;
              notifications.show({
                color: hard ? "red" : "orange",
                title: "Giriş kaydedildi (taslak)",
                message: `${conflicts.length} çakışma: ${conflicts.map((c) => c.rule_id).join(", ")}`,
              });
            } else {
              notifications.show({ color: "green", message: "Giriş kaydedildi — çakışma yok" });
            }
          }} />
      )}
    </Stack>
  );
}

function Legend({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <Group gap={4}>
      <span style={{ display: "inline-block", width: 20, height: 11, borderRadius: 3, border: "1px solid var(--mantine-color-default-border)", ...swatch }} />
      <span>{label}</span>
    </Group>
  );
}

function EntryCard({ e, elective, hard, warn, canDelete, onDelete }: {
  e: Placed; elective: boolean; hard: boolean; warn: boolean; canDelete: boolean; onDelete: () => void;
}) {
  const online = e.delivery_mode !== "FACE_TO_FACE";
  const draft = e.status === "DRAFT";
  let style: React.CSSProperties;
  if (hard) style = { background: "var(--mantine-color-red-light)", border: "1px solid var(--mantine-color-red-4)" };
  else if (warn) style = { background: "var(--mantine-color-orange-light)", border: "1px solid var(--mantine-color-orange-4)" };
  else if (online) style = { border: "1px dashed var(--mantine-color-blue-4)", background: "transparent" };
  else if (draft) style = { border: "1px dashed var(--mantine-color-default-border)", background: "transparent" };
  else style = { background: "var(--mantine-color-blue-light)", border: "1px solid var(--mantine-color-blue-4)" };

  const widthPct = 100 / e.lanes;
  return (
    <div style={{
      position: "absolute", top: (e.start_slot - 1) * ROW_H + 1, height: e.slot_count * ROW_H - 2,
      left: `calc(${e.lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
      borderRadius: 6, padding: "2px 4px", fontSize: 11, lineHeight: 1.2, overflow: "hidden",
      pointerEvents: "none", ...style,   // kartlar tıklamayı geçirir → drop hücreye ulaşır
    }}>
      <Group gap={2} justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ fontWeight: 500 }}>{e.section.course.code}-{e.section.section_no}</div>
        {canDelete && (
          <ActionIcon size="xs" variant="subtle" color="gray" style={{ pointerEvents: "auto" }}
            onClick={onDelete} aria-label="Sil">
            <IconTrash size={12} />
          </ActionIcon>
        )}
      </Group>
      <div style={{ fontSize: 10, opacity: 0.85 }}>
        {online ? "online" : e.classroom?.room_code ?? "—"}{elective ? " · seçmeli" : ""}
      </div>
    </div>
  );
}

function PlaceModal({ target, classrooms, onClose, onSaved }: {
  target: PlaceTarget; classrooms: Classroom[]; onClose: () => void;
  onSaved: (conflicts: ConflictResult[]) => void;
}) {
  const { drag, day, slot } = target;
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [sessionType, setSessionType] = useState<SessionType>("THEORY");
  const [delivery, setDelivery] = useState<DeliveryMode>("FACE_TO_FACE");
  const [slotCount, setSlotCount] = useState<number>(2);
  const [busy, setBusy] = useState(false);

  const online = delivery !== "FACE_TO_FACE";   // K-23: online → derslik yok
  const maxSlots = 9 - slot + 1;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ conflicts: ConflictResult[] }>("/weekly-entries", {
        section_id: drag.sectionId,
        classroom_id: online ? null : classroomId ? Number(classroomId) : null,
        day_of_week: day,
        start_slot: slot,
        slot_count: slotCount,
        session_type: sessionType,
        delivery_mode: delivery,
      });
      onSaved(res.conflicts);
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`${drag.label} → ${DAY_SHORT[day]} ${SLOT_START[slot]}`} size="sm">
      <Stack gap="sm">
        <Select label="Yapılış şekli" value={delivery} onChange={(v) => v && setDelivery(v as DeliveryMode)}
          data={(Object.keys(DELIVERY_LABELS) as DeliveryMode[]).map((k) => ({ value: k, label: DELIVERY_LABELS[k] }))} />
        <Select label="Derslik" value={classroomId} onChange={setClassroomId}
          disabled={online} placeholder={online ? "Online — derslik yok" : "Derslik seç"}
          data={classrooms.map((c) => ({ value: String(c.id), label: `${c.building.name} ${c.room_code}` }))} />
        <Select label="Oturum türü (T/U/L)" value={sessionType} onChange={(v) => v && setSessionType(v as SessionType)}
          data={(Object.keys(SESSION_LABELS) as SessionType[]).map((k) => ({ value: k, label: SESSION_LABELS[k] }))} />
        <NumberInput label="Slot sayısı" value={slotCount} onChange={(v) => setSlotCount(Number(v) || 1)}
          min={1} max={maxSlots} />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} loading={busy}>Kaydet (taslak)</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
