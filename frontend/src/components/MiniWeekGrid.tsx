import { Fragment } from "react";
import { Box, Text } from "@mantine/core";
import { DAY_SHORT, SLOT_TIMES } from "../utils/slots";

/** Izgaraya yerleştirilecek tek blok. day: 1-5 (Pzt-Cum), startSlot: 1-9. */
export type WeekPlacement = {
  day: number;
  startSlot: number;
  slotCount: number;
  label: string;
  title?: string;
};

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = Object.keys(SLOT_TIMES).map(Number).sort((a, b) => a - b);

/**
 * Basit haftalık program ızgarası — Derslikler ve Öğretim Üyeleri drawer'larında
 * kullanılır (mockup'lardaki HAFTALIK KULLANIM / MÜSAİTLİK'in sade karşılığı).
 *
 * Salt-okunur: yalnız yayındaki yerleşimleri gösterir (düzenleme Haftalık Program
 * ekranında, cohort görünümünde yapılır). Çok slotlu blok tüm slotlarını doldurur;
 * etiket yalnız başlangıç slotunda yazılır. Boş hücreler ince kenarlıkla durur.
 */
export default function MiniWeekGrid({
  placements, emptyLabel = "Programda ders yok.",
}: {
  placements: WeekPlacement[];
  emptyLabel?: string;
}) {
  if (placements.length === 0) {
    return <Text size="sm" c="dimmed">{emptyLabel}</Text>;
  }

  // `${gün}-${slot}` → o hücrenin etiketi. Etiket kapladığı HER slotta yazılır
  // (kullanıcı: ardışık slotlar isimsiz boyanınca ne olduğu belirsiz kalıyordu).
  const cells: Record<string, { label: string; title?: string }> = {};
  for (const p of placements) {
    for (let i = 0; i < p.slotCount; i++) {
      cells[`${p.day}-${p.startSlot + i}`] = { label: p.label, title: p.title };
    }
  }

  return (
    <Box style={{ display: "grid", gridTemplateColumns: "42px repeat(5, 1fr)", gap: 3, alignItems: "center" }}>
      <span />
      {DAYS.map((d) => (
        <Text key={d} fz={10} fw={600} c="dimmed" ta="center">{DAY_SHORT[d]}</Text>
      ))}
      {SLOTS.map((slot) => (
        <Fragment key={slot}>
          <Text fz={10} c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
            {SLOT_TIMES[slot].start}
          </Text>
          {DAYS.map((d) => {
            const c = cells[`${d}-${slot}`];
            return (
              <Box
                key={d}
                title={c?.title}
                style={{
                  height: 22,
                  borderRadius: 3,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  background: c ? "var(--mantine-color-blue-light)" : "transparent",
                  color: c ? "var(--mantine-color-blue-light-color)" : undefined,
                  border: c ? "none" : "1px solid var(--mantine-color-default-border)",
                }}
              >
                {c?.label ?? ""}
              </Box>
            );
          })}
        </Fragment>
      ))}
    </Box>
  );
}
