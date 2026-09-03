import { Badge, ScrollArea, Table, Text } from "@mantine/core";
import { DIFF_KIND_COLORS } from "../api/types";
import type {
  DraftDiffItem, DraftExamPlacement, DraftPlacement,
} from "../api/types";
import { useT } from "../i18n";
import { formatSlotRange } from "../utils/slots";
import type { Dict } from "../i18n/tr";

/** Haftalık yerleşimin okunur konumu: "Çar 10:30 - 12:15 · A Blok 101".
 *
 *  K-85: eskiden SLOT NUMARASI yazıyordu ("Çar 5-7"). Slot numarası bir iç
 *  temsil; kullanıcı programı saatle okuyor ve fark tablosu onay öncesi son
 *  kontrol noktası — orada "6-8" görmek, kişiyi slot tablosunu ezberlemeye
 *  zorluyordu. Aralık `formatSlotRange` ile kuruluyor: ızgaranın, dersin
 *  detayının ve export'un kullandığı aynı kaynak. */
export function placementText(p: DraftPlacement | null, t: Dict): string {
  if (!p) return "—";
  return formatSlotRange(p.day_of_week, p.start_slot, p.slot_count, "short", t)
    + (p.classroom_label ? ` · ${p.classroom_label}` : "");
}

/** Sınav yerleşiminin okunur konumu: "15 Eyl 09:00 (90 dk) · B Blok 202". */
export function examPlacementText(p: DraftExamPlacement | null, t: Dict): string {
  if (!p) return "—";
  const [, a, g] = p.exam_date.split("-").map(Number);
  const saat = p.start_time.slice(0, 5);
  return `${g} ${t.exams.monthsShort[a - 1] ?? a} ${saat} (${p.duration_minutes} ${t.days.minutesShort})`
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
  const t = useT();
  if (items.length === 0) {
    return <Text size="sm" c="dimmed">{t.draft.identical}</Text>;
  }
  return (
    <ScrollArea.Autosize mah={maxHeight}>
      <Table striped highlightOnHover verticalSpacing={6} fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={104}>{t.draft.colChange}</Table.Th>
            <Table.Th>{t.draft.colCourse}</Table.Th>
            <Table.Th>{t.draft.colBefore}</Table.Th>
            <Table.Th>{t.draft.colAfter}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((i, ix) => {
            const sinav = i.entity === "exam";
            const kimlik = sinav
              // Vizede kaçıncısı anlamlı; final/büt'te sıra her zaman 1 (K-46).
              ? `${i.course_code} · ${t.enums.examType[i.exam_type]}`
                + (i.exam_type === "MIDTERM" ? ` ${i.exam_index}` : "")
              : t.draft.sectionOf(i.course_code, i.section_no);
            const once = sinav ? examPlacementText(i.before, t) : placementText(i.before, t);
            const sonra = sinav ? examPlacementText(i.after, t) : placementText(i.after, t);
            return (
              <Table.Tr key={`${i.entity}-${kimlik}-${i.kind}-${ix}`}>
                <Table.Td>
                  <Badge size="sm" variant="light" color={DIFF_KIND_COLORS[i.kind]}>
                    {t.common.diffKind[i.kind]}
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
