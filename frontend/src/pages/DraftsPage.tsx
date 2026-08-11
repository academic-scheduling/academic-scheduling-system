import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Badge, Button, Group, Loader, Paper, Stack, Text, Title,
} from "@mantine/core";
import { IconClock, IconInbox, IconPencil } from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import {
  DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS, SEMESTER_LABELS,
} from "../api/types";
import type { ScheduleDraft } from "../api/types";
import { BORDER, PAGE_SURFACE, SHADOW, TEXT_MUTED } from "../utils/scheduleTheme";

function tarih(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Hazırlayan tarafın kuyruğu — "Onay Bekleyenler"in eşi (K-61).
 *
 *  Taslaklar ÖZELDİR ve yalnız açıldıkları cohort'un ekranında görünürdü;
 *  başka bir cohort'a geçince "bir yerlerde açık taslağım var mı" sorusunun
 *  cevabı hiçbir yerde yoktu. Mod çubuğundaki hızlı seçim yalnız bulunulan
 *  cohort'u bilir, bu sayfa BÜTÜNÜNÜ gösterir.
 *
 *  Yetki istemez: taslak açmak yetki istemiyor (K-59), dolayısıyla "kendi
 *  taslaklarım" listesi de istemez. Sunucu zaten başkasınınkini döndürmez.
 */
export default function DraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<ScheduleDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ScheduleDraft[]>("/schedule-drafts")
      .then(setDrafts)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Taslaklar yüklenemedi"));
  }, []);

  /** Taslağı ilgili ekranda AÇIK getirir: ekran cohort'u seçer, mod çubuğu
   *  o cohort'un açık taslağını bulup kendiliğinden seçer (K-61). */
  const ac = (d: ScheduleDraft) => {
    const yol = d.kind === "EXAM" ? "/exams" : "/weekly";
    navigate(`${yol}?department_id=${d.department_id}&year=${d.year}`
             + `&semester=${d.semester}&draft_id=${d.id}`);
  };

  return (
    <Stack gap="md">
      <Group gap="sm" align="center">
        <Title order={2} fw={600} fz={20}>Taslaklarım</Title>
        {drafts && drafts.length > 0 && <Badge variant="light">{drafts.length}</Badge>}
      </Group>

      <Text size="sm" c={TEXT_MUTED}>
        Açık taslaklarınız — ders programı ve sınav takvimi bir arada. Taslaklar
        özeldir, yalnız siz görürsünüz; yayına ancak onaydan geçerek girerler.
      </Text>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
      {!drafts && !error && <Loader size="sm" />}

      {drafts && drafts.length === 0 && (
        <Paper radius="md" p="xl"
          style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
          <Stack align="center" gap={6}>
            <IconInbox size={28} style={{ opacity: 0.4 }} />
            <Text size="sm" c="dimmed">Açık taslağınız yok.</Text>
            <Text size="xs" c="dimmed">
              Haftalık Program veya Sınavlar ekranından "Taslak Aç" ile başlayın.
            </Text>
          </Stack>
        </Paper>
      )}

      {drafts?.map((d) => (
        <Paper key={d.id} radius="md" p="md"
          style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE, boxShadow: SHADOW }}>
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
              <Group gap={8} wrap="wrap">
                <Text fw={600}>
                  {d.department_name} · {d.year}. sınıf · {SEMESTER_LABELS[d.semester]}
                </Text>
                <Badge size="sm" variant="light"
                  color={d.kind === "EXAM" ? "grape" : "teal"}>
                  {d.kind === "EXAM" ? "Sınav takvimi" : "Ders programı"}
                </Badge>
                <Badge size="sm" variant="filled" color={DRAFT_STATUS_COLORS[d.status]}>
                  {DRAFT_STATUS_LABELS[d.status]}
                </Badge>
                <Badge size="sm" variant="light" color="blue">
                  {d.change_count
                    ? `${d.change_count} değişiklik`
                    : "yayınla aynı"}
                </Badge>
              </Group>
              <Group gap={6}>
                <IconClock size={13} style={{ opacity: 0.5 }} />
                <Text size="sm" c="dimmed">
                  #{d.id} · açıldı {tarih(d.created_at)}
                  {d.status === "PENDING" && ` · gönderildi ${tarih(d.submitted_at)}`}
                </Text>
              </Group>
              {/* Reddedilen taslakta gerekçe listede DE görünmeli: kullanıcı
                  neyi düzelteceğini öğrenmek için taslağı açmak zorunda kalmasın. */}
              {d.status === "REJECTED" && d.review_note && (
                <Text size="sm" c="red.7">
                  Reddedildi{d.reviewer ? ` — ${d.reviewer.name}` : ""}: {d.review_note}
                </Text>
              )}
            </Stack>
            <Button size="xs" radius="md" leftSection={<IconPencil size={15} />}
              onClick={() => ac(d)}>
              Aç
            </Button>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
