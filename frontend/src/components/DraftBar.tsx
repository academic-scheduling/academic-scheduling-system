import { useEffect, useState } from "react";
import {
  ActionIcon, Alert, Badge, Button, Checkbox, Group, HoverCard, Modal, Stack, Text,
  Textarea, Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconArrowBackUp, IconEraser, IconGitCompare, IconInfoCircle,
  IconPencil, IconPlus, IconSend, IconTrash,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import {
  DRAFT_KIND_LABELS, DRAFT_ROW_LABELS, DRAFT_STATUS_COLORS, DRAFT_STATUS_LABELS,
} from "../api/types";
import DiffTable from "./DiffTable";
import type {
  ConflictResult, DraftClearResponse, DraftDiff, DraftDiffItem, DraftKind,
  ScheduleChange, ScheduleDraft, SemesterType,
} from "../api/types";
import { CONTROL_H } from "../utils/scheduleTheme";

/** K-74: Mod çubuğu tek bir "bar" değil artık — parçaları sayfanın en üstteki
 *  araç çubuğuna gömülür (ayrı ikinci bar kalabalıktı). Üç parça:
 *    DraftStatus  — cohort seçicilerin SAĞINA: "Yayındaki program" (+i) ya da
 *                   taslaktaysa durum rozeti + değişiklik sayısı (cohort TEKRAR
 *                   yazılmaz, seçicilerde zaten var).
 *    DraftActions — sağdaki eylem grubuna: Taslak Aç/Dön ya da taslak butonları.
 *    DraftNotes   — çubuğun ALTINA (yalnız PENDING/REJECTED): ince bilgi satırı.
 */

type CohortProps = {
  departmentId: number | null;
  year: number | null;
  semester: SemesterType;
  kind: DraftKind;
  draft: ScheduleDraft | null;
};


/** Cohort seçicilerin sağındaki durum göstergesi. */
export function DraftStatus({ departmentId, year, semester, kind, draft }: CohortProps) {
  const turAdi = DRAFT_KIND_LABELS[kind];
  const cohortHazir = departmentId !== null && year !== null;
  // K-73: yayın modunda "i" pop-up'ı için son APPROVED taslağın meta verisi.
  const [pubInfo, setPubInfo] = useState<ScheduleChange | null | undefined>(undefined);

  useEffect(() => {
    if (draft || !cohortHazir) { setPubInfo(undefined); return; }
    let iptal = false;
    setPubInfo(undefined);
    api.get<ScheduleChange[]>(
      `/schedule-changes?limit=1&kind=${kind}&department_id=${departmentId}`
      + `&year=${year}&semester=${semester}`)
      .then((liste) => { if (!iptal) setPubInfo(liste[0] ?? null); })
      .catch(() => { if (!iptal) setPubInfo(null); });
    return () => { iptal = true; };
  }, [draft, cohortHazir, departmentId, year, semester, kind]);

  if (draft) {
    // K-74: cohort adını (draft.name) TEKRAR yazma — seçicilerde zaten var.
    return (
      <Group gap={8} wrap="nowrap">
        <Badge color={DRAFT_STATUS_COLORS[draft.status]} variant="filled" size="sm">
          {DRAFT_STATUS_LABELS[draft.status]}
        </Badge>
        {/* K-74: "yayındaki ... ile aynı" metni kaldırıldı — değişiklik varken
            yalnız sayaç, yokken hiçbir şey (rozet zaten taslağı belli ediyor). */}
        {draft.change_count > 0 && (
          <Text size="sm" c="dimmed">{draft.change_count} değişiklik</Text>
        )}
      </Group>
    );
  }

  return (
    <Group gap={6} wrap="nowrap">
      <Text size="sm" fw={600}>
        Yayındaki {kind === "EXAM" ? "sınav takvimi" : "program"}
      </Text>
      {/* K-73: bu yayını kim düzenledi/onayladı, ne zaman yayınlandı. */}
      <HoverCard width={280} shadow="md" position="bottom-start" withArrow openDelay={100}>
        <HoverCard.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" radius="xl" aria-label="Yayın bilgisi">
            <IconInfoCircle size={16} />
          </ActionIcon>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          {pubInfo === undefined ? (
            <Text size="xs" c="dimmed">Yükleniyor…</Text>
          ) : pubInfo === null ? (
            <Text size="xs" c="dimmed">
              Bu {turAdi} için henüz onaylı bir değişiklik yok. Değişiklik için taslak açın.
            </Text>
          ) : (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">Yayındaki {turAdi}</Text>
              <Text size="sm"><b>Düzenleyen:</b> {pubInfo.published_by}</Text>
              <Text size="sm"><b>Onaylayan:</b> {pubInfo.approved_by ?? "—"}</Text>
              <Text size="sm">
                <b>Yayınlanma:</b>{" "}
                {pubInfo.published_at
                  ? new Date(pubInfo.published_at).toLocaleString("tr-TR", {
                      day: "2-digit", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </Text>
            </Stack>
          )}
        </HoverCard.Dropdown>
      </HoverCard>
    </Group>
  );
}


export type DraftActionsProps = CohortProps & {
  onSelect: (draft: ScheduleDraft | null) => void;
  onCreate: () => Promise<void>;
  onChanged: () => void;
  canSubmit: boolean;
};

/** Sağdaki eylem grubu: yayın modunda "Taslak Aç/Dön", taslakta taslak butonları. */
export function DraftActions({
  departmentId, year, semester, kind, draft, onSelect, onCreate, onChanged, canSubmit,
}: DraftActionsProps) {
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DraftDiffItem[] | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [mevcut, setMevcut] = useState<ScheduleDraft | null>(null);
  // K-76: "Temizle" artık önce sorar — ortak dersler de silinsin mi?
  const [clearOpen, setClearOpen] = useState(false);
  const [clearShared, setClearShared] = useState(false);

  const cohortHazir = departmentId !== null && year !== null;
  const duzenlenebilir = draft !== null
    && (draft.status === "OPEN" || draft.status === "REJECTED");
  const turAdi = DRAFT_KIND_LABELS[kind];
  const satirAdi = DRAFT_ROW_LABELS[kind];

  useEffect(() => {
    if (draft || !cohortHazir) { setMevcut(null); return; }
    let iptal = false;
    api.get<ScheduleDraft[]>("/schedule-drafts")
      .then((liste) => {
        if (iptal) return;
        setMevcut(liste.find((d) => d.kind === kind
          && d.department_id === departmentId
          && d.year === year && d.semester === semester) ?? null);
      })
      .catch(() => { /* akış ikincil; bulunamazsa "yeni aç" davranışı kalır */ });
    return () => { iptal = true; };
  }, [draft, cohortHazir, departmentId, year, semester, kind]);

  const hata = (e: unknown, varsayilan: string) =>
    notifications.show({ color: "red", message: e instanceof ApiError ? e.message : varsayilan });

  const acTaslak = async () => {
    if (!cohortHazir) return;
    if (mevcut) { onSelect(mevcut); return; }   // açık taslak varsa ona dön (K-61)
    setBusy(true);
    try { await onCreate(); } finally { setBusy(false); }
  };

  const temizle = async (ortaklarDahil: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.post<DraftClearResponse>(
        `/schedule-drafts/${draft.id}/clear`, { include_shared: ortaklarDahil });
      onChanged();
      setClearOpen(false);
      notifications.show({
        color: "gray",
        message: `${r.deleted} ${satirAdi} silindi`
          + (r.preserved_shared
            ? ` · ${r.preserved_shared} ortak ders korundu`
            : ""),
      });
    } catch (e) { hata(e, "Temizlenemedi"); } finally { setBusy(false); }
  };

  const farkiGoster = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.get<DraftDiff>(`/schedule-drafts/${draft.id}/diff`);
      setDiff(r.items);
    } catch (e) { hata(e, "Fark alınamadı"); } finally { setBusy(false); }
  };

  const geriCek = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const d = await api.post<ScheduleDraft>(`/schedule-drafts/${draft.id}/withdraw`);
      onSelect(d);
      notifications.show({ color: "gray", message: "Talep geri çekildi — taslak yeniden düzenlenebilir" });
    } catch (e) { hata(e, "Geri çekilemedi"); } finally { setBusy(false); }
  };

  const sil = async () => {
    if (!draft) return;
    if (!window.confirm(
      `"${draft.name}" taslağı silinsin mi? Yayındaki ${turAdi} etkilenmez.`)) return;
    setBusy(true);
    try {
      await api.delete(`/schedule-drafts/${draft.id}`);
      onSelect(null);
      notifications.show({ color: "gray", message: "Taslak silindi" });
    } catch (e) { hata(e, "Silinemedi"); } finally { setBusy(false); }
  };

  return (
    <>
      {!draft && (
        <Tooltip
          label={!cohortHazir
            ? "Önce bölüm ve sınıf seçin (ortak dersler görünümünde taslak açılmaz)"
            : mevcut
            ? `Bu cohort için açık taslağınıza döner (${mevcut.change_count} değişiklik)`
            : `Yayındaki ${turAdi} kopyalanarak açılır; yalnız siz görürsünüz`}>
          {/* K-74: buton metninden sayı kaldırıldı — taslakta sayı tutmaya gerek yok. */}
          <Button size="xs" radius="md" loading={busy} disabled={!cohortHazir}
            variant={mevcut ? "light" : "filled"}
            leftSection={mevcut ? <IconPencil size={15} /> : <IconPlus size={15} />}
            style={{ height: CONTROL_H }} onClick={acTaslak}>
            {mevcut ? "Taslağa Dön" : "Taslak Aç"}
          </Button>
        </Tooltip>
      )}

      {draft && (
        <>
          {/* K-74: Farkı Gör ve Temizle yalnız simge (yazılar kaldırıldı). */}
          <Tooltip label="Farkı Gör">
            <ActionIcon variant="default" radius="md" loading={busy}
              style={{ width: CONTROL_H, height: CONTROL_H }}
              onClick={farkiGoster} aria-label="Farkı Gör">
              <IconGitCompare size={16} />
            </ActionIcon>
          </Tooltip>

          {duzenlenebilir && (
            <Tooltip label="Taslağı boşalt">
              <ActionIcon variant="default" radius="md" loading={busy}
                style={{ width: CONTROL_H, height: CONTROL_H }}
                onClick={() => { setClearShared(false); setClearOpen(true); }} aria-label="Temizle">
                <IconEraser size={16} />
              </ActionIcon>
            </Tooltip>
          )}

          {duzenlenebilir && (
            // K-76: çerçeveli (outline) + kırmızı; tooltip'ten "yayına etkisi yok" çıktı.
            <Tooltip label="Taslağı sil">
              <ActionIcon variant="outline" color="red" radius="md" loading={busy}
                style={{ width: CONTROL_H, height: CONTROL_H }}
                onClick={sil} aria-label="Taslağı sil">
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          )}

          {draft.status === "PENDING" && (
            <Button size="xs" radius="md" variant="default" loading={busy}
              leftSection={<IconArrowBackUp size={15} />} style={{ height: CONTROL_H }}
              onClick={geriCek}>
              Geri Çek
            </Button>
          )}

          {/* K-76: çerçeveli (default) — eskiden subtle çerçevesizdi. */}
          <Button size="xs" radius="md" variant="default" style={{ height: CONTROL_H }}
            onClick={() => onSelect(null)}>
            Yayına Dön
          </Button>

          {/* K-74: Onaya Gönder — birincil eylem, EN SAĞDA. */}
          {duzenlenebilir && (
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
          )}
        </>
      )}

      <DiffModal items={diff} turAdi={turAdi} onClose={() => setDiff(null)} />
      {submitOpen && draft && (
        <SubmitModal draft={draft} turAdi={turAdi}
          onClose={() => setSubmitOpen(false)}
          onDone={(d) => { setSubmitOpen(false); onSelect(d); }} />
      )}

      {/* K-76: Temizle onayı — ortak dersler de silinsin mi? */}
      <Modal opened={clearOpen} onClose={() => setClearOpen(false)} radius="md"
        title="Taslağı boşalt">
        <Stack gap="sm">
          <Text size="sm">
            Taslaktaki tüm {satirAdi}lar silinecek. Yayındaki {turAdi} etkilenmez.
          </Text>
          <Checkbox
            checked={clearShared}
            onChange={(e) => setClearShared(e.currentTarget.checked)}
            label="Ortak dersleri de sil"
            description="Bu cohort'taki ortak (servis) dersler de silinsin — onları alan diğer bölümlerin taslağını da etkileyebilir. İşaretlemezseniz ortak dersler korunur."
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setClearOpen(false)}>Vazgeç</Button>
            <Button color="red" loading={busy} onClick={() => temizle(clearShared)}>
              Boşalt
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}


/** Çubuğun altındaki ince bilgi satırı — yalnız PENDING/REJECTED'de görünür. */
export function DraftNotes({ draft }: { draft: ScheduleDraft | null }) {
  if (draft?.status === "PENDING") {
    return (
      <Text size="xs" c="dimmed">
        Onay bekliyor — inceleme sürerken taslak kilitlidir. Düzenlemek için geri çekin.
      </Text>
    );
  }
  if (draft?.status === "REJECTED" && draft.review_note) {
    return (
      <Alert color="red" variant="light" py={6} icon={<IconAlertTriangle size={16} />}>
        <Text size="sm" fw={600}>
          Reddedildi{draft.reviewer ? ` — ${draft.reviewer.name}` : ""}
        </Text>
        <Text size="sm">{draft.review_note}</Text>
      </Alert>
    );
  }
  return null;
}


/** Taslak sahibinin "Farkı Gör" penceresi (onaylayıcının inceleme ekranıyla ORTAK). */
function DiffModal({ items, turAdi, onClose }: {
  items: DraftDiffItem[] | null; turAdi: string; onClose: () => void;
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
  draft: ScheduleDraft; turAdi: string; onClose: () => void;
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
        `/schedule-drafts/${draft.id}/submit`, { note: note.trim() || null });
      notifications.show({
        color: "green", title: "Onaya gönderildi",
        message: r.warnings.length
          ? `${r.warnings.length} uyarı var ama engellemiyor — onaylayıcı görecek`
          : "Bir onay yetkilisi inceleyip yayına alacak",
      });
      onDone(r.draft);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      notifications.show({
        color: "red", message: err instanceof ApiError ? err.message : "Gönderilemedi" });
    } finally { setBusy(false); }
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
