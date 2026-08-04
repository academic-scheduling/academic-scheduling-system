import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Collapse, Divider, Group, Loader, Modal,
  NumberInput, Paper, Select, Stack, Switch, Table, Text, TextInput, Title, Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconChevronRight, IconDownload, IconPencil, IconTrash } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import ImportCoursesModal from "../components/ImportCoursesModal";
import { useAuth, canWriteIn } from "../auth/AuthContext";
import { lecturerLabel, SEMESTER_LABELS } from "../api/types";
import { formatSlotRange } from "../utils/slots";
import type {
  Classroom, Course, CourseSection, Department, Lecturer, SemesterType, WeeklyEntry,
} from "../api/types";

const ALL = "__all__";
const COMMON = "__common__";      // K-48: sınıf filtresinde "Ortak dersler" değeri

/** Lisans programı 4 yıl. Backend ge=1,le=6 kabul eder — daha uzun programlar
 *  (hazırlık, 5-6 yıllık bölümler) gerekirse tek yerden büyütülür. */
const YEARS = [1, 2, 3, 4];

/** Yıl + dönem → sıralı dönem numarası: 1.sınıf Güz=1, 1.sınıf Bahar=2,
 *  2.sınıf Güz=3 … Böylece dersler 1., 2., 3. … dönem gruplarına ayrılır. */
function donemNo(year: number, semester: SemesterType): number {
  return (year - 1) * 2 + (semester === "FALL" ? 1 : 2);
}

/** K-48: ortak dersin ek cohort satırı (form içi; department_id string). */
type CohortRow = { department_id: string; year: number; semester: SemesterType };

type CourseFormValues = {
  department_id: string;
  year: number;
  semester: SemesterType;
  code: string;
  name: string;
  is_elective: string;          // Select string taşır: "false" | "true"
  is_common: boolean;           // K-48: ortak (servis) ders mi
  cohorts: CohortRow[];         // K-48: ek cohort'lar (yalnız is_common'da)
  hours_theory: number;
  hours_practice: number;
  hours_lab: number;
  ects: number | "";            // K-55: AKTS (opsiyonel; "" = girilmedi)
  theory_online: boolean;       // K-45: bileşen online mı
  practice_online: boolean;
  lab_online: boolean;
  midterm_count: number;        // K-46: vize sayısı (1-3)
};

type SectionFormValues = {
  section_no: number;
  lecturer_id: string;
  expected_students: number;
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
  // Bölüm süzgeci, Bölümler genel-bakış ekranından ?department_id= ile önceden
  // seçili gelebilir; parametreyi bir kez okuyup URL'den temizliyoruz (yenilemede
  // yapışıp kalmasın, kullanıcının sonraki seçimini ezmesin).
  const [searchParams, setSearchParams] = useSearchParams();
  const [depFilter, setDepFilter] = useState<string | null>(
    searchParams.get("department_id"),
  );
  const [importOpen, setImportOpen] = useState(false);
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
  // Satır içinde açık (akordeon) dersin id'si — null = hepsi kapalı.
  const [sectionsCourseId, setSectionsCourseId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const courseForm = useForm<CourseFormValues>({
    initialValues: {
      department_id: "", year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", is_common: false, cohorts: [],
      hours_theory: 3, hours_practice: 0, hours_lab: 0, ects: "",
      theory_online: false, practice_online: false, lab_online: false,
      midterm_count: 1,
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
    // COMMON sözde-yıl: sunucuya "year" gönderilmez; ortak dersler istemcide süzülür.
    if (yearFilter && yearFilter !== COMMON) params.set("year", yearFilter);
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

  // Deep-link parametrelerini bir kez tüket: state'e alındı, artık URL'de durmasın.
  // ?add=1 → ekleme formunu açık getir (bölüm önceden seçili). Bölüm süzgeci
  // depFilter olarak zaten okundu (state init'te).
  useEffect(() => {
    if (!searchParams.has("department_id") && !searchParams.has("add")) return;
    if (searchParams.get("add") === "1") {
      openAddCourse(searchParams.get("department_id") ?? undefined);
    }
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("add");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const depById = useMemo(() => {
    const m: Record<number, Department> = {};
    for (const d of departments) m[d.id] = d;
    return m;
  }, [departments]);

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

  // K-48: ortak (servis) dersler en ÜSTTE ayrı bir kategoride gösterilir; normal
  // dönem gruplarına girmezler (kullanıcı isteği — bir ders birden çok cohort'a
  // ait olduğundan tek bir döneme sığmıyor).
  const commonList = useMemo(
    () => visible.filter((c) => c.is_common).sort((a, b) => a.code.localeCompare(b.code, "tr")),
    [visible]);

  /** Normal (ortak olmayan) dersler TEK tabloda — dönem başına ayrı tablo YOK
   *  (kullanıcı isteği). Dönem sütunu sıralamayı taşır: dönem (donemNo) sonra
   *  kod. Ortak dersler bu tabloda değil, ayrı "Ortak Dersler" kategorisinde. */
  const normalList = useMemo(
    () => visible
      .filter((c) => !c.is_common)
      .sort((a, b) =>
        donemNo(a.year, a.semester) - donemNo(b.year, b.semester)
        || a.code.localeCompare(b.code, "tr")),
    [visible]);

  // K-57: Ortak Dersler kategorisi ortak ders VARSA her zaman görünür — belirli
  // bir sınıf seçilince de (cohort o ortak dersleri de alır; backend department_id
  // filtresi tüketilen ortak dersleri döndürür). Eskiden yıl seçilince gizleniyor,
  // "8 ders olması gerekirken 1 çıkıyor"a yol açıyordu. Normal ders tablosu
  // "Ortak dersler" sözde-yılı seçili değilken görünür.
  const showCommonGroup = commonList.length > 0;
  const showNormalTable = yearFilter !== COMMON && normalList.length > 0;

  // K-49: ortak dersi ALAN her bölümün yetkilisi düzenler + şube yönetir + siler
  // (birincil ∪ ek cohort). Normal derste yalnız birincil → eski davranış.
  function canEdit(course: Course) {
    if (canWriteIn(user, "can_manage_courses", course.department_id)) return true;
    return course.extra_cohorts.some(
      (ec) => canWriteIn(user, "can_manage_courses", ec.department_id));
  }

  const writableDepartments = useMemo(
    () => departments.filter((d) => canWriteIn(user, "can_manage_courses", d.id)),
    [departments, user],
  );

  // departmentId verilirse (Bölümler → "Ders Ekle" derin bağlantısı) o bölüm
  // önceden seçili gelir; yoksa tek yazılabilir bölüm varsa o seçilir.
  function openAddCourse(departmentId?: string) {
    setEditingCourse(null);
    courseForm.setValues({
      department_id: departmentId
        ?? (writableDepartments.length === 1 ? String(writableDepartments[0].id) : ""),
      year: 1, semester: "FALL", code: "", name: "",
      is_elective: "false", is_common: false, cohorts: [],
      hours_theory: 3, hours_practice: 0, hours_lab: 0, ects: "",
      theory_online: false, practice_online: false, lab_online: false,
      midterm_count: 1,
    });
    setCourseModal(true);
  }

  function openEditCourse(c: Course) {
    setEditingCourse(c);
    courseForm.setValues({
      department_id: String(c.department_id),
      year: c.year, semester: c.semester, code: c.code, name: c.name,
      is_elective: String(c.is_elective),
      is_common: c.is_common,
      cohorts: c.extra_cohorts.map((ec) => ({
        department_id: String(ec.department_id), year: ec.year, semester: ec.semester,
      })),
      hours_theory: c.hours_theory, hours_practice: c.hours_practice, hours_lab: c.hours_lab,
      ects: c.ects ?? "",
      theory_online: c.theory_online, practice_online: c.practice_online, lab_online: c.lab_online,
      midterm_count: c.midterm_count,
    });
    setCourseModal(true);
  }

  async function submitCourse(v: CourseFormValues) {
    // K-48: ortak dersse yalnız DOLU cohort satırları gider (yarım satır backend'i
    // "Geçersiz cohort bölümü" 400'üne düşürmesin). Aynı üçlü iki kez ya da
    // birincil cohort'la aynı verilmişse istek atmadan uyar (backend zaten 400 döner).
    const cohortRows = v.is_common ? v.cohorts.filter((c) => c.department_id) : [];
    if (v.is_common && editingCourse) {
      const seen = new Set([
        `${editingCourse.department_id}|${editingCourse.year}|${editingCourse.semester}`,
      ]);
      for (const c of cohortRows) {
        const key = `${c.department_id}|${c.year}|${c.semester}`;
        if (seen.has(key)) {
          notifications.show({
            color: "red",
            message: "Aynı grup (bölüm + sınıf + dönem) birden çok kez eklenmiş — tekrarları kaldırın.",
          });
          return;
        }
        seen.add(key);
      }
    }
    setBusy(true);
    let yeniDersId: number | null = null;
    const cohortsPayload = cohortRows.map((c) => ({
      department_id: Number(c.department_id), year: c.year, semester: c.semester,
    }));
    const ortak = {
      code: v.code, name: v.name, is_elective: v.is_elective === "true",
      is_common: v.is_common,           // K-48
      hours_theory: v.hours_theory, hours_practice: v.hours_practice, hours_lab: v.hours_lab,
      ects: v.ects === "" ? null : v.ects,   // K-55: boş bırakıldıysa null gönder
      midterm_count: v.midterm_count,   // K-46

      // K-45: saati 0 olan bileşenin online bayrağı gönderilmez (backend zaten
      // zorla false yapar; burada da tutarlı kalsın).
      theory_online: v.hours_theory > 0 && v.theory_online,
      practice_online: v.hours_practice > 0 && v.practice_online,
      lab_online: v.hours_lab > 0 && v.lab_online,
    };
    // Programa etki eden alan (online/saat) değiştiyse backend bu dersin taslak
    // haftalık+sınav yerleşimlerini sıfırlar; kullanıcıya bunu bildirelim.
    const schedFields = [
      "hours_theory", "hours_practice", "hours_lab",
      "theory_online", "practice_online", "lab_online",
    ] as const;
    const scheduleChanged = !!editingCourse
      && schedFields.some((f) => ortak[f] !== editingCourse[f]);
    try {
      if (editingCourse) {
        // Kimlik alanları (bölüm/yıl/dönem) gönderilmez — kontrat §6.
        // cohorts PATCH'te tam listeyle değişir (K-48).
        await api.patch<Course>(`/courses/${editingCourse.id}`, { ...ortak, cohorts: cohortsPayload });
        notifications.show({ color: "green", message: scheduleChanged
          ? "Ders güncellendi — programa etki eden alan değiştiği için haftalık ve sınav yerleşimleri sıfırlandı. Yeniden yerleştirin."
          : "Ders güncellendi" });
      } else {
        // K-48: ortak dersse backend aynı kodlu mevcut ortak derse cohort ekleyip
        // onu döner (birleştirme); değilse yeni kayıt. Ek cohort'lar DÜZENLE'den
        // yönetilir — create formunda cohort editörü yok.
        const created = await api.post<Course>("/courses", {
          department_id: Number(v.department_id),
          year: v.year, semester: v.semester, ...ortak,
        });
        notifications.show({
          color: "green",
          message: v.is_common ? "Ortak ders kaydedildi" : "Ders eklendi — şimdi şube ekleyin",
        });
        yeniDersId = created.id;
      }
      setCourseModal(false);
      await load();
      // Yeni ders sube olmadan ise yaramaz; kullaniciyi listeye geri gonderip
      // dersi tekrar aratmak yerine sube ekranini dogrudan aciyoruz.
      if (yeniDersId !== null) setSectionsCourseId(yeniDersId);
    } catch (e) {
      // 409: ya ders kodu çakışması ya da "yayınlanmış yerleşim var" bloğu — ikisi
      // de tek satıra sığmayan bir açıklama taşır, bildirim olarak gösterilir.
      if (e instanceof ApiError && e.status === 409) {
        notifications.show({ color: "red", message: e.message, autoClose: 8000 });
      } else {
        notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "İşlem başarısız" });
      }
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

  // Bir kategorinin derslerini TABLO olarak çizer (kullanıcı isteği: kart değil,
  // sütunlu tablo — alt alta satırlar, üstte kategori başlığı). allCommon: bu
  // tablo "Ortak Dersler" kategorisi mi (satırlar sınıf/dönem yerine "—").
  function renderCourseTable(list: Course[], allCommon: boolean) {
    return (
      <Table highlightOnHover verticalSpacing="xs" withTableBorder layout="fixed">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={120}>Kod</Table.Th>
            <Table.Th>Ad</Table.Th>
            <Table.Th w={70}>AKTS</Table.Th>
            <Table.Th w={150}>Tür</Table.Th>
            <Table.Th w={80}>Sınıf</Table.Th>
            <Table.Th w={90}>Dönem</Table.Th>
            <Table.Th w={40} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.map((c) => renderCourseRow(c, allCommon || c.is_common))}
        </Table.Tbody>
      </Table>
    );
  }

  // Tek ders satırı + tıklanınca AÇILAN detay satırı (colSpan'li, satır içinde
  // akordeon). asCommon: ortak ders → sınıf/dönem tek değere sığmaz, "—".
  function renderCourseRow(course: Course, asCommon: boolean) {
    const open = sectionsCourseId === course.id;
    return (
      <Fragment key={course.id}>
        <Table.Tr
          style={{ cursor: "pointer", opacity: course.active ? 1 : 0.55 }}
          onClick={() => setSectionsCourseId(open ? null : course.id)}
        >
          <Table.Td><Text fw={600} size="sm">{course.code}</Text></Table.Td>
          <Table.Td><Text size="sm">{course.name}</Text></Table.Td>
          <Table.Td>{course.ects ?? "—"}</Table.Td>
          <Table.Td>
            <Group gap={4} wrap="nowrap">
              <Badge size="xs" variant="light" color={course.is_elective ? "orange" : "blue"}>
                {course.is_elective ? "Seçmeli" : "Zorunlu"}
              </Badge>
              {course.is_common && <Badge size="xs" variant="light" color="teal">Ortak</Badge>}
              {!course.active && <Badge size="xs" color="gray">Pasif</Badge>}
            </Group>
          </Table.Td>
          <Table.Td>{asCommon ? "—" : `${course.year}. sınıf`}</Table.Td>
          <Table.Td>{asCommon ? "—" : SEMESTER_LABELS[course.semester]}</Table.Td>
          <Table.Td>
            <IconChevronRight
              size={16}
              style={{
                opacity: 0.5,
                transform: open ? "rotate(90deg)" : "none",
                transition: "transform .15s",
              }}
            />
          </Table.Td>
        </Table.Tr>
        {/* Açılan detay satırı — kapalıyken görünmez (kenarlık/padding yok).
            Panel yalnız AÇIKKEN mount edilir (her ders için useForm mount etmemek). */}
        <Table.Tr>
          <Table.Td colSpan={7} p={0} style={{ border: open ? undefined : "none" }}>
            <Collapse in={open}>
              {open && (
                <CourseDetailPanel
                  course={course}
                  depName={depById[course.department_id]?.name}
                  canEdit={canEdit(course)}
                  onEditCourse={openEditCourse}
                  onDeleteCourse={setDeletingCourse}
                  lecturers={lecturers}
                  classrooms={classrooms}
                  entriesBySection={entriesBySection}
                  onChanged={load}
                />
              )}
            </Collapse>
          </Table.Td>
        </Table.Tr>
      </Fragment>
    );
  }

  if (loading && courses.length === 0) return <Loader mt="xl" />;
  if (loadError) return <Alert color="red" mt="md">{loadError}</Alert>;

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={3}>Dersler</Title>
        {writableDepartments.length > 0 && (
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => setImportOpen(true)}
            >
              İçe Aktar
            </Button>
            <Button onClick={() => openAddCourse()}>+ Ders Ekle</Button>
          </Group>
        )}
      </Group>

      <ImportCoursesModal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        departments={writableDepartments}
        defaultDepartmentId={depFilter}
        onImported={load}
      />

      <Group mb="md">
        <TextInput
          placeholder="Ara"
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
            ...lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) }))]}
          value={lecFilter ?? ALL}
          onChange={(v) => setLecFilter(v === ALL || v === null ? null : v)}
          allowDeselect={false}
          searchable
          w={230}
        />
        <Select
          data={[{ value: ALL, label: "Tüm sınıflar" },
            { value: COMMON, label: "Ortak dersler" },     // K-48
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

      {!showCommonGroup && !showNormalTable ? (
        <Text c="dimmed">
          {search || depFilter || yearFilter || semFilter || lecFilter
            ? "Filtreye uyan ders yok."
            : "Henüz ders yok."}
        </Text>
      ) : (
        <Stack gap="lg">
          {/* K-48: Ortak Dersler ayrı kategori. Yalnız yıl filtresi yokken veya
              "Ortak dersler" seçiliyken görünür. Satırda "Ortak" yazar; tıklayınca
              detayda tüm cohort'ları gösterilir. */}
          {showCommonGroup && (
            <div>
              <Group gap="xs" mb="xs">
                <Text fw={700} size="sm">Ortak Dersler</Text>
                <Text size="xs" c="dimmed">({commonList.length} ders)</Text>
              </Group>
              {renderCourseTable(commonList, true)}
            </div>
          )}

          {/* K-56: dönem başına ayrı tablo YOK (kullanıcı isteği) — tüm bölüm
              dersleri TEK tabloda, dönem sütunuyla sıralı. */}
          {showNormalTable && (
            <div>
              <Group gap="xs" mb="xs">
                <Text fw={700} size="sm">Bölüm Dersleri</Text>
                <Text size="xs" c="dimmed">({normalList.length} ders)</Text>
              </Group>
              {renderCourseTable(normalList, false)}
            </div>
          )}
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
            {/* K-55: AKTS/ECTS kredisi. Opsiyonel — boş bırakılabilir (eski dersler
                ve elle eklemede zorunlu değil; Bologna import'u doldurur). */}
            <NumberInput
              label="AKTS"
              description="Dersin AKTS/ECTS kredisi (opsiyonel)."
              min={0}
              placeholder="—"
              {...courseForm.getInputProps("ects")}
            />
            {/* K-46: dersin vize sayısı. Birden fazlaysa sınav eklerken
                "kaçıncı vize" sorulur ve o sayıya kadar E2 üretilmez. */}
            <NumberInput
              label="Vize sayısı"
              description="Bir dersin 1-3 vizesi olabilir. Final ve bütünleme her zaman tektir."
              min={1} max={3} clampBehavior="strict"
              {...courseForm.getInputProps("midterm_count")}
            />
            {/* K-45: yalnız SAATİ GİRİLMİŞ bileşen için "online mı" sorulur.
                Senkron/asenkron burada değil, haftalık girişte seçilir. Hiçbir
                bileşenin saati yoksa blok hiç görünmez. */}
            {(courseForm.values.hours_theory > 0
              || courseForm.values.hours_practice > 0
              || courseForm.values.hours_lab > 0) && (
              <Stack gap={6}>
                <Text size="xs" c="dimmed">Online bileşenler</Text>
                <Group gap="lg">
                  {courseForm.values.hours_theory > 0 && (
                    <Checkbox size="xs" label="Teori online"
                      {...courseForm.getInputProps("theory_online", { type: "checkbox" })} />
                  )}
                  {courseForm.values.hours_practice > 0 && (
                    <Checkbox size="xs" label="Uygulama online"
                      {...courseForm.getInputProps("practice_online", { type: "checkbox" })} />
                  )}
                  {courseForm.values.hours_lab > 0 && (
                    <Checkbox size="xs" label="Lab online"
                      {...courseForm.getInputProps("lab_online", { type: "checkbox" })} />
                  )}
                </Group>
              </Stack>
            )}
            {/* K-48: ortak (servis) ders — Fizik/Matematik gibi birden çok
                bölümün aldığı ders. Açılınca aldığı diğer cohort'lar (bölüm+
                sınıf+dönem) girilir; motor çakışmayı bu cohort'lara karşı da bakar. */}
            <Divider label="Ortak ders" labelPosition="left" mt="xs" />
            <Switch
              label="Ortak ders"
              checked={courseForm.values.is_common}
              onChange={(e) => courseForm.setFieldValue("is_common", e.currentTarget.checked)}
            />
            {/* K-48: ekleme modunda cohort editörü YOK — aynı kodlu ortak ders
                varsa bu ekleme otomatik onun altında toplanır. Ek cohort'lar
                kaydettikten sonra Düzenle'den yönetilir. */}
            {!editingCourse && courseForm.values.is_common && (
              <Text size="xs" c="dimmed">
                Aynı kodlu bir ortak ders varsa bu kayıt onun altında toplanır.
                Aldığı diğer grupları kaydettikten sonra Düzenle'den ekleyebilirsiniz.
              </Text>
            )}
            {editingCourse && courseForm.values.is_common && (
              <Stack gap="xs">
                <Text size="xs" c="dimmed">
                  Bu dersi alan diğer bölüm/sınıf/dönem grupları. Dersin kendi
                  bölümünü eklemeye gerek yok — zaten kapsanıyor.
                </Text>
                {courseForm.values.cohorts.map((row, i) => {
                  // K-48: benzersizlik (bölüm+yıl+dönem) ÜÇLÜSÜ üzerinde. Tüm
                  // bölümler listelenir; bir bölümün farklı sınıf/dönemi geçerli
                  // bir ek cohort'tur. Yalnız aynı üçlü tekrarlanırsa uyarılır
                  // (birincil cohort ya da daha önceki bir satırla çakışma).
                  const key = row.department_id
                    ? `${row.department_id}|${row.year}|${row.semester}` : null;
                  const primaryKey = editingCourse
                    ? `${editingCourse.department_id}|${editingCourse.year}|${editingCourse.semester}`
                    : null;
                  const dup = key != null && (
                    key === primaryKey ||
                    courseForm.values.cohorts.some(
                      (cc, j) => j < i && cc.department_id &&
                        `${cc.department_id}|${cc.year}|${cc.semester}` === key)
                  );
                  return (
                  <div key={i}>
                  <Group gap="xs" wrap="nowrap" align="flex-end">
                    <Select
                      label={i === 0 ? "Bölüm" : undefined}
                      placeholder="Bölüm"
                      style={{ flex: 1 }}
                      searchable
                      error={dup}
                      data={departments.map((d) => ({
                        value: String(d.id), label: `${d.code} — ${d.name}` }))}
                      value={row.department_id || null}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.department_id`, val ?? "")}
                    />
                    <Select
                      label={i === 0 ? "Sınıf" : undefined}
                      w={90}
                      error={dup}
                      data={YEARS.map((y) => ({ value: String(y), label: `${y}.` }))}
                      value={String(row.year)}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.year`, Number(val))}
                      allowDeselect={false}
                    />
                    <Select
                      label={i === 0 ? "Dönem" : undefined}
                      w={100}
                      error={dup}
                      data={(Object.keys(SEMESTER_LABELS) as SemesterType[]).map((s) => ({
                        value: s, label: SEMESTER_LABELS[s],
                      }))}
                      value={row.semester}
                      onChange={(val) =>
                        courseForm.setFieldValue(`cohorts.${i}.semester`, val as SemesterType)}
                      allowDeselect={false}
                    />
                    <ActionIcon
                      variant="subtle" color="red" mb={4}
                      onClick={() => courseForm.removeListItem("cohorts", i)}
                      aria-label="Cohort'u kaldır"
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  {dup && (
                    <Text size="xs" c="orange" mt={4}>
                      Bu grup zaten ekli (bölüm + sınıf + dönem). Farklı bir
                      sınıf/dönem ya da bölüm seçin.
                    </Text>
                  )}
                  </div>
                  );
                })}
                <Button
                  variant="light" size="xs" style={{ alignSelf: "flex-start" }}
                  onClick={() => courseForm.insertListItem("cohorts", {
                    department_id: "", year: 1, semester: "FALL" as SemesterType,
                  })}
                >
                  + Cohort ekle
                </Button>
              </Stack>
            )}
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
    </>
  );
}

/** Ders detay + şube yönetimi — ders satırına tıklayınca SATIR İÇİNDE açılır.
 *
 *  Üstte dersin detayları (bölüm, sınıf, dönem, T+U+L, tür) ve yazma yetkisi
 *  varsa ders düzenle/sil. Altında şubeler: ekle/düzenle/sil yine yalnız
 *  yetkiliye açıktır (canEdit). Kullanıcı isteği: modal yerine akordeon panel.
 */
function CourseDetailPanel({
  course, depName, canEdit, onEditCourse, onDeleteCourse,
  lecturers, classrooms, entriesBySection, onChanged,
}: {
  course: Course | null;
  depName?: string;
  canEdit: boolean;
  onEditCourse: (c: Course) => void;
  onDeleteCourse: (c: Course) => void;
  lecturers: Lecturer[];
  classrooms: Classroom[];
  entriesBySection: Record<number, WeeklyEntry[]>;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<CourseSection | null>(null);
  const [deleting, setDeleting] = useState<CourseSection | null>(null);
  const [busy, setBusy] = useState(false);
  // Şube formu varsayılan KAPALI: detay okumaya gelen kullanıcı boş formla
  // karşılaşmasın. "+ Yeni şube ekle" butonu ya da bir şubeyi düzenlemek açar.
  const [formOpen, setFormOpen] = useState(false);

  const form = useForm<SectionFormValues>({
    initialValues: {
      section_no: 1, lecturer_id: "", expected_students: 30,
    },
    validate: {
      lecturer_id: (v) => (v ? null : "Öğretim üyesi seçin"),
      section_no: (v) => (v > 0 ? null : "Şube no 0'dan büyük olmalı"),
      expected_students: (v) => (v > 0 ? null : "Beklenen öğrenci 0'dan büyük olmalı"),
    },
  });

  function resetForm() {
    setEditing(null);
    const nextNo = course ? Math.max(0, ...course.sections.map((s) => s.section_no)) + 1 : 1;
    form.setValues({
      section_no: nextNo, lecturer_id: "", expected_students: 30,
    });
  }

  // "+ Yeni şube ekle": formu yeni-kayıt modunda aç.
  function openNew() {
    resetForm();
    setFormOpen(true);
  }

  // "Vazgeç" / başarılı işlem: formu kapat ve alanları sıfırla.
  function closeForm() {
    resetForm();
    setFormOpen(false);
  }

  // Modal açıldığında / ders değiştiğinde formu sıfırla ve kapat.
  useEffect(() => {
    if (course) { resetForm(); setFormOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  function startEdit(s: CourseSection) {
    setEditing(s);
    form.setValues({
      section_no: s.section_no,
      lecturer_id: String(s.lecturer.id),
      expected_students: s.expected_students,
    });
    setFormOpen(true);   // düzenleme aynı formu kullanır — görünür olmalı
  }

  async function submit(v: SectionFormValues) {
    if (!course) return;
    setBusy(true);
    // Derslik artık şubede DEĞİL, haftalık programda belirlenir (kullanıcı
    // isteği). default_classroom_id gönderilmez; şema opsiyonel, null kalır.
    const payload = {
      section_no: v.section_no,
      lecturer_id: Number(v.lecturer_id),
      expected_students: v.expected_students,
    };
    try {
      if (editing) {
        await api.patch<CourseSection>(`/course-sections/${editing.id}`, payload);
        notifications.show({ color: "green", message: "Şube güncellendi" });
      } else {
        await api.post<CourseSection>(`/courses/${course.id}/sections`, payload);
        notifications.show({ color: "green", message: "Şube eklendi" });
      }
      closeForm();
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
      <Stack p="md">
          {/* Ders detayları */}
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Group gap="xs">
              <Badge variant="light" color={course.is_elective ? "orange" : "blue"} size="sm">
                {course.is_elective ? "Seçmeli" : "Zorunlu"}
              </Badge>
              {/* K-48/K-49: kimlik satırı ortak dersi açıkça belirtir. Ortak derste
                  tek bölüm/sınıf/dönem GÖSTERİLMEZ — ders bir cohort'a "ait" değil,
                  hepsini alır; cohort'lar aşağıda "Aldığı gruplar"da eşit listelenir. */}
              {course.is_common && (
                <Badge variant="light" color="teal" size="sm">Ortak ders</Badge>
              )}
              {!course.active && <Badge color="gray" size="sm">Pasif</Badge>}
              <Text size="sm" c="dimmed">
                {course.is_common
                  ? `T${course.hours_theory}+U${course.hours_practice}+L${course.hours_lab}`
                  : `${depName ? `${depName} · ` : ""}${course.year}. sınıf · `
                    + `${SEMESTER_LABELS[course.semester]} · `
                    + `T${course.hours_theory}+U${course.hours_practice}+L${course.hours_lab}`}
              </Text>
            </Group>
            {canEdit && (
              <Group gap={6} wrap="nowrap">
                <Button size="xs" variant="light" leftSection={<IconPencil size={14} />}
                  onClick={() => onEditCourse(course)}>Düzenle</Button>
                <Button size="xs" variant="light" color="red" leftSection={<IconTrash size={14} />}
                  onClick={() => onDeleteCourse(course)}>Sil</Button>
              </Group>
            )}
          </Group>

          {/* K-48: ortak dersin ait olduğu TÜM cohort'lar (birincil + ek). Kullanıcı
              "aaa"yı iki ayrı kayıt sanmasın diye tıklayınca burada hepsi görünür. */}
          {course.is_common && (
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed">Aldığı gruplar:</Text>
              <Badge size="sm" variant="light" color="teal">
                {depName ? `${depName} · ` : ""}{course.year}. sınıf ·{" "}
                {SEMESTER_LABELS[course.semester]}
              </Badge>
              {course.extra_cohorts.map((ec) => (
                <Badge key={ec.id} size="sm" variant="light" color="teal">
                  {ec.department_name} · {ec.year}. sınıf · {SEMESTER_LABELS[ec.semester]}
                </Badge>
              ))}
            </Group>
          )}

          <Divider />
          <Text fw={600} size="sm">Şubeler</Text>

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
                  const entries = entriesBySection[s.id] ?? [];
                  // Derslik artık ŞUBEDE değil, haftalık YERLEŞİMDE belli: girişin
                  // dersliğinden (online ise "Online") türetilir. Kullanıcı isteği:
                  // "haftalık programda belirlendikten sonra şubenin yanında derslik
                  // diye belirtilsin."
                  const rooms = [...new Set(entries.map((e) =>
                    e.delivery_mode !== "FACE_TO_FACE" ? "Online"
                      : e.classroom ? `${e.classroom.building.name} ${e.classroom.room_code}` : null,
                  ).filter((x): x is string => x != null))];
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>{s.section_no}</Table.Td>
                      <Table.Td>{lecturerLabel(s.lecturer)}</Table.Td>
                      <Table.Td>{s.expected_students}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c={rooms.length ? undefined : "dimmed"}>
                          {rooms.length ? rooms.join(", ") : "haftalık programda belirlenir"}
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
                                {formatSlotRange(e.day_of_week, e.start_slot, e.slot_count, "short")}
                              </Badge>
                            ))}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {canEdit && (
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
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}

          {canEdit && !formOpen && (
            <Button
              variant="light" size="xs" style={{ alignSelf: "flex-start" }}
              onClick={openNew}
            >
              + Yeni şube ekle
            </Button>
          )}

          {canEdit && formOpen && (
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
                  data={lecturers.map((l) => ({ value: String(l.id), label: lecturerLabel(l) }))}
                  {...form.getInputProps("lecturer_id")}
                />
                {/* Derslik BURADA sorulmaz — haftalık programda yerleştirilirken
                    belirlenir ve şubenin yanında oradan gösterilir. */}
                <Group>
                  <Button type="submit" size="xs" loading={busy}>
                    {editing ? "Kaydet" : "Ekle"}
                  </Button>
                  <Button size="xs" variant="default" onClick={closeForm}>Vazgeç</Button>
                </Group>
              </Stack>
            </form>
          </Paper>
          )}
      </Stack>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Şubeyi sil">
        <Text>
          <b>Şube {deleting?.section_no}</b> ({deleting && lecturerLabel(deleting.lecturer)}) silinecek.
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
