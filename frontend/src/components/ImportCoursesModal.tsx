import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Collapse, Group, Modal,
  NumberInput, ScrollArea, Select, Stack, Switch, Table, Text, TextInput,
} from "@mantine/core";
import {
  IconCircleCheck, IconDownload, IconPencil, IconArrowLeft,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { api, ApiError } from "../api/client";
import { SEMESTER_LABELS } from "../api/types";
import type { Department, SemesterType } from "../api/types";

/** Bir dersin import edilebilir alanlari — parse ciktisi = commit girisi. */
type CourseFields = {
  code: string;
  name: string;
  year: number;
  semester: SemesterType;
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
  ects: number | null;                  // K-55: AKTS (Bologna'dan; opsiyonel)
  is_elective: boolean;
  is_common: boolean;                   // K-48: ortak (servis) ders mi
};

type PreviewCourse = CourseFields & { exists: boolean };

type ImportResult = {
  total_parsed: number;
  added_count: number;
  merged_count: number;                 // K-54: mevcut ortak derse cohort eklendi
  skipped_count: number;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  departments: Department[];          // yalnız yazılabilir bölümler (can_manage_courses)
  defaultDepartmentId: string | null; // Dersler sayfasındaki bölüm filtresinden ön-seçim
  onImported: () => void;             // başarıda listeyi yenile
};

const SEMESTER_OPTIONS = (["FALL", "SPRING", "SUMMER"] as SemesterType[]).map(
  (s) => ({ value: s, label: SEMESTER_LABELS[s] }),
);

/** Ad karşılaştırma anahtarı: DEĞİŞMEZ küçük harf + tek boşluk. Türkçe locale
 *  KULLANILMAZ: "I"→"ı" / "i"→"i" ayrımı İngilizce adları bozardı ("PRINCIPLES"
 *  ile "Principles" farklı anahtara düşerdi). Amaç yalnız büyük/küçük harf
 *  duyarsız eşleştirme (aynı dersin Türkçe/İngilizce kayıtları aynı ada düşsün). */
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Aynı ada sahip (kodu farklı) dersleri bul: bu ada sahip >1 ders varsa. */
function duplicateNameSet(list: { name: string }[]): Set<string> {
  const count = new Map<string, number>();
  for (const c of list) {
    const k = normName(c.name);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
}

/** Bologna bilgi paketinden bir bölümün derslerini içe aktarma modalı.
 *  İki adım: (1) önizleme — çek ve listele, (2) seç/düzenle → seçilenleri ekle.
 *  Zaten kayıtlı dersler işaretli gelir ve seçilemez (sunucu da atlar). */
export default function ImportCoursesModal({
  opened, onClose, departments, defaultDepartmentId, onImported,
}: Props) {
  const [depId, setDepId] = useState<string | null>(defaultDepartmentId);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // Faz: giriş → inceleme (parsed dolu) → sonuç (result dolu).
  const [rows, setRows] = useState<PreviewCourse[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Modal her açılışta baştan başlasın.
  useEffect(() => {
    if (opened) {
      setDepId(defaultDepartmentId);
      setUrl("");
      setBusy(false);
      setRows(null);
      setSelected(new Set());
      setEditing(null);
      setResult(null);
    }
  }, [opened, defaultDepartmentId]);

  // Aynı adlı dersleri (kodu farklı) ana listeden AYIR: en altta özel bir
  // bölümde, dikkat notu ile ve varsayılan seçilmemiş listelenirler — hangisini
  // (Türkçe/İngilizce sürüm / kategori kaydı) aktaracağına kullanıcı karar verir.
  const { mainIdx, dupIdx } = useMemo(() => {
    const list = rows ?? [];
    const dup = duplicateNameSet(list);
    const main: number[] = [];
    const dupI: number[] = [];
    list.forEach((c, i) => (dup.has(normName(c.name)) ? dupI : main).push(i));
    // Aynı adlılar yan yana gelsin diye ada göre sırala.
    dupI.sort((a, b) => normName(list[a].name).localeCompare(normName(list[b].name), "tr"));
    return { mainIdx: main, dupIdx: dupI };
  }, [rows]);

  // "Tümünü seç" yalnız ANA listedeki (benzersiz adlı) yeni dersleri kapsar;
  // aynı adlılar bilinçli seçilsin diye dışarıda. Sayaç tüm yeni dersleri sayar.
  const selectableIdx = useMemo(
    () => mainIdx.filter((i) => !(rows ?? [])[i].exists),
    [mainIdx, rows],
  );
  const newCount = (rows ?? []).filter((c) => !c.exists).length;
  const allSelected = selectableIdx.length > 0 && selectableIdx.every((i) => selected.has(i));
  const someSelected = selectableIdx.some((i) => selected.has(i));

  // --- Faz 1: önizleme (yazma yok) ---
  const fetchPreview = async () => {
    if (!depId || !url.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ courses: PreviewCourse[] }>(
        "/import/courses/preview",
        { department_id: Number(depId), url: url.trim() },
      );
      setRows(res.courses);
      // Varsayılan: kayıtlı olmayan + BENZERSİZ adlı dersler seçili gelsin.
      // Aynı adlılar (kod farkı) seçilmeden gelir — kullanıcı bilinçle seçsin.
      const dup = duplicateNameSet(res.courses);
      setSelected(new Set(
        res.courses
          .map((c, i) => (c.exists || dup.has(normName(c.name)) ? -1 : i))
          .filter((i) => i >= 0),
      ));
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "Dersler getirilemedi",
      });
    } finally {
      setBusy(false);
    }
  };

  // --- Faz 2: seçilenleri ekle ---
  const commit = async () => {
    if (!depId || !rows) return;
    const picked = rows.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const res = await api.post<ImportResult>("/import/courses", {
        department_id: Number(depId),
        courses: picked.map(({ exists: _exists, ...fields }) => fields),
      });
      setResult(res);
      onImported();
      notifications.show({
        color: "green",
        message: `${res.added_count} ders eklendi`
          + (res.merged_count ? `, ${res.merged_count} ortak derse eklendi` : "")
          + `, ${res.skipped_count} zaten vardı`,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İçe aktarma başarısız",
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectableIdx));

  const patchRow = (i: number, patch: Partial<CourseFields>) =>
    setRows((prev) => prev && prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const modalTitle = result
    ? "İçe Aktarma Tamamlandı"
    : rows
      ? "Dersleri Seç ve İçe Aktar"
      : "Bologna'dan Ders İçe Aktar";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={modalTitle}
      centered
      // Seç/düzenle adımı 8 sütunlu tablo taşır → geniş ama büyük ekranda tavanlı.
      size={rows && !result ? "min(1150px, 92vw)" : "md"}
    >
      {/* ---- Faz 3: sonuç ---- */}
      {result ? (
        <Stack>
          <Alert color="green" icon={<IconCircleCheck size={18} />}>
            <Text fw={600}>{result.added_count} yeni ders eklendi.</Text>
            <Text size="sm" c="dimmed">
              {/* K-54: mevcut ortak derse cohort olarak eklenenler (başka bölüm
                  zaten açmıştı) — çift kayıt yerine tek ders altında toplandı. */}
              {result.merged_count > 0 &&
                `${result.merged_count} ders mevcut ortak derse eklendi · `}
              {result.skipped_count} ders zaten kayıtlıydı (atlandı) · toplam{" "}
              {result.total_parsed} ders işlendi.
            </Text>
          </Alert>
          <Button onClick={onClose}>Kapat</Button>
        </Stack>
      ) : rows ? (
        /* ---- Faz 2: seç / düzenle ---- */
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {newCount} yeni ders bulundu
              {rows.length - newCount > 0 &&
                ` · ${rows.length - newCount} tanesi zaten kayıtlı`}
              {dupIdx.length > 0 && ` · ${dupIdx.length} aynı adlı (aşağıda)`}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => setRows(null)}
            >
              Geri
            </Button>
          </Group>

          <ScrollArea.Autosize mah={420}>
            <Table stickyHeader verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                      aria-label="Tümünü seç"
                    />
                  </Table.Th>
                  <Table.Th w={40} />
                  <Table.Th>Kod</Table.Th>
                  <Table.Th>Ad</Table.Th>
                  <Table.Th w={70}>Sınıf</Table.Th>
                  <Table.Th w={90}>Dönem</Table.Th>
                  <Table.Th w={80}>T+U+L</Table.Th>
                  <Table.Th w={60}>AKTS</Table.Th>
                  <Table.Th w={170}>Tür</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mainIdx.map((i) => (
                  <RowView
                    key={i}
                    c={rows[i]}
                    selected={selected.has(i)}
                    isEditing={editing === i}
                    onToggle={() => toggle(i)}
                    onEdit={() => setEditing(editing === i ? null : i)}
                    onPatch={(p) => patchRow(i, p)}
                  />
                ))}

                {/* Aynı ada sahip (kodu farklı) dersler — ayrı bölüm + dikkat notu */}
                {dupIdx.length > 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={9} bg="var(--mantine-color-default-hover)">
                      <Text size="sm" fw={600}>
                        Aynı ada sahip dersler ({dupIdx.length})
                      </Text>
                      <Text size="xs" c="dimmed">
                        Bu derslerin adı aynı ama kodları farklı — genelde aynı dersin
                        Türkçe/İngilizce kayıtları.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {dupIdx.map((i) => (
                  <RowView
                    key={i}
                    c={rows[i]}
                    selected={selected.has(i)}
                    isEditing={editing === i}
                    onToggle={() => toggle(i)}
                    onEdit={() => setEditing(editing === i ? null : i)}
                    onPatch={(p) => patchRow(i, p)}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="flex-end">
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={commit}
              loading={busy}
              disabled={selected.size === 0}
            >
              Seçilenleri Ekle ({selected.size})
            </Button>
          </Group>
        </Stack>
      ) : (
        /* ---- Faz 1: giriş ---- */
        <Stack>
          <Select
            label="Hedef bölüm"
            description="Bologna'daki bölümün dersleri bu bölüme eklenir. Karşılığı yoksa önce Bölümler'den oluşturun."
            placeholder="Bölüm seçin"
            data={departments.map((d) => ({
              value: String(d.id), label: `${d.code} — ${d.name}`,
            }))}
            value={depId}
            onChange={setDepId}
            required
          />
          <TextInput
            label="Bologna sayfası adresi"
            description="Bölümün bilgi paketi ders sayfasının URL'ini yapıştırın (…curSunit=… içermeli)."
            placeholder="https://obs.mu.edu.tr/oibs/bologna/index.aspx?...&curSunit=253"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            required
          />
          <Button
            leftSection={<IconDownload size={16} />}
            onClick={fetchPreview}
            loading={busy}
            disabled={!depId || !url.trim()}
          >
            Dersleri Getir
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

/** Tek satır — okuma görünümü + tıklayınca açılan satır-içi düzenleme paneli.
 *  Zaten kayıtlı ders soluk ve seçilemez; motor da onu sunucuda atlar. */
function RowView({
  c, selected, isEditing, onToggle, onEdit, onPatch,
}: {
  c: PreviewCourse;
  selected: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPatch: (patch: Partial<CourseFields>) => void;
}) {
  return (
    <>
      <Table.Tr opacity={c.exists ? 0.5 : 1}>
        <Table.Td>
          <Checkbox
            checked={selected}
            onChange={onToggle}
            disabled={c.exists}
            aria-label={`${c.code} seç`}
          />
        </Table.Td>
        <Table.Td>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onEdit}
            disabled={c.exists}
            aria-label={`${c.code} düzenle`}
          >
            <IconPencil size={16} />
          </ActionIcon>
        </Table.Td>
        <Table.Td>{c.code}</Table.Td>
        <Table.Td>{c.name}</Table.Td>
        <Table.Td>{c.year}. sınıf</Table.Td>
        <Table.Td>{SEMESTER_LABELS[c.semester]}</Table.Td>
        <Table.Td>{c.hours_theory}+{c.hours_practice}+{c.hours_lab}</Table.Td>
        <Table.Td>{c.ects ?? "—"}</Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            {c.exists ? (
              <Badge color="gray" variant="light">kayıtlı</Badge>
            ) : c.is_elective ? (
              <Badge color="grape" variant="light">Seçmeli</Badge>
            ) : (
              <Badge color="blue" variant="light">Zorunlu</Badge>
            )}
            {c.is_common && !c.exists && (
              <Badge color="teal" variant="light">Ortak</Badge>
            )}
          </Group>
        </Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={9} p={0} style={{ border: isEditing ? undefined : "none" }}>
          <Collapse in={isEditing}>
            <Group p="sm" align="flex-end" wrap="wrap" bg="var(--mantine-color-default-hover)">
              <TextInput
                label="Kod" size="xs" w={110}
                value={c.code}
                onChange={(e) => onPatch({ code: e.currentTarget.value })}
              />
              <TextInput
                label="Ad" size="xs" style={{ flex: 1, minWidth: 200 }}
                value={c.name}
                onChange={(e) => onPatch({ name: e.currentTarget.value })}
              />
              <NumberInput
                label="Sınıf" size="xs" w={70} min={1} max={8}
                value={c.year}
                onChange={(v) => onPatch({ year: Number(v) || 1 })}
              />
              <Select
                label="Dönem" size="xs" w={100}
                data={SEMESTER_OPTIONS}
                value={c.semester}
                onChange={(v) => v && onPatch({ semester: v as SemesterType })}
                allowDeselect={false}
              />
              <NumberInput
                label="T" size="xs" w={60} min={0}
                value={c.hours_theory}
                onChange={(v) => onPatch({ hours_theory: Number(v) || 0 })}
              />
              <NumberInput
                label="U" size="xs" w={60} min={0}
                value={c.hours_practice}
                onChange={(v) => onPatch({ hours_practice: Number(v) || 0 })}
              />
              <NumberInput
                label="L" size="xs" w={60} min={0}
                value={c.hours_lab}
                onChange={(v) => onPatch({ hours_lab: Number(v) || 0 })}
              />
              {/* K-55: AKTS düzeltilebilir; boşaltılırsa null (opsiyonel). */}
              <NumberInput
                label="AKTS" size="xs" w={70} min={0}
                value={c.ects ?? ""}
                onChange={(v) => onPatch({ ects: v === "" ? null : Number(v) })}
              />
              <Switch
                label="Seçmeli" size="sm" mb={6}
                checked={c.is_elective}
                onChange={(e) => onPatch({ is_elective: e.currentTarget.checked })}
              />
              <Switch
                label="Ortak ders" size="sm" mb={6}
                checked={c.is_common}
                onChange={(e) => onPatch({ is_common: e.currentTarget.checked })}
              />
            </Group>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}
