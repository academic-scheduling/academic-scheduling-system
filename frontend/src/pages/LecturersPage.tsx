import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper,
  Select, Stack, Table, Text, TextInput, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown, IconChevronUp, IconCircleCheck, IconCircleOff,
  IconEye, IconEyeOff, IconPencil, IconSelector, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import type { Course, Department, Lecturer } from "../api/types";

type SortKey = "name" | "department" | "courses";

/** "Filtre yok" durumunun açılır listedeki karşılığı.
 *  Sadece `clearable` yetmiyor: kullanıcı listeyi açıp "hepsi"ni arıyor,
 *  input içindeki küçük × fark edilmiyor. Geri dönüş yolu listede görünmeli.
 */
const ALL_DEPARTMENTS = "__all__";

/** Durum göstergesi + eylem butonu birleşik.
 *
 *  Boştayken kaydın DURUMUNU gösterir (aktif/pasif); üzerine gelince
 *  yapılacak EYLEMİN ikonuna döner. Böylece tek yer hem bilgi hem düğme olur.
 */
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

/** Tıklanabilir sütun başlığı — hangi sütuna göre sıralandığını da gösterir. */
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

export default function LecturersPage() {
  const { user } = useAuth();
  // Workgroup geneli paylaşımlı kaynak: bölüm boyutu YOK (K-25).
  const canWrite = canWriteIn(user, "can_manage_lecturers");

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lecturer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Lecturer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const form = useForm({
    initialValues: { full_name: "", is_external: false, department_id: "" },
    validate: {
      full_name: (v) => (v.trim() ? null : "Ad soyad boş olamaz"),
      department_id: (v) => (v ? null : "Bölüm seçin"),
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [lecs, crs, deps] = await Promise.all([
        api.get<Lecturer[]>("/lecturers?include_inactive=true"),   // K-28: pasifler de
        api.get<Course[]>("/courses"),
        api.get<Department[]>("/departments"),
      ]);
      setLecturers(lecs);
      setCourses(crs);
      setDepartments(deps);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Hoca başına verdiği DERS sayısı (bilgi sütunu). Set: aynı dersin iki şubesine
  // giren hoca için ders TEK sayılır. Bölüm artık türetilmez — hocanın BAĞLI
  // bölümü (lec.department) doğrudan kayıttan gelir, şube açılmadan da görünür.
  const courseCountByLecturer = useMemo(() => {
    const acc: Record<number, Set<number>> = {};
    for (const c of courses) {
      for (const s of c.sections) {
        (acc[s.lecturer.id] ??= new Set()).add(c.id);
      }
    }
    return acc;
  }, [courses]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      // Ders sayısı (sayısal) ilk tık ÇOKTAN AZA; ad ve bölüm alfabetik (asc).
      setSortDir(key === "courses" ? "desc" : "asc");
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const depId = deptFilter ? Number(deptFilter) : null;
    const dir = sortDir === "asc" ? 1 : -1;
    return lecturers
      .filter((l) => !q || l.full_name.toLocaleLowerCase("tr").includes(q))
      // Bölüm filtresi artık BAĞLI bölüme göre (kayıtta seçilir, hemen görünür).
      .filter((l) => depId === null || l.department?.id === depId)
      .sort((a, b) => {
        if (sortBy === "courses") {
          const va = courseCountByLecturer[a.id]?.size ?? 0;
          const vb = courseCountByLecturer[b.id]?.size ?? 0;
          if (va !== vb) return dir * (va - vb);
          return a.normalized_name.localeCompare(b.normalized_name, "tr");
        }
        if (sortBy === "department") {
          const ca = a.department?.code ?? "";
          const cb = b.department?.code ?? "";
          if (ca !== cb) return dir * ca.localeCompare(cb, "tr");
          return a.normalized_name.localeCompare(b.normalized_name, "tr");
        }
        // Unvansız ada göre (K-28): full_name unvanla başlarsa yanlış sıralanırdı.
        return dir * a.normalized_name.localeCompare(b.normalized_name, "tr");
      });
  }, [lecturers, query, deptFilter, sortBy, sortDir, courseCountByLecturer]);

  function openAdd() {
    setEditing(null);
    form.setValues({ full_name: "", is_external: false, department_id: "" });
    setModalOpen(true);
  }

  function openEdit(lec: Lecturer) {
    setEditing(lec);
    form.setValues({
      full_name: lec.full_name,
      is_external: lec.is_external,
      department_id: lec.department ? String(lec.department.id) : "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(values: typeof form.values) {
    setSubmitting(true);
    const payload = {
      full_name: values.full_name,
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
      if (e instanceof ApiError && e.status === 409) {
        form.setFieldError("full_name", e.message);
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
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
      });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/lecturers/${deleting.id}`);
      notifications.show({ color: "green", message: "Öğretim üyesi silindi" });
      setDeleting(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red",
        title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Öğretim Üyeleri</Title>
        {canWrite && <Button onClick={openAdd}>+ Öğretim Üyesi Ekle</Button>}
      </Group>

      <Group mb="md" align="flex-end">
        <TextInput
          placeholder="Ad soyad ara"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={280}
        />
        <Select
          data={[
            { value: ALL_DEPARTMENTS, label: "Tüm bölümler" },
            ...departments.map((d) => ({
              value: String(d.id),
              label: `${d.code} — ${d.name}`,
            })),
          ]}
          value={deptFilter ?? ALL_DEPARTMENTS}
          onChange={(v) => setDeptFilter(v === ALL_DEPARTMENTS || v === null ? null : v)}
          allowDeselect={false}
          w={280}
        />
      </Group>

      {visible.length === 0 ? (
        <Text c="dimmed">
          {query || deptFilter
            ? "Filtreye uyan öğretim üyesi yok."
            : "Henüz öğretim üyesi yok."}
        </Text>
      ) : (
        <Paper withBorder>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <SortableTh
                  label="Ad Soyad"
                  active={sortBy === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
                <SortableTh
                  label="Bölüm"
                  active={sortBy === "department"}
                  dir={sortDir}
                  onClick={() => toggleSort("department")}
                />
                <SortableTh
                  label="Ders"
                  active={sortBy === "courses"}
                  dir={sortDir}
                  onClick={() => toggleSort("courses")}
                />
                <Table.Th>Durum</Table.Th>
                {canWrite && <Table.Th w={130}>İşlemler</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((lec) => {
                const courseCount = courseCountByLecturer[lec.id]?.size ?? 0;
                return (
                  <Table.Tr key={lec.id} opacity={lec.active ? 1 : 0.55}>
                    <Table.Td>{lec.full_name}</Table.Td>
                    <Table.Td>
                      {lec.department ? (
                        <Badge variant="light" color="blue" size="sm">{lec.department.code}</Badge>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text c={courseCount ? undefined : "dimmed"}>{courseCount}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {!lec.active && <Badge color="gray" size="sm">Pasif</Badge>}
                        {lec.is_external && (
                          <Badge variant="light" color="orange" size="sm">Dış görevli</Badge>
                        )}
                      </Group>
                    </Table.Td>
                    {canWrite && (
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label="Düzenle">
                            <ActionIcon variant="subtle" onClick={() => openEdit(lec)}>
                              <IconPencil size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <ActiveToggle active={lec.active} onClick={() => toggleActive(lec)} />
                          <Tooltip label="Sil">
                            <ActionIcon variant="subtle" color="red" onClick={() => setDeleting(lec)}>
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Öğretim Üyesini Düzenle" : "Yeni Öğretim Üyesi"}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Ad Soyad"
              placeholder="Doç. Dr. Ayşe Kaya"
              description="Unvan yazılabilir; sistem karşılaştırma için kendi içinde sadeleştirir."
              {...form.getInputProps("full_name")}
            />
            <Select
              label="Bölüm"
              placeholder="Bölüm seçin"
              description="Bağlı olduğu bölüm. Hoca başka bölümlerin şubelerine de atanabilir."
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))}
              searchable
              {...form.getInputProps("department_id")}
            />
            <Checkbox
              label="Dış görevli (40/a)"
              {...form.getInputProps("is_external", { type: "checkbox" })}
            />
            <Button type="submit" loading={submitting} mt="sm">
              {editing ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Öğretim üyesini sil"
      >
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
    </>
  );
}
