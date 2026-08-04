import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Grid, Group, Loader, Modal, Paper,
  ScrollArea, Stack, Table, Text, TextInput, ThemeIcon, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconBook2, IconBuilding, IconCalendarEvent,
  IconCalendarWeek, IconPencil, IconPlus, IconSchool, IconSearch,
  IconShieldCheck, IconTrash, IconUsers, type IconProps,
} from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CAPABILITIES } from "../api/types";
import type { ConflictScan, Course, Department, Lecturer, ManagedUser } from "../api/types";

// Bu ekran bir YÖNETİM ekranı değil, bir GENEL BAKIŞ/gezinme merkezidir: her
// varlığın kendi sayfası var (Dersler, Öğretim Üyeleri, Derslikler, Haftalık,
// Sınavlar). Buradaki KPI'lar özet gösterir ve ilgili sayfaya SEÇİLİ BÖLÜM
// önceden süzülmüş biçimde götürür. Böylece CRUD mantığı tek yerde kalır.

// Kartların :hover ve seçili durumunu inline style ile veremeyiz (pseudo-class
// gerekli); bu yüzden küçük bir stil bloğu enjekte ediyoruz.
const CARD_STYLES = `
.dept-card {
  border: 1px solid var(--mantine-color-default-border);
  border-left: 3px solid transparent;
  border-radius: var(--mantine-radius-md);
  background: var(--mantine-color-body);
  transition: box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.dept-card:hover {
  border-color: var(--mantine-color-blue-4);
  box-shadow: 0 4px 14px rgba(0,0,0,0.08);
  transform: translateY(-1px);
}
.dept-card[data-selected="true"] {
  border-left-color: var(--mantine-color-blue-filled);
  /* blue-light: variant="light"'ın tema-farkındalıklı tonu — aydınlıkta soluk
     mavi, karanlıkta yarı saydam mavi. blue-0 sabit açık olduğu için dark'ta
     beyaz ada oluyordu. */
  background: var(--mantine-color-blue-light);
  box-shadow: 0 6px 20px rgba(0,0,0,0.10);
}
.kpi-card {
  transition: box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.kpi-card:hover {
  border-color: var(--mantine-color-blue-4);
  box-shadow: 0 4px 14px rgba(0,0,0,0.08);
  transform: translateY(-1px);
}
@keyframes depOverviewFade {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

type DeptForm = { name: string; code: string };

export default function DepartmentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";       // Bölüm yazma + üye verisi ADMIN'e özel (kontrat §2-§3)
  const navigate = useNavigate();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);   // asli bölüm sayacı için
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [members, setMembers] = useState<ManagedUser[]>([]);   // yalnız ADMIN doldurur

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Seçim kalıcı: sekmeden dönünce kullanıcı kaldığı bölümde devam etsin.
  const [selectedId, setSelectedId] = useLocalStorage<number | null>({
    key: "dept-overview-selected", defaultValue: null, getInitialValueInEffect: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const form = useForm<DeptForm>({
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
      // Herkesin okuyabildiği veriler (K-26): bölüm/ders/hoca/çakışma taraması.
      const [deps, crs, lecs, cf] = await Promise.all([
        api.get<Department[]>("/departments"),
        api.get<Course[]>("/courses"),
        api.get<Lecturer[]>("/lecturers"),          // varsayılan: yalnız aktifler
        api.get<ConflictScan>("/conflicts"),
      ]);
      setDepartments(deps);
      setCourses(crs);
      setLecturers(lecs);
      setScan(cf);

      // Yetkili hesaplar yalnız ADMIN'e açık /users'tan gelir; alt hesap için
      // gizlenir. Ayrı istek, ana veriyi bloklamasın diye hata durumunda sessiz.
      if (isAdmin) {
        try {
          setMembers(await api.get<ManagedUser[]>("/users"));
        } catch {
          setMembers([]);
        }
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Bölüm başına ders + öğretim üyesi sayısı. Pasif ders sayıma girmez (K-33).
  // Öğretim üyesi = ASLİ bölümü (department_id) o bölüm olan aktif hocalar —
  // "o bölümde ders veren herkes" değil (başka bölümde ders verebilir).
  const statsByDept = useMemo(() => {
    const acc: Record<number, { courses: number; lecturers: number }> = {};
    const ensure = (id: number) => (acc[id] ??= { courses: 0, lecturers: 0 });
    for (const c of courses) {
      if (!c.active) continue;
      ensure(c.department_id).courses += 1;
    }
    for (const l of lecturers) {
      if (l.department_id != null) ensure(l.department_id).lecturers += 1;
    }
    return acc;
  }, [courses, lecturers]);

  // Bölüm başına çakışma: bir çakışma, etkilediği HER bölüme bir kez sayılır
  // (affected içinde aynı bölüm iki kez geçse de). Bölümler-arası bir çakışma
  // iki bölümün de sayacına düşer — ikisini de ilgilendirir (K-26).
  const conflictsByDept = useMemo(() => {
    const acc: Record<number, { hard: number; warn: number }> = {};
    const ensure = (id: number) => (acc[id] ??= { hard: 0, warn: 0 });
    const tally = (list: ConflictScan["hard"], key: "hard" | "warn") => {
      for (const c of list) {
        const deps = new Set<number>();
        for (const a of c.affected) if (a.department_id != null) deps.add(a.department_id);
        for (const id of deps) ensure(id)[key] += 1;
      }
    };
    if (scan) {
      tally(scan.hard, "hard");
      tally(scan.warnings, "warn");
    }
    return acc;
  }, [scan]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return departments
      .filter((d) =>
        !q ||
        d.code.toLocaleLowerCase("tr").includes(q) ||
        d.name.toLocaleLowerCase("tr").includes(q))
      .sort((a, b) => a.code.localeCompare(b.code, "tr"));
  }, [departments, query]);

  const selected = useMemo(
    () => departments.find((d) => d.id === selectedId) ?? null,
    [departments, selectedId],
  );

  // Seçili bölümde yetkisi olan hesaplar: bu bölüme atanmış alt hesaplar +
  // TÜM adminler (admin her bölümde yetkilidir). Adminler listenin başında.
  const deptMembers = useMemo(() => {
    if (!selected) return [];
    return members
      .filter((m) => m.role === "ADMIN" || m.department_ids.includes(selected.id))
      .sort((a, b) => {
        const aa = a.role === "ADMIN", bb = b.role === "ADMIN";
        if (aa !== bb) return aa ? -1 : 1;         // adminler önce
        return a.name.localeCompare(b.name, "tr");
      });
  }, [members, selected]);

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

  async function handleSubmit(values: DeptForm) {
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch<Department>(`/departments/${editing.id}`, values);
        notifications.show({ color: "green", message: "Bölüm güncellendi" });
      } else {
        const created = await api.post<Department>("/departments", values);
        notifications.show({ color: "green", message: "Bölüm eklendi" });
        setSelectedId(created.id);   // yeni bölüm hemen sağ panelde açılsın
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
      if (selectedId === deleting.id) setSelectedId(null);
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

  const st = selected ? statsByDept[selected.id] : undefined;
  const cf = selected ? conflictsByDept[selected.id] : undefined;
  const cfTotal = (cf?.hard ?? 0) + (cf?.warn ?? 0);
  const cfColor = (cf?.hard ?? 0) > 0 ? "red" : (cf?.warn ?? 0) > 0 ? "orange" : "green";

  return (
    <>
      <style>{CARD_STYLES}</style>

      {/* columns={100}: sol panel 25%→21% (~%15 daha dar), sağ panel genişler */}
      <Grid gutter="lg" align="stretch" columns={100}>
        {/* ================= SOL PANEL ================= */}
        <Grid.Col span={{ base: 100, md: 30, lg: 21 }}>
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Title order={4}>Bölümler</Title>
              {isAdmin && (
                <Button size="xs" leftSection={<IconPlus size={16} />} onClick={openAdd}>
                  Bölüm Ekle
                </Button>
              )}
            </Group>

            <TextInput
              placeholder="Ara"
              value={query}
              leftSection={<IconSearch size={16} />}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />

            {visible.length === 0 ? (
              <Text c="dimmed" size="sm" mt="xs">
                {query ? "Eşleşen bölüm yok." : "Henüz bölüm yok."}
              </Text>
            ) : (
              <ScrollArea.Autosize mah="calc(100vh - 220px)" type="hover">
                <Stack gap="xs">
                  {visible.map((dep) => (
                    <UnstyledButton
                      key={dep.id}
                      className="dept-card"
                      data-selected={dep.id === selectedId}
                      onClick={() => setSelectedId(dep.id)}
                      p="md"
                    >
                      <Text fw={700} size="sm">{dep.code}</Text>
                      <Text c="dimmed" size="sm" lineClamp={1}>{dep.name}</Text>
                    </UnstyledButton>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Stack>
        </Grid.Col>

        {/* ================= SAĞ PANEL ================= */}
        <Grid.Col span={{ base: 100, md: 70, lg: 79 }}>
          {!selected ? (
            <Paper withBorder radius="md" p="xl" style={{ minHeight: 360 }}>
              <Stack align="center" justify="center" gap="sm" h={320} c="dimmed">
                <ThemeIcon size={56} radius="xl" variant="light" color="gray">
                  <IconBuilding size={28} />
                </ThemeIcon>
                <Text>Genel bakışını görmek için bir bölüm seçin.</Text>
              </Stack>
            </Paper>
          ) : (
            // key={selected.id} → bölüm değişince içerik yeniden monte olur ve
            // fade animasyonu tetiklenir.
            <div key={selected.id} style={{ animation: "depOverviewFade 200ms ease" }}>
              <Stack gap="lg">
                {/* --- Başlık --- */}
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="md" wrap="nowrap">
                    <ThemeIcon size={44} radius="md" variant="light">
                      <IconBuilding size={24} />
                    </ThemeIcon>
                    <div>
                      <Text fw={700} size="xl">{selected.code}</Text>
                      <Text c="dimmed">{selected.name}</Text>
                    </div>
                  </Group>
                  {isAdmin && (
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Bölümü Düzenle">
                        <ActionIcon variant="subtle" color="gray" onClick={() => openEdit(selected)}>
                          <IconPencil size={18} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Bölümü Sil">
                        <ActionIcon variant="subtle" color="red" onClick={() => setDeleting(selected)}>
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Group>

                {/* --- KPI kartları: Dersler, Öğretim Üyeleri, Çakışmalar --- */}
                <div>
                  <Text fw={600} mb="sm">Genel Bakış</Text>
                  <Grid gutter="md">
                    <KpiCard icon={IconBook2} label="Dersler" value={st?.courses ?? 0}
                      onClick={() => navigate(`/courses?department_id=${selected.id}`)} />
                    <KpiCard icon={IconSchool} label="Öğretim Üyeleri" value={st?.lecturers ?? 0}
                      onClick={() => navigate(`/lecturers?department_id=${selected.id}`)} />
                    {/* Çakışma sayacı: bu bölümü etkileyen hard+warning. Tıklayınca
                        rapor bu bölüme süzülü açılır. */}
                    <KpiCard
                      icon={cfTotal > 0 ? IconAlertTriangle : IconShieldCheck}
                      label="Çakışmalar"
                      color={cfColor}
                      // Dashboard gibi ayrık: engel (kırmızı) / uyarı (turuncu).
                      valueContent={cfTotal > 0 ? (
                        <Group gap={6} align="baseline" wrap="nowrap">
                          <Text span fw={700} fz={28} lh={1} c="red">{cf?.hard ?? 0}</Text>
                          <Text span fw={700} fz={20} lh={1} c="dimmed">/</Text>
                          <Text span fw={700} fz={28} lh={1} c="orange">{cf?.warn ?? 0}</Text>
                        </Group>
                      ) : (
                        <Text span fw={700} fz={28} lh={1} c="green">0</Text>
                      )}
                      hint={cfTotal > 0 ? "engel / uyarı" : "temiz"}
                      hintColor={cfTotal > 0 ? "dimmed" : "green"}
                      onClick={() => navigate(`/conflicts?department_id=${selected.id}`)}
                    />
                  </Grid>
                </div>

                {/* --- Bölüm Yetkilileri (yalnız ADMIN) --- */}
                {isAdmin && (
                  <Paper withBorder radius="md" p="md">
                    <Group gap="xs" mb="sm">
                      <IconUsers size={18} />
                      <Text fw={600}>Bölüm Yetkilileri</Text>
                    </Group>
                    {deptMembers.length === 0 ? (
                      <Text c="dimmed" size="sm">
                        Bu bölüme atanmış yetkili hesap yok.
                      </Text>
                    ) : (
                      <Table verticalSpacing="xs" horizontalSpacing="md">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>İsim</Table.Th>
                            <Table.Th>Rol</Table.Th>
                            <Table.Th>Yetkiler</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {deptMembers.map((m) => {
                            const isAdm = m.role === "ADMIN";
                            const caps = CAPABILITIES.filter((c) => m[c.key]);
                            return (
                              <Table.Tr key={m.id}>
                                <Table.Td>
                                  <Group gap={6} wrap="nowrap">
                                    <Text size="sm" fw={500} lineClamp={1}>{m.name}</Text>
                                    {m.status !== "ACTIVE" && (
                                      <Badge size="xs" variant="light" color="gray">Pasif</Badge>
                                    )}
                                  </Group>
                                </Table.Td>
                                <Table.Td>
                                  <Badge size="sm" variant="light" color={isAdm ? "grape" : "blue"}>
                                    {isAdm ? "Yönetici" : "Alt Hesap"}
                                  </Badge>
                                </Table.Td>
                                <Table.Td>
                                  {isAdm ? (
                                    <Text size="xs" c="dimmed">Tüm yetkiler</Text>
                                  ) : caps.length === 0 ? (
                                    <Text size="xs" c="dimmed">Yalnız görüntüleme</Text>
                                  ) : (
                                    <Group gap={4}>
                                      {caps.map((c) => (
                                        <Badge key={c.key} size="xs" variant="outline" color="gray">
                                          {c.label}
                                        </Badge>
                                      ))}
                                    </Group>
                                  )}
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    )}
                  </Paper>
                )}

                {/* --- Hızlı İşlemler: yalnızca gezinme, CRUD burada değil --- */}
                <Paper withBorder radius="md" p="md">
                  <Text fw={600} mb="sm">Hızlı İşlemler</Text>
                  <Group gap="sm">
                    {/* add=1: hedef sayfa ekleme formunu açık getirir; department_id
                        de önceden seçili gelir (ders formu bölüm alanı taşır). */}
                    <Button variant="light" leftSection={<IconBook2 size={16} />}
                      onClick={() => navigate(`/courses?add=1&department_id=${selected.id}`)}>
                      Ders Ekle
                    </Button>
                    <Button variant="light" leftSection={<IconSchool size={16} />}
                      onClick={() => navigate(`/lecturers?add=1&department_id=${selected.id}`)}>
                      Öğretim Üyesi Ekle
                    </Button>
                    <Button variant="light" leftSection={<IconCalendarWeek size={16} />}
                      onClick={() => navigate(`/weekly?department_id=${selected.id}`)}>
                      Haftalık Programı Aç
                    </Button>
                    <Button variant="light" leftSection={<IconCalendarEvent size={16} />}
                      onClick={() => navigate(`/exams?department_id=${selected.id}`)}>
                      Sınav Takvimini Aç
                    </Button>
                  </Group>
                </Paper>
              </Stack>
            </div>
          )}
        </Grid.Col>
      </Grid>

      {/* ================= Modallar (mevcut CRUD davranışı korunur) ================= */}
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

// KPI kartı: büyük sayı + küçük başlık + minimal ikon; tıklanınca ilgili
// sayfaya (bölüm süzgeci uygulanmış) götürür. `valueContent` verilirse sayı
// yerine o çizilir (çakışma kartında "engel / uyarı" ayrık gösterimi için).
function KpiCard({ icon: Icon, label, value, valueContent, onClick, color, hint, hintColor }: {
  icon: ComponentType<IconProps>; label: string; value?: number; valueContent?: ReactNode;
  onClick: () => void; color?: string; hint?: string; hintColor?: string;
}) {
  return (
    <Grid.Col span={{ base: 6, sm: 4 }}>
      <Paper
        withBorder radius="md" p="md" className="kpi-card"
        onClick={onClick}
        style={{ cursor: "pointer", height: "100%" }}
      >
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            {valueContent ?? <Text fw={700} fz={28} lh={1} c={color}>{value}</Text>}
            <Text size="sm" c="dimmed" mt={6}>{label}</Text>
            {hint && <Text size="xs" c={hintColor ?? color ?? "dimmed"} mt={2}>{hint}</Text>}
          </div>
          <ThemeIcon variant="light" color={color ?? "gray"} size="lg" radius="md">
            <Icon size={20} />
          </ThemeIcon>
        </Group>
      </Paper>
    </Grid.Col>
  );
}

