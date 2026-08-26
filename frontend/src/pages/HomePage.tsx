import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Alert, Grid, Group, Loader, Paper, SimpleGrid, Stack, Text, Title,
} from "@mantine/core";
import {
  IconBook2, IconCalendarWeek, IconChevronRight, IconDoor, IconPencil,
  IconUsers, type IconProps,
} from "@tabler/icons-react";
import { api, ApiError } from "../api/client";
import { AUDIT_ACTION_COLORS } from "../api/types";
import type {
  AuditLog, ConflictScan, DashboardSummary, Department, OccupancySummary, User,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import ChangeFeed from "../components/ChangeFeed";
import IdentityCard from "../components/IdentityCard";
import OccupancyHeatmap from "../components/OccupancyHeatmap";
import RuleBreakdown from "../components/RuleBreakdown";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/** "Son işlemleriniz" kaç satır gösterir — hepsi bu.
 *
 *  Sayfalama ve "listeyi temizle" düğmesi KALDIRILDI: ikisi de akışı bir
 *  denetim ekranı gibi kullanmaya davet ediyordu, oysa blok yalnız "en son ne
 *  yaptım" sorusuna cevap veriyor. Beş satırlık bir listede sayfalanacak ya da
 *  temizlenecek bir şey yok. */
const ACTIVITY_LIMIT = 5;

/** Sayfanın sütun bölünmesi — 12'lik ızgarada 7 / 5.
 *
 *  Sabit, çünkü sayfadaki İKİ ızgara da bunu kullanıyor: üst satır (kimlik +
 *  özet) ile alt bölüm (dağılım/ısı haritası + işlemler) aynı oranı
 *  paylaşmazsa sütun kenarları her satırda kayar ve sayfa dağınık görünür.
 *  Yedi/beş seçimi içeriğe göre: solda iki iç sütunlu kartlar (kimlik, kural
 *  dağılımı, ısı haritası), sağda tek sütunlu listeler. */
const LEFT = 7;
const RIGHT = 5;

/** Ana sayfa (K-82) — eski `/` ile `/dashboard`'un birleşimi.
 *
 *  **Neden birleşti:** `/` neredeyse boştu, dolu olan `/dashboard` ise yalnız
 *  ADMIN'e açıktı. Yani giriş yapan alt hesap hiçbir şey görmeyen bir sayfaya
 *  düşüyor, göreceği şeyler ise kapalı kapının ardında duruyordu. Tek sayfa var
 *  artık; içerik role göre şekilleniyor.
 *
 *  **Neyin gizli olduğu yeniden soruldu:** sayaçların çoğu alt hesabın zaten
 *  listeleyebildiği veriden türüyor (K-26), o yüzden saklanmıyor. Kullanıcı
 *  sayaçları (yönetici / alt hesap) ise ana sayfaya hiç girmiyor — onların yeri
 *  Yönetim sayfası.
 *
 *  **Sıra: en üstte KİMLİK.** Sayfayı açan kişinin ilk sorusu "buradan ne
 *  yapabilirim"; sayaçlar o sorunun cevabı değil, sistemin durumu.
 */
export default function HomePage() {
  const t = useT();
  const { user } = useAuth();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [scan, setScan] = useState<ConflictScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // İKİNCİL bloklar: kendi başlarına yüklenir ve başarısız olurlarsa sayfayı
  // devirmez, yalnız çizilmezler. Ana sayfanın tamamı tek bir uca bağlı
  // olsaydı ısı haritasının 500'ü kimliği de görünmez yapardı.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancySummary | null>(null);
  const [activity, setActivity] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    // Sayaçlar ve çakışma taraması sayfanın omurgası: ikisi de sunucuda aynı
    // taramadan besleniyor, o yüzden karttaki sayı ile dağılımdaki toplam
    // ayrışamaz.
    Promise.all([
      api.get<DashboardSummary>("/dashboard/summary"),
      api.get<ConflictScan>("/conflicts"),
    ])
      .then(([ozet, tarama]) => { setSummary(ozet); setScan(tarama); })
      .catch((e) => setError(e instanceof ApiError ? e.message : t.home.loadFailed));

    api.get<Department[]>("/departments").then(setDepartments).catch(() => { /* ikincil */ });
    api.get<OccupancySummary>("/dashboard/occupancy").then(setOccupancy).catch(() => { /* ikincil */ });
    api.get<AuditLog[]>(`/audit-logs/mine?limit=${ACTIVITY_LIMIT}`)
      .then(setActivity).catch(() => setActivity([]));
  }, []);

  if (error) return <Alert color="red" mt="md">{error}</Alert>;
  if (!user || !summary || !scan) return <Loader mt="xl" />;

  return (
    // className="home-page": index.css kart kenarlarına hafif bir gölge
    // ekliyor — açık modda ince kenarlar zemine karışıyordu.
    <Stack gap="lg" className="home-page">
      <Title order={3}>{t.home.title}</Title>

      {/* TEK IZGARA, iki sürekli sütun (7/5). İki sütun da kendi bloklarını
          alt alta akıtıyor; böylece kısa kalan bir sütunun altında boşluk
          KALMIYOR. Sütun oranı sabit olduğu için dikey kenarlar da hizalı.
          Sol: kimlik → kural dağılımı → ısı haritası. Sağ: 3×2 özet → hızlı
          işlemler → son işlemler → son onaylar. */}
      <Grid gutter="lg" align="flex-start">
        <Grid.Col span={{ base: 12, lg: LEFT }}>
          <Stack gap="lg">
            <IdentityCard user={user} departments={departments} />
            <RuleBreakdown scan={scan} />
            {occupancy && <OccupancyHeatmap data={occupancy} />}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: RIGHT }}>
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
              <StatCard to="/departments" label={t.home.cards.departments} value={summary.departments} />
              <StatCard to="/classrooms" label={t.home.cards.classrooms} value={summary.classrooms} />
              <StatCard to="/lecturers" label={t.home.cards.lecturers} value={summary.lecturers} />
              <StatCard to="/courses" label={t.home.cards.courses} value={summary.courses} />
              <StatCard to="/exams" label={t.home.cards.exams} value={summary.exams} />

              {/* Çakışma tek kart ama iki sayı: engel taslağın onaya gitmesini
                  durdurur, uyarı durdurmaz (K-05). */}
              <StatCard
                to="/conflicts"
                label={t.home.cards.conflicts}
                value={
                  <Group gap={6} align="baseline" justify="center">
                    <Text span inherit c={summary.unresolved_hard > 0 ? "red" : undefined}>
                      {summary.unresolved_hard}
                    </Text>
                    <Text span inherit c="dimmed">/</Text>
                    <Text span inherit c={summary.unresolved_warnings > 0 ? "orange" : undefined}>
                      {summary.unresolved_warnings}
                    </Text>
                  </Group>
                }
              />
            </SimpleGrid>

            <QuickActions user={user} />
            <MyActivity items={activity} />
            {/* K-59: taslaklar özel, onaylar arka planda — program haber
                verilmeden değişebiliyor. "Sizin yaptıklarınız"ın hemen altında
                "size yapılanlar" duruyor. */}
            <ChangeFeed limit={5} />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

/** Tek sayaç kartı: büyük sayı üstte, ne olduğu altında; tıklanınca o ekrana.
 *
 *  `value` sayı değil DÜĞÜM alır — çakışma kartı tek sayı değil, iki renkli
 *  sayı gösteriyor ("3 / 7"). Kart tipini ikiye bölmek yerine tek bileşen
 *  ikisini de taşıyor.
 */
function StatCard({ label, value, to }: {
  label: string; value: ReactNode; to: string;
}) {
  return (
    <Paper component={Link} to={to} withBorder radius="md" p="lg" ta="center"
      bg={PAGE_SURFACE} className="stat-card"
      style={{ borderColor: BORDER, textDecoration: "none", color: "inherit" }}>
      {/* component="div": `value` bazen Group taşıyor (çakışma kartı). Text
          varsayılan <p> üretir ve <p> içine <div> koymak geçersiz HTML'dir —
          tarayıcı p'yi erkenden kapatıp hizalamayı bozar. */}
      <Text component="div" fw={700} fz={36} lh={1.1}>{value}</Text>
      <Text size="sm" c="dimmed" mt={6}>{label}</Text>
    </Paper>
  );
}

type Islem = {
  label: string;
  desc: string;
  to: string;
  icon: ComponentType<IconProps>;
  /** Kullanıcı bu işlemi gerçekten yapabiliyor mu? */
  izin: (u: User) => boolean;
};

/** Bölüme bağlı yetki: bayrak TEK BAŞINA yetmez, en az bir bölüm üyeliği de
 *  gerekir (K-25 + K-26). Admin'de üyelik aranmaz — her bölümde yetkilidir. */
const bolumIsi = (u: User, bayrak: keyof User) =>
  Boolean(u[bayrak]) && (u.role === "ADMIN" || u.department_ids.length > 0);

/** Derslik ve öğretim üyesi PAYLAŞIMLI kaynaktır: bölüm üyeliği aranmaz,
 *  bayrak yeter (canWriteIn'in `departmentId` verilmeyen dalı). */
const paylasimliIs = (u: User, bayrak: keyof User) => Boolean(u[bayrak]);

const ISLEMLER: Islem[] = [
  {
    label: "newCourse", desc: "newCourseDesc", to: "/courses?new=1", icon: IconBook2,
    izin: (u) => bolumIsi(u, "can_manage_courses"),
  },
  {
    // Haftalık programda "ekleme formu" yok — yerleştirme ızgarada yapılır,
    // o yüzden `?new=1` de yok: işlemin kendisi ızgarayı açmaktır.
    label: "newWeekly", desc: "newWeeklyDesc", to: "/weekly", icon: IconCalendarWeek,
    izin: (u) => bolumIsi(u, "can_manage_weekly"),
  },
  {
    // Sınav modalı gün + saat ister (ızgaradan tıklanarak açılır); parametresiz
    // "yeni sınav" diye bir başlangıç noktası yok.
    label: "newExam", desc: "newExamDesc", to: "/exams", icon: IconPencil,
    izin: (u) => bolumIsi(u, "can_manage_exams"),
  },
  {
    label: "newLecturer", desc: "newLecturerDesc", to: "/lecturers?new=1", icon: IconUsers,
    izin: (u) => paylasimliIs(u, "can_manage_lecturers"),
  },
  {
    label: "newClassroom", desc: "newClassroomDesc", to: "/classrooms?new=1", icon: IconDoor,
    izin: (u) => paylasimliIs(u, "can_manage_classrooms"),
  },
];

/** Hızlı işlemler — YALNIZ yapabildikleriniz.
 *
 *  Yetkisiz işlemi gri gösterip "yetkiniz yok" demek de bir seçenekti;
 *  seçilmedi. Kimlik kartı hangi yetkinin kapalı olduğunu zaten satır satır
 *  yazıyor, burada ikinci kez söylemek bloğu yapılamayacak işlerin listesine
 *  çevirirdi. Hiçbir işlem kalmıyorsa blok hiç çizilmez.
 */
function QuickActions({ user }: { user: User }) {
  const t = useT();
  const yapilabilir = ISLEMLER.filter((i) => i.izin(user));
  if (yapilabilir.length === 0) return null;

  return (
    <Paper withBorder radius="md" p="lg" bg={PAGE_SURFACE} style={{ borderColor: BORDER }}>
      <Text fz={12} fw={600} c={TEXT_MUTED} tt="uppercase" mb={10}>
        {t.home.quickActions.title}
      </Text>
      <Stack gap={8}>
        {yapilabilir.map((i) => {
          const Icon = i.icon;
          return (
            <Link key={i.to} to={i.to} className="rule-row"
              style={{
                display: "block", border: `1px solid ${BORDER}`, borderRadius: 6,
                textDecoration: "none", color: "inherit",
              }}>
              <Group gap={10} wrap="nowrap" p={9}>
                <div style={{
                  width: 30, height: 30, flex: "none", borderRadius: 6,
                  display: "grid", placeItems: "center",
                  background: "var(--mantine-color-blue-light)",
                  color: "var(--mantine-color-blue-filled)",
                }}>
                  <Icon size={17} stroke={1.6} />
                </div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <Text fz={13} fw={600}>
                    {t.home.quickActions[i.label as keyof typeof t.home.quickActions] as string}
                  </Text>
                  <Text fz={12} c={TEXT_MUTED} truncate>
                    {t.home.quickActions[i.desc as keyof typeof t.home.quickActions] as string}
                  </Text>
                </div>
                <IconChevronRight size={15} style={{ flex: "none", opacity: 0.45 }} />
              </Group>
            </Link>
          );
        })}
      </Stack>
    </Paper>
  );
}

/** Eylem sütununun SABİT genişliği.
 *
 *  İçeriğe göre ölçülünce "Sildi" ile "Onaya gönderdi" farklı genişlikte çıkıyor
 *  ve açıklama her satırda başka yerden başlıyordu; göz listeyi tarayamaz hâle
 *  geliyordu. Sabit sütun iki dilde de uzun etiketleri taşıyacak kadar geniş,
 *  taşan kırpılır — hiza bozulmaz. */
const ACTION_COL = 104;

/** "Son işlemleriniz" — kendi denetim izinizin son satırları (K-82).
 *
 *  Yanındaki `ChangeFeed` ile karıştırılmamalı: bu "ben ne yaptım", o
 *  "başkasının onayı programımı nasıl değiştirdi" (K-59). İkisi ayrı sorular,
 *  ayrı uçlar.
 */
function MyActivity({ items }: { items: AuditLog[] | null }) {
  const t = useT();
  if (items === null) return null;          // henüz yüklenmedi

  return (
    <Paper withBorder radius="md" p="lg" bg={PAGE_SURFACE} style={{ borderColor: BORDER }}>
      <Text fz={14} fw={700} mb={items.length === 0 ? 6 : 10}>
        {t.home.activity.title}
      </Text>

      {items.length === 0 ? (
        <Text fz={13} c={TEXT_MUTED}>{t.home.activity.empty}</Text>
      ) : (
        <Stack gap={0}>
          {items.map((log, i) => (
            <Group key={log.id} gap={10} align="flex-start" wrap="nowrap"
              style={{ padding: "9px 0", borderTop: i === 0 ? undefined : `1px solid ${BORDER}` }}>
              {/* Rozet değil DÜZ METİN: sabit genişlikte bir rozet içi boş
                  görünüyordu (etiket kısayken rozetin yarısı boşluk). Renk
                  eylemin türünü yine söylüyor. */}
              <Text fz={11} fw={700} tt="uppercase" truncate
                c={AUDIT_ACTION_COLORS[log.action] ?? "gray"}
                style={{ width: ACTION_COL, flex: "none", marginTop: 2 }}>
                {t.enums.auditAction[log.action] ?? log.action}
              </Text>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <Text fz={13} truncate>
                  {/* K-36: etiket işlem anında satıra yazılır, silinen kayıt da
                      konuşur. Eski satırlarda null olabilir — o zaman tür + id. */}
                  {log.entity_label
                    ?? `${t.enums.auditEntity[log.entity_type as keyof typeof t.enums.auditEntity]
                        ?? log.entity_type} #${log.entity_id}`}
                </Text>
                {log.change_summary && (
                  <Text fz={12} c={TEXT_MUTED} truncate mt={1}>{log.change_summary}</Text>
                )}
              </div>
              <Text fz={12} c={TEXT_MUTED} style={{ flex: "none", marginTop: 2 }}>
                {kisaZaman(log.created_at, t)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

/** Gün + saat; yıl yok — akış son işlemleri gösteriyor, yıl gürültü olurdu. */
function kisaZaman(iso: string, t: Dict): string {
  return new Date(iso).toLocaleString(t.locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
