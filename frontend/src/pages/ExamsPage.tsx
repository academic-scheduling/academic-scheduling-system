import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, MultiSelect,
  NumberInput, Paper, Popover, ScrollArea, Select, Stack, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle, IconAlertTriangle, IconArrowBackUp, IconCheck, IconChevronLeft,
  IconChevronRight, IconMapPin, IconPlus, IconTrash, IconUser, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import {
  courseCommonForDept, courseInCohort, EXAM_TYPE_LABELS, lecturerLabel, SEMESTER_LABELS,
} from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import { useDragEdgeScroll } from "../hooks/useDragEdgeScroll";
import { useUndoStack } from "../hooks/useUndoStack";
import type { UndoEntity } from "../hooks/useUndoStack";
import ChangeFeed from "../components/ChangeFeed";
import DraftBar from "../components/DraftBar";
import ExportMenu from "../components/ExportMenu";
import {
  ACCENT, BORDER, BORDER_HOVER, CARD_PADDING, CARD_RADIUS, CONTROL_H, DAY_LINE,
  EXAM_HOUR_H, GRID_CELL_BG, HEAD_H, HEADER_BG, HOVER_CELL_BG, LINE, MIN_DAY_W, MIN_LANE_W,
  PAGE_SURFACE, SHADOW, SHADOW_HOVER,
  SHADOW_SELECTED, SIDEBAR_BG, SIDE_W, TEXT_MUTED, TEXT_STRONG, TIME_COL_W, TIME_COLOR,
  paletteItemStyle,
} from "../utils/scheduleTheme";
import type {
  Classroom, ConflictResult, ConflictScan, Course, Department, Exam, ExamType,
  Lecturer, ScheduleDraft, SemesterType,
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

// K-48: sınıf seçicisinde "Ortak dersler" sözde-yıl. Seçilince cohort ortak
// (is_common) derslere döner (haftalık programdaki desenle aynı).
const COMMON_YEAR = "common";

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
  const navigate = useNavigate();
  const highlightParam = searchParams.get("highlight");
  const highlightIds = useMemo(() => {
    if (!highlightParam) return [];
    return highlightParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
  }, [highlightParam]);
  const ruleParam = searchParams.get("rule");

  const [deepHighlightIds, setDeepHighlightIds] = useState<number[]>([]);
  const [highlightInfo, setHighlightInfo] = useState<{
    rule: string;
    exams: Exam[];
  } | null>(null);

  const conflictsRef = useRef<HTMLDivElement>(null);
  // Yakılacak satırlar KURALA göre değil, TIKLANAN sınava göre seçilir: aynı
  // kuralın başka sınavlara ait satırları yanmasın, yalnız o sınavınki yansın.
  const [blinkingExamId, setBlinkingExamId] = useState<number | null>(null);

  useEffect(() => {
    if (blinkingExamId == null) return;
    const timer = setTimeout(() => setBlinkingExamId(null), 4000);
    return () => clearTimeout(timer);
  }, [blinkingExamId]);

  useEffect(() => {
    if (!deepHighlightIds.length) return;
    const timer = setTimeout(() => setDeepHighlightIds([]), 3500);
    return () => clearTimeout(timer);
  }, [deepHighlightIds]);

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
  // K-60: NULL = yayındaki sınav takvimi (salt-okunur). Dolu = kendi özel
  // taslağım; takvim, çakışma ve bütün yazma işlemleri onun içine yönlenir.
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Sürükleme sırasında imleç ekran kenarına gelince programı o yöne kaydır:
  // takvim ekrana sığmasa da görünmeyen hücrelere sınav bırakılabilsin.
  const examGridRef = useRef<HTMLDivElement>(null);
  useDragEdgeScroll(drag !== null, examGridRef);

  // Geri Al: taslak sınavlara yapılan taşıma/düzenleme/ekleme/silmeyi geri alır.
  // Kalıcı (localStorage) ve çok adımlı — sayfa yenilense de yığın durur.
  const { record: recordUndo, undo: popUndo, count: undoCount, busy: undoBusy } =
    useUndoStack("exams-undo");

  const load = () => {
    setLoading(true);
    setError(null);
    // K-60: taslaktayken takvim TASLAĞIN kopyasını gösterir ve çakışma tablosu
    // taslağın evreninde hesaplanır (kendi sınavları + diğer cohort'ların
    // yayını + yayındaki ders programı). Yayın modunda eski davranış aynen.
    const sinavlar = draft
      ? api.get<Exam[]>(`/schedule-drafts/${draft.id}/exams`)
      : api.get<Exam[]>("/exams");
    const cakismalar = draft
      ? api.get<ConflictScan>(`/schedule-drafts/${draft.id}/conflicts`)
      : api.get<ConflictScan>("/conflicts");
    Promise.all([
      sinavlar,
      api.get<Course[]>("/courses"),
      api.get<Classroom[]>("/classrooms"),
      api.get<Lecturer[]>("/lecturers?search="),
      api.get<Department[]>("/departments"),
      cakismalar,
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
  // Taslağa girip çıkmak takvimin kaynağını değiştirir; durum değişimi de
  // (geri çekme / ret) yeniden yükleme ister — donmuş taslak salt-okunurdur.
  useEffect(load, [draft?.id, draft?.status]);

  // Bölümler genel-bakışından ?department_id= ile gelindiğinde o bölümü seç;
  // parametreyi bir kez tüketip URL'den temizle. Yıl/dönem kullanıcıya bırakılır.
  useEffect(() => {
    const depParam = searchParams.get("department_id");
    if (!depParam) return;
    setDep(depParam);
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight yönlendirmesi geldiğinde hedef sınavların tarih ve cohort filtrelerini otomatik ayarla
  useEffect(() => {
    if (!highlightIds.length) return;
    api.get<Exam[]>("/exams")
      .then((allExams) => {
        const targets = allExams.filter((x) => highlightIds.includes(x.id));
        if (targets.length > 0) {
          const firstTarget = targets[0];
          const fullCourse = courses.find((c) => c.id === firstTarget.course.id);
          if (fullCourse) {
            setDep(String(fullCourse.department_id));
            setYear(String(fullCourse.year));
            setSem(fullCourse.semester);
          }
          setWeek(new Date(`${firstTarget.exam_date}T00:00:00`));
          if (ruleParam) {
            const courseCodes = Array.from(new Set(targets.map((t) => t.course.code))).join(" ↔ ");
            notifications.show({
              id: `exam-highlight-${highlightIds.join("-")}`,
              color: "blue",
              title: `Çakışan Sınavlar Vurgulandı (${ruleParam})`,
              message: `${courseCodes} sınavları takvim üzerinde gösteriliyor.`,
            });
          }
          setDeepHighlightIds(targets.map((t) => t.id));
          setHighlightInfo({
            rule: ruleParam ?? "Çakışma",
            exams: targets,
          });
        } else {
          notifications.show({ color: "yellow", message: "Vurgulanacak sınav bulunamadı." });
        }
        setSearchParams({}, { replace: true });
      })
      .catch(() => {});
  }, [highlightIds, ruleParam, courses, setSearchParams]);

  const gunler = useMemo(
    () => [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)), [weekStart]);

  /** Seçili cohort'un TÜM dersleri (bölüm + yıl + dönem). K-57: ortak ders onu
   *  tüketen bölümün cohort'undan da gelir (ek cohort). K-48: "Ortak dersler"
   *  seçiliyse bölümün o dönemde aldığı ortak dersler. Palet, ızgara ve yayınlama
   *  kümesi hepsi buradan türer — tek nokta yeter. */
  const cohortCourses = useMemo(() => {
    const depId = Number(dep);
    return courses.filter((c) =>
      year === COMMON_YEAR
        ? courseCommonForDept(c, depId, sem)
        : courseInCohort(c, depId, Number(year), sem));
  }, [courses, dep, year, sem]);
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

  // K-60: YAYINDAKİ sınav takvimine artık kimse doğrudan yazamaz. Yazma yalnız
  // kendi taslağının içinde olur ve yetki İSTEMEZ — özel taslak kimseyi
  // etkilemez. Yetki (can_manage_exams + bölüm üyeliği) ONAYA GÖNDERME
  // kapısında aranır (haftalıktaki K-59 devriyle birebir aynı).
  const canWrite = draft !== null
    && (draft.status === "OPEN" || draft.status === "REJECTED");

  const canSubmitDraft = canWriteIn(user, "can_manage_exams",
                                    dep ? Number(dep) : undefined);

  /** Yazma uçlarının kökü. Taslaktayken bütün CRUD taslağın altına gider;
   *  yayın modunda yazma zaten kapalı (canWrite false). */
  const writeBase: UndoEntity = draft
    ? `schedule-drafts/${draft.id}/exams`
    : "exams";

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

  const handleUndo = async () => {
    const res = await popUndo();
    if (!res) return;
    load();
    notifications.show({
      color: res.ok ? "gray" : "red",
      message: res.ok ? `Geri alındı: ${res.label}` : `${res.label} — ${res.message}`,
    });
  };

  const sil = async (e: Exam) => {
    if (!canWrite) return;
    // K-60: taslaktan çıkarmak yayındaki sınavı SİLMEZ; kaldırma ancak onayla
    // gerçekleşir. Metin bunu söylemeli, yoksa kullanıcı geri dönüşü olmayan
    // bir şey yaptığını sanır.
    if (!window.confirm(
      `${e.course.code} ${examTypeLabel(e)} sınavı taslaktan çıkarılsın mı?\n\n`
      + "Yayındaki takvimden ancak onaylandığında düşer."
    )) return;
    try {
      await api.delete(`/${writeBase}/${e.id}`);
      // Geri al = aynı sınavı yeniden yarat (yeni id alır, remap yığında yapılır).
      recordUndo({
        label: `${e.course.code} ${examTypeLabel(e)} çıkarma`,
        entity: writeBase,
        action: { type: "create", restoreId: e.id, body: {
          course_id: e.course.id, exam_type: e.exam_type, exam_index: e.exam_index,
          exam_date: e.exam_date, start_time: e.start_time,
          duration_minutes: e.duration_minutes,
          classroom_ids: e.classrooms.map((c) => c.id),
          lecturer_id: e.lecturer.id, notes: e.notes,
        } },
      });
      notifications.show({ message: "Sınav taslaktan çıkarıldı", color: "gray" });
      load();
      refreshDraft();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Çıkarılamadı" });
    }
  };

  /** Taşıma: yalnız tarih ve saat değişir; derslik, süre, sorumlu korunur. */
  const tasi = async (e: Exam, tarih: string, dk: number) => {
    if (!canWrite) return;
    if (e.exam_date === tarih && toMin(e.start_time) === dk) return;
    const prevDate = e.exam_date, prevTime = e.start_time;   // geri al için
    try {
      const res = await api.patch<{ conflicts: ConflictResult[] }>(
        `/${writeBase}/${e.id}`, { exam_date: tarih, start_time: fmt(dk) });
      recordUndo({
        label: `${e.course.code} ${examTypeLabel(e)} taşıma`,
        entity: writeBase,
        action: { type: "patch", id: e.id,
          body: { exam_date: prevDate, start_time: prevTime } },
      });
      load();
      refreshDraft();
      showConflicts(res.conflicts, "Sınav taşındı");
    } catch (err) {
      // Donmuş taslak (409) ve hafta sonu (400) burada görünür.
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

  /** Ekleme modalındaki ders listesi: SEÇİLİ SINIFIN dersleri.
   *  K-60: yetki süzgeci KALKTI — taslağın kapsamı zaten cohort'tur ve sunucu
   *  kapsam dışı dersi 400 ile reddeder (`_ensure_course_in_cohort`). Yetki
   *  onaya gönderme kapısında aranır. */
  const secilebilirDersler = cohortCourses;

  /** Taslak açma TEK yer (K-60): hem çubuktaki "Taslak Aç" düğmesi hem de
   *  takvimde yayındaki bir sınava dokunulduğunda çıkan soru buraya iner. */
  const createDraft = async (): Promise<ScheduleDraft | null> => {
    if (!dep || year === COMMON_YEAR) return null;
    try {
      const d = await api.post<ScheduleDraft>("/schedule-drafts", {
        department_id: Number(dep), year: Number(year), semester: sem,
        kind: "EXAM",
      });
      setDraft(d);
      notifications.show({
        color: "green",
        message: `Taslak açıldı — yayındaki sınav takviminin kopyası (${d.entry_count} sınav). `
          + "Değişiklikleriniz yalnız size görünür, onaylanınca yayına geçer.",
      });
      return d;
    } catch (e) {
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : "Taslak açılamadı",
      });
      return null;
    }
  };

  /** Yayın modunda bir sınava dokunulduğunda sorulur (haftalıktaki eşi). */
  const askSwitchToDraft = () => {
    if (!dep || year === COMMON_YEAR) return;
    if (!window.confirm(
      [
        "Bu sınav takvimi YAYINDA ve doğrudan değiştirilemez.",
        "",
        "Yayındaki takvimin bir kopyasıyla taslak açılsın mı?",
        "Değişiklikleriniz yalnız size görünür; onaylandığında yayına geçer.",
      ].join("\n"),
    )) return;
    void createDraft();
  };

  /** Taslak sayaçlarını (change_count) tazeler: takvimde bir şey değiştiğinde
   *  çubuktaki "N değişiklik" yazısı da güncellenmeli. */
  const refreshDraft = () => {
    if (!draft) return;
    api.get<ScheduleDraft>(`/schedule-drafts/${draft.id}`)
      .then(setDraft)
      .catch(() => { /* taslak silinmişse çubuk zaten yayına dönecek */ });
  };

  /** Cohort değişince taslak ilişiği kesilir: CE/1/Güz taslağıyla EEE/2/Bahar
   *  takvimini göstermek anlamsız olurdu. */
  useEffect(() => {
    setDraft((d) => (d && (String(d.department_id) !== dep
      || String(d.year) !== year
      || d.semester !== sem) ? null : d));
  }, [dep, year, sem]);

  /** Bu cohort için AÇIK sınav taslağım varsa çubuk onu hatırlatsın (sayfa
   *  yenilense de kaybolmasın). Yalnız kendi taslaklarım döner. */
  useEffect(() => {
    if (!dep || year === COMMON_YEAR) return;
    api.get<ScheduleDraft[]>("/schedule-drafts")
      .then((liste) => {
        const eslesen = liste.find((d) => d.kind === "EXAM"
          && String(d.department_id) === dep
          && String(d.year) === year && d.semester === sem);
        if (eslesen) setDraft(eslesen);
      })
      .catch(() => { /* taslak listesi alınamazsa yayın modunda kal */ });
  }, [dep, year, sem]);

  const haftaEtiketi = () => {
    const son = addDays(weekStart, 4);
    const ayni = weekStart.getMonth() === son.getMonth();
    return ayni
      ? `${weekStart.getDate()}–${son.getDate()} ${AY[son.getMonth()]} ${son.getFullYear()}`
      : `${weekStart.getDate()} ${AY[weekStart.getMonth()]} – ${son.getDate()} ${AY[son.getMonth()]} ${son.getFullYear()}`;
  };

  const gitHafta = (n: number) => setWeek(addDays(weekStart, n * 7));

  /** Resmi sınav programı indirme yolu: seçili bölüm + dönemin TÜM yıllarını,
   *  üniversite formatında (yıla göre gruplu). schedule=midterm → Vize;
   *  final → Final + Bütünleme (ders bazında eşlenir). İndirme/hata/yükleniyor
   *  ortak ExportMenu bileşeninde; "bölüm seçilmedi" durumu menü disabled ile
   *  engellenir (aşağıda `disabled={!dep}`). */
  const examExportPath = (schedule: "midterm" | "final"): string =>
    `/export/exams?${new URLSearchParams({
      department_id: dep ?? "", semester: sem, schedule, format: "xlsx",
    })}`;

  return (
    <Stack gap="lg">
      {/* Tek yatay araç çubuğu: solda başlık, ortada mercek (bölüm/sınıf/dönem),
          sağda hafta gezinme + yayınlama. Üç bölüm tek bir kabuk içinde durur —
          iki ayrı çerçeve, aralarındaki boşluğu gereksiz bir sınır gibi
          gösteriyordu. */}
      <Paper radius="md" px="md" py={10}
        style={{ background: PAGE_SURFACE, border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Title order={2} fw={600} fz={18} style={{ letterSpacing: "-0.01em" }}>
            Sınav Takvimi
          </Title>

          <Group gap={8} align="center" wrap="wrap">
            <Select size="xs" w={200} radius="md" value={dep} onChange={setDep}
              styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
            <Select size="xs" w={130} radius="md" value={year} onChange={(v) => v && setYear(v)}
              styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
              data={[{ value: COMMON_YEAR, label: "Ortak dersler" },       // K-48
                ...["1", "2", "3", "4"].map((y) => ({ value: y, label: `${y}. sınıf` }))]} />
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
            {/* Sınav programı resmi formatta (K-09): Vize / Final+Bütünleme ayrı
                sayfa düzeni — bu yüzden xlsx/csv değil, iki anlamlı seçenek.
                Diğer sayfalarla aynı ExportMenu bileşeni: tetikleyici her yerde
                birebir aynı görünür. */}
            {canWrite && (
              <Tooltip label="Son taslak değişikliğini geri al">
                <Button variant="default" size="xs" radius="md"
                  leftSection={<IconArrowBackUp size={15} />}
                  disabled={undoCount === 0 || undoBusy}
                  loading={undoBusy}
                  style={{ height: CONTROL_H, borderColor: BORDER }}
                  onClick={handleUndo}>
                  Geri Al{undoCount ? ` (${undoCount})` : ""}
                </Button>
              </Tooltip>
            )}
            <ExportMenu disabled={!dep} items={[
              { label: "Vize Programı (Excel)", path: examExportPath("midterm") },
              { label: "Final + Bütünleme (Excel)", path: examExportPath("final") },
            ]} />
            {/* K-60: eski "Yayınla" düğmesi KALKTI. Yayına giden tek yol onay;
                düğmeyi bırakmak, onay adımını atlamanın bir yolunu bırakmak
                olurdu (haftalıkta K-59'da aynı gerekçeyle kaldırılmıştı). */}
          </Group>
        </Group>
      </Paper>

      {/* Mod çubuğu: "yayına mı yazıyorum, taslağa mı" sorusunun cevabı
          takvimin hemen üstünde durmalı — taslaktayken renklenir. */}
      <DraftBar
        departmentId={dep ? Number(dep) : null}
        year={year === COMMON_YEAR ? null : Number(year)}
        semester={sem}
        kind="EXAM"
        draft={draft}
        canSubmit={canSubmitDraft}
        onSelect={(d) => setDraft(d)}
        onCreate={async () => { await createDraft(); }}
        onChanged={() => { load(); refreshDraft(); }}
      />

      {/* Yalnız YAYIN modunda: taslaktayken kullanıcı kendi işine bakıyor,
          arka plandaki yayın hareketleri o an gürültü olur (K-59 gerekçesi). */}
      {!draft && <ChangeFeed limit={3} />}

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
                               borderColor: BORDER, background: PAGE_SURFACE } }}
            placeholder="Ders ara" />
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
            <Stack gap={6}>
              {paletDersler.length === 0 && (
                <Text size="xs" c="dimmed" px={4}>Bu sınıfta ders yok.</Text>
              )}
              {paletDersler.map(({ course: c, done }) => (
                <PaletteItem key={c.id} course={c} done={done}
                  draggable={canWrite}
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
        <Paper ref={examGridRef} p="md" radius="md"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   background: PAGE_SURFACE, border: `1px solid ${BORDER}`,
                   boxShadow: SHADOW }}>
          {loading ? (
            // Yüklenirken takvimin TAM yüksekliğini rezerve et: yoksa spinner
            // kutusu kısa kalıp altındaki Çakışmalar bölümü grid gelince aşağı
            // zıplıyor (route-fade sırasında görünür jank).
            <Group justify="center" align="center"
              style={{ height: HEAD_H + HOUR_H * (HOURS.length - 1) }}>
              <Loader size="sm" />
            </Group>
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
                        // Yayın modunda boş hücre işareti gösterilmez (yazma
                        // kapalı). Taslağa geçme SORUSU burada değil TIKLAMADA
                        // sorulur — fare hareketinde sormak diyaloğu her
                        // kıpırdanışta açardı.
                        if (!canWrite) return;
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
                        if (!canWrite) { if (!draft) askSwitchToDraft(); return; }
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
                          background: "light-dark(#EFF6FF, #1E2A3B)",
                          border: "1px dashed light-dark(#93C5FD, #3B5578)",
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
                      {/* K-60: düzenlenebilirlik artık SATIRIN değil MODUN
                          özelliği — taslaktaysak yazılır, yayındaysak okunur.
                          Kart başına durum rozeti / kilit ikonu yok. */}
                      {dayExams.map((e) => (
                        <ExamCard key={e.id} e={e}
                          hard={hardIds.has(e.id)} warn={warnIds.has(e.id)}
                          highlight={deepHighlightIds.includes(e.id)}
                          listHover={hoverCourse === e.course.id}
                          editable={canWrite}
                          onWarningClick={() => {
                            // Bu sınavı işaretle; aşağıda yalnız bu sınavı
                            // etkileyen çakışma satırları yanacak.
                            setBlinkingExamId(e.id);
                            conflictsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          onDragStart={() => setDrag({ kind: "move", exam: e })}
                          onDragEnd={() => setDrag(null)}
                          onEdit={() => (canWrite ? setEditing(e) : askSwitchToDraft())}
                          onDelete={() => sil(e)} />
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

      <Paper ref={conflictsRef} p="md" radius="md"
        style={{ background: PAGE_SURFACE, border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <style>{`
          @keyframes blinkPulseRed {
            0% { background-color: rgba(239, 68, 68, 0.35); box-shadow: 0 0 12px rgba(239, 68, 68, 0.6); }
            50% { background-color: rgba(239, 68, 68, 0.05); box-shadow: none; }
            100% { background-color: rgba(239, 68, 68, 0.35); box-shadow: 0 0 12px rgba(239, 68, 68, 0.6); }
          }
          @keyframes blinkPulseYellow {
            0% { background-color: rgba(245, 158, 11, 0.35); box-shadow: 0 0 12px rgba(245, 158, 11, 0.6); }
            50% { background-color: rgba(245, 158, 11, 0.05); box-shadow: none; }
            100% { background-color: rgba(245, 158, 11, 0.35); box-shadow: 0 0 12px rgba(245, 158, 11, 0.6); }
          }
        `}</style>
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
          /* Haftalık programla aynı: liste alt alta uzar (kaydırma kutusu yok).
             Kapalı bir slider içinde çakışmaların birikmesi, kaçının görünür
             olduğunu belirsizleştiriyordu. */
          <Stack gap={8}>
            {examConflicts.map((c, i) => {
              const isBlinking = blinkingExamId != null
                && c.affected.some((a) => a.type === "exam" && a.id === blinkingExamId);
              const isHard = c.severity === "HARD";
              return (
                <Group key={`${c.rule_id}-${i}`} justify="space-between" gap="sm" wrap="nowrap" align="flex-start"
                  p={6}
                  style={{
                    borderRadius: 6,
                    transition: "all 300ms ease",
                    animation: isBlinking
                      ? isHard ? "blinkPulseRed 0.8s ease-in-out infinite" : "blinkPulseYellow 0.8s ease-in-out infinite"
                      : undefined,
                    border: isBlinking
                      ? isHard ? "2px solid #EF4444" : "2px solid #F59E0B"
                      : "1px solid transparent",
                    background: isBlinking
                      ? isHard ? "light-dark(#FEF2F2, #3A2526)" : "light-dark(#FFFBEB, #3A3320)"
                      : undefined,
                  }}>
                  <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0, flex: 1 }}>
                    <Badge size="sm" variant="light" style={{ flexShrink: 0 }}
                      color={c.severity === "HARD" ? "red" : "orange"}>
                      {c.severity === "HARD" ? "ENGEL" : "UYARI"}
                    </Badge>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 30 }}>{c.rule_id}</Text>
                    <Text size="sm" fw={isBlinking ? 700 : 400}>{c.message}</Text>
                  </Group>
                  {/* Etkilenen tarafların HEPSİ düğme olur. Sınav öğesi bu
                      sayfada highlight'lanır; X kuralında karşı taraf HAFTALIK
                      DERS olduğundan o düğme haftalık programa yönlendirir
                      (o kayıt bu sayfada yok). Renk nereye gittiğini belli eder:
                      mor = sınav (burada), mavi = haftalık ders (haftalık sayfa). */}
                  {c.affected.length > 0 && (
                    <Group gap={6} wrap="wrap" justify="flex-end" style={{ flexShrink: 0, maxWidth: "38%" }}>
                      {c.affected.map((a, idx) => (
                        <Button key={idx} size="compact-xs" variant="light"
                          color={a.type === "exam" ? "violet" : "blue"}
                          onClick={() => {
                            if (a.type === "exam") {
                              setSearchParams({ highlight: String(a.id), rule: c.rule_id });
                            } else {
                              navigate(`/weekly?highlight=${a.id}&rule=${c.rule_id}`);
                            }
                          }}>
                          {a.course_code ?? `#${a.id}`}
                        </Button>
                      ))}
                    </Group>
                  )}
                </Group>
              );
            })}
          </Stack>
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
          exams={exams}
          writeBase={writeBase}
          onClose={() => { setPlacing(null); setEditing(null); }}
          onSaved={(info) => {
            if (info.created) {
              recordUndo({
                label: `${info.created.course.code} ${examTypeLabel(info.created)} ekleme`,
                entity: writeBase,
                action: { type: "delete", id: info.created.id },
              });
            } else if (info.before) {
              const b = info.before;
              recordUndo({
                label: `${b.course.code} ${examTypeLabel(b)} düzenleme`,
                entity: writeBase,
                action: { type: "patch", id: b.id, body: {
                  exam_type: b.exam_type, exam_index: b.exam_index,
                  exam_date: b.exam_date, start_time: b.start_time,
                  duration_minutes: b.duration_minutes,
                  classroom_ids: b.classrooms.map((c) => c.id),
                  lecturer_id: b.lecturer.id, notes: b.notes,
                } },
              });
            }
          }}
          onDone={(conflicts, baslik) => {
            setPlacing(null); setEditing(null); load(); refreshDraft();
            showConflicts(conflicts, baslik);
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
                // blue-light: tema-farkındalıklı seçili tonu (blue-1 sabit açıktı).
                background: secili ? "var(--mantine-color-blue-light)" : undefined,
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
        <Text fz={12} fw={600} style={{ color: done ? TEXT_MUTED : TEXT_STRONG }}>
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

function ExamCard({ e, hard, warn, highlight, listHover, editable, onWarningClick, onDragStart, onDragEnd, onEdit, onDelete }: {
  e: Placed; hard: boolean; warn: boolean; highlight?: boolean; listHover?: boolean;
  /** K-60: SATIRIN durumu yok — düzenlenebilirlik MODUN özelliği (taslak mı,
   *  yayın mı). Bu yüzden eskiden buradaki `revertable` ve durum rozeti gitti. */
  editable: boolean; onWarningClick?: () => void;
  onDragStart: () => void; onDragEnd: () => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  const [hover, setHover] = useState(false);

  // K-60: satırın kendi "durumu" yok artık — hangi moddaysak o. Kesikli kenar
  // ve taslak vurgusu, kartın yayında mı taslakta mı olduğunu değil EKRANIN
  // hangi modda olduğunu anlatır (haftalıktaki K-59 devriyle aynı).
  const draft = editable;
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

  const actionsVisible = editable && hover;

  return (
    <div
      ref={cardRef}
      draggable={editable}
      onDragStart={(ev) => {
        // Yayın modunda taşıma yok: yayına yazan tek yol onaydır (K-60).
        if (!editable) { ev.preventDefault(); return; }
        ev.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={(ev) => {
        ev.stopPropagation();
        // Yayın modunda tıklama "taslağa geçilsin mi?" sorusuna gider (onEdit
        // sayfada o davranışa bağlandı) — kullanıcı çıkmaza düşmesin.
        onEdit();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={editable
        ? `${e.course.code} · ${fmt(bas)}-${fmt(bit)} · düzenlemek için tıkla, taşımak için sürükle`
        : `${e.course.code} · ${fmt(bas)}-${fmt(bit)} · ${e.total_expected_students} öğrenci`
          + ` · yayında — değiştirmek için taslak açın`}
      style={{
        position: "absolute",
        top: (bas - DAY_START) * PX + 1,
        height: h - 2,
        left: `calc(${e.lane * w}% + 2px)`, width: `calc(${w}% - 4px)`,
        background: PAGE_SURFACE, color: TEXT_STRONG,
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
        cursor: "pointer",
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
              {examTypeLabel(e)}
            </Badge>
          )}
          {actionsVisible && (
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Sınavı sil"
              title="Sil"
              onClick={(ev) => { ev.stopPropagation(); onDelete(); }}>
              <IconTrash size={15} />
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
          <Text fz={12} truncate style={{ color: TEXT_MUTED }}>{lecturerLabel(e.lecturer)}</Text>
        </Group>
      )}

      {(hard || warn) && (
        <span title={hard ? "Engelleyici çakışma — Çakışmalar bölümüne gitmek için tıklayın" : "Uyarı — Çakışmalar bölümüne gitmek için tıklayın"}
          onClick={(ev) => {
            ev.stopPropagation();
            onWarningClick?.();
          }}
          style={{
            position: "absolute", right: 7, bottom: 6, color: accent, lineHeight: 0,
            cursor: "pointer", padding: 2, borderRadius: 4,
            background: "light-dark(rgba(255,255,255,0.8), rgba(44,46,51,0.85))",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "transform 150ms ease",
            zIndex: 10,
          }}
          onMouseEnter={(ev) => (ev.currentTarget.style.transform = "scale(1.25)")}
          onMouseLeave={(ev) => (ev.currentTarget.style.transform = "scale(1)")}>
          {hard ? <IconAlertCircle size={15} /> : <IconAlertTriangle size={15} />}
        </span>
      )}
    </div>
  );
}

// K-46: kart/başlık etiketi. Birden çok vizeli derste sırayı gösterir
// ("2. Vize"); tek vize / final / büt için sade tür adı ("Vize", "Final").
function examTypeLabel(e: { exam_type: ExamType; exam_index: number }): string {
  if (e.exam_type === "MIDTERM" && e.exam_index > 1) return `${e.exam_index}. Vize`;
  return EXAM_TYPE_LABELS[e.exam_type];
}

function ExamModal({ exam, initialDate, initialMin, initialCourseId, courses, classrooms, lecturers, exams, onClose, onDone, onSaved, writeBase }: {
  exam: Exam | null;
  initialDate?: string;
  initialMin?: number;
  /** Paletten sürüklenip/tıklanıp gelindiyse ders zaten belli. */
  initialCourseId?: number;
  courses: Course[];
  classrooms: Classroom[];
  lecturers: Lecturer[];
  /** K-46: aynı dersin kayıtlı vizelerinin sırasını görüp doldurulmuş olanları
   *  devre dışı bırakmak için mevcut sınav listesi. */
  exams: Exam[];
  onClose: () => void;
  onDone: (conflicts: ConflictResult[], baslik: string) => void;
  /** Geri Al için: kayıt başarılı olunca eklenen sınav (created) ya da
   *  düzenleme öncesi durum (before) üst bileşene verilir. */
  onSaved?: (info: { created?: Exam; before?: Exam }) => void;
  /** K-60: yazma ucunun kökü — taslaktayken `schedule-drafts/{id}/exams`.
   *  Sayfadan GEÇİRİLİR, burada türetilmez: modalın kendi başına "hangi
   *  moddayım" bilmesi, iki yerde ayrı ayrı doğru tutulması gereken bir
   *  gerçek olurdu. (Tarayıcıda yakalandı: modal eski `/exams` ucuna
   *  yazmaya devam ediyordu ve taslak satırında 500 veriyordu.) */
  writeBase: string;
}) {
  const duzenle = exam != null;
  const [courseId, setCourseId] = useState<string | null>(
    exam ? String(exam.course.id) : initialCourseId != null ? String(initialCourseId) : null);
  const [tip, setTip] = useState<ExamType>(exam?.exam_type ?? "FINAL");
  const [vizeNo, setVizeNo] = useState<number>(exam?.exam_index ?? 1);   // K-46: kaçıncı vize
  const [tarih, setTarih] = useState(exam?.exam_date ?? initialDate ?? "");
  const [saat, setSaat] = useState(exam?.start_time?.slice(0, 5) ?? fmt(initialMin ?? 9 * 60));
  const [sure, setSure] = useState(exam?.duration_minutes ?? 90);
  const [odalar, setOdalar] = useState<string[]>(exam?.classrooms.map((c) => String(c.id)) ?? []);
  const [hoca, setHoca] = useState<string | null>(exam ? String(exam.lecturer.id) : null);
  const [not, setNot] = useState(exam?.notes ?? "");
  const [busy, setBusy] = useState(false);

  // K-46: seçili dersin vize sayısı; birden fazlaysa "kaçıncı vize" sorulur.
  const selectedCourse = courses.find((c) => String(c.id) === courseId) ?? null;
  const midtermCount = selectedCourse?.midterm_count ?? 1;
  const showVizeNo = tip === "MIDTERM" && midtermCount > 1;
  // Bu dersin kayıtlı vize sıraları (düzenlenen sınav hariç) — dolular seçilemez.
  const usedVizeNo = useMemo(() => new Set(
    exams.filter((e) => String(e.course.id) === courseId
      && e.exam_type === "MIDTERM" && e.id !== exam?.id).map((e) => e.exam_index),
  ), [exams, courseId, exam]);
  // Yeni vize eklerken ilk boş sırayı otomatik seç (düzenlemede seçime dokunma).
  useEffect(() => {
    if (duzenle || tip !== "MIDTERM") return;
    setVizeNo([1, 2, 3].find((i) => i <= midtermCount && !usedVizeNo.has(i)) ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, tip, midtermCount]);

  const haftaSonu = isWeekend(tarih);
  const eksik = !courseId || !tarih || !saat || !hoca || haftaSonu;

  const kaydet = async () => {
    setBusy(true);
    try {
      const govde = {
        exam_type: tip, exam_index: tip === "MIDTERM" ? vizeNo : 1,   // K-46
        exam_date: tarih, start_time: saat,
        duration_minutes: sure, classroom_ids: odalar.map(Number),
        lecturer_id: Number(hoca), notes: not || null,
      };
      if (duzenle) {
        const res = await api.patch<{ conflicts: ConflictResult[] }>(
          `/${writeBase}/${exam!.id}`, govde);
        onSaved?.({ before: exam! });      // geri al = eski alanlara döndür
        onDone(res.conflicts, "Sınav güncellendi");
      } else {
        const res = await api.post<{ exam: Exam; conflicts: ConflictResult[] }>(
          `/${writeBase}`, { course_id: Number(courseId), ...govde });
        onSaved?.({ created: res.exam });  // geri al = eklenen sınavı sil
        onDone(res.conflicts, "Sınav taslağa eklendi");
      }
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Kaydedilemedi" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} size="sm"
      title={duzenle ? `${exam!.course.code} · ${examTypeLabel(exam!)}` : "Sınav ekle"}>
      <Stack gap="sm">
        {!duzenle && (
          <Select label="Ders" value={courseId} onChange={setCourseId} searchable
            placeholder="Ders seç" nothingFoundMessage="Ders yok"
            data={courses.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))} />
        )}
        <Select label="Sınav türü" value={tip} onChange={(v) => v && setTip(v as ExamType)}
          data={(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((k) => ({
            value: k, label: EXAM_TYPE_LABELS[k] }))} />
        {/* K-46: ders birden fazla vize taşıyorsa hangisi olduğunu sor. Dolu
            sıralar devre dışı; ilk boş sıra otomatik seçilir. */}
        {showVizeNo && (
          <Select label="Kaçıncı vize" value={String(vizeNo)}
            onChange={(v) => v && setVizeNo(Number(v))}
            data={Array.from({ length: midtermCount }, (_, i) => i + 1).map((i) => ({
              value: String(i),
              label: `${i}. vize${usedVizeNo.has(i) ? " · kayıtlı" : ""}`,
              disabled: usedVizeNo.has(i),
            }))} />
        )}
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
          data={lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) }))} />
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
