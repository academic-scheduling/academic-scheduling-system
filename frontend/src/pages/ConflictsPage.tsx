import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert, Badge, Button, Group, Loader, Paper, SegmentedControl, Select,
  Stack, Text, Title,
} from "@mantine/core";
import { IconArrowRight, IconChecks, IconFilterOff } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type {
  ConflictResult, ConflictScan, Department, SemesterType,
} from "../api/types";
import { BORDER } from "../utils/scheduleTheme";
import { useT } from "../i18n";

/* ==================================================================
 * K-80 · Çakışma Raporu — öteki ekranlarla aynı kabuk
 *
 * Eskiden HARD ve WARNING iki ayrı SEKMEYDİ, her biri kart yığını çiziyordu.
 * İki kusuru vardı:
 *   1. Sekme "ya o ya bu" der; oysa şiddet bir SÜZGEÇ boyutudur ve "hepsini
 *      birden gör" en doğal istektir — sekmede o seçenek YOKTU.
 *   2. Süzgeçler (bölüm/sınıf) sekmenin dışında duruyordu; tür ve kural gibi
 *      boyutlar hiç yoktu, kalabalık listede aranan çakışmaya inmek zordu.
 *
 * Yeni kabuk Dersler/Öğretim Üyeleri ile aynı (K-65/K-66): başlık + sayaç,
 * altında tek süzgeç çubuğu, altında TEK liste. Süzgeç boyutları:
 * şiddet · cohort (bölüm + sınıf + dönem) · tür · kural.
 * ================================================================== */

// "Filtre yok" sentinel'i: Mantine Select value'su null olamadığı için
// "hepsi" seçeneği listede görünür bir öğe olmak zorunda.
const ALL = "__all__";

type Sev = "ALL" | "HARD" | "WARNING";

/** Listedeki tek satır: çakışma + hangi kovadan geldiği.
 *
 *  Şiddet `ConflictResult.severity` içinde de var; yine de kovayı taşıyoruz,
 *  çünkü listeyi birleştiren şey KOVA ve satırın rengini tek bir gerçeğin
 *  belirlemesi, iki kaynağın gün gelip ayrışmasından iyidir. */
type Satir = { c: ConflictResult; hard: boolean };

export default function ConflictsPage() {
  const t = useT();
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
   *  kendi verisi hakkında yanıltır. */
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

  const suzgecVar = sev !== "ALL" || !!dep || !!year || !!sem || !!kind || !!rule;
  const temizle = () => {
    setSev("ALL"); setDep(null); setYear(null); setSem(null);
    setKind(null); setRule(null);
  };

  if (loading && !scan) return <Loader mt="xl" />;
  if (error) return <Alert color="red" mt="md">{error}</Alert>;

  return (
    <Stack gap="md">
      <Group align="baseline" gap="xs">
        <Title order={3}>{t.conflicts.title}</Title>
        <Text size="sm" c="dimmed">{t.conflicts.countLabel(hardSayi, uyariSayi)}</Text>
      </Group>

      {/* --- Süzgeç çubuğu: şiddet segmenti + cohort + tür + kural --- */}
      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" align="center" wrap="wrap">
          {/* Şiddet BİRİNCİL boyut, o yüzden segment: seçenekler ve sayıları
              aynı anda görünür ve "Tümü" de bir seçenek olarak durur —
              sekmede olmayan tam da buydu. */}
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

          <FilterSelect w={230} placeholder={t.conflicts.allDepartments}
            value={dep} onChange={setDep}
            data={departments.map((d) => ({
              value: String(d.id), label: `${d.code} — ${d.name}` }))} />

          <FilterSelect w={130} placeholder={t.conflicts.allYears}
            value={year} onChange={setYear}
            data={secenekler.years.map((y) => ({
              value: String(y), label: t.conflicts.yearN(y) }))} />

          <FilterSelect w={130} placeholder={t.conflicts.allSemesters}
            value={sem} onChange={setSem}
            data={secenekler.sems.map((s) => ({
              value: s, label: t.enums.semester[s as SemesterType] }))} />

          <FilterSelect w={160} placeholder={t.conflicts.allKinds}
            value={kind} onChange={setKind}
            data={[
              { value: "weekly_entry", label: t.conflicts.weeklyConflict },
              { value: "exam", label: t.conflicts.examConflict },
            ]} />

          <FilterSelect w={140} placeholder={t.conflicts.allRules}
            value={rule} onChange={setRule}
            data={secenekler.rules.map((r) => ({
              value: r, label: `${t.conflicts.rule} ${r}` }))} />

          {suzgecVar && (
            <Button variant="subtle" color="gray" size="sm"
              leftSection={<IconFilterOff size={15} />} onClick={temizle}>
              {t.conflicts.clearFilter}
            </Button>
          )}
        </Group>
      </Paper>

      <ConflictList list={list} hicYokMu={hepsi.length === 0} />
    </Stack>
  );
}

/** Süzgeç seçicilerinin ortak biçimi: "hepsi" seçeneği listenin BAŞINDA görünür
 *  bir öğe olarak durur — Mantine'in temizleme (×) ikonu fark edilmiyor. */
function FilterSelect({ w, placeholder, value, onChange, data }: {
  w: number; placeholder: string; value: string | null;
  onChange: (v: string | null) => void;
  data: { value: string; label: string }[];
}) {
  return (
    <Select
      w={w} size="sm" allowDeselect={false} comboboxProps={{ withinPortal: true }}
      data={[{ value: ALL, label: placeholder }, ...data]}
      value={value ?? ALL}
      onChange={(v) => onChange(v === ALL || v === null ? null : v)}
    />
  );
}

/** Tek liste — eskiden her çakışma bir KART'tı ve ekrana az kayıt sığıyordu.
 *  Satır biçimi Yayın Merkezi'nin değişiklik listesiyle aynı (tek Paper, satır
 *  araları çizgi): aynı işi yapan iki ekran aynı görünmeli. */
function ConflictList({ list, hicYokMu }: { list: Satir[]; hicYokMu: boolean }) {
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
      {list.map(({ c, hard }, i) => (
        <Group key={`${c.rule_id}-${i}`} gap="md" align="flex-start" wrap="nowrap"
          style={{
            padding: "10px 14px",
            borderTop: i ? `1px solid ${BORDER}` : undefined,
            // Sol kenar çubuğu, ızgaradaki çakışma belirtecinin AYNI dili
            // (K-80): kırmızı engel, turuncu uyarı. Aynı işaret her ekranda
            // aynı şeyi söylemeli.
            borderLeft: `3px solid var(--mantine-color-${hard ? "red" : "orange"}-6)`,
          }}>
          <Badge size="sm" variant="light" color={hard ? "red" : "orange"}
            style={{ flex: "none", minWidth: 42 }}>
            {c.rule_id}
          </Badge>

          <Text fz={13} lh={1.5} style={{ flex: 1, minWidth: 0 }}>{c.message}</Text>

          {/* Çakışan öğeler: tıklayınca ilgili programda vurgulanır (K-62). */}
          {c.affected.length > 0 && (
            <Group gap={6} justify="flex-end" wrap="wrap"
              style={{ flex: "none", maxWidth: "38%" }}>
              {c.affected.map((item, idx) => {
                const sinav = item.type === "exam";
                const yol = `${sinav ? "/exams" : "/weekly"}`
                  + `?highlight=${item.id}&rule=${c.rule_id}`;
                return (
                  <Button key={idx} component={Link} to={yol} size="compact-xs"
                    variant="light" color={sinav ? "violet" : "blue"}
                    rightSection={<IconArrowRight size={11} />}>
                    {item.course_code
                      ?? `${sinav ? t.conflicts.exam : t.conflicts.course} #${item.id}`}
                  </Button>
                );
              })}
            </Group>
          )}
        </Group>
      ))}
    </Paper>
  );
}
