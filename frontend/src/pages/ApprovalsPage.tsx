import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Paper, ScrollArea,
  Stack, Text, Textarea, Title, Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconArrowLeft, IconCheck, IconClock, IconInbox, IconX,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import DiffTable from "../components/DiffTable";
import { SEMESTER_LABELS } from "../api/types";
import type {
  ConflictResult, DraftApproveResponse, DraftDiffItem, DraftReview, ScheduleDraft,
  WeeklyEntry,
} from "../api/types";
import { DAY_SHORT } from "../utils/slots";
import {
  BORDER, GRID_CELL_BG, HEADER_BG, PAGE_SURFACE, SHADOW, TEXT_MUTED,
} from "../utils/scheduleTheme";

const DAYS = [1, 2, 3, 4, 5];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SLOT_START = ["", "08:30", "09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30"];

function tarih(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function cohortAdi(d: ScheduleDraft): string {
  return `${d.department_name} · ${d.year}. sınıf · ${SEMESTER_LABELS[d.semester]}`;
}


/* ==================================================================
 * Sayfa: kuyruk <-> inceleme
 * ================================================================== */

export default function ApprovalsPage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<ScheduleDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.get<ScheduleDraft[]>("/schedule-approvals")
      .then(setQueue)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Kuyruk yüklenemedi"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (openId !== null) {
    return (
      <ReviewPanel
        draftId={openId}
        onBack={() => { setOpenId(null); load(); }}
      />
    );
  }

  return (
    <Stack gap="md">
      <Group gap="sm" align="center">
        <Title order={2} fw={600} fz={20}>Onay Bekleyenler</Title>
        {queue.length > 0 && <Badge variant="light">{queue.length}</Badge>}
      </Group>

      <Text size="sm" c={TEXT_MUTED}>
        Program değişiklikleri yayına ancak buradan geçer. Kendi gönderdiğiniz
        talebi onaylayamazsınız — başka bir onay yetkilisi incelemelidir.
      </Text>

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
      {loading && <Loader size="sm" />}

      {!loading && queue.length === 0 && (
        <Paper radius="md" p="xl" style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
          <Stack align="center" gap={6}>
            <IconInbox size={28} style={{ opacity: 0.4 }} />
            <Text size="sm" c="dimmed">Onay bekleyen talep yok.</Text>
          </Stack>
        </Paper>
      )}

      {queue.map((d) => {
        const kendi = d.owner.id === user?.id;
        return (
          <Paper key={d.id} radius="md" p="md"
            style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE, boxShadow: SHADOW }}>
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
              <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
                <Group gap={8}>
                  <Text fw={600}>{cohortAdi(d)}</Text>
                  <Badge size="sm" variant="light" color="blue">
                    {d.change_count} değişiklik
                  </Badge>
                  {kendi && (
                    <Badge size="sm" variant="light" color="gray">kendi talebiniz</Badge>
                  )}
                </Group>
                <Group gap={6}>
                  <IconClock size={13} style={{ opacity: 0.5 }} />
                  <Text size="sm" c="dimmed">
                    {d.owner.name} · {tarih(d.submitted_at)}
                  </Text>
                </Group>
                {d.submit_note && (
                  <Text size="sm" style={{ fontStyle: "italic" }}>“{d.submit_note}”</Text>
                )}
              </Stack>
              <Button size="xs" radius="md" onClick={() => setOpenId(d.id)}>
                İncele
              </Button>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}


/* ==================================================================
 * İnceleme: bayatlık + çakışma + fark + önerilen ızgara
 * ================================================================== */

function ReviewPanel({ draftId, onBack }: { draftId: number; onBack: () => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<DraftReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);

  const load = () => {
    api.get<DraftReview>(`/schedule-approvals/${draftId}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "İnceleme yüklenemedi"));
  };
  useEffect(load, [draftId]);

  if (error) return <Alert color="red" variant="light" radius="md">{error}</Alert>;
  if (!data) return <Loader size="sm" />;

  const { draft, items, entries, conflicts, staleness } = data;
  const kendi = draft.owner.id === user?.id;

  const onayla = async () => {
    setBusy(true);
    setBlockers(null);
    try {
      const r = await api.post<DraftApproveResponse>(
        `/schedule-approvals/${draftId}/approve`,
      );
      notifications.show({
        color: "green",
        title: "Yayına alındı",
        message: `${r.applied.length} değişiklik uygulandı`
          + (r.warnings.length ? ` · ${r.warnings.length} uyarı görünür kaldı` : ""),
      });
      onBack();
    } catch (e) {
      // 409: talep gönderildikten sonra program değişmiş ve artık çakışıyor.
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : "Onaylanamadı",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="md">
      <Group gap="sm" align="center" wrap="wrap">
        <ActionIcon variant="subtle" onClick={onBack} aria-label="Kuyruğa dön">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Title order={2} fw={600} fz={20}>{cohortAdi(draft)}</Title>
        <Badge variant="light" color="blue">{items.length} değişiklik</Badge>
      </Group>

      <Paper radius="md" p="md"
        style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE }}>
        <Stack gap={6}>
          <Text size="sm">
            <b>{draft.owner.name}</b> gönderdi · {tarih(draft.submitted_at)}
          </Text>
          {draft.submit_note && (
            <Text size="sm" style={{ fontStyle: "italic" }}>“{draft.submit_note}”</Text>
          )}
        </Stack>
      </Paper>

      {/* K-59: taslak açıldıktan sonra program değiştiyse, sahibinin hiç
          dokunmadığı satırlar bile farkta "geri alınacak değişiklik" olarak
          belirir. Fark listesi bunu zaten satır satır gösteriyor; bu banner
          onaylayıcıya DİKKATLİ BAK diyen üst düzey işaret. */}
      {staleness.publications_since > 0 && (
        <Alert color="orange" variant="light" radius="md"
          icon={<IconAlertTriangle size={18} />}
          title="Bu taslak güncel olmayabilir">
          <Text size="sm">
            Taslak {tarih(staleness.opened_at)} tarihinde açıldı; program o
            tarihten sonra <b>{staleness.publications_since} kez</b> güncellendi
            {staleness.last_published_by && ` (son: ${staleness.last_published_by}, ${tarih(staleness.last_published_at)})`}.
          </Text>
          <Text size="sm" mt={4}>
            Aşağıdaki listede, gönderenin kendi yapmadığı ama onaylanırsa
            <b> geri alınacak</b> değişiklikler de olabilir. "Önce" sütunu şu an
            yayında olanı gösterir.
          </Text>
        </Alert>
      )}

      {kendi && (
        <Alert color="gray" variant="light" radius="md">
          Bu talebi siz gönderdiniz — kendi talebinizi onaylayamazsınız (K-59).
          Başka bir onay yetkilisi incelemeli.
        </Alert>
      )}

      {conflicts.hard.length > 0 && (
        <Alert color="red" variant="light" radius="md" title="Hard çakışma — onaylanamaz">
          <Stack gap={2}>
            {conflicts.hard.map((c, i) => (
              <Text key={i} size="sm">{c.rule_id} · {c.message}</Text>
            ))}
          </Stack>
        </Alert>
      )}
      {conflicts.warnings.length > 0 && (
        <Alert color="yellow" variant="light" radius="md"
          title={`${conflicts.warnings.length} uyarı — engellemez`}>
          <ScrollArea.Autosize mah={140}>
            <Stack gap={2}>
              {conflicts.warnings.map((c, i) => (
                <Text key={i} size="sm">{c.rule_id} · {c.message}</Text>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Alert>
      )}
      {blockers && (
        <Alert color="red" variant="light" radius="md"
          title="Onaylanamadı — talep güncel programla çakışıyor">
          <Stack gap={2}>
            {blockers.map((c, i) => <Text key={i} size="sm">{c.rule_id} · {c.message}</Text>)}
          </Stack>
        </Alert>
      )}

      <Paper radius="md" p="md"
        style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE, boxShadow: SHADOW }}>
        <Text fw={600} fz={15} mb="xs">Değişiklikler</Text>
        <DiffTable items={items} maxHeight={320} />
      </Paper>

      <Paper radius="md" p="md"
        style={{ border: `1px solid ${BORDER}`, background: PAGE_SURFACE, boxShadow: SHADOW }}>
        <Group justify="space-between" mb="xs">
          <Text fw={600} fz={15}>Önerilen program</Text>
          <Text size="xs" c="dimmed">değişen yerleşimler vurgulu</Text>
        </Group>
        <ProposedGrid entries={entries} changed={items} />
      </Paper>

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onBack}>Kuyruğa dön</Button>
        <Tooltip label={kendi ? "Kendi talebinizi reddedemezsiniz" : "Gerekçeyle reddet"}>
          <Button color="red" variant="light" disabled={kendi} loading={busy}
            leftSection={<IconX size={16} />} onClick={() => setRejectOpen(true)}>
            Reddet
          </Button>
        </Tooltip>
        <Tooltip label={
          kendi ? "Kendi talebinizi onaylayamazsınız"
            : conflicts.hard.length ? "Hard çakışma çözülmeden onaylanamaz"
            : "Değişiklikleri yayına al"}>
          <Button disabled={kendi || conflicts.hard.length > 0} loading={busy}
            leftSection={<IconCheck size={16} />} onClick={onayla}>
            Onayla ve yayına al
          </Button>
        </Tooltip>
      </Group>

      <RejectModal
        opened={rejectOpen}
        draftId={draftId}
        onClose={() => setRejectOpen(false)}
        onDone={onBack}
      />
    </Stack>
  );
}


/** Reddetme gerekçe İSTER: gerekçesiz ret, gönderene neyi düzelteceğini
 *  söylemez ve aynı talep tekrar gelir. */
function RejectModal({ opened, draftId, onClose, onDone }: {
  opened: boolean; draftId: number; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reddet = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-approvals/${draftId}/reject`, { note: note.trim() });
      notifications.show({ color: "gray", message: "Talep reddedildi — gerekçe gönderene iletildi" });
      onDone();
    } catch (e) {
      notifications.show({
        color: "red", message: e instanceof ApiError ? e.message : "Reddedilemedi",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} radius="md" title="Talebi reddet">
      <Stack gap="sm">
        <Textarea
          label="Gerekçe"
          description="Gönderen bunu görecek ve düzeltip yeniden gönderebilecek"
          placeholder="Örn. Çarşamba 5. saatte amfi bakımda, başka bir saate alın"
          autosize minRows={3} maxRows={6}
          value={note} onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Vazgeç</Button>
          <Button color="red" loading={busy} disabled={!note.trim()} onClick={reddet}>
            Reddet
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}


/** Önerilen haftanın salt-okunur ızgarası. Fark tablosu "ne değişti"yi anlatır;
 *  bu, değişikliğin haftanın BÜTÜNÜNDE nereye oturduğunu gösterir — onaylayıcı
 *  "bu saat zaten dolu muydu" sorusunu tabloya bakarak cevaplayamaz. */
function ProposedGrid({ entries, changed }: {
  entries: WeeklyEntry[];
  changed: DraftDiffItem[];
}) {
  // Vurgu, ŞUBEYE değil YERLEŞİME bağlanır: şube bazlı işaretlemek, aynı
  // şubenin DEĞİŞMEYEN öteki oturumunu da "taşındı" gibi gösteriyordu
  // (gerçek veride bir şubenin aynı slotta iki satırı olabiliyor).
  // Anahtar: şube + hedef gün + hedef slot.
  const vurgu = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of changed) {
      // K-60: fark listesi artık iki şekil taşıyor; haftalık ızgara yalnız
      // kendi satırlarını vurgular (sınav farkı ayrı ekranda çizilir).
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
