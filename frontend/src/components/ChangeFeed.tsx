import { useEffect, useState } from "react";
import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { api } from "../api/client";
import { SEMESTER_LABELS } from "../api/types";
import type { ScheduleChange } from "../api/types";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";

function tarih(s: string | null): string {
  if (!s) return "";
  return new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** "Bölümünüzü etkileyen son program değişiklikleri" (K-59).
 *
 *  Bu panel olmasa program insanların ayağının altında sessizce değişirdi:
 *  taslaklar özeldir, onaylar arka planda gerçekleşir ve ortak ders (K-48)
 *  taşındığında hiç dokunmadığınız bölümün programı da değişir.
 *
 *  Okundu/okunmadı YOK — bu bir akış, bildirim merkezi değil (K-59 kararı).
 */
export default function ChangeFeed({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<ScheduleChange[] | null>(null);

  useEffect(() => {
    api.get<ScheduleChange[]>(`/schedule-changes?limit=${limit}`)
      .then(setItems)
      .catch(() => setItems([]));    // akış ikincil bilgi; hata ekranı basmaz
  }, [limit]);

  if (!items || items.length === 0) return null;

  return (
    <Paper radius="md" p="md"
      style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
      <Group gap={8} mb={4}>
        <IconHistory size={17} style={{ opacity: 0.6 }} />
        <Text fw={600} fz={15}>Bölümünüzü etkileyen son değişiklikler</Text>
      </Group>
      {/* K-61: kullanıcı "bu panel neyi gösteriyor, çakışmaları mı?" diye
          sordu — soru sorulmuşsa başlık kendini anlatmıyor demektir. Panelin
          konusu ÇAKIŞMA DEĞİL, yayına geçmiş onaylardır; ve listeye iki
          yoldan girilir. İkinci yol (ortak ders) hiç aşikâr değil. */}
      <Text size="xs" c={TEXT_MUTED} mb="sm">
        Onaylanıp yayına geçen değişiklikler. Ya kendi bölümünüzün programında
        yapıldılar ya da <b>ortak bir ders</b> üzerinden sizi etkilediler.
      </Text>
      <Stack gap="sm">
        {items.map((c) => (
          <Stack key={c.id} gap={2}>
            <Group gap={8} wrap="wrap">
              <Text size="sm" fw={500}>
                {c.department_name} · {c.year}. sınıf · {SEMESTER_LABELS[c.semester]}
              </Text>
              {/* K-60: iki tür onay aynı akışta; hangisinin değiştiği özetten
                  tahmin edilmemeli. */}
              <Badge size="xs" variant="light"
                color={c.kind === "EXAM" ? "grape" : "teal"}>
                {c.kind === "EXAM" ? "sınav takvimi" : "ders programı"}
              </Badge>
              <Text size="xs" c={TEXT_MUTED}>{tarih(c.published_at)}</Text>
              {c.affected_departments.length > 0 && (
                <Badge size="xs" variant="light" color="orange">
                  ortak ders — {c.affected_departments.length} bölümü etkiledi
                </Badge>
              )}
            </Group>
            {c.summary && <Text size="sm" c={TEXT_MUTED}>{c.summary}</Text>}
            <Text size="xs" c={TEXT_MUTED}>
              {c.published_by} hazırladı
              {c.approved_by && ` · ${c.approved_by} onayladı`}
            </Text>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
