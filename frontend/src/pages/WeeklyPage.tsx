import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput,
  Paper, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle, IconAlertTriangle, IconArrowBackUp, IconCheck,
  IconMapPin, IconPlus, IconTrash, IconWorld, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ExportMenu from "../components/ExportMenu";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { ROOM_TYPE_LABELS, SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import {
  ACCENT, BORDER, BORDER_HOVER, CARD_PADDING, CARD_RADIUS, CONTROL_H, DAY_LINE,
  GRID_CELL_BG, HEAD_H, HEADER_BG, HOVER_CELL_BG, LINE, MIN_DAY_W, MIN_LANE_W,
  SHADOW, SHADOW_HOVER,
  SHADOW_SELECTED, SIDEBAR_BG, SIDE_W, TEXT_MUTED, TIME_COL_W, TIME_COLOR, WEEKLY_ROW_H,
  paletteItemStyle,
} from "../utils/scheduleTheme";
import type {
  Classroom, ConflictResult, ConflictScan, Course, CourseSection, DeliveryMode, Department,
  Lecturer, SemesterType, SessionType, WeeklyEntry,
} from "../api/types";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];
const YEARS = ["1", "2", "3", "4"];
/* Görsel belirteçler Sınav Takvimi ile ORTAK — utils/scheduleTheme.ts.
   İki ekranın ızgara yüksekliği de orada eşitlenir (9 × 91 = 13 × 63). */
const ROW_H = WEEKLY_ROW_H;   // tek slot: kod, ders adı ve konum rahatça okunur

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

type ViewMode = "cohort" | "classroom" | "lecturer";

const VIEW_LABELS: Record<ViewMode, string> = {
  cohort: "Sınıf", classroom: "Derslik", lecturer: "Öğretim üyesi",
};

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
  // Gün bir kez şeritlere bölündüğünde bölünme günün sonuna kadar korunur.
  // Böylece 09:30'daki tek ders, 08:30'daki iki paralel dersin ardından tüm
  // sütunu kaplamaz; boş şeritler de takvimin yapısal grid'i olarak görünür.
  const dayLanes = Math.max(1, ...out.map((c) => c.lanes));
  return out.map((c) => ({ ...c, lanes: dayLanes }));
}

/** Kesişen kartlar asla okunamayacak kadar daralmamalı.
 *
 * Takvim yatay kaydırmayı zaten destekliyor; bu yüzden iki etkinliği 80px'lik
 * kartlara sıkıştırmak yerine ilgili gün sütununu genişletiyoruz. */
function dayWidth(clusters: Cluster[]): number {
  return Math.max(MIN_DAY_W, ...clusters.map((c) => c.lanes * MIN_LANE_W));
}

export default function WeeklyPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightParam = searchParams.get("highlight");
  const highlightIds = useMemo(() => {
    if (!highlightParam) return [];
    return highlightParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
  }, [highlightParam]);
  const ruleParam = searchParams.get("rule");
  const classroomParam = searchParams.get("classroom_id");
  const lecturerParam = searchParams.get("lecturer_id");
  const viewParam = searchParams.get("view");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);

  // Üç MERCEK, tek grid: aynı veriye kimin gözünden bakıldığı.
  //  cohort   → öğrencinin haftası  (yazılabilir: palet, sürükle, yayınla)
  //  classroom→ odanın doluluğu     } salt-okunur "kontrol" bakışları; hangi
  //  lecturer → hocanın yükü        } cohort'a yazılacağı belirsiz olduğu için
  //                                   buralarda düzenleme kapalı
  const [view, setView] = useLocalStorage<ViewMode>({
    key: "weekly-view", defaultValue: "cohort", getInitialValueInEffect: false });
  const [roomFilter, setRoomFilter] = useLocalStorage<string | null>({
    key: "weekly-room", defaultValue: null, getInitialValueInEffect: false });
  const [lecFilter, setLecFilter] = useLocalStorage<string | null>({
    key: "weekly-lec", defaultValue: null, getInitialValueInEffect: false });

  // Cohort seçimi localStorage'da: başka sayfaya gidip dönünce kullanıcı
  // kaldığı yerden devam etsin, her seferinde varsayılana düşmesin.
  const [dep, setDep] = useLocalStorage<string | null>({
    key: "weekly-dep", defaultValue: null, getInitialValueInEffect: false });
  const [year, setYear] = useLocalStorage({
    key: "weekly-year", defaultValue: "1", getInitialValueInEffect: false });
  const [sem, setSem] = useLocalStorage<SemesterType>({
    key: "weekly-sem", defaultValue: "SPRING", getInitialValueInEffect: false });

  // Derslik listesinden gelen bağlantı, doğru merceği ve dersliği açar.
  // URL kaynak kabul edilir: paylaşım, yenileme ve tarayıcı geri/ileri akışı
  // localStorage'daki son tercihten bağımsız olarak aynı programı gösterir.
  useEffect(() => {
    if (viewParam !== "classroom" || !classroomParam) return;
    setView("classroom");
    setRoomFilter(classroomParam);
  }, [viewParam, classroomParam, setView, setRoomFilter]);

  useEffect(() => {
    if (viewParam !== "lecturer" || !lecturerParam) return;
    setView("lecturer");
    setLecFilter(lecturerParam);
  }, [viewParam, lecturerParam, setView, setLecFilter]);

  const [entries, setEntries] = useState<WeeklyEntry[]>([]);
  // Workgroup'un TÜM dersleri bir kez çekilir. Üç iş birden görür: paletin
  // sınıf süzmesi, seçmeli rozeti (her mercekte) ve hoca panelindeki sayımlar.
  // Cohort başına ayrı istek atılsaydı derslik/hoca bakışında elde ders olmaz,
  // "seçmeli" rozeti sessizce kaybolurdu.
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [scan, setScan] = useState<ConflictScan>({ hard: [], warnings: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);           // "day-slot"
  // Palette üzerinde gezinilen şube: gridde o şubenin kartları vurgulanır.
  const [hoverSection, setHoverSection] = useState<number | null>(null);
  // Çakışma Raporu'ndan gelen derin bağlantı vurgusu ID'leri (hedef bulunduğunda başlar, 3.5s kalır)
  const [deepHighlightIds, setDeepHighlightIds] = useState<number[]>([]);
  // Çakışma Raporu'ndan gelindiğinde üstte gösterilecek çakışan dersler bilgi kutusu
  const [highlightInfo, setHighlightInfo] = useState<{
    rule: string;
    entries: WeeklyEntry[];
  } | null>(null);
  // Boş slot üzerinde gezinme: "buraya tıklayıp ekleyebilirsin" işareti.
  const [hoverCell, setHoverCell] = useState<string | null>(null);   // "day-slot"
  // drag yoksa BOŞ SLOTA TIKLAMA ile açılmıştır → modal dersi de sorar.
  const [placing, setPlacing] = useState<{ day: number; slot: number; drag?: Drag } | null>(null);
  const [editing, setEditing] = useState<WeeklyEntry | null>(null);
  const [group, setGroup] = useState<Cluster | null>(null);   // toplu kart detayı
  const [submitOpen, setSubmitOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");

  // Palet yüksekliği GRID'e bağlanır, kendi içeriğine değil: ders sayısı arttıkça
  // uzamasın, kaydırsın. Ölçüyoruz çünkü sabit sayı yazmak grid'in iç yapısı
  // (başlık yüksekliği, satır sayısı, Paper dolgusu) değişince sessizce bozulur.
  const gridRef = useRef<HTMLDivElement>(null);
  const conflictsRef = useRef<HTMLDivElement>(null);
  // Yakılacak satırlar KURALA göre değil, TIKLANAN kartın girişlerine göre
  // seçilir: aynı kuralın (ör. W2) başka derslere ait satırları yanmasın,
  // yalnız o kartın çakışmaları yansın.
  const [blinkingEntryIds, setBlinkingEntryIds] = useState<number[] | null>(null);

  useEffect(() => {
    if (!blinkingEntryIds) return;
    const timer = setTimeout(() => setBlinkingEntryIds(null), 4000);
    return () => clearTimeout(timer);
  }, [blinkingEntryIds]);
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

  // Yazma yalnız cohort bakışında: derslik/hoca mercekleri farklı cohort'ların
  // derslerini bir arada gösterir, "bunu nereye yazıyorum" sorusu belirsizleşir.
  const canWrite = view === "cohort"
    && canWriteIn(user, "can_manage_weekly", dep ? Number(dep) : undefined);

  useEffect(() => {
    Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Classroom[]>("/classrooms"),
      api.get<Lecturer[]>("/lecturers?search="),
      api.get<Course[]>("/courses"),
    ])
      .then(([d, c, l, co]) => {
        setDepartments(d);
        setClassrooms(c);
        setLecturers(l);
        setAllCourses(co);
        // Kayıtlı bölüm hâlâ geçerliyse ona dokunma; yoksa ilkine düş.
        setDep((mevcut) =>
          mevcut && d.some((x) => String(x.id) === mevcut)
            ? mevcut
            : d.length ? String(d[0].id) : null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Yüklenemedi"));
  }, []);

  // deepHighlightIds hedefe ulaştığında ve kart çizildiğinde 3.5 saniyelik halka zamanlayıcısını başlatır
  useEffect(() => {
    if (!deepHighlightIds.length) return;
    const timer = setTimeout(() => setDeepHighlightIds([]), 3500);
    return () => clearTimeout(timer);
  }, [deepHighlightIds]);

  // Bölümler genel-bakışından ?department_id= ile gelindiğinde cohort görünümüne
  // geç ve o bölümü seç; parametreyi bir kez tüketip URL'den temizle (yenilemede
  // kullanıcının o an seçtiği bölümü ezmesin). Yıl/dönem kullanıcıya bırakılır.
  useEffect(() => {
    const depParam = searchParams.get("department_id");
    if (!depParam) return;
    setDep(depParam);
    setView("cohort");
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight yönlendirmesi geldiğinde hedef kayıtların cohort filtrelerini otomatik ayarla
  useEffect(() => {
    if (!highlightIds.length || !allCourses.length) return;
    let cancelled = false;

    api.get<WeeklyEntry[]>("/weekly-entries")
      .then((allEntries) => {
        if (cancelled) return;
        const targets = allEntries.filter((x) => highlightIds.includes(x.id));
        if (targets.length > 0) {
          const firstTarget = targets[0];
          const fullCourse = allCourses.find((c) => c.id === firstTarget.section.course.id);
          if (fullCourse) {
            setView("cohort");
            setDep(String(fullCourse.department_id));
            setYear(String(fullCourse.year));
            setSem(fullCourse.semester);
          }
          if (ruleParam) {
            const courseCodes = Array.from(new Set(targets.map((t) => t.section.course.code))).join(" ↔ ");
            notifications.show({
              id: `highlight-${highlightIds.join("-")}`,
              color: "blue",
              title: `Çakışan Dersler Vurgulandı (${ruleParam})`,
              message: `${courseCodes} derslerinin kayıtları takvim üzerinde gösteriliyor.`,
            });
          }
          setDeepHighlightIds(targets.map((t) => t.id));
          setHighlightInfo({
            rule: ruleParam ?? "Çakışma",
            entries: targets,
          });
          setSearchParams({}, { replace: true });
        } else {
          notifications.show({ color: "yellow", message: "Vurgulanacak kayıt bulunamadı." });
          setSearchParams({}, { replace: true });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [highlightIds, ruleParam, allCourses, setSearchParams]);

  /** Aktif merceğin sunucu sorgusu (kontrat §7 üç filtreyi de sunuyor). */
  const activeQuery = (): string | null => {
    if (view === "cohort") return dep ? `department_id=${dep}&year=${year}&semester=${sem}` : null;
    if (view === "classroom") return roomFilter ? `classroom_id=${roomFilter}` : null;
    return lecFilter ? `lecturer_id=${lecFilter}` : null;
  };

  /** Dışa aktarma yolu: gördüğün mercek neyse onu indirir. Derslik merceği,
   *  ders listesi yerine derslik ızgarasını (build_classrooms_xlsx) verir. */
  const exportPath = (format: "xlsx" | "csv"): string => {
    if (view === "classroom") return `/export/classrooms?classroom_id=${roomFilter}&format=${format}`;
    return `/export/weekly?${activeQuery()}&format=${format}`;
  };

  const reload = () => {
    const qs = activeQuery();
    if (!qs) { setEntries([]); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<WeeklyEntry[]>(`/weekly-entries?${qs}`),
      api.get<ConflictScan>("/conflicts"),
    ])
      .then(([e, s]) => { setEntries(e); setScan(s); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Program yüklenemedi"))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [view, dep, year, sem, roomFilter, lecFilter]);

  /** Paletin dersleri: seçili sınıfın (bölüm+yıl+dönem) dersleri. */
  const courses = useMemo(
    () => allCourses.filter((c) =>
      String(c.department_id) === dep && String(c.year) === year && c.semester === sem),
    [allCourses, dep, year, sem]);

  const electiveOf = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const c of allCourses) m.set(c.id, c.is_elective);
    return m;
  }, [allCourses]);

  /** K-45: şube id → o dersin bileşen bazında online'lığı. EntryModal, seçilen
   *  oturum türü (T/U/L) online ise yalnız SENKRON/ASENKRON sordurur, değilse
   *  yüz yüze sabitler. */
  const onlineBySection = useMemo(() => {
    const m = new Map<number, Record<SessionType, boolean>>();
    for (const c of allCourses) {
      for (const s of c.sections) {
        m.set(s.id, { THEORY: c.theory_online, PRACTICE: c.practice_online, LAB: c.lab_online });
      }
    }
    return m;
  }, [allCourses]);


  const lecturerBySection = useMemo(() => {
    const names = new Map<number, string>();
    for (const course of allCourses) {
      for (const section of course.sections) names.set(section.id, section.lecturer.full_name);
    }
    return names;
  }, [allCourses]);

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
    if (entry.status !== "DRAFT") {
      notifications.show({ color: "red", message: "Yayınlanmış girişler taşınamaz. Önce taslağa çevirin." });
      return;
    }
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
    if (d.kind === "move") {
      if (d.entry.status !== "DRAFT") return;
      void moveEntry(d.entry, day, slot);
    } else {
      setPlacing({ drag: d, day, slot });
    }
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

  /** Sayfa altındaki çakışma listesi.
   *
   *  Yalnız HAFTALIK tarafı ilgilendirenler (sınav-sınav çakışmaları Sınavlar
   *  ekranının işi). Alt hesap için ayrıca "beni ilgilendiriyor mu" süzmesi:
   *  kendi bölümünün dersini içeren çakışmaları görür — karşı taraf başka bölüm
   *  olsa bile, çünkü çözebilmek için karşı tarafın kim olduğunu bilmesi gerekir.
   *  İki YABANCI bölüm arasındaki çakışma ise onu ilgilendirmez, gizlenir.
   *
   *  Not: bu bir GÖRÜNÜM süzmesidir. Sunucu K-26 gereği workgroup'un tamamını
   *  döndürmeye devam ediyor; gerçek bir yetki sınırı isteniyorsa K-26'nın
   *  revizyonu + backend değişikliği gerekir (ayrı iş).
   */
  const weeklyConflicts = useMemo(() => {
    const bolumOf = (courseCode: string) => {
      const kod = courseCode.replace(/-\d+$/, "");     // "CENG2001-1" → "CENG2001"
      return allCourses.find((c) => c.code === kod)?.department_id;
    };
    const benimBolumlerim = new Set(user?.department_ids ?? []);
    const beniIlgilendirir = (c: ConflictResult) =>
      user?.role === "ADMIN"
      || c.affected.some((a) => {
        const d = bolumOf(a.course_code ?? "");
        return d != null && benimBolumlerim.has(d);
      });

    return [...scan.hard, ...scan.warnings]
      .filter((c) => c.affected.some((a) => a.type === "weekly_entry"))
      .filter(beniIlgilendirir);
  }, [scan, allCourses, user]);

  /** Şube başına yerleşen slot toplamı (T/U/L ayrı ayrı). */
  const placedBySection = useMemo(() => {
    const m = new Map<number, Record<SessionType, number>>();
    for (const e of entries) {
      const cur = m.get(e.section.id) ?? { THEORY: 0, PRACTICE: 0, LAB: 0 };
      cur[e.session_type] += e.slot_count;
      m.set(e.section.id, cur);
    }
    return m;
  }, [entries]);

  /** Palet öğeleri: ders × şube, koda VEYA ada göre süzülür.
   *  Türkçe küçültme: "İSTATİSTİK".toLowerCase() yanlış sonuç verir, locale şart.
   *  Sıralama: önce yerleşimi EKSİK olanlar (yapılacak iş), sonra tamamlananlar;
   *  her grup kendi içinde ders koduna, aynı derste şube numarasına göre. */
  type PaletteRow =
    | { kind: "section"; course: Course; section: CourseSection; done: boolean }
    | { kind: "empty"; course: Course };
  const paletteItems = useMemo<PaletteRow[]>(() => {
    const q = paletteSearch.trim().toLocaleLowerCase("tr");
    const tamam = (c: Course, sid: number) => {
      const p = placedBySection.get(sid) ?? { THEORY: 0, PRACTICE: 0, LAB: 0 };
      return p.THEORY >= c.hours_theory
        && p.PRACTICE >= c.hours_practice
        && p.LAB >= c.hours_lab;
    };
    // #4: Şubesi olmayan ders de listede görünür (şube satırı yerine tek bir
    // "şube yok" satırı). Sürüklenemez — yerleştirilecek şube yok; tıklanınca
    // "önce şube ekleyin" uyarısı verilir.
    const rows: PaletteRow[] = [];
    for (const c of courses) {
      if (c.sections.length === 0) {
        rows.push({ kind: "empty", course: c });
      } else {
        for (const s of c.sections) rows.push({ kind: "section", course: c, section: s, done: tamam(c, s.id) });
      }
    }
    return rows
      .filter((r) => {
        if (!q) return true;
        const hay = r.kind === "section"
          ? `${r.course.code}-${r.section.section_no} ${r.course.name}`
          : `${r.course.code} ${r.course.name}`;
        return hay.toLocaleLowerCase("tr").includes(q);
      })
      .sort((a, b) => {
        // Şubesiz ders "yapılacak iş"tir → tamamlanmamışlarla birlikte üstte.
        const aDone = a.kind === "section" ? Number(a.done) : 0;
        const bDone = b.kind === "section" ? Number(b.done) : 0;
        const aNo = a.kind === "section" ? a.section.section_no : 0;
        const bNo = b.kind === "section" ? b.section.section_no : 0;
        return aDone - bDone || a.course.code.localeCompare(b.course.code, "tr") || aNo - bNo;
      });
  }, [courses, paletteSearch, placedBySection]);

  const DAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"];

  return (
    <Stack gap="lg">
      {/* Tek yatay araç çubuğu — Sınav Takvimi ile aynı düzen: solda başlık,
          ortada mercek + süzgeçler, sağda yayınlama. Tüm kontroller aynı
          yükseklikte (CONTROL_H). */}
      <Paper radius="md" px="md" py={10}
        style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          {/* Mercek seçici BAŞLIKLA BİRLİKTE solda sabitlenir. Ortadaki
              süzgeç grubunda dururken, mercek değişince süzgeçlerin toplam
              genişliği de değiştiği için (3 kutu ↔ 1 kutu) grup yeniden
              ortalanıyor ve sekmeler yana kayıyordu — kullanıcı tam da
              tıkladığı düğmenin yer değiştirdiğini görüyordu. */}
          <Group gap="md" align="center" wrap="nowrap">
            <Title order={2} fw={600} fz={18} style={{ letterSpacing: "-0.01em" }}>
              Haftalık Program
            </Title>
            <SegmentedControl size="xs" radius="md" value={view}
              onChange={(v) => setView(v as ViewMode)}
              styles={{ root: { height: CONTROL_H }, label: { paddingBlock: 4 } }}
              data={(Object.keys(VIEW_LABELS) as ViewMode[]).map((k) => ({
                value: k, label: VIEW_LABELS[k] }))} />
          </Group>

          {/* Sabit genişlik: mercek değişince süzgeç sayısı değişiyor, alan
              sabit kalmazsa çubuğun tamamı her geçişte yeniden diziliyor. */}
          <Group gap={8} align="center" wrap="wrap" justify="center"
            style={{ minWidth: 424 }}>
            {view === "cohort" && (
              <>
                <Select size="xs" w={200} radius="md" value={dep} onChange={setDep}
                  styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                  data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
                <Select size="xs" w={104} radius="md" value={year} onChange={(v) => v && setYear(v)}
                  styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                  data={YEARS.map((y) => ({ value: y, label: `${y}. sınıf` }))} />
                <Select size="xs" w={104} radius="md" value={sem}
                  onChange={(v) => v && setSem(v as SemesterType)}
                  styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                  data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({ value: s, label: SEMESTER_LABELS[s] }))} />
              </>
            )}
            {view === "classroom" && (
              <Select size="xs" w={280} radius="md" searchable clearable
                styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                placeholder="Derslik seç" value={roomFilter} onChange={setRoomFilter}
                data={classrooms.map((c) => ({
                  value: String(c.id), label: `${c.building.name} · ${c.room_code}` }))} />
            )}
            {view === "lecturer" && (
              <Select size="xs" w={280} radius="md" searchable clearable
                styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                placeholder="Öğretim üyesi seç" value={lecFilter} onChange={setLecFilter}
                data={lecturers.map((l) => ({ value: String(l.id), label: l.full_name }))} />
            )}
          </Group>

          <Group gap={6} align="center" wrap="nowrap">
            <ExportMenu disabled={!activeQuery()} items={[
              { label: "Excel (.xlsx)", path: exportPath("xlsx") },
              { label: "CSV (.csv)", path: exportPath("csv") },
            ]} />
            {canWrite && (
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
      {view !== "cohort" && !activeQuery() && (
        <Text size="sm" c="dimmed">
          {view === "classroom" ? "Doluluğunu görmek için bir derslik seçin."
            : "Haftalık yükünü görmek için bir öğretim üyesi seçin."}
        </Text>
      )}

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {/* Palet yalnız cohort bakışında: diğer mercekler salt-okunur.
            Panel zemini hafif gri: takvim beyaz, panel de beyaz olunca ikisi
            tek bir yüzeye yapışıyor ve gözün dinlendiği bir sınır kalmıyordu. */}
        {view === "cohort" && (
        <Paper p="sm" radius="md" w={SIDE_W}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: gridH, background: SIDEBAR_BG,
                   border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
          {/* variant="unstyled" kutuyu zeminle aynı renge çeviriyordu: tıklanabilir
              bir alan olduğu hiç belli olmuyordu. Artık beyaz zemin + kenarlık. */}
          <TextInput size="xs" mb={10} radius="md" value={paletteSearch}
            onChange={(ev) => setPaletteSearch(ev.currentTarget.value)}
            styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H,
                               borderColor: BORDER, background: "#FFFFFF" } }}
            placeholder="Ders ara" />
          {!canWrite && <Text size="10px" c="dimmed" mb={6}>Yazma yetkiniz yok</Text>}
          {/* minHeight:0 olmadan flex çocuğu küçülmez ve kaydırma çalışmaz */}
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">Bu sınıfta ders yok.</Text>}
            {courses.length > 0 && paletteItems.length === 0 && (
              <Text size="xs" c="dimmed">Eşleşen ders yok.</Text>
            )}
            {paletteItems.map((r) => r.kind === "empty" ? (
              // Şubesiz ders: sürüklenemez, tıklanınca "şube ekleyin" uyarısı.
              <Paper key={`empty-${r.course.id}`} p="xs" radius="sm"
                onClick={() => notifications.show({
                  color: "yellow", title: `${r.course.code} — şube yok`,
                  message: "Programa eklemek için önce Dersler sekmesinden bu derse şube ekleyin.",
                })}
                style={{ ...paletteItemStyle(false), cursor: "pointer", flexShrink: 0, opacity: 0.7 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text fz={12} fw={600} style={{ color: "#0F172A" }}>{r.course.code}</Text>
                  <Badge size="xs" variant="light" color="yellow" radius="sm"
                    style={{ textTransform: "none", paddingInline: 5, marginLeft: "auto" }}>
                    şube yok
                  </Badge>
                </Group>
                <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{r.course.name}</Text>
              </Paper>
            ) : (
              <Paper key={r.section.id} p="xs" radius="sm"
                draggable={canWrite}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "copy";
                  ev.dataTransfer.setData("text/plain", String(r.section.id));
                  setDrag({ kind: "new", sectionId: r.section.id, label: `${r.course.code}-${r.section.section_no}` });
                }}
                onDragEnd={() => setDrag(null)}
                // Üzerine gelince gridde bu şubenin kartları vurgulanır: dersin
                // haftada NEREYE düştüğü listeden ayrılmadan görülür.
                onMouseEnter={() => setHoverSection(r.section.id)}
                onMouseLeave={() => setHoverSection(null)}
                style={{ ...paletteItemStyle(hoverSection === r.section.id),
                         cursor: canWrite ? "grab" : "default", flexShrink: 0 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text fz={12} fw={600}
                    style={{ color: r.done ? TEXT_MUTED : "#0F172A" }}>
                    {r.course.code}-{r.section.section_no}
                  </Text>
                  {r.course.is_elective && (
                    <Badge size="xs" variant="default" radius="sm"
                      style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                               color: TEXT_MUTED, borderColor: BORDER }}>
                      Seçmeli
                    </Badge>
                  )}
                  {/* T+U+L yerleşimi tamamlanmış şube yeşil onayla işaretlenir. */}
                  {r.done && (
                    <IconCheck size={13} stroke={2.4} color="#16A34A"
                      style={{ marginLeft: "auto", flexShrink: 0 }} />
                  )}
                </Group>
                <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{r.course.name}</Text>
              </Paper>
            ))}
          </Stack>
          </ScrollArea>
        </Paper>
        )}

        {view !== "cohort" && (
          <InfoPanel view={view} height={gridH}
            room={classrooms.find((c) => String(c.id) === roomFilter) ?? null}
            lecturer={lecturers.find((l) => String(l.id) === lecFilter) ?? null}
            entries={entries} courses={allCourses} departments={departments} />
        )}

        <Paper ref={gridRef} p="md" radius="md"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   background: "#FFFFFF", border: "1px solid #E2E8F0",
                   boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)" }}>
          {loading ? (
            <Group justify="center" p="xl"><Loader size="sm" /></Group>
          ) : (
            <div style={{ display: "flex", minWidth: 520 }}>
              {/* Zaman cetveli: slot başlangıçları + pencerenin KAPANIŞI (17:30).
                  Son etiket olmadan cetvel 16:30'da bitiyor ve son dersin nerede
                  bittiği okunmuyordu (brief §3.4 penceresi 08:30-17:30). */}
              <div style={{ width: 52, flexShrink: 0, position: "relative", height: HEAD_H + ROW_H * 9 }}>
                {SLOTS.map((s) => (
                  <div key={s} style={{
                    position: "absolute", top: HEAD_H + (s - 1) * ROW_H - 6, right: 10,
                    fontSize: 10, color: TIME_COLOR, fontVariantNumeric: "tabular-nums",
                  }}>{SLOT_START[s]}</div>
                ))}
                <div style={{
                  position: "absolute", top: HEAD_H + ROW_H * 9 - 6, right: 10,
                  fontSize: 10, color: TIME_COLOR, fontVariantNumeric: "tabular-nums",
                }}>17:30</div>
              </div>
              {DAYS.map((d, dayIndex) => {
                const dayClusters = byDay.get(d)!;
                const minDayWidth = dayWidth(dayClusters);
                return (
                // Günler dikey çizgiyle ayrılır; sonuncuya sağ çizgi de eklenir
                // ki tablo kapansın.
                <div key={d} style={{
                  // Şeritler okunabilir minimum genişliği korur; geniş ekranda
                  // ise günler eşit büyüyerek takvimin tüm alanı doldurur.
                  flex: `1 0 ${minDayWidth}px`, minWidth: minDayWidth,
                  // Gün ayracı yatay slot çizgilerinden KOYU: sütun sınırı
                  // takvimin en temel okuma sınırı.
                  borderLeft: `1px solid ${DAY_LINE}`,
                  borderRight: dayIndex === DAYS.length - 1 ? `1px solid ${DAY_LINE}` : undefined,
                }}>
                  <div style={{
                    height: HEAD_H, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
                    textTransform: "uppercase", color: TEXT_MUTED,
                    background: HEADER_BG, borderTop: `1px solid ${LINE}`,
                  }}>{DAY_SHORT[d]}</div>
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
                    // Boş slota tıklama = elle ders ekleme (sürüklemenin klavye/
                    // fare dostu alternatifi). Kart üstüne tıklama buraya gelmez;
                    // kartlar kendi onClick'inde olayı durduruyor.
                    onClick={(ev) => {
                      if (!canWrite) return;
                      const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                      setPlacing({ day: d, slot: Math.min(9, Math.max(1, Math.floor(y / ROW_H) + 1)) });
                    }}
                    onMouseMove={(ev) => {
                      if (!canWrite || drag) return;
                      /* İmleç bir KARTIN üzerindeyse işaret gösterme (orada
                         tıklamak düzenlemeyi açar). Slot aralığına bakmak
                         YETMEZ: yan yana şeritlerde bir kart sütunun yalnız
                         bir bölümünü kaplar, kalan boşluğa paralel şube
                         eklenebilir. Aralığa bakan eski kontrol o boşlukları
                         "dolu" sayıp artıyı hiç göstermiyordu.
                         Arka plan hücreleri pointer-events:none olduğu için
                         hedef ya kartın kendisidir ya da bu kapsayıcı. */
                      if (ev.target !== ev.currentTarget) { setHoverCell(null); return; }
                      const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                      const slot = Math.min(9, Math.max(1, Math.floor(y / ROW_H) + 1));
                      setHoverCell(`${d}-${slot}`);
                    }}
                    onMouseLeave={() => setHoverCell(null)}
                    style={{
                      position: "relative", height: ROW_H * 9,
                      // Kapanış çizgisi: 17:30 etiketi buraya hizalanır
                      borderBottom: `1px solid ${LINE}`,
                    }}
                  >
                    {SLOTS.map((s) => (
                      <div key={s} style={{
                        position: "absolute", top: (s - 1) * ROW_H, left: 0, right: 0, height: ROW_H,
                        borderTop: `1px solid ${LINE}`,
                        background: over === `${d}-${s}` ? "var(--mantine-color-blue-0)"
                          // İmleç boş slottayken bir tık daha koyu + ortada artı.
                          : hoverCell === `${d}-${s}` ? HOVER_CELL_BG : GRID_CELL_BG,
                        pointerEvents: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 120ms ease",
                      }}>
                        {hoverCell === `${d}-${s}` && over == null && (
                          <IconPlus size={18} color={TIME_COLOR} />
                        )}
                      </div>
                    ))}
                    {dayClusters.map((c) => (
                      <ClusterCard key={c.id} c={c} canWrite={canWrite} view={view}
                        elective={electiveOf.get(c.entries[0].section.course.id) ?? false}
                        highlight={hoverSection != null && c.entries.some((x) => x.section.id === hoverSection)}
                        deepHighlight={deepHighlightIds.some((id) => c.entries.some((x) => x.id === id))}
                        hard={c.entries.some((e) => hardIds.has(e.id))}
                        warn={c.entries.some((e) => warnIds.has(e.id))}
                        lecturerName={lecturerBySection.get(c.entries[0].section.id)}
                        onWarningClick={() => {
                          // Bu kartın girişlerini işaretle; aşağıda yalnız bu
                          // girişleri etkileyen çakışma satırları yanacak.
                          setBlinkingEntryIds(c.entries.map((e) => e.id));
                          conflictsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        onDragStart={(e) => setDrag({ kind: "move", entry: e })}
                        onDragEnd={() => setDrag(null)}
                        onEdit={setEditing}
                        onDelete={deleteEntry}
                        onRevert={revertEntry}
                        onOpenGroup={() => setGroup(c)} />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </Paper>
      </Group>

      <Group gap="md" style={{ fontSize: 11, color: "#64748B" }}>
        <Legend label="Yayınlanmış" color="#2563EB" />
        <Legend label="Taslak" color="#94A3B8" />
        <Legend label="Uyarı" color="#F59E0B" />
        <Legend label="Çakışma" color="#EF4444" />
        <Legend label="Online" color="#64748B" />
      </Group>

      <Paper ref={conflictsRef} p="md" radius="md"
        style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
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
        <Group justify="space-between" mb={weeklyConflicts.length ? "sm" : 0}>
          <Text fw={500} size="sm">Çakışmalar</Text>
          <Group gap={6}>
            <Badge size="sm" color="red" variant="light">
              {weeklyConflicts.filter((c) => c.severity === "HARD").length} engel
            </Badge>
            <Badge size="sm" color="orange" variant="light">
              {weeklyConflicts.filter((c) => c.severity === "WARNING").length} uyarı
            </Badge>
          </Group>
        </Group>
        {weeklyConflicts.length === 0 ? (
          <Text size="sm" c="dimmed">Haftalık programda çakışma yok.</Text>
        ) : (
          <Stack gap={8}>
            {weeklyConflicts.map((c, i) => {
              const isBlinking = blinkingEntryIds != null
                && c.affected.some((a) => a.type === "weekly_entry" && blinkingEntryIds.includes(a.id));
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
                      ? isHard ? "#FEF2F2" : "#FFFBEB"
                      : undefined,
                  }}>
                  <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0, flex: 1 }}>
                    <Badge size="sm" variant="light" style={{ flexShrink: 0 }}
                      color={c.severity === "HARD" ? "red" : "orange"}>
                      {c.severity === "HARD" ? "ENGEL" : "UYARI"}
                    </Badge>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 28 }}>{c.rule_id}</Text>
                    {/* Mesajı UI kurmuyor, motor kuruyor (kontrat §0) */}
                    <Text size="sm" fw={isBlinking ? 700 : 400}>{c.message}</Text>
                  </Group>
                  {/* Etkilenen tarafların HEPSİ düğme olur. Haftalık ders bu
                      sayfada highlight'lanır; X kuralında karşı taraf SINAV
                      olduğundan o düğme sınav takvimine yönlendirir (o kayıt bu
                      sayfada yok). Renk nereye gittiğini belli eder: mavi =
                      haftalık ders (burada), mor = sınav (sınavlar sayfası). */}
                  {c.affected.length > 0 && (
                    <Group gap={6} wrap="wrap" justify="flex-end" style={{ flexShrink: 0, maxWidth: "38%" }}>
                      {c.affected.map((a, idx) => (
                        <Button key={idx} size="compact-xs" variant="light"
                          color={a.type === "weekly_entry" ? "blue" : "violet"}
                          onClick={() => {
                            if (a.type === "weekly_entry") {
                              setSearchParams({ highlight: String(a.id), rule: c.rule_id });
                            } else {
                              navigate(`/exams?highlight=${a.id}&rule=${c.rule_id}`);
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

      {placing && (
        <EntryModal
          title={placing.drag?.kind === "new"
            ? `${placing.drag.label} → ${DAY_SHORT[placing.day]} ${SLOT_START[placing.slot]}`
            : `Ders ekle · ${DAY_SHORT[placing.day]} ${SLOT_START[placing.slot]}`}
          classrooms={classrooms} startSlot={placing.slot}
          onlineBySection={onlineBySection}
          // Sürükleyerek gelindiyse ders bellidir (id modala verilir ki online
          // bileşenini bilsin); boş slota tıklanarak gelindiyse modal dersi sorar.
          fixedSectionId={placing.drag?.kind === "new" ? placing.drag.sectionId : undefined}
          sections={placing.drag?.kind === "new" ? undefined
            : paletteItems.flatMap((r) => r.kind === "section"
              ? [{ value: String(r.section.id), label: `${r.course.code}-${r.section.section_no} — ${r.course.name}` }]
              : [])}
          onClose={() => setPlacing(null)}
          onSubmit={(body) => api.post<{ conflicts: ConflictResult[] }>("/weekly-entries", {
            section_id: placing.drag?.kind === "new" ? placing.drag.sectionId : body.section_id,
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
          onlineBySection={onlineBySection}
          fixedSectionId={editing.section.id}
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

/** Sol paneldeki tek bilgi satırı (etiket · değer). */
function Satir({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">{k}</Text>
      <Text size="xs" fw={500} style={{ textAlign: "right" }}>{v}</Text>
    </Group>
  );
}

/** Derslik / öğretim üyesi merceklerinin sol paneli.
 *
 *  Sınıf bakışında sol panel PALETTİR (sürüklenecek dersler). Diğer iki bakış
 *  salt-okunur olduğu için orada palet anlamsız — yerine seçilenin kimliğini ve
 *  haftalık kullanımını koyuyoruz, böylece sol sütun boş kalmıyor ve grid'in
 *  cevaplayamadığı sorular ("kapasite ne?", "kaç ders veriyor?") burada duruyor. */
function InfoPanel({ view, room, lecturer, entries, courses, departments, height }: {
  view: ViewMode;
  room: Classroom | null;
  lecturer: Lecturer | null;
  entries: WeeklyEntry[];
  courses: Course[];
  departments: Department[];
  height?: number;
}) {
  // Haftalık kullanım: her mercekte aynı hesap (kaç giriş, kaç gün, kaç slot).
  const slotToplam = entries.reduce((t, e) => t + e.slot_count, 0);
  const gunSayisi = new Set(entries.map((e) => e.day_of_week)).size;
  const doluluk = Math.round((slotToplam / (9 * 5)) * 100);

  // Hocanın dersleri: şubelerinden geriye yürüyerek ders ve bölüm çıkarılır.
  const hocaOzet = useMemo(() => {
    if (!lecturer) return null;
    const dersler = courses.filter((c) =>
      c.sections.some((s) => s.lecturer.id === lecturer.id));
    const subeSayisi = dersler.reduce(
      (t, c) => t + c.sections.filter((s) => s.lecturer.id === lecturer.id).length, 0);
    const bolumler = [...new Set(dersler.map((c) => c.department_id))]
      .map((id) => departments.find((d) => d.id === id)?.code)
      .filter(Boolean) as string[];
    return { dersler, subeSayisi, bolumler };
  }, [lecturer, courses, departments]);

  const secili = view === "classroom" ? room : lecturer;

  return (
    // Cohort görünümündeki ders paneliyle BİREBİR aynı kabuk: aynı genişlik
    // (SIDE_W), aynı köşe (md), aynı gri zemin, aynı çerçeve + gölge. Önceden
    // farklıydı (w=200, radius lg, gray-0, çerçevesiz) ve mercek değişince sol
    // sütun görünüş değiştiriyordu.
    <Paper p="sm" radius="md" w={SIDE_W}
      style={{ flexShrink: 0, display: "flex", flexDirection: "column",
               height, background: SIDEBAR_BG,
               border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
      {!secili ? (
        <Text size="xs" c="dimmed">
          {view === "classroom" ? "Bir derslik seçin." : "Bir öğretim üyesi seçin."}
        </Text>
      ) : (
        <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
          <Stack gap="md">
            {view === "classroom" && room && (
              <>
                <div>
                  <Text size="xs" c="dimmed">{room.building.name}</Text>
                  <Text size="lg" fw={500}>{room.room_code}</Text>
                </div>
                <Stack gap={6}>
                  <Satir k="Tür" v={ROOM_TYPE_LABELS[room.room_type]} />
                  <Satir k="Kapasite" v={`${room.capacity} kişi`} />
                  <Satir k="Sınav kontenjanı"
                    v={room.exam_capacity != null ? `${room.exam_capacity} kişi` : "girilmemiş"} />
                  {!room.active && <Badge size="xs" color="gray">pasif</Badge>}
                </Stack>
              </>
            )}

            {view === "lecturer" && lecturer && hocaOzet && (
              <>
                <div>
                  <Text size="sm" fw={500} style={{ lineHeight: 1.3 }}>{lecturer.full_name}</Text>
                  <Group gap={4} mt={4}>
                    {lecturer.is_external && (
                      <Badge size="xs" variant="light" color="grape">fakülte dışı</Badge>
                    )}
                    {!lecturer.active && <Badge size="xs" color="gray">pasif</Badge>}
                  </Group>
                </div>
                <Stack gap={6}>
                  <Satir k="Bölüm"
                    v={hocaOzet.bolumler.length ? hocaOzet.bolumler.join(", ") : "—"} />
                  <Satir k="Ders" v={hocaOzet.dersler.length} />
                  <Satir k="Şube" v={hocaOzet.subeSayisi} />
                </Stack>
                {hocaOzet.dersler.length > 0 && (
                  <div>
                    <Text size="xs" c="dimmed" mb={6}>Verdiği dersler</Text>
                    <Stack gap={6}>
                      {/* Paletteki ders satırıyla aynı çerçeveli kart standardı
                          (paletteItemStyle) — tıklanamaz olduğu için hover yok. */}
                      {hocaOzet.dersler.map((c) => (
                        <div key={c.id} style={paletteItemStyle(false)}>
                          <Text fz={12} fw={600} style={{ color: "#0F172A" }}>{c.code}</Text>
                          <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{c.name}</Text>
                        </div>
                      ))}
                    </Stack>
                  </div>
                )}
              </>
            )}

            <div>
              <Text size="xs" c="dimmed" mb={6}>Bu hafta</Text>
              <Stack gap={6}>
                <Satir k="Yerleşim" v={entries.length} />
                <Satir k="Gün" v={`${gunSayisi} / 5`} />
                <Satir k="Ders saati" v={`${slotToplam} slot`} />
                {view === "classroom" && <Satir k="Doluluk" v={`%${doluluk}`} />}
              </Stack>
            </div>
          </Stack>
        </ScrollArea>
      )}
    </Paper>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={5} wrap="nowrap">
      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color }} />
      <span>{label}</span>
    </Group>
  );
}

function ClusterCard({ c, elective, hard, warn, lecturerName, canWrite, view, highlight, deepHighlight, onWarningClick, onDragStart, onDragEnd, onEdit, onDelete, onRevert, onOpenGroup }: {
  c: Cluster; elective: boolean; hard: boolean; warn: boolean; canWrite: boolean;
  lecturerName?: string; onWarningClick?: () => void;
  view: ViewMode; highlight: boolean; deepHighlight?: boolean;
  onDragStart: (e: WeeklyEntry) => void; onDragEnd: () => void;
  onEdit: (e: WeeklyEntry) => void; onDelete: (e: WeeklyEntry) => void;
  onRevert: (e: WeeklyEntry) => void; onOpenGroup: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (deepHighlight && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [deepHighlight]);

  const many = c.entries.length > 1;
  const e = c.entries[0];
  const online = e.delivery_mode !== "FACE_TO_FACE";
  // Kümede karışık durum olabilir; taslak durumu en az bir taslak varsa görünür.
  const draft = c.entries.some((x) => x.status === "DRAFT");
  const editable = canWrite && !many && e.status === "DRAFT";
  const revertable = canWrite && !many && e.status === "SUBMITTED";

  // Renk yalnızca sol vurgu çizgisinde kullanılır. Böylece yoğun bir takvimde
  // metin hiyerarşisi, durum renginden önce gelir.
  const accent = hard ? ACCENT.hard : warn ? ACCENT.warn : draft ? ACCENT.draft : ACCENT.normal;

  /* DİKKAT — `border` kısayolu ile `borderLeft` uzun formu aynı stil nesnesinde
     BİRLİKTE KULLANILAMAZ. React yeniden render'da yalnız değeri değişen
     özelliği yazar; hover'da `border` güncellenince dört kenar birden sıfırlanır
     ama `borderLeft` (değeri aynı kaldığı için) tekrar uygulanmaz ve durum
     vurgusu sessizce kaybolur. Bu yüzden dört kenar da uzun formda. */
  const style: React.CSSProperties = {
    background: "#FFFFFF",
    color: "#0F172A",
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
    borderTopStyle: draft ? "dashed" : "solid",
    borderRightStyle: draft ? "dashed" : "solid",
    borderBottomStyle: draft ? "dashed" : "solid",
    borderLeftStyle: "solid",
    borderTopColor: hover ? BORDER_HOVER : BORDER,
    borderRightColor: hover ? BORDER_HOVER : BORDER,
    borderBottomColor: hover ? BORDER_HOVER : BORDER,
    borderLeftColor: accent,
  };

  const widthPct = 100 / c.lanes;
  // Toplu kartta tek derslik yazılamaz; kaç farklı derslik kullanıldığını söyler.
  const rooms = new Set(c.entries.map((x) => x.classroom?.room_code).filter(Boolean));
  // Alt satır MERCEĞE göre değişir: derslik bakışında oda zaten filtreyle sabit,
  // tekrarlamak yerine şube numarasını yazmak bilgi taşır.
  const altSatir = many
    ? `${c.entries.length} şube${rooms.size > 1 ? ` · ${rooms.size} derslik` : rooms.size === 1 ? ` · ${[...rooms][0]}` : ""}`
    : view === "classroom"
    ? `Şube ${e.section.section_no}`
    : `${online ? "online" : e.classroom?.room_code ?? "—"}`;

  const canDrag = canWrite && !many;
  const showLecturer = !many && c.slot_count > 1 && lecturerName;

  return (
    <div
      ref={cardRef}
      draggable={canDrag}
      onDragStart={(ev) => {
        if (!editable) {
          ev.preventDefault();
          if (revertable) {
            notifications.show({
              color: "orange",
              title: "Kilitli Giriş",
              message: "Yayınlanmış girişler taşınamaz. Önce kilit butonundan taslağa çevirin.",
            });
          }
          return;
        }
        ev.dataTransfer.effectAllowed = "move";
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      // stopPropagation: yoksa tıklama gün sütununa köpürüp "boş slota ekle"
      // modalını da açardı.
      onClick={(ev) => {
        ev.stopPropagation();
        if (many) {
          onOpenGroup();
        } else if (editable) {
          onEdit(e);
        } else if (revertable) {
          notifications.show({
            color: "orange",
            title: "Kilitli Giriş",
            message: "Yayınlanmış girişler kilitlidir. Düzenlemek için önce kilit butonundan taslağa çevirin.",
          });
        }
      }}
      title={many
        ? `${c.entries.length} paralel şube — listelemek için tıkla`
        : editable
        ? "Düzenlemek için tıkla, taşımak için sürükle"
        : revertable
        ? `${e.section.course.code} · Yayınlanmış (kilitli) — düzenlemek veya taşımak için önce taslağa çevirin`
        : undefined}
      style={{
        position: "absolute", top: (c.start_slot - 1) * ROW_H + 1, height: c.slot_count * ROW_H - 2,
        left: `calc(${c.lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
        borderRadius: CARD_RADIUS, padding: CARD_PADDING, lineHeight: 1.25, overflow: "hidden",
        cursor: many ? "pointer" : editable ? "grab" : revertable ? "not-allowed" : "default", ...style,
        transition: "box-shadow 130ms ease, border-color 130ms ease",
        /* Paletten gezinme vurgusu artık BÜYÜTMEYLE değil, mavi kontur +
           yükseltilmiş gölgeyle veriliyor: scale(1.04) kartı ızgara hizasından
           kaydırıyor ve komşu kartların üstüne taşırıyordu. */
        boxShadow: highlight || deepHighlight ? SHADOW_SELECTED
          : hover ? SHADOW_HOVER
          : hard ? `${SHADOW}, 0 0 0 1px rgba(239, 68, 68, 0.10)`
          : SHADOW,
        ...(highlight || deepHighlight
          ? { outline: `2px solid ${ACCENT.normal}`, outlineOffset: -1, zIndex: 5 }
          : null),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <Group gap={4} justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em", minWidth: 0 }}>
          {e.section.course.code}{many ? "" : `-${e.section.section_no}`}
        </div>
        {many && (
          <Badge size="xs" variant="filled" color="gray" style={{ flexShrink: 0 }}>
            {c.entries.length}
          </Badge>
        )}
        {/* Menü yerine DOĞRUDAN eylem: karttaki tek anlamlı işlem duruma göre
            zaten tek — taslakta sil, yayınlanmışta taslağa çevir. Yalnız
            üzerine gelince görünür; düzenleme karta tıklayarak yapılır. */}
        {hover && editable && (
          <ActionIcon size="sm" variant="subtle" color="red" aria-label="Girişi sil"
            title="Sil" style={{ flexShrink: 0 }}
            onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}>
            <IconTrash size={15} />
          </ActionIcon>
        )}
        {hover && revertable && (
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Taslağa çevir"
            title="Taslağa çevir" style={{ flexShrink: 0 }}
            onClick={(ev) => { ev.stopPropagation(); onRevert(e); }}>
            <IconArrowBackUp size={15} />
          </ActionIcon>
        )}
      </Group>
      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4 }}>
        {e.section.course.name}
      </div>
      <Group gap={4} wrap="nowrap" mt={5} style={{ color: "#64748B", minWidth: 0 }}>
        {online ? <IconWorld size={14} stroke={1.8} /> : <IconMapPin size={14} stroke={1.8} />}
        <Text size="xs" c="dimmed" truncate>{online ? "Online" : altSatir}</Text>
      </Group>
      {showLecturer && <Text size="xs" c="dimmed" truncate mt={3}>{lecturerName}</Text>}
      {(elective || draft) && c.slot_count > 1 && (
        <Group gap={4} mt={5}>
          {elective && <Badge size="xs" variant="light" color="gray">SEÇMELİ</Badge>}
          {draft && <Badge size="xs" variant="outline" color="gray">TASLAK</Badge>}
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
            cursor: "pointer", padding: 2, borderRadius: 4, background: "rgba(255, 255, 255, 0.8)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "transform 150ms ease",
            zIndex: 10,
          }}
          onMouseEnter={(ev) => (ev.currentTarget.style.transform = "scale(1.25)")}
          onMouseLeave={(ev) => (ev.currentTarget.style.transform = "scale(1)")}>
          {hard ? <IconAlertCircle size={15} /> : <IconAlertTriangle size={15} />}
        </span>
      )}
      {many && <Text size="xs" c="dimmed" mt={3}>{c.entries.length} paralel şube</Text>}
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
  /** Yalnız boş slota tıklayarak eklemede dolu: ders modalın içinde seçilir. */
  section_id?: number;
};

/** Yerleştirme ve düzenleme aynı alanları sorar — tek bileşen iki işi görür. */
function EntryModal({ title, classrooms, startSlot, initial, sections, fixedSectionId, onlineBySection, onClose, onSubmit, onDone }: {
  title: string;
  classrooms: Classroom[];
  startSlot: number;
  initial?: { classroomId: string | null; sessionType: SessionType; delivery: DeliveryMode; slotCount: number };
  /** Verilirse modal önce DERSİ sorar (boş slota tıklayarak ekleme). */
  sections?: { value: string; label: string }[];
  /** Ders zaten belliyse (sürükleme/düzenleme) online bileşenini bilmek için. */
  fixedSectionId?: number;
  /** K-45: şube id → bileşen bazında online'lık. */
  onlineBySection: Map<number, Record<SessionType, boolean>>;
  onClose: () => void;
  onSubmit: (body: EntryBody) => Promise<{ conflicts: ConflictResult[] }>;
  onDone: (conflicts: ConflictResult[]) => void;
}) {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(initial?.classroomId ?? null);
  const [sessionType, setSessionType] = useState<SessionType>(initial?.sessionType ?? "THEORY");
  const [delivery, setDelivery] = useState<DeliveryMode>(initial?.delivery ?? "FACE_TO_FACE");
  const [slotCount, setSlotCount] = useState<number>(initial?.slotCount ?? 2);
  const [busy, setBusy] = useState(false);

  const maxSlots = 9 - startSlot + 1;
  const dersEksik = sections != null && !sectionId;

  // K-45: online'lık ders bileşeninin özelliğidir, serbest seçim DEĞİL. Seçili
  // şube + oturum türüne bakılır; bileşen online ise giriş online olur ve yalnız
  // senkron/asenkron seçilir, değilse yüz yüze sabittir.
  const effSection = fixedSectionId ?? (sectionId ? Number(sectionId) : null);
  const componentOnline = effSection != null
    ? (onlineBySection.get(effSection)?.[sessionType] ?? false)
    : false;

  // delivery'yi componentOnline ile tutarlı tut: online değilken yüz yüze;
  // online olup delivery hâlâ yüz yüzeyse senkron'a çek (asenkronsa koru).
  useEffect(() => {
    setDelivery((d) =>
      componentOnline
        ? (d === "FACE_TO_FACE" ? "ONLINE_SYNC" : d)
        : "FACE_TO_FACE");
  }, [componentOnline]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await onSubmit({
        classroom_id: componentOnline ? null : classroomId ? Number(classroomId) : null,
        session_type: sessionType, delivery_mode: delivery, slot_count: slotCount,
        ...(sectionId ? { section_id: Number(sectionId) } : null),
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
        {sections && (
          <Select label="Ders / şube" value={sectionId} onChange={setSectionId}
            data={sections} searchable placeholder="Ders seç" nothingFoundMessage="Ders yok" />
        )}
        {/* Oturum türü ÖNCE: online'lık buna göre belirlenir (K-45). */}
        <Select label="Oturum türü (T/U/L)" value={sessionType} onChange={(v) => v && setSessionType(v as SessionType)}
          data={(Object.keys(SESSION_LABELS) as SessionType[]).map((k) => ({ value: k, label: SESSION_LABELS[k] }))} />
        {componentOnline ? (
          // Bileşen online: yalnız senkron/asenkron. "Online mı" ders düzeyinde
          // sabit olduğu için burada seçtirilmez.
          <Select label="Çevrimiçi türü" value={delivery} onChange={(v) => v && setDelivery(v as DeliveryMode)}
            data={[
              { value: "ONLINE_SYNC", label: DELIVERY_LABELS.ONLINE_SYNC },
              { value: "ONLINE_ASYNC", label: DELIVERY_LABELS.ONLINE_ASYNC },
            ]} />
        ) : (
          <Select label="Derslik" value={classroomId} onChange={setClassroomId}
            placeholder="Derslik seç" clearable searchable nothingFoundMessage="Derslik yok"
            data={classrooms.map((c) => ({ value: String(c.id), label: `${c.building.name} ${c.room_code}` }))} />
        )}
        <NumberInput label="Slot sayısı" value={slotCount} onChange={(v) => setSlotCount(Number(v) || 1)}
          min={1} max={maxSlots} />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} loading={busy} disabled={dersEksik}>Kaydet</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
