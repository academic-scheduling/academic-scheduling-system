import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Anchor, Avatar, Badge, Box, Button, Checkbox, Divider, Drawer,
  Group, Loader, Modal, Paper, Popover, ScrollArea, SegmentedControl, Select,
  SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconChevronRight, IconCloudDownload, IconEye, IconEyeOff,
  IconFilter, IconPencil, IconPlus, IconSearch, IconSelector, IconSortAscending,
  IconSortDescending, IconTrash, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ExportMenu from "../components/ExportMenu";
import MiniWeekGrid, { type WeekPlacement } from "../components/MiniWeekGrid";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { formatSlotRange } from "../utils/slots";
import { turkishOptionsFilter } from "../utils/selectSearch";
import {
  lecturerLabel,
  type Course, type CourseSection, type Department, type ImportCommit,
  type ImportPreview, type Lecturer, type WeeklyEntry,
} from "../api/types";

const ALL = "__all__";

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
};

export default function LecturersPage() {
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
  const [committing, setCommitting] = useState(false);

  // K-52: title (unvan) ve email AYRI alanlar — full_name'e gömülmez.
  const form = useForm<CourseFormValues>({
    initialValues: {
      title: "", full_name: "", email: "", is_external: false, department_id: "",
    },
    validate: {
      full_name: (v) => (v.trim() ? null : "Ad soyad boş olamaz"),
      department_id: (v, values) => (values.is_external || v ? null : "Kadro birimi seçin"),
      email: (v) => (!v.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
        ? null : "Geçerli bir e-posta girin"),
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
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
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

  /** Kadro birimi etiketi: asli bölüm adı (department_id), yoksa import'tan gelen
   *  kadro/görev birimi metni, o da yoksa "—". */
  function depLabelOf(l: Lecturer): string {
    if (l.department_id != null) return depById[l.department_id]?.name ?? "—";
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

  const teachingCount = useMemo(
    () => rows.filter((l) => (statsByLecturer[l.id]?.courseIds.size ?? 0) > 0).length,
    [rows, statsByLecturer]);
  const countLabel = `${rows.length} kişi · ${teachingCount} ders veren`;

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
      out.push({ key: "dep", label: d ? `${d.code} — ${d.name}` : "Bölüm",
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
      department_id: departmentId ?? "",
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
    };
    try {
      if (editing) {
        await api.patch<Lecturer>(`/lecturers/${editing.id}`, payload);
        notifications.show({ color: "green", message: "Öğretim üyesi güncellendi" });
      } else {
        await api.post<Lecturer>("/lecturers", payload);
        notifications.show({ color: "green", message: "Öğretim üyesi eklendi" });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setFieldError("full_name", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
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
          ? "Pasife alındı — ders formunda artık önerilmez"
          : "Yeniden aktifleştirildi",
      });
      await load();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/lecturers/${deleting.id}`);
      notifications.show({ color: "green", message: "Öğretim üyesi silindi" });
      if (selId === deleting.id) setSelId(null);
      setDeleting(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
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
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : "İçe aktarma başarısız");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportCommit() {
    if (!preview) return;
    const rowsToCommit = preview.new.filter((r) => selectedRows.has(r.detail_url));
    if (rowsToCommit.length === 0) return;
    setCommitting(true);
    try {
      const res = await api.post<ImportCommit>("/lecturers/import/commit", { rows: rowsToCommit });
      const parts = [`${res.created.length} öğretim üyesi eklendi`];
      if (res.skipped.length) parts.push(`${res.skipped.length} atlandı (zaten kayıtlı)`);
      notifications.show({ color: "green", message: parts.join(" · ") });
      setImportOpen(false);
      await load();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İçe aktarma başarısız" });
    } finally {
      setCommitting(false);
    }
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
          <Title order={3}>Öğretim Üyeleri</Title>
          <Text size="sm" c="dimmed">{countLabel}</Text>
        </Group>
        {canWrite && (
          <Group gap="xs">
            <Tooltip label="Fakülte akademik personel sayfasından yeni öğretim üyelerini getir">
              <Button variant="default" leftSection={<IconCloudDownload size={16} />} onClick={runImportPreview}>
                İçe Aktar
              </Button>
            </Tooltip>
            <Button leftSection={<IconPlus size={16} />} onClick={() => openAdd()}>
              Öğretim Üyesi Ekle
            </Button>
          </Group>
        )}
      </Group>

      {/* Süzgeç çubuğu */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" wrap="nowrap" align="center">
          <TextInput
            placeholder="Ad, soyad veya e-posta ara"
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
              { label: "Tümü", value: "all" },
              { label: "Kadrolu", value: "staff" },
              { label: "Dış görevli", value: "external" },
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
                  label="Bölüm"
                  data={[{ value: ALL, label: "Tüm bölümler" },
                    ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]}
                  value={deptFilter ?? ALL}
                  onChange={(v) => setDeptFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
                <Select
                  label="Unvan"
                  data={[{ value: ALL, label: "Tüm unvanlar" },
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
                  label="Pasif kayıtları gizle"
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.currentTarget.checked)}
                />
                <Button variant="default" size="xs" onClick={() => setFiltersOpen(false)}>Kapat</Button>
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
            ? "Filtreye uyan öğretim üyesi yok."
            : "Henüz öğretim üyesi yok."}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={820} mt="sm">
          <Table striped highlightOnHover verticalSpacing="xs" withTableBorder layout="fixed">
            <Table.Thead>
              <Table.Tr>
                {sortTh("Ad Soyad", "name")}
                {sortTh("Unvan", "title", 150)}
                {sortTh("Kadro birimi", "dep", 200)}
                <Table.Th w={200}>E-posta</Table.Th>
                {sortTh("Ders", "courses", 96, "center")}
                <Table.Th w={34} />
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
        title={editing ? "Öğretim Üyesini Düzenle" : "Yeni Öğretim Üyesi"}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <Select label="Unvan" placeholder="Seçin (opsiyonel)" data={TITLES} clearable
              searchable filter={turkishOptionsFilter} {...form.getInputProps("title")} />
            <TextInput label="Ad Soyad" placeholder="Ayşe Kaya" {...form.getInputProps("full_name")} />
            <TextInput label="E-posta" placeholder="ayse.kaya@mu.edu.tr (opsiyonel)" {...form.getInputProps("email")} />
            <Select
              label="Kadro birimi"
              description="Hocanın resmi kadrosunun bulunduğu bölüm. (Görev birimi — fiilen ders verdiği bölüm — verdiği derslerden türetilir.)"
              placeholder="Kadro birimini seçin"
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))}
              searchable clearable filter={turkishOptionsFilter}
              {...form.getInputProps("department_id")}
            />
            <Checkbox label="Dış görevli (40/a)" {...form.getInputProps("is_external", { type: "checkbox" })} />
            <Button type="submit" loading={submitting} mt="sm">
              {editing ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* Silme onayı */}
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Öğretim üyesini sil">
        <Text>
          <b>{deleting?.full_name}</b> kalıcı olarak silinecek. Bu işlem geri alınamaz.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Derse veya sınava bağlıysa silinmez; onun yerine "Pasife al" kullanın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button color="red" loading={deleteBusy} onClick={handleDelete}>Sil</Button>
        </Group>
      </Modal>

      {/* Siteden içe aktarma */}
      <Modal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        title="Siteden Öğretim Üyesi İçe Aktar"
        size="xl"
      >
        {importLoading ? (
          <Group justify="center" py="xl" gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Fakülte sayfası taranıyor…</Text>
          </Group>
        ) : importError ? (
          <Alert color="red" title="İçe aktarma başarısız">
            {importError}
            <Text size="xs" c="dimmed" mt="xs">
              Kaynak site geçici olarak erişilemez olabilir ya da sayfa yapısı
              değişmiş olabilir. Sorun sürerse yöneticinize bildirin.
            </Text>
          </Alert>
        ) : preview ? (
          <Stack>
            <Text size="sm" c="dimmed">
              Listede {preview.list_total} kişi bulundu · {preview.already_present} zaten
              kayıtlı · <Text span fw={700} c="green">{preview.new.length} yeni</Text>.
            </Text>

            {preview.new.length === 0 ? (
              <Text c="dimmed" py="md">
                Eklenecek yeni öğretim üyesi yok — liste sistemle güncel.
              </Text>
            ) : (
              <>
                <Divider />
                <Group justify="space-between">
                  <Checkbox
                    label="Tümünü seç"
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
                  <Text size="sm" c="dimmed">{selectedRows.size} seçili</Text>
                </Group>

                <ScrollArea.Autosize mah={420}>
                  <Table stickyHeader verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={36} />
                        <Table.Th>Unvan</Table.Th>
                        <Table.Th>Ad Soyad</Table.Th>
                        <Table.Th>Görev / Kadro Birimi</Table.Th>
                        <Table.Th>E-posta</Table.Th>
                        <Table.Th>Eşlenen Bölüm</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {preview.new.map((row) => (
                        <Table.Tr key={row.detail_url}>
                          <Table.Td>
                            <Checkbox
                              checked={selectedRows.has(row.detail_url)}
                              onChange={() => toggleImportRow(row.detail_url)}
                            />
                          </Table.Td>
                          <Table.Td><Text size="xs" c="dimmed">{row.title ?? "—"}</Text></Table.Td>
                          <Table.Td>
                            <Anchor href={row.detail_url} target="_blank" size="sm">{row.full_name}</Anchor>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{row.duty_unit ?? "—"}</Text>
                            {row.cadre_unit && row.cadre_unit !== row.duty_unit && (
                              <Text size="xs" c="dimmed">Kadro: {row.cadre_unit}</Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c={row.email ? undefined : "dimmed"}>{row.email ?? "—"}</Text>
                          </Table.Td>
                          <Table.Td>
                            {row.department_label ? (
                              <Badge variant="light" color="blue" size="sm">{row.department_label}</Badge>
                            ) : (
                              <Tooltip label="Bu bölüm sistemde yok; kayıt bölümsüz eklenir">
                                <Text size="xs" c="dimmed">eşleşmedi</Text>
                              </Tooltip>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>

                <Group justify="flex-end" mt="sm">
                  <Button variant="default" onClick={() => setImportOpen(false)}>Vazgeç</Button>
                  <Button loading={committing} disabled={selectedRows.size === 0} onClick={handleImportCommit}>
                    {selectedRows.size} kişiyi ekle
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        ) : null}
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
            <Tooltip label="Dış görevli (40/a)">
              <Badge variant="light" color="orange" size="xs" style={{ flex: "none" }}>40/a</Badge>
            </Tooltip>
          )}
          {!l.active && <Badge size="xs" color="gray" style={{ flex: "none" }}>Pasif</Badge>}
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

/** Drawer içi tek istatistik hücresi. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="xs" radius="sm">
      <Text size="xs" c="dimmed" fw={600}>{label}</Text>
      <Text size="sm" mt={2} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
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
  const items = stats?.items ?? [];
  const courseCount = stats?.courseIds.size ?? 0;
  const sectionCount = items.length;
  const students = stats?.students ?? 0;
  const hours = stats?.hours ?? 0;

  // Haftalık ızgara: verdiği şubelerin yayındaki yerleşimleri (gün-slot).
  const placements: WeekPlacement[] = [];
  for (const { course, section } of items) {
    for (const e of entriesBySection[section.id] ?? []) {
      placements.push({
        day: e.day_of_week, startSlot: e.start_slot, slotCount: e.slot_count,
        label: course.code, title: `${course.code} · Şube ${section.section_no}`,
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
              {!l.active && <Badge color="gray" size="sm">Pasif</Badge>}
            </Group>
            <Text size="sm" c="dimmed" mt={2} truncate>
              {depLabel}{l.email ? ` · ${l.email}` : ""}
            </Text>
          </div>
        </Group>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Kapat">
          <IconX size={18} />
        </ActionIcon>
      </Group>

      {/* Gövde */}
      <Box style={{ flex: 1, overflowY: "auto" }} p="md">
        <Stack gap="lg">
          <SimpleGrid cols={4} spacing="xs">
            <Stat label="Ders" value={String(courseCount)} />
            <Stat label="Şube" value={String(sectionCount)} />
            <Stat label="Haftalık saat" value={`${hours} sa`} />
            <Stat label="Öğrenci" value={String(students)} />
          </SimpleGrid>

          {/* K-68: görev birimi = verdiği (ortak olmayan) derslerin bölümleri.
              Kadro birimi künyede (depLabel); bu türetilmiş. */}
          {dutyUnits.length > 0 && (
            <div>
              <Text size="xs" fw={600} c="dimmed" mb={8}>GÖREV BİRİMİ</Text>
              <Group gap={6}>
                {dutyUnits.map((u) => (
                  <Badge key={u} variant="light" color="blue" style={{ textTransform: "none" }}>{u}</Badge>
                ))}
              </Group>
            </div>
          )}

          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>HAFTALIK PROGRAM</Text>
            <MiniWeekGrid placements={placements} emptyLabel="Bu dönem programda ders yok." />
          </div>

          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>VERDİĞİ DERSLER</Text>
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
                          Şube {section.section_no} · {section.expected_students} öğrenci
                        </Text>
                      </div>
                      {entries.length === 0 ? (
                        <Text size="xs" c="orange.7" style={{ flex: "none" }}>programda değil</Text>
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
                  <Text size="sm" c="dimmed" ta="center">Bu dönem atanmış ders yok.</Text>
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
            Bilgileri düzenle
          </Button>
        )}
        {/* K-67: hocanın haftalık programı burada; export'u da burada
            (/export/weekly lecturer_id filtresini kabul eder). */}
        <ExportMenu label="Programı Aktar" items={[
          { label: "Excel (.xlsx)", path: `/export/weekly?lecturer_id=${l.id}&format=xlsx` },
          { label: "CSV (.csv)", path: `/export/weekly?lecturer_id=${l.id}&format=csv` },
        ]} />
        <Box style={{ flex: 1 }} />
        {canWrite && (
          <Tooltip label={l.active ? "Pasife al" : "Aktifleştir"}>
            <ActionIcon variant="subtle" size="lg" color={l.active ? "orange" : "green"}
              onClick={() => onToggleActive(l)} aria-label={l.active ? "Pasife al" : "Aktifleştir"}>
              {l.active ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {canWrite && (
          <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={15} />}
            onClick={() => onDelete(l)}>
            Sil
          </Button>
        )}
      </Group>
    </Stack>
  );
}
