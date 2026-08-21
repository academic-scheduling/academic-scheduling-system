import { Fragment, useMemo } from "react";
import { Badge, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { lecturerLabel } from "../api/types";
import type { DraftDiffItem, Exam, WeeklyEntry } from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import { BORDER, GRID_CELL_BG, HEADER_BG, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";

/** Onay/inceleme ekranlarının "önerilen program" görüntüsü (K-60).
 *
 *  K-77'de Yayın Merkezi de aynı görüntüyü kullanıyor; bu yüzden ApprovalsPage
 *  içinde gömülü olan iki bileşen buraya taşındı — tek kaynak, iki tüketici.
 *  Vurgu YERLEŞİME bağlanır (şubeye/derse değil): aynı şubenin/dersin değişmeyen
 *  öteki satırı yanlışlıkla "taşındı" görünmesin (K-59 hatası). */

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];

const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz",
                 "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function gunBasligi(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${AY_KISA[d.getMonth()]} ${d.getFullYear()} · ${GUN_KISA[d.getDay()]}`;
}

/** Önerilen sınav takviminin salt-okunur listesi (K-60): sınav bir döneme
 *  yayılır, tek haftalık ızgaraya sığmaz — güne göre gruplanmış kronolojik sıra
 *  "bu değişiklik takvimin bütününde nereye oturuyor" sorusunu cevaplar. */
export function ProposedExamList({ exams, changed }: {
  exams: Exam[];
  changed: DraftDiffItem[];
}) {
  const t = useT();
  const vurgu = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of changed) {
      if (c.entity !== "exam") continue;
      if (!c.after) continue;                       // KALDIRILDI: listede yok
      m.set(`${c.course_id}-${c.exam_type}-${c.exam_index}`, c.kind);
    }
    return m;
  }, [changed]);

  const gunler = useMemo(() => {
    const m = new Map<string, Exam[]>();
    for (const e of [...exams].sort((a, b) =>
      a.exam_date.localeCompare(b.exam_date) || a.start_time.localeCompare(b.start_time))) {
      m.set(e.exam_date, [...(m.get(e.exam_date) ?? []), e]);
    }
    return [...m.entries()];
  }, [exams]);

  if (gunler.length === 0) {
    return <Text size="sm" c="dimmed">Taslakta hiç sınav yok.</Text>;
  }

  return (
    <ScrollArea.Autosize mah={420}>
      <Stack gap={10}>
        {gunler.map(([gun, liste]) => (
          <div key={gun}>
            <Text fz={12} fw={600} c={TEXT_MUTED} mb={4}
              style={{ letterSpacing: "0.02em" }}>
              {gunBasligi(gun)}
            </Text>
            <Stack gap={4}>
              {liste.map((e) => {
                const k = vurgu.get(`${e.course.id}-${e.exam_type}-${e.exam_index}`);
                const degisen = k !== undefined;
                const bit = new Date(`${gun}T${e.start_time}`);
                bit.setMinutes(bit.getMinutes() + e.duration_minutes);
                const saatAraligi = `${e.start_time.slice(0, 5)}–`
                  + `${String(bit.getHours()).padStart(2, "0")}:${String(bit.getMinutes()).padStart(2, "0")}`;
                return (
                  <Group key={e.id} gap={8} wrap="nowrap" align="flex-start"
                    style={{
                      background: degisen ? HEADER_BG : GRID_CELL_BG,
                      border: `1px solid ${BORDER}`,
                      borderLeft: `3px solid ${degisen ? "var(--mantine-color-blue-6)" : BORDER}`,
                      borderRadius: 6, padding: "6px 9px",
                    }}>
                    <Text fz={12} fw={600} style={{ minWidth: 96,
                      fontVariantNumeric: "tabular-nums" }}>
                      {saatAraligi}
                    </Text>
                    <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <Text fz={13} fw={600} truncate>{e.course.code}</Text>
                        <Badge size="xs" variant="default">
                          {t.enums.examType[e.exam_type]}
                          {e.exam_type === "MIDTERM" && e.exam_index > 1
                            ? ` ${e.exam_index}` : ""}
                        </Badge>
                        {degisen && (
                          <Badge size="xs" variant="light" color="blue">
                            {k === "ADDED" ? "eklendi" : "taşındı"}
                          </Badge>
                        )}
                      </Group>
                      <Text fz={12} c={TEXT_MUTED} truncate>
                        {e.classrooms.map((c) => `${c.building.name} ${c.room_code}`)
                          .join(", ") || "Derslik atanmadı"}
                        {" · "}{lecturerLabel(e.lecturer)}
                        {" · "}{e.total_expected_students} öğrenci
                      </Text>
                    </Stack>
                  </Group>
                );
              })}
            </Stack>
          </div>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}

/** Önerilen haftanın salt-okunur ızgarası: fark tablosu "ne değişti"yi söyler,
 *  bu değişikliğin haftanın BÜTÜNÜNDE nereye oturduğunu gösterir. */
export function ProposedGrid({ entries, changed }: {
  entries: WeeklyEntry[];
  changed: DraftDiffItem[];
}) {
  const t = useT();
  // Vurgu YERLEŞİME bağlanır: şube + hedef gün + hedef slot.
  const vurgu = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of changed) {
      if (c.entity !== "weekly") continue;
      if (!c.after) continue;                       // KALDIRILDI: ızgarada yok
      m.set(`${c.section_id}-${c.after.day_of_week}-${c.after.start_slot}`, c.kind);
    }
    return m;
  }, [changed]);

  const hucre = useMemo(() => {
    const m = new Map<string, WeeklyEntry[]>();
    for (const e of entries) {
      for (let s = 0; s < e.slot_count; s++) {
        const k = `${e.day_of_week}-${e.start_slot + s}`;
        m.set(k, [...(m.get(k) ?? []), e]);
      }
    }
    return m;
  }, [entries]);

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: "grid", gridTemplateColumns: `56px repeat(5, 1fr)`, gap: 1 }}>
          <div />
          {DAYS.map((d) => (
            <div key={d} style={{
              background: HEADER_BG, padding: "4px 6px", fontSize: 11,
              fontWeight: 600, textAlign: "center", letterSpacing: "0.04em",
            }}>
              {DAY_SHORT[d]}
            </div>
          ))}
          {SLOTS.map((s) => (
            <Fragment key={`row-${s}`}>
              <div style={{
                fontSize: 10, color: TEXT_MUTED, textAlign: "right",
                paddingRight: 6, paddingTop: 4,
              }}>
                {SLOT_START[s]}
              </div>
              {DAYS.map((d) => {
                const list = hucre.get(`${d}-${s}`) ?? [];
                return (
                  <div key={`${d}-${s}`} style={{
                    background: GRID_CELL_BG, minHeight: 26, padding: "2px 4px",
                    display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center",
                  }}>
                    {list.map((e) => {
                      const k = vurgu.get(
                        `${e.section.id}-${e.day_of_week}-${e.start_slot}`);
                      return (
                        <Badge key={e.id} size="xs" radius="sm"
                          variant={k ? "filled" : "light"}
                          color={k === "ADDED" ? "green" : k === "MOVED" ? "blue" : "gray"}>
                          {e.section.course.code}
                        </Badge>
                      );
                    })}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
