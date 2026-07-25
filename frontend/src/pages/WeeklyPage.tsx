import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput,
  Paper, ScrollArea, Select, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconTrash } from "@tabler/icons-react";
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

/** Gridde çizilen birim: bir KÜME.
 *
 *  Aynı dersin aynı gün/saatteki paralel şubeleri TEK kümeye toplanır. Gerçek
 *  veride servis derslerinin 7-8 şubesi aynı slotta olabiliyor (ENG1804, PHYS1852);
 *  her şubeyi ayrı şeride açmak kartları ~11px'e düşürüp okunmaz hale getiriyordu.
 *  Cohort görünümü "öğrencinin haftası"dır ve öğrenci o şubelerden BİRİNİ alır —
 *  8'ini birden çizmek bilgi değil gürültü. */
type Cluster = {
  id: string;
  entries: WeeklyEntry[];
  start_slot: number;
  slot_count: number;
  lane: number;
  lanes: number;
};

/** Sürüklenen şey: paletten YENİ giriş mi, yoksa var olan girişin TAŞINMASI mı. */
type Drag =
  | { kind: "new"; sectionId: number; label: string }
  | { kind: "move"; entry: WeeklyEntry };

/** Bir günün girişlerini önce KÜMELERE toplar, sonra yan yana şeritlere böler. */
function layoutDay(entries: WeeklyEntry[]): Cluster[] {
  // 1) Aynı ders + aynı zaman + aynı oturum türü → tek küme (paralel şubeler)
  const groups = new Map<string, WeeklyEntry[]>();
  for (const e of entries) {
    const key = `${e.section.course.id}|${e.start_slot}|${e.slot_count}|${e.session_type}`;
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  const items = [...groups.entries()]
    .map(([id, es]) => ({
      id,
      entries: [...es].sort((a, b) => a.section.section_no - b.section.section_no),
      start_slot: es[0].start_slot,
      slot_count: es[0].slot_count,
    }))
    .sort((a, b) => a.start_slot - b.start_slot || a.id.localeCompare(b.id));

  // 2) Kesişen kümeleri şeritlere dağıt (takvim yerleşimi)
  const end = (c: { start_slot: number; slot_count: number }) =>
    c.start_slot + c.slot_count - 1;
  const out: Cluster[] = [];
  let batch: typeof items = [];
  let batchEnd = 0;
  const flush = () => {
    if (!batch.length) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const c of batch) {
      let lane = laneEnds.findIndex((le) => le < c.start_slot);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = end(c);
      laneOf.set(c.id, lane);
    }
    for (const c of batch) out.push({ ...c, lane: laneOf.get(c.id)!, lanes: laneEnds.length });
    batch = [];
  };
  for (const c of items) {
    if (batch.length && c.start_slot > batchEnd) flush();
    batch.push(c);
    batchEnd = Math.max(batchEnd, end(c));
  }
  flush();
  return out;
}

export default function WeeklyPage() {
  const { user } = useAuth();

  const [departments, setDepartments] = useState<Department[]>([]);
  // Cohort seçimi localStorage'da: başka sayfaya gidip dönünce kullanıcı
  // kaldığı yerden devam etsin, her seferinde varsayılana düşmesin.
  const [dep, setDep] = useLocalStorage<string | null>({
    key: "weekly-dep", defaultValue: null, getInitialValueInEffect: false });
  const [year, setYear] = useLocalStorage({
    key: "weekly-year", defaultValue: "1", getInitialValueInEffect: false });
  const [sem, setSem] = useLocalStorage<SemesterType>({
    key: "weekly-sem", defaultValue: "SPRING", getInitialValueInEffect: false });

  const [entries, setEntries] = useState<WeeklyEntry[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [scan, setScan] = useState<ConflictScan>({ hard: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);           // "day-slot"
  const [placing, setPlacing] = useState<{ drag: Drag; day: number; slot: number } | null>(null);
  const [editing, setEditing] = useState<WeeklyEntry | null>(null);
  const [group, setGroup] = useState<Cluster | null>(null);   // toplu kart detayı
  const [submitOpen, setSubmitOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");

  // Palet yüksekliği GRID'e bağlanır, kendi içeriğine değil: ders sayısı arttıkça
  // uzamasın, kaydırsın. Ölçüyoruz çünkü sabit sayı yazmak grid'in iç yapısı
  // (başlık yüksekliği, satır sayısı, Paper dolgusu) değişince sessizce bozulur.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridH, setGridH] = useState<number | undefined>();
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // offsetHeight: kenarlık ve YATAY kaydırma çubuğu dahil. clientHeight ikisini
    // de dışarıda bırakıp paleti grid'den ~17px kısa gösteriyordu.
    const ro = new ResizeObserver(() => setGridH(el.offsetHeight));
    ro.observe(el);
    setGridH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const canWrite = canWriteIn(user, "can_manage_weekly", dep ? Number(dep) : undefined);

  useEffect(() => {
    Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Classroom[]>("/classrooms"),
    ])
      .then(([d, c]) => {
        setDepartments(d);
        setClassrooms(c);
        // Kayıtlı bölüm hâlâ geçerliyse ona dokunma; yoksa ilkine düş.
        setDep((mevcut) =>
          mevcut && d.some((x) => String(x.id) === mevcut)
            ? mevcut
            : d.length ? String(d[0].id) : null);
      })
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
    const m = new Map<number, Cluster[]>();
    for (const d of DAYS) m.set(d, layoutDay(entries.filter((e) => e.day_of_week === d)));
    return m;
  }, [entries]);

  const showConflicts = (conflicts: ConflictResult[], baslik: string) => {
    if (!conflicts.length) {
      notifications.show({ color: "green", message: `${baslik} — çakışma yok` });
      return;
    }
    const hard = conflicts.some((c) => c.severity === "HARD");
    notifications.show({
      color: hard ? "red" : "orange",
      title: baslik,
      message: `${conflicts.length} çakışma: ${conflicts.map((c) => c.rule_id).join(", ")}`,
    });
  };

  /** Taşıma: yalnız gün/slot değişir; derslik, tür ve süre korunur. */
  const moveEntry = async (entry: WeeklyEntry, day: number, slot: number) => {
    if (entry.day_of_week === day && entry.start_slot === slot) return;
    try {
      const res = await api.patch<{ conflicts: ConflictResult[] }>(
        `/weekly-entries/${entry.id}`, { day_of_week: day, start_slot: slot },
      );
      reload();
      showConflicts(res.conflicts, "Giriş taşındı");
    } catch (err) {
      // Pencere taşması (400) ve SUBMITTED kilidi (409) burada görünür.
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Taşınamadı" });
    }
  };

  const onDrop = (day: number, slot: number) => {
    setOver(null);
    const d = drag;
    setDrag(null);
    if (!d || !canWrite) return;
    if (d.kind === "move") void moveEntry(d.entry, day, slot);
    else setPlacing({ drag: d, day, slot });
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

  /** Yayından taslağa geri al (K-03 değişiklik-seti modeli): kilidi açar,
   *  giriş yeniden düzenlenebilir/taşınabilir hale gelir. */
  const revertEntry = async (e: WeeklyEntry) => {
    try {
      await api.post(`/weekly-entries/${e.id}/revert-to-draft`);
      notifications.show({ message: "Giriş taslağa çevrildi", color: "gray" });
      reload();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Çevrilemedi" });
    }
  };

  // Yayınlanacak küme: bu cohort görünümündeki taslaklar.
  const drafts = useMemo(() => entries.filter((e) => e.status === "DRAFT"), [entries]);

  /** Palet öğeleri: ders × şube, koda VEYA ada göre süzülür.
   *  Türkçe küçültme: "İSTATİSTİK".toLowerCase() yanlış sonuç verir, locale şart. */
  const paletteItems = useMemo(() => {
    const q = paletteSearch.trim().toLocaleLowerCase("tr");
    return courses
      .flatMap((c) => c.sections.map((s) => ({ course: c, section: s })))
      .filter(({ course: c, section: s }) => {
        if (!q) return true;
        const hay = `${c.code}-${s.section_no} ${c.name}`.toLocaleLowerCase("tr");
        return hay.includes(q);
      });
  }, [courses, paletteSearch]);

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
          {canWrite && (
            <Button size="xs" mt={22} disabled={drafts.length === 0}
              onClick={() => setSubmitOpen(true)}>
              Yayınla{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
          )}
        </Group>
      </Group>

      {error && <Alert color="red" variant="light">{error}</Alert>}

      <Group align="flex-start" gap="md" wrap="nowrap">
        {/* Yükseklik grid'den gelir (yukarıdaki ölçüm); içerik taşarsa kaydırılır. */}
        <Paper withBorder p="sm" w={190}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: gridH }}>
          <TextInput size="xs" mb={8} value={paletteSearch}
            onChange={(ev) => setPaletteSearch(ev.currentTarget.value)}
            placeholder="Ders kodu veya adı ara" />
          {!canWrite && <Text size="10px" c="dimmed" mb={6}>Yazma yetkiniz yok</Text>}
          {/* minHeight:0 olmadan flex çocuğu küçülmez ve kaydırma çalışmaz */}
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">Bu cohort'ta ders yok.</Text>}
            {courses.length > 0 && paletteItems.length === 0 && (
              <Text size="xs" c="dimmed">Eşleşen ders yok.</Text>
            )}
            {paletteItems.map(({ course: c, section: s }) => (
              <Paper key={s.id} withBorder p={6} radius="sm"
                draggable={canWrite}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "copy";
                  ev.dataTransfer.setData("text/plain", String(s.id));
                  setDrag({ kind: "new", sectionId: s.id, label: `${c.code}-${s.section_no}` });
                }}
                onDragEnd={() => setDrag(null)}
                style={{ cursor: canWrite ? "grab" : "default", fontSize: 12, flexShrink: 0 }}>
                <Group gap={4} justify="space-between" wrap="nowrap">
                  <Text size="xs" fw={500}>{c.code}-{s.section_no}</Text>
                  {c.is_elective && <Badge size="xs" variant="light" color="grape">seçmeli</Badge>}
                </Group>
                <Text size="10px" c="dimmed" truncate>{c.name}</Text>
              </Paper>
            ))}
          </Stack>
          </ScrollArea>
        </Paper>

        <Paper ref={gridRef} withBorder p="sm"
          style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 520 }}>
              {/* Zaman cetveli: slot başlangıçları + pencerenin KAPANIŞI (17:30).
                  Son etiket olmadan cetvel 16:30'da bitiyor ve son dersin nerede
                  bittiği okunmuyordu (brief §3.4 penceresi 08:30-17:30). */}
              <div style={{ width: 46, flexShrink: 0, position: "relative", height: 24 + ROW_H * 9 }}>
                {SLOTS.map((s) => (
                  <div key={s} style={{
                    position: "absolute", top: 24 + (s - 1) * ROW_H - 6, right: 6,
                    fontSize: 10, color: "var(--mantine-color-dimmed)",
                  }}>{SLOT_START[s]}</div>
                ))}
                <div style={{
                  position: "absolute", top: 24 + ROW_H * 9 - 6, right: 6,
                  fontSize: 10, color: "var(--mantine-color-dimmed)",
                }}>17:30</div>
              </div>
              {DAYS.map((d) => (
                // Günler dikey çizgiyle ayrılır; sonuncuya sağ çizgi de eklenir
                // ki tablo kapansın.
                <div key={d} style={{
                  flex: 1, minWidth: 92,
                  borderLeft: "1px solid var(--mantine-color-default-border)",
                  borderRight: d === DAYS[DAYS.length - 1]
                    ? "1px solid var(--mantine-color-default-border)" : undefined,
                }}>
                  <div style={{ height: 24, textAlign: "center", fontSize: 12, color: "var(--mantine-color-dimmed)" }}>{DAY_SHORT[d]}</div>
                  {/* Gün sütununun TAMAMI tek bırakma katmanı: slot imleç konumundan
                      hesaplanır. Böylece kartlar tıklanabilir/sürüklenebilir kalır
                      (drag olayları köpürüp buraya ulaşır). */}
                  <div
                    onDragOver={(ev) => {
                      if (!drag || !canWrite) return;
                      ev.preventDefault();
                      const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                      const slot = Math.min(9, Math.max(1, Math.floor(y / ROW_H) + 1));
                      setOver(`${d}-${slot}`);
                    }}
                    onDragLeave={(ev) => {
                      if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver(null);
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                      onDrop(d, Math.min(9, Math.max(1, Math.floor(y / ROW_H) + 1)));
                    }}
                    style={{
                      position: "relative", height: ROW_H * 9,
                      // Kapanış çizgisi: 17:30 etiketi buraya hizalanır
                      borderBottom: "1px solid var(--mantine-color-default-border)",
                    }}
                  >
                    {SLOTS.map((s) => (
                      <div key={s} style={{
                        position: "absolute", top: (s - 1) * ROW_H, left: 0, right: 0, height: ROW_H,
                        borderTop: "0.5px solid var(--mantine-color-default-border)",
                        background: over === `${d}-${s}` ? "var(--mantine-color-blue-light)" : undefined,
                        pointerEvents: "none",
                      }} />
                    ))}
                    {byDay.get(d)!.map((c) => (
                      <ClusterCard key={c.id} c={c} canWrite={canWrite}
                        elective={electiveOf.get(c.entries[0].section.course.id) ?? false}
                        hard={c.entries.some((e) => hardIds.has(e.id))}
                        warn={c.entries.some((e) => warnIds.has(e.id))}
                        onDragStart={(e) => setDrag({ kind: "move", entry: e })}
                        onDragEnd={() => setDrag(null)}
                        onEdit={setEditing}
                        onDelete={deleteEntry}
                        onRevert={revertEntry}
                        onOpenGroup={() => setGroup(c)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Paper>
      </Group>

      <Group gap="lg" style={{ fontSize: 11, color: "var(--mantine-color-dimmed)" }}>
        <Legend label="Yayınlanmış" swatch={{
          background: "var(--mantine-color-blue-2)", borderColor: "var(--mantine-color-blue-7)" }} />
        <Legend label="Taslak (çapraz tarama)" swatch={{
          background: "var(--mantine-color-blue-2)", borderColor: "var(--mantine-color-blue-7)",
          borderStyle: "dashed",
          backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 4px, transparent 4px 10px)" }} />
        <Legend label="Çakışma (engel)" swatch={{
          background: "var(--mantine-color-red-2)", borderColor: "var(--mantine-color-red-7)" }} />
        <Legend label="Uyarı" swatch={{
          background: "var(--mantine-color-orange-2)", borderColor: "var(--mantine-color-orange-7)" }} />
        <Legend label="Online (dersliksiz)" swatch={{
          background: "var(--mantine-color-cyan-2)", borderColor: "var(--mantine-color-cyan-7)" }} />
      </Group>

      {placing && placing.drag.kind === "new" && (
        <EntryModal
          title={`${placing.drag.label} → ${DAY_SHORT[placing.day]} ${SLOT_START[placing.slot]}`}
          classrooms={classrooms} startSlot={placing.slot}
          onClose={() => setPlacing(null)}
          onSubmit={(body) => api.post<{ conflicts: ConflictResult[] }>("/weekly-entries", {
            section_id: (placing.drag as { sectionId: number }).sectionId,
            day_of_week: placing.day, start_slot: placing.slot, ...body,
          })}
          onDone={(conflicts) => { setPlacing(null); reload(); showConflicts(conflicts, "Giriş kaydedildi (taslak)"); }}
        />
      )}

      {group && (
        <GroupModal cluster={group} canWrite={canWrite} onClose={() => setGroup(null)}
          onEdit={setEditing} onDelete={deleteEntry} onRevert={revertEntry} />
      )}

      {submitOpen && (
        <SubmitModal drafts={drafts} onClose={() => setSubmitOpen(false)}
          onDone={(warnings) => {
            setSubmitOpen(false);
            reload();
            notifications.show({
              color: warnings.length ? "orange" : "green",
              title: "Program yayınlandı",
              message: warnings.length
                ? `${warnings.length} uyarı görünür kalıyor: ${warnings.map((w) => w.rule_id).join(", ")}`
                : "Çakışma yok",
            });
          }} />
      )}

      {editing && (
        <EntryModal
          title={`${editing.section.course.code}-${editing.section.section_no} · ${DAY_SHORT[editing.day_of_week]} ${SLOT_START[editing.start_slot]}`}
          classrooms={classrooms} startSlot={editing.start_slot}
          initial={{
            classroomId: editing.classroom ? String(editing.classroom.id) : null,
            sessionType: editing.session_type,
            delivery: editing.delivery_mode,
            slotCount: editing.slot_count,
          }}
          onClose={() => setEditing(null)}
          onSubmit={(body) => api.patch<{ conflicts: ConflictResult[] }>(`/weekly-entries/${editing.id}`, body)}
          onDone={(conflicts) => { setEditing(null); reload(); showConflicts(conflicts, "Giriş güncellendi"); }}
        />
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

function ClusterCard({ c, elective, hard, warn, canWrite, onDragStart, onDragEnd, onEdit, onDelete, onRevert, onOpenGroup }: {
  c: Cluster; elective: boolean; hard: boolean; warn: boolean; canWrite: boolean;
  onDragStart: (e: WeeklyEntry) => void; onDragEnd: () => void;
  onEdit: (e: WeeklyEntry) => void; onDelete: (e: WeeklyEntry) => void;
  onRevert: (e: WeeklyEntry) => void; onOpenGroup: () => void;
}) {
  const many = c.entries.length > 1;
  const e = c.entries[0];
  const online = e.delivery_mode !== "FACE_TO_FACE";
  // Kümede karışık durum olabilir; taslak DESENİ en az bir taslak varsa çizilir.
  const draft = c.entries.some((x) => x.status === "DRAFT");
  const editable = canWrite && !many && e.status === "DRAFT";
  const revertable = canWrite && !many && e.status === "SUBMITTED";

  // İki BAĞIMSIZ görsel boyut:
  //  1) RENK  = durum (çakışma > online > normal) — dolgun tonlar, soluk değil
  //  2) DESEN = yaşam döngüsü (taslak → çapraz tarama, yayınlanmış → düz)
  // Eskiden taslak "beyaz zemin"di; beyaz hem sayfa arkaplanıyla karışıyordu
  // hem de çakışma rengini yutuyordu. Artık ikisi üst üste okunabiliyor.
  const palette = hard
    ? { bg: "var(--mantine-color-red-2)", bd: "var(--mantine-color-red-7)", fg: "var(--mantine-color-red-9)" }
    : warn
    ? { bg: "var(--mantine-color-orange-2)", bd: "var(--mantine-color-orange-7)", fg: "var(--mantine-color-orange-9)" }
    : online
    ? { bg: "var(--mantine-color-cyan-2)", bd: "var(--mantine-color-cyan-7)", fg: "var(--mantine-color-cyan-9)" }
    : { bg: "var(--mantine-color-blue-2)", bd: "var(--mantine-color-blue-7)", fg: "var(--mantine-color-blue-9)" };

  const style: React.CSSProperties = {
    background: palette.bg,
    color: palette.fg,
    border: `1px ${draft ? "dashed" : "solid"} ${palette.bd}`,
    // Saydam çapraz tarama: rengin ÜSTÜNE biner, rengi değiştirmez.
    // Bant kalın ve seyrek (10px bant / 26px periyot): ince-sık desen küçük
    // kartlarda titreşim yapıp gözü yoruyordu.
    backgroundImage: draft
      ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 10px, transparent 10px 26px)"
      : undefined,
  };

  const widthPct = 100 / c.lanes;
  // Toplu kartta tek derslik yazılamaz; kaç farklı derslik kullanıldığını söyler.
  const rooms = new Set(c.entries.map((x) => x.classroom?.room_code).filter(Boolean));
  const altSatir = many
    ? `${c.entries.length} şube${rooms.size > 1 ? ` · ${rooms.size} derslik` : rooms.size === 1 ? ` · ${[...rooms][0]}` : ""}`
    : `${online ? "online" : e.classroom?.room_code ?? "—"}`;

  return (
    <div
      draggable={editable}
      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; onDragStart(e); }}
      onDragEnd={onDragEnd}
      onClick={() => (many ? onOpenGroup() : editable && onEdit(e))}
      title={many
        ? `${c.entries.length} paralel şube — listelemek için tıkla`
        : editable ? "Düzenlemek için tıkla, taşımak için sürükle" : undefined}
      style={{
        position: "absolute", top: (c.start_slot - 1) * ROW_H + 1, height: c.slot_count * ROW_H - 2,
        left: `calc(${c.lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
        borderRadius: 6, padding: "2px 4px", fontSize: 11, lineHeight: 1.2, overflow: "hidden",
        cursor: many ? "pointer" : editable ? "grab" : "default", ...style,
      }}>
      <Group gap={2} justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ fontWeight: 500 }}>
          {e.section.course.code}{many ? "" : `-${e.section.section_no}`}
        </div>
        {many && (
          <Badge size="xs" variant="filled" color="gray" style={{ flexShrink: 0 }}>
            {c.entries.length}
          </Badge>
        )}
        {editable && (
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Sil"
            onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}>
            <IconTrash size={12} />
          </ActionIcon>
        )}
        {revertable && (
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Taslağa çevir"
            title="Taslağa çevir (düzenlemek için)"
            onClick={(ev) => { ev.stopPropagation(); onRevert(e); }}>
            <IconArrowBackUp size={12} />
          </ActionIcon>
        )}
      </Group>
      <div style={{ fontSize: 10, opacity: 0.85 }}>
        {altSatir}{elective ? " · seçmeli" : ""}
      </div>
    </div>
  );
}

/** Toplu kartın detayı: paralel şubeler burada tek tek listelenir ve yönetilir.
 *  Gridde 8 şubeyi yan yana çizmek yerine buraya taşıdık — grid okunur kalıyor,
 *  şube düzeyindeki işlemler (düzenle/sil/taslağa çevir) kaybolmuyor. */
function GroupModal({ cluster, canWrite, onClose, onEdit, onDelete, onRevert }: {
  cluster: Cluster; canWrite: boolean; onClose: () => void;
  onEdit: (e: WeeklyEntry) => void; onDelete: (e: WeeklyEntry) => void;
  onRevert: (e: WeeklyEntry) => void;
}) {
  const first = cluster.entries[0];
  return (
    <Modal opened onClose={onClose} size="md"
      title={`${first.section.course.code} · ${DAY_SHORT[first.day_of_week]} ${SLOT_START[cluster.start_slot]} · ${cluster.entries.length} şube`}>
      <Stack gap={6}>
        <Text size="xs" c="dimmed">{first.section.course.name}</Text>
        {cluster.entries.map((e) => (
          <Group key={e.id} gap="xs" wrap="nowrap" justify="space-between"
            style={{ borderBottom: "1px solid var(--mantine-color-default-border)", paddingBottom: 6 }}>
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Badge size="sm" variant="outline">Şube {e.section.section_no}</Badge>
              <Text size="sm" truncate>
                {e.delivery_mode !== "FACE_TO_FACE"
                  ? "online"
                  : e.classroom
                  ? `${e.classroom.building.name} ${e.classroom.room_code}`
                  : "derslik yok"}
              </Text>
              <Badge size="xs" variant="light" color={e.status === "SUBMITTED" ? "green" : "yellow"}>
                {e.status === "SUBMITTED" ? "yayında" : "taslak"}
              </Badge>
            </Group>
            {canWrite && (
              <Group gap={4} wrap="nowrap">
                {e.status === "DRAFT" ? (
                  <>
                    <Button size="compact-xs" variant="subtle"
                      onClick={() => { onClose(); onEdit(e); }}>Düzenle</Button>
                    <ActionIcon size="sm" variant="subtle" color="red" aria-label="Sil"
                      onClick={() => { onClose(); onDelete(e); }}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </>
                ) : (
                  <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Taslağa çevir"
                    onClick={() => { onClose(); onRevert(e); }}>
                    <IconArrowBackUp size={14} />
                  </ActionIcon>
                )}
              </Group>
            )}
          </Group>
        ))}
      </Stack>
    </Modal>
  );
}

/** Yayınlama kapısı (K-03): HARD çakışma varsa sunucu hep-veya-hiç reddeder.
 *  Reddi sessiz "hata" olarak geçmek yerine SEBEBİYLE gösteriyoruz — brief §3.6
 *  "genel hata mesajı değil, açık gerekçe" şartı tam da burada karşılanır. */
function SubmitModal({ drafts, onClose, onDone }: {
  drafts: WeeklyEntry[];
  onClose: () => void;
  onDone: (warnings: ConflictResult[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);

  const submit = async () => {
    setBusy(true);
    setBlockers(null);
    try {
      const res = await api.post<{ submitted: number[]; warnings: ConflictResult[] }>(
        "/weekly-entries/submit", { entry_ids: drafts.map((d) => d.id) },
      );
      onDone(res.warnings);
    } catch (err) {
      // 409 gövdesi {detail, conflicts} taşır — listeyi modalda açık bırakırız
      // ki kullanıcı neyi düzelteceğini görsün ve düzeltip tekrar denesin.
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { conflicts?: ConflictResult[] } | null;
        setBlockers(body?.conflicts ?? []);
      } else {
        notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Yayınlanamadı" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title="Programı yayınla" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          {drafts.length} taslak giriş yayınlanacak. Yayınlanan girişler kilitlenir;
          düzenlemek için tekrar taslağa çevirmen gerekir.
        </Text>

        {blockers && (
          <Alert color="red" variant="light" title="Yayınlama reddedildi">
            <Text size="sm" mb={6}>
              Engelleyici çakışmalar var — hiçbir giriş yayınlanmadı. Düzeltip tekrar dene.
            </Text>
            <Stack gap={4}>
              {blockers.map((c, i) => (
                <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                  <Badge size="xs" color="red">{c.rule_id}</Badge>
                  <Text size="xs">{c.message}</Text>
                </Group>
              ))}
            </Stack>
          </Alert>
        )}

        <Stack gap={2} style={{ maxHeight: 200, overflowY: "auto" }}>
          {drafts.map((d) => (
            <Text key={d.id} size="xs" c="dimmed">
              {d.section.course.code}-{d.section.section_no} · {DAY_SHORT[d.day_of_week]} {SLOT_START[d.start_slot]}
              {d.classroom ? ` · ${d.classroom.room_code}` : " · online"}
            </Text>
          ))}
        </Stack>

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} loading={busy}>
            {blockers ? "Tekrar dene" : "Yayınla"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type EntryBody = {
  classroom_id: number | null; session_type: SessionType;
  delivery_mode: DeliveryMode; slot_count: number;
};

/** Yerleştirme ve düzenleme aynı alanları sorar — tek bileşen iki işi görür. */
function EntryModal({ title, classrooms, startSlot, initial, onClose, onSubmit, onDone }: {
  title: string;
  classrooms: Classroom[];
  startSlot: number;
  initial?: { classroomId: string | null; sessionType: SessionType; delivery: DeliveryMode; slotCount: number };
  onClose: () => void;
  onSubmit: (body: EntryBody) => Promise<{ conflicts: ConflictResult[] }>;
  onDone: (conflicts: ConflictResult[]) => void;
}) {
  const [classroomId, setClassroomId] = useState<string | null>(initial?.classroomId ?? null);
  const [sessionType, setSessionType] = useState<SessionType>(initial?.sessionType ?? "THEORY");
  const [delivery, setDelivery] = useState<DeliveryMode>(initial?.delivery ?? "FACE_TO_FACE");
  const [slotCount, setSlotCount] = useState<number>(initial?.slotCount ?? 2);
  const [busy, setBusy] = useState(false);

  const online = delivery !== "FACE_TO_FACE";   // K-23: online girişte derslik olamaz
  const maxSlots = 9 - startSlot + 1;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await onSubmit({
        classroom_id: online ? null : classroomId ? Number(classroomId) : null,
        session_type: sessionType, delivery_mode: delivery, slot_count: slotCount,
      });
      onDone(res.conflicts);
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={title} size="sm">
      <Stack gap="sm">
        <Select label="Yapılış şekli" value={delivery} onChange={(v) => v && setDelivery(v as DeliveryMode)}
          data={(Object.keys(DELIVERY_LABELS) as DeliveryMode[]).map((k) => ({ value: k, label: DELIVERY_LABELS[k] }))} />
        <Select label="Derslik" value={online ? null : classroomId} onChange={setClassroomId}
          disabled={online} placeholder={online ? "Online — derslik yok" : "Derslik seç"} clearable
          data={classrooms.map((c) => ({ value: String(c.id), label: `${c.building.name} ${c.room_code}` }))} />
        <Select label="Oturum türü (T/U/L)" value={sessionType} onChange={(v) => v && setSessionType(v as SessionType)}
          data={(Object.keys(SESSION_LABELS) as SessionType[]).map((k) => ({ value: k, label: SESSION_LABELS[k] }))} />
        <NumberInput label="Slot sayısı" value={slotCount} onChange={(v) => setSlotCount(Number(v) || 1)}
          min={1} max={maxSlots} />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} loading={busy}>Kaydet</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
