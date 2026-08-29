import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import type { ConflictScan } from "../api/types";
import type { RuleFamily } from "../utils/conflictRules";
import { ruleFamily, ruleOrder } from "../utils/conflictRules";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";

const KOLLAR: RuleFamily[] = ["W", "E", "X"];

type Satir = { rule: string; count: number; hard: boolean };

/** Ana sayfanın "kural bazında çakışma dağılımı" bloğu (K-82).
 *
 *  **Neden ham çakışma satırı değil:** eski dashboard ilk beş çakışmayı
 *  olduğu gibi listeliyordu. O liste ne bütünü anlatıyordu (yüzlercesi
 *  arasından beşi) ne de bir iş görüyordu. Kural dağılımı "asıl derdin W8, beş
 *  vuruş" der ve satır tıklanınca Çakışma Raporu'nu o kuralla süzülmüş açar.
 *
 *  **Yeni uç gerektirmez:** `/conflicts` zaten her çakışmada `rule_id` ve
 *  `severity` taşıyor; gruplama istemcide. Kural adları sözlükten
 *  (`t.conflicts.ruleNames`), kol ise kodun ilk harfinden — motorun kendi
 *  ayrımı, uydurma bir sınıflandırma değil.
 */
export default function RuleBreakdown({ scan }: { scan: ConflictScan }) {
  const t = useT();

  /** Kol → o kolun kural satırları (çok vurandan aza). */
  const kollar = useMemo(() => {
    const kova: Record<RuleFamily, Map<string, Satir>> = { W: new Map(), E: new Map(), X: new Map() };
    const ekle = (rule: string, hard: boolean) => {
      const kol = ruleFamily(rule);
      if (!kol) return;               // tanınmayan kod: yanlış kola koymaktansa gösterme
      const m = kova[kol];
      const v = m.get(rule);
      if (v) v.count += 1;
      else m.set(rule, { rule, count: 1, hard });
    };
    scan.hard.forEach((c) => ekle(c.rule_id, true));
    scan.warnings.forEach((c) => ekle(c.rule_id, false));

    return Object.fromEntries(KOLLAR.map((k) => [
      k,
      [...kova[k].values()].sort((a, b) =>
        // Önce ENGELLER (yayını durduran iş üstte), sonra çok vuran, sonra
        // katalog sırası — eşitlikte sıra rastgele olmasın.
        Number(b.hard) - Number(a.hard)
        || b.count - a.count
        || ruleOrder(a.rule) - ruleOrder(b.rule)),
    ])) as Record<RuleFamily, Satir[]>;
  }, [scan]);

  const toplam = (k: RuleFamily) => kollar[k].reduce((a, r) => a + r.count, 0);

  // Açılış kolu: çakışması OLAN ilk kol. Boş bir sekmeyle karşılaşmak
  // "çakışma yok" sanısı yaratırdı — oysa yandaki kolda beş tane olabilir.
  const [kol, setKol] = useState<RuleFamily | null>(null);
  const acik = kol ?? KOLLAR.find((k) => kollar[k].length > 0) ?? "W";

  const hicYok = KOLLAR.every((k) => kollar[k].length === 0);
  const satirlar = kollar[acik];
  const enBuyuk = Math.max(1, ...satirlar.map((r) => r.count));

  const etiket: Record<RuleFamily, string> = {
    W: t.home.rules.tabWeekly, E: t.home.rules.tabExam, X: t.home.rules.tabCross,
  };
  return (
    <Paper withBorder radius="md" p="lg" bg={PAGE_SURFACE} style={{ borderColor: BORDER }}>
      {/* Sekmeler başlığın ALTINDA değil SAĞ ÜSTTE: kartın en dar kaynağı
          dikey yer ve sekme şeridi tek başına bir satır yiyordu. Buradaki
          "Çakışma Raporu" linki de kalktı — her satır zaten oraya, üstelik
          kendi kuralıyla süzülmüş olarak gidiyor. */}
      <Group justify="space-between" align="center" mb="md" gap="sm" wrap="wrap">
        <Text fz={14} fw={700}>{t.home.rules.title}</Text>
        {!hicYok && (
          <Group gap={6}>
            {KOLLAR.map((k) => {
              const secili = k === acik;
              return (
                <Button key={k} size="compact-sm" radius="xl"
                  variant={secili ? "filled" : "default"}
                  onClick={() => setKol(k)}>
                  <Group gap={6} wrap="nowrap">
                    <Text span fz={12} fw={600}>{etiket[k]}</Text>
                    <Text span fz={12} opacity={0.75}
                      style={{ fontVariantNumeric: "tabular-nums" }}>
                      {toplam(k)}
                    </Text>
                  </Group>
                </Button>
              );
            })}
          </Group>
        )}
      </Group>

      {hicYok ? (
        <Text fz={13} c={TEXT_MUTED}>{t.home.rules.allClear}</Text>
      ) : (
        <>
          {satirlar.length === 0 ? (
            <Text fz={13} c={TEXT_MUTED}>{t.home.rules.none}</Text>
          ) : (
            <Stack gap={2}>
              {satirlar.map((r) => (
                <KuralSatiri key={r.rule} satir={r} enBuyuk={enBuyuk} />
              ))}
            </Stack>
          )}
        </>
      )}
    </Paper>
  );
}

/** Tek kural satırı: kod · ad · oran çubuğu · sayı.
 *
 *  Çubuğun genişliği o koldaki EN BÜYÜK sayıya göre — mutlak bir tavana göre
 *  değil. Amaç "ne kadar çok" değil "hangisi baskın": üç çakışmalı bir
 *  taramada da en büyüğü tam dolu görünmeli ki göz sıralamayı hemen okusun.
 */
function KuralSatiri({ satir, enBuyuk }: { satir: Satir; enBuyuk: number }) {
  const t = useT();
  const renk = satir.hard ? "red" : "orange";
  return (
    // Mantine'in `Group`'u polimorfik tipte `to` taşımıyor; sarmalayıcı
    // doğrudan <Link> ve düzeni Group veriyor.
    <Link to={`/conflicts?rule=${satir.rule}`} className="rule-row"
      style={{ display: "block", borderRadius: 6, textDecoration: "none", color: "inherit" }}>
      <Group gap={10} wrap="nowrap" px={8} py={6}>
        <Badge size="sm" variant="outline" color={satir.hard ? "red.5" : "orange.4"}
          style={{ flex: "none", minWidth: 46 }}>
          {satir.rule}
        </Badge>

        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <Text fz={13} truncate>{t.conflicts.ruleNames[satir.rule] ?? satir.rule}</Text>
          <div style={{
            height: 5, borderRadius: 3, marginTop: 5, overflow: "hidden",
            background: "var(--mantine-color-default-border)",
          }}>
            <div style={{
              height: 5,
              width: `${Math.round((satir.count / enBuyuk) * 100)}%`,
              background: `var(--mantine-color-${renk}-6)`,
            }} />
          </div>
        </div>

        <Text fz={15} fw={700} c={renk} style={{ flex: "none", fontVariantNumeric: "tabular-nums" }}>
          {satir.count}
        </Text>
        <IconChevronRight size={14} style={{ flex: "none", opacity: 0.45 }} />
      </Group>
    </Link>
  );
}
