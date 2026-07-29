import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Menu, Modal, MultiSelect,
  NumberInput, Paper, Popover, ScrollArea, Select, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle, IconAlertTriangle, IconArrowBackUp, IconCheck, IconChevronLeft,
  IconChevronRight, IconDownload, IconMapPin, IconPlus, IconTrash, IconUser,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { EXAM_TYPE_LABELS, SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import {
  ACCENT, BORDER, BORDER_HOVER, CARD_PADDING, CARD_RADIUS, CONTROL_H, DAY_LINE,
  EXAM_HOUR_H, GRID_CELL_BG, HEAD_H, HEADER_BG, HOVER_CELL_BG, LINE, MIN_DAY_W, MIN_LANE_W,
  SHADOW, SHADOW_HOVER,
  SHADOW_SELECTED, SIDEBAR_BG, SIDE_W, TEXT_MUTED, TIME_COL_W, TIME_COLOR,
  paletteItemStyle,
} from "../utils/scheduleTheme";
import type {
  Classroom, ConflictResult, ConflictScan, Course, Department, Exam, ExamType,
  Lecturer, SemesterType,
} from "../api/types";

/* Haftalık programdan TEMEL FARK: burada slot yok, gerçek takvim var.
   Sınav herhangi bir saatte olabilir (K-06: 17:30 sonrası serbest), süresi
   dakikadır. Bu yüzden dikey eksen slot değil DAKİKA ölçeğinde. */
/* Görsel belirteçler iki takvim ekranı için ORTAK — utils/scheduleTheme.ts.
   Burada yalnız bu ekrana özel olan dakika ölçeği tanımlanır. */
const DAY_START = 8 * 60;        // 08:00
const DAY_END = 21 * 60;         // 21:00 — akşam sınavları da sığsın
const HOUR_H = EXAM_HOUR_H;      // bir saatin piksel yüksekliği
const PX = HOUR_H / 60;          // dakika başına piksel
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 },
  (_, i) => DAY_START + i * 60);

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
  // Bir gün içindeki şerit yapısı sabit kalır: günün ilerleyen saatindeki tek
  // sınav, önceki paralel sınavlardan sonra tüm sütunu kaplamaz.
  const dayLanes = Math.max(1, ...out.map((e) => e.lanes));
  return out.map((e) => ({ ...e, lanes: dayLanes }));
}

/** Aynı anda başlayan sınavlarda kartlar okunabilir genişliğini korur. */
function dayWidth(exams: Placed[]): number {
  return Math.max(MIN_DAY_W, ...exams.map((e) => e.lanes * MIN_LANE_W));
}

export default function ExamsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("highlight") ? Number(searchParams.get("highlight")) : null;
  const ruleParam = searchParams.get("rule");

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
  // Sol listede bir dersin üstüne gelince, o dersin takvimdeki sınavları
  // vurgulanır — dersin haftaya NEREYE düştüğü listeden ayrılmadan görülür
  // (haftalık programdaki desenin aynısı).
  const [hoverCourse, setHoverCourse] = useState<number | null>(null);
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

  // Highlight yönlendirmesi geldiğinde hedef sınavın tarih ve cohort filtrelerini otomatik ayarla
  useEffect(() => {
    if (!highlightId) return;
    api.get<Exam[]>("/exams")
      .then((allExams) => {
        const target = allExams.find((x) => x.id === highlightId);
        if (target) {
          const fullCourse = courses.find((c) => c.id === target.course.id);
          if (fullCourse) {
            setDep(String(fullCourse.department_id));
            setYear(String(fullCourse.year));
            setSem(fullCourse.semester);
          }
          setWeek(new Date(`${target.exam_date}T00:00:00`));
          if (ruleParam) {
            notifications.show({
              id: `exam-highlight-${highlightId}`,
              color: "blue",
              title: `Çakışma Vurgulandı (${ruleParam})`,
              message: `${target.course.code} ${EXAM_TYPE_LABELS[target.exam_type]} sınavı takvim üzerinde gösteriliyor.`,
            });
          }
        } else {
          notifications.show({ color: "yellow", message: "Vurgulanacak sınav bulunamadı." });
        }
        setSearchParams({}, { replace: true });
      })
      .catch(() => {});
  }, [highlightId, ruleParam, courses, setSearchParams]);

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

  /** Resmi sınav programı indir: seçili bölüm + dönemin TÜM yıllarını,
   *  üniversite formatında (yıla göre gruplu). schedule=midterm → Vize;
   *  final → Final + Bütünleme (ders bazında eşlenir). */
  const [exportBusy, setExportBusy] = useState(false);
  const downloadSchedule = async (schedule: "midterm" | "final") => {
    if (!dep) {
      notifications.show({ color: "red", message: "Önce bir bölüm seçin" });
      return;
    }
    setExportBusy(true);
    try {
      const params = new URLSearchParams({
        department_id: dep, semester: sem, schedule, format: "xlsx",
      });
      await api.download(`/export/exams?${params.toString()}`);
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İndirme başarısız",
      });
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <Stack gap="lg">
      {/* Tek yatay araç çubuğu: solda başlık, ortada mercek (bölüm/sınıf/dönem),
          sağda hafta gezinme + yayınlama. Üç bölüm tek bir kabuk içinde durur —
          iki ayrı çerçeve, aralarındaki boşluğu gereksiz bir sınır gibi
          gösteriyordu. */}
      <Paper radius="md" px="md" py={10}
        style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Title order={2} fw={600} fz={18} style={{ letterSpacing: "-0.01em" }}>
            Sınav Takvimi
          </Title>

          <Group gap={8} align="center" wrap="wrap">
            <Select size="xs" w={200} radius="md" value={dep} onChange={setDep}
              styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
            <Select size="xs" w={104} radius="md" value={year} onChange={(v) => v && setYear(v)}
              styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
              data={["1", "2", "3", "4"].map((y) => ({ value: y, label: `${y}. sınıf` }))} />
            <Select size="xs" w={104} radius="md" value={sem}
              onChange={(v) => v && setSem(v as SemesterType)}
              styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
              data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
                value: s, label: SEMESTER_LABELS[s] }))} />
          </Group>

          <Group gap={6} align="center" wrap="nowrap">
            <ActionIcon variant="default" radius="md" color="gray"
              style={{ width: CONTROL_H, height: CONTROL_H, borderColor: BORDER }}
              onClick={() => gitHafta(-1)} aria-label="Önceki hafta">
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Popover opened={pickerOpen} onChange={setPickerOpen} position="bottom" withArrow shadow="md">
              <Popover.Target>
                <Button variant="default" size="xs" radius="md" onClick={() => setPickerOpen((o) => !o)}
                  style={{ minWidth: 168, height: CONTROL_H, borderColor: BORDER, fontWeight: 500 }}>
                  {haftaEtiketi()}
                </Button>
              </Popover.Target>
              <Popover.Dropdown p={6}>
                <WeekPicker weekStart={weekStart} examDates={examDates}
                  onPick={(pzt) => { setWeek(pzt); setPickerOpen(false); }} />
              </Popover.Dropdown>
            </Popover>
            <ActionIcon variant="default" radius="md" color="gray"
              style={{ width: CONTROL_H, height: CONTROL_H, borderColor: BORDER }}
              onClick={() => gitHafta(1)} aria-label="Sonraki hafta">
              <IconChevronRight size={16} />
            </ActionIcon>
            <Button variant="default" size="xs" radius="md"
              style={{ height: CONTROL_H, borderColor: BORDER, fontWeight: 500 }}
              onClick={() => setWeek(new Date())}>
              Bu Hafta
            </Button>
            {/* Sınav programı resmi formatta indirilir (K-09): Vize ve
                Final+Bütünleme ayrı sayfa düzeni. Bu yüzden generic ExportMenu
                değil, iki anlamlı seçenekli menü. Tetikleyici araç çubuğunun
                geri kalanıyla aynı stilde (variant default, CONTROL_H). */}
            <Menu shadow="md" position="bottom-end" withinPortal>
              <Menu.Target>
                <Button size="xs" radius="md" variant="default" loading={exportBusy}
                  style={{ height: CONTROL_H, borderColor: BORDER, fontWeight: 500 }}
                  leftSection={<IconDownload size={16} />}>
                  Dışa Aktar
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => downloadSchedule("midterm")}>Vize Programı (Excel)</Menu.Item>
                <Menu.Item onClick={() => downloadSchedule("final")}>Final + Bütünleme (Excel)</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {canWriteAny && (
              <Button size="xs" radius="md" disabled={drafts.length === 0}
                style={{ height: CONTROL_H }}
                onClick={() => setSubmitOpen(true)}>
                Yayınla{drafts.length ? ` (${drafts.length})` : ""}
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {/* Sol panel: bu türde sınavı olmayan dersler — "yapılacaklar" listesi */}
        {/* Sol panel zemini hafif gri: takvim beyaz, panel de beyaz olunca ikisi
            tek bir yüzeye yapışıyor ve gözün dinlendiği bir sınır kalmıyordu. */}
        <Paper p="sm" radius="md" w={SIDE_W}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: HEAD_H + HOUR_H * (HOURS.length - 1) + 32,
                   background: SIDEBAR_BG, border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
          <TextInput size="xs" mb={10} radius="md" value={search}
            onChange={(ev) => setSearch(ev.currentTarget.value)}
            styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H,
                               borderColor: BORDER, background: "#FFFFFF" } }}
            placeholder="Ders ara" />
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
            <Stack gap={6}>
              {paletDersler.length === 0 && (
                <Text size="xs" c="dimmed" px={4}>Bu sınıfta ders yok.</Text>
              )}
              {paletDersler.map(({ course: c, done }) => (
                <PaletteItem key={c.id} course={c} done={done}
                  draggable={canWriteCourse(c.id)}
                  onHover={setHoverCourse}
                  onDragStart={() => setDrag({ kind: "new", courseId: c.id, label: c.code })}
                  onDragEnd={() => setDrag(null)}
                  // Sürüklemek istemeyen için tıklama da çalışsın: haftanın ilk
                  // günü 09:00 ile modal açılır, kullanıcı orada değiştirir.
                  onPick={() => setPlacing({ date: iso(gunler[0]), min: 9 * 60, courseId: c.id })} />
              ))}
            </Stack>
          </ScrollArea>
        </Paper>

        {/* Takvim: gerçek tarihli 5 gün × dakika ölçekli dikey eksen */}
        <Paper p="md" radius="md"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   background: "#FFFFFF", border: "1px solid #E2E8F0",
                   boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 560 }}>
              {/* saat cetveli */}
              <div style={{ width: TIME_COL_W, flexShrink: 0, position: "relative",
                            height: HEAD_H + HOUR_H * (HOURS.length - 1) }}>
                {HOURS.map((h, i) => (
                  <div key={h} style={{
                    position: "absolute", top: HEAD_H + i * HOUR_H - 6, right: 10,
                    fontSize: 10, color: TIME_COLOR,
                    fontVariantNumeric: "tabular-nums",
                  }}>{fmt(h)}</div>
                ))}
              </div>

              {gunler.map((g, gi) => {
                const gun = iso(g);
                const bugun = iso(new Date()) === gun;
                const dayExams = byDay.get(gun)!;
                const minDayWidth = dayWidth(dayExams);
                return (
                  <div key={gun} style={{
                    // Minimum kart genişliği korunur, artan alan günlere eşit dağılır.
                    flex: `1 0 ${minDayWidth}px`, minWidth: minDayWidth,
                    // Gün ayracı yatay saat çizgilerinden KOYU: sütun sınırı
                    // takvimin en temel okuma sınırı, aynı tonda olunca günler
                    // birbirine akıyordu.
                    borderLeft: `1px solid ${DAY_LINE}`,
                    borderRight: gi === gunler.length - 1 ? `1px solid ${DAY_LINE}` : undefined,
                  }}>
                    {/* Gün başlığı iki satır: üstte gün adı (susturulmuş, seyrek
                        harf aralığı), altta tarih. Tek satırda birleşince
                        okunması gereken iki ayrı bilgi tek bir bulanık şeride
                        dönüşüyordu. */}
                    <div style={{ height: HEAD_H, display: "flex", flexDirection: "column",
                                  alignItems: "center", justifyContent: "center", gap: 1,
                                  background: HEADER_BG, borderTop: `1px solid ${LINE}` }}>
                      <Text fz={10} tt="uppercase" fw={500}
                        style={{ letterSpacing: "0.07em", color: TIME_COLOR, lineHeight: 1.1 }}>
                        {DAY_SHORT[gi + 1]}
                      </Text>
                      <Text fz={13} fw={bugun ? 700 : 500} style={{ lineHeight: 1.15 }}
                        c={bugun ? "blue" : undefined}>
                        {g.getDate()} {AY[g.getMonth()]}
                      </Text>
                    </div>

                    <div
                      style={{ position: "relative", height: HOUR_H * (HOURS.length - 1),
                               borderBottom: `1px solid ${LINE}` }}
                      onMouseMove={(ev) => {
                        if (!canWriteAny) return;
                        /* İmleç bir KARTIN üzerindeyse işaret gösterme. Saat
                           aralığına bakmak YETMEZ: yan yana şeritlerde bir kart
                           sütunun yalnız bir bölümünü kaplar, kalan boşluğa
                           başka sınav konabilir (bkz. haftalık programdaki
                           aynı düzeltme). */
                        if (ev.target !== ev.currentTarget) { setHoverCell(null); return; }
                        const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                        // 30 dakikalık adımlara yuvarla — sınavlar genelde tam/buçukta
                        const dk = DAY_START + Math.floor(y / PX / 30) * 30;
                        setHoverCell(`${gun}-${dk}`);
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
                          background: GRID_CELL_BG,
                        }} />
                      ))}
                      {/* bırakma hedefi (sürükleme sırasında) */}
                      {over?.startsWith(`${gun}|`) && (
                        <div style={{
                          position: "absolute", left: 2, right: 2,
                          top: (Number(over.split("|")[1]) - DAY_START) * PX,
                          height: 90 * PX, borderRadius: 6,
                          background: "#EFF6FF",
                          border: "1px dashed #93C5FD",
                          pointerEvents: "none",
                        }} />
                      )}
                      {/* boş yer işareti (sürükleme yokken) */}
                      {!drag && hoverCell?.startsWith(`${gun}-`) && (
                        <div style={{
                          position: "absolute", left: 2, right: 2,
                          top: (Number(hoverCell.split("-").pop()) - DAY_START) * PX,
                          height: 30 * PX, borderRadius: 6,
                          background: HOVER_CELL_BG,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          pointerEvents: "none",
                        }}>
                          <IconPlus size={16} color={TIME_COLOR} />
                        </div>
                      )}
                      {dayExams.map((e) => (
                        <ExamCard key={e.id} e={e}
                          hard={hardIds.has(e.id)} warn={warnIds.has(e.id)}
                          highlight={e.id === highlightId}
                          listHover={hoverCourse === e.course.id}
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

      <Group gap="lg" style={{ fontSize: 11, color: TEXT_MUTED }}>
        <Legend label="Yayınlanmış" color={ACCENT.normal} />
        <Legend label="Taslak" color={ACCENT.draft} />
        <Legend label="Uyarı" color={ACCENT.warn} />
        <Legend label="Çakışma" color={ACCENT.hard} />
      </Group>

      <Paper p="md" radius="md"
        style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
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

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color }} />
      <span>{label}</span>
    </Group>
  );
}

/** Sol paneldeki tek ders satırı.
 *
 *  Hover durumu bileşen içinde tutulur: listedeki her satır kendi durumunu
 *  bilir, üst bileşenin "hangi satırın üstündeyim" diye state taşımasına
 *  gerek kalmaz (liste uzadıkça o yaklaşım gereksiz render üretirdi). */
function PaletteItem({ course: c, done, draggable, onHover, onDragStart, onDragEnd, onPick }: {
  course: Course; done: boolean; draggable: boolean;
  onHover: (courseId: number | null) => void;
  onDragStart: () => void; onDragEnd: () => void; onPick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      draggable={draggable}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "copy";
        ev.dataTransfer.setData("text/plain", String(c.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => draggable && onPick()}
      onMouseEnter={() => { setHover(true); onHover(c.id); }}
      onMouseLeave={() => { setHover(false); onHover(null); }}
      style={{
        ...paletteItemStyle(hover),
        cursor: draggable ? "grab" : "default",
      }}>
      <Group gap={6} wrap="nowrap" align="center">
        <Text fz={12} fw={600} style={{ color: done ? TEXT_MUTED : "#0F172A" }}>
          {c.code}
        </Text>
        {c.is_elective && (
          <Badge size="xs" variant="default" radius="sm"
            style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                     color: TEXT_MUTED, borderColor: BORDER }}>
            Seçmeli
          </Badge>
        )}
        {/* Üç sınav türü de tanımlıysa satır "bitmiş" sayılır. */}
        {done && (
          <IconCheck size={13} stroke={2.4} color="#16A34A"
            style={{ marginLeft: "auto", flexShrink: 0 }} />
        )}
      </Group>
      <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{c.name}</Text>
    </div>
  );
}

function ExamCard({ e, hard, warn, highlight, listHover, editable, revertable, onDragStart, onDragEnd, onEdit, onDelete, onRevert }: {
  e: Placed; hard: boolean; warn: boolean; highlight?: boolean; listHover?: boolean;
  editable: boolean; revertable: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onEdit: () => void; onDelete: () => void; onRevert: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  const [hover, setHover] = useState(false);

  const draft = e.status === "DRAFT";
  // Durum rengi YALNIZ ince sol çizgide ve küçük durum ikonunda yaşar.
  // Kartın zemini her durumda beyaz kalır: renkli dolgu, yan yana duran üç
  // sınavı okunmaz bir vitrine çeviriyordu.
  const accent = hard ? ACCENT.hard : warn ? ACCENT.warn : draft ? ACCENT.draft : ACCENT.normal;

  const bas = toMin(e.start_time);
  const bit = bas + e.duration_minutes;
  const w = 100 / e.lanes;
  const odalar = e.classrooms.map((c) => c.room_code).join(", ");

  /* Kart yüksekliği süreyle orantılı (60 dk ≈ 56 px), yani her satır her karta
     sığmaz. Bilgi hiyerarşisi bu yüzden kademeli: kod ve saat her zaman görünür,
     ad/derslik/hoca yer buldukça eklenir. Sığmayanı kırpmak yerine hiç
     çizmemek, yarım kalmış metin şeritlerinden daha okunaklı. */
  /* Saat aralığı kartta YAZILMAZ: kartın dikey konumu ve yüksekliği zaten
     saati birebir gösteriyor (cetvel solda duruyor). Metni tekrarlamak dar
     kartlarda ders adını veya dersliği dışarı itiyordu. Tam aralık tooltip'te. */
  const h = e.duration_minutes * PX;
  const showName = h >= 62;
  const showRoom = h >= 88;
  const showLecturer = h >= 116;
  const showDraftBadge = draft && h >= 144;

  const actionsVisible = (editable || revertable) && hover;

  return (
    <div
      ref={cardRef}
      draggable={editable || revertable}
      onDragStart={(ev) => {
        // Yayınlanmış sınav taşınamaz. Sürüklemeyi sessizce yutmak yerine
        // sebebini söylüyoruz — haftalık programdaki davranışın aynısı.
        if (!editable) {
          ev.preventDefault();
          if (revertable) {
            notifications.show({
              color: "orange",
              title: "Kilitli Sınav",
              message: "Yayınlanmış sınavlar taşınamaz. Önce taslağa çevirin.",
            });
          }
          return;
        }
        ev.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(ev) => {
        ev.stopPropagation();
        if (editable) onEdit();
        else if (revertable) {
          notifications.show({
            color: "orange",
            title: "Kilitli Sınav",
            message: "Yayınlanmış sınavlar kilitlidir. Düzenlemek için önce taslağa çevirin.",
          });
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={editable
        ? `${e.course.code} · ${fmt(bas)}-${fmt(bit)} · düzenlemek için tıkla, taşımak için sürükle`
        : revertable
        ? `${e.course.code} · ${fmt(bas)}-${fmt(bit)} · Yayınlanmış (kilitli) — düzenlemek için önce taslağa çevirin`
        : `${e.course.code} · ${fmt(bas)}-${fmt(bit)} · ${e.total_expected_students} öğrenci`}
      style={{
        position: "absolute",
        top: (bas - DAY_START) * PX + 1,
        height: h - 2,
        left: `calc(${e.lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
        background: "#FFFFFF", color: "#0F172A",
        /* DİKKAT — `border` kısayolu ile `borderLeft` uzun formu aynı stil
           nesnesinde BİRLİKTE KULLANILAMAZ. React yeniden render'da yalnız
           değeri değişen özelliği yazar; hover'da `border` güncellenince dört
           kenar birden sıfırlanır ama `borderLeft` (değeri aynı kaldığı için)
           tekrar uygulanmaz ve durum vurgusu sessizce kaybolur. Bu yüzden
           dört kenar da uzun formda. */
        borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
        borderTopStyle: draft ? "dashed" : "solid",
        borderRightStyle: draft ? "dashed" : "solid",
        borderBottomStyle: draft ? "dashed" : "solid",
        borderLeftStyle: "solid",
        borderTopColor: hover ? BORDER_HOVER : BORDER,
        borderRightColor: hover ? BORDER_HOVER : BORDER,
        borderBottomColor: hover ? BORDER_HOVER : BORDER,
        borderLeftColor: accent,
        borderRadius: CARD_RADIUS, padding: CARD_PADDING, lineHeight: 1.25,
        overflow: "hidden",
        cursor: editable ? "pointer" : revertable ? "not-allowed" : "default",
        transition: "box-shadow 130ms ease, border-color 130ms ease",
        // Çakışmada çok hafif kırmızı hâle — dolgu değil, yalnız derinlik.
        boxShadow: highlight || listHover ? SHADOW_SELECTED
          : hover ? SHADOW_HOVER
          : hard ? `${SHADOW}, 0 0 0 1px rgba(239, 68, 68, 0.10)`
          : SHADOW,
        ...(highlight || listHover
          ? { outline: `2px solid ${ACCENT.normal}`, outlineOffset: -1, zIndex: 5 }
          : null),
      }}>
      {/* Üst satır: ders kodu · tür rozeti · (hover'da) işlem menüsü */}
      <Group gap={4} justify="space-between" wrap="nowrap" align="flex-start">
        <Text fz={15} fw={700} truncate style={{ letterSpacing: "-0.01em", minWidth: 0 }}>
          {e.course.code}
        </Text>
        {/* Menü yerine DOĞRUDAN eylem: karttaki tek anlamlı işlem duruma göre
            zaten tek — taslakta sil, yayınlanmışta taslağa çevir. Üç nokta,
            tek maddelik bir menüyü açmak için fazladan bir tıklamaydı.
            Düzenleme kartın kendisine tıklayarak yapılır. */}
        <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
          {!actionsVisible && (
            <Badge size="xs" variant="default" radius="sm"
              style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                       color: TEXT_MUTED, borderColor: BORDER, background: HEADER_BG }}>
              {EXAM_TYPE_LABELS[e.exam_type]}
            </Badge>
          )}
          {actionsVisible && editable && (
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Sınavı sil"
              title="Sil"
              onClick={(ev) => { ev.stopPropagation(); onDelete(); }}>
              <IconTrash size={15} />
            </ActionIcon>
          )}
          {actionsVisible && revertable && (
            <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Taslağa çevir"
              title="Taslağa çevir"
              onClick={(ev) => { ev.stopPropagation(); onRevert(); }}>
              <IconArrowBackUp size={15} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      {showName && (
        <Text fz={13} fw={500} truncate mt={3}>{e.course.name}</Text>
      )}

      {showRoom && (
        <Group gap={4} wrap="nowrap" mt={5} style={{ minWidth: 0 }}>
          <IconMapPin size={12} stroke={1.8} color={TEXT_MUTED} style={{ flexShrink: 0 }} />
          <Text fz={12} truncate style={{ color: TEXT_MUTED }}>
            {odalar || "Derslik atanmadı"}
          </Text>
        </Group>
      )}

      {showLecturer && (
        <Group gap={4} wrap="nowrap" mt={3} style={{ minWidth: 0 }}>
          <IconUser size={12} stroke={1.8} color={TEXT_MUTED} style={{ flexShrink: 0 }} />
          <Text fz={12} truncate style={{ color: TEXT_MUTED }}>{e.lecturer.full_name}</Text>
        </Group>
      )}

      {showDraftBadge && (
        <Badge size="xs" variant="default" radius="sm" mt={6}
          style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                   color: TEXT_MUTED, borderColor: BORDER, background: "#FFFFFF" }}>
          Taslak
        </Badge>
      )}

      {(hard || warn) && (
        <span title={hard ? "Engelleyici çakışma" : "Uyarı"}
          style={{ position: "absolute", right: 7, bottom: 6, color: accent, lineHeight: 0 }}>
          {hard ? <IconAlertCircle size={15} /> : <IconAlertTriangle size={15} />}
        </span>
      )}
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
