import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput,
  Paper, ScrollArea, SegmentedControl, Select, Stack, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle, IconAlertTriangle, IconArrowBackUp, IconCheck,
  IconMapPin, IconPlus, IconTrash, IconUser, IconWorld, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ExportMenu from "../components/ExportMenu";
import { DraftStatus, DraftActions, DraftNotes } from "../components/DraftBar";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import {
  courseCommonForDept, courseInCohort, lecturerLabel, } from "../api/types";
import { useDragEdgeScroll } from "../hooks/useDragEdgeScroll";
import { useUndoStack } from "../hooks/useUndoStack";
import type { UndoEntity } from "../hooks/useUndoStack";
import { turkishOptionsFilter } from "../utils/selectSearch";
import { LUNCH_SLOT } from "../utils/slots";
import { readScheduleMode, writeScheduleMode } from "../utils/scheduleMode";
import { CourseInfoButton } from "../components/CourseInfoButton";
import { ConflictList } from "../components/ConflictList";
import {
  ACCENT, BORDER, BORDER_HOVER, CARD_PADDING, CARD_RADIUS, CONTROL_H, DAY_LINE,
  GRID_CELL_BG, HEAD_H, HEADER_BG, HOVER_CELL_BG, LINE, LUNCH_CELL_BG,
  MIN_DAY_W, MIN_LANE_W,
  PAGE_SURFACE, SHADOW, SHADOW_HOVER,
  SHADOW_SELECTED, SIDEBAR_BG, SIDE_W, TEXT_MUTED, TEXT_STRONG, TIME_COL_W, TIME_COLOR,
  WEEKLY_ROW_H, paletteItemStyle,
} from "../utils/scheduleTheme";
import type {
  Classroom, ConflictResult, ConflictScan, Course, CourseHours, CourseSection, DeliveryMode, Department,
  ScheduleDraft, SemesterType, SessionType, WeeklyEntry,
} from "../api/types";
import { useT } from "../i18n";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];
/* Oturum türleri SABİT sırada. Eskiden `Object.keys(t.weekly.session)` ile
   türetiliyordu; artık sıra anlam taşıyor ("saati olan İLK bileşen") ve bir
   çeviri sözlüğündeki anahtar sırasına bağlı kalamaz. */
const SESSION_TYPES: SessionType[] = ["THEORY", "PRACTICE", "LAB"];
const YEARS = ["1", "2", "3", "4"];
/* Görsel belirteçler Sınav Takvimi ile ORTAK — utils/scheduleTheme.ts.
   İki ekranın ızgara yüksekliği de orada eşitlenir (9 × 91 = 13 × 63). */
const ROW_H = WEEKLY_ROW_H;   // tek slot: kod, ders adı ve konum rahatça okunur


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

/** Sürüklenen şey: paletten YENİ giriş mi, yoksa var olan girişin TAŞINMASI mı.
 *
 *  Palet artık ŞUBE değil DERS taşır: servis derslerinin 7-8 şubesi listeyi
 *  şişiriyor ve "hangi şubeyi sürüklüyorum" kararı, daha yeri bile seçilmeden
 *  verilmek zorunda kalıyordu. Şube, bırakma anında sorulur (tek şube varsa
 *  soru sorulmaz). */
type Drag =
  | { kind: "new"; courseId: number; label: string }
  | { kind: "move"; entry: WeeklyEntry };

// K-48: Sınıf seçicisinde "Ortak dersler" sözde-yıl değeri. Seçilince cohort
// bakışı ortak (servis) derslere döner — xlsx'teki "Common Courses" sayfasının
// karşılığı; palet + sürükle-bırak (yazılabilir) aynen çalışır.
const COMMON_YEAR = "common";

/** Bir günün girişlerini önce KÜMELERE toplar, sonra yan yana şeritlere böler.
 *
 *  `genis` (K-85): kümeleme KAPALI — paralel şubeler tek kartta toplanmaz, her
 *  giriş kendi kartını alır. Kompakt mod varsayılan çünkü servis derslerinin
 *  7-8 şubesi aynı slotta olabiliyor ve hepsini ayrı şeride açmak kartları
 *  ~11px'e düşürüp ızgarayı okunmaz ediyor; ama "hangi şube nerede" sorusunu
 *  ancak ayrı kartlar cevaplıyor. Karar kullanıcının. */
function layoutDay(entries: WeeklyEntry[], genis = false): Cluster[] {
  // 1) Aynı ders + aynı zaman + aynı oturum türü → tek küme (paralel şubeler)
  const groups = new Map<string, WeeklyEntry[]>();
  for (const e of entries) {
    // Geniş modda anahtara şube no + giriş id'si eklenir: no sıralamayı
    // (şeritler şube sırasına göre dizilsin) id ise benzersizliği verir.
    // padStart olmadan "10" < "2" diye sıralanırdı.
    const key = `${e.section.course.id}|${e.start_slot}|${e.slot_count}|${e.session_type}`
      + (genis ? `|${String(e.section.section_no).padStart(3, "0")}|${e.id}` : "");
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
  const t = useT();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const highlightParam = searchParams.get("highlight");
  const highlightIds = useMemo(() => {
    if (!highlightParam) return [];
    return highlightParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
  }, [highlightParam]);
  const ruleParam = searchParams.get("rule");

  const [departments, setDepartments] = useState<Department[]>([]);

  // Cohort seçimi localStorage'da: başka sayfaya gidip dönünce kullanıcı
  // kaldığı yerden devam etsin, her seferinde varsayılana düşmesin.
  const [dep, setDep] = useLocalStorage<string | null>({
    key: "weekly-dep", defaultValue: null, getInitialValueInEffect: false });
  const [year, setYear] = useLocalStorage({
    key: "weekly-year", defaultValue: "1", getInitialValueInEffect: false });
  const [sem, setSem] = useLocalStorage<SemesterType>({
    key: "weekly-sem", defaultValue: "SPRING", getInitialValueInEffect: false });
  /** K-85: kart yoğunluğu. "compact" paralel şubeleri tek kartta toplar
   *  (varsayılan), "expand" hepsini ayrı çizer. Cohort seçimleriyle aynı yerde
   *  saklanıyor: bu da bir GÖRÜNÜM tercihi ve her açılışta yeniden
   *  seçilmemeli. */
  const [density, setDensity] = useLocalStorage<"compact" | "expand">({
    key: "weekly-density", defaultValue: "compact", getInitialValueInEffect: false });

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
  // Palette üzerinde gezinilen DERS: gridde o dersin (tüm şubelerinin)
  // kartları vurgulanır — ders haftada nereye düşüyor, listeden ayrılmadan
  // görülsün.
  const [hoverCourse, setHoverCourse] = useState<number | null>(null);
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
  // K-59: NULL = yayındaki program (salt-okunur). Dolu = kendi özel taslağım;
  // ızgara, çakışma ve bütün yazma işlemleri o taslağın içine yönlenir.
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  /** K-80: modu (yayın mı taslak mı) ÇÖZÜLMÜŞ olan cohort'un kimliği.
   *
   *  Taslak seçimi bir sunucu turu gerektiriyor (`/schedule-drafts`), ızgara
   *  yüklemesi ise `draft` state'ine bakıyor. İkisi yarışınca ekran önce
   *  YAYINI çiziyor, cevap gelince taslağa atlıyordu — göze çarpan bir sıçrama.
   *
   *  DİKKAT — düz bir boolean YETMEZ. Yükleme efekti taslak efektinden önce
   *  tanımlı, dolayısıyla cohort değiştiği render'da bayrak hâlâ ÖNCEKİ
   *  cohort'tan kalma `true` olur ve yayın bir kez yüklenir. Cohort kimliğini
   *  saklamak bu yarışı kökten bitirir: `dep/year/sem` değişir değişmez
   *  karşılaştırma eşitsiz olur, beklemeye geçilir. */
  const [modCozulen, setModCozulen] = useState<string | null>(null);
  const cohortKey = `${dep ?? ""}/${year}/${sem}`;
  const [paletteSearch, setPaletteSearch] = useState("");
  // Ders bilgi "i" pop-up'ı: aynı anda yalnız BİRİ açık kalsın diye tek paylaşılan
  // state; başka bir "i"ye tıklanınca öncekinin `opened`'ı kendiliğinden false olur.
  const [openInfoId, setOpenInfoId] = useState<number | null>(null);
  /** K-62: cohort değişince taslağı kendiliğinden seçen efekti BİR KEZ atlatır.
   *  Çakışma vurgusuyla gelindiğinde hedef yayındadır; taslağa geçmek aranan
   *  satırı ekrandan kaçırır. */
  const taslakSecimiAtla = useRef(false);
  /** K-81: sınav sayfasındaki ile aynı kusur — Yayın Merkezi `draft_id`
   *  gönderiyor, burası okumadan siliyordu ve "bu cohortun ilk açık taslağı"
   *  tahminine düşülüyordu. Aynı cohortta iki taslak varsa yanlışı açılır. */
  const istenenTaslakId = useRef<number | null>(null);

  // Palet yüksekliği GRID'e bağlanır, kendi içeriğine değil: ders sayısı arttıkça
  // uzamasın, kaydırsın. Ölçüyoruz çünkü sabit sayı yazmak grid'in iç yapısı
  // (başlık yüksekliği, satır sayısı, Paper dolgusu) değişince sessizce bozulur.
  const gridRef = useRef<HTMLDivElement>(null);
  const conflictsRef = useRef<HTMLDivElement>(null);
  // Sürükleme sırasında imleç ekran kenarına gelince programı o yöne kaydır:
  // grid ekrana sığmasa da görünmeyen hücrelere ders bırakılabilsin.
  useDragEdgeScroll(drag !== null, gridRef);

  // Geri Al: taslak girişlere yapılan taşıma/düzenleme/ekleme/silmeyi geri alır.
  // Kalıcı (localStorage) ve çok adımlı — sayfa yenilense de yığın durur.
  // Geri al yığını TASLAK BAZLIDIR: her taslağın kendi anahtarı. Global tek yığın
  // tüm taslakların (onaylanmışlar dahil) adımlarını üst üste tutuyordu; artık bir
  // taslağın adımları yalnız o taslak açıkken görünür. Taslak yokken (yayın modu)
  // yazma zaten kapalı → sabit boş anahtar.
  const { record: recordUndo, undo: popUndo, count: undoCount, busy: undoBusy } =
    useUndoStack(draft ? `weekly-undo-${draft.id}` : "weekly-undo-none");
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

  // K-59: YAYINDAKİ programa artık kimse doğrudan yazamaz. Yazma yalnız kendi
  // taslağının içinde olur ve yetki İSTEMEZ — özel taslak kimseyi etkilemez.
  // Yetki (can_manage_weekly + bölüm üyeliği) ONAYA GÖNDERME kapısında aranır.
  //
  // Cohort bakışı şartı duruyor: derslik/hoca mercekleri farklı cohort'ların
  // derslerini bir arada gösterir, "bunu nereye yazıyorum" belirsizleşir.
  const canWrite = draft !== null
    && (draft.status === "OPEN" || draft.status === "REJECTED");

  const canSubmitDraft = canWriteIn(user, "can_manage_weekly", dep ? Number(dep) : undefined);

  /** Yazma uçlarının kökü. Taslaktayken bütün CRUD taslağın altına gider;
   *  yayın modunda yazma zaten kapalı (canWrite false). */
  const writeBase: UndoEntity = draft
    ? `schedule-drafts/${draft.id}/entries`
    : "weekly-entries";

  useEffect(() => {
    Promise.all([
      api.get<Department[]>("/departments"),
      api.get<Classroom[]>("/classrooms"),
      api.get<Course[]>("/courses"),
    ])
      .then(([d, c, co]) => {
        setDepartments(d);
        // Derslikleri bina + oda koduna göre sırala (numeric: "A2" < "A10").
        // Böylece hem derslik merceği hem yerleştirme modalı sıralı gelir.
        setClassrooms([...c].sort((a, b) =>
          a.building.name.localeCompare(b.building.name, "tr", { numeric: true })
          || a.room_code.localeCompare(b.room_code, "tr", { numeric: true })));
        setAllCourses(co);
        // Kayıtlı bölüm hâlâ geçerliyse ona dokunma; yoksa ilkine düş.
        setDep((mevcut) =>
          mevcut && d.some((x) => String(x.id) === mevcut)
            ? mevcut
            : d.length ? String(d[0].id) : null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t.weekly.notLoaded));
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
    // K-61: "Taslaklarım" sayfasından gelindiğinde cohort'un tamamı verilir —
    // yıl/dönem de ayarlanır ki mod çubuğu o cohort'un açık taslağını bulup
    // kendiliğinden seçsin. Bölümler genel-bakışından gelindiğinde bu iki
    // parametre yoktur ve seçim kullanıcıya bırakılır (eski davranış).
    const yearParam = searchParams.get("year");
    const semParam = searchParams.get("semester");
    if (yearParam) setYear(yearParam);
    if (semParam) setSem(semParam as SemesterType);
    // K-80: `mode=pub` ile gelindiyse YAYIN istenmiştir (Yayın Merkezi'ndeki
    // "Programda gör"). Bunu K-73'ün KALICI tercihine yazıyoruz — tek seferlik
    // `taslakSecimiAtla` ref'i YETMEDİ: setDep/setYear/setSem birbirini izleyen
    // render'lar üretiyor ve taslak-seçim efekti birden çok kez koşuyor; ref
    // ilk koşuda tükenince ikincisi `readScheduleMode`'dan taslak id'sini okuyup
    // ekranı taslağa düşürüyordu (bildirilen kusur). Kalıcı "pub" tercihi ise
    // efekt kaç kez koşarsa koşsun aynı cevabı verir — yarış biter.
    if (searchParams.get("mode") === "pub" && yearParam && semParam) {
      writeScheduleMode("weekly-mode", depParam, yearParam, semParam, "pub");
      setDraft(null);
    }
    // K-81: `draft_id` artık siliniyor DEĞİL, önce okunuyor.
    const draftIdParam = searchParams.get("draft_id");
    if (draftIdParam && searchParams.get("mode") !== "pub") {
      const n = Number(draftIdParam);
      if (Number.isInteger(n) && n > 0) istenenTaslakId.current = n;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("year");
    next.delete("semester");
    next.delete("draft_id");
    next.delete("mode");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight yönlendirmesi geldiğinde hedef kayıtların cohort filtrelerini otomatik ayarla
  useEffect(() => {
    if (!highlightIds.length || !allCourses.length) return;
    let cancelled = false;

    // K-62: buraya YALNIZCA ekranda olmayan satırlar gelir ve onlar tanım gereği
    // YAYINDAKİ satırlardır (taslağımın satırları çubukta zaten görünür, tıklama
    // onları yerinde vurgular). Bu yüzden yayın listesinde aranır.
    api.get<WeeklyEntry[]>("/weekly-entries")
      .then((allEntries) => {
        if (cancelled) return;
        const targets = allEntries.filter((x) => highlightIds.includes(x.id));
        if (targets.length > 0) {
          const firstTarget = targets[0];
          const fullCourse = allCourses.find((c) => c.id === firstTarget.section.course.id);
          if (fullCourse) {
            // Hedef YAYINDA olduğu için YAYIN moduna geçilir. Yoksa gidilen
            // cohort'ta açık taslağım varsa ekran ona geçer ve aranan satır
            // orada OLMADIĞI için kullanıcı boş bir ızgaraya bakar — bildirilen
            // kusur tam olarak buydu.
            taslakSecimiAtla.current = true;
            setDraft(null);
            setDep(String(fullCourse.department_id));
            setYear(String(fullCourse.year));
            setSem(fullCourse.semester);
          }
          if (ruleParam) {
            const courseCodes = Array.from(new Set(targets.map((t) => t.section.course.code))).join(" ↔ ");
            notifications.show({
              id: `highlight-${highlightIds.join("-")}`,
              color: "blue",
              title: t.weekly.highlightTitle(ruleParam),
              message: t.weekly.highlightBody(courseCodes,
                fullCourse ? t.weekly.yearN(fullCourse.year) : t.weekly.relevantCohort),
            });
          }
          setDeepHighlightIds(targets.map((t) => t.id));
          setHighlightInfo({
            rule: ruleParam ?? t.weekly.conflict,
            entries: targets,
          });
          setSearchParams({}, { replace: true });
        } else {
          notifications.show({ color: "yellow", message: t.weekly.highlightNotFound });
          setSearchParams({}, { replace: true });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [highlightIds, ruleParam, allCourses, setSearchParams]);

  /** Cohort'un sunucu sorgusu (kontrat §7). */
  const activeQuery = (): string | null => {
    if (!dep) return null;
    // K-48: "Ortak dersler" seçiliyse yıl yerine is_common ile süz.
    return year === COMMON_YEAR
      ? `department_id=${dep}&semester=${sem}&is_common=true`
      : `department_id=${dep}&year=${year}&semester=${sem}`;
  };

  /** Dönem programının resmi çizelge export'u (build_weekly_grid_xlsx). Derslik
   *  ve öğretim üyesi programları artık kendi sayfalarındaki drawer'dan aktarılır. */
  const exportPath = (format: "xlsx" | "csv"): string =>
    `/export/weekly?${activeQuery()}&format=${format}`;

  const reload = () => {
    // K-80: bu cohortun modu çözülmeden yükleme yapma — yoksa önce yayın
    // çizilir, sonra taslağa sıçranır. `loading` true kalır.
    if (modCozulen !== cohortKey) { setLoading(true); return; }
    setLoading(true);
    setError(null);
    // K-59: taslaktayken ızgara TASLAĞIN kopyasını gösterir ve çakışma tablosu
    // taslağın evreninde hesaplanır (kendi satırları + diğer cohort'ların
    // yayını). Yayın modunda eski davranış aynen sürer.
    const istek = draft
      ? Promise.all([
          api.get<WeeklyEntry[]>(`/schedule-drafts/${draft.id}/entries`),
          api.get<ConflictScan>(`/schedule-drafts/${draft.id}/conflicts`),
        ])
      : (() => {
          const qs = activeQuery();
          if (!qs) { setEntries([]); setLoading(false); return null; }
          return Promise.all([
            api.get<WeeklyEntry[]>(`/weekly-entries?${qs}`),
            api.get<ConflictScan>("/conflicts"),
          ]);
        })();
    if (!istek) return;
    istek
      .then(([e, s]) => { setEntries(e); setScan(s); })
      .catch((err) => setError(err instanceof ApiError ? err.message : t.weekly.loadFailed))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [dep, year, sem, draft?.id, draft?.status, modCozulen, cohortKey]);

  /** Taslak açma TEK yer (K-59): hem çubuktaki "Taslak Aç" düğmesi hem de
   *  ızgarada yayındaki bir karta dokunulduğunda çıkan "taslağa geçilsin mi?"
   *  sorusu buraya iner. Açılan taslak o anki yayının kopyasıdır. */
  const createDraft = async (): Promise<ScheduleDraft | null> => {
    if (!dep || year === COMMON_YEAR) return null;
    try {
      const d = await api.post<ScheduleDraft>("/schedule-drafts", {
        department_id: Number(dep), year: Number(year), semester: sem,
      });
      setDraft(d);
      writeScheduleMode("weekly-mode", dep, year, sem, d.id);   // K-73

      notifications.show({
        color: "green",
        message: t.weekly.draftOpened(d.entry_count),
      });
      return d;
    } catch (e) {
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : t.weekly.draftFailed,
      });
      return null;
    }
  };

  /** Taslak sayaçlarını (change_count) tazeler: ızgarada bir şey değiştiğinde
   *  çubuktaki "N değişiklik" yazısı da güncellenmeli. */
  const refreshDraft = () => {
    if (!draft) return;
    api.get<ScheduleDraft>(`/schedule-drafts/${draft.id}`)
      .then(setDraft)
      .catch(() => { /* taslak silinmişse çubuk zaten yayına dönecek */ });
  };

  /** Cohort değişince taslak ilişiği kesilir: CE/1/Güz taslağıyla EEE/2/Bahar
   *  ızgarasını göstermek anlamsız olurdu. Kullanıcı yeni cohortta kendi
   *  taslağını yeniden seçer/açar. */
  useEffect(() => {
    setDraft((d) => (d && (String(d.department_id) !== dep
      || String(d.year) !== year
      || d.semester !== sem) ? null : d));
  }, [dep, year, sem]);

  /** Bu cohort için AÇIK taslağım varsa çubuk onu hatırlatsın (sayfa yenilense
   *  de kaybolmasın). Yalnız kendi taslaklarım döner — sunucu başkasınınkini
   *  hiçbir koşulda listelemez (K-59). */
  useEffect(() => {
    // K-80: her çıkış yolu modu ÇÖZÜLDÜ ilan etmeli — biri unutulursa ızgara
    // sonsuza dek "yükleniyor"da kalır.
    //
    // `iptal` ŞART: bu efekt cohort her değiştiğinde yeniden koşuyor ve içinde
    // bir sunucu turu var. Yenisi eskisinden önce dönerse, ESKİ cevabın
    // `cozuldu`su kapıyı eski cohort'un anahtarıyla kapatır ve bir daha
    // açılmaz — ekran sonsuza dek "yükleniyor"da kalırdı. (Yayın Merkezi'nden
    // "Programda düzenle" ile gelindiğinde tam olarak bu oluyordu: URL
    // parametreleri dep/year/sem'i arka arkaya değiştiriyor.)
    let iptal = false;
    const cozuldu = () => { if (!iptal) setModCozulen(cohortKey); };
    if (!dep || year === COMMON_YEAR) { cozuldu(); return; }
    // K-62: çakışma vurgusuyla gelindiyse hedef YAYINDA'dır; taslağı seçmek
    // aranan satırı ekrandan kaçırır. Bayrak tek seferliktir.
    if (taslakSecimiAtla.current) {
      taslakSecimiAtla.current = false; cozuldu(); return;
    }
    // K-73: bu cohort'u en son YAYINDA bıraktıysam taslağa atlama — kullanıcı
    // bıraktığı moda dönmeli. Tercih yoksa (ilk ziyaret) eski davranış: açık
    // taslağı seç. Tercih belirli bir taslaksa onu seç.
    // K-81: URL açıkça bir taslak istediyse hatırlanan tercihin ÜSTÜNDEDİR.
    const istenen = istenenTaslakId.current;
    const pref = readScheduleMode("weekly-mode", dep, year, sem);
    if (istenen == null && pref === "pub") { cozuldu(); return; }
    api.get<ScheduleDraft[]>("/schedule-drafts")
      .then((liste) => {
        // K-62: `kind` süzgeci ZORUNLU. K-60'ta sınav taslakları eklendiğinde
        // bu arayış güncellenmemişti; aynı cohort'un SINAV taslağı haftalık
        // ekranda seçilebiliyor ve ekran "bu uç ona uygun değil" hatasına
        // düşüyordu. (Sınav ekranındaki eşi K-60'ta doğru yazılmıştı.)
        const cohortDrafts = liste.filter((d) => d.kind === "WEEKLY"
          && String(d.department_id) === dep
          && String(d.year) === year && d.semester === sem);
        const eslesen = istenen != null
          ? cohortDrafts.find((d) => d.id === istenen)
          : typeof pref === "number"
            ? cohortDrafts.find((d) => d.id === pref)
            : cohortDrafts[0];
        if (istenen != null) istenenTaslakId.current = null;
        if (!iptal && eslesen) setDraft(eslesen);
      })
      .catch(() => { /* taslak listesi alınamazsa yayın modunda kal */ })
      .finally(cozuldu);
    return () => { iptal = true; };
  }, [dep, year, sem, cohortKey]);

  const handleUndo = async () => {
    const res = await popUndo();
    if (!res) return;
    reload();
    refreshDraft();
    notifications.show({
      color: res.ok ? "gray" : "red",
      message: res.ok ? t.weekly.undone(res.label) : `${res.label} — ${res.message}`,
    });
  };

  /** Paletin dersleri: seçili cohort'un (bölüm+yıl+dönem) TÜM dersleri. K-57:
   *  ortak (servis) ders onu TÜKETEN bölümün cohort'undan da gelir (ek cohort) —
   *  yalnız ilk atandığı bölümden değil. K-48: "Ortak dersler" seçiliyse yıl
   *  yerine bölümün o dönemde aldığı ortak dersler. */
  const courses = useMemo(() => {
    const depId = Number(dep);
    return allCourses.filter((c) =>
      year === COMMON_YEAR
        ? courseCommonForDept(c, depId, sem)
        : courseInCohort(c, depId, Number(year), sem));
  }, [allCourses, dep, year, sem]);

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


  /** Ders id → T/U/L saatleri. EntryModal'ın "Oturum türü" etiketi bunu
   *  gösterir (3T/2U/0L).
   *
   *  Kaynak `courses` DEĞİL `allCourses`: `courses` seçili cohort'a göre
   *  süzülmüş liste, oysa DÜZENLEMEDE tıklanan giriş cohort filtresi dışında
   *  kalan bir derse ait olabilir (ortak/servis dersler, K-48). Süzülmüş
   *  listeden okusaydık etiket o durumda sessizce saatsiz kalırdı. */
  const hoursByCourse = useMemo(() => {
    const m = new Map<number, CourseHours>();
    for (const c of allCourses) {
      m.set(c.id, { theory: c.hours_theory, practice: c.hours_practice, lab: c.hours_lab });
    }
    return m;
  }, [allCourses]);

  const lecturerBySection = useMemo(() => {
    const names = new Map<number, string>();
    for (const course of allCourses) {
      for (const section of course.sections) names.set(section.id, lecturerLabel(section.lecturer));
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
    for (const d of DAYS) {
      m.set(d, layoutDay(entries.filter((e) => e.day_of_week === d), density === "expand"));
    }
    return m;
  }, [entries, density]);

  const showConflicts = (conflicts: ConflictResult[], baslik: string) => {
    if (!conflicts.length) {
      notifications.show({ color: "green", message: t.weekly.noConflictFor(baslik) });
      return;
    }
    const hard = conflicts.some((c) => c.severity === "HARD");
    notifications.show({
      color: hard ? "red" : "orange",
      title: baslik,
      message: t.weekly.conflictList(conflicts.length, conflicts.map((c) => c.rule_id).join(", ")),
    });
  };

  /** K-48/K-59: ders başka cohort'lar tarafından da alınıyorsa, yerini
   *  değiştirmek ONLARIN programını da değiştirir — tek fiziksel yerleşim var.
   *  Onay ekranında da görünür ama kullanıcı burada, daha karar anındayken
   *  uyarılmalı. `false` dönerse işlem yapılmaz. */
  const sharedCourseOk = (entry: WeeklyEntry, fiil: string): boolean => {
    const c = allCourses.find((x) => x.id === entry.section.course.id);
    if (!c || c.extra_cohorts.length === 0) return true;
    const bolumler = c.extra_cohorts
      .map((ec) => departments.find((d) => d.id === ec.department_id)?.code
        ?? String(ec.department_id));
    const hepsi = Array.from(new Set([
      ...(c.department_id !== Number(dep)
        ? [departments.find((d) => d.id === c.department_id)?.code ?? ""] : []),
      ...bolumler,
    ])).filter(Boolean);
    return window.confirm(
      [
        t.weekly.sharedCourseTitle(entry.section.course.code),
        "",
        t.weekly.sharedCourseBody(fiil),
        hepsi.join(", "),
        "",
        t.weekly.sharedCourseAsk,
      ].join("\n"),
    );
  };

  /** Taşıma: yalnız gün/slot değişir; derslik, tür ve süre korunur. */
  const moveEntry = async (entry: WeeklyEntry, day: number, slot: number) => {
    if (entry.day_of_week === day && entry.start_slot === slot) return;
    if (!sharedCourseOk(entry, t.weekly.verbMove)) return;
    const prevDay = entry.day_of_week, prevSlot = entry.start_slot;   // geri al için
    try {
      const res = await api.patch<{ conflicts: ConflictResult[] }>(
        `/${writeBase}/${entry.id}`, { day_of_week: day, start_slot: slot },
      );
      recordUndo({
        label: t.weekly.moveLabel(entry.section.course.code, entry.section.section_no),
        entity: writeBase,
        action: { type: "patch", id: entry.id,
          body: { day_of_week: prevDay, start_slot: prevSlot } },
      });
      reload();
      refreshDraft();
      showConflicts(res.conflicts, t.weekly.moved);
    } catch (err) {
      // Pencere taşması (400) ve donmuş taslak (409) burada görünür.
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : t.weekly.moveFailed });
    }
  };

  const onDrop = (day: number, slot: number) => {
    setOver(null);
    const d = drag;
    setDrag(null);
    if (!d || !canWrite) return;
    if (d.kind === "move") {
      void moveEntry(d.entry, day, slot);
    } else {
      setPlacing({ drag: d, day, slot });
    }
  };

  const deleteEntry = async (e: WeeklyEntry) => {
    if (!window.confirm(t.weekly.deleteConfirm(e.section.course.code, e.section.section_no))) return;
    if (!sharedCourseOk(e, t.weekly.verbRemove)) return;
    try {
      await api.delete(`/${writeBase}/${e.id}`);
      // Geri al = aynı girişi yeniden yarat (yeni id alır, remap yığında yapılır).
      recordUndo({
        label: `${e.section.course.code}-${e.section.section_no} silme`,
        entity: writeBase,
        action: { type: "create", restoreId: e.id, body: {
          section_id: e.section.id,
          classroom_id: e.classroom ? e.classroom.id : null,
          day_of_week: e.day_of_week, start_slot: e.start_slot,
          slot_count: e.slot_count, session_type: e.session_type,
          delivery_mode: e.delivery_mode,
        } },
      });
      notifications.show({ message: t.weekly.deleted, color: "gray" });
      reload();
      refreshDraft();
    } catch (err) {
      notifications.show({ color: "red", message: err instanceof ApiError ? err.message : "Silinemedi" });
    }
  };


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
    | { kind: "course"; course: Course; sections: CourseSection[]; done: boolean }
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
      const subeler = c.sections.filter((s) => s.active);
      if (subeler.length === 0) {
        rows.push({ kind: "empty", course: c });
      } else {
        // Ders "tamam" ise TÜM şubelerinin T/U/L yerleşimi bitmiştir. Şube
        // başına satır olmadığı için ilerleme ders düzeyinde özetlenir.
        rows.push({
          kind: "course", course: c, sections: subeler,
          done: subeler.every((s) => tamam(c, s.id)),
        });
      }
    }
    return rows
      .filter((r) => !q || `${r.course.code} ${r.course.name}`
        .toLocaleLowerCase("tr").includes(q))
      .sort((a, b) => {
        // Şubesiz ders "yapılacak iş"tir → tamamlanmamışlarla birlikte üstte.
        const aDone = a.kind === "course" ? Number(a.done) : 0;
        const bDone = b.kind === "course" ? Number(b.done) : 0;
        return aDone - bDone || a.course.code.localeCompare(b.course.code, "tr");
      });
  }, [courses, paletteSearch, placedBySection]);

  const DAY_NAMES = [1, 2, 3, 4, 5].map((d) => t.days.long[d]);

  return (
    <Stack gap="lg">
      {/* K-74: TEK araç çubuğu — eski ayrı "mod çubuğu" buraya gömüldü. Sol:
          başlık + cohort + durum. Sağ: Geri Al + taslak eylemleri + Dışa Aktar.
          K-76: taslakta bar RENK DEĞİŞTİRMEZ (TASLAK rozeti zaten belli ediyor). */}
      <Paper radius="md" px="md" py={10}
        style={{ background: PAGE_SURFACE, border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Group gap="md" align="center" wrap="wrap">
            <Title order={2} fw={600} fz={18} style={{ letterSpacing: "-0.01em" }}>
              {t.weekly.title}
            </Title>
            {/* Cohort seçimi: bölüm · sınıf · dönem. */}
            <Group gap={8} align="center" wrap="wrap">
              <Select size="xs" w={200} radius="md" value={dep} onChange={setDep}
                styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))} />
              <Select size="xs" w={130} radius="md" value={year} onChange={(v) => v && setYear(v)}
                styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                data={[{ value: COMMON_YEAR, label: t.weekly.commonCourses },       // K-48
                  ...YEARS.map((y) => ({ value: y, label: t.weekly.yearN(Number(y)) }))]} />
              <Select size="xs" w={104} radius="md" value={sem}
                onChange={(v) => v && setSem(v as SemesterType)}
                styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H } }}
                data={(Object.keys(t.enums.semester) as SemesterType[]).map((s) => ({ value: s, label: t.enums.semester[s] }))} />
            </Group>
            {/* K-74: durum göstergesi cohort'un SAĞINDA (cohort'u tekrar yazmaz). */}
            <DraftStatus
              departmentId={dep ? Number(dep) : null}
              year={year === COMMON_YEAR ? null : Number(year)}
              semester={sem} kind="WEEKLY" draft={draft} />
          </Group>

          <Group gap={6} align="center" wrap="wrap">
            {/* K-85: yoğunluk bir GÖRÜNÜM tercihi, bir eylem değil — bu yüzden
                eylem grubunun en solunda, Geri Al'dan önce duruyor. */}
            <Tooltip label={t.weekly.densityTip}>
              <SegmentedControl size="xs" radius="md" value={density}
                onChange={(v) => setDensity(v as "compact" | "expand")}
                styles={{ root: { height: CONTROL_H }, label: { paddingBlock: 2 } }}
                data={[
                  { value: "compact", label: t.weekly.densityCompact },
                  { value: "expand", label: t.weekly.densityExpand },
                ]} />
            </Tooltip>
            {/* K-76: Geri Al yalnız simge (yazı kaldırıldı); sayı tooltip'te. */}
            {canWrite && (
              <Tooltip label={t.weekly.undoTip(undoCount)}>
                <ActionIcon variant="default" radius="md"
                  style={{ width: CONTROL_H, height: CONTROL_H }}
                  disabled={undoCount === 0 || undoBusy} loading={undoBusy}
                  onClick={handleUndo} aria-label={t.weekly.undo}>
                  <IconArrowBackUp size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {/* K-76: taslak eylemleri; taslakta Onaya Gönder en sağda. */}
            <DraftActions
              departmentId={dep ? Number(dep) : null}
              year={year === COMMON_YEAR ? null : Number(year)}
              semester={sem} kind="WEEKLY" draft={draft} canSubmit={canSubmitDraft}
              onSelect={(d) => {
                setDraft(d);
                if (dep && year !== COMMON_YEAR) {
                  writeScheduleMode("weekly-mode", dep, year, sem, d ? d.id : "pub");
                }
              }}
              onCreate={async () => { await createDraft(); }}
              onChanged={() => { reload(); refreshDraft(); }}
            />
            {/* K-76: Dışa Aktar EN SAĞDA (yalnız yayında). */}
            {!draft && (
              <ExportMenu disabled={!activeQuery()} items={[
                { label: "Excel (.xlsx)", path: exportPath("xlsx") },
                { label: "CSV (.csv)", path: exportPath("csv") },
              ]} />
            )}
          </Group>
        </Group>
      </Paper>

      {/* K-74: PENDING/REJECTED bilgi satırı barın altında (yalnız o durumlarda). */}
      <DraftNotes draft={draft} />

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}

      <Group align="flex-start" gap="lg" wrap="nowrap">
        {/* Sol sütun: sürüklenecek derslerin paleti.
            Panel zemini hafif gri: takvim beyaz, panel de beyaz olunca ikisi
            tek bir yüzeye yapışıyor ve gözün dinlendiği bir sınır kalmıyordu. */}
        <Paper p="sm" radius="md" w={SIDE_W}
          style={{ flexShrink: 0, display: "flex", flexDirection: "column",
                   height: gridH, background: SIDEBAR_BG,
                   border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
          {/* variant="unstyled" kutuyu zeminle aynı renge çeviriyordu: tıklanabilir
              bir alan olduğu hiç belli olmuyordu. Artık beyaz zemin + kenarlık. */}
          <TextInput size="xs" mb={10} radius="md" value={paletteSearch}
            onChange={(ev) => setPaletteSearch(ev.currentTarget.value)}
            styles={{ input: { height: CONTROL_H, minHeight: CONTROL_H,
                               borderColor: BORDER, background: PAGE_SURFACE } }}
            placeholder={t.weekly.searchCourse} />
          {/* minHeight:0 olmadan flex çocuğu küçülmez ve kaydırma çalışmaz.
              K-74: offsetScrollbars kaldırıldı — ders kartları artık "Ders ara"
              kutusuyla aynı genişlikte (eskiden kaydırma payı kadar dardı). */}
          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
          <Stack gap={6}>
            {courses.length === 0 && <Text size="xs" c="dimmed">{t.weekly.noCourseInYear}</Text>}
            {courses.length > 0 && paletteItems.length === 0 && (
              <Text size="xs" c="dimmed">{t.weekly.noMatch}</Text>
            )}
            {paletteItems.map((r) => r.kind === "empty" ? (
              // Şubesiz ders: sürüklenemez, tıklanınca "şube ekleyin" uyarısı.
              <Paper key={`empty-${r.course.id}`} p="xs" radius="sm"
                onClick={() => notifications.show({
                  color: "yellow", title: t.weekly.noSectionsTitle(r.course.code),
                  message: t.weekly.noSectionsBody,
                })}
                style={{ ...paletteItemStyle(false), cursor: "pointer", flexShrink: 0, opacity: 0.7 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text fz={12} fw={600} style={{ color: TEXT_STRONG }}>{r.course.code}</Text>
                  <Group gap={4} wrap="nowrap" style={{ marginLeft: "auto", flexShrink: 0 }}>
                    <Badge size="xs" variant="light" color="yellow" radius="sm"
                      style={{ textTransform: "none", paddingInline: 5 }}>
                      {t.weekly.noSections}
                    </Badge>
                    {/* Şubesiz derste de bilgi "i"si — Paper onClick'i tetiklemesin
                        diye CourseInfoButton kendi tıklamasını durdurur. */}
                    <CourseInfoButton
                      course={r.course}
                      // K-85: pop-up'ta şube başına T/U/L ilerlemesi görünsün —
                      // paletteki tik ders düzeyinde "eksik" derken hangi şubenin
                      // neyi eksik olduğu ancak burada okunuyor.
                      placedBySection={placedBySection}
                      opened={openInfoId === r.course.id}
                      onOpenChange={(o) => setOpenInfoId(o ? r.course.id : null)}
                      onOpenCourses={() =>
                        navigate(`/courses?search=${encodeURIComponent(r.course.code)}`)}
                    />
                  </Group>
                </Group>
                <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{r.course.name}</Text>
              </Paper>
            ) : (
              <Paper key={r.course.id} p="xs" radius="sm"
                draggable={canWrite}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "copy";
                  ev.dataTransfer.setData("text/plain", String(r.course.id));
                  setDrag({ kind: "new", courseId: r.course.id, label: r.course.code });
                }}
                onDragEnd={() => setDrag(null)}
                // Üzerine gelince gridde bu DERSİN (tüm şubelerinin) kartları
                // vurgulanır: ders haftada NEREYE düşüyor, listeden ayrılmadan.
                onMouseEnter={() => setHoverCourse(r.course.id)}
                onMouseLeave={() => setHoverCourse(null)}
                style={{ ...paletteItemStyle(hoverCourse === r.course.id),
                         cursor: canWrite ? "grab" : "default", flexShrink: 0 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text fz={12} fw={600}
                    style={{ color: r.done ? TEXT_MUTED : TEXT_STRONG }}>
                    {r.course.code}
                  </Text>
                  {/* Şube sayısı bilgi olarak durur; hangisi olduğu bırakma
                      anında sorulur. Tek şubede rozet gereksiz gürültü. */}
                  {r.sections.length > 1 && (
                    <Badge size="xs" variant="default" radius="sm"
                      style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                               color: TEXT_MUTED, borderColor: BORDER }}>
                      {r.sections.length} şube
                    </Badge>
                  )}
                  {r.course.is_elective && (
                    <Badge size="xs" variant="default" radius="sm"
                      style={{ fontWeight: 500, textTransform: "none", paddingInline: 5,
                               color: TEXT_MUTED, borderColor: BORDER }}>
                      {t.weekly.elective}
                    </Badge>
                  )}
                  {/* Sağ blok: tamamlanma onayı + ders bilgisi "i" pop-up'ı. */}
                  <Group gap={4} wrap="nowrap"
                    style={{ marginLeft: "auto", flexShrink: 0 }}>
                    {/* T+U+L yerleşimi tamamlanmış şube yeşil onayla işaretlenir. */}
                    {r.done && (
                      <IconCheck size={13} stroke={2.4} color="#16A34A" />
                    )}
                    <CourseInfoButton
                      course={r.course}
                      // K-85: pop-up'ta şube başına T/U/L ilerlemesi görünsün —
                      // paletteki tik ders düzeyinde "eksik" derken hangi şubenin
                      // neyi eksik olduğu ancak burada okunuyor.
                      placedBySection={placedBySection}
                      opened={openInfoId === r.course.id}
                      onOpenChange={(o) => setOpenInfoId(o ? r.course.id : null)}
                      onOpenCourses={() =>
                        navigate(`/courses?search=${encodeURIComponent(r.course.code)}`)}
                    />
                  </Group>
                </Group>
                <Text fz={11} truncate mt={1} style={{ color: TEXT_MUTED }}>{r.course.name}</Text>
              </Paper>
            ))}
          </Stack>
          </ScrollArea>
        </Paper>

        <Paper ref={gridRef} p="md" radius="md"
          style={{ flex: 1, minWidth: 0, overflowX: "auto",
                   background: PAGE_SURFACE, border: `1px solid ${BORDER}`,
                   boxShadow: SHADOW }}>
          {loading ? (
            // Yüklenirken de grid'in TAM yüksekliğini (HEAD_H + 9 slot) rezerve
            // et: yoksa spinner kutusu kısa kalıp altındaki Çakışmalar bölümü
            // yukarı çıkıyor, grid gelince aşağı zıplıyordu (route-fade sırasında
            // bu reflow gözle görülür jank üretiyordu).
            <Group justify="center" align="center" style={{ height: HEAD_H + ROW_H * 9 }}>
              <Loader size="sm" />
            </Group>
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
                  }}>{t.days.short[d]}</div>
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
                        // Öğle arası (slot 5) zemini bir ton koyu: ders konulması
                        // ENGELLENMEZ, yalnız saatin molaya denk geldiği görünür.
                        // Hover ve sürükleme vurgusu bunun ÜSTÜNE biner, yoksa
                        // o satırda geri bildirim kaybolur ve ekleme "çalışmıyor"
                        // gibi durur.
                        background: over === `${d}-${s}` ? "var(--mantine-color-blue-light)"
                          // İmleç boş slottayken bir tık daha koyu + ortada artı.
                          : hoverCell === `${d}-${s}` ? HOVER_CELL_BG
                          : s === LUNCH_SLOT ? LUNCH_CELL_BG : GRID_CELL_BG,
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
                      <ClusterCard key={c.id} c={c} canWrite={canWrite}
                        highlight={hoverCourse != null && c.entries.some((x) => x.section.course.id === hoverCourse)}
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

      <Paper ref={conflictsRef} p="md" radius="md"
        style={{ background: PAGE_SURFACE, border: `1px solid ${BORDER}`, boxShadow: SHADOW }}>
        {/* Vurgu (blink) keyframe'leri artık ortak bileşende (K-84): satırları
            o çiziyor, stilinin de onunla birlikte gezmesi gerekiyor. */}
        <Group justify="space-between" mb={weeklyConflicts.length ? "sm" : 4}>
          <Text fw={500} size="sm">{t.weekly.conflictsTitle}</Text>
          <Group gap={6}>
            <Badge size="sm" color="red" variant="light">
              {weeklyConflicts.filter((c) => c.severity === "HARD").length} engel
            </Badge>
            <Badge size="sm" color="orange" variant="light">
              {weeklyConflicts.filter((c) => c.severity === "WARNING").length} uyarı
            </Badge>
          </Group>
        </Group>
        {/* K-84: liste artık Çakışma Raporu'yla AYNI tablo — zebra dahil.
            Kompakt sürüm: Tür ve Cohort sütunları yok (şiddet sol kenardan ve
            kural rozetinden okunuyor, cohort zaten ekranın kendisi). */}
        <ConflictList
          list={weeklyConflicts}
          emptyText={t.weekly.noConflicts}
          blinking={(c) => blinkingEntryIds != null
            && c.affected.some((a) => a.type === "weekly_entry"
              && blinkingEntryIds.includes(a.id))}
          onAffected={(c, a) => {
            if (a.type !== "weekly_entry") {
              // X kuralında karşı taraf SINAV — o kayıt bu sayfada yok.
              navigate(`/exams?highlight=${a.id}&rule=${c.rule_id}`);
              return;
            }
            // K-62: çakışmanın iki tarafı iki AYRI evrenden gelebilir — biri
            // taslağımın satırı, öteki başka cohort'un YAYINDAKİ satırı.
            // Karıştırmamak için önce "bu satır şu an ekranda mı" diye bakılır.
            const ekranda = entries.find((e) => e.id === a.id);
            if (ekranda) {
              setDeepHighlightIds([a.id]);
              setHighlightInfo({ rule: c.rule_id, entries: [ekranda] });
              return;                     // zaten buradayız, gidilecek yer yok
            }
            setSearchParams({ highlight: String(a.id), rule: c.rule_id });
          }}
        />
      </Paper>

      {placing && (() => {
        // K-61: modal HER ZAMAN önce dersi, sonra şubeyi sorar. Sürükleyerek
        // gelindiyse ders bellidir → salt-okunur gösterilir, yalnız şube
        // sorulur. Boş slota tıklanarak gelindiyse ikisi de sorulur.
        const yeni = placing.drag?.kind === "new" ? placing.drag : undefined;
        const birakilan = yeni
          ? courses.find((c) => c.id === yeni.courseId)
          : undefined;
        // Seçilebilir dersler: cohort'un ŞUBESİ OLAN dersleri. Şubesiz ders
        // buraya girmez — yerleştirilecek şubesi yok (palette de sürüklenmiyor).
        //
        // Kaynak `paletteItems` DEĞİL `courses`: palet arama kutusu bir gezinme
        // yardımıdır, kapsam değil. Oradan türetseydik kullanıcı "MATH" aratıp
        // boş bir hücreye tıkladığında modalda yalnız MATH dersleri çıkardı.
        const dersler = courses
          .filter((c) => c.sections.some((s) => s.active))
          .map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }));
        return (
        <EntryModal
          title={birakilan
            ? `${birakilan.code} → ${t.days.short[placing.day]} ${SLOT_START[placing.slot]}`
            : t.weekly.addEntry(t.days.short[placing.day], SLOT_START[placing.slot])}
          classrooms={classrooms} startSlot={placing.slot}
          onlineBySection={onlineBySection}
          hoursOf={(id) => hoursByCourse.get(id) ?? null}
          courses={dersler}
          fixedCourseId={birakilan?.id}
          sectionsOf={(courseId) => {
            const c = courses.find((x) => x.id === courseId);
            return (c?.sections ?? []).filter((s) => s.active)
              .sort((a, b) => a.section_no - b.section_no)     // şube no sırası
              .map((s) => ({
              value: String(s.id),
              label: t.weekly.sectionOption(s.section_no, lecturerLabel(s.lecturer),
                                            s.expected_students),
            }));
          }}
          onClose={() => setPlacing(null)}
          onSubmit={async (body) => {
            const res = await api.post<{ entry: WeeklyEntry; conflicts: ConflictResult[] }>(
              `/${writeBase}`, {
                day_of_week: placing.day, start_slot: placing.slot, ...body,
              });
            // Geri al = eklenen girişi sil.
            recordUndo({
              label: `${res.entry.section.course.code}-${res.entry.section.section_no} ekleme`,
              entity: writeBase,
              action: { type: "delete", id: res.entry.id },
            });
            return res;
          }}
          onDone={(conflicts) => { setPlacing(null); reload(); refreshDraft(); showConflicts(conflicts, t.weekly.saved); }}
        />
        );
      })()}

      {group && (
        <GroupModal cluster={group} canWrite={canWrite} onClose={() => setGroup(null)}
          onEdit={setEditing} onDelete={deleteEntry} />
      )}


      {editing && (
        <EntryModal
          title={`${editing.section.course.code}-${editing.section.section_no} · ${t.days.short[editing.day_of_week]} ${SLOT_START[editing.start_slot]}`}
          classrooms={classrooms} startSlot={editing.start_slot}
          onlineBySection={onlineBySection}
          hoursOf={(id) => hoursByCourse.get(id) ?? null}
          // Düzenlemede ders seçici çizilmez; değer yalnız "Oturum türü"
          // etiketinin saatleri bulabilmesi için geçiliyor.
          fixedCourseId={editing.section.course.id}
          fixedSectionId={editing.section.id}
          initial={{
            classroomId: editing.classroom ? String(editing.classroom.id) : null,
            sessionType: editing.session_type,
            delivery: editing.delivery_mode,
            slotCount: editing.slot_count,
          }}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            // Geri al = düzenlenen alanları eski değerlerine döndür.
            const before = {
              classroom_id: editing.classroom ? editing.classroom.id : null,
              session_type: editing.session_type,
              delivery_mode: editing.delivery_mode,
              slot_count: editing.slot_count,
              day_of_week: editing.day_of_week,
              start_slot: editing.start_slot,
            };
            const res = await api.patch<{ conflicts: ConflictResult[] }>(
              `/${writeBase}/${editing.id}`, body);
            recordUndo({
              label: t.weekly.editLabel(editing.section.course.code, editing.section.section_no),
              entity: writeBase,
              action: { type: "patch", id: editing.id, body: before },
            });
            return res;
          }}
          onDone={(conflicts) => { setEditing(null); reload(); refreshDraft(); showConflicts(conflicts, t.weekly.updated); }}
        />
      )}
    </Stack>
  );
}

function ClusterCard({ c, hard, warn, lecturerName, canWrite, highlight, deepHighlight, onWarningClick, onDragStart, onDragEnd, onEdit, onDelete, onOpenGroup }: {
  c: Cluster; hard: boolean; warn: boolean; canWrite: boolean;
  lecturerName?: string; onWarningClick?: () => void;
  highlight: boolean; deepHighlight?: boolean;
  onDragStart: (e: WeeklyEntry) => void; onDragEnd: () => void;
  onEdit: (e: WeeklyEntry) => void; onDelete: (e: WeeklyEntry) => void;
  onOpenGroup: () => void;
}) {
  const t = useT();
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
  // K-59: satırın kendi "durumu" yok artık — hangi moddaysak o. canWrite
  // yalnız düzenlenebilir bir TASLAKTAYKEN true olur (yayın salt-okunur).
  const draft = canWrite;
  const editable = canWrite && !many;

  // Renk yalnızca sol vurgu çizgisinde kullanılır. Böylece yoğun bir takvimde
  // metin hiyerarşisi, durum renginden önce gelir.
  const accent = hard ? ACCENT.hard : warn ? ACCENT.warn : draft ? ACCENT.draft : ACCENT.normal;

  /* DİKKAT — `border` kısayolu ile `borderLeft` uzun formu aynı stil nesnesinde
     BİRLİKTE KULLANILAMAZ. React yeniden render'da yalnız değeri değişen
     özelliği yazar; hover'da `border` güncellenince dört kenar birden sıfırlanır
     ama `borderLeft` (değeri aynı kaldığı için) tekrar uygulanmaz ve durum
     vurgusu sessizce kaybolur. Bu yüzden dört kenar da uzun formda. */
  const style: React.CSSProperties = {
    background: PAGE_SURFACE,
    color: TEXT_STRONG,
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
  // Tek kartın alt satırı: derslik (online ise "online").
  const altSatir = many
    ? t.weekly.sectionsCount(c.entries.length)
      + (rooms.size > 1 ? t.weekly.roomsCount(rooms.size)
         : rooms.size === 1 ? ` · ${[...rooms][0]}` : "")
    : `${online ? t.weekly.online : e.classroom?.room_code ?? "—"}`;

  const canDrag = canWrite && !many;
  /* K-85: HOCA ile DERSLİK yer değiştirdi.
     1 slotluk kart 89px; dolgu düşünce ~73px kalıyor ve kod + ders adı +
     tek meta satırı zaten ~64px yer tutuyor. Yani dördüncü satır TAŞIYOR ve
     ikisinden biri seçilmek zorunda. Eskiden her zaman derslik yazılıyor,
     hoca yalnız çok slotlu kartta görünüyordu; artık tersi.
     Toplu kart (paralel şubeler) bunun DIŞINDA: orada tek bir hoca yazmak
     yanlış olur, meta satırı şube/derslik özetini taşımaya devam eder.

     Deneme: ikisi de HER kartta yazılıyor. Ölçü dar — 1 slotluk kartın iç
     yüksekliği 73px ve dört satır ~82px tutuyordu; satır aralıkları ve meta
     satırlarının satır yüksekliği sıkıştırılarak yer açıldı. Kart zaten
     overflow:hidden, yani hesap tutmazsa taşan satır sessizce kırpılır. */
  const showRoom = !many;

  return (
    <div
      ref={cardRef}
      draggable={canDrag}
      onDragStart={(ev) => {
        if (!editable) { ev.preventDefault(); return; }
        ev.dataTransfer.effectAllowed = "move";
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      // stopPropagation: yoksa tıklama gün sütununa köpürüp "boş slota ekle"
      // modalını da açardı.
      onClick={(ev) => {
        ev.stopPropagation();
        if (many) onOpenGroup();
        else if (editable) onEdit(e);
        // K-75: yayın modunda tek karta tıklama artık bir şey yapmaz —
        // taslak yalnız üstteki bardan açılır.
      }}
      title={many
        ? t.weekly.parallelSections(c.entries.length)
        : editable
        ? t.weekly.cardEditable
        : `${e.section.course.code}-${e.section.section_no}`}
      style={{
        position: "absolute", top: (c.start_slot - 1) * ROW_H + 1, height: c.slot_count * ROW_H - 2,
        left: `calc(${c.lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
        borderRadius: CARD_RADIUS, padding: CARD_PADDING, lineHeight: 1.25, overflow: "hidden",
        cursor: many ? "pointer" : editable ? "grab" : "default", ...style,
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
        {/* Kod ve tür çipi BİRLİKTE solda kalmalı; dıştaki space-between aksi
            halde çipi kartın ortasına savurur. */}
        <Group gap={5} wrap="nowrap" align="center" style={{ minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em", minWidth: 0,
            // Çip eklendiği için kod artık taşabilir: taşarsa "…" ile kesilsin,
            // kartın dışına sarkmasın.
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {e.section.course.code}{many ? "" : `-${e.section.section_no}`}
          </div>
          {/* K-85: oturum türü YALNIZ Uygulama ve Lab'da yazılır. Teori
              varsayılan ve kartların çoğu teori; hepsine "Teori" yazmak bilgi
              değil gürültü olurdu. Toplu kartta da tek tür geçerli — küme
              anahtarı session_type'ı içeriyor, karışık tür bir kümede toplanmaz. */}
          {e.session_type !== "THEORY" && (
            <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
              {t.weekly.sessionBadge[e.session_type]}
            </Badge>
          )}
        </Group>
        {many && (
          <Badge size="xs" variant="filled" color="gray" style={{ flexShrink: 0 }}>
            {c.entries.length}
          </Badge>
        )}
        {/* Menü yerine DOĞRUDAN eylem: karttaki tek anlamlı işlem duruma göre
            zaten tek — taslakta sil, yayınlanmışta taslağa çevir. Yalnız
            üzerine gelince görünür; düzenleme karta tıklayarak yapılır. */}
        {hover && editable && (
          <ActionIcon size="sm" variant="subtle" color="red" aria-label={t.weekly.deleteEntry}
            title={t.common.delete} style={{ flexShrink: 0 }}
            onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}>
            <IconTrash size={15} />
          </ActionIcon>
        )}
      </Group>
      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4 }}>
        {e.section.course.name}
      </div>
      <Group gap={4} wrap="nowrap" mt={4} style={{ color: TEXT_MUTED, minWidth: 0 }}>
        {many
          ? (online ? <IconWorld size={14} stroke={1.8} /> : <IconMapPin size={14} stroke={1.8} />)
          : <IconUser size={14} stroke={1.8} />}
        <Text size="xs" c="dimmed" truncate lh={1.2}>
          {many ? altSatir : (lecturerName ?? "—")}
        </Text>
      </Group>
      {showRoom && (
        // Uyarı ikonu sağ-altta MUTLAK konumlu; 1 slotluk kartta tam bu satırın
        // hizasına düşüyor. Sağdan yer ayrılmazsa kırpılan metin ikonun altına
        // girer ve ikisi de okunmaz olur.
        <Group gap={4} wrap="nowrap" mt={2}
          style={{ color: TEXT_MUTED, minWidth: 0, paddingRight: (hard || warn) ? 22 : 0 }}>
          {online ? <IconWorld size={14} stroke={1.8} /> : <IconMapPin size={14} stroke={1.8} />}
          {/* altSatir tek girişte zaten online'ı da karşılıyor (t.weekly.online).
              Eskiden burada elle yazılmış "Online" vardı ve çeviriyi atlıyordu. */}
          <Text size="xs" c="dimmed" truncate lh={1.2}>{altSatir}</Text>
        </Group>
      )}
      {(hard || warn) && (
        <span title={hard ? t.weekly.hardTip : t.weekly.warnTip}
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
      {many && <Text size="xs" c="dimmed" mt={3}>{c.entries.length} paralel şube</Text>}
    </div>
  );
}

/** Toplu kartın detayı: paralel şubeler burada tek tek listelenir ve yönetilir.
 *  Gridde 8 şubeyi yan yana çizmek yerine buraya taşıdık — grid okunur kalıyor,
 *  şube düzeyindeki işlemler (düzenle/sil/taslağa çevir) kaybolmuyor. */
function GroupModal({ cluster, canWrite, onClose, onEdit, onDelete }: {
  cluster: Cluster; canWrite: boolean; onClose: () => void;
  onEdit: (e: WeeklyEntry) => void; onDelete: (e: WeeklyEntry) => void;
}) {
  const t = useT();
  const first = cluster.entries[0];
  return (
    <Modal opened onClose={onClose} size="md"
      title={t.weekly.groupTitle(first.section.course.code,
                                 t.days.short[first.day_of_week],
                                 SLOT_START[cluster.start_slot], cluster.entries.length)}>
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
            </Group>
            {canWrite && (
              <Group gap={4} wrap="nowrap">
                <Button size="compact-xs" variant="subtle"
                  onClick={() => { onClose(); onEdit(e); }}>{t.common.edit}</Button>
                <ActionIcon size="sm" variant="subtle" color="red" aria-label={t.common.delete}
                  onClick={() => { onClose(); onDelete(e); }}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            )}
          </Group>
        ))}
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

/** Yerleştirme ve düzenleme aynı alanları sorar — tek bileşen iki işi görür.
 *
 *  K-61: yerleştirmede sıra HER ZAMAN ders → şube. Eskiden tek bir
 *  "Ders / şube" listesi vardı (`CENG 1801-1 — IT FOR ENGINEERS` gibi birleşik
 *  satırlar) ve sürükleyerek gelindiğinde tek şubeli derste hiçbir şey
 *  sorulmuyordu. İkisi de kullanıcıyı "neyi yerleştiriyorum" sorusuyla baş başa
 *  bırakıyordu; şimdi ders her durumda GÖRÜNÜR, şube her durumda ayrı satır.
 */
function EntryModal({ title, classrooms, startSlot, initial, courses, fixedCourseId, sectionsOf, fixedSectionId, onlineBySection, hoursOf, onClose, onSubmit, onDone }: {
  title: string;
  classrooms: Classroom[];
  startSlot: number;
  initial?: { classroomId: string | null; sessionType: SessionType; delivery: DeliveryMode; slotCount: number };
  /** Verilirse modal ders + şube sorar (yerleştirme). Düzenlemede verilmez. */
  courses?: { value: string; label: string }[];
  /** Ders bellidir: yerleştirmede seçici DOLU ve kilitli gelir. Düzenlemede
   *  seçici hiç ÇİZİLMEZ (`courses` verilmez) ama değer yine geçilir — "Oturum
   *  türü" etiketi dersin saatlerini buradan bulur. */
  fixedCourseId?: number;
  /** Seçili dersin aktif şubeleri. */
  sectionsOf?: (courseId: number) => { value: string; label: string }[];
  /** Düzenleme: şube satırın KİMLİĞİDİR, sorulmaz — yalnız online'lık için alınır. */
  fixedSectionId?: number;
  /** K-45: şube id → bileşen bazında online'lık. */
  onlineBySection: Map<number, Record<SessionType, boolean>>;
  /** Ders id → T/U/L saatleri. Sabit değer YETMEZ: yerleştirmede ders modalın
   *  İÇİNDE seçilir, dolayısıyla etiket seçimle birlikte değişmeli. */
  hoursOf: (courseId: number) => CourseHours | null;
  onClose: () => void;
  onSubmit: (body: EntryBody) => Promise<{ conflicts: ConflictResult[] }>;
  onDone: (conflicts: ConflictResult[]) => void;
}) {
  const t = useT();
  const [courseId, setCourseId] = useState<string | null>(
    fixedCourseId != null ? String(fixedCourseId) : null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(initial?.classroomId ?? null);
  const [sessionType, setSessionType] = useState<SessionType>(initial?.sessionType ?? "THEORY");
  const [delivery, setDelivery] = useState<DeliveryMode>(initial?.delivery ?? "FACE_TO_FACE");
  const [slotCount, setSlotCount] = useState<number>(initial?.slotCount ?? 2);
  const [busy, setBusy] = useState(false);

  const maxSlots = 9 - startSlot + 1;
  const dersSaatleri = courseId ? hoursOf(Number(courseId)) : null;

  /** Saatler oturum türü anahtarlarıyla — pasifleştirme buna bakar. */
  const saatler: Record<SessionType, number> | null = dersSaatleri
    ? { THEORY: dersSaatleri.theory, PRACTICE: dersSaatleri.practice, LAB: dersSaatleri.lab }
    : null;

  /** Dersin ÜÇ bileşeni de 0 (veride 8 ders böyle) ya da ders henüz seçilmedi.
   *  Bu durumda hiçbir şey pasifleşmez: üçünü birden kapatmak açılır listeyi
   *  ölü bırakır ve o dersi hiç yerleştirilemez hâle getirirdi. Saatsiz ders
   *  bir VERİ eksiğidir; çözümü ders kaydını düzeltmek, programı kilitlemek
   *  değil. */
  const saatsizDers = saatler == null
    || (saatler.THEORY === 0 && saatler.PRACTICE === 0 && saatler.LAB === 0);

  /** Saati 0 olan bileşen listede pasif — o derste öyle bir oturum yok.
   *  Sunucu bunu ENGELLEMİYOR (W8 yalnız eksik saati rapor eder), yani buradaki
   *  kısıt bir kolaylık: yanlış bileşene yerleştirmeyi baştan imkânsız kılar.
   *
   *  SEÇİLİ olan asla pasifleşmez. Kayıtlı bir giriş, dersin saatleri sonradan
   *  değiştiği için saatsiz bir bileşende kalmış olabilir; onu da kapatmak
   *  Select'i "seçili ama seçilemez" bir değerle bırakır ve kullanıcı
   *  vazgeçip eski hâline dönemez. */
  const bilesenPasif = (k: SessionType) =>
    saatler != null && !saatsizDers && saatler[k] === 0 && k !== sessionType;

  /** YENİ yerleştirmede seçili bileşenin saati 0 ise saati olan ilk bileşene
   *  kayar. Varsayılan THEORY ve veride teorisi 0 olup uygulaması olan dersler
   *  var (0/2/0) — o derslerde modal pasif bir seçimle açılıyordu.
   *
   *  DÜZENLEMEDE çalışmaz (`courses` verilmez): orada oturum türünü kendiliğinden
   *  değiştirmek kayıtlı veriyi sessizce bozar; kullanıcı yalnız dersliği
   *  düzeltmek için açmış olabilir. */
  const yerlestirme = courses != null;
  useEffect(() => {
    if (!yerlestirme || saatler == null || saatsizDers) return;
    if (saatler[sessionType] > 0) return;
    const ilkGecerli = SESSION_TYPES.find((k) => saatler[k] > 0);
    if (ilkGecerli) setSessionType(ilkGecerli);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, yerlestirme]);
  const subeler = courseId && sectionsOf ? sectionsOf(Number(courseId)) : [];
  const tekSube = subeler.length === 1 ? subeler[0].value : null;

  // Tek şubeli derste seçim yapılacak bir şey yok: otomatik seçilir. Seçici
  // yine de ÇİZİLİR (kilitli) — gizlemek "şube diye bir şey yok" izlenimi
  // verirdi, oysa asıl bilgi "bu dersin tek şubesi var" (K-61).
  useEffect(() => {
    setSectionId((mevcut) => {
      if (tekSube) return tekSube;
      // Ders değişti ve eski şube artık bu derse ait değil → sıfırla. Yoksa
      // başka dersin şubesi gönderilir ve sunucu 400 verir (kullanıcı sebebini
      // anlamaz).
      return subeler.some((s) => s.value === mevcut) ? mevcut : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, tekSube, subeler.length]);

  const dersEksik = courses != null && (!courseId || !sectionId);

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
        {courses && (
          <>
            {/* Ders sürükleyerek geldiyse kilitli ama GÖRÜNÜR: kullanıcı neyi
                yerleştirdiğini modalda da okuyabilmeli. */}
            <Select label={t.weekly.course} value={courseId} onChange={setCourseId}
              data={courses} searchable filter={turkishOptionsFilter}
              disabled={fixedCourseId != null}
              placeholder={t.weekly.pickCourse} nothingFoundMessage={t.weekly.noCourse} />
            <Select label={t.weekly.section} value={sectionId} onChange={setSectionId}
              data={subeler} searchable filter={turkishOptionsFilter}
              disabled={!courseId || tekSube != null}
              placeholder={courseId ? t.weekly.pickSection : t.weekly.pickCourseFirst}
              description={tekSube != null ? t.weekly.onlyOneSection : undefined}
              nothingFoundMessage={t.weekly.noSectionOption} />
          </>
        )}
        {/* Oturum türü ÖNCE: online'lık buna göre belirlenir (K-45).
            Etiket dersin saatlerini taşır: "Oturum türü (3T/2U/0L)". Ders henüz
            seçilmemişse (boş slota tıklayarak açılan modal) harflere düşer. */}
        <Select label={t.weekly.sessionType(dersSaatleri)} value={sessionType} onChange={(v) => v && setSessionType(v as SessionType)}
          data={SESSION_TYPES.map((k) => ({
            value: k, label: t.weekly.session[k], disabled: bilesenPasif(k),
          }))} />
        {componentOnline ? (
          // Bileşen online: yalnız senkron/asenkron. "Online mı" ders düzeyinde
          // sabit olduğu için burada seçtirilmez.
          <Select label={t.weekly.deliveryType} value={delivery} onChange={(v) => v && setDelivery(v as DeliveryMode)}
            data={[
              { value: "ONLINE_SYNC", label: t.weekly.delivery.ONLINE_SYNC },
              { value: "ONLINE_ASYNC", label: t.weekly.delivery.ONLINE_ASYNC },
            ]} />
        ) : (
          <Select label={t.weekly.classroom} value={classroomId} onChange={setClassroomId}
            placeholder={t.weekly.pickClassroom} clearable searchable filter={turkishOptionsFilter}
            nothingFoundMessage={t.weekly.noClassroom}
            data={classrooms.map((c) => ({ value: String(c.id), label: `${c.building.name} ${c.room_code}` }))} />
        )}
        <NumberInput label={t.weekly.slotCount} value={slotCount} onChange={(v) => setSlotCount(Number(v) || 1)}
          min={1} max={maxSlots} />
        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="subtle" onClick={onClose} disabled={busy}>{t.common.dismiss}</Button>
          <Button onClick={submit} loading={busy} disabled={dersEksik}>{t.common.save}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
