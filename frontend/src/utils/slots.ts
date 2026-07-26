export const DAY_SHORT: Record<number, string> = {
  1: "Pzt",
  2: "Sal",
  3: "Çar",
  4: "Per",
  5: "Cum",
};

export const DAY_FULL: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
};

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

export function formatSlotRange(
  dayOfWeek: number,
  startSlot: number,
  slotCount: number = 1,
  showDay: boolean = true
): string {
  const dayName = DAY_SHORT[dayOfWeek] || "";
  const startInfo = SLOT_TIMES[startSlot];
  const endSlot = startSlot + slotCount - 1;
  const endInfo = SLOT_TIMES[endSlot] || SLOT_TIMES[startSlot];

  if (!startInfo) return "";

  const timeRange = `${startInfo.start} - ${endInfo.end}`;
  return showDay && dayName ? `${dayName} ${timeRange}` : timeRange;
}
