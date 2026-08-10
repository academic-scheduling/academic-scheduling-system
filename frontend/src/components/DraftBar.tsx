import { useState } from "react";
import {
  Alert, Badge, Button, Group, Modal, Paper, Stack, Text, Textarea, Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconArrowBackUp, IconEraser, IconGitCompare, IconLock,
  IconPencil, IconPlus, IconSend, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import {
  DRAFT_KIND_LABELS, DRAFT_ROW_LABELS, DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS,
} from "../api/types";
import DiffTable from "./DiffTable";
import type {
  ConflictResult, DraftClearResponse, DraftDiff, DraftDiffItem, DraftKind,
  ScheduleDraft, SemesterType,
} from "../api/types";
import {
  BORDER, CONTROL_H, DRAFT_BORDER, DRAFT_SURFACE, SHADOW,
} from "../utils/scheduleTheme";

export type DraftBarProps = {
  /** Aktif cohort. `year` null ise (ör. "Ortak dersler" görünümü) taslak açılamaz. */
  departmentId: number | null;
  year: number | null;
  semester: SemesterType;
  /** K-60: bu çubuk hangi tür programı yönetiyor. Yaşam döngüsü ve kapılar
   *  aynı; yalnız metinler ve gönderme yetkisinin adı türden gelir. */
  kind: DraftKind;
  /** Bu cohort için BENİM açık taslağım (yoksa null → yayın modundayız). */
  draft: ScheduleDraft | null;
  /** Taslağı seç / yayına dön. */
  onSelect: (draft: ScheduleDraft | null) => void;
  /** Taslak açma TEK yerde durur (sayfada): ızgaradaki "yayında, taslağa
   *  geçilsin mi?" sorusu da aynı işlevi çağırır. */
  onCreate: () => Promise<void>;
  /** Taslak listesi + ızgara yeniden yüklensin. */
  onChanged: () => void;
  /** K-25: onaya göndermek türe göre yetki + bölüm üyeliği ister
   *  (`can_manage_weekly` / `can_manage_exams`, K-60).
   *  Taslak AÇMAK istemez — özel taslak kimseyi etkilemez (K-59). */
  canSubmit: boolean;
};

export default function DraftBar({
  departmentId, year, semester, kind, draft, onSelect, onCreate, onChanged,
  canSubmit,
}: DraftBarProps) {
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DraftDiffItem[] | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const cohortHazir = departmentId !== null && year !== null;
  const duzenlenebilir = draft !== null
    && (draft.status === "OPEN" || draft.status === "REJECTED");
  const turAdi = DRAFT_KIND_LABELS[kind];      // "haftalık program" / "sınav takvimi"
  const satirAdi = DRAFT_ROW_LABELS[kind];     // "yerleşim" / "sınav"

  const hata = (e: unknown, varsayilan: string) =>
    notifications.show({
      color: "red", message: e instanceof ApiError ? e.message : varsayilan,
    });

  const acTaslak = async () => {
    if (!cohortHazir) return;
    setBusy(true);
    try { await onCreate(); } finally { setBusy(false); }
  };

  const temizle = async (ortaklarDahil: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.post<DraftClearResponse>(
        `/schedule-drafts/${draft.id}/clear`, { include_shared: ortaklarDahil },
      );
      onChanged();
      notifications.show({
        color: "gray",
        message: `${r.deleted} ${satirAdi} silindi`
          + (r.preserved_shared
            ? ` · ${r.preserved_shared} ortak ders korundu (silmek için "ortaklar dahil")`
            : ""),
      });
    } catch (e) {
      hata(e, "Temizlenemedi");
    } finally {
      setBusy(false);
    }
  };

  const farkiGoster = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.get<DraftDiff>(`/schedule-drafts/${draft.id}/diff`);
      setDiff(r.items);
    } catch (e) {
      hata(e, "Fark alınamadı");
    } finally {
      setBusy(false);
    }
  };

  const geriCek = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const d = await api.post<ScheduleDraft>(`/schedule-drafts/${draft.id}/withdraw`);
      onSelect(d);
      notifications.show({ color: "gray", message: "Talep geri çekildi — taslak yeniden düzenlenebilir" });
    } catch (e) {
      hata(e, "Geri çekilemedi");
    } finally {
      setBusy(false);
    }
  };

  const sil = async () => {
    if (!draft) return;
    if (!window.confirm(
      `"${draft.name}" taslağı silinsin mi? Yayındaki ${turAdi} etkilenmez.`
    )) return;
    setBusy(true);
    try {
      await api.delete(`/schedule-drafts/${draft.id}`);
      onSelect(null);
      notifications.show({ color: "gray", message: "Taslak silindi" });
    } catch (e) {
      hata(e, "Silinemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Paper radius="md" px="md" py={8}
        style={{
          // Taslaktayken çubuk RENKLENİR: kullanıcının "şu an yayına mı
          // yazıyorum" sorusunu hiç sormaması gerekir. Ton iki temada ayrı
          // (scheduleTheme) — koyu temada açık sarı ekranı yırtıyordu.
          border: `1px solid ${draft ? DRAFT_BORDER : BORDER}`,
          boxShadow: SHADOW,
          background: draft ? DRAFT_SURFACE : undefined,
        }}>
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap={10} wrap="nowrap">
            {draft ? (
              <>
                <Badge color={DRAFT_STATUS_COLORS[draft.status]} variant="filled" size="sm">
                  {DRAFT_STATUS_LABELS[draft.status]}
                </Badge>
                <Text size="sm" fw={600}>{draft.name}</Text>
                <Text size="sm" c="dimmed">
                  {draft.change_count
                    ? `${draft.change_count} değişiklik`
                    : `yayındaki ${turAdi} ile aynı`}
                </Text>
              </>
            ) : (
              <>
                <IconLock size={15} style={{ opacity: 0.55 }} />
                <Text size="sm" fw={600}>
                  Yayındaki {kind === "EXAM" ? "sınav takvimi" : "program"}
                </Text>
                <Text size="sm" c="dimmed">
                  salt-okunur — değişiklik için taslak açın
                </Text>
              </>
            )}
          </Group>

          <Group gap={6} wrap="nowrap">
            {!draft && (
              <Tooltip
                label={cohortHazir
                  ? `Yayındaki ${turAdi} kopyalanarak açılır; yalnız siz görürsünüz`
                  : "Önce bölüm ve sınıf seçin (ortak dersler görünümünde taslak açılmaz)"}>
                <Button size="xs" radius="md" loading={busy} disabled={!cohortHazir}
                  leftSection={<IconPlus size={15} />} style={{ height: CONTROL_H }}
                  onClick={acTaslak}>
                  Taslak Aç
                </Button>
              </Tooltip>
            )}

            {draft && (
              <>
                <Button size="xs" radius="md" variant="default" loading={busy}
                  leftSection={<IconGitCompare size={15} />} style={{ height: CONTROL_H }}
                  onClick={farkiGoster}>
                  Farkı Gör
                </Button>

                {duzenlenebilir && (
                  <>
                    <Tooltip label="Taslağı boşalt — ortak dersler korunur">
                      <Button size="xs" radius="md" variant="default" loading={busy}
                        leftSection={<IconEraser size={15} />} style={{ height: CONTROL_H }}
                        onClick={() => temizle(false)}>
                        Temizle
                      </Button>
                    </Tooltip>
                    <Tooltip label={canSubmit
                      ? "Onay yetkilisi inceleyip yayına alacak"
                      : `Onaya göndermek için ${kind === "EXAM" ? "sınav" : "haftalık program"}`
                        + " yetkisi ve bu bölümde üyelik gerekir"}>
                      <Button size="xs" radius="md" loading={busy}
                        disabled={!canSubmit || draft.change_count === 0}
                        leftSection={<IconSend size={15} />} style={{ height: CONTROL_H }}
                        onClick={() => setSubmitOpen(true)}>
                        Onaya Gönder
                      </Button>
                    </Tooltip>
                    <Tooltip label="Taslağı sil (yayına etkisi yok)">
                      <Button size="xs" radius="md" variant="subtle" color="red" loading={busy}
                        style={{ height: CONTROL_H }} onClick={sil}>
                        <IconTrash size={15} />
                      </Button>
                    </Tooltip>
                  </>
                )}

                {draft.status === "PENDING" && (
                  <Button size="xs" radius="md" variant="default" loading={busy}
                    leftSection={<IconArrowBackUp size={15} />} style={{ height: CONTROL_H }}
                    onClick={geriCek}>
                    Geri Çek
                  </Button>
                )}

                <Button size="xs" radius="md" variant="subtle" style={{ height: CONTROL_H }}
                  onClick={() => onSelect(null)}>
                  Yayına Dön
                </Button>
              </>
            )}
          </Group>
        </Group>

        {draft?.status === "PENDING" && (
          <Text size="xs" c="dimmed" mt={6}>
            Onay bekliyor — inceleme sürerken taslak kilitlidir. Düzenlemek için geri çekin.
          </Text>
        )}
        {draft?.status === "REJECTED" && draft.review_note && (
          <Alert color="red" variant="light" mt={8} py={6} icon={<IconAlertTriangle size={16} />}>
            <Text size="sm" fw={600}>
              Reddedildi{draft.reviewer ? ` — ${draft.reviewer.name}` : ""}
            </Text>
            <Text size="sm">{draft.review_note}</Text>
          </Alert>
        )}
      </Paper>

      <DiffModal items={diff} turAdi={turAdi} onClose={() => setDiff(null)} />
      {submitOpen && draft && (
        <SubmitModal
          draft={draft}
          turAdi={turAdi}
          onClose={() => setSubmitOpen(false)}
          onDone={(d) => { setSubmitOpen(false); onSelect(d); }}
        />
      )}
    </>
  );
}


/** Taslak sahibinin "Farkı Gör" penceresi. Tablo onaylayıcının inceleme
 *  ekranıyla ORTAK (DiffTable) — ikisi ayrı çizilseydi zamanla ayrışırdı. */
function DiffModal({ items, turAdi, onClose }: {
  items: DraftDiffItem[] | null;
  turAdi: string;
  onClose: () => void;
}) {
  return (
    <Modal opened={items !== null} onClose={onClose} size="lg" radius="md"
      title={`Yayındaki ${turAdi} ile fark`}>
      {items && <DiffTable items={items} />}
    </Modal>
  );
}


/** Onaya gönderme kapısı (K-59). HARD çakışma varsa sunucu 409 döner ve talep
 *  HİÇ oluşmaz — onay kuyruğu baştan bozuk taleplerle dolmasın (K-03 aynen). */
function SubmitModal({ draft, turAdi, onClose, onDone }: {
  draft: ScheduleDraft;
  turAdi: string;
  onClose: () => void;
  onDone: (d: ScheduleDraft) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);

  const gonder = async () => {
    setBusy(true);
    setBlockers(null);
    try {
      const r = await api.post<{ draft: ScheduleDraft; warnings: ConflictResult[] }>(
        `/schedule-drafts/${draft.id}/submit`, { note: note.trim() || null },
      );
      notifications.show({
        color: "green",
        title: "Onaya gönderildi",
        message: r.warnings.length
          ? `${r.warnings.length} uyarı var ama engellemiyor — onaylayıcı görecek`
          : "Bir onay yetkilisi inceleyip yayına alacak",
      });
      onDone(r.draft);
    } catch (err) {
      // 409 gövdesi {detail, conflicts} taşır — listeyi modalda açık bırakırız
      // ki kullanıcı neyi düzelteceğini görsün, düzeltip tekrar denesin.
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : "Gönderilemedi",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} radius="md" title="Onaya gönder">
      <Stack gap="sm">
        <Text size="sm">
          <b>{draft.change_count}</b> değişiklik onaya gönderilecek. Onaylanana
          kadar yayındaki {turAdi} değişmez; taslak inceleme boyunca kilitlenir.
        </Text>
        <Textarea
          label="Not (isteğe bağlı)"
          description="Onaylayıcı bunu görecek — neden değiştirdiğinizi yazın"
          placeholder="Örn. 3. sınıf laboratuvarı Çarşamba kapalı olduğu için kaydırıldı"
          autosize minRows={2} maxRows={5}
          value={note} onChange={(e) => setNote(e.currentTarget.value)}
        />
        {blockers && (
          <Alert color="red" variant="light" title="Gönderilemedi — hard çakışma">
            <Stack gap={2}>
              {blockers.map((c, i) => (
                <Text key={i} size="sm">{c.rule_id} · {c.message}</Text>
              ))}
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Vazgeç</Button>
          <Button onClick={gonder} loading={busy} leftSection={<IconPencil size={15} />}>
            {blockers ? "Tekrar dene" : "Gönder"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
