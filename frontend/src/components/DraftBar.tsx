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
  DRAFT_STATUS_COLORS, } from "../api/types";
import {
  ApproverPicker, approversReady, useApproverCandidates,
} from "./ApproverPicker";
import DiffTable from "./DiffTable";
import type {
  ConflictResult, DraftClearResponse, DraftDiff, DraftDiffItem, DraftKind,
  ScheduleChange, ScheduleDraft, SemesterType,
} from "../api/types";
import { CONTROL_H } from "../utils/scheduleTheme";
import { useT } from "../i18n";

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
  const t = useT();
  const turAdi = t.draft.kind[kind];
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
          {t.draft.status[draft.status]}
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
        {t.draft.publishedOf(turAdi)}
      </Text>
      {/* K-73: bu yayını kim düzenledi/onayladı, ne zaman yayınlandı. */}
      <HoverCard width={280} shadow="md" position="bottom-start" withArrow openDelay={100}>
        <HoverCard.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" radius="xl" aria-label={t.draft.publishInfo}>
            <IconInfoCircle size={16} />
          </ActionIcon>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          {pubInfo === undefined ? (
            <Text size="xs" c="dimmed">{t.draft.loading}</Text>
          ) : pubInfo === null ? (
            <Text size="xs" c="dimmed">
              {t.draft.noApprovedChange(turAdi)}
            </Text>
          ) : (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">{t.draft.publishedOf(turAdi)}</Text>
              <Text size="sm"><b>{t.draft.editedBy}</b> {pubInfo.published_by}</Text>
              <Text size="sm"><b>{t.draft.approvedBy}</b> {pubInfo.approved_by ?? "—"}</Text>
              <Text size="sm">
                <b>{t.draft.publishedAt}</b>{" "}
                {pubInfo.published_at
                  ? new Date(pubInfo.published_at).toLocaleString(t.locale, {
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DraftDiffItem[] | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [mevcut, setMevcut] = useState<ScheduleDraft | null>(null);
  /** K-81: "bu cohortta açık taslağım var mı?" sorusunun CEVABI GELDİ Mİ?
   *
   *  `mevcut` başlangıçta null ve sunucu turu bitene kadar null kalıyor; buton
   *  ise null'ı "taslak yok" diye okuyup FİLLED "Taslak Aç" çiziyordu. Yani
   *  cevap gelene dek ekranda yanlış ve TIKLANABİLİR bir buton duruyordu:
   *  "Yayına Dön" dedikten hemen sonra hızlı tıklayan kullanıcı yeni taslak
   *  yaratmayı deniyor ve sunucudan "bu cohort için zaten açık taslağınız var"
   *  hatasını alıyordu. Hata doğruydu ama kullanıcı hiç o duruma düşmemeliydi.
   *
   *  Üç seçenek vardı: (a) butonu `loading` yapmak — etiket yine yanlış kalır,
   *  (b) etiketi son bilinen değerde tutmak — cohort değişince o da yanlış,
   *  (c) cevap gelene kadar HİÇ çizmemek. (c) seçildi: bilinmeyen bir durumu
   *  temsil eden doğru görsel, boşluktur. */
  const [mevcutCozuldu, setMevcutCozuldu] = useState(false);
  // K-76: "Temizle" artık önce sorar — ortak dersler de silinsin mi?
  const [clearOpen, setClearOpen] = useState(false);
  const [clearShared, setClearShared] = useState(false);

  const cohortHazir = departmentId !== null && year !== null;
  const duzenlenebilir = draft !== null
    && (draft.status === "OPEN" || draft.status === "REJECTED");
  const turAdi = t.draft.kind[kind];
  const satirAdi = t.draft.row[kind];

  useEffect(() => {
    // Cohort seçili değilse sorulacak bir şey yok — buton "önce cohort seç"
    // diye pasif duruyor, o hâli göstermek için beklemeye gerek yok.
    if (draft || !cohortHazir) { setMevcut(null); setMevcutCozuldu(!cohortHazir); return; }
    let iptal = false;
    setMevcutCozuldu(false);
    api.get<ScheduleDraft[]>("/schedule-drafts")
      .then((liste) => {
        if (iptal) return;
        setMevcut(liste.find((d) => d.kind === kind
          && d.department_id === departmentId
          && d.year === year && d.semester === semester) ?? null);
      })
      // Akış ikincil; liste alınamazsa "yeni aç" davranışına düşülür. Kapıyı
      // yine de AÇMAK gerekir, yoksa buton sonsuza dek görünmez kalır.
      .catch(() => { /* yut */ })
      .finally(() => { if (!iptal) setMevcutCozuldu(true); });
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
        message: t.draft.cleared(r.deleted, satirAdi)
          + (r.preserved_shared ? t.draft.preservedShared(r.preserved_shared) : ""),
      });
    } catch (e) { hata(e, t.draft.clearFailed); } finally { setBusy(false); }
  };

  const farkiGoster = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await api.get<DraftDiff>(`/schedule-drafts/${draft.id}/diff`);
      setDiff(r.items);
    } catch (e) { hata(e, t.draft.diffFailed); } finally { setBusy(false); }
  };

  const geriCek = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const d = await api.post<ScheduleDraft>(`/schedule-drafts/${draft.id}/withdraw`);
      onSelect(d);
      notifications.show({ color: "gray", message: t.draft.withdrawn });
    } catch (e) { hata(e, t.draft.withdrawFailed); } finally { setBusy(false); }
  };

  const sil = async () => {
    if (!draft) return;
    if (!window.confirm(
      t.draft.deleteConfirm(draft.name, turAdi))) return;
    setBusy(true);
    try {
      await api.delete(`/schedule-drafts/${draft.id}`);
      onSelect(null);
      notifications.show({ color: "gray", message: t.draft.deleted });
    } catch (e) { hata(e, t.draft.deleteFailed); } finally { setBusy(false); }
  };

  return (
    <>
      {!draft && mevcutCozuldu && (
        <Tooltip
          label={!cohortHazir
            ? t.draft.pickCohortFirst
            : mevcut
            ? t.draft.returnToDraftTip(mevcut.change_count)
            : t.draft.openDraftTip(turAdi)}>
          {/* K-74: buton metninden sayı kaldırıldı — taslakta sayı tutmaya gerek yok. */}
          <Button size="xs" radius="md" loading={busy} disabled={!cohortHazir}
            variant={mevcut ? "light" : "filled"}
            leftSection={mevcut ? <IconPencil size={15} /> : <IconPlus size={15} />}
            style={{ height: CONTROL_H }} onClick={acTaslak}>
            {mevcut ? t.draft.returnToDraft : t.draft.openDraft}
          </Button>
        </Tooltip>
      )}

      {draft && (
        <>
          {/* K-74: Farkı Gör ve Temizle yalnız simge (yazılar kaldırıldı). */}
          <Tooltip label={t.draft.seeDiff}>
            <ActionIcon variant="default" radius="md" loading={busy}
              style={{ width: CONTROL_H, height: CONTROL_H }}
              onClick={farkiGoster} aria-label={t.draft.seeDiff}>
              <IconGitCompare size={16} />
            </ActionIcon>
          </Tooltip>

          {duzenlenebilir && (
            <Tooltip label={t.draft.emptyDraft}>
              <ActionIcon variant="default" radius="md" loading={busy}
                style={{ width: CONTROL_H, height: CONTROL_H }}
                onClick={() => { setClearShared(false); setClearOpen(true); }} aria-label={t.draft.clear}>
                <IconEraser size={16} />
              </ActionIcon>
            </Tooltip>
          )}

          {duzenlenebilir && (
            // K-76: çerçeveli (outline) + kırmızı; tooltip'ten "yayına etkisi yok" çıktı.
            <Tooltip label={t.draft.deleteDraft}>
              <ActionIcon variant="outline" color="red" radius="md" loading={busy}
                style={{ width: CONTROL_H, height: CONTROL_H }}
                onClick={sil} aria-label={t.draft.deleteDraft}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          )}

          {draft.status === "PENDING" && (
            <Button size="xs" radius="md" variant="default" loading={busy}
              leftSection={<IconArrowBackUp size={15} />} style={{ height: CONTROL_H }}
              onClick={geriCek}>
              {t.draft.withdraw}
            </Button>
          )}

          {/* K-76: çerçeveli (default) — eskiden subtle çerçevesizdi. */}
          <Button size="xs" radius="md" variant="default" style={{ height: CONTROL_H }}
            onClick={() => onSelect(null)}>
            {t.draft.backToPublished}
          </Button>

          {/* K-74: Onaya Gönder — birincil eylem, EN SAĞDA. */}
          {duzenlenebilir && (
            <Tooltip label={canSubmit
              ? t.draft.submitTip
              : t.draft.submitDeniedTip(turAdi)}>
              {/* K-80: `loading={busy}` KALDIRILDI. `busy` çubuğun ORTAK
                  state'i; "Değişiklikler" isteği onu true yapınca Mantine bu
                  butonu da loading'e sokuyor ve loading görünümü `disabled`
                  görünümünü ezdiği için buton bir an AKTİF görünüyordu. Bu
                  butonun kendi async işi zaten yok — yalnız modal açıyor. */}
              <Button size="xs" radius="md"
                disabled={!canSubmit || draft.change_count === 0}
                leftSection={<IconSend size={15} />} style={{ height: CONTROL_H }}
                onClick={() => setSubmitOpen(true)}>
                {t.draft.submit}
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
        title={t.draft.emptyDraft}>
        <Stack gap="sm">
          <Text size="sm">
            {t.draft.clearBody(t.draft.rowsPlural[kind], turAdi)}
          </Text>
          <Checkbox
            checked={clearShared}
            onChange={(e) => setClearShared(e.currentTarget.checked)}
            label={t.draft.clearShared}
            description={t.draft.clearSharedHelp}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setClearOpen(false)}>{t.common.dismiss}</Button>
            <Button color="red" loading={busy} onClick={() => temizle(clearShared)}>
              {t.draft.empty}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}


/** Çubuğun altındaki ince bilgi satırı — yalnız PENDING/REJECTED'de görünür. */
export function DraftNotes({ draft }: { draft: ScheduleDraft | null }) {
  const t = useT();
  if (draft?.status === "PENDING") {
    return (
      <Text size="xs" c="dimmed">
        {t.draft.pendingNote}
      </Text>
    );
  }
  if (draft?.status === "REJECTED" && draft.review_note) {
    return (
      <Alert color="red" variant="light" py={6} icon={<IconAlertTriangle size={16} />}>
        <Text size="sm" fw={600}>
          {t.draft.rejected}{draft.reviewer ? ` — ${draft.reviewer.name}` : ""}
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
  const t = useT();
  return (
    <Modal opened={items !== null} onClose={onClose} size="lg" radius="md"
      title={t.draft.diffTitle(turAdi)}>
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
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);
  /** K-83: talebin adresi. Varsayılan BOŞ — seçim bilinçli olsun; hepsini
   *  önceden işaretlemek K-83 öncesi yayın davranışını geri getirirdi. */
  const [approverIds, setApproverIds] = useState<number[]>([]);
  // Pencere yalnız gönderilebilir taslakta açılır, o yüzden koşulsuz çekilir.
  const { list: adaylar, error: adayHata } = useApproverCandidates(draft.id, true);

  const gonder = async () => {
    setBusy(true);
    setBlockers(null);
    try {
      const r = await api.post<{ draft: ScheduleDraft; warnings: ConflictResult[] }>(
        `/schedule-drafts/${draft.id}/submit`, {
          note: note.trim() || null,
          // Havuz boşken `null`: "seçim yapılmadı" ile "kimseye gönderme" aynı
          // şey değil; sunucu null'ı "havuzun tamamı" diye okur (K-83).
          approver_ids: approverIds.length ? approverIds : null,
        });
      notifications.show({
        color: "green", title: t.draft.submitted,
        message: r.warnings.length
          ? t.draft.submittedWarnings(r.warnings.length)
          : t.draft.submittedOk,
      });
      onDone(r.draft);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      notifications.show({
        color: "red", message: err instanceof ApiError ? err.message : t.draft.submitFailed });
    } finally { setBusy(false); }
  };

  return (
    <Modal opened onClose={onClose} radius="md" title={t.draft.submitTitle}>
      <Stack gap="sm">
        <Text size="sm">
          <b>{draft.change_count}</b> değişiklik onaya gönderilecek. Onaylanana
          kadar yayındaki {turAdi} değişmez; taslak inceleme boyunca kilitlenir.
        </Text>
        {/* K-83: "kime" sorusu "ne diyeceğim"den önce gelir. */}
        <div>
          <Text size="sm" fw={600} mb={6}>{t.draft.approversTitle}</Text>
          <ApproverPicker list={adaylar} error={adayHata}
            value={approverIds} onChange={setApproverIds} />
        </div>
        <Textarea
          label={t.draft.noteLabel}
          description={t.draft.noteHelp}
          placeholder={t.draft.notePlaceholder}
          autosize minRows={2} maxRows={5}
          value={note} onChange={(e) => setNote(e.currentTarget.value)}
        />
        {blockers && (
          <Alert color="red" variant="light" title={t.draft.submitBlockedTitle}>
            <Stack gap={2}>
              {blockers.map((c, i) => (
                <Text key={i} size="sm">{c.rule_id} · {c.message}</Text>
              ))}
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>{t.common.dismiss}</Button>
          {/* Adres seçilmeden gönderilemez; havuz boşsa `approversReady`
              izin verir (adreslenecek kimse yokken kilitlemenin anlamı yok). */}
          <Tooltip label={t.draft.approversRequired}
            disabled={approversReady(adaylar, approverIds)}>
            <Button onClick={gonder} loading={busy}
              disabled={!approversReady(adaylar, approverIds)}
              leftSection={<IconPencil size={15} />}>
              {blockers ? t.draft.retry : t.draft.send}
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Modal>
  );
}
