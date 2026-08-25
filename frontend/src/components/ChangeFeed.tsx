import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Anchor, Badge, Button, Group, Paper, Stack, Text,
} from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { api } from "../api/client";
import type { DraftKind, ScheduleChange } from "../api/types";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

function tarih(s: string | null, t: Dict): string {
  if (!s) return "";
  return new Date(s).toLocaleString(t.locale, {
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
  const t = useT();
  const [items, setItems] = useState<ScheduleChange[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // K-82: `limit + 1` çekilir. Fazladan gelen satır ÇİZİLMEZ; yalnız
    // "gösterdiğimden fazlası var mı" sorusunu cevaplar — ayrı bir sayaç ucu
    // açmadan "Hepsini gör"ün görünüp görünmeyeceğine karar verdirir.
    api.get<ScheduleChange[]>(
      `/schedule-changes?limit=${limit + 1}${kind ? `&kind=${kind}` : ""}`)
      .then(setItems)
      .catch(() => setItems([]));    // akış ikincil bilgi; hata ekranı basmaz
  }, [limit, kind]);

  if (!items || items.length === 0) return null;

  const goster = (c: ScheduleChange) => {
    if (onShow) { onShow(c); return; }
    const path = c.kind === "EXAM" ? "/exams" : "/weekly";
    navigate(`${path}?department_id=${c.department_id}&year=${c.year}&semester=${c.semester}`);
  };

  // K-82: panel artık AÇILIR-KAPANIR DEĞİL. K-73'te varsayılan kapalıydı
  // ("göz yormasın") ama kapalı bir panel, kimsenin haberi olmadan değişen
  // programı duyurma işini yapamıyordu — panelin var oluş sebebi buydu.
  const gosterilen = items.slice(0, limit);
  const fazlasiVar = items.length > limit;

  return (
    <Paper radius="md" p="md"
      style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
      <Group gap={8} wrap="nowrap">
        <IconHistory size={17} style={{ opacity: 0.6, flexShrink: 0 }} />
        <Text fw={600} fz={15}>{t.changeFeed.title}</Text>
        {fazlasiVar && (
          // "Hepsini gör" Yayın Merkezi'nin "Onaylananlar" grubuna gider:
          // aynı kayıtların tam listesi ve aynı görünürlük kuralı orada (K-80).
          <Anchor component={Link} to="/publishing" fz={12} fw={600} ml="auto">
            {t.changeFeed.seeAll}
          </Anchor>
        )}
      </Group>

      <Stack gap={6} mt="sm">
        {gosterilen.map((c) => (
            <Group key={c.id} gap={8} wrap="nowrap" justify="space-between"
              style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
              <Group gap={8} wrap="wrap" style={{ minWidth: 0 }}>
                <Text size="sm" fw={500}>
                  {c.department_name} · {t.courses.yearN(c.year)} · {t.enums.semester[c.semester]}
                </Text>
                <Badge size="xs" variant="light"
                  color={c.kind === "EXAM" ? "grape" : "teal"}>
                  {c.kind === "EXAM" ? t.changeFeed.examSchedule : t.changeFeed.weeklySchedule}
                </Badge>
                {c.affected_departments.length > 0 && (
                  <Badge size="xs" variant="light" color="orange">
                    {t.courseInfo.sharedCourseDepts(c.affected_departments.length)}
                  </Badge>
                )}
                <Text size="xs" c={TEXT_MUTED}>{tarih(c.published_at, t)}</Text>
              </Group>
            <Button size="compact-xs" variant="light" style={{ flexShrink: 0 }}
              onClick={() => goster(c)}>
              Göster
            </Button>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
