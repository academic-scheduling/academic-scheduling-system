import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Badge, Button, Grid, Group, Loader, Modal, Paper, ScrollArea,
  Stack, Text, Textarea, TextInput, Title, Tooltip, UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle, IconArrowBackUp, IconCalendarWeek,
  IconCircleCheck, IconClockHour4, IconFilePencil, IconGitCompare, IconInbox,
  IconMinus, IconPencil, IconPlus, IconSearch, IconSend, IconTrash,
  IconUser, IconX, type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ProposedExamList, ProposedGrid } from "../components/ProposedSchedule";
import { examPlacementText, placementText } from "../components/DiffTable";
import {
  DRAFT_KIND_LABELS, } from "../api/types";
import type {
  ConflictResult, ConflictScan, DraftApproveResponse, DraftDiffItem,
  DraftKind, DraftReview, DraftStaleness, DraftStatus, Exam, ScheduleDraft,
  SemesterType, WeeklyEntry,
} from "../api/types";
import { BORDER, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/* ==================================================================
 * K-77 · Yayın Merkezi — Taslaklarım + Onay Bekleyenler tek ekranda
 *
 * İki eski sayfa (DraftsPage "kendi kuyruğum", ApprovalsPage "onay kuyruğu")
 * aynı yaşam döngüsünün (OPEN→PENDING→APPROVED|REJECTED) iki ucuydu; kullanıcı
 * ikisi arasında gidip geliyordu. Burada tek master-detail: solda durum-gruplu
 * kuyruk, sağda seçili kaydın tam incelemesi + kararı.
 *
 * GÖRÜNÜRLÜK K-59 gizliliğine SADIK (kullanıcı kararı): Taslaklar/Reddedilenler/
 * Yayında yalnız BENİM kayıtlarım (`/schedule-drafts`); Onay bekleyenler ise
 * onaylayıcıysam kapsamımdaki tüm kuyruk (`/schedule-approvals`), değilsem yalnız
 * kendi bekleyen taleplerim. Bu yüzden gruplar arası görünürlük asimetriktir —
 * backend'in gerçek yetki modeli budur, mock'taki "herkesin havuzu" değil.
 * ================================================================== */

type Group = "PENDING" | "OPEN" | "REJECTED" | "APPROVED";

const STATUS_META: Record<DraftStatus,
  { label: string; color: string; Icon: ComponentType<IconProps> }> = {
  OPEN:     { label: "Taslak",        color: "yellow", Icon: IconFilePencil },
  PENDING:  { label: "Onay bekliyor", color: "blue",   Icon: IconClockHour4 },
  REJECTED: { label: "Reddedildi",    color: "red",    Icon: IconArrowBackUp },
  APPROVED: { label: "Yayında",       color: "green",  Icon: IconCircleCheck },
};

const GROUPS: { key: Group; label: string; color: string; Icon: ComponentType<IconProps> }[] = [
  { key: "PENDING",  label: "Onay bekleyenler", color: "blue",   Icon: IconClockHour4 },
  { key: "OPEN",     label: "Taslaklar",        color: "yellow", Icon: IconFilePencil },
  { key: "REJECTED", label: "Reddedilenler",    color: "red",    Icon: IconArrowBackUp },
  { key: "APPROVED", label: "Yayında",          color: "green",  Icon: IconCircleCheck },
];

/** Kart görünümü Bölümler ekranıyla AYNI (`.dept-card`): hover/seçili durumu
 *  pseudo-class gerektirdiği için inline style ile verilemiyor. */
const CARD_STYLES = `
.pub-card {
  border: 1px solid var(--mantine-color-default-border);
  border-left: 3px solid transparent;
  border-radius: var(--mantine-radius-md);
  background: var(--mantine-color-body);
  transition: box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.pub-card:hover {
  border-color: var(--mantine-color-blue-4);
  box-shadow: 0 4px 14px rgba(0,0,0,0.08);
  transform: translateY(-1px);
}
.pub-card[data-selected="true"] {
  border-left-color: var(--mantine-color-blue-filled);
  background: var(--mantine-color-blue-light);
  box-shadow: 0 6px 20px rgba(0,0,0,0.10);
}
`;

function tarih(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("tr-TR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function cohortAdi(d: { department_name: string; year: number; semester: SemesterType }, t: Dict): string {
  return `${d.department_name} · ${d.year}. sınıf · ${t.enums.semester[d.semester]}`;
}

/** Sıralama anahtarı: bekleyende gönderim, ötekilerde açılış zamanı. */
function ts(d: ScheduleDraft): number {
  return new Date(d.submitted_at ?? d.created_at).getTime();
}

/** Detay panelinin tek biçimi — kaynağı (inceleme ucu / taslak uçları) ne olursa
 *  olsun aynı şekli doldurur; APPROVED'da satırlar yayına geçip silindiği için
 *  fark/ızgara yerine `applied_summary` gösterilir. */
type Detail = {
  approved: boolean;
  items: DraftDiffItem[];
  entries: WeeklyEntry[];
  exams: Exam[];
  conflicts: ConflictScan;
  staleness: DraftStaleness | null;
};

const EMPTY_SCAN: ConflictScan = { hard: [], warnings: [] };


export default function PublishingCenterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isApprover = !!user?.can_approve_schedule;

  const [myDrafts, setMyDrafts] = useState<ScheduleDraft[] | null>(null);
  const [queue, setQueue] = useState<ScheduleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<Group>("PENDING");
  const [search, setSearch] = useState("");
  const [selId, setSelId] = useState<number | null>(
    params.get("draft_id") ? Number(params.get("draft_id")) : null);

  const load = () => {
    const jobs: Promise<unknown>[] = [
      api.get<ScheduleDraft[]>("/schedule-drafts?include_history=true")
        .then(setMyDrafts),
    ];
    if (isApprover) {
      jobs.push(api.get<ScheduleDraft[]>("/schedule-approvals").then(setQueue));
    }
    Promise.all(jobs)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Yayın Merkezi yüklenemedi"));
    // Sol menüdeki bekleyen rozetini de tazele.
    window.dispatchEvent(new Event("publishing:refresh"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [isApprover]);

  /** Durum gruplarına ayrılmış havuz. PENDING onaylayıcıda kuyruktan, ötekiler
   *  daima "benim taslaklarım"dan gelir (K-59 gizliliği). */
  const byGroup = useMemo(() => {
    const mine = myDrafts ?? [];
    const pending = isApprover ? queue : mine.filter((d) => d.status === "PENDING");
    return {
      PENDING: pending,
      OPEN: mine.filter((d) => d.status === "OPEN"),
      REJECTED: mine.filter((d) => d.status === "REJECTED"),
      APPROVED: mine.filter((d) => d.status === "APPROVED"),
    } as Record<Group, ScheduleDraft[]>;
  }, [myDrafts, queue, isApprover]);

  const list = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr");
    return byGroup[group]
      .filter((d) => !q
        || `${d.department_name} ${d.owner.name}`.toLocaleLowerCase("tr").includes(q))
      .sort((a, b) => ts(b) - ts(a));      // sıralama seçici YOK — daima en yeni önce
  }, [byGroup, group, search]);

  const cur = useMemo(
    () => list.find((d) => d.id === selId) ?? list[0] ?? null,
    [list, selId]);

  // Seçili kaydı URL'e yansıt (derin bağlantı + yenilemede korunur).
  useEffect(() => {
    if (cur && String(cur.id) !== params.get("draft_id")) {
      const next = new URLSearchParams(params);
      next.set("draft_id", String(cur.id));
      setParams(next, { replace: true });
    }
  }, [cur, params, setParams]);

  const loaded = myDrafts !== null;

  return (
    <>
      <style>{CARD_STYLES}</style>
      <Grid gutter="lg" align="stretch" columns={100}>
        {/* ================= SOL: kuyruk ================= */}
        <Grid.Col span={{ base: 100, md: 34, lg: 26 }}>
          <QueuePane
            group={group} onGroup={setGroup}
            counts={Object.fromEntries(
              GROUPS.map((g) => [g.key, byGroup[g.key].length])) as Record<Group, number>}
            search={search} onSearch={setSearch}
            list={list} loaded={loaded} error={error}
            curId={cur?.id ?? null} onSelect={setSelId}
            meId={user?.id ?? -1}
          />
        </Grid.Col>

        {/* ================= SAĞ: inceleme + karar ================= */}
        <Grid.Col span={{ base: 100, md: 66, lg: 74 }}>
          {cur
            ? <DetailPane key={cur.id} draft={cur} isApprover={isApprover}
                meId={user?.id ?? -1} onChanged={load} onNavigate={navigate} />
            : <EmptyDetail loaded={loaded} />}
        </Grid.Col>
      </Grid>
    </>
  );
}


/* ==================================================================
 * Sol: durum-gruplu kuyruk
 * ================================================================== */

function QueuePane({
  group, onGroup, counts, search, onSearch, list, loaded, error, curId, onSelect, meId,
}: {
  group: Group; onGroup: (g: Group) => void; counts: Record<Group, number>;
  search: string; onSearch: (s: string) => void;
  list: ScheduleDraft[]; loaded: boolean; error: string | null;
  curId: number | null; onSelect: (id: number) => void; meId: number;
}) {
  return (
    <Stack gap="sm">
      <Title order={4}>Yayın Merkezi</Title>

      {/* Durum grupları (sıralama seçici YOK — grup içinde daima en yeni önce). */}
      <Stack gap={2}>
        {GROUPS.map((g) => {
          const on = group === g.key;
          return (
            <Button key={g.key} variant={on ? "light" : "subtle"} color={on ? g.color : "gray"}
              size="sm" radius="md" leftSection={<g.Icon size={16} />}
              rightSection={
                <Text fz={12} c={on ? undefined : TEXT_MUTED}
                  style={{ fontVariantNumeric: "tabular-nums" }}>{counts[g.key]}</Text>}
              styles={{ inner: { justifyContent: "space-between" },
                label: { fontWeight: on ? 600 : 500 } }}
              onClick={() => onGroup(g.key)}>
              {g.label}
            </Button>
          );
        })}
      </Stack>

      <TextInput
        placeholder="Ara"
        value={search}
        leftSection={<IconSearch size={16} />}
        onChange={(e) => onSearch(e.currentTarget.value)}
      />

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
      {!loaded && !error && <Loader size="sm" />}

      {loaded && list.length === 0 ? (
        <Text c="dimmed" size="sm" mt="xs">
          {search ? "Eşleşen kayıt yok." : "Bu grupta kayıt yok."}
        </Text>
      ) : (
        <ScrollArea.Autosize mah="calc(100vh - 220px)" type="hover">
          <Stack gap="xs">
            {list.map((d) => (
              <QueueCard key={d.id} d={d} active={d.id === curId}
                mine={d.owner.id === meId} onClick={() => onSelect(d.id)} />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}

function QueueCard({ d, active, mine, onClick }: {
  d: ScheduleDraft; active: boolean; mine: boolean; onClick: () => void;
}) {
  const meta = STATUS_META[d.status];
  const KindIcon = d.kind === "EXAM" ? IconPencil : IconCalendarWeek;
  return (
    <UnstyledButton className="pub-card" data-selected={active} onClick={onClick} p="md">
      <Group gap={8} wrap="nowrap" mb={5}>
        <KindIcon size={15} color="var(--mantine-color-dimmed)" style={{ flex: "none" }} />
        <Text fz={13} fw={700} truncate>{d.department_name} · {d.year}. sınıf</Text>
      </Group>
      <Group gap={6} wrap="nowrap" c={TEXT_MUTED} fz={11} mb={3}>
        <IconUser size={12} style={{ flex: "none" }} />
        <Text fz={11} truncate style={{ flex: 1, minWidth: 0 }}>{d.owner.name}</Text>
        <Text fz={11} style={{ flex: "none", whiteSpace: "nowrap" }}>
          {tarih(d.submitted_at ?? d.created_at)}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap" fz={11} c={TEXT_MUTED} mb={7}>
        <IconGitCompare size={12} style={{ flex: "none" }} />
        <Text fz={11} style={{ fontVariantNumeric: "tabular-nums" }}>
          {d.change_count} değişiklik
        </Text>
      </Group>
      <Group gap={5}>
        <Badge size="sm" variant="light" color={meta.color}
          leftSection={<meta.Icon size={12} />}>{meta.label}</Badge>
        {mine && <Badge size="sm" variant="light" color="gray">kendi talebiniz</Badge>}
      </Group>
    </UnstyledButton>
  );
}

/* ==================================================================
 * Sağ: seçili kaydın incelemesi + kararı
 * ================================================================== */

function EmptyDetail({ loaded }: { loaded: boolean }) {
  return (
    <Paper withBorder radius="md" p="xl" style={{ minHeight: 360 }}>
      <Stack align="center" justify="center" gap="sm" h={320} c="dimmed">
        <IconInbox size={34} style={{ opacity: 0.35 }} />
        <Text fz="sm" c="dimmed">
          {loaded ? "İncelemek için soldan bir kayıt seçin." : "Yükleniyor…"}
        </Text>
      </Stack>
    </Paper>
  );
}

function DetailPane({ draft, isApprover, meId, onChanged, onNavigate }: {
  draft: ScheduleDraft; isApprover: boolean; meId: number;
  onChanged: () => void; onNavigate: (to: string) => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);

  const isSelf = draft.owner.id === meId;
  // İncelenebilir = onaylayıcı + PENDING (kuyruk kaydı; kendi bekleyenim de dahil).
  const reviewable = isApprover && draft.status === "PENDING";

  useEffect(() => {
    let iptal = false;
    setDetail(null);
    setDetailError(null);
    setBlockers(null);

    const fail = (e: unknown) =>
      !iptal && setDetailError(e instanceof ApiError ? e.message : "İnceleme yüklenemedi");

    if (draft.status === "APPROVED") {
      // Satırlar yayına geçip silindi; canlı fark/ızgara yok, özet gösterilir.
      setDetail({ approved: true, items: [], entries: [], exams: [], conflicts: EMPTY_SCAN, staleness: null });
      return;
    }
    if (reviewable) {
      api.get<DraftReview>(`/schedule-approvals/${draft.id}`)
        .then((r) => { if (!iptal) setDetail({
          approved: false, items: r.items, entries: r.entries, exams: r.exams,
          conflicts: r.conflicts, staleness: r.staleness }); })
        .catch(fail);
    } else {
      // Kendi taslağım: fark + çakışma + satırlar ayrı uçlardan.
      const rows = draft.kind === "EXAM"
        ? api.get<Exam[]>(`/schedule-drafts/${draft.id}/exams`)
            .then((exams) => ({ entries: [] as WeeklyEntry[], exams }))
        : api.get<WeeklyEntry[]>(`/schedule-drafts/${draft.id}/entries`)
            .then((entries) => ({ entries, exams: [] as Exam[] }));
      Promise.all([
        api.get<{ items: DraftDiffItem[] }>(`/schedule-drafts/${draft.id}/diff`),
        api.get<ConflictScan>(`/schedule-drafts/${draft.id}/conflicts`),
        rows,
      ]).then(([diff, conflicts, r]) => {
        if (!iptal) setDetail({ approved: false, items: diff.items,
          entries: r.entries, exams: r.exams, conflicts, staleness: null });
      }).catch(fail);
    }
    return () => { iptal = true; };
  }, [draft.id, draft.status, draft.kind, reviewable]);

  const hata = (e: unknown, varsayilan: string) =>
    notifications.show({ color: "red", message: e instanceof ApiError ? e.message : varsayilan });

  const goProgram = (edit: boolean) => {
    const path = draft.kind === "EXAM" ? "/exams" : "/weekly";
    onNavigate(`${path}?department_id=${draft.department_id}&year=${draft.year}`
      + `&semester=${draft.semester}` + (edit ? `&draft_id=${draft.id}` : ""));
  };

  const onayla = async () => {
    setBusy(true); setBlockers(null);
    try {
      const r = await api.post<DraftApproveResponse>(`/schedule-approvals/${draft.id}/approve`);
      notifications.show({ color: "green", title: "Yayına alındı",
        message: `${r.applied.length} değişiklik uygulandı`
          + (r.warnings.length ? ` · ${r.warnings.length} uyarı görünür kaldı` : "") });
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      hata(e, "Onaylanamadı");
    } finally { setBusy(false); }
  };

  const geriCek = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-drafts/${draft.id}/withdraw`);
      notifications.show({ color: "gray", message: "Talep geri çekildi — taslak yeniden düzenlenebilir" });
      onChanged();
    } catch (e) { hata(e, "Geri çekilemedi"); } finally { setBusy(false); }
  };

  const sil = async () => {
    if (!window.confirm(`"${draft.name}" taslağı silinsin mi? Yayındaki program etkilenmez.`)) return;
    setBusy(true);
    try {
      await api.delete(`/schedule-drafts/${draft.id}`);
      notifications.show({ color: "gray", message: "Taslak silindi" });
      onChanged();
    } catch (e) { hata(e, "Silinemedi"); } finally { setBusy(false); }
  };

  const meta = STATUS_META[draft.status];
  const hard = detail?.conflicts.hard.length ?? 0;
  const warn = detail?.conflicts.warnings.length ?? 0;
  const sinav = draft.kind === "EXAM";

  return (
    <>
      {/* Başlık + durum + adım çubuğu */}
      <div style={{ paddingBottom: 12, marginBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
        <Group gap={9} align="center">
          <Text fz={20} fw={700} truncate>{cohortAdi(draft, t)}</Text>
          <Badge variant="light" color={meta.color} leftSection={<meta.Icon size={13} />}>
            {meta.label}
          </Badge>
        </Group>
        <Text fz={13} c={TEXT_MUTED} mt={3}>
          {sinav ? "Sınav takvimi" : "Haftalık ders programı"} · gönderen {draft.owner.name}
          {" · "}{tarih(draft.submitted_at ?? draft.created_at)}
          {" · "}{draft.change_count} değişiklik
        </Text>
        <StatusSteps status={draft.status} isApprover={isApprover} />
      </div>

      <div>
        <Stack gap={18}>
          {detailError && <Alert color="red" variant="light" radius="md">{detailError}</Alert>}
          {!detail && !detailError && <Loader size="sm" />}

          {detail?.approved && (
            <Alert color="green" variant="light" radius="md" icon={<IconCircleCheck size={18} />}
              title="Bu değişiklik yayında">
              <Text fz="sm">{draft.applied_summary || "Değişiklikler yayına alındı."}</Text>
            </Alert>
          )}

          {detail && !detail.approved && (
            <>
              {detail.staleness && detail.staleness.publications_since > 0 && (
                <Alert color="orange" variant="light" radius="md"
                  icon={<IconAlertTriangle size={18} />} title="Bu taslak güncel olmayabilir">
                  <Text size="sm">
                    Taslak {tarih(detail.staleness.opened_at)} tarihinde açıldı; yayındaki{" "}
                    {DRAFT_KIND_LABELS[draft.kind]} o tarihten sonra{" "}
                    <b>{detail.staleness.publications_since} kez</b> güncellendi
                    {detail.staleness.last_published_by
                      && ` (son: ${detail.staleness.last_published_by})`}. Aşağıdaki listede
                    onaylanırsa <b>geri alınacak</b> değişiklikler de olabilir.
                  </Text>
                </Alert>
              )}

              {/* İstatistik hücreleri */}
              <Group grow gap={0} style={{
                border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden" }}>
                <StatCell label="DEĞİŞİKLİK" value={String(detail.items.length)} />
                <StatCell label="ENGEL" value={String(hard)} color={hard ? "red.7" : undefined} border />
                <StatCell label="UYARI" value={String(warn)} color={warn ? "orange.7" : undefined} border />
                <StatCell label="DÖNEM" value={`${draft.year}. / ${t.enums.semester[draft.semester]}`} border />
              </Group>

              {/* Program görüntüsü */}
              <div>
                <Group gap={14} mb={8} align="center">
                  <Text fz={12} fw={600} c={TEXT_MUTED}>PROGRAM GÖRÜNTÜSÜ</Text>
                  <div style={{ flex: 1 }} />
                  <Legend swatch="light-blue" label="eklenen" />
                  <Legend swatch="gray" label="mevcut" />
                </Group>
                <Paper withBorder radius="md" p="sm">
                  {sinav
                    ? <ProposedExamList exams={detail.exams} changed={detail.items} />
                    : <ProposedGrid entries={detail.entries} changed={detail.items} />}
                </Paper>
              </div>

              {/* Değişiklikler + çakışma / gönderen-karar */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
                <div>
                  <Text fz={12} fw={600} c={TEXT_MUTED} mb={8}>DEĞİŞİKLİKLER</Text>
                  <ChangesList items={detail.items} />

                  <Text fz={12} fw={600} c={TEXT_MUTED} mt={16} mb={8}>ÇAKIŞMA KONTROLÜ</Text>
                  <ConflictList scan={detail.conflicts} blockers={blockers} />
                </div>

                <div>
                  <Text fz={12} fw={600} c={TEXT_MUTED} mb={8}>GÖNDEREN VE KARAR</Text>
                  <DeciderCard draft={draft} />
                  {rejectOpen && (
                    <RejectPanel draftId={draft.id}
                      onDone={() => { setRejectOpen(false); onChanged(); }}
                      onCancel={() => setRejectOpen(false)} />
                  )}
                </div>
              </div>
            </>
          )}
        </Stack>
      </div>

      {/* Eylem çubuğu — duruma göre */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, rowGap: 8, marginTop: 18,
        paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
        {reviewable && !isSelf && (
          <>
            <Tooltip label={hard ? "Hard çakışma çözülmeden onaylanamaz" : "Değişiklikleri yayına al"}>
              <Button leftSection={<IconCircleCheck size={16} />} loading={busy}
                disabled={hard > 0} onClick={onayla}>
                {hard > 0 ? `${hard} engel giderilmeli` : "Onayla ve yayınla"}
              </Button>
            </Tooltip>
            <Button variant="default" color="red" leftSection={<IconX size={15} />}
              onClick={() => setRejectOpen(true)}
              style={{ color: "var(--mantine-color-red-7)" }}>Reddet</Button>
          </>
        )}
        {reviewable && isSelf && (
          <>
            <Button variant="light" color="gray" leftSection={<IconArrowBackUp size={15} />}
              loading={busy} onClick={geriCek}>Geri çek</Button>
            <Text fz="xs" c="dimmed" style={{ alignSelf: "center" }}>
              Kendi talebinizi onaylayamazsınız — başka bir onay yetkilisi incelemeli.
            </Text>
          </>
        )}
        {!reviewable && draft.status === "PENDING" && (
          <Button variant="light" color="gray" leftSection={<IconArrowBackUp size={15} />}
            loading={busy} onClick={geriCek}>Geri çek</Button>
        )}
        {(draft.status === "OPEN" || draft.status === "REJECTED") && (
          <>
            <Button leftSection={<IconSend size={15} />} onClick={() => setSubmitOpen(true)}>
              Onaya gönder
            </Button>
            <Button variant="default" leftSection={<IconPencil size={15} />}
              onClick={() => goProgram(true)}>Programda düzenle</Button>
            <Button variant="default" color="red" leftSection={<IconTrash size={15} />}
              loading={busy} onClick={sil} style={{ color: "var(--mantine-color-red-7)" }}>Sil</Button>
          </>
        )}
        <div style={{ flex: 1 }} />
        {/* Düzenlenebilir taslakta "Programda düzenle" zaten görüntülemeyi kapsar;
            "Programda gör" yalnız düzenlenemeyen (bekleyen/yayında) kayıtlarda. */}
        {draft.status !== "OPEN" && draft.status !== "REJECTED" && (
          <Button variant="subtle" color="gray" leftSection={<IconCalendarWeek size={15} />}
            onClick={() => goProgram(false)}>Programda gör</Button>
        )}
      </div>

      {submitOpen && (
        <SubmitModal draftId={draft.id} onClose={() => setSubmitOpen(false)}
          onDone={() => { setSubmitOpen(false); onChanged(); }} />
      )}
    </>
  );
}


/* --- Detay parçaları --------------------------------------------- */

function StatCell({ label, value, color, border }: {
  label: string; value: string; color?: string; border?: boolean;
}) {
  return (
    <div style={{ padding: "10px 13px",
      borderLeft: border ? `1px solid ${BORDER}` : undefined }}>
      <Text fz={11} fw={600} c={TEXT_MUTED}>{label}</Text>
      <Text fz={17} fw={700} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</Text>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: "light-blue" | "gray"; label: string }) {
  const bg = swatch === "light-blue"
    ? "var(--mantine-color-blue-light)" : "var(--mantine-color-gray-light)";
  return (
    <Group gap={6} wrap="nowrap">
      <span style={{ width: 11, height: 11, borderRadius: 3, background: bg,
        border: `1px solid ${BORDER}` }} />
      <Text fz={11} c={TEXT_MUTED}>{label}</Text>
    </Group>
  );
}

function StatusSteps({ status, isApprover }: { status: DraftStatus; isApprover: boolean }) {
  // OPEN/REJECTED taslak evresinde, PENDING onayda, APPROVED yayında.
  const at = status === "APPROVED" ? 2 : status === "PENDING" ? 1 : 0;
  const note = status === "REJECTED" ? "reddedildi — düzeltip yeniden gönderilebilir"
    : status === "PENDING" ? (isApprover ? "kararınızı bekliyor" : "yöneticinin kararını bekliyor")
    : status === "APPROVED" ? "öğrenciye görünür, kilitli" : "öğrenciye görünmez";
  return (
    <Group gap={0} mt={12} align="center" wrap="nowrap">
      {["Taslak", "Onayda", "Yayında"].map((label, i) => {
        const done = i < at, on = i === at;
        const color = done ? "green" : on ? "blue" : "gray";
        return (
          <Group key={label} gap={0} wrap="nowrap" style={{ flex: "none" }}>
            <Group gap={8} wrap="nowrap">
              <Badge size="sm" circle variant={on || done ? "light" : "default"} color={color}>
                {i + 1}
              </Badge>
              <Text fz={12} fw={on ? 700 : 500}
                c={on ? "blue" : done ? undefined : "dimmed"}>{label}</Text>
            </Group>
            {i < 2 && <span style={{ width: 44, height: 2, margin: "0 10px",
              background: i < at ? "var(--mantine-color-green-3)" : "var(--mantine-color-gray-3)" }} />}
          </Group>
        );
      })}
      <Text fz={12} c={TEXT_MUTED} ml={12}>{note}</Text>
    </Group>
  );
}

const CH_META: Record<string, { Icon: ComponentType<IconProps>; tag: string; color: string }> = {
  ADDED:   { Icon: IconPlus,   tag: "EKLENDİ",    color: "blue" },
  MOVED:   { Icon: IconPencil, tag: "TAŞINDI",    color: "yellow" },
  REMOVED: { Icon: IconMinus,  tag: "KALDIRILDI", color: "red" },
};

function ChangesList({ items }: { items: DraftDiffItem[] }) {
  const t = useT();
  if (items.length === 0) {
    return <Text fz="sm" c="dimmed">Taslak yayındaki programla birebir aynı.</Text>;
  }
  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {items.map((i, ix) => {
        const m = CH_META[i.kind];
        const sinav = i.entity === "exam";
        const kimlik = sinav
          ? `${i.course_code} · ${t.enums.examType[i.exam_type]}`
            + (i.exam_type === "MIDTERM" && i.exam_index > 1 ? ` ${i.exam_index}` : "")
          : `${i.course_code} · Şube ${i.section_no}`;
        const once = sinav ? examPlacementText(i.before) : placementText(i.before, t);
        const sonra = sinav ? examPlacementText(i.after) : placementText(i.after, t);
        const detay = i.kind === "ADDED" ? sonra : i.kind === "REMOVED" ? once : `${once} → ${sonra}`;
        return (
          <Group key={`${i.entity}-${kimlik}-${i.kind}-${ix}`} gap={9} align="flex-start" wrap="nowrap"
            style={{ padding: "9px 12px",
              borderTop: ix ? `1px solid ${BORDER}` : undefined }}>
            <Badge size="sm" circle variant="light" color={m.color} style={{ flex: "none" }}>
              <m.Icon size={12} />
            </Badge>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text fz={13} lh={1.4}>{kimlik}</Text>
              <Text fz={11} c={TEXT_MUTED} mt={2}>{detay}</Text>
              {i.is_shared && (
                <Text fz={11} c="orange.7" mt={2}>
                  Ortak ders — etkilenen: {i.affected_departments.map((d) => d.name).join(", ") || "—"}
                </Text>
              )}
            </div>
            <Text fz={10} fw={700} c={`${m.color}.7`} style={{ flex: "none", letterSpacing: ".3px" }}>
              {m.tag}
            </Text>
          </Group>
        );
      })}
    </Paper>
  );
}

function ConflictList({ scan, blockers }: { scan: ConflictScan; blockers: ConflictResult[] | null }) {
  const rows: { c: ConflictResult; hard: boolean }[] = [
    ...(blockers ?? []).map((c) => ({ c, hard: true })),
    ...scan.hard.map((c) => ({ c, hard: true })),
    ...scan.warnings.map((c) => ({ c, hard: false })),
  ];
  if (rows.length === 0) {
    return (
      <Group gap={8} p="10px 11px" style={{
        border: "1px solid var(--mantine-color-green-3)", borderRadius: 6,
        background: "var(--mantine-color-green-light)" }}>
        <IconCircleCheck size={16} color="var(--mantine-color-green-7)" />
        <Text fz={13} c="green.8">Engelleyici çakışma yok — yayınlanabilir.</Text>
      </Group>
    );
  }
  return (
    <Stack gap={7}>
      {blockers && (
        <Text fz={11} c="red.7" fw={600}>Onaylanamadı — talep güncel programla çakışıyor:</Text>
      )}
      {rows.map(({ c, hard }, i) => (
        <Group key={i} gap={9} align="flex-start" wrap="nowrap" p="9px 11px"
          style={{ borderRadius: 6,
            border: `1px solid ${hard ? "var(--mantine-color-red-3)" : "var(--mantine-color-orange-3)"}`,
            background: hard ? "var(--mantine-color-red-light)" : "var(--mantine-color-orange-light)" }}>
          <Badge size="sm" variant="filled" color={hard ? "red" : "orange"} style={{ flex: "none" }}>
            {c.rule_id}
          </Badge>
          <Text fz={13} c={TEXT_MUTED} lh={1.45}>{c.message}</Text>
        </Group>
      ))}
    </Stack>
  );
}

function DeciderCard({ draft }: { draft: ScheduleDraft }) {
  const decided = draft.status === "APPROVED" || draft.status === "REJECTED";
  const rejected = draft.status === "REJECTED";
  const note = rejected ? draft.review_note : draft.applied_summary;
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap={12}>
        <Group gap={10} wrap="nowrap">
          <Badge size="lg" circle variant="light" color="blue"><IconSend size={15} /></Badge>
          <div style={{ minWidth: 0 }}>
            <Text fz={11} fw={600} c={TEXT_MUTED}>GÖNDEREN</Text>
            <Text fz={13} fw={600} truncate>{draft.owner.name}</Text>
            <Text fz={11} c="dimmed">{tarih(draft.submitted_at ?? draft.created_at)}</Text>
          </div>
        </Group>
        <div style={{ height: 1, background: BORDER }} />
        <Group gap={10} wrap="nowrap">
          <Badge size="lg" circle variant="light"
            color={decided ? (rejected ? "red" : "green") : "gray"}>
            {decided ? (rejected ? <IconX size={15} /> : <IconCircleCheck size={15} />)
              : <IconClockHour4 size={15} />}
          </Badge>
          <div style={{ minWidth: 0 }}>
            <Text fz={11} fw={600} c={TEXT_MUTED}>
              {decided ? (rejected ? "REDDEDEN" : "ONAYLAYAN") : "KARAR"}
            </Text>
            <Text fz={13} fw={600} truncate>
              {decided ? (draft.reviewer?.name ?? "—") : "Henüz karar verilmedi"}
            </Text>
            <Text fz={11} c="dimmed">
              {decided ? tarih(draft.reviewed_at) : "onay bekliyor"}
            </Text>
          </div>
        </Group>
        {decided && note && (
          <Text fz={12} c={TEXT_MUTED} p="8px 10px" style={{ borderRadius: 4,
            background: "var(--mantine-color-default-hover)" }}>{note}</Text>
        )}
      </Stack>
    </Paper>
  );
}


/* --- Karar formları ---------------------------------------------- */

function RejectPanel({ draftId, onDone, onCancel }: {
  draftId: number; onDone: () => void; onCancel: () => void;
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
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "Reddedilemedi" });
    } finally { setBusy(false); }
  };
  return (
    <Paper radius="md" p="md" mt="md" style={{
      border: "1px solid var(--mantine-color-red-3)", background: "var(--mantine-color-red-light)" }}>
      <Text fz={12} fw={600} c="red.7" mb={7}>RET GEREKÇESİ</Text>
      <Textarea placeholder="Sahibine iletilecek not" autosize minRows={3} maxRows={6}
        value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Group gap={8} mt={9}>
        <Button color="red" loading={busy} disabled={!note.trim()}
          leftSection={<IconSend size={15} />} onClick={reddet}>Reddet ve bildir</Button>
        <Button variant="default" onClick={onCancel}>Vazgeç</Button>
      </Group>
    </Paper>
  );
}

function SubmitModal({ draftId, onClose, onDone }: {
  draftId: number; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const gonder = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-drafts/${draftId}/submit`, { note: note.trim() || null });
      notifications.show({ color: "green", message: "Onaya gönderildi" });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { conflicts?: ConflictResult[]; detail?: string } | null;
        const msg = body?.conflicts?.length
          ? `Hard çakışma nedeniyle gönderilemedi: ${body.conflicts.map((c) => c.rule_id).join(", ")}`
          : (body?.detail ?? e.message);
        notifications.show({ color: "red", message: msg });
        return;
      }
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : "Gönderilemedi" });
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} radius="md" title="Onaya gönder">
      <Stack gap="sm">
        <Textarea label="Açıklama (opsiyonel)"
          description="Onaylayıcı bu notu görecek — neyi neden değiştirdiğinizi kısaca yazabilirsiniz"
          placeholder="Örn. CENG2030 iki şubeye bölündü, ikinci şubeye Can Demir atandı"
          autosize minRows={3} maxRows={6}
          value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Vazgeç</Button>
          <Button loading={busy} leftSection={<IconSend size={15} />} onClick={gonder}>
            Onaya gönder
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
