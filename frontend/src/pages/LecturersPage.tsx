import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Divider, Group, Loader,
  Modal, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title,
  Tooltip, UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown, IconChevronUp, IconCircleCheck, IconCircleOff,
  IconCloudDownload, IconEye, IconEyeOff, IconPencil,
  IconSelector, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import {
  lecturerLabel,
  type Course, type Department, type ImportCommit, type ImportPreview,
  type Lecturer,
} from "../api/types";

type SortKey = "name" | "departments" | "courses";

/** "Filtre yok" durumunun açılır listedeki karşılığı.
 *  Sadece `clearable` yetmiyor: kullanıcı listeyi açıp "hepsi"ni arıyor,
 *  input içindeki küçük × fark edilmiyor. Geri dönüş yolu listede görünmeli.
 */
const ALL_DEPARTMENTS = "__all__";
type LecturerStats = { courseIds: Set<number> };

// Seçilebilir akademik unvanlar (K-52). Backend'in kanonik unvan kümesiyle eş
// tutulur (bkz. app/normalize.py CANONICAL_TITLES); web import site formunu
// ("Doktor Öğretim Üyesi") bu kısa formlara indirir. Artık `title` ayrı bir
// alan olduğu için birleştirme/ayrıştırma YOK — Select doğrudan title'a yazar.
const TITLES = [
  "Prof. Dr.", "Prof.", "Doç. Dr.", "Doç.", "Dr. Öğr. Üyesi",
  "Öğr. Gör. Dr.", "Öğr. Gör.", "Arş. Gör. Dr.", "Arş. Gör.", "Uzman", "Dr.",
];

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
  const navigate = useNavigate();
  // Workgroup geneli paylaşımlı kaynak: bölüm boyutu YOK (K-25).
  const canWrite = canWriteIn(user, "can_manage_lecturers");

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Bölüm süzgeci Bölümler genel-bakışından ?department_id= ile önceden gelebilir;
  // parametreyi bir kez okuyup URL'den temizliyoruz (yenilemede yapışmasın).
  const [searchParams, setSearchParams] = useSearchParams();
  const [deptFilter, setDeptFilter] = useState<string | null>(
    searchParams.get("department_id"),
  );

  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Lecturer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<Lecturer | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Fakülte web import (K-50): önizle → seç → onayla.
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);   // önizleme çekiliyor
  const [importError, setImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Onaylanacak satırlar; anahtar detail_url (kişi başına benzersiz).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);

  // K-52: title (unvan) ve email AYRI alanlar — full_name'e gömülmez.
  // department_id: bölüm. Dış görevli (40/a) HARİÇ zorunlu. email opsiyonel.
  const form = useForm({
    initialValues: {
      title: "", full_name: "", email: "", is_external: false,
      department_id: "" as string,
    },
    validate: {
      full_name: (v) => (v.trim() ? null : "Ad soyad boş olamaz"),
      department_id: (v, values) => (values.is_external || v ? null : "Bölüm seçin"),
      // E-posta opsiyonel; yalnız girildiyse basit biçim denetimi.
      email: (v) => (!v.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
        ? null : "Geçerli bir e-posta girin"),
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

  // Deep-link parametrelerini bir kez tüket. ?add=1 → ekleme formunu açık getir
  // (asli bölüm önceden seçili gelir).
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

  const deptCodeById = useMemo(() => {
    const m: Record<number, string> = {};
    for (const d of departments) m[d.id] = d.code;
    return m;
  }, [departments]);

  // Hoca başına: verdiği DERS'ler ve bölümler.
  // Set kullanılıyor çünkü bir hoca aynı dersin iki şubesine giriyorsa
  // bu TEK ders sayılmalı (kullanıcı şartı).
  const statsByLecturer = useMemo(() => {
    const acc: Record<number, LecturerStats> = {};
    for (const c of courses) {
      for (const s of c.sections) {
        const e = (acc[s.lecturer.id] ??= { courseIds: new Set() });
        e.courseIds.add(c.id);
      }
    }
    return acc;
  }, [courses]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      // Sayısal sütun (ders) ilk tık ÇOKTAN AZA; metin sütunları alfabetik.
      setSortDir(key === "courses" ? "desc" : "asc");
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const depId = deptFilter ? Number(deptFilter) : null;
    const dir = sortDir === "asc" ? 1 : -1;
    return lecturers
      // K-52: unvan+ad birlikte aransın ("Doç" ya da "Ayşe" ikisi de bulsun).
      .filter((l) => !q || lecturerLabel(l).toLocaleLowerCase("tr").includes(q))
      // Bölüm filtresi: yalnız o bölümde KADROLU/GÖREVLİ olan (asli bölümü =
      // department_id) hocalar. Import'ta department_id, Görev Birimi'nden (yoksa
      // Kadro'dan) eşlenir → "o bölümde ders veren herkes" değil, o bölüme ait
      // olanlar gelir. Ders verdiği (türetilmiş) bölümler artık süzmeye girmez.
      .filter((l) => depId === null || l.department_id === depId)
      .sort((a, b) => {
        // Unvansız ada göre: full_name'e göre sıralamak "Doç. < Öğr. < Prof."
        // üretirdi — kişi adı değil unvan sıralanırdı (K-28).
        if (sortBy === "name") {
          return dir * a.normalized_name.localeCompare(b.normalized_name, "tr");
        }
        // Bölüm sütunu artık ana bölüm koduna göre; bölümsüz kayıt en sona.
        if (sortBy === "departments") {
          const ca = a.department_id != null ? (deptCodeById[a.department_id] ?? "") : "";
          const cb = b.department_id != null ? (deptCodeById[b.department_id] ?? "") : "";
          if (!ca !== !cb) return !ca ? 1 : -1;
          if (ca !== cb) return dir * ca.localeCompare(cb, "tr");
          return a.normalized_name.localeCompare(b.normalized_name, "tr");
        }
        const va = statsByLecturer[a.id]?.courseIds.size ?? 0;
        const vb = statsByLecturer[b.id]?.courseIds.size ?? 0;
        if (va !== vb) return dir * (va - vb);
        return a.normalized_name.localeCompare(b.normalized_name, "tr");   // eşitlikte ada göre
      });
  }, [lecturers, query, deptFilter, sortBy, sortDir, statsByLecturer, deptCodeById]);

  // departmentId verilirse (Bölümler → "Öğretim Üyesi Ekle") asli bölüm önceden
  // seçili gelir.
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
    // K-52: title/email artık ayrı alan — ayrıştırmaya gerek yok.
    form.setValues({
      title: lec.title ?? "",
      full_name: lec.full_name,
      email: lec.email ?? "",
      is_external: lec.is_external,
      department_id: lec.department_id != null ? String(lec.department_id) : "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(values: typeof form.values) {
    setSubmitting(true);
    // K-52: unvan ve e-posta AYRI alanlar — ad'a gömülmez.
    const payload = {
      full_name: values.full_name.trim(),
      title: values.title || null,
      email: values.email.trim() || null,
      is_external: values.is_external,
      // Select değeri string; API int|null bekler. Boş = bölümsüz (dış görevli).
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

  // "Siteden İçe Aktar" → fakülte sayfasını tara, sistemde OLMAYANLARI getir.
  // Yazma yapmaz; kullanıcı modalda görüp onaylayınca commit edilir.
  async function runImportPreview() {
    setImportOpen(true);
    setImportLoading(true);
    setImportError(null);
    setPreview(null);
    try {
      const data = await api.post<ImportPreview>("/lecturers/import/preview");
      setPreview(data);
      // Varsayılan: bulunan yeni kişilerin hepsi seçili gelir.
      setSelected(new Set(data.new.map((r) => r.detail_url)));
    } catch (e) {
      // Site çekilemedi / yapısı değişti (502) → görünür hata, sessiz "0 yeni" değil.
      setImportError(e instanceof ApiError ? e.message : "İçe aktarma başarısız");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleImportCommit() {
    if (!preview) return;
    const rows = preview.new.filter((r) => selected.has(r.detail_url));
    if (rows.length === 0) return;
    setCommitting(true);
    try {
      const res = await api.post<ImportCommit>("/lecturers/import/commit", { rows });
      const parts = [`${res.created.length} öğretim üyesi eklendi`];
      if (res.skipped.length) parts.push(`${res.skipped.length} atlandı (zaten kayıtlı)`);
      notifications.show({ color: "green", message: parts.join(" · ") });
      setImportOpen(false);
      await load();
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İçe aktarma başarısız",
      });
    } finally {
      setCommitting(false);
    }
  }

  function toggleRow(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  if (loading) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Öğretim Üyeleri</Title>
        {canWrite && (
          <Group gap="sm">
            <Tooltip label="Fakülte akademik personel sayfasından yeni öğretim üyelerini getir">
              <Button
                variant="light"
                leftSection={<IconCloudDownload size={18} />}
                onClick={runImportPreview}
              >
                Siteden İçe Aktar
              </Button>
            </Tooltip>
            <Button onClick={() => openAdd()}>+ Öğretim Üyesi Ekle</Button>
          </Group>
        )}
      </Group>

      <Group mb="md" align="flex-end">
        <TextInput
          placeholder="Ara"
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
                <Table.Th w={110}>Ünvan</Table.Th>
                <SortableTh
                  label="Ad Soyad"
                  active={sortBy === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
                <SortableTh
                  label="Birim (Görev / Kadro)"
                  active={sortBy === "departments"}
                  dir={sortDir}
                  onClick={() => toggleSort("departments")}
                />
                <Table.Th>E-posta</Table.Th>
                <SortableTh
                  label="Ders"
                  active={sortBy === "courses"}
                  dir={sortDir}
                  onClick={() => toggleSort("courses")}
                />
                {canWrite && <Table.Th w={150}>İşlemler</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map((lec) => {
                const st = statsByLecturer[lec.id];
                // Yalnız ana (asli) bölüm gösterilir.
                const homeCode = lec.department_id != null
                  ? (deptCodeById[lec.department_id] ?? "?") : null;
                const courseCount = st?.courseIds.size ?? 0;
                return (
                  <Table.Tr
                    key={lec.id}
                    opacity={lec.active ? 1 : 0.55}
                    style={{ cursor: "pointer" }}
                    // Satıra tıklama → hocanın haftalık programı (herkes için).
                    onClick={() => navigate(`/weekly?view=lecturer&lecturer_id=${lec.id}`)}
                  >
                    <Table.Td>
                      {lec.title
                        ? <Text size="sm" c="dimmed">{lec.title}</Text>
                        : <Text size="sm" c="dimmed">—</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm">{lec.full_name}</Text>
                        {lec.is_external && (
                          <Tooltip label="Dış görevli (40/a)">
                            <Badge variant="light" color="orange" size="xs">40/a</Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {lec.duty_unit || lec.cadre_unit ? (
                        <Stack gap={2}>
                          {lec.duty_unit && (
                            <Text size="xs">
                              <Text span c="dimmed">Görev: </Text>{lec.duty_unit}
                            </Text>
                          )}
                          {lec.cadre_unit && lec.cadre_unit !== lec.duty_unit && (
                            <Text size="xs">
                              <Text span c="dimmed">Kadro: </Text>{lec.cadre_unit}
                            </Text>
                          )}
                        </Stack>
                      ) : homeCode ? (
                        <Badge variant="light" color="blue" size="sm">{homeCode}</Badge>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {lec.email
                        ? <Anchor href={`mailto:${lec.email}`} size="xs">{lec.email}</Anchor>
                        : <Text c="dimmed" size="sm">—</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Text c={courseCount ? undefined : "dimmed"}>{courseCount}</Text>
                    </Table.Td>
                    {canWrite && (
                      // Butonlar satır tıklamasını tetiklemesin (haftalığa atmasın).
                      <Table.Td onClick={(e) => e.stopPropagation()}>
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
            <Select
              label="Ünvan"
              placeholder="Seçin (opsiyonel)"
              data={TITLES}
              clearable
              {...form.getInputProps("title")}
            />
            <TextInput
              label="Ad Soyad"
              placeholder="Ayşe Kaya"
              {...form.getInputProps("full_name")}
            />
            <TextInput
              label="E-posta"
              placeholder="ayse.kaya@mu.edu.tr (opsiyonel)"
              {...form.getInputProps("email")}
            />
            <Select
              label="Bölüm"
              placeholder="Bölüm seçin"
              data={departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))}
              searchable
              clearable
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
                    checked={selected.size === preview.new.length}
                    indeterminate={selected.size > 0 && selected.size < preview.new.length}
                    onChange={(e) =>
                      setSelected(
                        e.currentTarget.checked
                          ? new Set(preview.new.map((r) => r.detail_url))
                          : new Set(),
                      )
                    }
                  />
                  <Text size="sm" c="dimmed">{selected.size} seçili</Text>
                </Group>

                <ScrollArea.Autosize mah={420}>
                  <Table stickyHeader verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={36} />
                        <Table.Th>Ünvan</Table.Th>
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
                              checked={selected.has(row.detail_url)}
                              onChange={() => toggleRow(row.detail_url)}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">{row.title ?? "—"}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Anchor href={row.detail_url} target="_blank" size="sm">
                              {row.full_name}
                            </Anchor>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{row.duty_unit ?? "—"}</Text>
                            {row.cadre_unit && row.cadre_unit !== row.duty_unit && (
                              <Text size="xs" c="dimmed">Kadro: {row.cadre_unit}</Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c={row.email ? undefined : "dimmed"}>
                              {row.email ?? "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {row.department_label ? (
                              <Badge variant="light" color="blue" size="sm">
                                {row.department_label}
                              </Badge>
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
                  <Button variant="default" onClick={() => setImportOpen(false)}>
                    Vazgeç
                  </Button>
                  <Button
                    loading={committing}
                    disabled={selected.size === 0}
                    onClick={handleImportCommit}
                  >
                    {selected.size} kişiyi ekle
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
