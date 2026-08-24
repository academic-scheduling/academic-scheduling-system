import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert, Badge, Button, Group, Loader, Paper, Popover, SegmentedControl,
  Select, Stack, Table, Text, Title,
} from "@mantine/core";
import {
  IconArrowRight, IconChecks, IconFilter, IconFilterOff,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type {
  ConflictAffectedRef, ConflictResult, ConflictScan, Department, SemesterType,
} from "../api/types";
import { formatSlotRange } from "../utils/slots";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/* ==================================================================
 * K-80 · Çakışma Raporu — öteki ekranlarla aynı kabuk
 *
 * Eskiden HARD ve WARNING iki ayrı SEKMEYDİ ve her biri kart yığını çiziyordu.
 * Sekme "ya o ya bu" der; oysa şiddet bir SÜZGEÇ boyutudur ve "hepsini birden
 * gör" en doğal istektir — sekmede o seçenek yoktu.
 *
 * Şimdi Dersler/Derslikler ile aynı kabuk: başlık, tek süzgeç çubuğu (şiddet
 * segmenti + "Filtrele" popover'ı), altında TABLO. Tablo çünkü her çakışmanın
 * aynı beş sorusu var — hangi tür, hangi kural, ne oldu, hangi cohort/ne zaman,
 * hangi öğeler — ve sütun başlığı bu soruları bir kez sorup satırları
 * karşılaştırılabilir kılıyor.
 * ================================================================== */

// "Filtre yok" sentinel'i: Mantine Select value'su null olamadığı için
// "hepsi" seçeneği listede görünür bir öğe olmak zorunda.
const ALL = "__all__";

type Sev = "ALL" | "HARD" | "WARNING";

/** Tablodaki tek satır: çakışma + hangi kovadan geldiği.
 *
 *  Şiddet `ConflictResult.severity` içinde de var; yine de kovayı taşıyoruz,
 *  çünkü listeyi birleştiren şey KOVA ve satırın rengini tek bir gerçeğin
 *  belirlemesi, iki kaynağın gün gelip ayrışmasından iyidir. */
type Satir = { c: ConflictResult; hard: boolean };

/** Etkilenen öğenin cohort'u: "CENG · 1. sınıf · Bahar".
 *  Motor eski kayıtlarda alanları üretmemiş olabilir — eksikse satır atlanır,
 *  yarım bir etiket ("· 1. sınıf ·") göstermek bilgi değil gürültüdür. */
function cohortEtiketi(
  a: ConflictAffectedRef, depAdi: (id: number) => string, t: Dict,
): string | null {
  if (a.department_id == null) return null;
  const parcalar = [depAdi(a.department_id)];
  if (a.year != null) parcalar.push(t.conflicts.yearN(a.year));
  if (a.semester != null) parcalar.push(t.enums.semester[a.semester]);
  return parcalar.join(" · ");
}

/** Etkilenen öğenin YERLEŞİM ZAMANI. İki tür iki farklı şekilde okunur:
 *  haftalıkta gün + slot aralığı, sınavda tarih + saat. */
function zamanEtiketi(a: ConflictAffectedRef, t: Dict): string | null {
  if (a.day_of_week != null && a.start_slot != null) {
    return formatSlotRange(a.day_of_week, a.start_slot, a.slot_count ?? 1, "short", t);
  }
  if (a.exam_date) {
    const gun = new Date(`${a.exam_date}T00:00:00`).toLocaleDateString(t.locale, {
      day: "2-digit", month: "short",
    });
    return a.start_time ? `${gun} ${a.start_time.slice(0, 5)}` : gun;
  }
  return null;
}

export default function ConflictsPage() {
  const t = useT();
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Bölüm/sınıf süzgeci Bölümler sayacından ?department_id= ile önceden gelebilir.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sev, setSev] = useState<Sev>("ALL");
  const [dep, setDep] = useState<string | null>(searchParams.get("department_id"));
  const [year, setYear] = useState<string | null>(searchParams.get("year"));
  const [sem, setSem] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);   // "weekly_entry" | "exam"
  const [rule, setRule] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Kontrat §9 & K-26: Workgroup'un TÜMÜ taranır ve sonuçlar gösterilir.
        const [tarama, deps] = await Promise.all([
          api.get<ConflictScan>("/conflicts"),
          api.get<Department[]>("/departments"),
        ]);
        if (iptal) return;
        setScan(tarama);
        setDepartments(deps);
      } catch (e) {
        if (!iptal) setError(e instanceof ApiError ? e.message : t.conflicts.loadFailed);
      } finally {
        if (!iptal) setLoading(false);
      }
    })();
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link parametrelerini bir kez tüket: state'e alındı, URL'de yapışmasın.
  useEffect(() => {
    if (!searchParams.has("department_id") && !searchParams.has("year")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("year");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const depAdi = useMemo(() => {
    const harita = new Map(departments.map((d) => [d.id, d.code]));
    return (id: number) => harita.get(id) ?? `#${id}`;
  }, [departments]);

  /** İki kova tek listeye. Sıralama: HARD ÖNCE (yayını engelleyen iş önce
   *  görülmeli), sonra kural koduna göre — aynı kuralın vuruşları yan yana
   *  düşsün, çoğu zaman aynı kökten gelirler ve toplu çözülürler. */
  const hepsi = useMemo<Satir[]>(() => [
    ...(scan?.hard ?? []).map((c) => ({ c, hard: true })),
    ...(scan?.warnings ?? []).map((c) => ({ c, hard: false })),
  ].sort((a, b) =>
    Number(b.hard) - Number(a.hard)
    || a.c.rule_id.localeCompare(b.c.rule_id, "en")
    || a.c.message.localeCompare(b.c.message, "tr")),
  [scan]);

  /** Süzme: bir çakışma, ETKİLENEN ÖĞELERİNDEN HERHANGİ biri ölçüte uyuyorsa
   *  listede kalır. Bölümler-arası bir çakışma (W1/W2) iki tarafı da taşır; o
   *  bölümü seçince görünür — çözebilmek için karşı tarafı da görmek gerekir
   *  (K-26). Aynı mantık sınıf, dönem ve tür için de geçerli. */
  const list = useMemo(() => hepsi.filter(({ c, hard }) => {
    if (sev === "HARD" && !hard) return false;
    if (sev === "WARNING" && hard) return false;
    if (rule && c.rule_id !== rule) return false;
    if (dep && !c.affected.some((a) => String(a.department_id) === dep)) return false;
    if (year && !c.affected.some((a) => String(a.year) === year)) return false;
    if (sem && !c.affected.some((a) => a.semester === sem)) return false;
    if (kind && !c.affected.some((a) => a.type === kind)) return false;
    return true;
  }), [hepsi, sev, rule, dep, year, sem, kind]);

  const hardSayi = hepsi.filter((s) => s.hard).length;
  const uyariSayi = hepsi.length - hardSayi;

  /** Seçenekler VERİDEN türetilir: yalnız gerçekten çakışması olan sınıf/dönem/
   *  kural listelensin. Boş seçenek seçtirip "sonuç yok" göstermek, kullanıcıyı
   *  kendi verisi hakkında yanıltır — seçenek varsa sonuç da vardır. */
  const secenekler = useMemo(() => {
    const years = new Set<number>();
    const sems = new Set<string>();
    const rules = new Set<string>();
    for (const { c } of hepsi) {
      rules.add(c.rule_id);
      for (const a of c.affected) {
        if (a.year != null) years.add(a.year);
        if (a.semester != null) sems.add(a.semester);
      }
    }
    return {
      years: [...years].sort((x, y) => x - y),
      sems: [...sems].sort(),
      rules: [...rules].sort((x, y) => x.localeCompare(y, "en")),
    };
  }, [hepsi]);

  /** ŞİDDET bilerek DIŞARIDA: o bir segment, kendi durumu zaten görünür ve
   *  "Tümü"ne dönmek tek tık. Sayaç ve "temizle" yalnız POPOVER içindeki
   *  süzgeçleri anlatır — yoksa "Tümü/Engel/Uyarı"dan birini seçmek ekrana
   *  ilgisiz bir temizleme butonu düşürüyordu. */
  const acikSuzgec = [dep, year, sem, kind, rule].filter(Boolean).length;
  const temizle = () => {
    setDep(null); setYear(null); setSem(null); setKind(null); setRule(null);
  };

  if (loading && !scan) return <Loader mt="xl" />;
  if (error) return <Alert color="red" mt="md">{error}</Alert>;

  return (
    <Stack gap="md">
      {/* K-80: başlıkta sayaç YOK — sayılar segmentin üzerinde zaten yazıyor. */}
      <Title order={3}>{t.conflicts.title}</Title>

      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" align="center" wrap="wrap">
          {/* Şiddet BİRİNCİL boyut, o yüzden popover'da değil dışarıda:
              seçenekler ve sayıları aynı anda görünür. */}
          <SegmentedControl
            value={sev}
            onChange={(v: string) => setSev(v as Sev)}
            data={[
              { value: "ALL", label: `${t.common.all} (${hepsi.length})` },
              { value: "HARD", label: `${t.conflicts.blocking} (${hardSayi})` },
              { value: "WARNING", label: `${t.conflicts.warning} (${uyariSayi})` },
            ]}
            size="sm"
          />

          {/* Kalan dört boyut popover'da (Dersler/Derslikler deseni): yan yana
              beş açılır kutu, çoğu zaman kullanılmadan yer kaplıyordu. */}
          <Popover opened={filtersOpen} onChange={setFiltersOpen}
            position="bottom-start" width={430} shadow="md" withArrow>
            <Popover.Target>
              <Button variant="default" size="sm"
                leftSection={<IconFilter size={16} />}
                onClick={() => setFiltersOpen((o) => !o)}>
                {t.conflicts.filter}
                {acikSuzgec > 0 && (
                  <Badge size="sm" circle ml={6} variant="filled">{acikSuzgec}</Badge>
                )}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="sm">
                <Group grow gap="sm">
                  <FilterSelect label={t.conflicts.department}
                    placeholder={t.conflicts.allDepartments}
                    value={dep} onChange={setDep}
                    data={departments.map((d) => ({
                      value: String(d.id), label: `${d.code} — ${d.name}` }))} />
                  <FilterSelect label={t.conflicts.classYear}
                    placeholder={t.conflicts.allYears}
                    value={year} onChange={setYear}
                    data={secenekler.years.map((y) => ({
                      value: String(y), label: t.conflicts.yearN(y) }))} />
                </Group>
                <Group grow gap="sm">
                  <FilterSelect label={t.conflicts.semester}
                    placeholder={t.conflicts.allSemesters}
                    value={sem} onChange={setSem}
                    data={secenekler.sems.map((s) => ({
                      value: s, label: t.enums.semester[s as SemesterType] }))} />
                  <FilterSelect label={t.conflicts.colKind}
                    placeholder={t.conflicts.allKinds}
                    value={kind} onChange={setKind}
                    data={[
                      { value: "weekly_entry", label: t.conflicts.weeklyConflict },
                      { value: "exam", label: t.conflicts.examConflict },
                    ]} />
                </Group>
                <FilterSelect label={t.conflicts.colRule}
                  placeholder={t.conflicts.allRules}
                  value={rule} onChange={setRule}
                  data={secenekler.rules.map((r) => ({
                    value: r, label: `${t.conflicts.rule} ${r}` }))} />
                {acikSuzgec > 0 && (
                  <Button variant="subtle" color="gray" size="sm"
                    leftSection={<IconFilterOff size={15} />} onClick={temizle}>
                    {t.conflicts.clearFilter}
                  </Button>
                )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Paper>

      <ConflictTable list={list} hicYokMu={hepsi.length === 0} depAdi={depAdi} />
    </Stack>
  );
}

function FilterSelect({ label, placeholder, value, onChange, data }: {
  label: string; placeholder: string; value: string | null;
  onChange: (v: string | null) => void;
  data: { value: string; label: string }[];
}) {
  return (
    <Select
      label={label} size="sm" allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
      // "Hepsi" seçeneği listenin BAŞINDA görünür bir öğe: Mantine'in
      // temizleme (×) ikonu fark edilmiyor (K-56'da görüldü).
      data={[{ value: ALL, label: placeholder }, ...data]}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL || v === null ? null : v)}
    />
  );
}

/** Tablo — eskiden her çakışma bir KART'tı ve ekrana az kayıt sığıyordu.
 *
 *  Her çakışmanın aynı beş sorusu var, o yüzden sütun: tür · kural · ne oldu ·
 *  hangi cohort ve ne zaman · hangi öğeler. Cohort/zaman ALT ALTA yazılıyor,
 *  çünkü bir çakışma iki tarafı da taşıyabiliyor (W1/W2 bölümler arası) ve
 *  yan yana dizilince hangi zamanın hangi cohort'a ait olduğu karışıyor. */
function ConflictTable({ list, hicYokMu, depAdi }: {
  list: Satir[]; hicYokMu: boolean; depAdi: (id: number) => string;
}) {
  const t = useT();

  if (list.length === 0) {
    // İki ayrı boşluk, iki ayrı anlam: gerçekten çakışma YOK (iyi haber) ile
    // süzgeç sonuçsuz kaldı (ölçüt dar). Aynı cümleyle geçiştirilemez.
    return (
      <Paper withBorder radius="md" p="lg">
        {hicYokMu ? (
          <Group gap={9}>
            <IconChecks size={18} color="var(--mantine-color-green-6)" />
            <Text size="sm" c="green.7">{t.conflicts.emptyAll}</Text>
          </Group>
        ) : (
          <Text size="sm" c="dimmed">{t.conflicts.emptyFiltered}</Text>
        )}
      </Paper>
    );
  }

  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      <Table.ScrollContainer minWidth={880}>
        <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={110}>{t.conflicts.colKind}</Table.Th>
              <Table.Th w={78}>{t.conflicts.colRule}</Table.Th>
              <Table.Th>{t.conflicts.colConflict}</Table.Th>
              <Table.Th w={210}>{t.conflicts.colCohort}</Table.Th>
              <Table.Th w={170}>{t.conflicts.colItems}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map(({ c, hard }, i) => {
              const sinav = c.affected.some((a) => a.type === "exam");
              return (
                <Table.Tr key={`${c.rule_id}-${i}`}
                  style={{
                    // Sol kenar çubuğu, ızgaradaki çakışma belirtecinin AYNI
                    // dili (K-80): kırmızı engel, turuncu uyarı.
                    borderLeft: `3px solid var(--mantine-color-${hard ? "red" : "orange"}-6)`,
                  }}>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={sinav ? "violet" : "blue"}>
                      {sinav ? t.conflicts.examConflict : t.conflicts.weeklyConflict}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={hard ? "red" : "orange"}>
                      {c.rule_id}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text fz={13} lh={1.45}>{c.message}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      {/* TEKİLLEŞTİRİLİR: çakışmanın iki tarafı çoğu zaman AYNI
                          cohort'ta ve aynı saatte olur (kural zaten "aynı anda"
                          diyor). Aynı satırı iki kez yazmak bilgi katmaz. */}
                      {[...new Set(c.affected.map((a) => {
                        const cohort = cohortEtiketi(a, depAdi, t);
                        const zaman = zamanEtiketi(a, t);
                        return [cohort, zaman].filter(Boolean).join(" · ");
                      }).filter(Boolean))].map((satir) => (
                        <Text key={satir} fz={11.5} c="dimmed" lh={1.4}>{satir}</Text>
                      ))}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    {/* Tıklayınca ilgili programda vurgulanır (K-62). */}
                    <Group gap={5} wrap="wrap">
                      {c.affected.map((a, ix) => {
                        const oSinav = a.type === "exam";
                        const yol = `${oSinav ? "/exams" : "/weekly"}`
                          + `?highlight=${a.id}&rule=${c.rule_id}`;
                        return (
                          <Button key={ix} component={Link} to={yol} size="compact-xs"
                            variant="light" color={oSinav ? "violet" : "blue"}
                            rightSection={<IconArrowRight size={11} />}>
                            {a.course_code
                              ?? `${oSinav ? t.conflicts.exam : t.conflicts.course} #${a.id}`}
                          </Button>
                        );
                      })}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
