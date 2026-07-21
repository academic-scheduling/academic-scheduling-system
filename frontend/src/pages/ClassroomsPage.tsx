import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, NumberInput,
  Paper, Select, Stack, Table, Text, TextInput, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconBuilding, IconChevronDown, IconChevronUp, IconCircleCheck, IconCircleOff,
  IconEye, IconEyeOff, IconPencil, IconSelector, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import type { Building, Classroom, RoomType } from "../api/types";
import { ROOM_TYPE_LABELS } from "../api/types";

type SortKey = "building" | "room" | "type" | "capacity" | "exam";

const ALL_BUILDINGS = "__all__";
const EXTERNAL_ONLY = "__external__";
const ALL_TYPES = "__all_types__";

/** Durum göstergesi + eylem: boşta durumu, hover'da yapılacak eylemi gösterir. */
function ActiveToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const Icon = hover ? (active ? IconEyeOff : IconEye) : (active ? IconCircleCheck : IconCircleOff);
  const color = hover ? (active ? "orange" : "green") : (active ? "green" : "gray");
  return (
    <Tooltip label={active ? "Pasife al" : "Aktifleştir"}>
      <ActionIcon
        variant="subtle"
        color={color}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={onClick}
      >
        <Icon size={18} />
      </ActionIcon>
    </Tooltip>
  );
}

function SortableTh({
  label, active, dir, onClick,
}: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  const Icon = active ? (dir === "asc" ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th>
      <UnstyledButton onClick={onClick}>
        <Group gap={4} wrap="nowrap">
          <Text fw={600} size="sm">{label}</Text>
          <Icon size={14} opacity={active ? 1 : 0.4} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

export default function ClassroomsPage() {
  const { user } = useAuth();
  // Derslik/bina workgroup geneli paylaşımlı kaynak: bölüm boyutu yok (K-25).
  const canWrite = canWriteIn(user, "can_manage_classrooms");

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("room");   // ilk sutun Derslik
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [roomModal, setRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Classroom | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<Classroom | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Binalar ayrı bir modalda yönetilir: tek alanlı ince bir varlık,
  // ana ekranı işgal etmesin (tasarım kararı).
  const [buildingModal, setBuildingModal] = useState(false);

  const roomForm = useForm({
    initialValues: {
      building_id: "",
      room_code: "",
      room_type: "CLASSROOM" as RoomType,
      capacity: 30,
      exam_capacity: null as number | null,
    },
    validate: {
      building_id: (v) => (v ? null : "Bina seçin"),
      room_code: (v) => (v.trim() ? null : "Oda kodu boş olamaz"),
      capacity: (v) => (v > 0 ? null : "Kapasite 0'dan büyük olmalı"),
      exam_capacity: (v, values) =>
        v != null && v > values.capacity
          ? "Sınav kontenjanı kapasiteyi aşamaz (K-21)"
          : null,
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [rooms, blds] = await Promise.all([
        api.get<Classroom[]>("/classrooms"),
        api.get<Building[]>("/buildings"),
      ]);
      setClassrooms(rooms);
      setBuildings(blds);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
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

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const dir = sortDir === "asc" ? 1 : -1;
    return classrooms
      .filter((c) => !q || c.room_code.toLocaleLowerCase("tr").includes(q))
      .filter((c) => {
        if (buildingFilter === null || buildingFilter === ALL_BUILDINGS) return true;
        if (buildingFilter === EXTERNAL_ONLY) return c.building.is_external;   // K-30
        return String(c.building.id) === buildingFilter;
      })
      .filter((c) => typeFilter === null || c.room_type === typeFilter)   // K-31
      .sort((a, b) => {
        if (sortBy === "building") {
          const cmp = a.building.name.localeCompare(b.building.name, "tr");
          return dir * (cmp !== 0 ? cmp : a.room_code.localeCompare(b.room_code, "tr"));
        }
        if (sortBy === "room") return dir * a.room_code.localeCompare(b.room_code, "tr");
        if (sortBy === "type") {
          const cmp = ROOM_TYPE_LABELS[a.room_type].localeCompare(ROOM_TYPE_LABELS[b.room_type], "tr");
          return dir * (cmp !== 0 ? cmp : a.room_code.localeCompare(b.room_code, "tr"));
        }
        // Sayısal sütunlar: exam_capacity NULL olabilir, en sona itilir.
        const va = sortBy === "capacity" ? a.capacity : (a.exam_capacity ?? -1);
        const vb = sortBy === "capacity" ? b.capacity : (b.exam_capacity ?? -1);
        if (va !== vb) return dir * (va - vb);
        return a.room_code.localeCompare(b.room_code, "tr");
      });
  }, [classrooms, query, buildingFilter, typeFilter, sortBy, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir(key === "capacity" || key === "exam" ? "desc" : "asc");
    }
  }

  function openAddRoom() {
    setEditingRoom(null);
    roomForm.setValues({
      building_id: buildings.length === 1 ? String(buildings[0].id) : "",
      room_code: "",
      room_type: "CLASSROOM" as RoomType,
      capacity: 30,
      exam_capacity: null,
    });
    setRoomModal(true);
  }

  function openEditRoom(c: Classroom) {
    setEditingRoom(c);
    roomForm.setValues({
      building_id: String(c.building.id),
      room_code: c.room_code,
      room_type: c.room_type,
      capacity: c.capacity,
      exam_capacity: c.exam_capacity,
    });
    setRoomModal(true);
  }

  async function handleRoomSubmit(values: typeof roomForm.values) {
    setSubmitting(true);
    const payload = {
      building_id: Number(values.building_id),
      room_code: values.room_code,
      room_type: values.room_type,
      capacity: values.capacity,
      exam_capacity: values.exam_capacity,
    };
    try {
      if (editingRoom) {
        await api.patch<Classroom>(`/classrooms/${editingRoom.id}`, payload);
        notifications.show({ color: "green", message: "Derslik güncellendi" });
      } else {
        await api.post<Classroom>("/classrooms", payload);
        notifications.show({ color: "green", message: "Derslik eklendi" });
      }
      setRoomModal(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        roomForm.setFieldError("room_code", e.message);
      } else {
        notifications.show({
          color: "red",
          message: e instanceof ApiError ? e.message : "İşlem başarısız",
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleRoomActive(c: Classroom) {
    try {
      await api.patch<Classroom>(`/classrooms/${c.id}`, { active: !c.active });
      notifications.show({
        color: "green",
        message: c.active ? "Derslik pasife alındı" : "Derslik aktifleştirildi",
      });
      await load();
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
      });
    }
  }

  async function handleDeleteRoom() {
    if (!deletingRoom) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/classrooms/${deletingRoom.id}`);
      notifications.show({ color: "green", message: "Derslik silindi" });
      setDeletingRoom(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
      setDeletingRoom(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Derslikler</Title>
        {canWrite && (
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconBuilding size={16} />}
              onClick={() => setBuildingModal(true)}
            >
              Binaları Yönet
            </Button>
            <Button onClick={openAddRoom} disabled={buildings.length === 0}>
              + Derslik Ekle
            </Button>
          </Group>
        )}
      </Group>

      {buildings.length === 0 && (
        <Alert color="blue" mb="md">
          Derslik eklemeden önce bir bina tanımlamalısınız — derslik bir binaya
          bağlıdır (K-18). "Binaları Yönet" ile başlayın.
        </Alert>
      )}

      <Group mb="md">
        <TextInput
          placeholder="Derslik ara"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={240}
        />
        <Select
          data={[
            { value: ALL_BUILDINGS, label: "Tüm binalar" },
            { value: EXTERNAL_ONLY, label: "Yalnız fakülte dışı" },
            ...buildings.map((b) => ({
              value: String(b.id),
              label: b.is_external ? `${b.name} (fakülte dışı)` : b.name,
            })),
          ]}
          value={buildingFilter ?? ALL_BUILDINGS}
          onChange={(v) => setBuildingFilter(v === ALL_BUILDINGS || v === null ? null : v)}
          allowDeselect={false}
          w={260}
        />
        <Select
          data={[
            { value: ALL_TYPES, label: "Tüm türler" },
            ...(Object.keys(ROOM_TYPE_LABELS) as RoomType[]).map((t) => ({
              value: t,
              label: ROOM_TYPE_LABELS[t],
            })),
          ]}
          value={typeFilter ?? ALL_TYPES}
          onChange={(v) => setTypeFilter(v === ALL_TYPES || v === null ? null : v)}
          allowDeselect={false}
          w={180}
        />
      </Group>

      {visible.length === 0 ? (
        <Text c="dimmed">
          {query || buildingFilter || typeFilter ? "Filtreye uyan derslik yok." : "Henüz derslik yok."}
        </Text>
      ) : (
        <Paper withBorder>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <SortableTh label="Derslik" active={sortBy === "room"} dir={sortDir} onClick={() => toggleSort("room")} />
                <SortableTh label="Bina" active={sortBy === "building"} dir={sortDir} onClick={() => toggleSort("building")} />
                <SortableTh label="Tür" active={sortBy === "type"} dir={sortDir} onClick={() => toggleSort("type")} />
                <SortableTh label="Kapasite" active={sortBy === "capacity"} dir={sortDir} onClick={() => toggleSort("capacity")} />
                <SortableTh label="Sınav Kont." active={sortBy === "exam"} dir={sortDir} onClick={() => toggleSort("exam")} />
                <Table.Th>Durum</Table.Th>
                {canWrite && <Table.Th w={130}>İşlemler</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((c) => (
                <Table.Tr key={c.id} opacity={c.active ? 1 : 0.55}>
                  <Table.Td fw={500}>{c.room_code}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm">{c.building.name}</Text>
                      {c.building.is_external && (
                        <Badge variant="light" color="grape" size="sm">Fakülte dışı</Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      size="sm"
                      color={c.room_type === "AMPHI" ? "indigo" : c.room_type === "LAB" ? "teal" : "gray"}
                    >
                      {ROOM_TYPE_LABELS[c.room_type]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{c.capacity}</Table.Td>
                  <Table.Td>
                    {c.exam_capacity == null ? (
                      <Tooltip label="Girilmemiş — sınav yerleşiminde uyarı üretir (K-21)">
                        <Text c="dimmed">—</Text>
                      </Tooltip>
                    ) : (
                      c.exam_capacity
                    )}
                  </Table.Td>
                  <Table.Td>
                    {!c.active && <Badge color="gray" size="sm">Pasif</Badge>}
                  </Table.Td>
                  {canWrite && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Düzenle">
                          <ActionIcon variant="subtle" onClick={() => openEditRoom(c)}>
                            <IconPencil size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <ActiveToggle active={c.active} onClick={() => toggleRoomActive(c)} />
                        <Tooltip label="Sil">
                          <ActionIcon variant="subtle" color="red" onClick={() => setDeletingRoom(c)}>
                            <IconTrash size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {/* Derslik ekle/düzenle */}
      <Modal
        opened={roomModal}
        onClose={() => setRoomModal(false)}
        title={editingRoom ? "Dersliği Düzenle" : "Yeni Derslik"}
      >
        <form onSubmit={roomForm.onSubmit(handleRoomSubmit)}>
          <Stack>
            <Select
              label="Bina"
              placeholder="Seçin"
              data={buildings.map((b) => ({
                value: String(b.id),
                label: b.is_external ? `${b.name} (fakülte dışı)` : b.name,
              }))}
              {...roomForm.getInputProps("building_id")}
            />
            <TextInput label="Derslik" placeholder="B-201" {...roomForm.getInputProps("room_code")} />
            <Select
              label="Tür"
              data={[
                { value: "CLASSROOM", label: "Sınıf" },
                { value: "AMPHI", label: "Amfi" },
                { value: "LAB", label: "Laboratuvar" },
              ]}
              allowDeselect={false}
              {...roomForm.getInputProps("room_type")}
            />
            <NumberInput label="Kapasite" min={1} {...roomForm.getInputProps("capacity")} />
            <NumberInput
              label="Sınav Kontenjanı"
              description="Boşluklu oturma düzeni. Opsiyonel (K-21) — boş bırakılırsa sınav yerleşiminde uyarı çıkar."
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
      <Modal
        opened={deletingRoom !== null}
        onClose={() => setDeletingRoom(null)}
        title="Dersliği sil"
      >
        <Text>
          <b>{deletingRoom?.building.name} {deletingRoom?.room_code}</b> kalıcı olarak
          silinecek. Bu işlem geri alınamaz.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Programa veya sınava girmiş bir derslik silinemez; onun yerine "Pasife al" kullanın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeletingRoom(null)}>Vazgeç</Button>
          <Button color="red" loading={deleteBusy} onClick={handleDeleteRoom}>Sil</Button>
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

/** Bina yönetimi — ana ekranın yan kapısı.
 *
 *  Bina tek alanlı ince bir varlık (K-18: adın normalize edilmesi için var).
 *  Ana listeyi işgal etmemesi için modalda tutuluyor.
 */
function BuildingsModal({
  opened, onClose, buildings, roomCounts, onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  buildings: Building[];
  roomCounts: Record<number, number>;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Building | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { name: "", is_external: false },
    validate: { name: (v) => (v.trim() ? null : "Bina adı boş olamaz") },
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
        notifications.show({ color: "green", message: "Bina güncellendi" });
      } else {
        await api.post<Building>("/buildings", values);
        notifications.show({ color: "green", message: "Bina eklendi" });
      }
      reset();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        form.setFieldError("name", e.message);
      } else {
        notifications.show({
          color: "red",
          message: e instanceof ApiError ? e.message : "İşlem başarısız",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: Building) {
    try {
      await api.delete(`/buildings/${b.id}`);
      notifications.show({ color: "green", message: "Bina silindi" });
      await onChanged();
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Binalar" size="lg">
      <Stack>
        {buildings.length === 0 ? (
          <Text c="dimmed" size="sm">Henüz bina yok.</Text>
        ) : (
          <Table>
            <Table.Tbody>
              {buildings.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm">{b.name}</Text>
                      {b.is_external && (
                        <Badge variant="light" color="grape" size="sm">Fakülte dışı</Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td w={110}>
                    <Text size="sm" c="dimmed">{roomCounts[b.id] ?? 0} derslik</Text>
                  </Table.Td>
                  <Table.Td w={90}>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Düzenle">
                        <ActionIcon variant="subtle" onClick={() => startEdit(b)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Sil">
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
              <Text fw={600} size="sm">
                {editing ? `Düzenle: ${editing.name}` : "Yeni bina"}
              </Text>
              <TextInput placeholder="B Blok" {...form.getInputProps("name")} />
              <Checkbox
                label="Fakülte dışı bina"
                {...form.getInputProps("is_external", { type: "checkbox" })}
              />
              <Group>
                <Button type="submit" size="xs" loading={busy}>
                  {editing ? "Kaydet" : "Ekle"}
                </Button>
                {editing && (
                  <Button size="xs" variant="default" onClick={reset}>Vazgeç</Button>
                )}
              </Group>
            </Stack>
          </form>
        </Paper>
      </Stack>
    </Modal>
  );
}
