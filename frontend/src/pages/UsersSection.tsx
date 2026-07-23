import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, MultiSelect,
  Pagination, Paper, Select, Stack, Table, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconMail, IconPencil, IconTrash, IconUserCheck, IconUserOff,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CAPABILITIES } from "../api/types";
import type { CapabilityKey, Department, ManagedUser, Role, UserStatus } from "../api/types";

const ALL = "__all__";

/** Sayfa başına kullanıcı satırı. Dashboard tek sayfada dört blok taşıyor;
 *  kullanıcı tablosu diğerlerini aşağı itmemeli. */
const PAGE_SIZE = 10;

const STATUS_META: Record<UserStatus, { label: string; color: string }> = {
  PENDING: { label: "Davetli", color: "yellow" },
  ACTIVE: { label: "Aktif", color: "green" },
  DISABLED: { label: "Pasif", color: "gray" },
};

/** Liste sırası: önce çalışanlar, sonra bekleyenler, en altta pasifler.
 *  Admin'in ilgilendiği satırlar üstte kalsın; pasif hesap arşiv niteliğinde. */
const STATUS_ORDER: Record<UserStatus, number> = {
  ACTIVE: 0,
  PENDING: 1,
  DISABLED: 2,
};

/** Sütun genişlikleri sabit (Table layout="fixed" ile birlikte).
 *  Aksi halde her sayfada içeriğe göre yeniden hesaplanır ve sayfa
 *  değiştirdikçe sütunlar kayar. */
const COL = {
  ad: 180,
  eposta: 250,
  rol: 110,
  durum: 90,
  bolumler: 150,
  eylem: 100,
} as const;

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
  const [roleFilter, setRoleFilter] = useState<string>(ALL);
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
    return users
      .filter((u) => {
        if (statusFilter !== ALL && u.status !== statusFilter) return false;
        if (roleFilter !== ALL && u.role !== roleFilter) return false;
        if (!q) return true;
        return u.name.toLocaleLowerCase("tr").includes(q)
          || u.email.toLocaleLowerCase("tr").includes(q);
      })
      // Durum grubu içinde ada göre: sıra sayfadan sayfaya sabit kalsın,
      // sunucunun döndürdüğü rastgele sıraya bağlı olmasın.
      .sort((a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || a.name.localeCompare(b.name, "tr"));
  }, [users, search, statusFilter, roleFilter]);

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
        <Title order={4}>Kullanıcılar</Title>
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
            { value: ALL, label: "Tüm roller" },
            { value: "ADMIN", label: "Admin" },
            { value: "SUB_ACCOUNT", label: "Alt hesap" },
          ]}
          value={roleFilter}
          onChange={(v) => { setRoleFilter(v ?? ALL); setPage(1); }}
          allowDeselect={false}
          w={160}
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
          w={160}
        />
      </Group>

      <Paper withBorder radius="md">
        {/* layout="fixed": sütun genişlikleri içeriğe göre DEĞİL, aşağıdaki
            sabit değerlere göre belirlenir. Otomatik yerleşimde her sayfanın
            içeriği farklı olduğu için sütunlar sayfa değiştikçe kayıyordu.
            Yetkiler sütunu genişlik almaz — kalan yeri o doldurur. */}
        <Table verticalSpacing="xs" highlightOnHover layout="fixed">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={COL.ad}>Ad</Table.Th>
              <Table.Th w={COL.eposta}>E-posta</Table.Th>
              <Table.Th w={COL.rol}>Rol</Table.Th>
              <Table.Th w={COL.durum}>Durum</Table.Th>
              <Table.Th w={COL.bolumler}>Bölümler</Table.Th>
              <Table.Th>Yetkiler</Table.Th>
              <Table.Th w={COL.eylem} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sayfadakiler.map((u) => {
              const kendisi = u.id === me?.id;
              const bekleyen = u.status === "PENDING";
              const durum = STATUS_META[u.status];
              return (
                <Table.Tr key={u.id} opacity={u.status === "DISABLED" ? 0.6 : 1}>
                  {/* truncate: sabit genişlikte uzun ad/e-posta sütunu
                      taşırmasın, "..." ile kesilsin. */}
                  <Table.Td>
                    <Text size="sm" truncate>
                      {u.name}
                      {kendisi && <Text span size="xs" c="dimmed"> (siz)</Text>}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" truncate title={u.email}>{u.email}</Text>
                  </Table.Td>
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
                          <Text size="sm" c="dimmed">sadece okuma</Text>
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
                        <Tooltip label="Erişimi kapat">
                          <ActionIcon variant="subtle" size="sm" color="red"
                                      onClick={() => setDisabling(u)}>
                            <IconUserOff size={15} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Erişimi aç">
                          <ActionIcon variant="subtle" size="sm" color="green"
                                      onClick={() => toggleAccess(u, "ACTIVE")}>
                            <IconUserCheck size={15} />
                          </ActionIcon>
                        </Tooltip>
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
          boş yer kaplar. Toplam sayı özet kartlarında zaten duruyor. */}
      {toplamSayfa > 1 && (
        <Group justify="flex-end" mt="sm">
          <Pagination
            total={toplamSayfa}
            value={gecerliSayfa}
            onChange={setPage}
            size="sm"
          />
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
            {/* Düzenlemede kilitli: e-posta kimliktir, davet token'ı ona bağlı
                (K-34). Yanlışsa daveti iptal edip yeniden göndermek gerekir. */}
            <TextInput
              label="E-posta"
              placeholder="ad.soyad@muh.example.edu.tr"
              disabled={!!editing}
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
            {/* Bölüm ataması YAZMA kapsamıdır; okuma zaten tüm workgroup'ta
                serbest (K-26). */}
            <MultiSelect
              label="Bölümler"
              placeholder={form.values.department_ids.length ? undefined : "Seçin"}
              data={depOptions}
              searchable
              {...form.getInputProps("department_ids")}
            />

            {/* ADMIN'de yetki seçimi hiç gösterilmez: rol muafiyeti zaten
                hepsini veriyor, sunucu da gönderileni yok sayıyor (K-25). */}
            {form.values.role !== "ADMIN" && (
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
