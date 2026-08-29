import { useState } from "react";
import {
  ActionIcon, Badge, Button, Group, Popover, ScrollArea, Stack, Table, Text,
} from "@mantine/core";
import { IconHelp } from "@tabler/icons-react";
import type { ConflictAffectedRef, ConflictResult } from "../api/types";
import { RULE_CATALOG } from "../utils/conflictRules";
import { TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";

/* ==================================================================
 * K-84 · Program ekranlarındaki çakışma listesi — Rapor'la aynı dil
 *
 * Haftalık Program ve Sınavlar sayfaları çakışmaları kart yığını olarak
 * çiziyordu; Çakışma Raporu ise tablo (K-80/K-81). Aynı veri, iki ayrı görsel
 * dil: kullanıcı ekran değiştirince listeyi baştan okumayı öğreniyordu.
 *
 * Artık ikisi de TABLO ve zebra deseni ortak. Fark yalnızca GENİŞLİK: rapor
 * sayfası tüm sütunları taşır (tür, cohort/zaman), program ekranları kompakt
 * sürümü kullanır.
 *
 * Kompaktta düşen iki sütun ve neden düştükleri:
 *   - **Tür (şiddet).** Bilgi kaybolmuyor: satırın SOL KENAR çubuğu ve kural
 *     kodu rozetinin rengi zaten şiddeti söylüyor. Panelin başlığında da
 *     "N engel · N uyarı" sayaçları duruyor.
 *   - **Cohort / zaman.** Bu liste zaten EKRANDAKİ cohort'a ait; her satırda
 *     aynı cohort'u tekrar yazmak sütun genişliğini bilgi vermeden yerdi.
 *     Raporda kalıyor, çünkü orada liste bütün bölümleri kapsıyor.
 *
 * Etkilenen öğe düğmesinin davranışı sayfaya AİT (callback): haftalıkta satır
 * ekrandaysa yerinde vurgulanır, değilse gezinilir — ortak bileşen bunu
 * bilemez, bilmemeli de.
 * ================================================================== */

/** Şiddetin görsel dili. Rapor sayfasındaki tabloyla AYNI değerler; ikisinin
 *  ayrışmaması için tek yerde durur. */
export const SEV_OUTLINE = { hard: "red.5", warn: "orange.4" };

/** Vurgu (blink) stilleri — ızgaradaki yanıp sönmeyle eş zamanlı.
 *
 *  Animasyon `tr`ye değil `td`ye veriliyor: zebra tonu Mantine'de satırın
 *  (`tr`) zeminidir ve hücre zemini onun ÜSTÜNDE çizilir. Hücreyi boyamak,
 *  vurgunun çizgili satırlarda da tam güçle görünmesini garanti eder. */
const BLINK_CSS = `
@keyframes clBlinkRed {
  0%   { background-color: rgba(239, 68, 68, 0.35); }
  50%  { background-color: rgba(239, 68, 68, 0.05); }
  100% { background-color: rgba(239, 68, 68, 0.35); }
}
@keyframes clBlinkYellow {
  0%   { background-color: rgba(245, 158, 11, 0.35); }
  50%  { background-color: rgba(245, 158, 11, 0.05); }
  100% { background-color: rgba(245, 158, 11, 0.35); }
}
.cl-row[data-blink="hard"] td { animation: clBlinkRed 0.8s ease-in-out infinite; }
.cl-row[data-blink="warn"] td { animation: clBlinkYellow 0.8s ease-in-out infinite; }
`;

/** Kural kodları kataloğu — "Kural" sütun başlığındaki "?" (K-81).
 *
 *  Rapor sayfasıyla ORTAK (K-84): kod listesi ikisinde de aynı soruya cevap
 *  veriyor ("W3 neydi?") ve iki kopyanın ayrışması, aynı kuralı iki ekranda
 *  iki türlü anlatmak olurdu.
 *
 *  Pop-up yalnız TIKLAYINCA açılıyordu ve "?" ikonunun tıklanabilir olduğu
 *  belli değildi — üstüne gelmek en doğal keşif hareketi.
 *
 *  Neden `HoverCard` değil: o yalnız hover'la çalışır, tık ile SABİTLEME olmaz.
 *  Katalog 22 satır ve kaydırılabilir; fare listeye inerken hedeften çıkıp
 *  pop-up'ı kapatabilir. Bu yüzden kontrollü `Popover`: hover açar, tık
 *  SABİTLER (`sabit`), sabitken hover'dan çıkmak kapatmaz.
 *
 *  `onMouseLeave` hem hedefte hem açılır kutuda: ikisinin arasındaki boşlukta
 *  kapanmasın diye açılır kutu da hover'ı canlı tutuyor. */
export function RuleHelp() {
  const t = useT();
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

export function ConflictList({ list, emptyText, blinking, onAffected }: {
  list: ConflictResult[];
  /** Hiç çakışma yokken yazılacak cümle — sayfanın kendi sözlüğünden gelir. */
  emptyText: string;
  /** Bu satır şu an vurgulanıyor mu (ızgaradaki yanıp sönmeyle eş zamanlı). */
  blinking?: (c: ConflictResult) => boolean;
  onAffected: (c: ConflictResult, a: ConflictAffectedRef) => void;
}) {
  const t = useT();

  if (list.length === 0) return <Text size="sm" c="dimmed">{emptyText}</Text>;

  return (
    <>
      <style>{BLINK_CSS}</style>
      {/* Sabit sütunlar 92 + 190 + 150 = 432; Açıklama'ya en az ~270 → 700.
          Altına inince sıkışma yerine kaydırma olur (Rapor'daki desen). */}
      <Table.ScrollContainer minWidth={700}>
        <Table striped verticalSpacing={6} horizontalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {/* Rapor sayfasındaki başlıkla aynı: kod sütununun sağında
                  katalog "?"si. 74 → 92, ikon başlığı sarmasın. */}
              <Table.Th w={92}>
                <Group gap={5} wrap="nowrap">
                  {t.conflicts.colRule}
                  <RuleHelp />
                </Group>
              </Table.Th>
              <Table.Th w={190}>{t.conflicts.colConflict}</Table.Th>
              <Table.Th>{t.conflicts.colDesc}</Table.Th>
              <Table.Th w={150}>{t.conflicts.colItems}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((c, i) => {
              const hard = c.severity === "HARD";
              const yaniyor = blinking?.(c) ?? false;
              return (
                <Table.Tr key={`${c.rule_id}-${i}`} className="cl-row"
                  data-blink={yaniyor ? (hard ? "hard" : "warn") : undefined}
                  style={{
                    // Şiddet, Tür sütunu olmadan da okunur: sol kenar çubuğu
                    // ızgaradaki çakışma belirtecinin aynı dili (K-80/K-81).
                    borderLeft: `3px solid var(--mantine-color-${hard ? "red-7" : "orange-6"})`,
                  }}>
                  <Table.Td>
                    <Badge size="sm" variant="outline"
                      color={hard ? SEV_OUTLINE.hard : SEV_OUTLINE.warn}>
                      {c.rule_id}
                    </Badge>
                  </Table.Td>
                  {/* Kural ADI — birincil, koyu. Sözlükte karşılığı yoksa
                      motorun cümlesine düşülür (yeni kural eklendiğinde satır
                      boş kalmasın). */}
                  <Table.Td>
                    <Text fz={13} fw={yaniyor ? 700 : 500} lh={1.4}>
                      {t.conflicts.ruleNames[c.rule_id] ?? c.message}
                    </Text>
                  </Table.Td>
                  {/* Açıklama — motorun ürettiği tam cümle, İKİNCİL (soluk).
                      Mesajı UI kurmuyor, motor kuruyor (kontrat §0). */}
                  <Table.Td>
                    <Text fz={12.5} c={TEXT_MUTED} lh={1.4}>{c.message}</Text>
                  </Table.Td>
                  {/* Etkilenen tarafların HEPSİ düğme olur. Renk nereye
                      gidildiğini söyler: mor = sınav, mavi = haftalık ders.
                      Nereye gideceğine sayfa karar verir (`onAffected`). */}
                  <Table.Td>
                    <Stack gap={4}>
                      {c.affected.map((a, ix) => (
                        <Group key={ix} gap={0} wrap="nowrap">
                          <Button size="compact-xs" variant="light"
                            color={a.type === "exam" ? "violet" : "blue"}
                            onClick={() => onAffected(c, a)}>
                            {a.course_code ?? `#${a.id}`}
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  );
}
