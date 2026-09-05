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
import { lecturerLabel } from "../api/types";
import { turkishOptionsFilter } from "../utils/selectSearch";
import type { Department, Lecturer, SemesterType } from "../api/types";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

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
  midterm_count: number | null;         // K-64: Bologna "Ara Sınav" sayısı (1-3)
  is_elective: boolean;
  is_common: boolean;                   // K-48: ortak (servis) ders mi
};

/** K-64: detaydaki "Dersi Verenler" satırı + mevcut hocayla eşleşmesi. */
type InstructorMatch = {
  raw: string;                          // ham metin ("Dr.Öğr.Üyesi ...")
  name: string;
  title: string | null;
  lecturer_id: number | null;           // eşleşen mevcut hoca; null = elle eşlenecek
};

type PreviewCourse = CourseFields & {
  exists: boolean;
  has_sections: boolean;                // K-64: mevcut ders zaten şubeli mi
  instructors: InstructorMatch[];       // K-64: Bologna'daki hoca(lar) + eşleşme
};

/** K-64: derse açılacak tek şube isteği. */
type SectionSpec = { lecturer_id: number };

type CommitCourse = CourseFields & { sections: SectionSpec[] };

type ImportResult = {
  total_parsed: number;
  added_count: number;
  merged_count: number;                 // K-54: mevcut ortak derse cohort eklendi
  skipped_count: number;
  sections_created: number;             // K-64: açılan toplam şube
};

type Props = {
  opened: boolean;
  onClose: () => void;
  departments: Department[];          // yalnız yazılabilir bölümler (can_manage_courses)
  defaultDepartmentId: string | null; // Dersler sayfasındaki bölüm filtresinden ön-seçim
  onImported: () => void;             // başarıda listeyi yenile
};

/** K-79: modül düzeyinde SABİT olamaz — sözlük dile göre değişiyor, modül
 *  düzeyi ise bir kez çalışır ve hook çağıramaz. Sözlüğü alan bir fonksiyon. */
const semesterOptions = (t: Dict) =>
  (["FALL", "SPRING", "SUMMER"] as SemesterType[]).map(
    (s) => ({ value: s, label: t.enums.semester[s] }),
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

/** Bologna bilgi paketinden bir bölümün derslerini içe aktarma modalı (K-64).
 *  İki adım: (1) önizleme — çek + hocaları eşle, (2) seç/eşle → seçilenleri ekle.
 *  Zaten şubeli dersler soluk ve seçilemez; şubesiz (yeni ya da kayıtlı) dersler
 *  Bologna'daki hocalardan şube alır. */
export default function ImportCoursesModal({
  opened, onClose, departments, defaultDepartmentId, onImported,
}: Props) {
  const t = useT();
  const [depId, setDepId] = useState<string | null>(defaultDepartmentId);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  // Faz: giriş → inceleme (parsed dolu) → sonuç (result dolu).
  const [rows, setRows] = useState<PreviewCourse[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // K-64: eşleştirme için mevcut hoca listesi (Select seçenekleri).
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  // K-64: her dersin her hocası için seçilen lecturer_id (null = şube açma).
  // Anahtar: satır index → hoca index dizisi. Eşleşenler ön-dolu gelir.
  const [picks, setPicks] = useState<Record<number, (number | null)[]>>({});

  // Modal her açılışta baştan başlasın + hoca listesini çek.
  useEffect(() => {
    if (opened) {
      setDepId(defaultDepartmentId);
      setUrl("");
      setBusy(false);
      setRows(null);
      setSelected(new Set());
      setEditing(null);
      setResult(null);
      setPicks({});
      api.get<Lecturer[]>("/lecturers")
        .then(setLecturers)
        .catch(() => setLecturers([]));
    }
  }, [opened, defaultDepartmentId]);

  const lecturerOptions = useMemo(
    () => lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) })),
    [lecturers],
  );

  // Aynı adlı dersleri (kodu farklı) ana listeden AYIR: en altta özel bir
  // bölümde, dikkat notu ile ve varsayılan seçilmemiş listelenirler.
  const { mainIdx, dupIdx } = useMemo(() => {
    const list = rows ?? [];
    const dup = duplicateNameSet(list);
    const main: number[] = [];
    const dupI: number[] = [];
    list.forEach((c, i) => (dup.has(normName(c.name)) ? dupI : main).push(i));
    dupI.sort((a, b) => normName(list[a].name).localeCompare(normName(list[b].name), "tr"));
    return { mainIdx: main, dupIdx: dupI };
  }, [rows]);

  // K-64: seçilebilir = ZATEN ŞUBESİ OLMAYAN (yeni ya da kayıtlı-şubesiz) dersler.
  // Şubeli dersler dokunulmaz. "Tümünü seç" yalnız ana listeyi kapsar.
  const selectableIdx = useMemo(
    () => mainIdx.filter((i) => !(rows ?? [])[i].has_sections),
    [mainIdx, rows],
  );
  const candidateCount = (rows ?? []).filter((c) => !c.has_sections).length;
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
      // Şube seçimlerini eşleşen hocalarla ön-doldur.
      const initialPicks: Record<number, (number | null)[]> = {};
      res.courses.forEach((c, i) => {
        initialPicks[i] = c.instructors.map((ins) => ins.lecturer_id);
      });
      setPicks(initialPicks);
      // Varsayılan: şubesiz + BENZERSİZ adlı dersler seçili gelsin.
      const dup = duplicateNameSet(res.courses);
      setSelected(new Set(
        res.courses
          .map((c, i) => (c.has_sections || dup.has(normName(c.name)) ? -1 : i))
          .filter((i) => i >= 0),
      ));
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : t.import.fetchFailed,
      });
    } finally {
      setBusy(false);
    }
  };

  // --- Faz 2: seçilenleri ekle ---
  const commit = async () => {
    if (!depId || !rows) return;
    const picked = [...selected].sort((a, b) => a - b);
    if (picked.length === 0) return;
    const courses: CommitCourse[] = picked.map((i) => {
      const { exists: _e, has_sections: _h, instructors: _ins, ...fields } = rows[i];
      // Şubeler: bu ders için seçili (null olmayan) hocalar. Aynı hocayı iki kez
      // seçmeyi de ele: tekrarlı lecturer_id tek şubeye iner (mükerrer şube olmaz).
      const chosen = (picks[i] ?? []).filter((id): id is number => id != null);
      const uniq = [...new Set(chosen)];
      return { ...fields, sections: uniq.map((lecturer_id) => ({ lecturer_id })) };
    });
    setBusy(true);
    try {
      const res = await api.post<ImportResult>("/import/courses", {
        department_id: Number(depId),
        courses,
      });
      setResult(res);
      onImported();
      notifications.show({
        color: "green",
        message: t.import.done(res.added_count, res.sections_created),
      });
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : t.import.failed,
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

  const setPick = (i: number, j: number, lecturerId: number | null) =>
    setPicks((prev) => {
      const arr = [...(prev[i] ?? [])];
      arr[j] = lecturerId;
      return { ...prev, [i]: arr };
    });

  const modalTitle = result
    ? t.import.doneTitle
    : rows
      ? t.import.pickTitle
      : t.import.title;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={modalTitle}
      centered
      // Seç/eşle adımı geniş tablo taşır → geniş ama büyük ekranda tavanlı.
      size={rows && !result ? "min(1250px, 94vw)" : "md"}
    >
      {/* ---- Faz 3: sonuç ---- */}
      {result ? (
        <Stack>
          <Alert color="green" icon={<IconCircleCheck size={18} />}>
            <Text fw={600}>
              {t.import.resultAdded(result.added_count, result.sections_created)}
            </Text>
            <Text size="sm" c="dimmed">
              {result.merged_count > 0 &&
                t.import.resultMerged(result.merged_count)}
              {t.import.resultSkipped(result.skipped_count, result.total_parsed)}
            </Text>
          </Alert>
          <Button onClick={onClose}>{t.common.close}</Button>
        </Stack>
      ) : rows ? (
        /* ---- Faz 2: seç / eşle ---- */
        <Stack>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {t.import.sectionlessCount(candidateCount)}
              {rows.length - candidateCount > 0 &&
                t.import.alreadySectioned(rows.length - candidateCount)}
              {dupIdx.length > 0 && t.import.duplicateNamed(dupIdx.length)}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
              onClick={() => setRows(null)}
            >
              {t.import.back}
            </Button>
          </Group>

          <ScrollArea.Autosize mah={460}>
            <Table stickyHeader verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={toggleAll}
                      aria-label={t.import.selectAll}
                    />
                  </Table.Th>
                  <Table.Th w={40} />
                  <Table.Th>{t.import.code}</Table.Th>
                  <Table.Th>{t.import.name}</Table.Th>
                  <Table.Th w={64}>{t.import.classYear}</Table.Th>
                  <Table.Th w={84}>{t.import.semester}</Table.Th>
                  <Table.Th w={72}>T+U+L</Table.Th>
                  <Table.Th w={150}>{t.import.type}</Table.Th>
                  <Table.Th w={280}>{t.import.lecturerSection}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mainIdx.map((i) => (
                  <RowView
                    key={i}
                    c={rows[i]}
                    selected={selected.has(i)}
                    isEditing={editing === i}
                    picks={picks[i] ?? []}
                    lecturerOptions={lecturerOptions}
                    onToggle={() => toggle(i)}
                    onEdit={() => setEditing(editing === i ? null : i)}
                    onPatch={(p) => patchRow(i, p)}
                    onPick={(j, id) => setPick(i, j, id)}
                  />
                ))}

                {dupIdx.length > 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={9} bg="var(--mantine-color-default-hover)">
                      <Text size="sm" fw={600}>
                        {t.import.duplicateTitle(dupIdx.length)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t.import.duplicateHint}
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
                    picks={picks[i] ?? []}
                    lecturerOptions={lecturerOptions}
                    onToggle={() => toggle(i)}
                    onEdit={() => setEditing(editing === i ? null : i)}
                    onPatch={(p) => patchRow(i, p)}
                    onPick={(j, id) => setPick(i, j, id)}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {t.import.lecturerMatchHint}
            </Text>
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
            label={t.import.targetDepartment}
            description={t.import.targetHelp}
            placeholder={t.import.pickDepartment}
            data={departments.map((d) => ({
              value: String(d.id), label: `${d.code} — ${d.name}`,
            }))}
            value={depId}
            onChange={setDepId}
            required
          />
          <TextInput
            label={t.import.urlLabel}
            description={t.import.urlHelp}
            placeholder="https://obs.mu.edu.tr/oibs/bologna/index.aspx?...&curSunit=253"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            required
          />
          <Text size="xs" c="dimmed">
            {t.import.lecturersNote}
          </Text>
          <Button
            leftSection={<IconDownload size={16} />}
            onClick={fetchPreview}
            loading={busy}
            disabled={!depId || !url.trim()}
          >
            {t.import.fetchCourses}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

/** Tek satır — okuma görünümü + düzenleme paneli + hoca/şube eşleme hücresi.
 *  Zaten şubeli ders soluk ve seçilemez (motor da onu sunucuda atlar). */
function RowView({
  c, selected, isEditing, picks, lecturerOptions,
  onToggle, onEdit, onPatch, onPick,
}: {
  c: PreviewCourse;
  selected: boolean;
  isEditing: boolean;
  picks: (number | null)[];
  lecturerOptions: { value: string; label: string }[];
  onToggle: () => void;
  onEdit: () => void;
  onPatch: (patch: Partial<CourseFields>) => void;
  onPick: (instructorIdx: number, lecturerId: number | null) => void;
}) {
  const t = useT();
  return (
    <>
      <Table.Tr opacity={c.has_sections ? 0.5 : 1}>
        <Table.Td>
          <Checkbox
            checked={selected}
            onChange={onToggle}
            disabled={c.has_sections}
            aria-label={t.import.pickRow(c.code)}
          />
        </Table.Td>
        <Table.Td>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onEdit}
            disabled={c.has_sections}
            aria-label={t.import.editRow(c.code)}
          >
            <IconPencil size={16} />
          </ActionIcon>
        </Table.Td>
        <Table.Td>{c.code}</Table.Td>
        <Table.Td>{c.name}</Table.Td>
        <Table.Td>{t.courses.yearN(c.year)}</Table.Td>
        <Table.Td>{t.enums.semester[c.semester]}</Table.Td>
        <Table.Td>{c.hours_theory}+{c.hours_practice}+{c.hours_lab}</Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            {c.has_sections ? (
              <Badge color="gray" variant="light">{t.import.sectioned}</Badge>
            ) : c.exists ? (
              <Badge color="gray" variant="outline">{t.import.registeredNoSection}</Badge>
            ) : c.is_elective ? (
              <Badge color="grape" variant="light">{t.import.elective}</Badge>
            ) : (
              <Badge color="blue" variant="light">{t.import.required}</Badge>
            )}
            {c.is_common && !c.exists && (
              <Badge color="teal" variant="light">{t.import.common}</Badge>
            )}
          </Group>
        </Table.Td>
        <Table.Td>
          {c.has_sections ? (
            <Text size="xs" c="dimmed">{t.import.alreadySectionedTag}</Text>
          ) : (
            <InstructorCell
              instructors={c.instructors}
              picks={picks}
              lecturerOptions={lecturerOptions}
              onPick={onPick}
            />
          )}
        </Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={9} p={0} style={{ border: isEditing ? undefined : "none" }}>
          <Collapse in={isEditing}>
            <Group p="sm" align="flex-end" wrap="wrap" bg="var(--mantine-color-default-hover)">
              <TextInput
                label={t.import.code} size="xs" w={110}
                value={c.code}
                onChange={(e) => onPatch({ code: e.currentTarget.value })}
              />
              <TextInput
                label={t.import.name} size="xs" style={{ flex: 1, minWidth: 200 }}
                value={c.name}
                onChange={(e) => onPatch({ name: e.currentTarget.value })}
              />
              <NumberInput
                label={t.import.classYear} size="xs" w={70} min={1} max={8}
                value={c.year}
                onChange={(v) => onPatch({ year: Number(v) || 1 })}
              />
              <Select
                label={t.import.semester} size="xs" w={100}
                data={semesterOptions(t)}
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
                label={t.courses.ects} size="xs" w={70} min={0}
                value={c.ects ?? ""}
                onChange={(v) => onPatch({ ects: v === "" ? null : Number(v) })}
              />
              {/* K-64: Bologna'dan gelen vize sayısı; 1-3, düzeltilebilir. */}
              <NumberInput
                label={t.import.midterm} size="xs" w={64} min={1} max={3}
                value={c.midterm_count ?? ""}
                onChange={(v) => onPatch({ midterm_count: v === "" ? null : Number(v) })}
              />
              <Switch
                label={t.import.elective} size="sm" mb={6}
                checked={c.is_elective}
                onChange={(e) => onPatch({ is_elective: e.currentTarget.checked })}
              />
              <Switch
                label={t.import.commonCourse} size="sm" mb={6}
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

/** K-64: bir dersin hocaları — her biri için Bologna ham adı + eşleme Select'i.
 *  Eşleşen hoca ön-dolu gelir; eşleşmeyen boş + "eşleşmedi" uyarısıyla gelir.
 *  Boş bırakılan hoca için şube açılmaz. */
function InstructorCell({
  instructors, picks, lecturerOptions, onPick,
}: {
  instructors: InstructorMatch[];
  picks: (number | null)[];
  lecturerOptions: { value: string; label: string }[];
  onPick: (instructorIdx: number, lecturerId: number | null) => void;
}) {
  const t = useT();
  if (instructors.length === 0) {
    return <Text size="xs" c="dimmed">{t.import.lecturerNotFound}</Text>;
  }
  return (
    <Stack gap={6}>
      {instructors.map((ins, j) => {
        const picked = picks[j] ?? null;
        const unmatched = picked == null;
        return (
          <div key={j}>
            <Text size="10px" c="dimmed" lineClamp={1} title={ins.raw}>
              {ins.raw}
            </Text>
            <Select
              size="xs"
              searchable
              clearable
              filter={turkishOptionsFilter}
              placeholder={unmatched ? t.import.unmatched : undefined}
              data={lecturerOptions}
              value={picked == null ? null : String(picked)}
              onChange={(v) => onPick(j, v == null ? null : Number(v))}
              error={unmatched ? true : undefined}
              comboboxProps={{ withinPortal: true }}
            />
          </div>
        );
      })}
    </Stack>
  );
}
