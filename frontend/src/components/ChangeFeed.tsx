import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionIcon, Badge, Button, Collapse, Group, Paper, Stack, Text,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconHistory } from "@tabler/icons-react";
import { api } from "../api/client";
import { SEMESTER_LABELS } from "../api/types";
import type { DraftKind, ScheduleChange } from "../api/types";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";

function tarih(s: string | null): string {
  if (!s) return "";
  return new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** "Bölümünüzü etkileyen son değişiklikler" (K-59, K-73).
 *
 *  Bu panel olmasa program insanların ayağının altında sessizce değişirdi:
 *  taslaklar özeldir, onaylar arka planda gerçekleşir ve ortak ders (K-48)
 *  taşındığında hiç dokunmadığınız bölümün programı da değişir.
 *
 *  K-73: panel açılır-kapanır (varsayılan KAPALI — göz yormasın) ve her satır
 *  tek satıra indi: "cohort · tür · tarih" + "Göster". Tüm değişiklik özetini
 *  tek tek yazmıyor; "Göster" o cohort'un YAYINDAKİ halini açar. `kind` verilince
 *  yalnız o tür gösterilir (Haftalık ekranda WEEKLY, Sınav ekranda EXAM).
 */
export default function ChangeFeed({
  limit = 5, kind, onShow,
}: {
  limit?: number;
  /** K-73: yalnız bu türü göster. Verilmezse ikisi de (ör. ana sayfa). */
  kind?: DraftKind;
  /** K-73: "Göster" — barındıran sayfa cohort'u yayında açsın. Yoksa ilgili
   *  program sayfasına yönlendirilir (kind'e göre /weekly ya da /exams). */
  onShow?: (c: ScheduleChange) => void;
}) {
  const [items, setItems] = useState<ScheduleChange[] | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<ScheduleChange[]>(
      `/schedule-changes?limit=${limit}${kind ? `&kind=${kind}` : ""}`)
      .then(setItems)
      .catch(() => setItems([]));    // akış ikincil bilgi; hata ekranı basmaz
  }, [limit, kind]);

  if (!items || items.length === 0) return null;

  const goster = (c: ScheduleChange) => {
    if (onShow) { onShow(c); return; }
    const path = c.kind === "EXAM" ? "/exams" : "/weekly";
    navigate(`${path}?department_id=${c.department_id}&year=${c.year}&semester=${c.semester}`);
  };

  return (
    <Paper radius="md" p="md"
      style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
      {/* Başlık satırı tıklanınca açılır/kapanır (K-73). */}
      <Group gap={8} wrap="nowrap" style={{ cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((o) => !o)}>
        <IconHistory size={17} style={{ opacity: 0.6, flexShrink: 0 }} />
        <Text fw={600} fz={15}>Bölümünüzü etkileyen son değişiklikler</Text>
        <Badge size="sm" variant="light" color="gray">{items.length}</Badge>
        <ActionIcon variant="subtle" color="gray" ml="auto" aria-label={open ? "Kapat" : "Aç"}>
          {open ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
        </ActionIcon>
      </Group>

      <Collapse in={open}>
        <Stack gap={6} mt="sm">
          {items.map((c) => (
            <Group key={c.id} gap={8} wrap="nowrap" justify="space-between"
              style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
              <Group gap={8} wrap="wrap" style={{ minWidth: 0 }}>
                <Text size="sm" fw={500}>
                  {c.department_name} · {c.year}. sınıf · {SEMESTER_LABELS[c.semester]}
                </Text>
                <Badge size="xs" variant="light"
                  color={c.kind === "EXAM" ? "grape" : "teal"}>
                  {c.kind === "EXAM" ? "sınav takvimi" : "ders programı"}
                </Badge>
                {c.affected_departments.length > 0 && (
                  <Badge size="xs" variant="light" color="orange">
                    ortak ders — {c.affected_departments.length} bölüm
                  </Badge>
                )}
                <Text size="xs" c={TEXT_MUTED}>{tarih(c.published_at)}</Text>
              </Group>
              <Button size="compact-xs" variant="light" style={{ flexShrink: 0 }}
                onClick={() => goster(c)}>
                Göster
              </Button>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
