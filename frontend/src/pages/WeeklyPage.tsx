import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput,
  Menu, Paper, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconCheck, IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { ROOM_TYPE_LABELS, SEMESTER_LABELS } from "../api/types";
import { DAY_SHORT } from "../lib/slots";
import type {
  Classroom, ConflictResult, ConflictScan, Course, DeliveryMode, Department,
  Lecturer, SemesterType, SessionType, WeeklyEntry,
} from "../api/types";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];
const YEARS = ["1", "2", "3", "4"];
const ROW_H = 54;          // ferah satır: 46'da kartlar sıkışık duruyordu
const HEAD_H = 32;         // gün başlığı bandı
const LINE = "var(--mantine-color-gray-2)";   // yumuşak ızgara çizgisi

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
  return out;
}

export default function WeeklyPage() {
  const { user } = useAuth();

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
  // Boş slot üzerinde gezinme: "buraya tıklayıp ekleyebilirsin" işareti.
  const [hoverCell, setHoverCell] = useState<string | null>(null);   // "day-slot"
  // drag yoksa BOŞ SLOTA TIKLAMA ile açılmıştır → modal dersi de sorar.
  const [placing, setPlacing] = useState<{ day: number; slot: number; drag?: Drag } | null>(null);
  const [editing, setEditing] = useState<WeeklyEntry | null>(null);
  const [group, setGroup] = useState<Cluster | null>(null);   // toplu kart detayı
  const [submitOpen, setSubmitOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
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

  /** Aktif merceğin sunucu sorgusu (kontrat §7 üç filtreyi de sunuyor). */
  const activeQuery = (): string | null => {
    if (view === "cohort") return dep ? `department_id=${dep}&year=${year}&semester=${sem}` : null;
    if (view === "classroom") return roomFilter ? `classroom_id=${roomFilter}` : null;
    return lecFilter ? `lecturer_id=${lecFilter}` : null;
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

  /** Tüm programı temizle: bu cohort'un TASLAK girişlerini siler.
   *  Yayınlanmışlara dokunmaz — onlar için önce taslağa çevirmek gerekir (K-03),
   *  zaten sunucu da 409 ile reddederdi. */
  const tumunuTemizle = async () => {
    setClearing(true);
    let silinen = 0;
    const hatalar: string[] = [];
    for (const e of drafts) {
      try {
        await api.delete(`/weekly-entries/${e.id}`);
        silinen++;
      } catch (err) {
        hatalar.push(`${e.section.course.code}: ${err instanceof ApiError ? err.message : "silinemedi"}`);
      }
    }
    setClearing(false);
    setClearOpen(false);
    reload();
    notifications.show({
      color: hatalar.length ? "orange" : "gray",
      title: `${silinen} giriş silindi`,
      message: hatalar.length ? `${hatalar.length} tanesi silinemedi: ${hatalar[0]}` : "Taslak giriş kalmadı",
    });
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
  const paletteItems = useMemo(() => {
    const q = paletteSearch.trim().toLocaleLowerCase("tr");
    const tamam = (c: Course, sid: number) => {
      const p = placedBySection.get(sid) ?? { THEORY: 0, PRACTICE: 0, LAB: 0 };
      return p.THEORY >= c.hours_theory
        && p.PRACTICE >= c.hours_practice
        && p.LAB >= c.hours_lab;
    };
    return courses
      .flatMap((c) => c.sections.map((s) => ({
        course: c, section: s, done: tamam(c, s.id),
      })))
      .filter(({ course: c, section: s }) => {
        if (!q) return true;
        const hay = `${c.code}-${s.section_no} ${c.name}`.toLocaleLowerCase("tr");
        return hay.includes(q);
      })
      .sort((a, b) =>
        Number(a.done) - Number(b.done)
        || a.course.code.localeCompare(b.course.code, "tr")
        || a.section.section_no - b.section.section_no);
  }, [courses, paletteSearch, placedBySection]);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm" align="center">
          <Title order={2} fw={500}>Haftalık Program</Title>
          <SegmentedControl size="xs" radius="md" value={view}
            onChange={(v) => setView(v as ViewMode)}
            data={(Object.keys(VIEW_LABELS) as ViewMode[]).map((k) => ({
              value: k, label: VIEW_LABELS[k] }))} />
        </Group>

        <Group gap="xs" align="center">
          {view === "cohort" && (
            <>
              <Select size="xs" w={190} radius="md" value={dep} onChange={setDep}
                data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
              <Select size="xs" w={95} radius="md" value={year} onChange={(v) => v && setYear(v)}
                data={YEARS.map((y) => ({ value: y, label: `${y}. sınıf` }))} />
              <Select size="xs" w={100} radius="md" value={sem}
                onChange={(v) => v && setSem(v as SemesterType)}
                data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({ value: s, label: SEMESTER_LABELS[s] }))} />
            </>
          )}
          {view === "classroom" && (
            <Select size="xs" w={280} radius="md" searchable clearable
              placeholder="Derslik seç" value={roomFilter} onChange={setRoomFilter}
              data={classrooms.map((c) => ({
                value: String(c.id), label: `${c.building.name} · ${c.room_code}` }))} />
          )}
          {view === "lecturer" && (
            <Select size="xs" w={280} radius="md" searchable clearable
              placeholder="Öğretim üyesi seç" value={lecFilter} onChange={setLecFilter}
              data={lecturers.map((l) => ({ value: String(l.id), label: l.full_name }))} />
          )}
          {canWrite && (
            <Button size="xs" radius="md" disabled={drafts.length === 0}
              onClick={() => setSubmitOpen(true)}>
              Yayınla{drafts.length ? ` (${drafts.length})` : ""}
            </Button>
          )}
          {canWrite && (
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <ActionIcon variant="subtle" radius="md" aria-label="Diğer işlemler">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Temizle</Menu.Label>
                <Menu.Item color="red" leftSection={<IconTrash size={14} />}
                  disabled={drafts.length === 0}
                  onClick={() => setClearOpen(true)}>
                  Tüm haftalık programı temizle
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Group>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
      {view !== "cohort" && !activeQuery() && (
        <Text size="sm" c="dimmed">
          {view === "classroom" ? "Doluluğunu görmek için bir derslik seçin."
            : "Haftalık yükünü görmek için bir öğretim üyesi seçin."}
        </Text>
      )}

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {/* Palet yalnız cohort bakışında: diğer mercekler salt-okunur. */}
        {view === "cohort" && (
        <Paper p="md" radius="lg" w={200}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: gridH, background: "var(--mantine-color-gray-0)" }}>
          <TextInput size="xs" mb={10} radius="md" variant="filled" value={paletteSearch}
            onChange={(ev) => setPaletteSearch(ev.currentTarget.value)}
            placeholder="Ders kodu veya adı ara" />
          {!canWrite && <Text size="10px" c="dimmed" mb={6}>Yazma yetkiniz yok</Text>}
          {/* minHeight:0 olmadan flex çocuğu küçülmez ve kaydırma çalışmaz */}
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">Bu sınıfta ders yok.</Text>}
            {courses.length > 0 && paletteItems.length === 0 && (
              <Text size="xs" c="dimmed">Eşleşen ders yok.</Text>
            )}
            {paletteItems.map(({ course: c, section: s, done }) => (
              <Paper key={s.id} p={8} radius="md"
                draggable={canWrite}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "copy";
                  ev.dataTransfer.setData("text/plain", String(s.id));
                  setDrag({ kind: "new", sectionId: s.id, label: `${c.code}-${s.section_no}` });
                }}
                onDragEnd={() => setDrag(null)}
                // Üzerine gelince gridde bu şubenin kartları vurgulanır: dersin
                // haftada NEREYE düştüğü listeden ayrılmadan görülür.
                onMouseEnter={() => setHoverSection(s.id)}
                onMouseLeave={() => setHoverSection(null)}
                style={{ cursor: canWrite ? "grab" : "default", fontSize: 12, flexShrink: 0,
                         background: "var(--mantine-color-body)",
                         border: "1px solid var(--mantine-color-gray-2)",
                         // Yerleşimi tamamlanmış ders soluk: listenin altında ve
                         // "bunu yaptım" bilgisini renk tonuyla veriyor.
                         opacity: done ? 0.45 : 1 }}>
                <Group gap={4} justify="space-between" wrap="nowrap">
                  <Text size="xs" fw={500}>{c.code}-{s.section_no}</Text>
                  <Group gap={4} wrap="nowrap">
                    {c.is_elective && <Badge size="xs" variant="light" color="grape">seçmeli</Badge>}
                    {done && <IconCheck size={13} color="var(--mantine-color-teal-6)" />}
                  </Group>
                </Group>
                <Text size="10px" c="dimmed" truncate mt={2}>{c.name}</Text>
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

        <Paper ref={gridRef} p="md" radius="lg"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   border: "1px solid var(--mantine-color-gray-2)" }}>
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
                    fontSize: 11, color: "var(--mantine-color-gray-5)", fontVariantNumeric: "tabular-nums",
                  }}>{SLOT_START[s]}</div>
                ))}
                <div style={{
                  position: "absolute", top: HEAD_H + ROW_H * 9 - 6, right: 10,
                  fontSize: 11, color: "var(--mantine-color-gray-5)", fontVariantNumeric: "tabular-nums",
                }}>17:30</div>
              </div>
              {DAYS.map((d) => (
                // Günler dikey çizgiyle ayrılır; sonuncuya sağ çizgi de eklenir
                // ki tablo kapansın.
                <div key={d} style={{ flex: 1, minWidth: 104, borderLeft: `1px solid ${LINE}` }}>
                  <div style={{
                    height: HEAD_H, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
                    textTransform: "uppercase", color: "var(--mantine-color-gray-6)",
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
                      const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                      const slot = Math.min(9, Math.max(1, Math.floor(y / ROW_H) + 1));
                      // Dolu slotta işaret gösterme: orada tıklamak düzenlemeyi açar.
                      const dolu = byDay.get(d)!.some(
                        (c) => slot >= c.start_slot && slot < c.start_slot + c.slot_count);
                      setHoverCell(dolu ? null : `${d}-${slot}`);
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
                          // Boş slot işareti: hafif kararma + ortada artı.
                          : hoverCell === `${d}-${s}` ? "var(--mantine-color-gray-1)" : undefined,
                        pointerEvents: "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 120ms ease",
                      }}>
                        {hoverCell === `${d}-${s}` && over == null && (
                          <IconPlus size={18} color="var(--mantine-color-gray-5)" />
                        )}
                      </div>
                    ))}
                    {byDay.get(d)!.map((c) => (
                      <ClusterCard key={c.id} c={c} canWrite={canWrite} view={view}
                        elective={electiveOf.get(c.entries[0].section.course.id) ?? false}
                        highlight={hoverSection != null
                          && c.entries.some((x) => x.section.id === hoverSection)}
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

      <Paper p="md" radius="lg" style={{ border: "1px solid var(--mantine-color-gray-2)" }}>
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
            {weeklyConflicts.map((c, i) => (
              <Group key={`${c.rule_id}-${i}`} gap="sm" wrap="nowrap" align="flex-start">
                <Badge size="sm" variant="light" style={{ flexShrink: 0 }}
                  color={c.severity === "HARD" ? "red" : "orange"}>
                  {c.severity === "HARD" ? "ENGEL" : "UYARI"}
                </Badge>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0, width: 28 }}>{c.rule_id}</Text>
                {/* Mesajı UI kurmuyor, motor kuruyor (kontrat §0) */}
                <Text size="sm">{c.message}</Text>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>

      {placing && (
        <EntryModal
          title={placing.drag?.kind === "new"
            ? `${placing.drag.label} → ${DAY_SHORT[placing.day]} ${SLOT_START[placing.slot]}`
            : `Ders ekle · ${DAY_SHORT[placing.day]} ${SLOT_START[placing.slot]}`}
          classrooms={classrooms} startSlot={placing.slot}
          // Sürükleyerek gelindiyse ders bellidir; boş slota tıklanarak
          // gelindiyse modal dersi de sorar.
          sections={placing.drag?.kind === "new" ? undefined : paletteItems.map(({ course: c, section: s }) => ({
            value: String(s.id), label: `${c.code}-${s.section_no} — ${c.name}` }))}
          onClose={() => setPlacing(null)}
          onSubmit={(body) => api.post<{ conflicts: ConflictResult[] }>("/weekly-entries", {
            section_id: placing.drag?.kind === "new" ? placing.drag.sectionId : body.section_id,
            day_of_week: placing.day, start_slot: placing.slot, ...body,
          })}
          onDone={(conflicts) => { setPlacing(null); reload(); showConflicts(conflicts, "Giriş kaydedildi (taslak)"); }}
        />
      )}

      {clearOpen && (
        <Modal opened onClose={() => setClearOpen(false)} title="Tüm haftalık programı temizle" size="sm">
          <Stack gap="sm">
            <Alert color="red" variant="light">
              Bu sınıfın <b>{drafts.length} taslak girişi</b> kalıcı olarak silinecek.
              Bu işlem geri alınamaz.
            </Alert>
            <Text size="xs" c="dimmed">
              Yayınlanmış girişlere dokunulmaz; onları silmek için önce taslağa çevirmen gerekir.
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" onClick={() => setClearOpen(false)} disabled={clearing}>
                Vazgeç
              </Button>
              <Button color="red" onClick={tumunuTemizle} loading={clearing}>
                {drafts.length} girişi sil
              </Button>
            </Group>
          </Stack>
        </Modal>
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
    <Paper p="md" radius="lg" w={200}
      style={{ flexShrink: 0, display: "flex", flexDirection: "column",
               height, background: "var(--mantine-color-gray-0)" }}>
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
                    <Stack gap={4}>
                      {hocaOzet.dersler.map((c) => (
                        <div key={c.id}>
                          <Text size="xs" fw={500}>{c.code}</Text>
                          <Text size="10px" c="dimmed" truncate>{c.name}</Text>
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

function Legend({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <Group gap={4}>
      <span style={{ display: "inline-block", width: 20, height: 11, borderRadius: 3, border: "1px solid var(--mantine-color-default-border)", ...swatch }} />
      <span>{label}</span>
    </Group>
  );
}

function ClusterCard({ c, elective, hard, warn, canWrite, view, highlight, onDragStart, onDragEnd, onEdit, onDelete, onRevert, onOpenGroup }: {
  c: Cluster; elective: boolean; hard: boolean; warn: boolean; canWrite: boolean;
  view: ViewMode; highlight: boolean;
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
  // Alt satır MERCEĞE göre değişir: derslik bakışında oda zaten filtreyle sabit,
  // tekrarlamak yerine şube numarasını yazmak bilgi taşır.
  const altSatir = many
    ? `${c.entries.length} şube${rooms.size > 1 ? ` · ${rooms.size} derslik` : rooms.size === 1 ? ` · ${[...rooms][0]}` : ""}`
    : view === "classroom"
    ? `Şube ${e.section.section_no}`
    : `${online ? "online" : e.classroom?.room_code ?? "—"}`;

  return (
    <div
      draggable={editable}
      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; onDragStart(e); }}
      onDragEnd={onDragEnd}
      // stopPropagation: yoksa tıklama gün sütununa köpürüp "boş slota ekle"
      // modalını da açardı.
      onClick={(ev) => { ev.stopPropagation(); many ? onOpenGroup() : editable && onEdit(e); }}
      title={many
        ? `${c.entries.length} paralel şube — listelemek için tıkla`
        : editable ? "Düzenlemek için tıkla, taşımak için sürükle" : undefined}
      style={{
        position: "absolute", top: (c.start_slot - 1) * ROW_H + 1, height: c.slot_count * ROW_H - 2,
        left: `calc(${c.lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
        borderRadius: 6, padding: "2px 4px", fontSize: 11, lineHeight: 1.2, overflow: "hidden",
        cursor: many ? "pointer" : editable ? "grab" : "default", ...style,
        // Paletten gezinme vurgusu: hafif büyüme + halka. transition sayesinde
        // ani sıçrama değil, yumuşak sinyal.
        transition: "transform 120ms ease, box-shadow 120ms ease",
        ...(highlight ? {
          transform: "scale(1.04)",
          boxShadow: "0 0 0 2px var(--mantine-color-blue-5)",
          zIndex: 5,
        } : null),
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
  /** Yalnız boş slota tıklayarak eklemede dolu: ders modalın içinde seçilir. */
  section_id?: number;
};

/** Yerleştirme ve düzenleme aynı alanları sorar — tek bileşen iki işi görür. */
function EntryModal({ title, classrooms, startSlot, initial, sections, onClose, onSubmit, onDone }: {
  title: string;
  classrooms: Classroom[];
  startSlot: number;
  initial?: { classroomId: string | null; sessionType: SessionType; delivery: DeliveryMode; slotCount: number };
  /** Verilirse modal önce DERSİ sorar (boş slota tıklayarak ekleme). */
  sections?: { value: string; label: string }[];
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

  const online = delivery !== "FACE_TO_FACE";   // K-23: online girişte derslik olamaz
  const maxSlots = 9 - startSlot + 1;
  const dersEksik = sections != null && !sectionId;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await onSubmit({
        classroom_id: online ? null : classroomId ? Number(classroomId) : null,
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
          <Button onClick={submit} loading={busy} disabled={dersEksik}>Kaydet</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
