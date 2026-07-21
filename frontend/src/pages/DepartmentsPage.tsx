import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text, TextInput, Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Department, Course } from "../api/types";
import { SimpleGrid, ActionIcon, Tooltip } from "@mantine/core";
import { IconPencil, IconTrash } from "@tabler/icons-react";

type Counts = { courses: number; lecturers: number };

export default function DepartmentsPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "ADMIN";   // Bölüm yazma ADMIN'e özel (kontrat §3)

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const form = useForm({
    initialValues: { name: "", code: "" },
    validate: {
      name: (v) => (v.trim() ? null : "Bölüm adı boş olamaz"),
      code: (v) => (v.trim() ? null : "Bölüm kodu boş olamaz"),
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // İki isteği paralel at (Promise.all): biri diğerini beklemesin.
      // K-26: alt hesap da tüm dersleri okur, sayımlar herkes için doğru çıkar.
      const [deps, crs] = await Promise.all([
        api.get<Department[]>("/departments"),
        api.get<Course[]>("/courses"),
      ]);
      setDepartments(deps);
      setCourses(crs);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Sayımlar (Yol A: istemci tarafı). Pasif ders/şube sayıma girmez.
  // Aynı hoca iki bölümün dersini veriyorsa her ikisinde de sayılır (Set bölüm bazlı).
  const countsByDept = useMemo(() => {
    const acc: Record<number, { courses: number; lecturers: Set<number> }> = {};
    for (const c of courses) {
      if (!c.active) continue;
      const e = (acc[c.department_id] ??= { courses: 0, lecturers: new Set<number>() });
      e.courses += 1;
      for (const s of c.sections) if (s.active) e.lecturers.add(s.lecturer.id);
    }
    const out: Record<number, Counts> = {};
    for (const [id, v] of Object.entries(acc)) {
      out[Number(id)] = { courses: v.courses, lecturers: v.lecturers.size };
    }
    return out;
  }, [courses]);

  // Arama filtresi + sıralama: bölüm koduna göre alfabetik (K-27 sonrası
  // aktif/pasif ayrımı ekranda yok, tek katmanlı sıralama yeterli).
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return departments
      .filter((d) =>
        !q ||
        d.code.toLocaleLowerCase("tr").includes(q) ||
        d.name.toLocaleLowerCase("tr").includes(q),
      )
      .sort((a, b) => a.code.localeCompare(b.code, "tr"));
  }, [departments, query]);

  function openAdd() {
    setEditing(null);
    form.setValues({ name: "", code: "" });
    setModalOpen(true);
  }
  function openEdit(dep: Department) {
    setEditing(dep);
    form.setValues({ name: dep.name, code: dep.code });
    setModalOpen(true);
  }

  async function handleSubmit(values: typeof form.values) {
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch<Department>(`/departments/${editing.id}`, values);
        notifications.show({ color: "green", message: "Bölüm güncellendi" });
      } else {
        await api.post<Department>("/departments", values);
        notifications.show({ color: "green", message: "Bölüm eklendi" });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        form.setFieldError("code", e.message);
      } else {
        notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/departments/${deleting.id}`);
      notifications.show({ color: "green", message: "Bölüm silindi" });
      setDeleting(null);
      await load();
    } catch (e) {
      // 409 = bağlı veri var; backend mesajı neyin engellediğini sayar (K-27)
      notifications.show({
        color: "red",
        title: "Bölüm silinemedi",
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
        <Title order={3}>Bölümler</Title>
        {canWrite && <Button onClick={openAdd}>+ Bölüm Ekle</Button>}
      </Group>

      <TextInput
        placeholder="Bölüm kodu veya adı ara"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        mb="md"
        maw={360}
      />

      {visible.length === 0 ? (
        <Text c="dimmed">{query ? "Eşleşen bölüm yok." : "Henüz bölüm yok."}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {visible.map((dep) => {
            const c = countsByDept[dep.id] ?? { courses: 0, lecturers: 0 };
            return (
              <Paper key={dep.id} withBorder p="md">
                <Group justify="space-between" wrap="nowrap" mb="xs">
                  <Text fw={700} size="lg">{dep.code}</Text>
                  {canWrite && (
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Düzenle">
                        <ActionIcon variant="subtle" onClick={() => openEdit(dep)}>
                          <IconPencil size={18} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Sil">
                        <ActionIcon variant="subtle" color="red" onClick={() => setDeleting(dep)}>
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Group>

                <Text c="dimmed" mb="sm" lineClamp={2}>{dep.name}</Text>

                <Group gap="xs">
                  <Badge variant="light" color="blue">{c.courses} ders</Badge>
                  <Badge variant="light" color="grape">{c.lecturers} öğretim üyesi</Badge>
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "Bölümü Düzenle" : "Yeni Bölüm"}
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput label="Bölüm Adı" placeholder="Bilgisayar Mühendisliği" {...form.getInputProps("name")} />
            <TextInput label="Bölüm Kodu" placeholder="CENG" {...form.getInputProps("code")} />
            <Button type="submit" loading={submitting} mt="sm">
              {editing ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Bölümü sil">
        <Text>
          <b>{deleting?.code}</b> — {deleting?.name} kalıcı olarak silinecek.
          Bu işlem geri alınamaz.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button color="red" loading={deleteBusy} onClick={handleDelete}>Sil</Button>
        </Group>
      </Modal>
    </>
  );
}