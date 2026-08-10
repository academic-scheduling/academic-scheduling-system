import { Badge, ScrollArea, Table, Text } from "@mantine/core";
import { DIFF_KIND_COLORS, DIFF_KIND_LABELS } from "../api/types";
import type { DraftDiffItem, DraftPlacement } from "../api/types";
import { DAY_SHORT } from "../utils/slots";

/** Yerleşimin okunur konumu: "Çar 5 · A Blok 101". Boş taraf (ekleme/kaldırma)
 *  "—" olur. */
export function placementText(p: DraftPlacement | null): string {
  if (!p) return "—";
  const gun = DAY_SHORT[p.day_of_week] ?? String(p.day_of_week);
  const bitis = p.slot_count > 1 ? `-${p.start_slot + p.slot_count - 1}` : "";
  return `${gun} ${p.start_slot}${bitis}${p.classroom_label ? ` · ${p.classroom_label}` : ""}`;
}

/** Farkın gösterimi — "sonucun neresi farklı" (K-59).
 *
 *  TEK bileşen: taslak sahibinin "Farkı Gör"ü ile onaylayıcının inceleme
 *  ekranı aynı tabloyu görür. İkisi ayrı çizilseydi, onaylayanın gördüğü ile
 *  gönderenin gördüğü zamanla ayrışırdı.
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
          {items.map((i, ix) => (
            <Table.Tr key={`${i.section_id}-${i.kind}-${ix}`}>
              <Table.Td>
                <Badge size="sm" variant="light" color={DIFF_KIND_COLORS[i.kind]}>
                  {DIFF_KIND_LABELS[i.kind]}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={500}>{i.course_code} · Şube {i.section_no}</Text>
                {/* K-48: ortak ders — bu satır başka bölümlerin programına da
                    düşer. Onaylayanın bunu kaçırmaması gerekir. */}
                {i.is_shared && (
                  <Text size="xs" c="orange.7">
                    Ortak ders — etkilenen:{" "}
                    {i.affected_departments.map((d) => d.name).join(", ") || "—"}
                  </Text>
                )}
              </Table.Td>
              <Table.Td c="dimmed">{placementText(i.before)}</Table.Td>
              <Table.Td>{placementText(i.after)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
