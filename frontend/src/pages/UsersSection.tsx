import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, MultiSelect,
  Pagination, Paper, Select, Stack, Table, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconMail, IconPencil, IconTrash } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CAPABILITIES } from "../api/types";
import type { CapabilityKey, Department, ManagedUser, Role, UserStatus } from "../api/types";

const ALL = "__all__";

/** Sayfa başına kullanıcı satırı. Dashboard tek sayfada dört blok taşıyor;
 *  kullanıcı tablosu diğerlerini aşağı itmemeli. */
const PAGE_SIZE = 10;

const STATUS_META: Record<UserStatus, { label: string; color: string }> = {
  PENDING: { label: "Davet bekliyor", color: "yellow" },
  ACTIVE: { label: "Aktif", color: "green" },
  DISABLED: { label: "Kapalı", color: "gray" },
};

type FormValues = {
  name: string;
  email: string;
  role: Role;
  department_ids: string[];
  caps: Record<CapabilityKey, boolean>;
};

const BOS_FORM: FormValues = {
  name: "", email: "", role: "SUB_ACCOUNT", department_ids: [],
  caps: {
    can_manage_courses: false, can_manage_weekly: false, can_manage_exams: false,
    can_manage_classrooms: false, can_manage_lecturers: false,
  },
};

/** Dashboard'un kullanıcı bloğu: davet + yönetim (K-34).
 *
 *  Davet ayrı bir sekme değil, bu tablonun sağ üstündeki düğme. Davet
 *  gönderdikten sonra admin'in ilk sorusu "gitti mi, listede göründü mü"
 *  oluyor; ayrı ekranda olsa kendi işini doğrulamak için sayfa değiştirmesi
 *  gerekirdi.
 */
export default function UsersSection() {
  const { user: me } = useAuth();

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  const [formModal, setFormModal] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [disabling, setDisabling] = useState<ManagedUser | null>(null);

  const form = useForm<FormValues>({
    initialValues: BOS_FORM,
    validate: {
      name: (v) => (v.trim() ? null : "Ad boş olamaz"),
      // Düzenlemede e-posta alanı zaten kilitli, doğrulaması da atlanır.
      email: (v) => (editing || v.trim() ? null : "E-posta boş olamaz"),
    },
  });

  async function load() {
    setLoading(true);
    try {
      const [us, deps] = await Promise.all([
        api.get<ManagedUser[]>("/users"),
        api.get<Department[]>("/departments"),
      ]);
      setUsers(us);
      setDepartments(deps);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Kullanıcılar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const depById = useMemo(() => {
    const m: Record<number, Department> = {};
    for (const d of departments) m[d.id] = d;
    return m;
  }, [departments]);

  const depOptions = useMemo(
    () => departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` })),
    [departments],
  );

  // Filtre İSTEMCİDE: kontrat §2'de GET /users için parametre yok ve bir
  // workgroup'un kullanıcı sayısı zaten tek istekte rahat taşınıyor. Sunucuya
  // taşımak kontratı bu ekran için genişletmek olurdu.
  const gorunen = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return users.filter((u) => {
      if (statusFilter !== ALL && u.status !== statusFilter) return false;
      if (!q) return true;
      return u.name.toLocaleLowerCase("tr").includes(q)
        || u.email.toLocaleLowerCase("tr").includes(q);
    });
  }, [users, search, statusFilter]);

  const bekleyenSayisi = useMemo(
    () => users.filter((u) => u.status === "PENDING").length,
    [users],
  );

  // Sayfa numarası state'te tutuluyor ama KULLANILMADAN ÖNCE sınırlanıyor.
  // Aksi halde son sayfadayken bir davet silmek ya da filtre daraltmak
  // kullanıcıyı var olmayan bir sayfada, boş tabloya bakar halde bırakırdı.
  // Türetilmiş değer kullanmak bunu bir effect'e gerek kalmadan kendiliğinden
  // düzeltir — ekranda boş tablo anı hiç oluşmaz.
  const toplamSayfa = Math.max(1, Math.ceil(gorunen.length / PAGE_SIZE));
  const gecerliSayfa = Math.min(page, toplamSayfa);
  const sayfadakiler = gorunen.slice(
    (gecerliSayfa - 1) * PAGE_SIZE,
    gecerliSayfa * PAGE_SIZE,
  );

  function openInvite() {
    setEditing(null);
    form.setValues(BOS_FORM);
    setFormModal(true);
  }

  function openEdit(u: ManagedUser) {
    setEditing(u);
    form.setValues({
      name: u.name,
      email: u.email,
      role: u.role,
      department_ids: u.department_ids.map(String),
      caps: {
        can_manage_courses: u.can_manage_courses,
        can_manage_weekly: u.can_manage_weekly,
        can_manage_exams: u.can_manage_exams,
        can_manage_classrooms: u.can_manage_classrooms,
        can_manage_lecturers: u.can_manage_lecturers,
      },
    });
    setFormModal(true);
  }

  async function submit(v: FormValues) {
    setBusy(true);
    // ADMIN'de bayraklar gönderilmez: sunucu zaten yok sayıp false yazıyor
    // (K-25). Göndermek, istemcinin sunucuyla çelişen bir gerçek iddia
    // etmesi olurdu.
    const caps = v.role === "ADMIN"
      ? {}
      : Object.fromEntries(CAPABILITIES.map((c) => [c.key, v.caps[c.key]]));
    const ortak = {
      name: v.name.trim(),
      role: v.role,
      department_ids: v.department_ids.map(Number),
      ...caps,
    };
    try {
      if (editing) {
        // E-posta GÖNDERİLMEZ — kimliktir, kontrat §2 kabul etmiyor (K-34).
        await api.patch<ManagedUser>(`/users/${editing.id}`, ortak);
        notifications.show({ color: "green", message: "Kullanıcı güncellendi" });
      } else {
        await api.post("/users/invite", { ...ortak, email: v.email.trim() });
        notifications.show({
          color: "green",
          message: "Davet gönderildi — kullanıcı bağlantıdan hesabını tamamlayacak",
        });
      }
      setFormModal(false);
      await load();
    } catch (e) {
      const mesaj = e instanceof ApiError ? e.message : "İşlem başarısız";
      if (e instanceof ApiError && e.status === 409) form.setFieldError("email", mesaj);
      else notifications.show({ color: "red", message: mesaj, autoClose: 7000 });
    } finally {
      setBusy(false);
    }
  }

  async function resend(u: ManagedUser) {
    setBusy(true);
    try {
      await api.post(`/users/${u.id}/resend-invitation`, {});
      notifications.show({ color: "green", message: `Davet yeniden gönderildi: ${u.email}` });
    } catch (e) {
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : "Gönderilemedi",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/users/${deleting.id}`);
      notifications.show({ color: "green", message: "Davet iptal edildi" });
      setDeleting(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 8000,
      });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAccess(u: ManagedUser, yeni: UserStatus) {
    setBusy(true);
    try {
      await api.patch(`/users/${u.id}`, { status: yeni });
      notifications.show({
        color: "green",
        message: yeni === "DISABLED" ? "Erişim kapatıldı" : "Erişim yeniden açıldı",
      });
      setDisabling(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
      setDisabling(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading && users.length === 0) return <Loader mt="md" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" align="baseline" mt="xl" mb="sm">
        <Group gap="xs" align="baseline">
          <Title order={4}>Kullanıcılar</Title>
          {/* Bekleyen davet sayısı başlıkta: admin'in takip etmesi gereken
              tek "yapılacak iş" bu — kimler daveti henüz tamamlamadı. */}
          {bekleyenSayisi > 0 && (
            <Badge variant="light" color="yellow" size="sm">
              {bekleyenSayisi} davet bekliyor
            </Badge>
          )}
        </Group>
        <Button size="xs" onClick={openInvite}>+ Kullanıcı Davet Et</Button>
      </Group>

      <Group mb="sm">
        {/* Filtre değişince ilk sayfaya dön: arama sonucu 3 kişiye düşerken
            5. sayfada kalmak kullanıcıyı "sonuç yok" sanısına düşürürdü. */}
        <TextInput
          placeholder="Ad veya e-posta ara"
          value={search}
          onChange={(e) => { setSearch(e.currentTarget.value); setPage(1); }}
          w={240}
        />
        <Select
          data={[
            { value: ALL, label: "Tüm durumlar" },
            ...(Object.keys(STATUS_META) as UserStatus[]).map((s) => ({
              value: s, label: STATUS_META[s].label,
            })),
          ]}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v ?? ALL); setPage(1); }}
          allowDeselect={false}
          w={180}
        />
      </Group>

      <Paper withBorder radius="md">
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ad</Table.Th>
              <Table.Th>E-posta</Table.Th>
              <Table.Th w={110}>Rol</Table.Th>
              <Table.Th w={130}>Durum</Table.Th>
              <Table.Th>Bölümler</Table.Th>
              <Table.Th>Yetkiler</Table.Th>
              <Table.Th w={110} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sayfadakiler.map((u) => {
              const kendisi = u.id === me?.id;
              const bekleyen = u.status === "PENDING";
              const durum = STATUS_META[u.status];
              return (
                <Table.Tr key={u.id} opacity={u.status === "DISABLED" ? 0.6 : 1}>
                  <Table.Td>
                    <Text size="sm">
                      {u.name}
                      {kendisi && <Text span size="xs" c="dimmed"> (siz)</Text>}
                    </Text>
                  </Table.Td>
                  <Table.Td><Text size="sm" c="dimmed">{u.email}</Text></Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={u.role === "ADMIN" ? "blue" : "gray"} size="sm">
                      {u.role === "ADMIN" ? "Admin" : "Alt hesap"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={durum.color} size="sm">{durum.label}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {u.department_ids.length === 0 ? (
                      <Text size="sm" c="dimmed">—</Text>
                    ) : (
                      <Group gap={4}>
                        {u.department_ids.map((id) => (
                          <Badge key={id} variant="outline" size="sm">
                            {depById[id]?.code ?? id}
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {/* ADMIN'de bayrak listelenmez: rol muafiyeti zaten hepsini
                        veriyor, beş rozet basmak gürültü olurdu (K-25). */}
                    {u.role === "ADMIN" ? (
                      <Text size="sm" c="dimmed">tümü (rol gereği)</Text>
                    ) : (
                      <Group gap={4}>
                        {CAPABILITIES.filter((c) => u[c.key]).map((c) => (
                          <Badge key={c.key} variant="light" color="teal" size="sm">
                            {c.label}
                          </Badge>
                        ))}
                        {CAPABILITIES.every((c) => !u[c.key]) && (
                          <Text size="sm" c="dimmed">salt okuma</Text>
                        )}
                      </Group>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap" justify="flex-end">
                      {bekleyen && (
                        <Tooltip label="Daveti yeniden gönder">
                          <ActionIcon variant="subtle" size="sm" onClick={() => resend(u)}>
                            <IconMail size={15} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Düzenle">
                        <ActionIcon variant="subtle" size="sm" onClick={() => openEdit(u)}>
                          <IconPencil size={15} />
                        </ActionIcon>
                      </Tooltip>

                      {/* Eylem duruma göre değişir (K-34): bekleyen davet
                          SİLİNİR, kullanılmış hesap KAPATILIR. Kendi hesabında
                          ikisi de yok — sunucu da reddediyor, düğmeyi
                          göstermek kullanıcıyı boşuna hataya sürüklerdi. */}
                      {!kendisi && (bekleyen ? (
                        <Tooltip label="Daveti iptal et">
                          <ActionIcon variant="subtle" size="sm" color="red"
                                      onClick={() => setDeleting(u)}>
                            <IconTrash size={15} />
                          </ActionIcon>
                        </Tooltip>
                      ) : u.status === "ACTIVE" ? (
                        <Button size="compact-xs" variant="subtle" color="red"
                                onClick={() => setDisabling(u)}>
                          Kapat
                        </Button>
                      ) : (
                        <Button size="compact-xs" variant="subtle"
                                onClick={() => toggleAccess(u, "ACTIVE")}>
                          Aç
                        </Button>
                      ))}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        {gorunen.length === 0 && (
          <Text c="dimmed" size="sm" p="md">Filtreye uyan kullanıcı yok.</Text>
        )}
      </Paper>

      {/* Sayfalama yalnız gerektiğinde: tek sayfalık listede numara çubuğu
          göstermek boş yer kaplar. Sayaç metni her zaman görünür ki toplamın
          kaçta kaçına bakıldığı belli olsun. */}
      {gorunen.length > 0 && (
        <Group justify="space-between" mt="sm">
          <Text size="sm" c="dimmed">
            {gorunen.length} kullanıcıdan{" "}
            {(gecerliSayfa - 1) * PAGE_SIZE + 1}–
            {Math.min(gecerliSayfa * PAGE_SIZE, gorunen.length)} arası
          </Text>
          {toplamSayfa > 1 && (
            <Pagination
              total={toplamSayfa}
              value={gecerliSayfa}
              onChange={setPage}
              size="sm"
            />
          )}
        </Group>
      )}

      {/* --- davet / düzenleme formu --- */}
      <Modal
        opened={formModal}
        onClose={() => setFormModal(false)}
        title={editing ? `Düzenle: ${editing.name}` : "Kullanıcı Davet Et"}
      >
        <form onSubmit={form.onSubmit(submit)}>
          <Stack>
            <TextInput label="Ad Soyad" {...form.getInputProps("name")} />
            <TextInput
              label="E-posta"
              placeholder="ad.soyad@muh.example.edu.tr"
              disabled={!!editing}
              description={editing
                ? "Kimliktir, değiştirilemez — yanlışsa daveti iptal edip yeniden gönderin (K-34)"
                : "Üniversite domaini doğrulanır"}
              {...form.getInputProps("email")}
            />
            <Select
              label="Rol"
              data={[
                { value: "SUB_ACCOUNT", label: "Alt hesap" },
                { value: "ADMIN", label: "Admin" },
              ]}
              allowDeselect={false}
              disabled={editing?.id === me?.id}
              description={editing?.id === me?.id
                ? "Kendi rolünüzü değiştiremezsiniz — bunu başka bir admin yapmalı"
                : undefined}
              value={form.values.role}
              onChange={(v) => form.setFieldValue("role", (v ?? "SUB_ACCOUNT") as Role)}
            />
            <MultiSelect
              label="Bölümler"
              placeholder={form.values.department_ids.length ? undefined : "Seçin"}
              data={depOptions}
              searchable
              description="Yazma yetkisi bu bölümlerle sınırlıdır; okuma tüm workgroup'ta serbest (K-26)"
              {...form.getInputProps("department_ids")}
            />

            {form.values.role === "ADMIN" ? (
              <Alert color="blue" variant="light">
                Admin tüm yetkilere rolü gereği sahiptir; ayrıca seçim yapılmaz (K-25).
              </Alert>
            ) : (
              <Stack gap={6}>
                <Text size="sm" fw={500}>Yetkiler</Text>
                {CAPABILITIES.map((c) => (
                  <Checkbox
                    key={c.key}
                    label={c.label}
                    checked={form.values.caps[c.key]}
                    onChange={(e) =>
                      form.setFieldValue(`caps.${c.key}`, e.currentTarget.checked)}
                  />
                ))}
              </Stack>
            )}

            <Button type="submit" loading={busy} mt="sm">
              {editing ? "Kaydet" : "Daveti Gönder"}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* --- davet iptali --- */}
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Daveti iptal et">
        <Text>
          <b>{deleting?.name}</b> ({deleting?.email}) için gönderilen davet silinecek.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Davet bağlantısı çalışmaz hale gelir. Kişi henüz giriş yapmadığı için
          geriye hiçbir kaydı kalmaz.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button color="red" loading={busy} onClick={confirmDelete}>Daveti Sil</Button>
        </Group>
      </Modal>

      {/* --- erişim kapatma --- */}
      <Modal opened={disabling !== null} onClose={() => setDisabling(null)} title="Erişimi kapat">
        <Text><b>{disabling?.name}</b> sisteme giremeyecek.</Text>
        <Text c="dimmed" size="sm" mt="xs">
          Etki anında: açık oturumu varsa ilk isteğinde düşer. Hesap silinmez —
          işlem kayıtlarındaki izi korunur, istendiğinde yeniden açılabilir.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDisabling(null)}>Vazgeç</Button>
          <Button color="red" loading={busy}
                  onClick={() => disabling && toggleAccess(disabling, "DISABLED")}>
            Erişimi Kapat
          </Button>
        </Group>
      </Modal>
    </>
  );
}
