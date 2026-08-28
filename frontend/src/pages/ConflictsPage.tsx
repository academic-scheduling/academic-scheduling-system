import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Paper, Popover, ScrollArea,
  SegmentedControl, Select, Stack, Table, Text, Title,
} from "@mantine/core";
import {
  IconArrowRight, IconChecks, IconFilter, IconFilterOff, IconHelp,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import type {
  ConflictAffectedRef, ConflictResult, ConflictScan, Department, SemesterType,
} from "../api/types";
import { formatSlotRange } from "../utils/slots";
import { TEXT_MUTED } from "../utils/scheduleTheme";
import type { RuleFamily } from "../utils/conflictRules";
import { RULE_CATALOG, ruleFamily } from "../utils/conflictRules";
import { SEV_OUTLINE } from "../components/ConflictList";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/* ==================================================================
 * K-80 · Çakışma Raporu — öteki ekranlarla aynı kabuk
 *
 * Eskiden HARD ve WARNING iki ayrı SEKMEYDİ ve her biri kart yığını çiziyordu.
 * Sekme "ya o ya bu" der; oysa şiddet bir FİLTRE boyutudur ve "hepsini birden
 * gör" en doğal istektir — sekmede o seçenek yoktu.
 *
 * Şimdi Dersler/Derslikler ile aynı kabuk: başlık, tek filtre çubuğu (şiddet
 * segmenti + "Filtrele" popover'ı), altında TABLO. Tablo çünkü her çakışmanın
 * aynı beş sorusu var — hangi tür, hangi kural, ne oldu, hangi cohort/ne zaman,
 * hangi öğeler — ve sütun başlığı bu soruları bir kez sorup satırları
 * karşılaştırılabilir kılıyor.
 * ================================================================== */

// "Filtre yok" sentinel'i: Mantine Select value'su null olamadığı için
// "hepsi" seçeneği listede görünür bir öğe olmak zorunda.
const ALL = "__all__";

type Sev = "ALL" | "HARD" | "WARNING";

/** K-82: üst segmentin boyutu. Şiddet (engel/uyarı) buradan popover'a indi.
 *
 *  Gerekçe: kullanıcı rapora "haftalık programımda ne var" ya da "sınavlarda
 *  ne var" diye giriyor — şiddet o soruyu daralt­mıyor, ikisini de kapsıyor.
 *  Ayrıca ana sayfadaki dağılım bloğu da aynı üç kolu kullanıyor; iki ekranın
 *  aynı şeyi farklı eksende bölmesi, aynı listeye iki ayrı zihin haritası
 *  gerektiriyordu. */
type Family = "ALL" | RuleFamily;

/** Şiddetin görsel dili — tek yerde, çünkü dört ayrı yerde çiziliyor
 *  (Tür rozeti, kural rozeti, satırın sol kenarı, kural kataloğu).
 *
 *  K-81: engel ile uyarı ayırt edilemiyordu. Sebep ton seçimi değil, VARYANT:
 *  `light` rozetin yazı rengi karanlık temada `--mantine-color-red-light-color`
 *  = #ffa8a8 (pembe) ve `orange-light-color` = #ffc078 (şeftali) — ikisi de
 *  aynı açıklıkta pastel, yan yana gelince ayrılmıyorlar.
 *
 *  Çözüm daha koyu bir kırmızı DEĞİL (pastelin yanında koyu kırmızı bu kez
 *  okunmuyor), varyantı değiştirmek: engel DOLGU (beyaz yazı, kırmızı zemin),
 *  uyarı açık ton. Fark artık ton farkı değil BİÇİM farkı — renk körlüğünde de,
 *  gri baskıda da ayrılıyor. Engel zaten "durdurucu", daha yüksek sesle
 *  konuşması semantik olarak da doğru. */
const SEV_BADGE = {
  hard: { color: "red.8", variant: "filled" as const },
  warn: { color: "orange", variant: "light" as const },
};
/* Kural KODU rozetinin çerçeve tonu (`SEV_OUTLINE`) ORTAK bileşenden geliyor:
   program ekranlarındaki kompakt liste de aynı rozeti çiziyor (K-84) ve iki
   kopyanın gün gelip ayrışması, aynı kuralı iki ekranda iki renkte gösterirdi.

   Neden çerçeve: bir tur dolgulu denendi (Tür rozetiyle aynı biçim) ama aynı
   satırda iki dolu kırmızı blok fazla ağır durdu — satırın ilk bakışta
   okunması gereken şey ŞİDDET, kod ise ikincil. */

/** Cohort ve "Çakışan öğeler" sütunlarının satır ölçüsü. İki sütun da AYNI
 *  sayıyı kullanmak zorunda — hizanın tek dayanağı bu. */
const SATIR_Y = 26;
const SATIR_ARA = 4;

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

  // Bölüm/sınıf filtresi Bölümler sayacından ?department_id= ile önceden gelebilir.
  const [searchParams, setSearchParams] = useSearchParams();
  const [family, setFamily] = useState<Family>("ALL");
  const [sev, setSev] = useState<Sev>("ALL");
  const [dep, setDep] = useState<string | null>(searchParams.get("department_id"));
  const [year, setYear] = useState<string | null>(searchParams.get("year"));
  const [sem, setSem] = useState<string | null>(null);
  // K-82: ana sayfadaki dağılım bloğu `?rule=W3` ile buraya geliyor. Parametre
  // OKUNMUYORDU — bağlantı çalışıyor görünüp filtresiz liste açıyordu.
  const [rule, setRule] = useState<string | null>(searchParams.get("rule"));

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
    if (!searchParams.has("department_id") && !searchParams.has("year")
      && !searchParams.has("rule")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("department_id");
    next.delete("year");
    next.delete("rule");
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

  /** Filtreleme: bir çakışma, ETKİLENEN ÖĞELERİNDEN HERHANGİ biri ölçüte uyuyorsa
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
    if (family !== "ALL" && ruleFamily(c.rule_id) !== family) return false;
    return true;
  }), [hepsi, sev, rule, dep, year, sem, family]);

  const hardSayi = hepsi.filter((s) => s.hard).length;
  const uyariSayi = hepsi.length - hardSayi;

  /** Segmentin üzerindeki sayılar: her kolda kaç çakışma var. Diğer filtreler
   *  UYGULANMADAN sayılır — segment "nereye gidebilirim"i gösterir, seçili
   *  filtrenin sonucunu değil. */
  const kolSayisi = useMemo(() => {
    const k: Record<RuleFamily, number> = { W: 0, E: 0, X: 0 };
    for (const { c } of hepsi) {
      const f = ruleFamily(c.rule_id);
      if (f) k[f] += 1;
    }
    return k;
  }, [hepsi]);

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

  /** KOL bilerek dışarıda: o bir segment, kendi durumu zaten görünür ve
   *  "Tümü"ye dönmek tek tık. Sayaç ve "temizle" yalnız POPOVER içindeki
   *  filtreleri anlatır — yoksa segmentten birini seçmek ekrana ilgisiz bir
   *  temizleme butonu düşürüyordu. Şiddet K-82'de popover'a indiği için
   *  artık sayaca DAHİL. */
  const acikFiltre = [dep, year, sem, rule].filter(Boolean).length
    + (sev === "ALL" ? 0 : 1);
  const temizle = () => {
    setDep(null); setYear(null); setSem(null); setRule(null); setSev("ALL");
  };

  if (loading && !scan) return <Loader mt="xl" />;
  if (error) return <Alert color="red" mt="md">{error}</Alert>;

  return (
    <Stack gap="md">
      {/* K-80: başlıkta sayaç YOK — sayılar segmentin üzerinde zaten yazıyor. */}
      <Title order={3}>{t.conflicts.title}</Title>

      <Paper withBorder p="xs" radius="md">
        <Group gap="sm" align="center" wrap="wrap">
          {/* KOL birincil boyut, o yüzden popover'da değil dışarıda:
              seçenekler ve sayıları aynı anda görünür. */}
          <SegmentedControl
            value={family}
            onChange={(v: string) => setFamily(v as Family)}
            data={[
              { value: "ALL", label: `${t.common.all} (${hepsi.length})` },
              { value: "W", label: `${t.conflicts.familyWeekly} (${kolSayisi.W})` },
              { value: "E", label: `${t.conflicts.familyExam} (${kolSayisi.E})` },
              { value: "X", label: `${t.conflicts.familyCross} (${kolSayisi.X})` },
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
                {acikFiltre > 0 && (
                  <Badge size="sm" circle ml={6} variant="filled">{acikFiltre}</Badge>
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
                  {/* K-82: eski "Tür" (haftalık/sınav ÖĞESİ) filtresi kalktı —
                      üstteki kol segmenti aynı soruyu daha kesin cevaplıyordu
                      ve iki kontrolün ikisi de "ders programı / sınav" diyordu.
                      Yerine, segmentten inen ŞİDDET. */}
                  <FilterSelect label={t.conflicts.severity}
                    placeholder={t.conflicts.allSeverities}
                    value={sev === "ALL" ? null : sev}
                    onChange={(v) => setSev((v ?? "ALL") as Sev)}
                    data={[
                      { value: "HARD", label: `${t.conflicts.blocking} (${hardSayi})` },
                      { value: "WARNING", label: `${t.conflicts.warning} (${uyariSayi})` },
                    ]} />
                </Group>
                <FilterSelect label={t.conflicts.colRule}
                  placeholder={t.conflicts.allRules}
                  value={rule} onChange={setRule}
                  data={secenekler.rules.map((r) => ({
                    value: r, label: `${t.conflicts.rule} ${r}` }))} />
                {acikFiltre > 0 && (
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

/** Kural sözlüğü — "Kural" sütun başlığının yanındaki "?" (K-80).
 *
 *  Tabloda artık kural KODU (W4) ve ADI görünüyor; kodun ne demek olduğunu
 *  öğrenmenin yolu ise dokümana gitmekti. Yirmi iki kuralın tamamı burada, tek
 *  bakışta: kod · ad · bir cümlelik koşul.
 *
 *  K-82: listenin kendisi `utils/conflictRules` içine taşındı — ana sayfadaki
 *  "kural bazında dağılım" bloğu da aynı katalogdan okuyor. İki kopya olsaydı
 *  yeni bir kural birine yazılıp ötekinde unutulabilirdi.
 */
function RuleHelp() {
  const t = useT();
  /** K-81: pop-up yalnız TIKLAYINCA açılıyordu ve "?" ikonunun tıklanabilir
   *  olduğu belli değildi — üstüne gelmek en doğal keşif hareketi.
   *
   *  Neden `HoverCard` değil: o yalnız hover'la çalışır, tık ile SABİTLEME
   *  olmaz. Katalog 22 satır ve kaydırılabilir; fare listeye inerken hedeften
   *  çıkıp pop-up'ı kapatabilir. Bu yüzden kontrollü `Popover`: hover açar,
   *  tık SABİTLER (`sabit`), sabitken hover'dan çıkmak kapatmaz.
   *
   *  `onMouseLeave` hem hedefte hem açılır kutuda: ikisinin arasındaki
   *  boşlukta kapanmasın diye açılır kutu da hover'ı canlı tutuyor. */
  const [acik, setAcik] = useState(false);
  const [sabit, setSabit] = useState(false);
  const kapat = () => { if (!sabit) setAcik(false); };
  return (
    <Popover width={520} position="bottom-start" shadow="md" withArrow
      opened={acik}
      onChange={(o) => { setAcik(o); if (!o) setSabit(false); }}>
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size="xs" radius="xl"
          aria-label={t.conflicts.ruleHelpHint}
          onMouseEnter={() => setAcik(true)}
          onMouseLeave={kapat}
          onClick={() => { setSabit((v) => !v); setAcik(true); }}>
          <IconHelp size={14} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown onMouseEnter={() => setAcik(true)} onMouseLeave={kapat}>
        <Text fz={12} fw={700} c={TEXT_MUTED} mb={8}>
          {t.conflicts.ruleHelpTitle}
        </Text>
        <ScrollArea.Autosize mah={380} type="hover">
          <Stack gap={7}>
            {RULE_CATALOG.map(({ kod, hard }) => (
              <Group key={kod} gap={9} align="flex-start" wrap="nowrap">
                {/* K-81: kod rozeti ŞİDDETİ renkle söyler — kırmızı engel,
                    turuncu uyarı. Katalogda hepsi griyken "hangileri yayını
                    durdurur" sorusunun cevabı ancak açıklama cümlesini tek tek
                    okuyarak çıkıyordu; oysa liste tam da göz gezdirmek için var.
                    Renk, tablodaki satır rengiyle AYNI dil (K-80). */}
                <Badge size="sm" variant="outline"
                  color={hard ? SEV_OUTLINE.hard : SEV_OUTLINE.warn}
                  style={{ flex: "none", minWidth: 42 }}>{kod}</Badge>
                <div style={{ minWidth: 0 }}>
                  <Text fz={12.5} fw={500} lh={1.35}>
                    {t.conflicts.ruleNames[kod]}
                  </Text>
                  <Text fz={11.5} c={TEXT_MUTED} lh={1.4}>
                    {t.conflicts.ruleHelp[kod]}
                  </Text>
                </div>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
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
    // İki ayrı boşluk, iki ayrı anlam — ve K-81'de ikisi ayrı ayrı ele alındı.
    //
    // Gerçekten çakışma YOK: bu bir HABER, hem de iyi haber. Söylenmeli.
    //
    // Filtre sonuçsuz kaldı: bu haber değil, kullanıcının az önce kendi
    // yaptığı seçimin sonucu. "Bu filtreye uyan çakışma yok" cümlesi, üstteki
    // segmentte zaten "Engel (0)" yazarken aynı şeyi ikinci kez söylüyordu.
    // Sayacı okuyan zaten biliyor; bilmeyene de cümle bir şey öğretmiyor.
    // Bu yüzden hiçbir şey çizmiyoruz: boş bir çerçevenin içine boş bir metin
    // koymaktansa çerçeveyi de çizmemek dürüst — ekranda filtre çubuğu kalır.
    if (!hicYokMu) return null;
    return (
      <Paper withBorder radius="md" p="lg">
        <Group gap={9}>
          <IconChecks size={18} color="var(--mantine-color-green-6)" />
          <Text size="sm" c="green.7">{t.conflicts.emptyAll}</Text>
        </Group>
      </Paper>
    );
  }

  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {/* K-81: minWidth sütun toplamıyla tutarlı olmalı, yoksa dar ekranda
          kaydırma yerine sıkışma olur ve kapattığımız sarma geri gelir.
          Toplam sabit sütunlar: Tür 92 + Kural 104 + Çakışma 210 + Cohort 300
          + Öğeler 170 = 876; Açıklama'ya en az ~300 → 1180. */}
      <Table.ScrollContainer minWidth={1180}>
        {/* K-81: `striped` — Dersler/Derslikler/Öğretim Üyeleri ile aynı zebra
            tonu (Mantine varsayılanı, özel renk yok). Satırların sol kenar
            çubuğu (kırmızı/turuncu) zebranın üstünde durur; ikisi farklı eksen
            (kenar = şiddet, zebra = okuma kolaylığı), çakışmaz. */}
        <Table striped verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={92}>{t.conflicts.colKind}</Table.Th>
              <Table.Th w={104}>
                <Group gap={5} wrap="nowrap">
                  {t.conflicts.colRule}
                  <RuleHelp />
                </Group>
              </Table.Th>
              {/* K-81 eki: Çakışma (kural adı) sabit genişliğe alındı ki yeni
                  Açıklama sütunu esneyebilsin — mesaj bir cümle, sarabildiği
                  kadar geniş yer ona verilsin. */}
              <Table.Th w={210}>{t.conflicts.colConflict}</Table.Th>
              <Table.Th>{t.conflicts.colDesc}</Table.Th>
              {/* K-81: 230 → 300. İçerik ("CENG · 3. Sınıf · Bahar · Per 09:30
                  - 12:15") 230'a sığmayıp saati alt satıra atıyordu; sarma,
                  tek bir bilgiyi iki parçaya bölüp satır yüksekliğini de
                  düzensizleştiriyordu. Genişlik tahmin değil: parçaların hepsi
                  sınırlı (bölüm KODU, "N. Sınıf", dönem, gün+saat). */}
              <Table.Th w={300}>{t.conflicts.colCohort}</Table.Th>
              <Table.Th w={170}>{t.conflicts.colItems}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map(({ c, hard }, i) => (
                <Table.Tr key={`${c.rule_id}-${i}`}
                  style={{
                    // Sol kenar çubuğu, ızgaradaki çakışma belirtecinin AYNI
                    // dili (K-80): kırmızı engel, turuncu uyarı.
                    // K-81: engel tarafı red-6 (#fa5252) yerine red-7 (#f03e3e)
                    // — turuncunun yanında daha az pembeye kaçıyor.
                    borderLeft: `3px solid var(--mantine-color-${hard ? "red-7" : "orange-6"})`,
                  }}>
                  {/* TÜR = ŞİDDET. Haftalık/sınav ayrımı burada DEĞİL: kural
                      kodu (W/E/X) ve öğe rozetlerinin rengi zaten söylüyor. */}
                  <Table.Td>
                    <Badge size="sm" {...(hard ? SEV_BADGE.hard : SEV_BADGE.warn)}>
                      {hard ? t.conflicts.blocking : t.conflicts.warning}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="outline"
                      color={hard ? SEV_OUTLINE.hard : SEV_OUTLINE.warn}>
                      {c.rule_id}
                    </Badge>
                  </Table.Td>
                  {/* Kural ADI — birincil, koyu. K-81 eki: mesaj artık kendi
                      "Açıklama" sütununda GÖRÜNÜR, o yüzden ipucu (tooltip)
                      kaldırıldı; aynı metnin iki yolla (hover + sütun) verilmesi
                      gereksizdi ve "cursor: help" hangi hücrede ipucu var diye
                      yanıltıyordu. */}
                  <Table.Td>
                    <Text fz={13} fw={500} lh={1.45}>
                      {t.conflicts.ruleNames[c.rule_id] ?? c.message}
                    </Text>
                  </Table.Td>
                  {/* Açıklama — motorun ürettiği tam cümle, İKİNCİL (soluk).
                      Ad "ne tür sorun" der; açıklama "tam olarak ne oldu" (hangi
                      dersler, hangi saat, kapasite sayısı gibi ayrıntı). Cümle
                      olduğu için sarması doğal — nowrap YOK. */}
                  <Table.Td>
                    <Text fz={12.5} c={TEXT_MUTED} lh={1.45}>{c.message}</Text>
                  </Table.Td>
                  {/* K-81 · Cohort ve Çakışan öğeler ARTIK HİZALI.
                      Önceden cohort satırları tekilleştiriliyordu ("iki taraf
                      aynı cohort ve saatteyse tekrar bilgi katmaz") ve öğeler
                      yan yana diziliyordu. Sonuç: iki öğe, tek cohort satırı —
                      hangi öğenin hangi cohort'a ait olduğu okunamıyordu.

                      Artık iki sütun da `c.affected`i AYNI SIRAYLA, öğe başına
                      bir satır olarak yazıyor; i'inci cohort i'inci öğenin.
                      Tekrar eden cohort'lar da yazılıyor — burada tekrar
                      gürültü değil, HİZANIN kendisi. Sabit satır yüksekliği
                      (SATIR_Y) şart: solda 12.5px metin, sağda compact-xs
                      düğme var, doğal yükseklikleri farklı; eşitlenmezse
                      listeler birkaç öğeden sonra kayıyor. */}
                  <Table.Td>
                    <Stack gap={SATIR_ARA}>
                      {c.affected.map((a, ix) => {
                        const cohort = cohortEtiketi(a, depAdi, t);
                        const zaman = zamanEtiketi(a, t);
                        const satir = [cohort, zaman].filter(Boolean).join(" · ");
                        return (
                          <Group key={ix} h={SATIR_Y} align="center" gap={0} wrap="nowrap">
                            {/* K-80: soluk DEĞİL — cohort "bu beni ilgilendiriyor
                                mu" sorusunun cevabı, listede en çok bakılan yer.
                                Boşsa tire: satır düşerse hiza da düşer. */}
                            <Text fz={12.5} fw={500} lh={1.2}
                              style={{ whiteSpace: "nowrap" }}>{satir || "—"}</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    {/* Tıklayınca ilgili programda vurgulanır (K-62). */}
                    <Stack gap={SATIR_ARA}>
                      {c.affected.map((a, ix) => {
                        const oSinav = a.type === "exam";   // rozet rengi türü söyler
                        const yol = `${oSinav ? "/exams" : "/weekly"}`
                          + `?highlight=${a.id}&rule=${c.rule_id}`;
                        return (
                          <Group key={ix} h={SATIR_Y} align="center" gap={0} wrap="nowrap">
                            <Button component={Link} to={yol} size="compact-xs"
                              variant="light" color={oSinav ? "violet" : "blue"}
                              rightSection={<IconArrowRight size={11} />}>
                              {a.course_code
                                ?? `${oSinav ? t.conflicts.exam : t.conflicts.course} #${a.id}`}
                            </Button>
                          </Group>
                        );
                      })}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
