import { Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import type { ConflictAffectedRef, ConflictResult } from "../api/types";
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
      {/* Sabit sütunlar 74 + 190 + 150 = 414; Açıklama'ya en az ~270 → 690.
          Altına inince sıkışma yerine kaydırma olur (Rapor'daki desen). */}
      <Table.ScrollContainer minWidth={690}>
        <Table striped verticalSpacing={6} horizontalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={74}>{t.conflicts.colRule}</Table.Th>
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
