import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ActionIcon, Alert, Anchor, Avatar, Badge, Box, Button, Checkbox, Divider, Drawer, Group, Loader, Modal, Paper, Popover, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconChevronRight, IconCloudDownload, IconEye, IconEyeOff, IconFilter, IconPencil, IconPlus, IconSearch, IconSelector, IconSortAscending, IconSortDescending, IconTrash, IconX } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ExportMenu from "../components/ExportMenu";
import MiniWeekGrid, { type WeekPlacement } from "../components/MiniWeekGrid";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { formatSlotRange } from "../utils/slots";
import { turkishOptionsFilter } from "../utils/selectSearch";
import { lecturerLabel, type Course, type CourseSection, type Department, type ImportCommit, type ImportPreview, type ImportRow, type Lecturer, type WeeklyEntry } from "../api/types";
import { useT } from "../i18n";

const ALL = "__all__";
/** K-72: yeni satırın bölüm çözümünde "40/a (dış görevli, bölümsüz)" seçeneği. */
const EXT = "__ext__";

/** TÜR segmenti — `is_external` ekseni: Kadrolu (kendi kadrosu) / Dış görevli
 *  (40/a). (K-68: "Ders vermeyen" segmenti kaldırıldı.) */
type Seg = "all" | "staff" | "external";

type SortKey = "name" | "title" | "dep" | "courses";

// Seçilebilir akademik unvanlar (K-52). Backend'in kanonik unvan kümesiyle eş
// tutulur (bkz. app/normalize.py CANONICAL_TITLES). Sıra aynı zamanda kıdem
// sıralamasıdır — UNVAN sütununa göre sıralamada kullanılır.
const TITLES = [
  "Prof. Dr.", "Prof.", "Doç. Dr.", "Doç.", "Dr. Öğr. Üyesi",
  "Öğr. Gör. Dr.", "Öğr. Gör.", "Arş. Gör. Dr.", "Arş. Gör.", "Uzman", "Dr.",
];

/** Unvan rozetinin rengi — mockup'ın TITLE_STYLE'ının Mantine karşılığı. Prefix'e
 *  bakar (backend'de "Prof. Dr." dışında "Prof.", "Öğr. Gör. Dr." gibi varyantlar
 *  da var). */
function titleColor(title: string | null): string {
  const t = title ?? "";
  if (t.startsWith("Prof")) return "violet";
  if (t.startsWith("Doç")) return "blue";
  if (t.startsWith("Dr. Öğr")) return "teal";
  if (t.startsWith("Öğr. Gör")) return "orange";
  if (t.startsWith("Arş. Gör")) return "gray";
  if (t.startsWith("Dr")) return "cyan";
  return "gray";
}

/** Avatar baş harfleri: adın ilk + son kelimesinin baş harfi ("Barış İşçi
 *  Pembeci" → "BP"). Tek kelimeyse ilk iki harf. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase("tr");
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase("tr");
}

/** Bir hocanın türetilmiş istatistikleri — courses+sections üzerinden bir kez
 *  hesaplanır. `hours` = verdiği HER şubenin dersinin T+U+L toplamı (bir dersi
 *  iki şubede veriyorsa iki kez sayılır — gerçek haftalık ders saati budur;
 *  hocada üst sınır alanı olmadığı için yüzde/aşım YOK). */
type LStats = {
  courseIds: Set<number>;
  items: { course: Course; section: CourseSection }[];
  students: number;
  hours: number;
};

type CourseFormValues = {
  title: string;
  full_name: string;
  email: string;
  is_external: boolean;
  department_id: string;
  detail_url: string;
};

export default function LecturersPage() {
  const t = useT();
  const { user } = useAuth();
  // Workgroup geneli paylaşımlı kaynak: bölüm boyutu YOK (K-25).
  const canWrite = canWriteIn(user, "can_manage_lecturers");

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);   // drawer ders kartı slotları için
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  // Bölüm süzgeci Bölümler genel-bakışından ?department_id= ile önceden gelebilir;
  // parametreyi bir kez okuyup URL'den temizliyoruz (yenilemede yapışmasın).
  const [searchParams, setSearchParams] = useSearchParams();
  const [deptFilter, setDeptFilter] = useState<string | null>(
    searchParams.get("department_id"),
  );
  const [titleFilter, setTitleFilter] = useState<string | null>(null);

  // K-65: yeni arayüz süzgeçleri (hepsi istemci tarafı).
  const [seg, setSeg] = useState<Seg>("all");
  const [onlyActive, setOnlyActive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selId, setSelId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lecturer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Lecturer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Fakülte web import (K-50): önizle → seç → onayla.
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  // K-72: her yeni satırın bölüm çözümü. detail_url -> bölüm id ("5") | 40/a (EXT) | "" (çözülmedi).
  const [rowDept, setRowDept] = useState<Record<string, string>>({});
  const [selectedUpdates, setSelectedUpdates] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);

  // K-52: title (unvan) ve email AYRI alanlar — full_name'e gömülmez.
  const form = useForm<CourseFormValues>({
    initialValues: {
      title: "", full_name: "", email: "", is_external: false, department_id: "",
      detail_url: "",
    },
    validate: {
      full_name: (v) => (v.trim() ? null : t.lecturers.nameRequired),
      department_id: (v, values) => (values.is_external || v ? null : t.lecturers.pickUnit),
      email: (v) => (!v.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
        ? null : t.lecturers.invalidEmail),
      detail_url: (v) => (!v.trim() || /^https?:\/\/\S+$/.test(v.trim())
        ? null : t.lecturers.invalidUrl),
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [lecs, crs, deps, wk] = await Promise.all([
        api.get<Lecturer[]>("/lecturers?include_inactive=true"),   // K-28: pasifler de
        api.get<Course[]>("/courses"),
        api.get<Department[]>("/departments"),
        api.get<WeeklyEntry[]>("/weekly-entries"),
      ]);
      setLecturers(lecs);
      setCourses(crs);
      setDepartments(deps);
      setWeekly(wk);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Deep-link parametrelerini bir kez tüket. ?add=1 → ekleme formunu açık getir.
  useEffect(() => {
    if (!searchParams.has("department_id") && !searchParams.has("add")) return;
    if (searchParams.get("add") === "1") {
      openAdd(searchParams.get("department_id") ?? undefined);
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

  /** Şube id → haftalık program girişleri (yayındakiler). */
  const entriesBySection = useMemo(() => {
    const m: Record<number, WeeklyEntry[]> = {};
    for (const e of weekly) (m[e.section.id] ??= []).push(e);
    for (const list of Object.values(m)) {
      list.sort((a, b) => a.day_of_week - b.day_of_week || a.start_slot - b.start_slot);
    }
    return m;
  }, [weekly]);

  // Hoca başına türetilmiş istatistikler. Bir hoca aynı dersin iki şubesine
  // giriyorsa DERS tekildir (Set) ama ŞUBE ikidir (items).
  const statsByLecturer = useMemo(() => {
    const acc: Record<number, LStats> = {};
    for (const c of courses) {
      for (const s of c.sections) {
        const e = (acc[s.lecturer.id] ??= { courseIds: new Set(), items: [], students: 0, hours: 0 });
        e.courseIds.add(c.id);
        e.items.push({ course: c, section: s });
        e.students += s.expected_students;
        e.hours += c.hours_theory + c.hours_practice + c.hours_lab;
      }
    }
    return acc;
  }, [courses]);

  /** Kadro birimi etiketi: asli bölüm "KOD - Ad" (department_id → "CENG -
   *  Bilgisayar Mühendisliği"), yoksa import'tan gelen kadro/görev birimi metni,
   *  o da yoksa "—". */
  function depLabelOf(l: Lecturer): string {
    if (l.department_id != null) {
      const d = depById[l.department_id];
      return d ? `${d.code} - ${d.name}` : "—";
    }
    return l.cadre_unit || l.duty_unit || "—";
  }

  /** K-68: görev birimi = hocanın verdiği ORTAK OLMAYAN derslerin bölümleri
   *  (türetilir). Ortak dersler çok bölümlü olduğu için görev birimi belirtmez. */
  function dutyUnitsOf(l: Lecturer): string[] {
    const stats = statsByLecturer[l.id];
    if (!stats) return [];
    const names = new Set<string>();
    for (const { course } of stats.items) {
      if (course.is_common) continue;
      const d = depById[course.department_id];
      if (d) names.add(d.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "tr"));
  }

  function sortValue(l: Lecturer, key: SortKey): string | number {
    switch (key) {
      case "title": {
        const i = TITLES.indexOf(l.title ?? "");
        return i === -1 ? 999 : i;
      }
      case "dep": return depLabelOf(l);
      case "courses": return statsByLecturer[l.id]?.courseIds.size ?? 0;
      default: return l.normalized_name;
    }
  }

  // K-65: tek liste. Arama + segment + bölüm/unvan (popover) + pasif süzgeci,
  // sonra aktif sütuna göre sıralama.
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const depId = deptFilter ? Number(deptFilter) : null;
    let list = lecturers.filter((l) => {
      // K-52: unvan+ad birlikte + e-posta aransın.
      if (q) {
        const hay = `${lecturerLabel(l)} ${l.email ?? ""}`.toLocaleLowerCase("tr");
        if (!hay.includes(q)) return false;
      }
      if (seg === "staff" && l.is_external) return false;
      if (seg === "external" && !l.is_external) return false;
      if (depId !== null && l.department_id !== depId) return false;
      if (titleFilter && l.title !== titleFilter) return false;
      if (onlyActive && !l.active) return false;
      return true;
    });
    const dir = sortDir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => {
      const va = sortValue(a, sortBy), vb = sortValue(b, sortBy);
      let cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "tr");
      if (cmp === 0) cmp = a.normalized_name.localeCompare(b.normalized_name, "tr");
      return cmp * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecturers, query, deptFilter, titleFilter, seg, onlyActive, sortBy, sortDir, statsByLecturer, depById]);

  const countLabel = t.lecturers.personCount(rows.length);

  const selected = useMemo(
    () => lecturers.find((l) => l.id === selId) ?? null, [lecturers, selId]);

  const handleSelect = useCallback((id: number) => setSelId(id), []);

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    // Sayısal sütun (ders) ilk tık ÇOKTAN AZA; metin sütunları alfabetik.
    else { setSortBy(key); setSortDir(key === "courses" ? "desc" : "asc"); }
  }

  // Aktif süzgeç çipleri (Bölüm/Unvan/Pasif). Arama ve segment çip olmaz.
  const chips = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    if (deptFilter) {
      const d = depById[Number(deptFilter)];
      out.push({ key: "dep", label: d ? `${d.code} — ${d.name}` : t.lecturers.department,
        clear: () => setDeptFilter(null) });
    }
    if (titleFilter) out.push({ key: "title", label: titleFilter, clear: () => setTitleFilter(null) });
    if (onlyActive) out.push({ key: "active", label: "Pasifler gizli", clear: () => setOnlyActive(false) });
    return out;
  }, [deptFilter, titleFilter, onlyActive, depById]);

  const hasFilters = chips.length > 0;
  function clearAllFilters() {
    setDeptFilter(null); setTitleFilter(null); setOnlyActive(false);
  }

  function openAdd(departmentId?: string) {
    setEditing(null);
    form.setValues({
      title: "", full_name: "", email: "", is_external: false,
      department_id: departmentId ?? "", detail_url: "",
    });
    setModalOpen(true);
  }

  function openEdit(lec: Lecturer) {
    setEditing(lec);
    form.setValues({
      title: lec.title ?? "",
      full_name: lec.full_name,
      email: lec.email ?? "",
      is_external: lec.is_external,
      department_id: lec.department_id != null ? String(lec.department_id) : "",
      detail_url: lec.detail_url ?? "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(values: CourseFormValues) {
    setSubmitting(true);
    const payload = {
      full_name: values.full_name.trim(),
      title: values.title || null,
      email: values.email.trim() || null,
      is_external: values.is_external,
      department_id: values.department_id ? Number(values.department_id) : null,
      detail_url: values.detail_url.trim() || null,
    };
    try {
      if (editing) {
        await api.patch<Lecturer>(`/lecturers/${editing.id}`, payload);
        notifications.show({ color: "green", message: t.lecturers.updated });
      } else {
        await api.post<Lecturer>("/lecturers", payload);
        notifications.show({ color: "green", message: t.lecturers.created });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setFieldError("full_name", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(lec: Lecturer) {
    try {
      await api.patch<Lecturer>(`/lecturers/${lec.id}`, { active: !lec.active });
      notifications.show({
        color: "green",
        message: lec.active
          ? t.lecturers.deactivated
          : t.lecturers.reactivated,
      });
      await load();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/lecturers/${deleting.id}`);
      notifications.show({ color: "green", message: t.lecturers.deleted });
      if (selId === deleting.id) setSelId(null);
      setDeleting(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : t.common.actionFailed,
        autoClose: 7000,
      });
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  // "İçe Aktar" → fakülte sayfasını tara, sistemde OLMAYANLARI getir.
  async function runImportPreview() {
    setImportOpen(true);
    setImportLoading(true);
    setImportError(null);
    setPreview(null);
    try {
      const data = await api.post<ImportPreview>("/lecturers/import/preview");
      setPreview(data);
      setSelectedRows(new Set(data.new.map((r) => r.detail_url)));
      // K-72: eşleşen satırın bölümü ön-dolu; eşleşmeyen boş (kullanıcı çözecek).
      const init: Record<string, string> = {};
      for (const r of data.new) init[r.detail_url] = r.department_id != null ? String(r.department_id) : "";
      setRowDept(init);
      setSelectedUpdates(new Set(data.updates.map((u) => u.id)));
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : t.lecturers.importFailed);
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportCommit() {
    if (!preview) return;
    // K-72: yalnız SEÇİLİ ve ÇÖZÜLMÜŞ (bölüm ya da 40/a) yeni satırlar gider.
    const rowsToCommit: ImportRow[] = [];
    for (const r of preview.new) {
      if (!selectedRows.has(r.detail_url)) continue;
      const res = rowDept[r.detail_url] ?? "";
      if (res === "") continue;                          // çözülmemiş → atla
      if (res === EXT) rowsToCommit.push({ ...r, is_external: true, department_id: null });
      else rowsToCommit.push({ ...r, is_external: false, department_id: Number(res) });
    }
    const updatesToCommit = preview.updates.filter((u) => selectedUpdates.has(u.id));
    if (rowsToCommit.length === 0 && updatesToCommit.length === 0) return;
    setCommitting(true);
    try {
      const res = await api.post<ImportCommit>("/lecturers/import/commit",
        { rows: rowsToCommit, updates: updatesToCommit });
      const parts: string[] = [];
      if (res.created.length) parts.push(`${res.created.length} eklendi`);
      if (res.updated.length) parts.push(t.lecturers.nUpdated(res.updated.length));
      if (res.skipped.length) parts.push(t.lecturers.nSkipped(res.skipped.length));
      notifications.show({ color: "green", message: parts.join(" · ") || t.lecturers.noChange });
      setImportOpen(false);
      await load();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.lecturers.importFailed });
    } finally {
      setCommitting(false);
    }
  }

  function setRowResolution(url: string, value: string) {
    setRowDept((prev) => ({ ...prev, [url]: value }));
  }

  function toggleUpdateRow(id: number) {
    setSelectedUpdates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleImportRow(url: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  /** Sıralanabilir başlık — K-65'teki gibi bileşen değil fonksiyon (gereksiz
   *  remount olmasın). */
  function sortTh(label: string, k: SortKey, w?: number, align?: "center") {
    const on = sortBy === k;
    const Arrow = !on ? IconSelector : sortDir === "asc" ? IconSortAscending : IconSortDescending;
    return (
      <Table.Th
        w={w}
        onClick={() => toggleSort(k)}
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

  if (loading) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" align="baseline" mb="md">
        <Group align="baseline" gap="xs">
          <Title order={3}>{t.lecturers.title}</Title>
          <Text size="sm" c="dimmed">{countLabel}</Text>
        </Group>
        {canWrite && (
          <Group gap="xs">
            <Tooltip label={t.lecturers.importTip}>
              <Button variant="default" leftSection={<IconCloudDownload size={16} />} onClick={runImportPreview}>
                {t.lecturers.importCta}
              </Button>
            </Tooltip>
            <Button leftSection={<IconPlus size={16} />} onClick={() => openAdd()}>
              {t.lecturers.add}
            </Button>
          </Group>
        )}
      </Group>

      {/* Süzgeç çubuğu */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" wrap="nowrap" align="center">
          <TextInput
            placeholder={t.lecturers.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            w={260}
            style={{ flex: "none" }}
          />

          <SegmentedControl
            value={seg}
            onChange={(v) => setSeg(v as Seg)}
            data={[
              { label: t.common.all, value: "all" },
              { label: "Kadrolu", value: "staff" },
              { label: t.lecturers.external, value: "external" },
            ]}
            size="sm"
            style={{ flex: "none" }}
          />

          <Popover opened={filtersOpen} onChange={setFiltersOpen} position="bottom-start"
            width={480} shadow="md" withArrow>
            <Popover.Target>
              <Button variant="default" onClick={() => setFiltersOpen((o) => !o)}
                leftSection={<IconFilter size={16} />} style={{ flex: "none" }}>
                Filtre
                {hasFilters && <Badge size="sm" circle ml={6} variant="filled">{chips.length}</Badge>}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <SimpleGrid cols={2} spacing="sm">
                <Select
                  label={t.lecturers.department}
                  data={[{ value: ALL, label: t.lecturers.allDepartments },
                    ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]}
                  value={deptFilter ?? ALL}
                  onChange={(v) => setDeptFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
                <Select
                  label={t.lecturers.titleLabel}
                  data={[{ value: ALL, label: t.lecturers.allTitles },
                    ...TITLES.map((t) => ({ value: t, label: t }))]}
                  value={titleFilter ?? ALL}
                  onChange={(v) => setTitleFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
              </SimpleGrid>
              <Group justify="space-between" mt="md" pt="sm"
                style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                <Checkbox
                  label={t.lecturers.hideInactive}
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.currentTarget.checked)}
                />
                <Button variant="default" size="xs" onClick={() => setFiltersOpen(false)}>{t.common.close}</Button>
              </Group>
            </Popover.Dropdown>
          </Popover>

          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {chips.map((ch) => (
              <Badge key={ch.key} variant="light" color="gray" size="lg"
                style={{ flex: "none", cursor: "pointer", textTransform: "none" }}
                rightSection={<IconX size={13} style={{ display: "block" }} />}
                onClick={ch.clear}>
                {ch.label}
              </Badge>
            ))}
            {hasFilters && (
              <Button variant="subtle" size="compact-xs" onClick={clearAllFilters} style={{ flex: "none" }}>
                Temizle
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {/* Tablo */}
      {rows.length === 0 ? (
        <Text c="dimmed" mt="xl" ta="center">
          {query || hasFilters || seg !== "all"
            ? t.lecturers.noMatch
            : t.lecturers.empty}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={820} mt="sm">
          <Table striped highlightOnHover verticalSpacing="xs" withTableBorder layout="fixed">
            <Table.Thead>
              <Table.Tr>
                {/* K-71: Ad Soyad'a da genişlik verildi. Eskiden tek genişliksiz
                    sütun olduğu için tüm boşluğu yutup tablonun yarısını kaplıyordu;
                    artık boşluk tüm sütunlara oranlı dağılır, diğerleri sıkışmaz. */}
                {sortTh("Ad Soyad", "name", 280)}
                {sortTh("Unvan", "title", 150)}
                {sortTh("Kadro birimi", "dep", 200)}
                <Table.Th w={220}>{t.auth.email}</Table.Th>
                {sortTh("Ders", "courses", 110, "center")}
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((l) => (
                <LecturerRow
                  key={l.id}
                  lecturer={l}
                  depLabel={depLabelOf(l)}
                  courseCount={statsByLecturer[l.id]?.courseIds.size ?? 0}
                  selected={l.id === selId}
                  onSelect={handleSelect}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {/* Detay Drawer'ı */}
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
          <LecturerDrawerBody
            lecturer={selected}
            depLabel={depLabelOf(selected)}
            dutyUnits={dutyUnitsOf(selected)}
            stats={statsByLecturer[selected.id]}
            entriesBySection={entriesBySection}
            canWrite={canWrite}
            onEdit={openEdit}
            onToggleActive={toggleActive}
            onDelete={setDeleting}
            onClose={() => setSelId(null)}
          />
        )}
      </Drawer>

      {/* Ekle/Düzenle formu */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t.lecturers.edit : t.lecturers.newOne}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <Select label={t.lecturers.titleLabel} placeholder={t.lecturers.optional}
              // Kanonik listede olmayan bir unvan da (eski/import kaydı) seçili
              // görünsün — aksi halde Select boş kalırdı.
              data={form.values.title && !TITLES.includes(form.values.title)
                ? [form.values.title, ...TITLES] : TITLES}
              clearable
              searchable filter={turkishOptionsFilter} {...form.getInputProps("title")} />
            <TextInput label={t.lecturers.fullName} placeholder={t.lecturers.namePlaceholder} {...form.getInputProps("full_name")} />
            <TextInput label={t.auth.email} placeholder={t.lecturers.emailPlaceholder} {...form.getInputProps("email")} />
            <Select
              label={t.lecturers.homeUnit}
              placeholder={t.lecturers.pickUnitLong}
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))}
              searchable clearable filter={turkishOptionsFilter}
              {...form.getInputProps("department_id")}
            />
            <TextInput
              label={t.lecturers.detailPage}
              placeholder="https://…  (opsiyonel)"
              {...form.getInputProps("detail_url")}
            />
            <Checkbox label={t.lecturers.external40a} {...form.getInputProps("is_external", { type: "checkbox" })} />
            <Button type="submit" loading={submitting} mt="sm">
              {editing ? t.common.save : t.common.add}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* Silme onayı */}
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={t.lecturers.deleteModal}>
        <Text>
          <b>{deleting?.full_name}</b> {t.common.permanentDeleteWarning}
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          {t.lecturers.deleteHint}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>{t.common.dismiss}</Button>
          <Button color="red" loading={deleteBusy} onClick={handleDelete}>{t.common.delete}</Button>
        </Group>
      </Modal>

      {/* Siteden içe aktarma */}
      <Modal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        title={t.lecturers.importTitle}
        size="xl"
      >
        {importLoading ? (
          <Group justify="center" py="xl" gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">{t.lecturers.scanning}</Text>
          </Group>
        ) : importError ? (
          <Alert color="red" title={t.lecturers.importFailed}>
            {importError}
            <Text size="xs" c="dimmed" mt="xs">
              {t.lecturers.scanFailHint}
            </Text>
          </Alert>
        ) : preview ? (() => {
          const deptOptions = [
            // K-74: "bölümsüz" YANLIŞTI — 40/a başka fakültede kadrolu kişidir
            // (Matematik/Fizik gibi servis derslerini verenler); bizim
            // bölümlerimizden birine ait olmaması onları "bölümsüz" yapmaz.
            { value: EXT, label: t.lecturers.external40aOption },
            ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` })),
          ];
          const committableNew = preview.new.filter(
            (r) => selectedRows.has(r.detail_url) && (rowDept[r.detail_url] ?? "") !== "").length;
          const unresolvedSel = preview.new.filter(
            (r) => selectedRows.has(r.detail_url) && (rowDept[r.detail_url] ?? "") === "").length;
          const totalToCommit = committableNew + selectedUpdates.size;
          return (
          <Stack>
            <Text size="sm" c="dimmed">
              {t.lecturers.foundSummary(preview.list_total, preview.already_present,
                                       preview.new.length)}
              {preview.updates.length > 0 && (
                <Text span fw={700} c="blue">
                  {t.lecturers.updatableSuffix(preview.updates.length)}
                </Text>
              )}
            </Text>

            {preview.new.length === 0 && preview.updates.length === 0 ? (
              <Text c="dimmed" py="md">
                {t.lecturers.nothingToImport}
              </Text>
            ) : (
              <>
                {preview.new.length > 0 && (
                  <>
                    <Divider label={t.lecturers.newLecturers} labelPosition="left" />
                    <Group justify="space-between">
                      <Checkbox
                        label={t.lecturers.selectAll}
                        checked={selectedRows.size === preview.new.length}
                        indeterminate={selectedRows.size > 0 && selectedRows.size < preview.new.length}
                        onChange={(e) =>
                          setSelectedRows(
                            e.currentTarget.checked
                              ? new Set(preview.new.map((r) => r.detail_url))
                              : new Set(),
                          )
                        }
                      />
                      <Text size="sm" c="dimmed">{selectedRows.size} {t.lecturers.selected}</Text>
                    </Group>

                    <ScrollArea.Autosize mah={360}>
                      <Table stickyHeader verticalSpacing="xs">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th w={36} />
                            <Table.Th>{t.lecturers.titleLabel}</Table.Th>
                            <Table.Th>{t.lecturers.fullName}</Table.Th>
                            <Table.Th>{t.lecturers.homeUnitCaps}</Table.Th>
                            <Table.Th w={230}>{t.lecturers.department}</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {preview.new.map((row) => {
                            const sel = selectedRows.has(row.detail_url);
                            const res = rowDept[row.detail_url] ?? "";
                            return (
                              <Table.Tr key={row.detail_url}>
                                <Table.Td>
                                  <Checkbox
                                    checked={sel}
                                    onChange={() => toggleImportRow(row.detail_url)}
                                  />
                                </Table.Td>
                                <Table.Td><Text size="xs" c="dimmed">{row.title ?? "—"}</Text></Table.Td>
                                <Table.Td>
                                  <Anchor href={row.detail_url} target="_blank" size="sm">{row.full_name}</Anchor>
                                </Table.Td>
                                <Table.Td>
                                  {/* K-71: yalnız kadro birimi (görev birimi derslerden türetilir). */}
                                  <Text size="xs" c={row.cadre_unit ? undefined : "dimmed"}>
                                    {row.cadre_unit ?? "—"}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  {/* K-72: kadrodan eşleşen bölüm ön-dolu; eşleşmeyende
                                      kullanıcı bölüm seçer ya da 40/a işaretler. */}
                                  <Select
                                    size="xs"
                                    placeholder={t.lecturers.departmentOr40a}
                                    data={deptOptions}
                                    value={res || null}
                                    onChange={(v) => setRowResolution(row.detail_url, v ?? "")}
                                    searchable
                                    filter={turkishOptionsFilter}
                                    error={sel && res === "" ? true : undefined}
                                    comboboxProps={{ withinPortal: true }}
                                  />
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea.Autosize>
                  </>
                )}

                {preview.updates.length > 0 && (
                  <>
                    <Divider label={t.lecturers.missingInfoTitle} labelPosition="left" mt="sm" />
                    <Text size="xs" c="dimmed">
                      {t.lecturers.missingInfoHelp1}{" "}
                      {t.lecturers.missingInfoHelp2}
                    </Text>
                    <Stack gap={4}>
                      {preview.updates.map((u) => (
                        <Checkbox
                          key={u.id}
                          checked={selectedUpdates.has(u.id)}
                          onChange={() => toggleUpdateRow(u.id)}
                          label={
                            <Text size="sm">
                              {u.full_name}{" "}
                              <Text span size="xs" c="dimmed">{t.lecturers.willBeFilled(u.missing.join(" · "))}</Text>
                            </Text>
                          }
                        />
                      ))}
                    </Stack>
                  </>
                )}

                {unresolvedSel > 0 && (
                  <Text size="xs" c="orange.7">
                    {t.lecturers.unresolvedWarn(unresolvedSel)}
                  </Text>
                )}

                <Group justify="flex-end" mt="sm">
                  <Button variant="default" onClick={() => setImportOpen(false)}>{t.common.dismiss}</Button>
                  <Button loading={committing} disabled={totalToCommit === 0} onClick={handleImportCommit}>
                    {committableNew > 0 && `${committableNew} ekle`}
                    {committableNew > 0 && selectedUpdates.size > 0 && " · "}
                    {selectedUpdates.size > 0 && t.lecturers.updateN(selectedUpdates.size)}
                    {totalToCommit === 0 && "Uygula"}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
          );
        })() : null}
      </Modal>
    </>
  );
}

/** Tek hoca satırı — K-65'teki gibi `memo`; arama/seçim tüm listeyi değil yalnız
 *  değişen satırı yeniden çizsin. */
const LecturerRow = memo(function LecturerRow({
  lecturer: l, depLabel, courseCount, selected, onSelect,
}: {
  lecturer: Lecturer; depLabel: string; courseCount: number;
  selected: boolean; onSelect: (id: number) => void;
}) {
  const t = useT();
  return (
    <Table.Tr
      onClick={() => onSelect(l.id)}
      style={{
        cursor: "pointer",
        opacity: l.active ? 1 : 0.55,
        background: selected ? "var(--mantine-color-blue-light)" : undefined,
      }}
    >
      <Table.Td>
        <Group gap={9} wrap="nowrap" style={{ minWidth: 0 }}>
          <Avatar radius="xl" size={26} color="gray">
            <Text size="10px" fw={700}>{initialsOf(l.full_name)}</Text>
          </Avatar>
          <Text size="sm" truncate>{l.full_name}</Text>
          {l.is_external && (
            <Tooltip label={t.lecturers.external40a}>
              <Badge variant="light" color="orange" size="xs" style={{ flex: "none" }}>40/a</Badge>
            </Tooltip>
          )}
          {!l.active && <Badge size="xs" color="gray" style={{ flex: "none" }}>{t.lecturers.inactive}</Badge>}
        </Group>
      </Table.Td>
      <Table.Td>
        {l.title
          ? <Badge variant="light" color={titleColor(l.title)} size="sm" style={{ textTransform: "none" }}>{l.title}</Badge>
          : <Text size="sm" c="dimmed">—</Text>}
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed" truncate>{depLabel}</Text>
      </Table.Td>
      <Table.Td>
        {l.email
          ? <Text size="xs" c="dimmed" truncate>{l.email}</Text>
          : <Text size="sm" c="dimmed">—</Text>}
      </Table.Td>
      <Table.Td ta="center" c={courseCount ? undefined : "dimmed"} style={{ fontVariantNumeric: "tabular-nums" }}>
        {courseCount === 0 ? "—" : `${courseCount} ders`}
      </Table.Td>
      <Table.Td ta="right">
        <IconChevronRight size={15} style={{ color: "var(--mantine-color-gray-5)" }} />
      </Table.Td>
    </Table.Tr>
  );
});

/** Drawer içi tek istatistik hücresi. `value` metin ya da (link gibi) düğüm
 *  olabilir; metinse tabular-nums ile hizalanır. */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Paper withBorder p="xs" radius="sm">
      <Text size="xs" c="dimmed" fw={600}>{label}</Text>
      {typeof value === "string" || typeof value === "number" ? (
        <Text size="sm" mt={2} truncate style={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
      ) : (
        <Box mt={2}>{value}</Box>
      )}
    </Paper>
  );
}

/** Öğretim üyesi detay Drawer'ının gövdesi — künye, istatistik ızgarası, verdiği
 *  dersler (gerçek yayın slotlarıyla) ve alt eylem çubuğu. Mockup'taki müsaitlik
 *  ızgarası + kısıtlar backend'de veri olmadığı için YOK (uydurulmadı). */
function LecturerDrawerBody({
  lecturer: l, depLabel, dutyUnits, stats, entriesBySection, canWrite,
  onEdit, onToggleActive, onDelete, onClose,
}: {
  lecturer: Lecturer;
  depLabel: string;
  /** K-68: görev birimi/birimleri — verdiği (ortak olmayan) derslerin bölümleri. */
  dutyUnits: string[];
  stats?: LStats;
  entriesBySection: Record<number, WeeklyEntry[]>;
  canWrite: boolean;
  onEdit: (l: Lecturer) => void;
  onToggleActive: (l: Lecturer) => void;
  onDelete: (l: Lecturer) => void;
  onClose: () => void;
}) {
  const t = useT();
  const items = stats?.items ?? [];
  const courseCount = stats?.courseIds.size ?? 0;
  const hours = stats?.hours ?? 0;

  // Haftalık ızgara: verdiği şubelerin yayındaki yerleşimleri (gün-slot).
  const placements: WeekPlacement[] = [];
  for (const { course, section } of items) {
    for (const e of entriesBySection[section.id] ?? []) {
      placements.push({
        day: e.day_of_week, startSlot: e.start_slot, slotCount: e.slot_count,
        label: course.code, title: `${course.code} · ${t.classrooms.section} ${section.section_no}`,
      });
    }
  }

  return (
    <Stack gap={0} h="100%">
      {/* Künye */}
      <Group justify="space-between" align="flex-start" wrap="nowrap"
        p="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap={11} wrap="nowrap" style={{ minWidth: 0 }}>
          <Avatar radius="xl" size={38} color="gray">
            <Text size="sm" fw={700}>{initialsOf(l.full_name)}</Text>
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Group gap={8} align="center">
              <Text fw={700} size="lg">{l.full_name}</Text>
              {l.title && (
                <Badge variant="light" color={titleColor(l.title)} size="sm" style={{ textTransform: "none" }}>
                  {l.title}
                </Badge>
              )}
              {l.is_external && <Badge variant="light" color="orange" size="sm">40/a</Badge>}
              {!l.active && <Badge color="gray" size="sm">{t.lecturers.inactive}</Badge>}
            </Group>
            {/* K-71: bölüm adı burada değil, aşağıdaki "Kadro birimi" stat'ında —
                iki yerde yazmasın. Alt satırda yalnız e-posta. */}
            {l.email && (
              <Text size="sm" c="dimmed" mt={2} truncate>{l.email}</Text>
            )}
          </div>
        </Group>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label={t.common.close}>
          <IconX size={18} />
        </ActionIcon>
      </Group>

      {/* Gövde */}
      <Box style={{ flex: 1, overflowY: "auto" }} p="md">
        <Stack gap="lg">
          <SimpleGrid cols={4} spacing="xs">
            <Stat label={t.lecturers.course} value={String(courseCount)} />
            {/* K-71: Şube sayacı yerine kadro birimi (asli bölüm adı). */}
            <Stat label={t.lecturers.homeUnit} value={depLabel} />
            <Stat label={t.lecturers.weeklyHours} value={`${hours} sa`} />
            {/* K-71: Öğrenci sayacı yerine akademik personel sayfası linki. */}
            <Stat label={t.lecturers.detailPage} value={
              l.detail_url
                ? <Anchor href={l.detail_url} target="_blank" rel="noopener noreferrer" size="sm">{t.lecturers.openLink}</Anchor>
                : <Text size="sm" c="dimmed">—</Text>
            } />
          </SimpleGrid>

          {/* K-68: görev birimi = verdiği (ortak olmayan) derslerin bölümleri.
              Kadro birimi künyede (depLabel); bu türetilmiş. */}
          {dutyUnits.length > 0 && (
            <div>
              <Text size="xs" fw={600} c="dimmed" mb={8}>{t.lecturers.unit}</Text>
              <Group gap={6}>
                {dutyUnits.map((u) => (
                  <Badge key={u} variant="light" color="blue" style={{ textTransform: "none" }}>{u}</Badge>
                ))}
              </Group>
            </div>
          )}

          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>{t.lecturers.weeklyScheduleLabel}</Text>
            <MiniWeekGrid placements={placements} emptyLabel={t.lecturers.noCoursesThisTerm} />
          </div>

          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>{t.lecturers.coursesTaught}</Text>
            <Stack gap="xs">
              {items.map(({ course, section }) => {
                const entries = entriesBySection[section.id] ?? [];
                return (
                  <Paper key={section.id} withBorder radius="md" p="sm">
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" truncate>
                          <Text span fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>{course.code}</Text>
                          {" · "}{course.name}
                        </Text>
                        <Text size="xs" c="dimmed" mt={2}>
                          {t.lecturers.sectionStudents(section.section_no,
                                                     section.expected_students)}
                        </Text>
                      </div>
                      {entries.length === 0 ? (
                        <Text size="xs" c="orange.7" style={{ flex: "none" }}>{t.lecturers.notScheduled}</Text>
                      ) : (
                        // K-68: slotlar üst üste — çok günlü ders yan yana sıralanınca
                        // tüm satırı kaplayıp çirkin duruyordu.
                        <Stack gap={4} align="flex-end" style={{ flex: "none" }}>
                          {entries.map((e) => (
                            <Badge key={e.id} variant="light" size="sm" color="green">
                              {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count, "short")}
                            </Badge>
                          ))}
                        </Stack>
                      )}
                    </Group>
                  </Paper>
                );
              })}
              {items.length === 0 && (
                <Paper withBorder radius="md" p="md" style={{ borderStyle: "dashed" }}>
                  <Text size="sm" c="dimmed" ta="center">{t.lecturers.noAssignedCourses}</Text>
                </Paper>
              )}
            </Stack>
          </div>
        </Stack>
      </Box>

      {/* Alt eylem çubuğu */}
      <Group gap="xs" p="md" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        {canWrite && (
          <Button size="sm" leftSection={<IconPencil size={15} />} onClick={() => onEdit(l)}>
            {t.lecturers.editInfo}
          </Button>
        )}
        {/* K-67: hocanın haftalık programı burada; export'u da burada
            (/export/weekly lecturer_id filtresini kabul eder). */}
        <ExportMenu label={t.lecturers.downloadSchedule} items={[
          { label: "Excel (.xlsx)", path: `/export/weekly?lecturer_id=${l.id}&format=xlsx` },
          { label: "CSV (.csv)", path: `/export/weekly?lecturer_id=${l.id}&format=csv` },
        ]} />
        <Box style={{ flex: 1 }} />
        {canWrite && (
          <Tooltip label={l.active ? "Pasife al" : t.lecturers.activate}>
            <ActionIcon variant="subtle" size="lg" color={l.active ? "orange" : "green"}
              onClick={() => onToggleActive(l)} aria-label={l.active ? "Pasife al" : t.lecturers.activate}>
              {l.active ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {canWrite && (
          <Tooltip label={t.common.delete}>
            <ActionIcon variant="subtle" size="lg" color="red"
              onClick={() => onDelete(l)} aria-label={t.common.delete}>
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Stack>
  );
}
