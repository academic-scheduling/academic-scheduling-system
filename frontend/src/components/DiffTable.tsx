import { Badge, ScrollArea, Table, Text } from "@mantine/core";
import { DIFF_KIND_COLORS, DIFF_KIND_LABELS, EXAM_TYPE_LABELS } from "../api/types";
import type {
  DraftDiffItem, DraftExamPlacement, DraftPlacement,
} from "../api/types";
import { DAY_SHORT } from "../utils/slots";

/** Haftalık yerleşimin okunur konumu: "Çar 5 · A Blok 101". */
export function placementText(p: DraftPlacement | null): string {
  if (!p) return "—";
  const gun = DAY_SHORT[p.day_of_week] ?? String(p.day_of_week);
  const bitis = p.slot_count > 1 ? `-${p.start_slot + p.slot_count - 1}` : "";
  return `${gun} ${p.start_slot}${bitis}${p.classroom_label ? ` · ${p.classroom_label}` : ""}`;
}

const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
            "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Sınav yerleşiminin okunur konumu: "15 Eyl 09:00 (90 dk) · B Blok 202". */
export function examPlacementText(p: DraftExamPlacement | null): string {
  if (!p) return "—";
  const [, a, g] = p.exam_date.split("-").map(Number);
  const saat = p.start_time.slice(0, 5);
  return `${g} ${AY[a - 1] ?? a} ${saat} (${p.duration_minutes} dk)`
    + (p.classroom_label ? ` · ${p.classroom_label}` : "");
}

/** Farkın gösterimi — "sonucun neresi farklı" (K-59/K-60).
 *
 *  TEK bileşen, ÜÇ tüketici: taslak sahibinin "Farkı Gör"ü, onaylayıcının
 *  inceleme ekranı ve onay sonrası "yayına ne geçti" listesi. Ayrı çizilselerdi
 *  onaylayanın gördüğü ile gönderenin gördüğü zamanla ayrışırdı.
 *
 *  K-60: iki tür satır taşır. Ortak olan KABUK (rozet, ders sütunu, ortak ders
 *  uyarısı, önce/sonra); ayrışan tek şey kimliğin ve yerleşimin METNİ — o da
 *  `entity`ye bakan iki küçük metinleştiriciyle çözülür. İki ayrı tablo yazmak
 *  aynı ayrışma riskini geri getirirdi.
 */
export default function DiffTable({ items, maxHeight = 460 }: {
  items: DraftDiffItem[];
  maxHeight?: number;
}) {
  if (items.length === 0) {
    return <Text size="sm" c="dimmed">Taslak yayındaki programla birebir aynı.</Text>;
  }
  return (
    <ScrollArea.Autosize mah={maxHeight}>
      <Table striped highlightOnHover verticalSpacing={6} fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={104}>Değişim</Table.Th>
            <Table.Th>Ders</Table.Th>
            <Table.Th>Önce</Table.Th>
            <Table.Th>Sonra</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((i, ix) => {
            const sinav = i.entity === "exam";
            const kimlik = sinav
              // Vizede kaçıncısı anlamlı; final/büt'te sıra her zaman 1 (K-46).
              ? `${i.course_code} · ${EXAM_TYPE_LABELS[i.exam_type]}`
                + (i.exam_type === "MIDTERM" ? ` ${i.exam_index}` : "")
              : `${i.course_code} · Şube ${i.section_no}`;
            const once = sinav ? examPlacementText(i.before) : placementText(i.before);
            const sonra = sinav ? examPlacementText(i.after) : placementText(i.after);
            return (
              <Table.Tr key={`${i.entity}-${kimlik}-${i.kind}-${ix}`}>
                <Table.Td>
                  <Badge size="sm" variant="light" color={DIFF_KIND_COLORS[i.kind]}>
                    {DIFF_KIND_LABELS[i.kind]}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>{kimlik}</Text>
                  {/* K-48: ortak ders — bu satır başka bölümlerin programına da
                      düşer. Onaylayanın bunu kaçırmaması gerekir. */}
                  {i.is_shared && (
                    <Text size="xs" c="orange.7">
                      Ortak ders — etkilenen:{" "}
                      {i.affected_departments.map((d) => d.name).join(", ") || "—"}
                    </Text>
                  )}
                  {/* Not değişikliği yerleşimden okunmaz: iki taraf da aynı
                      tarihi gösterirken satırın neden "taşındı" göründüğünü
                      söyleyen tek şey budur. */}
                  {sinav && i.after?.notes !== i.before?.notes && (
                    <Text size="xs" c="dimmed">
                      Not: {i.before?.notes || "—"} → {i.after?.notes || "—"}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td c="dimmed">{once}</Table.Td>
                <Table.Td>{sonra}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
