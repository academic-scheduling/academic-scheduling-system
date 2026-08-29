import type { Dict } from "../i18n/tr";

/** Slot tablosu ve gün adları (brief §5.1).
 *
 *  9 slot, 45 dakikalık ders + 15 dakikalık ara. Bu tablo hem Haftalık Program
 *  hem Sınav Takvimi ekranlarının temeli; tek kaynakta duruyor ki iki ekran
 *  ayrışmasın.
 */

export const SLOT_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: "08:30", end: "09:15" },
  2: { start: "09:30", end: "10:15" },
  3: { start: "10:30", end: "11:15" },
  4: { start: "11:30", end: "12:15" },
  5: { start: "12:30", end: "13:15" },
  6: { start: "13:30", end: "14:15" },
  7: { start: "14:30", end: "15:15" },
  8: { start: "15:30", end: "16:15" },
  9: { start: "16:30", end: "17:15" },
};

/** Günün son slotu — tablodan türetiliyor ki slot sayısı değişirse burası da
 *  kendiliğinden güncellensin. */
const MAX_SLOT = Math.max(...Object.keys(SLOT_TIMES).map(Number));

/** Gün adının nasıl yazılacağı: kısa ("Çar"), uzun ("Çarşamba") ya da hiç. */
export type DayFormat = "short" | "long" | "none";

/**
 * "Çarşamba 10:30 - 12:15" biçiminde okunur aralık üretir.
 *
 * Çok slotlu ders **son slotun bitişinde** biter: slot 3'ten başlayan 2 slotluk
 * ders 10:30 - 12:15'tir, çünkü aradaki 15 dakikalık teneffüs de dersin
 * kapladığı zamana dahildir.
 *
 * Gün son slotta biter; tablonun dışına taşan bir slotCount gelirse aralık
 * MAX_SLOT'ta kırpılır (yanlış veride ders saatini kısa göstermek yerine günün
 * sonuna kadar uzatmak daha doğru).
 */
export function formatSlotRange(
  dayOfWeek: number,
  startSlot: number,
  slotCount: number = 1,
  dayFormat: DayFormat = "short",
  // K-79: gün adları sözlükte; bu düz bir yardımcı olduğu için hook yerine
  // PARAMETRE alır (modül düzeyi dil değişimini göremez).
  t: Dict,
): string {
  const startInfo = SLOT_TIMES[startSlot];
  if (!startInfo) return "";

  const endSlot = Math.min(startSlot + slotCount - 1, MAX_SLOT);
  const endInfo = SLOT_TIMES[endSlot] ?? startInfo;

  const timeRange = `${startInfo.start} - ${endInfo.end}`;
  if (dayFormat === "none") return timeRange;

  // Bilinmeyen gün "?" ile görünür kalsın — sessizce düşerse hatalı veri
  // ekranda normal bir kayıt gibi durur.
  const dayName = (dayFormat === "long" ? t.days.long : t.days.short)[dayOfWeek] ?? "?";
  return `${dayName} ${timeRange}`;
}
