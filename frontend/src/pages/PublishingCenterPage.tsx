import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Badge, Button, Grid, Group, Loader, Modal, Paper, ScrollArea,
  SegmentedControl, Stack, Text, Textarea, TextInput, Title, Tooltip,
  UnstyledButton,
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

/** K-79: yalnız RENK + İKON burada (dile bağlı değil); etiket sözlükte
 *  (`t.draft.status`), çünkü modül düzeyi dil değişimini göremez. */
const STATUS_META: Record<DraftStatus,
  { color: string; Icon: ComponentType<IconProps> }> = {
  OPEN:     { color: "yellow", Icon: IconFilePencil },
  PENDING:  { color: "blue",   Icon: IconClockHour4 },
  REJECTED: { color: "red",    Icon: IconArrowBackUp },
  APPROVED: { color: "green",  Icon: IconCircleCheck },
};

const GROUPS: { key: Group; color: string; Icon: ComponentType<IconProps> }[] = [
  { key: "PENDING",  color: "blue",   Icon: IconClockHour4 },
  { key: "OPEN",     color: "yellow", Icon: IconFilePencil },
  { key: "REJECTED", color: "red",    Icon: IconArrowBackUp },
  { key: "APPROVED", color: "green",  Icon: IconCircleCheck },
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

function tarih(s: string | null, t: Dict): string {
  if (!s) return "—";
  return new Date(s).toLocaleString(t.locale, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function cohortAdi(d: { department_name: string; year: number; semester: SemesterType }, t: Dict): string {
  return t.publishing.cohortName(d.department_name, d.year, t.enums.semester[d.semester]);
}

/** Sıralama anahtarı: bekleyende gönderim, ötekilerde açılış zamanı. */
function ts(d: ScheduleDraft): number {
  return new Date(d.submitted_at ?? d.created_at).getTime();
}

/** Detay panelinin tek biçimi — kaynağı (inceleme ucu / taslak uçları) ne olursa
 *  olsun aynı şekli doldurur.
 *
 *  K-80: APPROVED artık ızgara da gösteriyor. Satırlar onaydan sonra korunuyor
 *  (backend `apply_draft`), yani "bu taslak onaylandığında program neye
 *  benziyordu" sorusu cevaplanabilir. Ama FARK ve ÇAKIŞMA çekilmez: ikisi de
 *  O ANKİ yayına karşı hesaplanır ve sonraki onaylarla kayar — donmuş bir
 *  görüntünün yanında canlı bir fark göstermek yanıltıcı olurdu. Onay anındaki
 *  fark zaten `applied_summary`de dondurulmuştur. */
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
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isApprover = !!user?.can_approve_schedule;

  const [myDrafts, setMyDrafts] = useState<ScheduleDraft[] | null>(null);
  const [queue, setQueue] = useState<ScheduleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [group, setGroup] = useState<Group>("PENDING");
  const [search, setSearch] = useState("");
  /** K-80: tür süzgeci. Haftalık program ve sınav takvimi aynı kuyrukta akıyor
   *  (K-60 tek yaşam döngüsü) ama incelenirken ayrı işlerdir; süzgeç istemci
   *  tarafında, çünkü liste zaten elimizde (K-69 deseni). */
  const [kind, setKind] = useState<DraftKind | "ALL">("ALL");
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
      .catch((e) => setError(e instanceof ApiError ? e.message : t.publishing.loadFailed));
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
      .filter((d) => kind === "ALL" || d.kind === kind)
      // Arama bölüm KODUNU da kapsıyor (K-80): kod artık kartta görünen bilgi,
      // görünen bir şeyin aranamaması tutarsız olurdu.
      .filter((d) => !q
        || `${d.department_name} ${d.department_code} ${d.owner.name}`
             .toLocaleLowerCase("tr").includes(q))
      .sort((a, b) => ts(b) - ts(a));      // sıralama seçici YOK — daima en yeni önce
  }, [byGroup, group, search, kind]);

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
            kind={kind} onKind={setKind}
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
  group, onGroup, counts, search, onSearch, kind, onKind,
  list, loaded, error, curId, onSelect, meId,
}: {
  group: Group; onGroup: (g: Group) => void; counts: Record<Group, number>;
  search: string; onSearch: (s: string) => void;
  kind: DraftKind | "ALL"; onKind: (k: DraftKind | "ALL") => void;
  list: ScheduleDraft[]; loaded: boolean; error: string | null;
  curId: number | null; onSelect: (id: number) => void; meId: number;
}) {
  const t = useT();
  return (
    <Stack gap="sm">
      <Title order={4}>{t.publishing.title}</Title>

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
              {t.publishing.groups[g.key]}
            </Button>
          );
        })}
      </Stack>

      <TextInput
        placeholder={t.common.search}
        value={search}
        leftSection={<IconSearch size={16} />}
        onChange={(e) => onSearch(e.currentTarget.value)}
      />

      {/* K-80: tür süzgeci aramanın hemen altında — ikisi de "listeyi daralt"
          işidir, durum grupları ise "hangi kuyruk" işi (üstte kalır). */}
      <SegmentedControl
        fullWidth size="xs" radius="md"
        value={kind}
        onChange={(v: string) => onKind(v as DraftKind | "ALL")}
        data={[
          { value: "ALL", label: t.publishing.kindAll },
          { value: "WEEKLY", label: t.publishing.kindWeekly },
          { value: "EXAM", label: t.publishing.kindExam },
        ]}
      />

      {error && <Alert color="red" variant="light" radius="md">{error}</Alert>}
      {!loaded && !error && <Loader size="sm" />}

      {loaded && list.length === 0 ? (
        // Boş grup zaten boş görünür; yalnız ARAMA sonuçsuzsa açıklama gerekir
        // (kullanıcı bir şey yazdı, cevapsız kalmamalı).
        search ? <Text c="dimmed" size="sm" mt="xs">{t.publishing.noMatch}</Text> : null
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
  const t = useT();
  const meta = STATUS_META[d.status];
  const KindIcon = d.kind === "EXAM" ? IconPencil : IconCalendarWeek;
  return (
    <UnstyledButton className="pub-card" data-selected={active} onClick={onClick} p="md">
      {/* K-80: başlıkta bölüm KODU. Ad dar sütunda kırpılıyordu ("Bilgisayar
          Mühendis…"), kod ise kırpılmadan bölümü tekil olarak tanıtıyor; tam
          ad detay panelinde zaten yazıyor. */}
      <Group gap={8} wrap="nowrap" mb={5}>
        <KindIcon size={15} color="var(--mantine-color-dimmed)" style={{ flex: "none" }} />
        <Text fz={13} fw={700} truncate>{d.department_code} · {t.courses.yearN(d.year)}</Text>
      </Group>
      <Group gap={6} wrap="nowrap" c={TEXT_MUTED} fz={11} mb={3}>
        <IconUser size={12} style={{ flex: "none" }} />
        <Text fz={11} truncate style={{ flex: 1, minWidth: 0 }}>{d.owner.name}</Text>
        <Text fz={11} style={{ flex: "none", whiteSpace: "nowrap" }}>
          {tarih(d.submitted_at ?? d.created_at, t)}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap" fz={11} c={TEXT_MUTED} mb={7}>
        <IconGitCompare size={12} style={{ flex: "none" }} />
        <Text fz={11} style={{ fontVariantNumeric: "tabular-nums" }}>
          {t.publishing.changeCount(d.change_count)}
        </Text>
      </Group>
      <Group gap={5}>
        <Badge size="sm" variant="light" color={meta.color}
          leftSection={<meta.Icon size={12} />}>{t.draft.status[d.status]}</Badge>
        {mine && <Badge size="sm" variant="light" color="gray">{t.publishing.yourRequest}</Badge>}
      </Group>
    </UnstyledButton>
  );
}

/* ==================================================================
 * Sağ: seçili kaydın incelemesi + kararı
 * ================================================================== */

function EmptyDetail({ loaded }: { loaded: boolean }) {
  const t = useT();
  return (
    <Paper withBorder radius="md" p="xl" style={{ minHeight: 360 }}>
      <Stack align="center" justify="center" gap="sm" h={320} c="dimmed">
        <IconInbox size={34} style={{ opacity: 0.35 }} />
        <Text fz="sm" c="dimmed">
          {loaded ? t.publishing.pickOne : t.publishing.loading}
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
  const [submitOpen, setSubmitOpen] = useState(false);
  const [blockers, setBlockers] = useState<ConflictResult[] | null>(null);
  /** K-80: karar notu. Eskiden yalnız "Reddet"e basınca açılan bir paneldi;
   *  artık incelemenin parçası ve TEK alan iki karara birden hizmet ediyor —
   *  onayda isteğe bağlı, rette zorunlu (backend `review_note` ortak alan). */
  const [note, setNote] = useState("");

  const isSelf = draft.owner.id === meId;
  // İncelenebilir = onaylayıcı + PENDING (kuyruk kaydı; kendi bekleyenim de dahil).
  const reviewable = isApprover && draft.status === "PENDING";

  useEffect(() => {
    let iptal = false;
    setDetail(null);
    setDetailError(null);
    setBlockers(null);

    const fail = (e: unknown) =>
      !iptal && setDetailError(e instanceof ApiError ? e.message : t.publishing.detailFailed);

    if (draft.status === "APPROVED") {
      // K-80: yalnız SATIRLAR çekilir — fark/çakışma bilerek istenmiyor
      // (yukarıdaki `Detail` notu). Görüntü donmuştur, özet `applied_summary`.
      const rows = draft.kind === "EXAM"
        ? api.get<Exam[]>(`/schedule-drafts/${draft.id}/exams`)
            .then((exams) => ({ entries: [] as WeeklyEntry[], exams }))
        : api.get<WeeklyEntry[]>(`/schedule-drafts/${draft.id}/entries`)
            .then((entries) => ({ entries, exams: [] as Exam[] }));
      rows.then((r) => {
        if (!iptal) setDetail({ approved: true, items: [], entries: r.entries,
          exams: r.exams, conflicts: EMPTY_SCAN, staleness: null });
      }).catch(fail);
      return () => { iptal = true; };
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
      const r = await api.post<DraftApproveResponse>(
        `/schedule-approvals/${draft.id}/approve`, { note: note.trim() || null });
      notifications.show({ color: "green", title: t.publishing.published,
        message: t.publishing.appliedN(r.applied.length)
          + (r.warnings.length ? t.publishing.warningsRemain(r.warnings.length) : "") });
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { conflicts?: ConflictResult[] } | null;
        if (body?.conflicts?.length) { setBlockers(body.conflicts); return; }
      }
      hata(e, t.publishing.approveFailed);
    } finally { setBusy(false); }
  };

  const reddet = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-approvals/${draft.id}/reject`, { note: note.trim() });
      notifications.show({ color: "gray", message: t.publishing.rejected });
      onChanged();
    } catch (e) { hata(e, t.publishing.rejectFailed); } finally { setBusy(false); }
  };

  const geriCek = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-drafts/${draft.id}/withdraw`);
      notifications.show({ color: "gray", message: t.publishing.withdrawn });
      onChanged();
    } catch (e) { hata(e, t.publishing.withdrawFailed); } finally { setBusy(false); }
  };

  const sil = async () => {
    if (!window.confirm(t.publishing.deleteConfirm(draft.name))) return;
    setBusy(true);
    try {
      await api.delete(`/schedule-drafts/${draft.id}`);
      notifications.show({ color: "gray", message: t.publishing.deleted });
      onChanged();
    } catch (e) { hata(e, t.publishing.deleteFailed); } finally { setBusy(false); }
  };

  const meta = STATUS_META[draft.status];
  const hard = detail?.conflicts.hard.length ?? 0;
  const warn = detail?.conflicts.warnings.length ?? 0;
  const sinav = draft.kind === "EXAM";

  /** Sağ sütunun varlık koşulu (K-80): karar bizdeyse not yazılır, karar
   *  verilmişse kim/ne dedi okunur. İkisi de yoksa sütun HİÇ çizilmez. */
  const kararBizde = reviewable && !isSelf;
  const kararVerildi = draft.status === "REJECTED";
  const yanSutun = kararBizde || kararVerildi;

  return (
    <>
      {/* Başlık + durum.
          K-80: adım çubuğu ("1 Taslak — 2 Onayda — 3 Yayında" + açıklama)
          KALDIRILDI. Durum rozeti aynı bilgiyi tek bakışta veriyordu; üç adımlık
          şerit yer kaplayıp göz yoruyordu. Yerine VURGULANAN şey, incelerken
          gerçekten aranan iki bilgi: hangi TÜR program, kim ne zaman gönderdi. */}
      <div style={{ paddingBottom: 12, marginBottom: 16, borderBottom: `1px solid ${BORDER}` }}>
        <Group gap={9} align="center">
          <Text fz={20} fw={700} truncate>{cohortAdi(draft, t)}</Text>
          <Badge variant="light" color={meta.color} leftSection={<meta.Icon size={13} />}>
            {t.draft.status[draft.status]}
          </Badge>
        </Group>
        <Group gap={10} align="center" mt={7} wrap="nowrap">
          <Badge variant="light" color="gray" radius="sm"
            leftSection={sinav ? <IconPencil size={12} /> : <IconCalendarWeek size={12} />}>
            {sinav ? t.publishing.examSchedule : t.publishing.weeklySchedule}
          </Badge>
          {/* İsim ile fiilin sırası dile bağlı (K-79) — parçalanmaz, vurgu
              satırın tamamına verilir. */}
          <Text fz={13} fw={600} truncate>
            {draft.submitted_at
              ? t.publishing.sentByOn(draft.owner.name, tarih(draft.submitted_at, t))
              : t.publishing.openedByOn(draft.owner.name, tarih(draft.created_at, t))}
          </Text>
        </Group>
      </div>

      <div>
        <Stack gap={18}>
          {detailError && <Alert color="red" variant="light" radius="md">{detailError}</Alert>}
          {!detail && !detailError && <Loader size="sm" />}

          {/* ---- Yayında: onay anında donmuş görüntü (K-80) ----
              Fark ve çakışma YOK — ikisi de o anki yayına karşı hesaplanır ve
              sonraki onaylarla kayar. Onay anındaki değişiklikler
              `applied_summary`de dondurulmuştur, onu gösteriyoruz. */}
          {detail?.approved && (
            <>
              <Alert color="green" variant="light" radius="md" icon={<IconCircleCheck size={18} />}
                title={t.publishing.appliedTitle}>
                <Text fz={12} fw={600} c={TEXT_MUTED} mb={4}>
                  {t.publishing.appliedChangesTitle}
                </Text>
                <Text fz="sm">{draft.applied_summary || t.publishing.appliedFallback}</Text>
              </Alert>

              <div>
                <Group gap={10} mb={8} align="center">
                  <Text fz={12} fw={600} c={TEXT_MUTED}>{t.publishing.approvedGridTitle}</Text>
                  <Text fz={11} c={TEXT_MUTED}>{t.publishing.approvedGridNote}</Text>
                </Group>
                {/* `changed={[]}`: vurgulanacak fark yok. Onaylanan görüntüde
                    "eklenen/mevcut" ayrımı anlamsızdır — hepsi yayına geçti. */}
                <Paper withBorder radius="md" p="sm">
                  {sinav
                    ? <ProposedExamList exams={detail.exams} changed={[]} />
                    : <ProposedGrid entries={detail.entries} changed={[]} />}
                </Paper>
              </div>

              <DecisionCard draft={draft} />
            </>
          )}

          {detail && !detail.approved && (
            <>
              {detail.staleness && detail.staleness.publications_since > 0 && (
                <Alert color="orange" variant="light" radius="md"
                  icon={<IconAlertTriangle size={18} />} title={t.publishing.staleTitle}>
                  <Text size="sm">
                    {t.publishing.staleBody(tarih(detail.staleness.opened_at, t),
                                            t.draft.kind[draft.kind])}{" "}
                    <b>{t.publishing.staleTimes(detail.staleness.publications_since)}</b>{" "}
                    {t.publishing.staleUpdated}
                    {detail.staleness.last_published_by
                      && t.publishing.staleLastBy(detail.staleness.last_published_by)}.{" "}
                    {t.publishing.staleTail} <b>{t.publishing.staleWillRevert}</b>
                    {t.publishing.staleTail2}
                  </Text>
                </Alert>
              )}

              {/* İstatistik hücreleri */}
              <Group grow gap={0} style={{
                border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden" }}>
                <StatCell label={t.publishing.statChange} value={String(detail.items.length)} />
                <StatCell label={t.publishing.blockersCaps} value={String(hard)} color={hard ? "red.7" : undefined} border />
                <StatCell label={t.publishing.warningsCaps} value={String(warn)} color={warn ? "orange.7" : undefined} border />
                {/* K-80: "DÖNEM" yerine BÖLÜM kodu — yıl/dönem başlıkta zaten
                    yazıyor, kod ise kaydı tek başına tanıtan bilgi. */}
                <StatCell label={t.publishing.statDepartment} value={draft.department_code} border />
              </Group>

              {/* Program görüntüsü */}
              <div>
                <Group gap={14} mb={8} align="center">
                  <Text fz={12} fw={600} c={TEXT_MUTED}>{t.publishing.gridTitle}</Text>
                  <div style={{ flex: 1 }} />
                  <Legend swatch="light-blue" label={t.publishing.legendAdded} />
                  <Legend swatch="gray" label={t.publishing.legendExisting} />
                </Group>
                <Paper withBorder radius="md" p="sm">
                  {sinav
                    ? <ProposedExamList exams={detail.exams} changed={detail.items} />
                    : <ProposedGrid entries={detail.entries} changed={detail.items} />}
                </Paper>
              </div>

              {/* Değişiklikler + çakışma, yanında KARAR sütunu.
                  K-80: eski "GÖNDEREN VE KARAR" kartı HER durumda duruyordu ve
                  kararı verilmemiş kayıtlarda yarısı boştu ("Henüz karar
                  verilmedi"). Gönderen bilgisi başlığa taşındı; sağ sütun artık
                  yalnızca söyleyecek sözü olduğunda var:
                    - karar sırası bizdeyse  -> not kutusu,
                    - karar verilmişse       -> kim, ne zaman, notu ne.
                  Sütun yoksa fark listesi tüm genişliği alır. */}
              <div style={{ display: "grid", alignItems: "start", gap: 18,
                gridTemplateColumns: yanSutun
                  ? "minmax(0,1.35fr) minmax(0,1fr)" : "minmax(0,1fr)" }}>
                <div>
                  <Text fz={12} fw={600} c={TEXT_MUTED} mb={8}>{t.publishing.changesTitle}</Text>
                  <ChangesList items={detail.items} />

                  <Text fz={12} fw={600} c={TEXT_MUTED} mt={16} mb={8}>{t.publishing.conflictCheck}</Text>
                  <ConflictList scan={detail.conflicts} blockers={blockers} />
                </div>

                {kararBizde && (
                  <DecisionNotePanel value={note} onChange={setNote} />
                )}
                {kararVerildi && (
                  <div><DecisionCard draft={draft} /></div>
                )}
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
            <Tooltip label={hard ? t.publishing.hardBlocks : t.publishing.approveTip}>
              <Button leftSection={<IconCircleCheck size={16} />} loading={busy}
                disabled={hard > 0} onClick={onayla}>
                {hard > 0 ? t.publishing.blockersToFix(hard) : t.publishing.approve}
              </Button>
            </Tooltip>
            {/* K-80: ret artık ayrı bir panel AÇMIYOR — gerekçe kutusu zaten
                sağda duruyor. Gerekçesiz ret backend'de de reddedilir
                (`min_length=1`), buton boş notta kapalı kalır. */}
            <Tooltip label={note.trim() ? t.publishing.reject : t.publishing.rejectNeedsNote}>
              <Button variant="default" color="red" leftSection={<IconX size={15} />}
                loading={busy} disabled={!note.trim()} onClick={reddet}
                style={{ color: "var(--mantine-color-red-7)" }}>{t.publishing.reject}</Button>
            </Tooltip>
          </>
        )}
        {reviewable && isSelf && (
          <>
            <Button variant="light" color="gray" leftSection={<IconArrowBackUp size={15} />}
              loading={busy} onClick={geriCek}>{t.publishing.withdraw}</Button>
            <Text fz="xs" c="dimmed" style={{ alignSelf: "center" }}>
              {t.publishing.selfApprove}
            </Text>
          </>
        )}
        {!reviewable && draft.status === "PENDING" && (
          <Button variant="light" color="gray" leftSection={<IconArrowBackUp size={15} />}
            loading={busy} onClick={geriCek}>{t.publishing.withdraw}</Button>
        )}
        {(draft.status === "OPEN" || draft.status === "REJECTED") && (
          <>
            <Button leftSection={<IconSend size={15} />} onClick={() => setSubmitOpen(true)}>
              {t.publishing.submitForApproval}
            </Button>
            <Button variant="default" leftSection={<IconPencil size={15} />}
              onClick={() => goProgram(true)}>{t.publishing.editInSchedule}</Button>
            <Button variant="default" color="red" leftSection={<IconTrash size={15} />}
              loading={busy} onClick={sil} style={{ color: "var(--mantine-color-red-7)" }}>{t.common.delete}</Button>
          </>
        )}
        <div style={{ flex: 1 }} />
        {/* Düzenlenebilir taslakta "Programda düzenle" zaten görüntülemeyi kapsar;
            "Programda gör" yalnız düzenlenemeyen (bekleyen/yayında) kayıtlarda. */}
        {draft.status !== "OPEN" && draft.status !== "REJECTED" && (
          <Button variant="subtle" color="gray" leftSection={<IconCalendarWeek size={15} />}
            onClick={() => goProgram(false)}>{t.publishing.viewInSchedule}</Button>
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

// K-79: `tag` sözlüğe taşındı (etiket); ikon ve renk dile bağlı değil.
const CH_META: Record<string, { Icon: ComponentType<IconProps>; color: string }> = {
  ADDED:   { Icon: IconPlus,   color: "blue" },
  MOVED:   { Icon: IconPencil, color: "yellow" },
  REMOVED: { Icon: IconMinus,  color: "red" },
};

function ChangesList({ items }: { items: DraftDiffItem[] }) {
  const t = useT();
  if (items.length === 0) {
    return <Text fz="sm" c="dimmed">{t.publishing.identical}</Text>;
  }
  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      {items.map((i, ix) => {
        const m = CH_META[i.kind];
        const sinav = i.entity === "exam";
        const kimlik = sinav
          ? `${i.course_code} · ${t.enums.examType[i.exam_type]}`
            + (i.exam_type === "MIDTERM" && i.exam_index > 1 ? ` ${i.exam_index}` : "")
          : t.publishing.sectionOf(i.course_code, i.section_no);
        const once = sinav ? examPlacementText(i.before, t) : placementText(i.before, t);
        const sonra = sinav ? examPlacementText(i.after, t) : placementText(i.after, t);
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
                  {t.publishing.sharedAffected(
                    i.affected_departments.map((d) => d.name).join(", ") || "—")}
                </Text>
              )}
            </div>
            <Text fz={10} fw={700} c={`${m.color}.7`} style={{ flex: "none", letterSpacing: ".3px" }}>
              {t.publishing[i.kind === "ADDED" ? "chAdded" : i.kind === "MOVED" ? "chMoved" : "chRemoved"]}
            </Text>
          </Group>
        );
      })}
    </Paper>
  );
}

function ConflictList({ scan, blockers }: { scan: ConflictScan; blockers: ConflictResult[] | null }) {
  const t = useT();
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
        <Text fz={13} c="green.8">{t.publishing.noBlockers}</Text>
      </Group>
    );
  }
  return (
    <Stack gap={7}>
      {blockers && (
        <Text fz={11} c="red.7" fw={600}>{t.publishing.rejectedByConflict}</Text>
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

/** Kararı VERİLMİŞ kaydın kartı (K-80).
 *
 *  Yalnız karar verilmiş kayıtlarda çizilir; "Henüz karar verilmedi" gibi boş
 *  bir yarısı yoktur. Gönderen bilgisi burada tekrarlanmaz — başlıkta duruyor.
 *
 *  Not hem retten hem ONAYDAN gelebilir (backend `review_note` ortak alan);
 *  notu YAZANIN adı da yazılır, çünkü not bir kişinin sözüdür ve kimin
 *  söylediğini bilmeden ne yapılacağı belirsiz kalır. */
function DecisionCard({ draft }: { draft: ScheduleDraft }) {
  const t = useT();
  const rejected = draft.status === "REJECTED";
  const kim = draft.reviewer?.name ?? "—";
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap={11}>
        <Group gap={10} wrap="nowrap">
          <Badge size="lg" circle variant="light" color={rejected ? "red" : "green"}>
            {rejected ? <IconX size={15} /> : <IconCircleCheck size={15} />}
          </Badge>
          <div style={{ minWidth: 0 }}>
            <Text fz={11} fw={600} c={TEXT_MUTED}>
              {rejected ? t.publishing.decidedByReject : t.publishing.decidedByApprove}
            </Text>
            <Text fz={13} fw={600} truncate>{kim}</Text>
            <Text fz={11} c="dimmed">{tarih(draft.reviewed_at, t)}</Text>
          </div>
        </Group>
        {draft.review_note && (
          <div style={{ borderRadius: 4, padding: "8px 10px",
            background: rejected ? "var(--mantine-color-red-light)"
                                 : "var(--mantine-color-default-hover)" }}>
            <Text fz={11} fw={600} c={TEXT_MUTED} mb={3}>
              {t.publishing.decisionNoteTitle}
            </Text>
            <Text fz={12.5} lh={1.5}>{draft.review_note}</Text>
            <Text fz={11} c="dimmed" mt={4}>{t.publishing.noteBy(kim)}</Text>
          </div>
        )}
      </Stack>
    </Paper>
  );
}

/** Karar sırası BİZDEYKEN duran not kutusu (K-80).
 *
 *  Eskiden yalnız "Reddet"e basınca açılan bir paneldi; onaylarken not yazmanın
 *  yolu hiç yoktu. Tek kutu iki karara da hizmet ediyor: onayda isteğe bağlı,
 *  rette zorunlu (Reddet butonu boş notta kapalı). */
function DecisionNotePanel({ value, onChange }: {
  value: string; onChange: (s: string) => void;
}) {
  const t = useT();
  return (
    <div>
      <Text fz={12} fw={600} c={TEXT_MUTED} mb={8}>{t.publishing.decisionNoteTitle}</Text>
      <Paper withBorder radius="md" p="md">
        <Textarea placeholder={t.publishing.decisionNotePlaceholder}
          autosize minRows={4} maxRows={9}
          value={value} onChange={(e) => onChange(e.currentTarget.value)} />
        <Text fz={11} c={TEXT_MUTED} mt={7}>{t.publishing.decisionNoteHelp}</Text>
      </Paper>
    </div>
  );
}


/* --- Karar formları ---------------------------------------------- */

function SubmitModal({ draftId, onClose, onDone }: {
  draftId: number; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const gonder = async () => {
    setBusy(true);
    try {
      await api.post(`/schedule-drafts/${draftId}/submit`, { note: note.trim() || null });
      notifications.show({ color: "green", message: t.publishing.submitted });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { conflicts?: ConflictResult[]; detail?: string } | null;
        const msg = body?.conflicts?.length
          ? t.publishing.submitBlocked(body.conflicts.map((c) => c.rule_id).join(", "))
          : (body?.detail ?? e.message);
        notifications.show({ color: "red", message: msg });
        return;
      }
      notifications.show({ color: "red", message: e instanceof ApiError ? e.message : t.publishing.submitFailed });
    } finally { setBusy(false); }
  };
  return (
    <Modal opened onClose={onClose} radius="md" title={t.publishing.submitTitle}>
      <Stack gap="sm">
        <Textarea label={t.publishing.noteLabel}
          description={t.publishing.noteHelp}
          placeholder={t.publishing.notePlaceholder}
          autosize minRows={3} maxRows={6}
          value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>{t.common.dismiss}</Button>
          <Button loading={busy} leftSection={<IconSend size={15} />} onClick={gonder}>
            {t.publishing.submitForApproval}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
