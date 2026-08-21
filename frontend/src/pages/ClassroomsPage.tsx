import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Box, Button, Checkbox, Drawer, Group, Loader, Modal, NumberInput, Paper, Popover, Progress, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconBuilding, IconChevronRight, IconEye, IconEyeOff, IconFilter, IconPencil, IconPlus, IconSearch, IconSelector, IconSortAscending, IconSortDescending, IconTrash, IconX } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ExportMenu from "../components/ExportMenu";
import MiniWeekGrid, { type WeekPlacement } from "../components/MiniWeekGrid";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { formatSlotRange, SLOT_TIMES } from "../utils/slots";
import { turkishOptionsFilter } from "../utils/selectSearch";
import type {
  Building, Classroom, Course, CourseSection, RoomType, WeeklyEntry,
} from "../api/types";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

type SortKey = "room" | "building" | "type" | "capacity" | "exam" | "use";

const ALL = "__all__";
const EXTERNAL_ONLY = "__external__";

/** Haftada yerleştirilebilir toplam slot = gün × slot (slots.ts'ten türetilir,
 *  tablo değişirse burası da). Doluluk yüzdesinin paydası. */
// K-79: gün sayısı artık sözlükte (dile göre değişmez, 5 iş günü) —
// modül düzeyinde sözlük okunamayacağı için sabit yazıldı.
const GUN_SAYISI = 5;
const WEEK_SLOTS = Object.keys(SLOT_TIMES).length * GUN_SAYISI;

/** Tür rozetinin rengi (K-31). Amfi indigo, Lab teal, Sınıf gri. */
function typeColor(t: RoomType): string {
  return t === "AMPHI" ? "indigo" : t === "LAB" ? "teal" : "gray";
}

/** K-68: kat metni. 0 = zemin. null = girilmemiş → boş. */
function floorText(floor: number | null, t: Dict): string {
  if (floor == null) return "";
  return floor === 0 ? t.classrooms.groundFloor : t.classrooms.floorNo(floor);
}

/** Konum: bina + (varsa) kat. Tabloda ve drawer stat'ında ortak. */
function locationLabel(c: Classroom, t: Dict): string {
  const f = floorText(c.floor, t);
  return f ? `${c.building.name} · ${f}` : c.building.name;
}

/** Doluluk çubuğunun rengi — mockup'la aynı eşikler: çok dolu kırmızı, orta sarı,
 *  boşa yakın yeşil. */
function useColor(pct: number): string {
  return pct >= 60 ? "red" : pct >= 30 ? "yellow" : "green";
}

export default function ClassroomsPage() {
  const t = useT();
  const { user } = useAuth();
  // Derslik/bina workgroup geneli paylaşımlı kaynak: bölüm boyutu yok (K-25).
  const canWrite = canWriteIn(user, "can_manage_classrooms");

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);   // booking'lerde hoca+öğrenci için
  const [weeklyEntries, setWeeklyEntries] = useState<WeeklyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<string | null>(null);
  const [minCap, setMinCap] = useState<string | null>(null);

  // K-65: yeni arayüz süzgeçleri (istemci tarafı).
  const [seg, setSeg] = useState<RoomType | "all">("all");
  const [onlyActive, setOnlyActive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("room");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selId, setSelId] = useState<number | null>(null);

  const [roomModal, setRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<Classroom | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Binalar ayrı bir modalda yönetilir (ince varlık, ana ekranı işgal etmesin).
  const [buildingModal, setBuildingModal] = useState(false);

  const roomForm = useForm({
    initialValues: {
      building_id: "", room_code: "", floor: null as number | null,
      room_type: "CLASSROOM" as RoomType,
      capacity: 30, exam_capacity: null as number | null,
    },
    validate: {
      building_id: (v) => (v ? null : t.classrooms.pickBuilding),
      room_code: (v) => (v.trim() ? null : t.classrooms.roomCodeRequired),
      capacity: (v) => (v > 0 ? null : t.classrooms.capacityPositive),
      exam_capacity: (v, values) =>
        v != null && v > values.capacity ? t.classrooms.examCapacityTooBig : null,
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [rooms, blds, crs, entries] = await Promise.all([
        api.get<Classroom[]>("/classrooms"),
        api.get<Building[]>("/buildings"),
        api.get<Course[]>("/courses"),
        api.get<WeeklyEntry[]>("/weekly-entries"),
      ]);
      setClassrooms(rooms);
      setBuildings(blds);
      setCourses(crs);
      setWeeklyEntries(entries);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : t.common.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const roomCountByBuilding = useMemo(() => {
    const acc: Record<number, number> = {};
    for (const c of classrooms) acc[c.building.id] = (acc[c.building.id] ?? 0) + 1;
    return acc;
  }, [classrooms]);

  /** Şube id → {ders, şube} — booking kartında hoca ve öğrenci sayısı için
   *  (WeeklyEntry.section bunları taşımaz). */
  const sectionById = useMemo(() => {
    const m: Record<number, { course: Course; section: CourseSection }> = {};
    for (const c of courses) for (const s of c.sections) m[s.id] = { course: c, section: s };
    return m;
  }, [courses]);

  // Derslik başına haftalık kullanım: FARKLI ders sayısı, dolu slot toplamı ve
  // o dersliğe düşen haftalık giriş listesi (booking).
  const usageByRoom = useMemo(() => {
    const acc: Record<number, { courses: Set<number>; slots: number; entries: WeeklyEntry[] }> = {};
    for (const e of weeklyEntries) {
      const rid = e.classroom?.id;
      if (rid == null) continue;                       // online giriş: derslik yok
      const u = (acc[rid] ??= { courses: new Set(), slots: 0, entries: [] });
      u.courses.add(e.section.course.id);
      u.slots += e.slot_count;
      u.entries.push(e);
    }
    for (const u of Object.values(acc)) {
      u.entries.sort((a, b) => a.day_of_week - b.day_of_week || a.start_slot - b.start_slot);
    }
    return acc;
  }, [weeklyEntries]);

  function usePctOf(c: Classroom): number {
    return Math.round(((usageByRoom[c.id]?.slots ?? 0) / WEEK_SLOTS) * 100);
  }

  function sortValue(c: Classroom, key: SortKey): string | number {
    switch (key) {
      case "building": return c.building.name;
      case "type": return t.enums.roomType[c.room_type];
      case "capacity": return c.capacity;
      case "exam": return c.exam_capacity ?? -1;
      case "use": return usePctOf(c);
      default: return c.room_code;
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    let list = classrooms.filter((c) => {
      if (q && !c.room_code.toLocaleLowerCase("tr").includes(q)
        && !c.building.name.toLocaleLowerCase("tr").includes(q)) return false;
      if (seg !== "all" && c.room_type !== seg) return false;
      if (buildingFilter === EXTERNAL_ONLY) {
        if (!c.building.is_external) return false;
      } else if (buildingFilter && String(c.building.id) !== buildingFilter) return false;
      if (minCap && c.capacity < Number(minCap)) return false;
      if (onlyActive && !c.active) return false;
      return true;
    });
    const dir = sortDir === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => {
      const va = sortValue(a, sortBy), vb = sortValue(b, sortBy);
      let cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "tr");
      if (cmp === 0) cmp = a.room_code.localeCompare(b.room_code, "tr");
      return cmp * dir;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classrooms, query, seg, buildingFilter, minCap, onlyActive, sortBy, sortDir, usageByRoom]);

  const countLabel = t.classrooms.roomCount(rows.length);

  const selected = useMemo(
    () => classrooms.find((c) => c.id === selId) ?? null, [classrooms, selId]);

  const handleSelect = useCallback((id: number) => setSelId(id), []);

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    // Sayısal sütunlar ilk tık ÇOKTAN AZA; metin alfabetik.
    else { setSortBy(key); setSortDir(key === "capacity" || key === "exam" || key === "use" ? "desc" : "asc"); }
  }

  const chips = useMemo(() => {
    const out: { key: string; label: string; clear: () => void }[] = [];
    if (buildingFilter) {
      const label = buildingFilter === EXTERNAL_ONLY
        ? t.classrooms.externalOnly
        : buildings.find((b) => String(b.id) === buildingFilter)?.name ?? t.classrooms.building;
      out.push({ key: "bld", label, clear: () => setBuildingFilter(null) });
    }
    if (minCap) out.push({ key: "cap", label: t.classrooms.minPeople(Number(minCap)), clear: () => setMinCap(null) });
    if (onlyActive) out.push({ key: "active", label: t.classrooms.closedHidden, clear: () => setOnlyActive(false) });
    return out;
  }, [buildingFilter, minCap, onlyActive, buildings]);

  const hasFilters = chips.length > 0;
  function clearAllFilters() {
    setBuildingFilter(null); setMinCap(null); setOnlyActive(false);
  }

  function openAddRoom() {
    setEditingRoom(null);
    roomForm.setValues({
      building_id: buildings.length === 1 ? String(buildings[0].id) : "",
      room_code: "", floor: null, room_type: "CLASSROOM" as RoomType, capacity: 30, exam_capacity: null,
    });
    setRoomModal(true);
  }

  function openEditRoom(c: Classroom) {
    setEditingRoom(c);
    roomForm.setValues({
      building_id: String(c.building.id), room_code: c.room_code, floor: c.floor,
      room_type: c.room_type, capacity: c.capacity, exam_capacity: c.exam_capacity,
    });
    setRoomModal(true);
  }

  async function handleRoomSubmit(values: typeof roomForm.values) {
    setSubmitting(true);
    // K-72: floor boş bırakılabilir. Mantine NumberInput temizlenince değer ""
    // (boş string) olabiliyordu; ham "" backend'e gidince "valid integer değil"
    // hatası veriyordu ve kayıt kilitleniyordu. Yalnız gerçek sayıyı gönder,
    // gerisini (boş string dahil) null'a indirge.
    const floor = typeof values.floor === "number" && Number.isFinite(values.floor)
      ? Math.trunc(values.floor) : null;
    const payload = {
      building_id: Number(values.building_id), room_code: values.room_code,
      floor,
      room_type: values.room_type, capacity: values.capacity, exam_capacity: values.exam_capacity,
    };
    try {
      if (editingRoom) {
        await api.patch<Classroom>(`/classrooms/${editingRoom.id}`, payload);
        notifications.show({ color: "green", message: t.classrooms.updated });
      } else {
        await api.post<Classroom>("/classrooms", payload);
        notifications.show({ color: "green", message: "Derslik eklendi" });
      }
      setRoomModal(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) roomForm.setFieldError("room_code", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRoomActive(c: Classroom) {
    try {
      await api.patch<Classroom>(`/classrooms/${c.id}`, { active: !c.active });
      notifications.show({
        color: "green",
        message: c.active ? t.classrooms.disabled : t.classrooms.enabled,
      });
      await load();
    } catch (e) {
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    }
  }

  async function handleDeleteRoom() {
    if (!deletingRoom) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/classrooms/${deletingRoom.id}`);
      notifications.show({ color: "green", message: "Derslik silindi" });
      if (selId === deletingRoom.id) setSelId(null);
      setDeletingRoom(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : t.common.actionFailed,
        autoClose: 7000,
      });
      setDeletingRoom(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  /** Sıralanabilir başlık — K-65'teki gibi fonksiyon (remount olmasın). */
  function sortTh(label: string, k: SortKey, w?: number, align?: "center" | "left") {
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

  /** Tüm derslikler için ızgara export (seçili bina filtresi varsa ona daralır). */
  const exportPath = (format: "xlsx" | "csv"): string => {
    const params = new URLSearchParams({ format });
    if (buildingFilter && buildingFilter !== EXTERNAL_ONLY) params.set("building_id", buildingFilter);
    return `/export/classrooms?${params.toString()}`;
  };

  return (
    <>
      <Group justify="space-between" align="baseline" mb="md">
        <Group align="baseline" gap="xs">
          <Title order={3}>{t.classrooms.title}</Title>
          <Text size="sm" c="dimmed">{countLabel}</Text>
        </Group>
        <Group gap="xs">
          <ExportMenu label={t.classrooms.scheduleTitle} items={[
            { label: "Excel (.xlsx)", path: exportPath("xlsx") },
            { label: "CSV (.csv)", path: exportPath("csv") },
          ]} />
          {canWrite && (
            <>
              <Button variant="default" leftSection={<IconBuilding size={16} />}
                onClick={() => setBuildingModal(true)}>{t.classrooms.manageBuildings}</Button>
              <Button leftSection={<IconPlus size={16} />} onClick={openAddRoom} disabled={buildings.length === 0}>
                {t.classrooms.add}
              </Button>
            </>
          )}
        </Group>
      </Group>

      {buildings.length === 0 && (
        <Alert color="blue" mb="md">
          {t.classrooms.needBuilding}
        </Alert>
      )}

      {/* Süzgeç çubuğu */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" wrap="nowrap" align="center">
          <TextInput
            placeholder={t.classrooms.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={16} />}
            w={260}
            style={{ flex: "none" }}
          />

          <SegmentedControl
            value={seg}
            onChange={(v) => setSeg(v as RoomType | "all")}
            data={[
              { label: t.common.all, value: "all" },
              { label: t.enums.roomType.CLASSROOM, value: "CLASSROOM" },
              { label: t.enums.roomType.LAB, value: "LAB" },
              { label: t.enums.roomType.AMPHI, value: "AMPHI" },
            ]}
            size="sm"
            style={{ flex: "none" }}
          />

          <Popover opened={filtersOpen} onChange={setFiltersOpen} position="bottom-start"
            width={480} shadow="md" withArrow>
            <Popover.Target>
              <Button variant="default" onClick={() => setFiltersOpen((o) => !o)}
                leftSection={<IconFilter size={16} />} style={{ flex: "none" }}>
                {t.classrooms.filter}
                {hasFilters && <Badge size="sm" circle ml={6} variant="filled">{chips.length}</Badge>}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <SimpleGrid cols={2} spacing="sm">
                <Select
                  label={t.classrooms.building}
                  data={[
                    { value: ALL, label: t.classrooms.allBuildings },
                    { value: EXTERNAL_ONLY, label: t.classrooms.externalOnly },
                    ...buildings.map((b) => ({
                      value: String(b.id),
                      label: b.is_external ? t.classrooms.externalParen(b.name) : b.name,
                    })),
                  ]}
                  value={buildingFilter ?? ALL}
                  onChange={(v) => setBuildingFilter(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                  searchable
                  filter={turkishOptionsFilter}
                />
                <Select
                  label={t.classrooms.minCapacity}
                  data={[
                    { value: ALL, label: t.classrooms.anyCapacity },
                    { value: "30", label: t.classrooms.minPeople(30) },
                    { value: "60", label: t.classrooms.minPeople(60) },
                    { value: "100", label: t.classrooms.minPeople(100) },
                    { value: "150", label: t.classrooms.minPeople(150) },
                  ]}
                  value={minCap ?? ALL}
                  onChange={(v) => setMinCap(v === ALL || v === null ? null : v)}
                  allowDeselect={false}
                />
              </SimpleGrid>
              <Group justify="space-between" mt="md" pt="sm"
                style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                <Checkbox
                  label={t.classrooms.hideClosed}
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
                {t.classrooms.clear}
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      {/* Tablo */}
      {rows.length === 0 ? (
        <Text c="dimmed" mt="xl" ta="center">
          {query || hasFilters || seg !== "all" ? t.classrooms.noMatch : t.classrooms.empty}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={860} mt="sm">
          <Table striped highlightOnHover verticalSpacing="xs" withTableBorder layout="fixed">
            <Table.Thead>
              <Table.Tr>
                {sortTh(t.classrooms.code, "room", 120)}
                {sortTh(t.classrooms.type, "type", 130)}
                {/* K-71: Bina'ya da genişlik verildi. Eskiden tek genişliksiz
                    sütun olduğu için tüm boşluğu yutup orantısız genişliyordu. */}
                {sortTh(t.classrooms.building, "building", 240)}
                {sortTh(t.classrooms.capacity, "capacity", 100, "center")}
                {sortTh(t.classrooms.examCapacity, "exam", 110, "center")}
                {sortTh(t.classrooms.weeklyUsage, "use", 180, "left")}
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <ClassroomRow
                  key={c.id}
                  room={c}
                  usePct={usePctOf(c)}
                  selected={c.id === selId}
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
          <ClassroomDrawerBody
            room={selected}
            usage={usageByRoom[selected.id]}
            usePct={usePctOf(selected)}
            sectionById={sectionById}
            canWrite={canWrite}
            onEdit={openEditRoom}
            onToggleActive={toggleRoomActive}
            onDelete={setDeletingRoom}
            onClose={() => setSelId(null)}
          />
        )}
      </Drawer>

      {/* Derslik ekle/düzenle */}
      <Modal
        opened={roomModal}
        onClose={() => setRoomModal(false)}
        title={editingRoom ? t.classrooms.edit : "Yeni Derslik"}
      >
        <form onSubmit={roomForm.onSubmit(handleRoomSubmit)}>
          <Stack>
            <Select
              label={t.classrooms.building}
              placeholder={t.classrooms.searchOrPick}
              searchable
              filter={turkishOptionsFilter}
              nothingFoundMessage={t.classrooms.buildingNotFound}
              data={buildings.map((b) => ({
                value: String(b.id),
                label: b.is_external ? t.classrooms.externalParen(b.name) : b.name,
              }))}
              {...roomForm.getInputProps("building_id")}
            />
            <Group grow align="flex-start">
              <TextInput label={t.classrooms.roomLabel} placeholder="B-201" {...roomForm.getInputProps("room_code")} />
              <NumberInput
                label={t.classrooms.floor}
                placeholder="—"
                allowDecimal={false}
                {...roomForm.getInputProps("floor")}
              />
            </Group>
            <Select
              label={t.classrooms.type}
              data={[
                { value: "CLASSROOM", label: t.classrooms.classLevel },
                { value: "AMPHI", label: "Amfi" },
                { value: "LAB", label: "Laboratuvar" },
              ]}
              allowDeselect={false}
              {...roomForm.getInputProps("room_type")}
            />
            <NumberInput label={t.classrooms.capacity} min={1} {...roomForm.getInputProps("capacity")} />
            <NumberInput
              label={t.classrooms.examCapacityLong}
              description={t.classrooms.examCapacityHelp}
              min={1}
              {...roomForm.getInputProps("exam_capacity")}
            />
            <Button type="submit" loading={submitting} mt="sm">
              {editingRoom ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* Derslik silme onayı */}
      <Modal opened={deletingRoom !== null} onClose={() => setDeletingRoom(null)} title={t.classrooms.deleteModal}>
        <Text>
          <b>{deletingRoom?.building.name} {deletingRoom?.room_code}</b>{" "}
          {t.common.permanentDeleteWarning}
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          {t.classrooms.deleteHint}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeletingRoom(null)}>{t.common.dismiss}</Button>
          <Button color="red" loading={deleteBusy} onClick={handleDeleteRoom}>{t.common.delete}</Button>
        </Group>
      </Modal>

      <BuildingsModal
        opened={buildingModal}
        onClose={() => setBuildingModal(false)}
        buildings={buildings}
        roomCounts={roomCountByBuilding}
        onChanged={load}
      />
    </>
  );
}

/** Tek derslik satırı — `memo`; arama/seçim tüm listeyi değil yalnız değişeni çizsin. */
const ClassroomRow = memo(function ClassroomRow({
  room: c, usePct, selected, onSelect,
}: {
  room: Classroom; usePct: number; selected: boolean; onSelect: (id: number) => void;
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
        <Text fw={600} size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>{c.room_code}</Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Badge variant="light" color={typeColor(c.room_type)} size="sm">{t.enums.roomType[c.room_type]}</Badge>
          {!c.active && <Badge size="xs" color="gray">{t.classrooms.closed}</Badge>}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" c="dimmed" truncate>{locationLabel(c, t)}</Text>
          {c.building.is_external && (
            <Badge variant="light" color="grape" size="xs" style={{ flex: "none" }}>{t.classrooms.external}</Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td ta="center" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>{c.capacity}</Table.Td>
      <Table.Td ta="center" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        {c.exam_capacity ?? "—"}
      </Table.Td>
      <Table.Td>
        <Group gap={8} wrap="nowrap">
          <Progress value={usePct} color={useColor(usePct)} size="sm" radius="xl" style={{ flex: 1 }} />
          <Text size="xs" c="dimmed" style={{ width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            %{usePct}
          </Text>
        </Group>
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

/** Derslik detay Drawer'ının gövdesi — künye, istatistik ızgarası ve yerleştirilen
 *  dersler (gerçek yayın slotları + hoca/öğrenci + kapasite aşımı kontrolü).
 *  Mockup'taki donanım, sorumlu bölüm ve kullanım ızgarası backend'de veri
 *  olmadığı için YOK (uydurulmadı). */
function ClassroomDrawerBody({
  room: c, usage, usePct, sectionById, canWrite,
  onEdit, onToggleActive, onDelete, onClose,
}: {
  room: Classroom;
  usage?: { courses: Set<number>; slots: number; entries: WeeklyEntry[] };
  usePct: number;
  sectionById: Record<number, { course: Course; section: CourseSection }>;
  canWrite: boolean;
  onEdit: (c: Classroom) => void;
  onToggleActive: (c: Classroom) => void;
  onDelete: (c: Classroom) => void;
  onClose: () => void;
}) {
  const t = useT();
  const entries = usage?.entries ?? [];
  const courseCount = usage?.courses.size ?? 0;
  const slots = usage?.slots ?? 0;

  // Haftalık ızgara: bu dersliğe düşen yayın yerleşimleri (gün-slot).
  const placements: WeekPlacement[] = entries.map((e) => ({
    day: e.day_of_week, startSlot: e.start_slot, slotCount: e.slot_count,
    label: e.section.course.code, title: `${e.section.course.code} · ${t.classrooms.section} ${e.section.section_no}`,
  }));

  return (
    <Stack gap={0} h="100%">
      {/* Künye */}
      <Group justify="space-between" align="flex-start" wrap="nowrap"
        p="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <div style={{ minWidth: 0 }}>
          <Group gap="xs" align="center">
            <Text fw={700} size="lg" style={{ fontVariantNumeric: "tabular-nums" }}>{c.room_code}</Text>
            <Badge variant="light" color={typeColor(c.room_type)} size="sm">{t.enums.roomType[c.room_type]}</Badge>
            {c.building.is_external && <Badge variant="light" color="grape" size="sm">{t.classrooms.external}</Badge>}
            {!c.active && <Badge color="gray" size="sm">{t.classrooms.closed}</Badge>}
          </Group>
          {/* K-68: bina + kapasite alt satırı kaldırıldı — ikisi de aşağıdaki
              stat ızgarasında (Konum / Kapasite) zaten var. */}
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label={t.common.close}>
          <IconX size={18} />
        </ActionIcon>
      </Group>

      {/* Gövde */}
      <Box style={{ flex: 1, overflowY: "auto" }} p="md">
        <Stack gap="lg">
          <SimpleGrid cols={4} spacing="xs">
            <Stat label={t.classrooms.capacity} value={String(c.capacity)} />
            <Stat label={t.classrooms.examCapShort} value={c.exam_capacity == null ? "—" : String(c.exam_capacity)} />
            <Stat label={t.classrooms.weeklyCourse} value={String(courseCount)} />
            <Stat label={t.classrooms.location} value={locationLabel(c, t)} />
          </SimpleGrid>

          {/* Doluluk çubuğu — tablodakiyle aynı, drawer'da geniş */}
          <div>
            <Group justify="space-between" mb={6}>
              <Text size="xs" fw={600} c="dimmed">{t.classrooms.weeklyUsageCaps}</Text>
              <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
                %{usePct} · {slots}/{WEEK_SLOTS} slot
              </Text>
            </Group>
            <Progress value={usePct} color={useColor(usePct)} size="md" radius="xl" />
          </div>

          {/* Haftalık program ızgarası */}
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>{t.classrooms.weeklyScheduleCaps}</Text>
            <MiniWeekGrid placements={placements} emptyLabel={t.classrooms.noCourses} />
          </div>

          {/* Yerleştirilen dersler */}
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={8}>{t.classrooms.placedCourses}</Text>
            <Stack gap="xs">
              {entries.map((e) => {
                const info = sectionById[e.section.id];
                const students = info?.section.expected_students;
                const over = students != null && students > c.capacity;
                const lecturer = info ? info.section.lecturer.title
                  ? `${info.section.lecturer.title} ${info.section.lecturer.full_name}`
                  : info.section.lecturer.full_name : null;
                return (
                  <Paper key={e.id} withBorder radius="md" p="sm">
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" truncate>
                          <Text span fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>{e.section.course.code}</Text>
                          {" · "}{e.section.course.name}
                        </Text>
                        <Text size="xs" c="dimmed" mt={2} truncate>
                          {t.classrooms.section} {e.section.section_no}
                          {lecturer ? ` · ${lecturer}` : ""}
                          {students != null ? t.classrooms.studentCount(students) : ""}
                          {over ? t.classrooms.overCapacity : ""}
                        </Text>
                      </div>
                      <Badge variant="light" size="sm" color="green" style={{ flex: "none" }}>
                        {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count, "short", t)}
                      </Badge>
                    </Group>
                  </Paper>
                );
              })}
              {entries.length === 0 && (
                <Paper withBorder radius="md" p="md" style={{ borderStyle: "dashed" }}>
                  <Text size="sm" c="dimmed" ta="center">{t.classrooms.noCourses}</Text>
                </Paper>
              )}
            </Stack>
          </div>
        </Stack>
      </Box>

      {/* Alt eylem çubuğu */}
      <Group gap="xs" p="md" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        {canWrite && (
          <Button size="sm" leftSection={<IconPencil size={15} />} onClick={() => onEdit(c)}>{t.classrooms.editShort}</Button>
        )}
        {/* K-67: dersliğin haftalık programı burada; export'u da burada
            (/export/classrooms classroom_id ile tek dersliğe daralır). */}
        <ExportMenu label={t.classrooms.downloadSchedule} items={[
          { label: "Excel (.xlsx)", path: `/export/classrooms?classroom_id=${c.id}&format=xlsx` },
          { label: "CSV (.csv)", path: `/export/classrooms?classroom_id=${c.id}&format=csv` },
        ]} />
        <Box style={{ flex: 1 }} />
        {canWrite && (
          <Tooltip label={c.active ? "Pasife al" : t.classrooms.activate}>
            <ActionIcon variant="subtle" size="lg" color={c.active ? "orange" : "green"}
              onClick={() => onToggleActive(c)} aria-label={c.active ? "Pasife al" : t.classrooms.activate}>
              {c.active ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </ActionIcon>
          </Tooltip>
        )}
        {canWrite && (
          <Tooltip label={t.common.delete}>
            <ActionIcon variant="subtle" size="lg" color="red"
              onClick={() => onDelete(c)} aria-label={t.common.delete}>
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Stack>
  );
}

/** Bina yönetimi — ana ekranın yan kapısı. Bina tek alanlı ince bir varlık
 *  (K-18); ana listeyi işgal etmemesi için modalda tutuluyor. */
function BuildingsModal({
  opened, onClose, buildings, roomCounts, onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  buildings: Building[];
  roomCounts: Record<number, number>;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState<Building | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { name: "", is_external: false },
    validate: { name: (v) => (v.trim() ? null : t.classrooms.buildingNameRequired) },
  });

  function startEdit(b: Building) {
    setEditing(b);
    form.setValues({ name: b.name, is_external: b.is_external });
  }

  function reset() {
    setEditing(null);
    form.setValues({ name: "", is_external: false });
  }

  async function submit(values: typeof form.values) {
    setBusy(true);
    try {
      if (editing) {
        await api.patch<Building>(`/buildings/${editing.id}`, values);
        notifications.show({ color: "green", message: t.classrooms.buildingUpdated });
      } else {
        await api.post<Building>("/buildings", values);
        notifications.show({ color: "green", message: t.classrooms.buildingAdded });
      }
      reset();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setFieldError("name", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.common.actionFailed });
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: Building) {
    try {
      await api.delete(`/buildings/${b.id}`);
      notifications.show({ color: "green", message: t.classrooms.buildingDeleted });
      await onChanged();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : t.common.actionFailed,
        autoClose: 7000,
      });
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t.classrooms.buildingsTitle} size="lg">
      <Stack>
        {buildings.length === 0 ? (
          <Text c="dimmed" size="sm">{t.classrooms.noBuildings}</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {buildings.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm">{b.name}</Text>
                      {b.is_external && <Badge variant="light" color="grape" size="sm">{t.classrooms.externalCaps}</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td w={110}>
                    <Text size="sm" c="dimmed">{roomCounts[b.id] ?? 0} derslik</Text>
                  </Table.Td>
                  <Table.Td w={90}>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label={t.common.edit}>
                        <ActionIcon variant="subtle" onClick={() => startEdit(b)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t.common.delete}>
                        <ActionIcon variant="subtle" color="red" onClick={() => remove(b)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        <Paper withBorder p="sm">
          <form onSubmit={form.onSubmit(submit)}>
            <Stack gap="xs">
              <Text fw={600} size="sm">{editing ? t.classrooms.editNamed(editing.name) : "Yeni bina"}</Text>
              <TextInput placeholder="B Blok" {...form.getInputProps("name")} />
              <Checkbox label={t.classrooms.externalBuilding} {...form.getInputProps("is_external", { type: "checkbox" })} />
              <Group>
                <Button type="submit" size="xs" loading={busy}>{editing ? "Kaydet" : "Ekle"}</Button>
                {editing && <Button size="xs" variant="default" onClick={reset}>{t.common.dismiss}</Button>}
              </Group>
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Modal>
  );
}
