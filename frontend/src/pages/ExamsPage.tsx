import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, MultiSelect,
  NumberInput, Paper, Popover, ScrollArea, Select, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp, IconChevronLeft, IconChevronRight, IconPlus, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { EXAM_TYPE_LABELS, SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import type {
  Classroom, ConflictResult, ConflictScan, Course, Department, Exam, ExamType,
  Lecturer, SemesterType,
} from "../api/types";

/* Haftalık programdan TEMEL FARK: burada slot yok, gerçek takvim var.
   Sınav herhangi bir saatte olabilir (K-06: 17:30 sonrası serbest), süresi
   dakikadır. Bu yüzden dikey eksen slot değil DAKİKA ölçeğinde. */
const DAY_START = 8 * 60;        // 08:00
const DAY_END = 21 * 60;         // 21:00 — akşam sınavları da sığsın
const HOUR_H = 56;               // bir saatin piksel yüksekliği
const PX = HOUR_H / 60;          // dakika başına piksel
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 },
  (_, i) => DAY_START + i * 60);
const HEAD_H = 44;
const LINE = "var(--mantine-color-gray-2)";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Verilen tarihin haftasının PAZARTESİ'si (ISO hafta). */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const iso = (d: Date) => {
  // toISOString UTC'ye kaydırır ve yerel saatte tarihi bir gün geri atabilir;
  // takvimde gün kayması kabul edilemez, o yüzden elle biçimliyoruz.
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** K-06: Hafta sonu (Cumartesi / Pazar) sınav günü olarak seçilemez. */
function isWeekend(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Sürüklenen şey: paletten yeni sınav mı, var olan sınavın taşınması mı. */
type ExamDrag =
  | { kind: "new"; courseId: number; label: string }
  | { kind: "move"; exam: Exam };

/** Aynı gündeki sınavları kesişenler yan yana gelecek şekilde şeritlere böler. */
type Placed = Exam & { lane: number; lanes: number };

function layoutDay(exams: Exam[]): Placed[] {
  const sorted = [...exams].sort((a, b) => toMin(a.start_time) - toMin(b.start_time) || a.id - b.id);
  const end = (e: Exam) => toMin(e.start_time) + e.duration_minutes;
  const out: Placed[] = [];
  let batch: Exam[] = [];
  let batchEnd = 0;
  const flush = () => {
    if (!batch.length) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<number, number>();
    for (const e of batch) {
      let lane = laneEnds.findIndex((le) => le <= toMin(e.start_time));
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = end(e);
      laneOf.set(e.id, lane);
    }
    for (const e of batch) out.push({ ...e, lane: laneOf.get(e.id)!, lanes: laneEnds.length });
    batch = [];
  };
  for (const e of sorted) {
    if (batch.length && toMin(e.start_time) >= batchEnd) flush();
    batch.push(e);
    batchEnd = Math.max(batchEnd, end(e));
  }
  flush();
  return out;
}

export default function ExamsPage() {
  const { user } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [scan, setScan] = useState<ConflictScan>({ hard: [], warnings: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cohort seçimi (bölüm + yıl + dönem) — haftalık programdaki mercekle aynı.
  // Sınav TÜRÜ artık burada süzgeç DEĞİL: takvimde vize/final/bütünleme bir
  // arada görünür, tür sınav eklenirken soruluyor.
  const [dep, setDep] = useLocalStorage<string | null>({
    key: "exams-dep", defaultValue: null, getInitialValueInEffect: false });
  const [year, setYear] = useLocalStorage({
    key: "exams-year", defaultValue: "1", getInitialValueInEffect: false });
  const [sem, setSem] = useLocalStorage<SemesterType>({
    key: "exams-sem", defaultValue: "SPRING", getInitialValueInEffect: false });
  // Hafta da kalıcı: sekme değiştirip dönünce kullanıcı kaldığı haftada devam
  // etsin. İLK açılışta (kayıt yokken) veriye atlıyoruz — boş takvimle
  // karşılaşmasın diye; sonrasında seçim hatırlanır.
  const [weekIso, setWeekIso] = useLocalStorage<string | null>({
    key: "exams-week", defaultValue: null, getInitialValueInEffect: false });
  const weekStart = useMemo(
    () => (weekIso ? new Date(`${weekIso}T00:00:00`) : mondayOf(new Date())),
    [weekIso]);
  const setWeek = (d: Date) => setWeekIso(iso(mondayOf(d)));

  const [hoverCell, setHoverCell] = useState<string | null>(null);   // "gun-dakika"
  // Sürüklenen: paletten YENİ sınav mı, var olanın TAŞINMASI mı
  const [drag, setDrag] = useState<ExamDrag | null>(null);
  const [over, setOver] = useState<string | null>(null);             // "gun|dakika"
  const [placing, setPlacing] =
    useState<{ date: string; min: number; courseId?: number } | null>(null);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<Exam[]>("/exams"),
      api.get<Course[]>("/courses"),
      api.get<Classroom[]>("/classrooms"),
      api.get<Lecturer[]>("/lecturers?search="),
      api.get<Department[]>("/departments"),
      api.get<ConflictScan>("/conflicts"),
    ])
      .then(([x, c, cl, l, d, s]) => {
        setExams(x); setCourses(c); setClassrooms(cl);
        setLecturers(l); setDepartments(d); setScan(s);
        setDep((mevcut) =>
          mevcut && d.some((y) => String(y.id) === mevcut)
            ? mevcut : d.length ? String(d[0].id) : null);
        // Yalnız İLK açılışta (kayıtlı hafta yokken) en erken sınavın haftasına git.
        if (!weekIso && x.length) {
          const enErken = x.map((e) => e.exam_date).sort()[0];
          setWeek(new Date(`${enErken}T00:00:00`));
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Sınavlar yüklenemedi"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const gunler = useMemo(
    () => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)), [weekStart]);

  /** Seçili cohort'un dersleri (bölüm + yıl + dönem). */
  const cohortCourses = useMemo(
    () => courses.filter((c) =>
      String(c.department_id) === dep && String(c.year) === year && c.semester === sem),
    [courses, dep, year, sem]);
  const cohortCourseIds = useMemo(
    () => new Set(cohortCourses.map((c) => c.id)), [cohortCourses]);

  /** Bu haftanın sınavları — TÜM türler bir arada, cohort'a göre süzülmüş. */
  const byDay = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const g of gunler) {
      const gun = iso(g);
      m.set(gun, layoutDay(exams.filter(
        (e) => e.exam_date === gun && cohortCourseIds.has(e.course.id))));
    }
    return m;
  }, [exams, gunler, cohortCourseIds]);

  const { hardIds, warnIds } = useMemo(() => {
    const h = new Set<number>(), w = new Set<number>();
    for (const c of scan.hard) for (const a of c.affected) if (a.type === "exam") h.add(a.id);
    for (const c of scan.warnings) for (const a of c.affected) if (a.type === "exam") w.add(a.id);
    return { hardIds: h, warnIds: w };
  }, [scan]);

  /** Sol panel: cohort'un dersleri + her birinde HANGİ sınav türü tanımlı.
   *  Üç türü de tanımlanmış ders "bitmiş" sayılır: soluk ve listenin altında
   *  (haftalık programdaki tamamlanmış ders deseniyle aynı). */
  const paletDersler = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    const turlerOf = (courseId: number) =>
      new Set(exams.filter((e) => e.course.id === courseId).map((e) => e.exam_type));
    return cohortCourses
      .filter((c) => c.active)
      .filter((c) => !q || `${c.code} ${c.name}`.toLocaleLowerCase("tr").includes(q))
      .map((c) => {
        const turler = turlerOf(c.id);
        return { course: c, turler, done: turler.size === 3 };
      })
      .sort((a, b) => Number(a.done) - Number(b.done)
        || a.course.code.localeCompare(b.course.code, "tr"));
  }, [cohortCourses, exams, search]);

  const bolumOf = (courseId: number) =>
    courses.find((c) => c.id === courseId)?.department_id;

  const canWriteCourse = (courseId: number) =>
    canWriteIn(user, "can_manage_exams", bolumOf(courseId));
  // Herhangi bir bölümde sınav yazabiliyor mu (boş hücreye tıklama için)
  const canWriteAny = canWriteIn(user, "can_manage_exams")
    && (user?.role === "ADMIN" || (user?.department_ids.length ?? 0) > 0);

  // Yayınlanacak küme: bu cohort'un, yazma yetkim olan taslak sınavları.
  const drafts = useMemo(
    () => exams.filter((e) => cohortCourseIds.has(e.course.id) && e.status === "DRAFT"
      && canWriteCourse(e.course.id)),
    [exams, cohortCourseIds, user, courses]);

  /** Sayfa altındaki liste: SINAVI ilgilendiren çakışmalar.
   *  Alt hesap süzmesi haftalık ekrandakiyle aynı mantık (K-26 notu orada). */
  const examConflicts = useMemo(() => {
    const dersBolum = (cc: string) =>
      courses.find((c) => c.code === (cc || "").replace(/-\d+$/, ""))?.department_id;
    const benim = new Set(user?.department_ids ?? []);
    return [...scan.hard, ...scan.warnings]
      .filter((c) => c.affected.some((a) => a.type === "exam"))
      .filter((c) => user?.role === "ADMIN"
        || c.affected.some((a) => {
          const d = dersBolum(a.course_code ?? "");
          return d != null && benim.has(d);
        }));
  }, [scan, courses, user]);

  const showConflicts = (cs: ConflictResult[], baslik: string) => {
    if (!cs.length) { notifications.show({ color: "green", message: `${baslik} — çakışma yok` }); return; }
    notifications.show({
      color: cs.some((c) => c.severity === "HARD") ? "red" : "orange",
      title: baslik,
      message: `${cs.length} çakışma: ${cs.map((c) => c.rule_id).join(", ")}`,
    });
  };

  const sil = async (e: Exam) => {
    if (!window.confirm(`${e.course.code} ${EXAM_TYPE_LABELS[e.exam_type]} sınavı silinsin mi?`)) return;
    try {
      await api.delete(`/exams/${e.id}`);
      notifications.show({ message: "Sınav silindi", color: "gray" });
      load();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Silinemedi" });
    }
  };

  /** Taşıma: yalnız tarih ve saat değişir; derslik, süre, sorumlu korunur. */
  const tasi = async (e: Exam, tarih: string, dk: number) => {
    if (e.exam_date === tarih && toMin(e.start_time) === dk) return;
    try {
      const res = await api.patch<{ conflicts: ConflictResult[] }>(
        `/exams/${e.id}`, { exam_date: tarih, start_time: fmt(dk) });
      load();
      showConflicts(res.conflicts, "Sınav taşındı");
    } catch (err) {
      // SUBMITTED kilidi (409) ve hafta sonu (400) burada görünür.
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Taşınamadı" });
    }
  };

  const birak = (tarih: string, dk: number) => {
    setOver(null);
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "move") void tasi(d.exam, tarih, dk);
    else setPlacing({ date: tarih, min: dk, courseId: d.courseId });
  };

  /** Sınavı olan tarihler — hafta seçicideki kırmızı noktalar için. */
  const examDates = useMemo(() => new Set(exams.map((e) => e.exam_date)), [exams]);

  /** Ekleme modalındaki ders listesi: SEÇİLİ SINIFIN, yazma yetkim olan dersleri.
   *  Tüm derslere açık bırakılsaydı kullanıcı başka sınıfın dersine sınav koyup
   *  onu bu takvimde göremez, "kaydettim ama yok" durumuna düşerdi. */
  const secilebilirDersler = useMemo(
    () => cohortCourses.filter((c) => canWriteCourse(c.id)),
    [cohortCourses, user, courses]);

  const taslagaCevir = async (e: Exam) => {
    try {
      await api.post(`/exams/${e.id}/revert-to-draft`);
      notifications.show({ message: "Sınav taslağa çevrildi", color: "gray" });
      load();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Çevrilemedi" });
    }
  };

  const haftaEtiketi = () => {
    const son = addDays(weekStart, 4);
    const ayni = weekStart.getMonth() === son.getMonth();
    return ayni
      ? `${weekStart.getDate()}–${son.getDate()} ${AY[son.getMonth()]} ${son.getFullYear()}`
      : `${weekStart.getDate()} ${AY[weekStart.getMonth()]} – ${son.getDate()} ${AY[son.getMonth()]} ${son.getFullYear()}`;
  };

  const gitHafta = (n: number) => setWeek(addDays(weekStart, n * 7));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="xs" align="center">
          <Title order={2} fw={500}>Sınav Takvimi</Title>
          <Select size="xs" w={190} radius="md" value={dep} onChange={setDep}
            data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
          <Select size="xs" w={95} radius="md" value={year} onChange={(v) => v && setYear(v)}
            data={["1", "2", "3", "4"].map((y) => ({ value: y, label: `${y}. sınıf` }))} />
          <Select size="xs" w={100} radius="md" value={sem}
            onChange={(v) => v && setSem(v as SemesterType)}
            data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
              value: s, label: SEMESTER_LABELS[s] }))} />
        </Group>

        <Group gap="xs" align="center">
          <ActionIcon variant="subtle" radius="md" onClick={() => gitHafta(-1)} aria-label="Önceki hafta">
            <IconChevronLeft size={18} />
          </ActionIcon>
          <Popover opened={pickerOpen} onChange={setPickerOpen} position="bottom" withArrow shadow="md">
            <Popover.Target>
              <Button variant="subtle" size="xs" radius="md" onClick={() => setPickerOpen((o) => !o)}
                style={{ minWidth: 150 }}>
                {haftaEtiketi()}
              </Button>
            </Popover.Target>
            <Popover.Dropdown p={6}>
              <WeekPicker weekStart={weekStart} examDates={examDates}
                onPick={(pzt) => { setWeek(pzt); setPickerOpen(false); }} />
            </Popover.Dropdown>
          </Popover>
          <ActionIcon variant="subtle" radius="md" onClick={() => gitHafta(1)} aria-label="Sonraki hafta">
            <IconChevronRight size={18} />
          </ActionIcon>
          <Button size="xs" variant="subtle" radius="md"
            onClick={() => setWeek(new Date())}>
            Bu hafta
          </Button>
          {canWriteAny && (
            <Button size="xs" radius="md" disabled={drafts.length === 0}
              onClick={() => setSubmitOpen(true)}>
              Yayınla{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
          )}
        </Group>
      </Group>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {/* Sol panel: bu türde sınavı olmayan dersler — "yapılacaklar" listesi */}
        <Paper p="md" radius="lg" w={210}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: HEAD_H + HOUR_H * (HOURS.length - 1) + 32,
                   background: "var(--mantine-color-gray-0)" }}>
          <TextInput size="xs" mb={10} radius="md" variant="filled" value={search}
            onChange={(ev) => setSearch(ev.currentTarget.value)}
            placeholder="Ders ara" />
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
            <Stack gap={6}>
              {paletDersler.length === 0 && (
                <Text size="xs" c="dimmed">Bu sınıfta ders yok.</Text>
              )}
              {paletDersler.map(({ course: c, turler, done }) => {
                const yazabilir = canWriteCourse(c.id);
                return (
                  <Paper key={c.id} p={8} radius="md"
                    draggable={yazabilir}
                    onDragStart={(ev) => {
                      ev.dataTransfer.effectAllowed = "copy";
                      ev.dataTransfer.setData("text/plain", String(c.id));
                      setDrag({ kind: "new", courseId: c.id, label: c.code });
                    }}
                    onDragEnd={() => setDrag(null)}
                    // Sürüklemek istemeyen için tıklama da çalışsın: haftanın ilk
                    // günü 09:00 ile modal açılır, kullanıcı orada değiştirir.
                    onClick={() => yazabilir
                      && setPlacing({ date: iso(gunler[0]), min: 9 * 60, courseId: c.id })}
                    style={{ fontSize: 12, flexShrink: 0, background: "var(--mantine-color-body)",
                             border: "1px solid var(--mantine-color-gray-2)",
                             cursor: yazabilir ? "grab" : "default",
                             opacity: done ? 0.45 : 1 }}>
                    <Text size="xs" fw={500}>{c.code}</Text>
                    <Text size="10px" c="dimmed" truncate mt={2}>{c.name}</Text>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea>
        </Paper>

        {/* Takvim: gerçek tarihli 5 gün × dakika ölçekli dikey eksen */}
        <Paper p="md" radius="lg"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   border: "1px solid var(--mantine-color-gray-2)" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 560 }}>
              {/* saat cetveli */}
              <div style={{ width: 52, flexShrink: 0, position: "relative",
                            height: HEAD_H + HOUR_H * (HOURS.length - 1) }}>
                {HOURS.map((h, i) => (
                  <div key={h} style={{
                    position: "absolute", top: HEAD_H + i * HOUR_H - 6, right: 10,
                    fontSize: 11, color: "var(--mantine-color-gray-5)",
                    fontVariantNumeric: "tabular-nums",
                  }}>{fmt(h)}</div>
                ))}
              </div>

              {gunler.map((g, gi) => {
                const gun = iso(g);
                const bugun = iso(new Date()) === gun;
                return (
                  <div key={gun} style={{ flex: 1, minWidth: 108, borderLeft: `1px solid ${LINE}` }}>
                    <div style={{ height: HEAD_H, display: "flex", flexDirection: "column",
                                  alignItems: "center", justifyContent: "center" }}>
                      <Text size="10px" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.06em" }}>
                        {DAY_SHORT[gi + 1]}
                      </Text>
                      <Text size="sm" fw={bugun ? 700 : 500}
                        c={bugun ? "blue" : undefined}>
                        {g.getDate()} {AY[g.getMonth()]}
                      </Text>
                    </div>

                    <div
                      style={{ position: "relative", height: HOUR_H * (HOURS.length - 1),
                               borderBottom: `1px solid ${LINE}` }}
                      onMouseMove={(ev) => {
                        if (!canWriteAny) return;
                        const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                        // 30 dakikalık adımlara yuvarla — sınavlar genelde tam/buçukta
                        const dk = DAY_START + Math.floor(y / PX / 30) * 30;
                        const dolu = byDay.get(gun)!.some((e) => {
                          const s = toMin(e.start_time);
                          return dk >= s && dk < s + e.duration_minutes;
                        });
                        setHoverCell(dolu ? null : `${gun}-${dk}`);
                      }}
                      onMouseLeave={() => setHoverCell(null)}
                      onClick={(ev) => {
                        if (!canWriteAny) return;
                        const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                        const dk = DAY_START + Math.floor(y / PX / 30) * 30;
                        setPlacing({ date: gun, min: dk });
                      }}
                      onDragOver={(ev) => {
                        if (!drag) return;
                        ev.preventDefault();
                        const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                        setOver(`${gun}|${DAY_START + Math.floor(y / PX / 30) * 30}`);
                      }}
                      onDragLeave={(ev) => {
                        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setOver(null);
                      }}
                      onDrop={(ev) => {
                        ev.preventDefault();
                        const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                        birak(gun, DAY_START + Math.floor(y / PX / 30) * 30);
                      }}
                    >
                      {HOURS.slice(0, -1).map((h, i) => (
                        <div key={h} style={{
                          position: "absolute", top: i * HOUR_H, left: 0, right: 0, height: HOUR_H,
                          borderTop: `1px solid ${LINE}`, pointerEvents: "none",
                        }} />
                      ))}
                      {/* bırakma hedefi (sürükleme sırasında) */}
                      {over?.startsWith(`${gun}|`) && (
                        <div style={{
                          position: "absolute", left: 2, right: 2,
                          top: (Number(over.split("|")[1]) - DAY_START) * PX,
                          height: 90 * PX, borderRadius: 6,
                          background: "var(--mantine-color-blue-0)",
                          border: "1px dashed var(--mantine-color-blue-5)",
                          pointerEvents: "none",
                        }} />
                      )}
                      {/* boş yer işareti (sürükleme yokken) */}
                      {!drag && hoverCell?.startsWith(`${gun}-`) && (
                        <div style={{
                          position: "absolute", left: 2, right: 2,
                          top: (Number(hoverCell.split("-").pop()) - DAY_START) * PX,
                          height: 30 * PX, borderRadius: 6,
                          background: "var(--mantine-color-gray-1)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          pointerEvents: "none",
                        }}>
                          <IconPlus size={16} color="var(--mantine-color-gray-5)" />
                        </div>
                      )}
                      {byDay.get(gun)!.map((e) => (
                        <ExamCard key={e.id} e={e}
                          hard={hardIds.has(e.id)} warn={warnIds.has(e.id)}
                          editable={canWriteCourse(e.course.id) && e.status === "DRAFT"}
                          revertable={canWriteCourse(e.course.id) && e.status === "SUBMITTED"}
                          onDragStart={() => setDrag({ kind: "move", exam: e })}
                          onDragEnd={() => setDrag(null)}
                          onEdit={() => setEditing(e)}
                          onDelete={() => sil(e)}
                          onRevert={() => taslagaCevir(e)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Paper>
      </Group>

      <Group gap="lg" style={{ fontSize: 11, color: "var(--mantine-color-dimmed)" }}>
        <Legend label="Yayınlanmış" bg="var(--mantine-color-violet-2)" bd="var(--mantine-color-violet-7)" />
        <Legend label="Taslak (çapraz tarama)" bg="var(--mantine-color-violet-2)" bd="var(--mantine-color-violet-7)" hatch />
        <Legend label="Çakışma (engel)" bg="var(--mantine-color-red-2)" bd="var(--mantine-color-red-7)" />
        <Legend label="Uyarı" bg="var(--mantine-color-orange-2)" bd="var(--mantine-color-orange-7)" />
      </Group>

      <Paper p="md" radius="lg" style={{ border: "1px solid var(--mantine-color-gray-2)" }}>
        <Group justify="space-between" mb={examConflicts.length ? "sm" : 0}>
          <Text fw={500} size="sm">Sınav çakışmaları</Text>
          <Group gap={6}>
            <Badge size="sm" color="red" variant="light">
              {examConflicts.filter((c) => c.severity === "HARD").length} engel
            </Badge>
            <Badge size="sm" color="orange" variant="light">
              {examConflicts.filter((c) => c.severity === "WARNING").length} uyarı
            </Badge>
          </Group>
        </Group>
        {examConflicts.length === 0 ? (
          <Text size="sm" c="dimmed">Sınav takviminde çakışma yok.</Text>
        ) : (
          <ScrollArea.Autosize mah={260}>
            <Stack gap={8}>
              {examConflicts.map((c, i) => (
                <Group key={`${c.rule_id}-${i}`} gap="sm" wrap="nowrap" align="flex-start">
                  <Badge size="sm" variant="light" style={{ flexShrink: 0 }}
                    color={c.severity === "HARD" ? "red" : "orange"}>
                    {c.severity === "HARD" ? "ENGEL" : "UYARI"}
                  </Badge>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 30 }}>{c.rule_id}</Text>
                  <Text size="sm">{c.message}</Text>
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Paper>

      {(placing || editing) && (
        <ExamModal
          exam={editing}
          initialDate={placing?.date}
          initialMin={placing?.min}
          initialCourseId={placing?.courseId}
          courses={secilebilirDersler}
          classrooms={classrooms}
          lecturers={lecturers}
          onClose={() => { setPlacing(null); setEditing(null); }}
          onDone={(conflicts, baslik) => {
            setPlacing(null); setEditing(null); load(); showConflicts(conflicts, baslik);
          }} />
      )}

      {submitOpen && (
        <SubmitModal drafts={drafts} onClose={() => setSubmitOpen(false)}
          onDone={(warnings) => {
            setSubmitOpen(false); load();
            notifications.show({
              color: warnings.length ? "orange" : "green",
              title: "Sınavlar yayınlandı",
              message: warnings.length
                ? `${warnings.length} uyarı görünür kalıyor: ${warnings.map((w) => w.rule_id).join(", ")}`
                : "Çakışma yok",
            });
          }} />
      )}
    </Stack>
  );
}

const AY_UZUN = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** Hafta seçici: ay ay gezinilir, HAFTA satırına tıklanır.
 *
 *  Gün değil HAFTA seçtiriyoruz çünkü takvim zaten hafta gösteriyor — gün
 *  seçtirmek kullanıcıyı "hangi gün?" diye gereksiz bir karara zorlardı.
 *  Sınavı olan haftalar kırmızı noktayla işaretli: kullanıcı boş haftalarda
 *  dolaşmak yerine doğrudan dolu haftaya gidebilsin. */
function WeekPicker({ weekStart, examDates, onPick }: {
  weekStart: Date;
  examDates: Set<string>;
  onPick: (monday: Date) => void;
}) {
  const [ay, setAy] = useState(() => new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));

  // Ayı kapsayan tam haftalar (ilk günün pazartesisinden başlar)
  const haftalar = useMemo(() => {
    const ilk = mondayOf(new Date(ay.getFullYear(), ay.getMonth(), 1));
    const out: Date[] = [];
    for (let i = 0; i < 6; i++) {
      const p = addDays(ilk, i * 7);
      if (i > 0 && p.getMonth() !== ay.getMonth() && p > ay) break;
      out.push(p);
    }
    return out;
  }, [ay]);

  const haftadaSinavVar = (pzt: Date) =>
    [0, 1, 2, 3, 4].some((i) => examDates.has(iso(addDays(pzt, i))));

  return (
    <Stack gap={6} p={4} style={{ minWidth: 250 }}>
      <Group justify="space-between">
        <ActionIcon variant="subtle" size="sm" aria-label="Önceki ay"
          onClick={() => setAy(new Date(ay.getFullYear(), ay.getMonth() - 1, 1))}>
          <IconChevronLeft size={16} />
        </ActionIcon>
        <Text size="sm" fw={500}>{AY_UZUN[ay.getMonth()]} {ay.getFullYear()}</Text>
        <ActionIcon variant="subtle" size="sm" aria-label="Sonraki ay"
          onClick={() => setAy(new Date(ay.getFullYear(), ay.getMonth() + 1, 1))}>
          <IconChevronRight size={16} />
        </ActionIcon>
      </Group>
      <Stack gap={2}>
        {haftalar.map((pzt) => {
          const secili = iso(pzt) === iso(weekStart);
          const dolu = haftadaSinavVar(pzt);
          const son = addDays(pzt, 4);
          return (
            <Group key={iso(pzt)} justify="space-between" wrap="nowrap"
              onClick={() => onPick(pzt)}
              style={{
                cursor: "pointer", borderRadius: 6, padding: "5px 8px",
                background: secili ? "var(--mantine-color-blue-1)" : undefined,
              }}>
              <Text size="xs" fw={secili ? 600 : 400}>
                {pzt.getDate()} {AY[pzt.getMonth()]} – {son.getDate()} {AY[son.getMonth()]}
              </Text>
              {dolu && (
                <span title="Bu haftada sınav var" style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--mantine-color-red-6)", flexShrink: 0,
                }} />
              )}
            </Group>
          );
        })}
      </Stack>
    </Stack>
  );
}

function Legend({ label, bg, bd, hatch }: { label: string; bg: string; bd: string; hatch?: boolean }) {
  return (
    <Group gap={4}>
      <span style={{
        display: "inline-block", width: 20, height: 11, borderRadius: 3,
        background: bg, border: `1px ${hatch ? "dashed" : "solid"} ${bd}`,
        backgroundImage: hatch
          ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 4px, transparent 4px 10px)"
          : undefined,
      }} />
      <span>{label}</span>
    </Group>
  );
}

function ExamCard({ e, hard, warn, editable, revertable, onDragStart, onDragEnd, onEdit, onDelete, onRevert }: {
  e: Placed; hard: boolean; warn: boolean; editable: boolean; revertable: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onEdit: () => void; onDelete: () => void; onRevert: () => void;
}) {
  const draft = e.status === "DRAFT";
  // Sınavın kendi rengi MOR: haftalık dersten (mavi) ilk bakışta ayrılsın.
  const p = hard
    ? { bg: "var(--mantine-color-red-2)", bd: "var(--mantine-color-red-7)", fg: "var(--mantine-color-red-9)" }
    : warn
    ? { bg: "var(--mantine-color-orange-2)", bd: "var(--mantine-color-orange-7)", fg: "var(--mantine-color-orange-9)" }
    : { bg: "var(--mantine-color-violet-2)", bd: "var(--mantine-color-violet-7)", fg: "var(--mantine-color-violet-9)" };

  const bas = toMin(e.start_time);
  const w = 100 / e.lanes;
  const odalar = e.classrooms.map((c) => c.room_code).join(", ");

  return (
    <div
      draggable={editable}
      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={(ev) => { ev.stopPropagation(); if (editable) onEdit(); }}
      title={editable
        ? `${e.course.code} · ${fmt(bas)}-${fmt(bas + e.duration_minutes)} · düzenlemek için tıkla, taşımak için sürükle`
        : `${e.course.code} · ${fmt(bas)}-${fmt(bas + e.duration_minutes)} · ${e.total_expected_students} öğrenci`}
      style={{
        position: "absolute",
        top: (bas - DAY_START) * PX + 1,
        height: e.duration_minutes * PX - 2,
        left: `calc(${e.lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
        background: p.bg, color: p.fg,
        border: `1px ${draft ? "dashed" : "solid"} ${p.bd}`,
        backgroundImage: draft
          ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 10px, transparent 10px 26px)"
          : undefined,
        borderRadius: 6, padding: "2px 4px", fontSize: 11, lineHeight: 1.25,
        overflow: "hidden", cursor: editable ? "pointer" : "default",
      }}>
      <Group gap={2} justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ fontWeight: 500 }}>{e.course.code}</div>
        {/* Takvimde üç tür bir arada durduğu için tür kartın üstünde yazılı */}
        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0, paddingInline: 5 }}>
          {EXAM_TYPE_LABELS[e.exam_type]}
        </Badge>
        {editable && (
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Sil"
            onClick={(ev) => { ev.stopPropagation(); onDelete(); }}>
            <IconTrash size={12} />
          </ActionIcon>
        )}
        {revertable && (
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Taslağa çevir"
            onClick={(ev) => { ev.stopPropagation(); onRevert(); }}>
            <IconArrowBackUp size={12} />
          </ActionIcon>
        )}
      </Group>
      <div style={{ fontSize: 10, opacity: 0.85 }}>
        {fmt(bas)} · {odalar || "derslik yok"}
      </div>
    </div>
  );
}

function ExamModal({ exam, initialDate, initialMin, initialCourseId, courses, classrooms, lecturers, onClose, onDone }: {
  exam: Exam | null;
  initialDate?: string;
  initialMin?: number;
  /** Paletten sürüklenip/tıklanıp gelindiyse ders zaten belli. */
  initialCourseId?: number;
  courses: Course[];
  classrooms: Classroom[];
  lecturers: Lecturer[];
  onClose: () => void;
  onDone: (conflicts: ConflictResult[], baslik: string) => void;
}) {
  const duzenle = exam != null;
  const [courseId, setCourseId] = useState<string | null>(
    exam ? String(exam.course.id) : initialCourseId != null ? String(initialCourseId) : null);
  const [tip, setTip] = useState<ExamType>(exam?.exam_type ?? "FINAL");
  const [tarih, setTarih] = useState(exam?.exam_date ?? initialDate ?? "");
  const [saat, setSaat] = useState(exam?.start_time?.slice(0, 5) ?? fmt(initialMin ?? 9 * 60));
  const [sure, setSure] = useState(exam?.duration_minutes ?? 90);
  const [odalar, setOdalar] = useState<string[]>(exam?.classrooms.map((c) => String(c.id)) ?? []);
  const [hoca, setHoca] = useState<string | null>(exam ? String(exam.lecturer.id) : null);
  const [not, setNot] = useState(exam?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const haftaSonu = isWeekend(tarih);
  const eksik = !courseId || !tarih || !saat || !hoca || haftaSonu;

  const kaydet = async () => {
    setBusy(true);
    try {
      const govde = {
        exam_type: tip, exam_date: tarih, start_time: saat,
        duration_minutes: sure, classroom_ids: odalar.map(Number),
        lecturer_id: Number(hoca), notes: not || null,
      };
      const res = duzenle
        ? await api.patch<{ conflicts: ConflictResult[] }>(`/exams/${exam!.id}`, govde)
        : await api.post<{ conflicts: ConflictResult[] }>("/exams",
            { course_id: Number(courseId), ...govde });
      onDone(res.conflicts, duzenle ? "Sınav güncellendi" : "Sınav kaydedildi (taslak)");
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="sm"
      title={duzenle ? `${exam!.course.code} · ${EXAM_TYPE_LABELS[exam!.exam_type]}` : "Sınav ekle"}>
      <Stack gap="sm">
        {!duzenle && (
          <Select label="Ders" value={courseId} onChange={setCourseId} searchable
            placeholder="Ders seç" nothingFoundMessage="Ders yok"
            data={courses.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))} />
        )}
        <Select label="Sınav türü" value={tip} onChange={(v) => v && setTip(v as ExamType)}
          data={(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((k) => ({
            value: k, label: EXAM_TYPE_LABELS[k] }))} />
        <TextInput label="Tarih" type="date" value={tarih}
          error={haftaSonu ? "Hafta sonu (Cumartesi/Pazar) sınav günü olarak seçilemez (K-06)" : undefined}
          onChange={(ev) => setTarih(ev.currentTarget.value)} />
        <Group grow>
          <TextInput label="Başlangıç" type="time" value={saat}
            onChange={(ev) => setSaat(ev.currentTarget.value)} />
          <NumberInput label="Süre (dk)" value={sure} min={10} max={480} step={15}
            onChange={(v) => setSure(Number(v) || 90)} />
        </Group>
        <MultiSelect label="Derslikler" value={odalar} onChange={setOdalar} searchable
          placeholder={odalar.length ? undefined : "Derslik seç (birden çok olabilir)"}
          data={classrooms.map((c) => ({
            value: String(c.id),
            label: `${c.building.name} ${c.room_code}${c.exam_capacity != null ? ` · ${c.exam_capacity} kişi` : " · kontenjan yok"}` }))} />
        <Select label="Sorumlu" value={hoca} onChange={setHoca} searchable
          placeholder="Öğretim üyesi seç"
          data={lecturers.map((l) => ({ value: String(l.id), label: l.full_name }))} />
        <TextInput label="Not" value={not} onChange={(ev) => setNot(ev.currentTarget.value)}
          placeholder="isteğe bağlı" />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={kaydet} loading={busy} disabled={eksik}>Kaydet</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Yayınlama kapısı — haftalık programdakiyle aynı sözleşme (K-03). */
function SubmitModal({ drafts, onClose, onDone }: {
  drafts: Exam[]; onClose: () => void; onDone: (warnings: ConflictResult[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);

  const gonder = async () => {
    setBusy(true); setBlockers(null);
    try {
      const res = await api.post<{ submitted: number[]; warnings: ConflictResult[] }>(
        "/exams/submit", { exam_ids: drafts.map((d) => d.id) });
      onDone(res.warnings);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { conflicts?: ConflictResult[] } | null;
        setBlockers(body?.conflicts ?? []);
      } else {
        notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Yayınlanamadı" });
      }
    } finally { setBusy(false); }
  };

  return (
    <Modal opened onClose={onClose} title="Sınavları yayınla" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          {drafts.length} taslak sınav yayınlanacak. Yayınlananlar kilitlenir;
          düzenlemek için tekrar taslağa çevirmen gerekir.
        </Text>
        {blockers && (
          <Alert color="red" variant="light" title="Yayınlama reddedildi">
            <Text size="sm" mb={6}>
              Engelleyici çakışmalar var — hiçbir sınav yayınlanmadı. Düzeltip tekrar dene.
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
              {d.course.code} · {d.exam_date} {d.start_time.slice(0, 5)}
              {d.classrooms.length ? ` · ${d.classrooms.map((c) => c.room_code).join(", ")}` : " · derslik yok"}
            </Text>
          ))}
        </Stack>
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={gonder} loading={busy}>{blockers ? "Tekrar dene" : "Yayınla"}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
