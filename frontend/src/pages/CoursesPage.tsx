import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Box, Button, Checkbox, Divider, Drawer, Group, Loader, Modal,
  NumberInput, Paper, Popover, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table,
  Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconChevronRight, IconDoor, IconDownload, IconFilter, IconPencil,
  IconPlus, IconSearch, IconSelector, IconSortAscending, IconSortDescending, IconTrash,
  IconUsers, IconWifi, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ImportCoursesModal from "../components/ImportCoursesModal";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { lecturerLabel } from "../api/types";
import { formatSlotRange } from "../utils/slots";
import { turkishOptionsFilter } from "../utils/selectSearch";
import type {
  Classroom, Course, CourseSection, Department, Lecturer, SemesterType, WeeklyEntry,
} from "../api/types";
import { useT } from "../i18n";

const ALL = "__all__";

/** Lisans programı 4 yıl. Backend ge=1,le=6 kabul eder — daha uzun programlar
 *  (hazırlık, 5-6 yıllık bölümler) gerekirse tek yerden büyütülür. */
const YEARS = [1, 2, 3, 4];

/** Yıl + dönem → sıralı dönem numarası: 1.sınıf Güz=1, 1.sınıf Bahar=2,
 *  2.sınıf Güz=3 … Böylece dersler 1., 2., 3. … dönem gruplarına ayrılır. */
function donemNo(year: number, semester: SemesterType): number {
  return (year - 1) * 2 + (semester === "FALL" ? 1 : 2);
}

/** K-68: KATEGORİ segmenti — Tümü / Ortak / 1-4. sınıf. Sınıf seçimi yıl
 *  süzgecini (sunucu) sürer; "Ortak" is_common'ı süzer (istemci). Eski TÜR
 *  segmenti (Zorunlu/Seçmeli) filtre popover'ına taşındı. */
type Seg = "all" | "common" | "1" | "2" | "3" | "4";

/** K-68: ders türü süzgeci (filtre popover'ında). */
type TypeFilter = "all" | "required" | "elective";

/** K-65: sıralanabilir sütun anahtarı. "donem" varsayılan gizli sıralamadır
 *  (mevcut dönem-artan düzeni korur); kullanıcı DÖNEM başlığına basınca "sem"e
 *  döner. Ortak dersler yıl/dönem sıralamasında dibe iner (99). */
type SortKey = "code" | "name" | "type" | "ects" | "year" | "sem" | "sections" | "donem";

/** Bir dersin verilen anahtardaki sıralama değeri. Mockup'la birebir: tür
 *  sıralaması Ortak<Seçmeli<Zorunlu; AKTS boşsa en başa (-1); yıl/dönemde ortak
 *  ders dibe (99). Eşitlikte kod'a göre kırılır (çağıran tarafta). */
function sortValue(c: Course, key: SortKey): string | number {
  switch (key) {
    case "code": return c.code;
    case "name": return c.name;
    case "type": return c.is_common ? "1ortak" : c.is_elective ? "2secmeli" : "3zorunlu";
    case "ects": return c.ects ?? -1;
    case "year": return c.is_common ? 99 : c.year;
    case "sem": return c.is_common ? 99 : donemNo(c.year, c.semester);
    case "sections": return c.sections.length;
    default: return donemNo(c.year, c.semester);
  }
}

/** K-48: ortak dersin ek cohort satırı (form içi; department_id string). */
type CohortRow = { department_id: string; year: number; semester: SemesterType };

type CourseFormValues = {
  department_id: string;
  year: number;
  semester: SemesterType;
  code: string;
  name: string;
  is_elective: string;          // Select string taşır: "false" | "true"
  is_common: boolean;           // K-48: ortak (servis) ders mi
  cohorts: CohortRow[];         // K-48: ek cohort'lar (yalnız is_common'da)
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
  ects: number | "";            // K-55: AKTS (opsiyonel; "" = girilmedi)
  theory_online: boolean;       // K-45: bileşen online mı
  practice_online: boolean;
  lab_online: boolean;
  midterm_count: number;        // K-46: vize sayısı (1-3)
};

type SectionFormValues = {
  section_no: number;
  lecturer_id: string;
  expected_students: number;
};

/** Tek ders satırı — `memo` ile sarıldı. 336 satırlı tabloda asıl kasma sebebi
 *  buydu: aramada her tuş vuruşu ya da bir satıra tıklayıp Drawer açmak sayfayı
 *  yeniden render ediyor, o da BÜTÜN satırları yeniden çiziyordu. memo sayesinde
 *  bir satır yalnız kendi verisi ya da SEÇİLİ durumu değişince yeniden çizilir —
 *  arama yazarken hiçbir satır, Drawer açılınca yalnız iki satır (eski+yeni
 *  seçili) yeniden render olur. `onSelect` çağıran tarafta `useCallback` ile
 *  sabit tutulur ki memo'nun sığ karşılaştırması işe yarasın. */
const CourseRow = memo(function CourseRow({ course: c, selected, onSelect }: {
  course: Course; selected: boolean; onSelect: (id: number) => void;
}) {
  const t = useT();
  return (
    <Table.Tr
      onClick={() => onSelect(c.id)}
      style={{
        cursor: "pointer",
        opacity: c.active ? 1 : 0.55,
        background: selected ? "var(--mantine-color-blue-light)" : undefined,
      }}
    >
      <Table.Td>
        <Text fw={600} size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>{c.code}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" truncate>{c.name}</Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {c.is_common ? (
            <Badge size="xs" variant="light" color="teal">{t.courses.common}</Badge>
          ) : c.is_elective ? (
            <Badge size="xs" variant="light" color="orange">{t.courses.elective}</Badge>
          ) : (
            <Badge size="xs" variant="light" color="gray">{t.courses.required}</Badge>
          )}
          {!c.active && <Badge size="xs" color="gray">{t.courses.inactive}</Badge>}
        </Group>
      </Table.Td>
      <Table.Td ta="center" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {c.ects ?? "—"}
      </Table.Td>
      <Table.Td ta="center" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {c.hours_theory}+{c.hours_practice}+{c.hours_lab}
      </Table.Td>
      <Table.Td ta="center" c="dimmed">{c.is_common ? "—" : `${c.year}.`}</Table.Td>
      <Table.Td c="dimmed">{c.is_common ? "—" : t.enums.semester[c.semester]}</Table.Td>
      <Table.Td ta="center" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {c.sections.length === 0 ? t.courses.noSections
          : t.courses.sectionCount(c.sections.length)}
      </Table.Td>
      <Table.Td ta="right">
        <IconChevronRight size={15} style={{ color: "var(--mantine-color-gray-5)" }} />
      </Table.Td>
    </Table.Tr>
  );
});

export default function CoursesPage() {
  const t = useT();
  const { user } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bölüm/yıl/dönem/arama SUNUCU tarafında (kontrat §6 bu dördünü sunuyor).
  // Bölüm süzgeci, Bölümler genel-bakış ekranından ?department_id= ile önceden
  // seçili gelebilir; parametreyi bir kez okuyup URL'den temizliyoruz (yenilemede
  // yapışıp kalmasın, kullanıcının sonraki seçimini ezmesin).
  const [searchParams, setSearchParams] = useSearchParams();
  const [depFilter, setDepFilter] = useState<string | null>(
    searchParams.get("department_id"),
  );
  const [importOpen, setImportOpen] = useState(false);
  const [semFilter, setSemFilter] = useState<string | null>(null);
  // Haftalık programdaki ders "i" pop-up'ı `?search=<kod>` ile buraya yönlendirir.
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  // Öğretim üyesi filtresi İSTEMCİ tarafında: kontrat §6'da böyle bir parametre
  // yok ve hoca bilgisi zaten iç içe gelen şubelerde mevcut.
  const [lecFilter, setLecFilter] = useState<string | null>(null);

  // K-65: yeni arayüz süzgeçleri — hepsi İSTEMCİ tarafı (sunucu yüklemesini
  // tetiklemez, yalnız görünümü şekillendirir).
  const [seg, setSeg] = useState<Seg>("all");              // KATEGORİ: Tümü/Ortak/1-4
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");  // ders türü (popover)
  const [onlyActive, setOnlyActive] = useState(false);     // "Pasif dersleri gizle"
  const [filtersOpen, setFiltersOpen] = useState(false);   // Filtre popover'ı
  const [sortKey, setSortKey] = useState<SortKey>("donem"); // sıralama sütunu
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // K-65: satıra tıklayınca sağdan açılan detay Drawer'ının dersi (null = kapalı).
  const [selId, setSelId] = useState<number | null>(null);

  const [courseModal, setCourseModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);

  const courseForm = useForm<CourseFormValues>({
    initialValues: {
      department_id: "", year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", is_common: false, cohorts: [],
      hours_theory: 3, hours_practice: 0, hours_lab: 0, ects: "",
      theory_online: false, practice_online: false, lab_online: false,
      midterm_count: 1,
    },
    validate: {
      department_id: (v) => (v ? null : t.courses.pickDepartment),
      code: (v) => (v.trim() ? null : t.courses.codeRequired),
      name: (v) => (v.trim() ? null : t.courses.nameRequired),
    },
  });

  // K-69: statik listeler (bölüm/hoca/derslik/haftalık) filtreyle DEĞİŞMEZ; her
  // dep/dönem/arama değişiminde bir daha çekmek gereksiz ağ + iş. Yalnız İLK
  // load'da çekilir; sonraki yüklemeler yalnız dersleri tazeler.
  const staticLoaded = useRef(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams();
    if (depFilter) params.set("department_id", depFilter);
    // K-69: sınıf segmenti artık İSTEMCİDE süzülür (sunucuya year gönderilmez) —
    // segment geçişinde ağ turu/yeniden yükleme olmasın, anlık olsun.
    if (semFilter) params.set("semester", semFilter);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    try {
      if (!staticLoaded.current) {
        const [crs, deps, lecs, rooms, wk] = await Promise.all([
          api.get<Course[]>(`/courses${qs ? `?${qs}` : ""}`),
          api.get<Department[]>("/departments"),
          api.get<Lecturer[]>("/lecturers"),
          api.get<Classroom[]>("/classrooms"),
          api.get<WeeklyEntry[]>("/weekly-entries"),   // şubenin gün/saati için
        ]);
        setCourses(crs);
        setDepartments(deps);
        setLecturers(lecs);
        setClassrooms(rooms);
        setWeekly(wk);
        staticLoaded.current = true;
      } else {
        setCourses(await api.get<Course[]>(`/courses${qs ? `?${qs}` : ""}`));
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);   // aramada her tuşta istek atma
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depFilter, semFilter, search]);

  // Deep-link parametrelerini bir kez tüket: state'e alındı, artık URL'de durmasın.
  // ?add=1 → ekleme formunu açık getir (bölüm önceden seçili). Bölüm süzgeci
  // depFilter olarak zaten okundu (state init'te).
  useEffect(() => {
    if (!searchParams.has("department_id") && !searchParams.has("add")) return;
    if (searchParams.get("add") === "1") {
      openAddCourse(searchParams.get("department_id") ?? undefined);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("add");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const depById = useMemo(() => {
    const m: Record<number, Department> = {};
    for (const d of departments) m[d.id] = d;
    return m;
  }, [departments]);

  /** Şube id → haftalık program girişleri (bir şube birden çok slota yerleşebilir). */
  const entriesBySection = useMemo(() => {
    const m: Record<number, WeeklyEntry[]> = {};
    for (const e of weekly) (m[e.section.id] ??= []).push(e);
    for (const list of Object.values(m)) {
      list.sort((a, b) => a.day_of_week - b.day_of_week || a.start_slot - b.start_slot);
    }
    return m;
  }, [weekly]);

  /** Öğretim üyesi filtresi: dersin HERHANGİ bir şubesinde o hoca varsa gösterilir. */
  const visible = useMemo(() => {
    if (!lecFilter) return courses;
    const id = Number(lecFilter);
    return courses.filter((c) => c.sections.some((s) => s.lecturer.id === id));
  }, [courses, lecFilter]);

  // K-65: TEK tablo. Sunucudan gelen küme üzerine TÜR segmenti + pasif süzgeci
  // uygulanır, sonra aktif sütuna göre sıralanır. Ortak dersler artık ayrı bir
  // tabloda değil — bu tabloda TÜR rozetiyle ("Ortak") ve SINIF/DÖNEM="—" ile
  // görünürler (K-56/K-57 iki-tablo ayrımının yerini alan yeni tasarım).
  const rows = useMemo(() => {
    let list = visible;
    // K-68: KATEGORİ segmenti. "Ortak" is_common'ı; "1-4" ise o sınıfın
    // ortak-OLMAYAN derslerini (ortak dersler yalnız "Ortak" kategorisinde,
    // yıl sütunları "—"). Yıl zaten sunucuda süzülür; burada ortak dışlanır.
    if (seg === "common") list = list.filter((c) => c.is_common);
    else if (seg !== "all") list = list.filter((c) => !c.is_common && c.year === Number(seg));
    // K-68: ders türü (popover) — ortak/normal fark etmeksizin is_elective.
    if (typeFilter === "required") list = list.filter((c) => !c.is_elective);
    else if (typeFilter === "elective") list = list.filter((c) => c.is_elective);
    if (onlyActive) list = list.filter((c) => c.active);
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
      let cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "tr");
      if (cmp === 0) cmp = a.code.localeCompare(b.code, "tr");  // eşitlikte kod
      return cmp * dir;
    });
  }, [visible, seg, typeFilter, onlyActive, sortKey, sortDir]);

  const countLabel = t.courses.courseCount(rows.length);

  // Drawer içeriği: tam listeden okunur (süzgeç değişse de açık ders kaybolmasın).
  const selected = useMemo(
    () => courses.find((c) => c.id === selId) ?? null, [courses, selId]);

  // memo'lu CourseRow'un sığ prop karşılaştırması için SABİT kimlik: her render'da
  // yeni bir ok-fonksiyon üretmemek adına useCallback. Yeni olsaydı tüm satırların
  // `onSelect` prop'u değişir, memo boşa çıkardı.
  const handleSelect = useCallback((id: number) => setSelId(id), []);

  // K-65: bir başlığa basmak o sütunu sıralar; aynı başlığa tekrar basmak yönü
  // çevirir. Yeni sütuna geçişte artan başlar.
  function sortBy(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  // K-65: aktif süzgeç çipleri (Bölüm/Hoca/Sınıf/Dönem/Pasif). Arama ve TÜR
  // segmenti çip olmaz — onların kendi görünür kontrolü var.
  const chips = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    if (depFilter) {
      const d = depById[Number(depFilter)];
      out.push({ key: "dep", label: d ? `${d.code} — ${d.name}` : t.courses.department,
        clear: () => setDepFilter(null) });
    }
    if (lecFilter) {
      const l = lecturers.find((x) => String(x.id) === lecFilter);
      out.push({ key: "lec", label: l ? lecturerLabel(l) : t.courses.lecturer,
        clear: () => setLecFilter(null) });
    }
    if (typeFilter !== "all") out.push({ key: "type",
      label: typeFilter === "required" ? t.courses.required : t.courses.elective,
      clear: () => setTypeFilter("all") });
    if (semFilter) out.push({ key: "sem", label: t.enums.semester[semFilter as SemesterType],
      clear: () => setSemFilter(null) });
    if (onlyActive) out.push({ key: "active", label: "Pasifler gizli",
      clear: () => setOnlyActive(false) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depFilter, lecFilter, typeFilter, semFilter, onlyActive, depById, lecturers]);

  function clearAllFilters() {
    setDepFilter(null); setLecFilter(null); setTypeFilter("all");
    setSemFilter(null); setOnlyActive(false);
  }

  // K-48/K-49: ortak dersi ALAN her bölümün yetkilisi düzenler + şube yönetir +
  // siler (birincil ∪ ek cohort). Normal derste yalnız birincil → eski davranış.
  function canEdit(course: Course) {
    if (canWriteIn(user, "can_manage_courses", course.department_id)) return true;
    return course.extra_cohorts.some(
      (ec) => canWriteIn(user, "can_manage_courses", ec.department_id));
  }

  const writableDepartments = useMemo(
    () => departments.filter((d) => canWriteIn(user, "can_manage_courses", d.id)),
    [departments, user],
  );

  // departmentId verilirse (Bölümler → "Ders Ekle" derin bağlantısı) o bölüm
  // önceden seçili gelir; yoksa tek yazılabilir bölüm varsa o seçilir.
  function openAddCourse(departmentId?: string) {
    setEditingCourse(null);
    courseForm.setValues({
      department_id: departmentId
        ?? (writableDepartments.length === 1 ? String(writableDepartments[0].id) : ""),
      year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", is_common: false, cohorts: [],
      hours_theory: 3, hours_practice: 0, hours_lab: 0, ects: "",
      theory_online: false, practice_online: false, lab_online: false,
      midterm_count: 1,
    });
    setCourseModal(true);
  }

  function openEditCourse(c: Course) {
    setEditingCourse(c);
    courseForm.setValues({
      department_id: String(c.department_id),
      year: c.year, semester: c.semester, code: c.code, name: c.name,
      is_elective: String(c.is_elective),
      is_common: c.is_common,
      cohorts: c.extra_cohorts.map((ec) => ({
        department_id: String(ec.department_id), year: ec.year, semester: ec.semester,
      })),
      hours_theory: c.hours_theory, hours_practice: c.hours_practice, hours_lab: c.hours_lab,
      ects: c.ects ?? "",
      theory_online: c.theory_online, practice_online: c.practice_online, lab_online: c.lab_online,
      midterm_count: c.midterm_count,
    });
    setCourseModal(true);
  }

  async function submitCourse(v: CourseFormValues) {
    // K-48: ortak dersse yalnız DOLU cohort satırları gider (yarım satır backend'i
    // "Geçersiz cohort bölümü" 400'üne düşürmesin). Aynı üçlü iki kez ya da
    // birincil cohort'la aynı verilmişse istek atmadan uyar (backend zaten 400 döner).
    const cohortRows = v.is_common ? v.cohorts.filter((c) => c.department_id) : [];
    if (v.is_common && editingCourse) {
      const seen = new Set([
        `${editingCourse.department_id}|${editingCourse.year}|${editingCourse.semester}`,
      ]);
      for (const c of cohortRows) {
        const key = `${c.department_id}|${c.year}|${c.semester}`;
        if (seen.has(key)) {
          notifications.show({
            color: "red",
            message: t.courses.duplicateCohort,
          });
          return;
        }
        seen.add(key);
      }
    }
    setBusy(true);
    let yeniDersId: number | null = null;
    const cohortsPayload = cohortRows.map((c) => ({
      department_id: Number(c.department_id), year: c.year, semester: c.semester,
    }));
    const ortak = {
      code: v.code, name: v.name, is_elective: v.is_elective === "true",
      is_common: v.is_common,           // K-48
      hours_theory: v.hours_theory, hours_practice: v.hours_practice, hours_lab: v.hours_lab,
      ects: v.ects === "" ? null : v.ects,   // K-55: boş bırakıldıysa null gönder
      midterm_count: v.midterm_count,   // K-46

      // K-45: saati 0 olan bileşenin online bayrağı gönderilmez (backend zaten
      // zorla false yapar; burada da tutarlı kalsın).
      theory_online: v.hours_theory > 0 && v.theory_online,
      practice_online: v.hours_practice > 0 && v.practice_online,
      lab_online: v.hours_lab > 0 && v.lab_online,
    };
    // Programa etki eden alan (online/saat) değiştiyse backend bu dersin taslak
    // haftalık+sınav yerleşimlerini sıfırlar; kullanıcıya bunu bildirelim.
    const schedFields = [
      "hours_theory", "hours_practice", "hours_lab",
      "theory_online", "practice_online", "lab_online",
    ] as const;
    const scheduleChanged = !!editingCourse
      && schedFields.some((f) => ortak[f] !== editingCourse[f]);
    try {
      if (editingCourse) {
        // Kimlik alanları (bölüm/yıl/dönem) gönderilmez — kontrat §6.
        // cohorts PATCH'te tam listeyle değişir (K-48).
        await api.patch<Course>(`/courses/${editingCourse.id}`, { ...ortak, cohorts: cohortsPayload });
        notifications.show({ color: "green", message: scheduleChanged
          ? t.courses.updatedReset
          : t.courses.updated });
      } else {
        // K-48: ortak dersse backend aynı kodlu mevcut ortak derse cohort ekleyip
        // onu döner (birleştirme); değilse yeni kayıt. Ek cohort'lar DÜZENLE'den
        // yönetilir — create formunda cohort editörü yok.
        const created = await api.post<Course>("/courses", {
          department_id: Number(v.department_id),
          year: v.year, semester: v.semester, ...ortak,
        });
        notifications.show({
          color: "green",
          message: v.is_common ? t.courses.commonSaved : t.courses.created,
        });
        yeniDersId = created.id;
      }
      setCourseModal(false);
      await load();
      // Yeni ders şube olmadan işe yaramaz; kullanıcıyı listeye geri gönderip
      // dersi tekrar aratmak yerine detay Drawer'ını doğrudan açıyoruz.
      if (yeniDersId !== null) setSelId(yeniDersId);
    } catch (e) {
      // 409: ya ders kodu çakışması ya da "yayınlanmış yerleşim var" bloğu — ikisi
      // de tek satıra sığmayan bir açıklama taşır, bildirim olarak gösterilir.
      if (e instanceof ApiError && e.status === 409) {
        notifications.show({ color: "red", message: e.message, autoClose: 8000 });
      } else {
        notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteCourse() {
    if (!deletingCourse) return;
    setBusy(true);
    try {
      await api.delete(`/courses/${deletingCourse.id}`);
      notifications.show({ color: "green", message: "Ders silindi" });
      // Silinen ders açık Drawer'daysa kapat (artık yok).
      if (selId === deletingCourse.id) setSelId(null);
      setDeletingCourse(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : t.common.actionFailed,
        autoClose: 7000,
      });
      setDeletingCourse(null);
    } finally {
      setBusy(false);
    }
  }

  /** Sıralanabilir tablo başlığı. BİLEŞEN değil FONKSİYON: `<SortTh/>` olarak
   *  kullansaydık React onu her render'da yeni bir bileşen tipi sayıp tüm başlık
   *  hücrelerini unmount/mount ederdi. Doğrudan çağrılan bir fonksiyon Th
   *  döndürür — ekstra bileşen sınırı, gereksiz remount yok. */
  function sortTh(label: string, k: SortKey, w?: number, align?: "center") {
    const on = sortKey === k;
    const Arrow = !on ? IconSelector : sortDir === "asc" ? IconSortAscending : IconSortDescending;
    return (
      <Table.Th
        w={w}
        onClick={() => sortBy(k)}
        style={{ cursor: "pointer", userSelect: "none", textAlign: align, whiteSpace: "nowrap" }}
      >
        <Group gap={4} justify={align === "center" ? "center" : "flex-start"} wrap="nowrap"
          style={{ display: "inline-flex" }}>
          <Text span inherit c={on ? "blue" : undefined}>{label}</Text>
          <Arrow size={13} style={{ color: on ? "var(--mantine-color-blue-6)" : "var(--mantine-color-gray-5)" }} />
        </Group>
      </Table.Th>
    );
  }

  if (loading && courses.length === 0) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  const hasFilters = chips.length > 0;

  return (
    <>
      {/* --- Başlık: ders/şube/ortak sayacı + İçe Aktar / Ders Ekle --- */}
      <Group justify="space-between" align="baseline" mb="md">
        <Group align="baseline" gap="xs">
          <Title order={3}>{t.courses.title}</Title>
          <Text size="sm" c="dimmed">{countLabel}</Text>
        </Group>
        {writableDepartments.length > 0 && (
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => setImportOpen(true)}
            >
              {t.courses.importCta}
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => openAddCourse()}>
              {t.courses.add}
            </Button>
          </Group>
        )}
      </Group>

      <ImportCoursesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        departments={writableDepartments}
        defaultDepartmentId={depFilter}
        onImported={load}
      />

      {/* --- Süzgeç çubuğu: arama · TÜR segmenti · Filtre popover · aktif çipler --- */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" wrap="nowrap" align="center">
          <TextInput
            placeholder={t.courses.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            w={260}
            style={{ flex: "none" }}
          />

          <SegmentedControl
            value={seg}
            onChange={(v) => setSeg(v as Seg)}
            data={[
              { label: t.common.all, value: "all" },
              { label: t.courses.common, value: "common" },
              ...[1, 2, 3, 4].map((y) => ({ label: t.courses.yearN(y), value: String(y) })),
            ]}
            size="sm"
            style={{ flex: "none" }}
          />

          <Popover
            opened={filtersOpen}
            onChange={setFiltersOpen}
            position="bottom-start"
            width={520}
            shadow="md"
            withArrow
          >
            <Popover.Target>
              <Button
                variant="default"
                onClick={() => setFiltersOpen((o) => !o)}
                leftSection={<IconFilter size={16} />}
                style={{ flex: "none" }}
              >
                {t.courses.filter}
                {hasFilters && (
                  <Badge size="sm" circle ml={6} variant="filled">{chips.length}</Badge>
                )}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <SimpleGrid cols={2} spacing="sm">
                <Select
                  label={t.courses.department}
                  data={[{ value: ALL, label: t.courses.allDepartments },
                    ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]}
                  value={depFilter ?? ALL}
                  onChange={(v) => setDepFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
                <Select
                  label={t.courses.lecturer}
                  data={[{ value: ALL, label: t.courses.allLecturers },
                    ...lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) }))]}
                  value={lecFilter ?? ALL}
                  onChange={(v) => setLecFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
                <Select
                  label={t.courses.courseType}
                  data={[
                    { value: "all", label: t.courses.allTypes },
                    { value: "required", label: t.courses.required },
                    { value: "elective", label: t.courses.elective },
                  ]}
                  value={typeFilter}
                  onChange={(v) => setTypeFilter((v ?? "all") as TypeFilter)}
                  allowDeselect={false}
                />
                <Select
                  label={t.courses.semester}
                  data={[{ value: ALL, label: t.courses.allSemesters },
                    ...(Object.keys(t.enums.semester) as SemesterType[]).map((s) => ({
                      value: s, label: t.enums.semester[s],
                    }))]}
                  value={semFilter ?? ALL}
                  onChange={(v) => setSemFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                />
              </SimpleGrid>
              <Group justify="space-between" mt="md" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                <Checkbox
                  label={t.courses.hideInactiveCourses}
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.currentTarget.checked)}
                />
                <Button variant="default" size="xs" onClick={() => setFiltersOpen(false)}>{t.common.close}</Button>
              </Group>
            </Popover.Dropdown>
          </Popover>

          {/* Aktif filtre çipleri + hepsini temizle */}
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {chips.map((ch) => (
              <Badge
                key={ch.key}
                variant="light"
                color="gray"
                size="lg"
                style={{ flex: "none", cursor: "pointer", textTransform: "none" }}
                rightSection={<IconX size={13} style={{ display: "block" }} />}
                onClick={ch.clear}
              >
                {ch.label}
              </Badge>
            ))}
            {hasFilters && (
              <Button variant="subtle" size="compact-xs" onClick={clearAllFilters} style={{ flex: "none" }}>
                {t.courses.clear}
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {/* --- Tek sıralanabilir tablo --- */}
      {rows.length === 0 ? (
        <Text c="dimmed" mt="xl" ta="center">
          {search || hasFilters || seg !== "all"
            ? "Filtreye uyan ders yok."
            : t.courses.empty}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={900} mt="sm">
        <Table striped highlightOnHover verticalSpacing="xs" withTableBorder layout="fixed">
          <Table.Thead>
            <Table.Tr>
              {sortTh(t.courses.code, "code", 104)}
              {sortTh(t.courses.name, "name")}
              {sortTh(t.courses.type, "type", 116)}
              {sortTh(t.courses.ects, "ects", 70, "center")}
              <Table.Th w={88} ta="center">{t.courses.hours}</Table.Th>
              {sortTh(t.courses.classYear, "year", 72, "center")}
              {sortTh(t.courses.semester, "sem", 84)}
              {sortTh(t.courses.sections, "sections", 96, "center")}
              <Table.Th w={34} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((c) => (
              <CourseRow
                key={c.id}
                course={c}
                selected={c.id === selId}
                onSelect={handleSelect}
              />
            ))}
          </Table.Tbody>
        </Table>
        </Table.ScrollContainer>
      )}

      {/* --- Detay Drawer'ı (sağdan) --- */}
      <Drawer
        opened={selected !== null}
        onClose={() => setSelId(null)}
        position="right"
        size={560}
        withCloseButton={false}
        padding={0}
        styles={{ body: { height: "100%" } }}
      >
        {selected && (
          <CourseDrawerBody
            course={selected}
            depName={depById[selected.department_id]?.name}
            canEdit={canEdit(selected)}
            lecturers={lecturers}
            entriesBySection={entriesBySection}
            onEditCourse={openEditCourse}
            onDeleteCourse={setDeletingCourse}
            onChanged={load}
            onClose={() => setSelId(null)}
          />
        )}
      </Drawer>

      {/* --- Ders formu --- */}
      <Modal
        opened={courseModal}
        onClose={() => setCourseModal(false)}
        title={editingCourse ? t.courses.edit : "Yeni Ders"}
      >
        <form onSubmit={courseForm.onSubmit(submitCourse)}>
          <Stack>
            <Select
              label={t.courses.department}
              placeholder={t.courses.pick}
              data={writableDepartments.map((d) => ({
                value: String(d.id), label: `${d.code} — ${d.name}`,
              }))}
              disabled={!!editingCourse}
              description={editingCourse ? t.courses.identityLocked : undefined}
              {...courseForm.getInputProps("department_id")}
            />
            <Group grow>
              <Select
                label={t.courses.classYear}
                data={YEARS.map((y) => ({ value: String(y), label: t.courses.yearN(y) }))}
                value={String(courseForm.values.year)}
                onChange={(v) => courseForm.setFieldValue("year", Number(v))}
                disabled={!!editingCourse}
                allowDeselect={false}
              />
              <Select
                label={t.courses.semester}
                data={(Object.keys(t.enums.semester) as SemesterType[]).map((s) => ({
                  value: s, label: t.enums.semester[s],
                }))}
                value={courseForm.values.semester}
                onChange={(v) => courseForm.setFieldValue("semester", v as SemesterType)}
                disabled={!!editingCourse}
                allowDeselect={false}
              />
            </Group>
            <TextInput label={t.courses.codeLabel} placeholder="CENG2001" {...courseForm.getInputProps("code")} />
            <TextInput label={t.courses.nameLabel} placeholder={t.courses.namePlaceholder} {...courseForm.getInputProps("name")} />
            <Select
              label={t.courses.typeLabel}
              description={t.courses.typeHelp}
              data={[
                { value: "false", label: t.courses.required },
                { value: "true", label: t.courses.elective },
              ]}
              allowDeselect={false}
              {...courseForm.getInputProps("is_elective")}
            />
            <Group grow>
              <NumberInput label={t.courses.theory} min={0} {...courseForm.getInputProps("hours_theory")} />
              <NumberInput label={t.courses.practice} min={0} {...courseForm.getInputProps("hours_practice")} />
              <NumberInput label={t.courses.lab} min={0} {...courseForm.getInputProps("hours_lab")} />
            </Group>
            {/* K-55: AKTS/ECTS kredisi. Opsiyonel — boş bırakılabilir (eski dersler
                ve elle eklemede zorunlu değil; Bologna import'u doldurur). */}
            <NumberInput
              label={t.courses.ects}
              description={t.courses.ectsHelp}
              min={0}
              placeholder="—"
              {...courseForm.getInputProps("ects")}
            />
            {/* K-46: dersin vize sayısı. Birden fazlaysa sınav eklerken
                "kaçıncı vize" sorulur ve o sayıya kadar E2 üretilmez. */}
            <NumberInput
              label={t.courses.midtermCount}
              description={t.courses.midtermHelp}
              min={1} max={3} clampBehavior="strict"
              {...courseForm.getInputProps("midterm_count")}
            />
            {/* K-45: yalnız SAATİ GİRİLMİŞ bileşen için "online mı" sorulur.
                Senkron/asenkron burada değil, haftalık girişte seçilir. Hiçbir
                bileşenin saati yoksa blok hiç görünmez. */}
            {(courseForm.values.hours_theory > 0
              || courseForm.values.hours_practice > 0
              || courseForm.values.hours_lab > 0) && (
              <Stack gap={6}>
                <Text size="xs" c="dimmed">{t.courses.onlineComponents}</Text>
                <Group gap="lg">
                  {courseForm.values.hours_theory > 0 && (
                    <Checkbox size="xs" label={t.courses.theoryOnline}
                      {...courseForm.getInputProps("theory_online", { type: "checkbox" })} />
                  )}
                  {courseForm.values.hours_practice > 0 && (
                    <Checkbox size="xs" label={t.courses.practiceOnline}
                      {...courseForm.getInputProps("practice_online", { type: "checkbox" })} />
                  )}
                  {courseForm.values.hours_lab > 0 && (
                    <Checkbox size="xs" label={t.courses.labOnline}
                      {...courseForm.getInputProps("lab_online", { type: "checkbox" })} />
                  )}
                </Group>
              </Stack>
            )}
            {/* K-48: ortak (servis) ders — Fizik/Matematik gibi birden çok
                bölümün aldığı ders. Açılınca aldığı diğer cohort'lar (bölüm+
                sınıf+dönem) girilir; motor çakışmayı bu cohort'lara karşı da bakar. */}
            <Divider label={t.courses.commonCourse} labelPosition="left" mt="xs" />
            <Switch
              label={t.courses.commonCourse}
              checked={courseForm.values.is_common}
              onChange={(e) => courseForm.setFieldValue("is_common", e.currentTarget.checked)}
            />
            {/* K-48: ekleme modunda cohort editörü YOK — aynı kodlu ortak ders
                varsa bu ekleme otomatik onun altında toplanır. Ek cohort'lar
                kaydettikten sonra Düzenle'den yönetilir. */}
            {!editingCourse && courseForm.values.is_common && (
              <Text size="xs" c="dimmed">
                {t.courses.commonAddHint}
              </Text>
            )}
            {editingCourse && courseForm.values.is_common && (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  {t.courses.cohortHint}
                </Text>
                {courseForm.values.cohorts.map((row, i) => {
                  // K-48: benzersizlik (bölüm+yıl+dönem) ÜÇLÜSÜ üzerinde. Tüm
                  // bölümler listelenir; bir bölümün farklı sınıf/dönemi geçerli
                  // bir ek cohort'tur. Yalnız aynı üçlü tekrarlanırsa uyarılır
                  // (birincil cohort ya da daha önceki bir satırla çakışma).
                  const key = row.department_id
                    ? `${row.department_id}|${row.year}|${row.semester}` : null;
                  const primaryKey = editingCourse
                    ? `${editingCourse.department_id}|${editingCourse.year}|${editingCourse.semester}`
                    : null;
                  const dup = key != null && (
                    key === primaryKey ||
                    courseForm.values.cohorts.some(
                      (cc, j) => j < i && cc.department_id &&
                        `${cc.department_id}|${cc.year}|${cc.semester}` === key)
                  );
                  return (
                  <div key={i}>
                  <Group gap="xs" wrap="nowrap" align="flex-end">
                    <Select
                      label={i === 0 ? t.courses.department : undefined}
                      placeholder={t.courses.department}
                      style={{ flex: 1 }}
                      searchable
                      error={dup}
                      data={departments.map((d) => ({
                        value: String(d.id), label: `${d.code} — ${d.name}` }))}
                      value={row.department_id || null}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.department_id`, val ?? "")}
                    />
                    <Select
                      label={i === 0 ? t.courses.classYear : undefined}
                      w={90}
                      error={dup}
                      data={YEARS.map((y) => ({ value: String(y), label: `${y}.` }))}
                      value={String(row.year)}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.year`, Number(val))}
                      allowDeselect={false}
                    />
                    <Select
                      label={i === 0 ? t.courses.semester : undefined}
                      w={100}
                      error={dup}
                      data={(Object.keys(t.enums.semester) as SemesterType[]).map((s) => ({
                        value: s, label: t.enums.semester[s],
                      }))}
                      value={row.semester}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.semester`, val as SemesterType)}
                      allowDeselect={false}
                    />
                    <ActionIcon
                      variant="subtle" color="red" mb={4}
                      onClick={() => courseForm.removeListItem("cohorts", i)}
                      aria-label={t.courses.removeCohort}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  {dup && (
                    <Text size="xs" c="orange" mt={4}>
                      {t.courses.cohortDup}
                    </Text>
                  )}
                  </div>
                  );
                })}
                <Button
                  variant="light" size="xs" style={{ alignSelf: "flex-start" }}
                  onClick={() => courseForm.insertListItem("cohorts", {
                    department_id: "", year: 1, semester: "FALL" as SemesterType,
                  })}
                >
                  {t.courses.addCohort}
                </Button>
              </Stack>
            )}
            <Button type="submit" loading={busy} mt="sm">
              {editingCourse ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* --- Ders silme onayı --- */}
      <Modal opened={deletingCourse !== null} onClose={() => setDeletingCourse(null)} title={t.courses.deleteModal}>
        <Text>
          <b>{deletingCourse?.code}</b> — {deletingCourse?.name} kalıcı olarak silinecek.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Şubesi veya sınavı olan ders silinemez; onun yerine düzenleyip pasife alın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeletingCourse(null)}>{t.common.dismiss}</Button>
          <Button color="red" loading={busy} onClick={deleteCourse}>{t.common.delete}</Button>
        </Group>
      </Modal>
    </>
  );
}

/** Drawer içindeki tek istatistik hücresi (AKTS · T+U+L · Sınıf/Dönem · Vize). */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="xs" radius="sm">
      <Text size="xs" c="dimmed" fw={600}>{label}</Text>
      <Text size="sm" mt={2} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
    </Paper>
  );
}

/** Ders detay + şube yönetimi — satıra tıklayınca sağdan açılan Drawer'ın gövdesi.
 *
 *  Üstte künye (kod + tür rozetleri + ad), altında istatistik ızgarası, online
 *  bileşen, ortak dersse aldığı gruplar ve şubeler (kart). En altta sabit eylem
 *  çubuğu: Dersi düzenle · Haftalık programda gör · Sil. Şube ekle/düzenle/sil
 *  yine yalnız yetkiliye açıktır (canEdit).
 */
function CourseDrawerBody({
  course, depName, canEdit, lecturers, entriesBySection,
  onEditCourse, onDeleteCourse, onChanged, onClose,
}: {
  course: Course;
  depName?: string;
  canEdit: boolean;
  lecturers: Lecturer[];
  entriesBySection: Record<number, WeeklyEntry[]>;
  onEditCourse: (c: Course) => void;
  onDeleteCourse: (c: Course) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<CourseSection | null>(null);
  const [deleting, setDeleting] = useState<CourseSection | null>(null);
  const [busy, setBusy] = useState(false);
  // Şube formu varsayılan KAPALI: detay okumaya gelen kullanıcı boş formla
  // karşılaşmasın. "Şube ekle" butonu ya da bir şubeyi düzenlemek açar.
  const [formOpen, setFormOpen] = useState(false);

  const form = useForm<SectionFormValues>({
    initialValues: {
      section_no: 1, lecturer_id: "", expected_students: 30,
    },
    validate: {
      lecturer_id: (v) => (v ? null : t.courses.pickLecturer),
      section_no: (v) => (v > 0 ? null : t.courses.sectionNoPositive),
      expected_students: (v) => (v > 0 ? null : t.courses.expectedPositive),
    },
  });

  function resetForm() {
    setEditing(null);
    const nextNo = Math.max(0, ...course.sections.map((s) => s.section_no)) + 1;
    form.setValues({ section_no: nextNo, lecturer_id: "", expected_students: 30 });
  }

  // "Şube ekle": formu yeni-kayıt modunda aç.
  function openNew() {
    resetForm();
    setFormOpen(true);
  }

  // "Vazgeç" / başarılı işlem: formu kapat ve alanları sıfırla.
  function closeForm() {
    resetForm();
    setFormOpen(false);
  }

  // Drawer başka bir derse geçtiğinde formu sıfırla ve kapat.
  useEffect(() => {
    resetForm();
    setFormOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  function startEdit(s: CourseSection) {
    setEditing(s);
    form.setValues({
      section_no: s.section_no,
      lecturer_id: String(s.lecturer.id),
      expected_students: s.expected_students,
    });
    setFormOpen(true);   // düzenleme aynı formu kullanır — görünür olmalı
  }

  async function submit(v: SectionFormValues) {
    setBusy(true);
    // Derslik artık şubede DEĞİL, haftalık programda belirlenir (kullanıcı
    // isteği). default_classroom_id gönderilmez; şema opsiyonel, null kalır.
    const payload = {
      section_no: v.section_no,
      lecturer_id: Number(v.lecturer_id),
      expected_students: v.expected_students,
    };
    try {
      if (editing) {
        await api.patch<CourseSection>(`/course-sections/${editing.id}`, payload);
        notifications.show({ color: "green", message: t.courses.sectionUpdated });
      } else {
        await api.post<CourseSection>(`/courses/${course.id}/sections`, payload);
        notifications.show({ color: "green", message: t.courses.sectionCreated });
      }
      closeForm();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setFieldError("section_no", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/course-sections/${deleting.id}`);
      notifications.show({ color: "green", message: t.courses.sectionDeleted });
      setDeleting(null);
      await onChanged();
    } catch (e) {
      // 409 = şubenin haftalık program girişi var
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : t.common.actionFailed,
        autoClose: 7000,
      });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const sections = [...course.sections].sort((a, b) => a.section_no - b.section_no);

  // K-45: hangi bileşenler online — Drawer'da tek satır rozet olarak gösterilir.
  const online: string[] = [];
  if (course.theory_online) online.push("Teori");
  if (course.practice_online) online.push("Uygulama");
  if (course.lab_online) online.push("Lab");

  const typeBadge = course.is_common
    ? <Badge variant="light" color="teal" size="sm">{t.courses.common}</Badge>
    : course.is_elective
      ? <Badge variant="light" color="orange" size="sm">{t.courses.elective}</Badge>
      : <Badge variant="light" color="gray" size="sm">{t.courses.required}</Badge>;

  return (
    <Stack gap={0} h="100%">
      {/* Künye */}
      <Group justify="space-between" align="flex-start" wrap="nowrap"
        p="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <div style={{ minWidth: 0 }}>
          <Group gap="xs" align="center">
            <Text fw={700} size="lg" style={{ fontVariantNumeric: "tabular-nums" }}>{course.code}</Text>
            {typeBadge}
            {!course.active && <Badge color="gray" size="sm">{t.courses.inactive}</Badge>}
          </Group>
          <Text size="sm" mt={2}>{course.name}</Text>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label={t.common.close}>
          <IconX size={18} />
        </ActionIcon>
      </Group>

      {/* Kaydırılan gövde */}
      <Box style={{ flex: 1, overflowY: "auto" }} p="md">
        <Stack gap="lg">
          <SimpleGrid cols={4} spacing="xs">
            <Stat label={t.courses.ects} value={course.ects == null ? "—" : String(course.ects)} />
            <Stat label={t.courses.hours} value={`${course.hours_theory}+${course.hours_practice}+${course.hours_lab}`} />
            <Stat
              label={t.courses.yearSemester}
              value={course.is_common ? t.courses.multiCohort : `${course.year}. / ${t.enums.semester[course.semester]}`}
            />
            <Stat label={t.courses.midterm} value={t.courses.midtermN(course.midterm_count)} />
          </SimpleGrid>

          {online.length > 0 && (
            <Group gap={8} c="dimmed">
              <IconWifi size={16} />
              <Text size="sm">{t.courses.onlineComponent(online.join(", "))}</Text>
            </Group>
          )}

          {/* K-48: ortak dersin ait olduğu TÜM cohort'lar (birincil + ek). */}
          {course.is_common && (
            <div>
              <Text size="xs" fw={600} c="dimmed" mb={8}>{t.courses.takenBy}</Text>
              <Group gap={6}>
                <Badge size="sm" variant="light" color="teal" style={{ textTransform: "none" }}>
                  {depName ? `${depName} · ` : ""}{course.year}. sınıf · {t.enums.semester[course.semester]}
                </Badge>
                {course.extra_cohorts.map((ec) => (
                  <Badge key={ec.id} size="sm" variant="light" color="teal" style={{ textTransform: "none" }}>
                    {ec.department_name} · {ec.year}. sınıf · {t.enums.semester[ec.semester]}
                  </Badge>
                ))}
              </Group>
            </div>
          )}

          {/* Şubeler */}
          <div>
            <Group justify="space-between" mb={8}>
              <Text size="xs" fw={600} c="dimmed">{t.courses.sectionsTitle}</Text>
              {canEdit && !formOpen && (
                <Button size="compact-xs" variant="light" leftSection={<IconPlus size={14} />}
                  onClick={openNew}>
                  {t.courses.addSection}
                </Button>
              )}
            </Group>

            <Stack gap="xs">
              {sections.map((s) => {
                const entries = entriesBySection[s.id] ?? [];
                // Derslik artık ŞUBEDE değil, haftalık YERLEŞİMDE belli: girişin
                // dersliğinden (online ise "Online") türetilir.
                const rooms = [...new Set(entries.map((e) =>
                  e.delivery_mode !== "FACE_TO_FACE" ? "Online"
                    : e.classroom ? `${e.classroom.building.name} ${e.classroom.room_code}` : null,
                ).filter((x): x is string => x != null))];
                return (
                  <Paper key={s.id} withBorder radius="md" p="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        <Badge variant="light" color="gray" radius="sm"
                          style={{ fontVariantNumeric: "tabular-nums" }}>{s.section_no}</Badge>
                        <Text size="sm" truncate>{lecturerLabel(s.lecturer)}</Text>
                      </Group>
                      {canEdit && (
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label={t.common.edit}>
                            <ActionIcon variant="subtle" size="sm" onClick={() => startEdit(s)}>
                              <IconPencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t.common.delete}>
                            <ActionIcon variant="subtle" size="sm" color="red" onClick={() => setDeleting(s)}>
                              <IconTrash size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      )}
                    </Group>
                    <Group gap="md" mt={8} c="dimmed" wrap="wrap">
                      <Group gap={5} wrap="nowrap">
                        <IconUsers size={14} />
                        <Text size="xs">{s.expected_students} öğrenci</Text>
                      </Group>
                      <Group gap={5} wrap="nowrap">
                        <IconDoor size={14} />
                        <Text size="xs" c={rooms.length ? undefined : "dimmed"}>
                          {rooms.length ? rooms.join(", ") : "derslik yok"}
                        </Text>
                      </Group>
                      {/* K-59: bu liste GET /weekly-entries'ten gelir; o uç yalnız
                          yayındakileri döner — hepsi yayındadır (yeşil rozet). */}
                      {entries.length === 0 ? (
                        <Text size="xs" c="orange.7">{t.courses.notScheduled}</Text>
                      ) : (
                        <Group gap={4}>
                          {entries.map((e) => (
                            <Badge key={e.id} variant="light" size="sm" color="green">
                              {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count, "short", t)}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Group>
                  </Paper>
                );
              })}

              {sections.length === 0 && !formOpen && (
                <Paper withBorder radius="md" p="md" style={{ borderStyle: "dashed" }}>
                  <Text size="sm" c="dimmed" ta="center">
                    {t.courses.noSectionsYet}
                  </Text>
                </Paper>
              )}

              {/* Şube ekle/düzenle formu — Drawer içinde açılır */}
              {canEdit && formOpen && (
                <Paper withBorder p="sm" radius="md">
                  <form onSubmit={form.onSubmit(submit)}>
                    <Stack gap="xs">
                      <Text fw={600} size="sm">
                        {editing ? t.courses.editSectionNamed(editing.section_no) : t.courses.newSection}
                      </Text>
                      <Group grow>
                        <NumberInput label={t.courses.sectionNo} min={1} {...form.getInputProps("section_no")} />
                        <NumberInput label={t.courses.expectedStudents} min={1}
                          {...form.getInputProps("expected_students")} />
                      </Group>
                      <Select
                        label={t.courses.lecturerLabel}
                        placeholder={t.courses.pick}
                        searchable
                        filter={turkishOptionsFilter}
                        nothingFoundMessage={t.courses.notFound}
                        data={lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) }))}
                        {...form.getInputProps("lecturer_id")}
                      />
                      {/* Derslik BURADA sorulmaz — haftalık programda yerleştirilirken
                          belirlenir ve şubenin yanında oradan gösterilir. */}
                      <Group>
                        <Button type="submit" size="xs" loading={busy}>
                          {editing ? "Kaydet" : "Ekle"}
                        </Button>
                        <Button size="xs" variant="default" onClick={closeForm}>{t.common.dismiss}</Button>
                      </Group>
                    </Stack>
                  </form>
                </Paper>
              )}
            </Stack>
          </div>
        </Stack>
      </Box>

      {/* Sabit alt eylem çubuğu */}
      <Group gap="xs" p="md" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        {canEdit && (
          <Button size="sm" leftSection={<IconPencil size={15} />}
            onClick={() => onEditCourse(course)}>
            {t.courses.editShort}
          </Button>
        )}
        <Box style={{ flex: 1 }} />
        {canEdit && (
          <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={15} />}
            onClick={() => onDeleteCourse(course)}>
            {t.common.delete}
          </Button>
        )}
      </Group>

      {/* Şube silme onayı */}
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={t.courses.deleteSection}>
        <Text>
          <b>Şube {deleting?.section_no}</b> ({deleting && lecturerLabel(deleting.lecturer)}) silinecek.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Haftalık program girişi olan şube silinemez; önce girişleri kaldırın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>{t.common.dismiss}</Button>
          <Button color="red" loading={busy} onClick={remove}>{t.common.delete}</Button>
        </Group>
      </Modal>
    </Stack>
  );
}
