import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Grid, Group, Loader, Modal, Paper,
  ScrollArea, Stack, Text, TextInput, ThemeIcon, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconActivity, IconArrowRight, IconBook2, IconBuilding, IconCalendarEvent,
  IconCalendarWeek, IconDoor, IconPencil, IconPlus, IconSchool, IconSearch,
  IconTrash, IconUsers, type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "../api/types";
import type {
  AuditEntityType, AuditLog, AuditLogPage, Course, Department, Exam, Lecturer,
  ManagedUser, WeeklyEntry,
} from "../api/types";

// Bu ekran bir YÖNETİM ekranı değil, bir GENEL BAKIŞ/gezinme merkezidir: her
// varlığın kendi sayfası var (Dersler, Öğretim Üyeleri, Derslikler, Haftalık,
// Sınavlar). Buradaki KPI'lar ve kısa listeler yalnızca özet gösterir ve
// ilgili sayfaya SEÇİLİ BÖLÜM önceden süzülmüş biçimde götürür. Böylece CRUD
// mantığı tek bir yerde kalır, burada kopyalanmaz.

// Kartların :hover ve seçili durumunu inline style ile veremeyiz (pseudo-class
// gerekli); bu yüzden küçük bir stil bloğu enjekte ediyoruz. Tema değişkenleri
// (mantine-color-*) sayesinde açık/koyu temada da doğru renk gelir.
const CARD_STYLES = `
.dept-card {
  border: 1px solid var(--mantine-color-gray-3);
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
  border-left-color: var(--mantine-color-blue-6);
  background: var(--mantine-color-blue-0);
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

type DeptForm = { name: string; code: string; name_en: string; faculty_en: string };

export default function DepartmentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";       // Bölüm yazma + üye/işlem verisi ADMIN'e özel (kontrat §2-§3)
  const navigate = useNavigate();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [classroomCount, setClassroomCount] = useState(0);
  const [members, setMembers] = useState<ManagedUser[]>([]);   // yalnız ADMIN doldurur
  const [activity, setActivity] = useState<AuditLog[]>([]);    // yalnız ADMIN doldurur

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Seçim kalıcı: sekmeden dönünce kullanıcı kaldığı bölümde devam etsin.
  // İlk ziyarette null → boş durum (spec'in istediği "bir bölüm seçin" ekranı).
  const [selectedId, setSelectedId] = useLocalStorage<number | null>({
    key: "dept-overview-selected", defaultValue: null, getInitialValueInEffect: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const form = useForm<DeptForm>({
    initialValues: { name: "", code: "", name_en: "", faculty_en: "" },
    validate: {
      name: (v) => (v.trim() ? null : "Bölüm adı boş olamaz"),
      code: (v) => (v.trim() ? null : "Bölüm kodu boş olamaz"),
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Herkesin okuyabildiği veriler (K-26): bölüm/ders/hoca/haftalık/sınav/derslik.
      const [deps, crs, lecs, wk, ex, rooms] = await Promise.all([
        api.get<Department[]>("/departments"),
        api.get<Course[]>("/courses"),
        api.get<Lecturer[]>("/lecturers"),
        api.get<WeeklyEntry[]>("/weekly-entries"),
        api.get<Exam[]>("/exams"),
        api.get<{ id: number; active: boolean }[]>("/classrooms"),
      ]);
      setDepartments(deps);
      setCourses(crs);
      setLecturers(lecs);
      setWeekly(wk);
      setExams(ex);
      setClassroomCount(rooms.filter((r) => r.active).length);

      // Üye sayısı ve son işlemler yalnız ADMIN'e açık uçlardan gelir; alt hesap
      // için bu bölümler gizlenir. Ayrı bir istek, ana veriyi bloklamasın diye
      // hata durumunda sessizce boş bırakılır.
      if (isAdmin) {
        try {
          const [us, al] = await Promise.all([
            api.get<ManagedUser[]>("/users"),
            api.get<AuditLogPage>("/audit-logs?limit=8"),
          ]);
          setMembers(us);
          setActivity(al.items);
        } catch {
          setMembers([]);
          setActivity([]);
        }
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // section.course.id → department_id eşlemesi: haftalık giriş ve sınav
  // doğrudan bölüm taşımaz, ders üzerinden bağlanır.
  const courseDeptById = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of courses) m.set(c.id, c.department_id);
    return m;
  }, [courses]);

  // Bölüm başına sayaçlar. Pasif ders/şube sayıma girmez (K-33 deseni).
  const statsByDept = useMemo(() => {
    const acc: Record<number, {
      courses: number; lecturers: Set<number>; weekly: number; exams: number; members: number;
    }> = {};
    const ensure = (id: number) =>
      (acc[id] ??= { courses: 0, lecturers: new Set(), weekly: 0, exams: 0, members: 0 });

    for (const c of courses) {
      if (!c.active) continue;
      const e = ensure(c.department_id);
      e.courses += 1;
      for (const s of c.sections) if (s.active) e.lecturers.add(s.lecturer.id);
    }
    for (const w of weekly) {
      const depId = courseDeptById.get(w.section.course.id);
      if (depId != null) ensure(depId).weekly += 1;
    }
    for (const ex of exams) {
      const depId = courseDeptById.get(ex.course.id);
      if (depId != null) ensure(depId).exams += 1;
    }
    for (const u of members) {
      for (const depId of u.department_ids) ensure(depId).members += 1;
    }
    return acc;
  }, [courses, weekly, exams, members, courseDeptById]);

  // Arama + kod'a göre alfabetik sıralama.
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

  // Son dersler: seçili bölümün aktif dersleri, en yeni (id büyük) önce.
  const recentCourses = useMemo(() => {
    if (!selected) return [];
    return courses
      .filter((c) => c.active && c.department_id === selected.id)
      .sort((a, b) => b.id - a.id)
      .slice(0, 3);
  }, [courses, selected]);

  // Son öğretim üyeleri: seçili bölümün aktif derslerinde şubesi olan hocalar
  // (hoca doğrudan bölüme bağlı değil, ders/şube üzerinden bağlanır).
  const recentLecturers = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<number>();
    for (const c of courses) {
      if (!c.active || c.department_id !== selected.id) continue;
      for (const s of c.sections) if (s.active) ids.add(s.lecturer.id);
    }
    return lecturers
      .filter((l) => ids.has(l.id))
      .sort((a, b) => b.id - a.id)
      .slice(0, 4);
  }, [courses, lecturers, selected]);

  function openAdd() {
    setEditing(null);
    form.setValues({ name: "", code: "", name_en: "", faculty_en: "" });
    setModalOpen(true);
  }
  function openEdit(dep: Department) {
    setEditing(dep);
    form.setValues({
      name: dep.name, code: dep.code,
      name_en: dep.name_en ?? "", faculty_en: dep.faculty_en ?? "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(values: DeptForm) {
    setSubmitting(true);
    const payload = {
      ...values,
      name_en: values.name_en.trim() || null,
      faculty_en: values.faculty_en.trim() || null,
    };
    try {
      if (editing) {
        await api.patch<Department>(`/departments/${editing.id}`, payload);
        notifications.show({ color: "green", message: "Bölüm güncellendi" });
      } else {
        const created = await api.post<Department>("/departments", payload);
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

  return (
    <>
      <style>{CARD_STYLES}</style>

      <Grid gutter="lg" align="stretch">
        {/* ================= SOL PANEL ================= */}
        <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
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
        <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
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
            // fade animasyonu tetiklenir (spec: "overview değişince fade").
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

                {/* --- KPI kartları --- */}
                <div>
                  <Text fw={600} mb="sm">Genel Bakış</Text>
                  <Grid gutter="md">
                    <KpiCard icon={IconBook2} label="Dersler" value={st?.courses ?? 0}
                      onClick={() => navigate(`/courses?department_id=${selected.id}`)} />
                    <KpiCard icon={IconSchool} label="Öğretim Üyeleri" value={st?.lecturers.size ?? 0}
                      onClick={() => navigate(`/lecturers?department_id=${selected.id}`)} />
                    {isAdmin && (
                      <KpiCard icon={IconUsers} label="Bölüm Üyeleri" value={st?.members ?? 0}
                        onClick={() => navigate("/dashboard")} />
                    )}
                    <KpiCard icon={IconCalendarWeek} label="Haftalık Program" value={st?.weekly ?? 0}
                      onClick={() => navigate(`/weekly?department_id=${selected.id}`)} />
                    <KpiCard icon={IconCalendarEvent} label="Sınavlar" value={st?.exams ?? 0}
                      onClick={() => navigate(`/exams?department_id=${selected.id}`)} />
                    {/* Derslikler bölüme değil workgroup'a aittir; sayaç paylaşımlı
                        toplamı gösterir ve filtresiz /classrooms'a götürür. */}
                    <KpiCard icon={IconDoor} label="Aktif Derslikler" value={classroomCount}
                      onClick={() => navigate("/classrooms")} />
                  </Grid>
                </div>

                <Grid gutter="lg">
                  {/* --- Son Dersler --- */}
                  <Grid.Col span={{ base: 12, lg: 6 }}>
                    <Paper withBorder radius="md" p="md" h="100%">
                      <Group justify="space-between" mb="sm">
                        <Text fw={600}>Son Dersler</Text>
                        <Button variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />}
                          onClick={() => navigate(`/courses?department_id=${selected.id}`)}>
                          Tüm Dersler
                        </Button>
                      </Group>
                      {recentCourses.length === 0 ? (
                        <Text c="dimmed" size="sm">Bu bölümde ders yok.</Text>
                      ) : (
                        <Stack gap="xs">
                          {recentCourses.map((c) => (
                            <Group key={c.id} justify="space-between" wrap="nowrap">
                              <div style={{ minWidth: 0 }}>
                                <Text size="sm" fw={600}>{c.code}</Text>
                                <Text size="sm" c="dimmed" lineClamp={1}>{c.name}</Text>
                              </div>
                              <Badge variant="light" color="gray">{c.year}. Sınıf</Badge>
                            </Group>
                          ))}
                        </Stack>
                      )}
                    </Paper>
                  </Grid.Col>

                  {/* --- Son Öğretim Üyeleri --- */}
                  <Grid.Col span={{ base: 12, lg: 6 }}>
                    <Paper withBorder radius="md" p="md" h="100%">
                      <Group justify="space-between" mb="sm">
                        <Text fw={600}>Son Öğretim Üyeleri</Text>
                        <Button variant="subtle" size="compact-sm" rightSection={<IconArrowRight size={14} />}
                          onClick={() => navigate(`/lecturers?department_id=${selected.id}`)}>
                          Tüm Öğretim Üyeleri
                        </Button>
                      </Group>
                      {recentLecturers.length === 0 ? (
                        <Text c="dimmed" size="sm">Bu bölümde öğretim üyesi yok.</Text>
                      ) : (
                        <Stack gap="xs">
                          {recentLecturers.map((l) => (
                            <Group key={l.id} justify="space-between" wrap="nowrap">
                              <Text size="sm" fw={500} lineClamp={1}>{l.full_name}</Text>
                              {l.is_external && <Badge variant="light" color="orange" size="sm">Dış görevli</Badge>}
                            </Group>
                          ))}
                        </Stack>
                      )}
                    </Paper>
                  </Grid.Col>
                </Grid>

                {/* --- Son İşlemler (yalnız ADMIN; audit-logs workgroup geneli) --- */}
                {isAdmin && (
                  <Paper withBorder radius="md" p="md">
                    <Group gap="xs" mb="sm">
                      <IconActivity size={18} />
                      <Text fw={600}>Son İşlemler</Text>
                    </Group>
                    {activity.length === 0 ? (
                      <Text c="dimmed" size="sm">Kayıtlı işlem yok.</Text>
                    ) : (
                      <Stack gap="sm">
                        {activity.map((a) => <ActivityRow key={a.id} log={a} />)}
                      </Stack>
                    )}
                  </Paper>
                )}

                {/* --- Hızlı İşlemler: yalnızca gezinme, CRUD burada değil --- */}
                <Paper withBorder radius="md" p="md">
                  <Text fw={600} mb="sm">Hızlı İşlemler</Text>
                  <Group gap="sm">
                    <Button variant="light" leftSection={<IconBook2 size={16} />}
                      onClick={() => navigate(`/courses?department_id=${selected.id}`)}>
                      Ders Ekle
                    </Button>
                    <Button variant="light" leftSection={<IconSchool size={16} />}
                      onClick={() => navigate("/lecturers")}>
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
                    {isAdmin && (
                      <Button variant="light" leftSection={<IconUsers size={16} />}
                        onClick={() => navigate("/dashboard")}>
                        Üye Davet Et
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="light" color="gray" leftSection={<IconPencil size={16} />}
                        onClick={() => openEdit(selected)}>
                        Bölümü Düzenle
                      </Button>
                    )}
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
            <TextInput
              label="İngilizce Ad (opsiyonel)"
              description="Resmi sınav programı başlığında kullanılır: DEPARTMENT OF …"
              placeholder="Computer Engineering"
              {...form.getInputProps("name_en")}
            />
            <TextInput
              label="Fakülte (İngilizce, opsiyonel)"
              placeholder="Faculty of Engineering"
              {...form.getInputProps("faculty_en")}
            />
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
// yönetim sayfasına (bölüm süzgeci uygulanmış) götürür.
function KpiCard({ icon: Icon, label, value, onClick }: {
  icon: ComponentType<IconProps>; label: string; value: number; onClick: () => void;
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
            <Text fw={700} fz={28} lh={1}>{value}</Text>
            <Text size="sm" c="dimmed" mt={6}>{label}</Text>
          </div>
          <ThemeIcon variant="light" color="gray" size="lg" radius="md">
            <Icon size={20} />
          </ThemeIcon>
        </Group>
      </Paper>
    </Grid.Col>
  );
}

// Tek işlem satırı: kim · ne yaptı · hangi kayıt · ne zaman.
function ActivityRow({ log }: { log: AuditLog }) {
  const action = AUDIT_ACTION_LABELS[log.action];
  const entity = AUDIT_ENTITY_LABELS[log.entity_type as AuditEntityType] ?? log.entity_type;
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Badge variant="light" color={action?.color ?? "gray"} size="sm" style={{ flexShrink: 0 }}>
        {action?.label ?? log.action}
      </Badge>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Text size="sm" lineClamp={1}>
          <b>{log.user?.name ?? "—"}</b>{" · "}{entity}
          {log.entity_label ? ` · ${log.entity_label}` : ""}
        </Text>
      </div>
      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{formatTime(log.created_at)}</Text>
    </Group>
  );
}

// Kısa göreli zaman: "az önce" / "3 sa önce" / tarih. Audit satırı için yeterli.
function formatTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} gün önce`;
  return d.toLocaleDateString("tr");
}
