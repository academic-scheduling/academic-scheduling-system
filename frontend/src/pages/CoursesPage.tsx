import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Divider, Group, Loader, Modal,
  NumberInput, Paper, Select, Stack, Table, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash, IconUsers } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { SEMESTER_LABELS } from "../api/types";
import { formatSlotRange } from "../lib/slots";
import type {
  Classroom, Course, CourseSection, Department, Lecturer, SemesterType, WeeklyEntry,
} from "../api/types";

const ALL = "__all__";

/** Lisans programı 4 yıl. Backend ge=1,le=6 kabul eder — daha uzun programlar
 *  (hazırlık, 5-6 yıllık bölümler) gerekirse tek yerden büyütülür. */
const YEARS = [1, 2, 3, 4];

type CourseFormValues = {
  department_id: string;
  year: number;
  semester: SemesterType;
  code: string;
  name: string;
  is_elective: string;          // Select string taşır: "false" | "true"
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
};

type SectionFormValues = {
  section_no: number;
  lecturer_id: string;
  expected_students: number;
  default_classroom_id: string;
};

export default function CoursesPage() {
  const { user } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [weekly, setWeekly] = useState<WeeklyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bölüm/yıl/dönem/arama SUNUCU tarafında (kontrat §6 bu dördünü sunuyor).
  const [depFilter, setDepFilter] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  const [semFilter, setSemFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Öğretim üyesi filtresi İSTEMCİ tarafında: kontrat §6'da böyle bir parametre
  // yok ve hoca bilgisi zaten iç içe gelen şubelerde mevcut.
  const [lecFilter, setLecFilter] = useState<string | null>(null);

  const [courseModal, setCourseModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);
  // Modal dersi ID ile tutar, nesne KOPYASIYLA degil: sube eklenince load()
  // courses listesini tazeler ve modal da taze veriyi gorur. Nesne saklansaydi
  // eklenen sube modalin tablosunda gorunmezdi.
  const [sectionsCourseId, setSectionsCourseId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const sectionsCourse = useMemo(
    () => courses.find((c) => c.id === sectionsCourseId) ?? null,
    [courses, sectionsCourseId],
  );

  const courseForm = useForm<CourseFormValues>({
    initialValues: {
      department_id: "", year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", hours_theory: 3, hours_practice: 0, hours_lab: 0,
    },
    validate: {
      department_id: (v) => (v ? null : "Bölüm seçin"),
      code: (v) => (v.trim() ? null : "Ders kodu boş olamaz"),
      name: (v) => (v.trim() ? null : "Ders adı boş olamaz"),
    },
  });

  async function load() {
    setLoading(true);
    setLoadError(null);
    const params = new URLSearchParams();
    if (depFilter) params.set("department_id", depFilter);
    if (yearFilter) params.set("year", yearFilter);
    if (semFilter) params.set("semester", semFilter);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    try {
      const [crs, deps, lecs, rooms, wk] = await Promise.all([
        api.get<Course[]>(`/courses${qs ? `?${qs}` : ""}`),
        api.get<Department[]>("/departments"),
        api.get<Lecturer[]>("/lecturers"),
        api.get<Classroom[]>("/classrooms"),
        api.get<WeeklyEntry[]>("/weekly-entries"),   // şubenin gün/saati için
      ]);
      setCourses(crs);
      setDepartments(deps);
      setLecturers(lecs);
      setClassrooms(rooms);
      setWeekly(wk);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);   // aramada her tuşta istek atma
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depFilter, yearFilter, semFilter, search]);

  const depById = useMemo(() => {
    const m: Record<number, Department> = {};
    for (const d of departments) m[d.id] = d;
    return m;
  }, [departments]);

  const roomById = useMemo(() => {
    const m: Record<number, Classroom> = {};
    for (const c of classrooms) m[c.id] = c;
    return m;
  }, [classrooms]);

  /** Şube id → haftalık program girişleri (bir şube birden çok slota yerleşebilir). */
  const entriesBySection = useMemo(() => {
    const m: Record<number, WeeklyEntry[]> = {};
    for (const e of weekly) (m[e.section.id] ??= []).push(e);
    for (const list of Object.values(m)) {
      list.sort((a, b) => a.day_of_week - b.day_of_week || a.start_slot - b.start_slot);
    }
    return m;
  }, [weekly]);

  /** Öğretim üyesi filtresi: dersin HERHANGİ bir şubesinde o hoca varsa gösterilir. */
  const visible = useMemo(() => {
    if (!lecFilter) return courses;
    const id = Number(lecFilter);
    return courses.filter((c) => c.sections.some((s) => s.lecturer.id === id));
  }, [courses, lecFilter]);

  function canEdit(course: Course) {
    return canWriteIn(user, "can_manage_courses", course.department_id);
  }

  const writableDepartments = useMemo(
    () => departments.filter((d) => canWriteIn(user, "can_manage_courses", d.id)),
    [departments, user],
  );

  function openAddCourse() {
    setEditingCourse(null);
    courseForm.setValues({
      department_id: writableDepartments.length === 1 ? String(writableDepartments[0].id) : "",
      year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", hours_theory: 3, hours_practice: 0, hours_lab: 0,
    });
    setCourseModal(true);
  }

  function openEditCourse(c: Course) {
    setEditingCourse(c);
    courseForm.setValues({
      department_id: String(c.department_id),
      year: c.year, semester: c.semester, code: c.code, name: c.name,
      is_elective: String(c.is_elective),
      hours_theory: c.hours_theory, hours_practice: c.hours_practice, hours_lab: c.hours_lab,
    });
    setCourseModal(true);
  }

  async function submitCourse(v: CourseFormValues) {
    setBusy(true);
    let yeniDersId: number | null = null;
    const ortak = {
      code: v.code, name: v.name, is_elective: v.is_elective === "true",
      hours_theory: v.hours_theory, hours_practice: v.hours_practice, hours_lab: v.hours_lab,
    };
    try {
      if (editingCourse) {
        // Kimlik alanları (bölüm/yıl/dönem) gönderilmez — kontrat §6.
        await api.patch<Course>(`/courses/${editingCourse.id}`, ortak);
        notifications.show({ color: "green", message: "Ders güncellendi" });
      } else {
        const created = await api.post<Course>("/courses", {
          department_id: Number(v.department_id),
          year: v.year, semester: v.semester, ...ortak,
        });
        notifications.show({ color: "green", message: "Ders eklendi — şimdi şube ekleyin" });
        yeniDersId = created.id;
      }
      setCourseModal(false);
      await load();
      // Yeni ders sube olmadan ise yaramaz; kullaniciyi listeye geri gonderip
      // dersi tekrar aratmak yerine sube ekranini dogrudan aciyoruz.
      if (yeniDersId !== null) setSectionsCourseId(yeniDersId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) courseForm.setFieldError("code", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteCourse() {
    if (!deletingCourse) return;
    setBusy(true);
    try {
      await api.delete(`/courses/${deletingCourse.id}`);
      notifications.show({ color: "green", message: "Ders silindi" });
      setDeletingCourse(null);
      await load();
    } catch (e) {
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
      setDeletingCourse(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading && courses.length === 0) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Dersler</Title>
        {writableDepartments.length > 0 && <Button onClick={openAddCourse}>+ Ders Ekle</Button>}
      </Group>

      <Group mb="md">
        <TextInput
          placeholder="Ders kodu veya ismi ara"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={230}
        />
        <Select
          data={[{ value: ALL, label: "Tüm bölümler" },
            ...departments.map((d) => ({ value: String(d.id), label: `${d.code} — ${d.name}` }))]}
          value={depFilter ?? ALL}
          onChange={(v) => setDepFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
          w={230}
        />
        <Select
          data={[{ value: ALL, label: "Tüm öğretim üyeleri" },
            ...lecturers.map((l) => ({ value: String(l.id), label: l.full_name }))]}
          value={lecFilter ?? ALL}
          onChange={(v) => setLecFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
          searchable
          w={230}
        />
        <Select
          data={[{ value: ALL, label: "Tüm sınıflar" },
            ...YEARS.map((y) => ({ value: String(y), label: `${y}. sınıf` }))]}
          value={yearFilter ?? ALL}
          onChange={(v) => setYearFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
          w={140}
        />
        <Select
          data={[{ value: ALL, label: "Tüm dönemler" },
            ...(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
              value: s, label: SEMESTER_LABELS[s],
            }))]}
          value={semFilter ?? ALL}
          onChange={(v) => setSemFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
          w={140}
        />
      </Group>

      {visible.length === 0 ? (
        <Text c="dimmed">
          {search || depFilter || yearFilter || semFilter || lecFilter
            ? "Filtreye uyan ders yok."
            : "Henüz ders yok."}
        </Text>
      ) : (
        <Stack gap="md">
          {visible.map((course) => {
            const dep = depById[course.department_id];
            const editable = canEdit(course);
            return (
              <Paper key={course.id} withBorder p="md" opacity={course.active ? 1 : 0.6}>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div style={{ minWidth: 0 }}>
                    <Group gap="xs" mb={4}>
                      <Text fw={700} size="lg">{course.code}</Text>
                      <Text size="lg">{course.name}</Text>
                      {/* Zorunlu da açıkça yazılır — "rozet yoksa zorunludur" çıkarımı
                          kullanıcıya bırakılmaz (K-05 severity'sini etkileyen bir alan). */}
                      <Badge
                        variant="light"
                        color={course.is_elective ? "orange" : "blue"}
                        size="sm"
                      >
                        {course.is_elective ? "Seçmeli" : "Zorunlu"}
                      </Badge>
                      {!course.active && <Badge color="gray" size="sm">Pasif</Badge>}
                    </Group>
                    <Group gap="xs">
                      <Badge variant="light" color="gray" size="sm">{dep?.code ?? "?"}</Badge>
                      <Text size="sm" c="dimmed">
                        {course.year}. sınıf · {SEMESTER_LABELS[course.semester]} ·
                        {" "}T{course.hours_theory}+U{course.hours_practice}+L{course.hours_lab}
                      </Text>
                    </Group>
                  </div>
                  {editable && (
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Dersi düzenle">
                        <ActionIcon variant="subtle" onClick={() => openEditCourse(course)}>
                          <IconPencil size={18} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Dersi sil">
                        <ActionIcon variant="subtle" color="red" onClick={() => setDeletingCourse(course)}>
                          <IconTrash size={18} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Group>

                <Divider my="sm" />
                {/* Şubeler bloğu: eylem butonu bu bloğun hizasında, sağ üstte */}
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div style={{ flex: 1, minWidth: 0 }}>
                {course.sections.length === 0 ? (
                  <Text size="sm" c="dimmed">Henüz şube yok.</Text>
                ) : (
                  <Stack gap={6}>
                    {[...course.sections]
                      .sort((a, b) => a.section_no - b.section_no)
                      .map((s) => {
                        const room = s.default_classroom_id ? roomById[s.default_classroom_id] : null;
                        const entries = entriesBySection[s.id] ?? [];
                        return (
                          <Group key={s.id} gap="sm" wrap="nowrap">
                            <Badge variant="outline" size="sm" w={70}>Şube {s.section_no}</Badge>
                            <Text size="sm" style={{ minWidth: 190 }}>{s.lecturer.full_name}</Text>
                            <Text size="sm" c="dimmed" style={{ minWidth: 80 }}>
                              {s.expected_students} öğrenci
                            </Text>
                            <Text size="sm" c="dimmed" style={{ minWidth: 130 }}>
                              {room ? `${room.building.name} ${room.room_code}` : "derslik yok"}
                            </Text>
                            {/* Haftalık programa yerleştiyse gün + saat aralığı */}
                            {entries.length === 0 ? (
                              <Text size="sm" c="dimmed">programda değil</Text>
                            ) : (
                              <Group gap={4}>
                                {entries.map((e) => (
                                  <Badge
                                    key={e.id}
                                    variant="light"
                                    color={e.status === "SUBMITTED" ? "green" : "yellow"}
                                    size="sm"
                                  >
                                    {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count)}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Group>
                        );
                      })}
                  </Stack>
                )}
                  </div>
                  {editable && (
                    <Button
                      variant="light"
                      size="xs"
                      leftSection={<IconUsers size={15} />}
                      onClick={() => setSectionsCourseId(course.id)}
                    >
                      Şubeleri Düzenle
                    </Button>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* --- Ders formu --- */}
      <Modal
        opened={courseModal}
        onClose={() => setCourseModal(false)}
        title={editingCourse ? "Dersi Düzenle" : "Yeni Ders"}
      >
        <form onSubmit={courseForm.onSubmit(submitCourse)}>
          <Stack>
            <Select
              label="Bölüm"
              placeholder="Seçin"
              data={writableDepartments.map((d) => ({
                value: String(d.id), label: `${d.code} — ${d.name}`,
              }))}
              disabled={!!editingCourse}
              description={editingCourse ? "Dersin kimliği — değiştirilemez (kontrat §6)" : undefined}
              {...courseForm.getInputProps("department_id")}
            />
            <Group grow>
              <Select
                label="Sınıf"
                data={YEARS.map((y) => ({ value: String(y), label: `${y}. sınıf` }))}
                value={String(courseForm.values.year)}
                onChange={(v) => courseForm.setFieldValue("year", Number(v))}
                disabled={!!editingCourse}
                allowDeselect={false}
              />
              <Select
                label="Dönem"
                data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
                  value: s, label: SEMESTER_LABELS[s],
                }))}
                value={courseForm.values.semester}
                onChange={(v) => courseForm.setFieldValue("semester", v as SemesterType)}
                disabled={!!editingCourse}
                allowDeselect={false}
              />
            </Group>
            <TextInput label="Ders Kodu" placeholder="CENG2001" {...courseForm.getInputProps("code")} />
            <TextInput label="Ders Adı" placeholder="İstatistik" {...courseForm.getInputProps("name")} />
            <Select
              label="Ders Türü"
              description="Seçmelide cohort çakışması uyarıdır, zorunluda submit engeli (K-05)"
              data={[
                { value: "false", label: "Zorunlu" },
                { value: "true", label: "Seçmeli" },
              ]}
              allowDeselect={false}
              {...courseForm.getInputProps("is_elective")}
            />
            <Group grow>
              <NumberInput label="Teori (T)" min={0} {...courseForm.getInputProps("hours_theory")} />
              <NumberInput label="Uygulama (U)" min={0} {...courseForm.getInputProps("hours_practice")} />
              <NumberInput label="Lab (L)" min={0} {...courseForm.getInputProps("hours_lab")} />
            </Group>
            <Button type="submit" loading={busy} mt="sm">
              {editingCourse ? "Kaydet" : "Ekle"}
            </Button>
          </Stack>
        </form>
      </Modal>

      {/* --- Ders silme onayı --- */}
      <Modal opened={deletingCourse !== null} onClose={() => setDeletingCourse(null)} title="Dersi sil">
        <Text>
          <b>{deletingCourse?.code}</b> — {deletingCourse?.name} kalıcı olarak silinecek.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Şubesi veya sınavı olan ders silinemez; onun yerine düzenleyip pasife alın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeletingCourse(null)}>Vazgeç</Button>
          <Button color="red" loading={busy} onClick={deleteCourse}>Sil</Button>
        </Group>
      </Modal>

      <SectionsModal
        course={sectionsCourse}
        onClose={() => setSectionsCourseId(null)}
        lecturers={lecturers}
        classrooms={classrooms}
        entriesBySection={entriesBySection}
        onChanged={load}
      />
    </>
  );
}

/** Şube yönetimi — ders kartındaki "Şubeleri Düzenle" ile açılır.
 *
 *  Ekle/düzenle/sil buradadır; ders kartındaki şube satırları salt-okunur
 *  kalır. Böylece liste sade durur, eylemler tek yerde toplanır
 *  (Derslikler'deki "Binaları Yönet" modalıyla aynı desen).
 */
function SectionsModal({
  course, onClose, lecturers, classrooms, entriesBySection, onChanged,
}: {
  course: Course | null;
  onClose: () => void;
  lecturers: Lecturer[];
  classrooms: Classroom[];
  entriesBySection: Record<number, WeeklyEntry[]>;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<CourseSection | null>(null);
  const [deleting, setDeleting] = useState<CourseSection | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<SectionFormValues>({
    initialValues: {
      section_no: 1, lecturer_id: "", expected_students: 30, default_classroom_id: "",
    },
    validate: {
      lecturer_id: (v) => (v ? null : "Öğretim üyesi seçin"),
      section_no: (v) => (v > 0 ? null : "Şube no 0'dan büyük olmalı"),
      expected_students: (v) => (v > 0 ? null : "Beklenen öğrenci 0'dan büyük olmalı"),
    },
  });

  const roomById = useMemo(() => {
    const m: Record<number, Classroom> = {};
    for (const c of classrooms) m[c.id] = c;
    return m;
  }, [classrooms]);

  function resetForm() {
    setEditing(null);
    const nextNo = course ? Math.max(0, ...course.sections.map((s) => s.section_no)) + 1 : 1;
    form.setValues({
      section_no: nextNo, lecturer_id: "", expected_students: 30, default_classroom_id: "",
    });
  }

  // Modal açıldığında / ders değiştiğinde formu sıfırla
  useEffect(() => {
    if (course) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  function startEdit(s: CourseSection) {
    setEditing(s);
    form.setValues({
      section_no: s.section_no,
      lecturer_id: String(s.lecturer.id),
      expected_students: s.expected_students,
      default_classroom_id: s.default_classroom_id ? String(s.default_classroom_id) : "",
    });
  }

  async function submit(v: SectionFormValues) {
    if (!course) return;
    setBusy(true);
    const payload = {
      section_no: v.section_no,
      lecturer_id: Number(v.lecturer_id),
      expected_students: v.expected_students,
      default_classroom_id: v.default_classroom_id ? Number(v.default_classroom_id) : null,
    };
    try {
      if (editing) {
        await api.patch<CourseSection>(`/course-sections/${editing.id}`, payload);
        notifications.show({ color: "green", message: "Şube güncellendi" });
      } else {
        await api.post<CourseSection>(`/courses/${course.id}/sections`, payload);
        notifications.show({ color: "green", message: "Şube eklendi" });
      }
      resetForm();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) form.setFieldError("section_no", e.message);
      else notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/course-sections/${deleting.id}`);
      notifications.show({ color: "green", message: "Şube silindi" });
      setDeleting(null);
      await onChanged();
    } catch (e) {
      // 409 = şubenin haftalık program girişi var
      notifications.show({
        color: "red", title: "Silinemedi",
        message: e instanceof ApiError ? e.message : "İşlem başarısız",
        autoClose: 7000,
      });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  if (!course) return null;
  const sections = [...course.sections].sort((a, b) => a.section_no - b.section_no);

  return (
    <>
      <Modal opened onClose={onClose} title={`${course.code} — Şubeler`} size="xl">
        <Stack>
          {sections.length === 0 ? (
            <Text c="dimmed" size="sm">Henüz şube yok.</Text>
          ) : (
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={70}>Şube</Table.Th>
                  <Table.Th>Öğretim Üyesi</Table.Th>
                  <Table.Th w={90}>Öğrenci</Table.Th>
                  <Table.Th>Derslik</Table.Th>
                  <Table.Th>Haftalık Program</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sections.map((s) => {
                  const room = s.default_classroom_id ? roomById[s.default_classroom_id] : null;
                  const entries = entriesBySection[s.id] ?? [];
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>{s.section_no}</Table.Td>
                      <Table.Td>{s.lecturer.full_name}</Table.Td>
                      <Table.Td>{s.expected_students}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c={room ? undefined : "dimmed"}>
                          {room ? `${room.building.name} ${room.room_code}` : "—"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {entries.length === 0 ? (
                          <Text size="sm" c="dimmed">programda değil</Text>
                        ) : (
                          <Group gap={4}>
                            {entries.map((e) => (
                              <Badge key={e.id} variant="light" size="sm"
                                color={e.status === "SUBMITTED" ? "green" : "yellow"}>
                                {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count, true)}
                              </Badge>
                            ))}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Düzenle">
                            <ActionIcon variant="subtle" size="sm" onClick={() => startEdit(s)}>
                              <IconPencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Sil">
                            <ActionIcon variant="subtle" size="sm" color="red" onClick={() => setDeleting(s)}>
                              <IconTrash size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}

          <Paper withBorder p="sm">
            <form onSubmit={form.onSubmit(submit)}>
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  {editing ? `Düzenle: Şube ${editing.section_no}` : "Yeni şube"}
                </Text>
                {/* İkisinde de açıklama yok: biri description alsaydı input'u bir
                    satır aşağı iter ve yan yana hizaları bozulurdu. */}
                <Group grow>
                  <NumberInput label="Şube No" min={1} {...form.getInputProps("section_no")} />
                  <NumberInput
                    label="Beklenen Öğrenci"
                    min={1}
                    {...form.getInputProps("expected_students")}
                  />
                </Group>
                <Select
                  label="Öğretim Üyesi"
                  placeholder="Seçin"
                  searchable
                  nothingFoundMessage="Bulunamadı"
                  data={lecturers.map((l) => ({ value: String(l.id), label: l.full_name }))}
                  {...form.getInputProps("lecturer_id")}
                />
                <Select
                  label="Derslik"
                  placeholder="Yok"
                  clearable
                  searchable
                  data={classrooms.map((c) => ({
                    value: String(c.id),
                    label: `${c.building.name} ${c.room_code} (${c.capacity})`,
                  }))}
                  {...form.getInputProps("default_classroom_id")}
                />
                <Group>
                  <Button type="submit" size="xs" loading={busy}>
                    {editing ? "Kaydet" : "Ekle"}
                  </Button>
                  {editing && (
                    <Button size="xs" variant="default" onClick={resetForm}>Vazgeç</Button>
                  )}
                </Group>
              </Stack>
            </form>
          </Paper>
        </Stack>
      </Modal>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Şubeyi sil">
        <Text>
          <b>Şube {deleting?.section_no}</b> ({deleting?.lecturer.full_name}) silinecek.
        </Text>
        <Text c="dimmed" size="sm" mt="xs">
          Haftalık program girişi olan şube silinemez; önce girişleri kaldırın.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>Vazgeç</Button>
          <Button color="red" loading={busy} onClick={remove}>Sil</Button>
        </Group>
      </Modal>
    </>
  );
}
