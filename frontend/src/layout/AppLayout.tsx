import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Divider,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconBook2,
  IconBuildingBank,
  IconCalendarWeek,
  IconDoor,
  IconHome2,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMoon,
  IconPencil,
  IconSun,
  IconUsers,
  type IconProps,
  IconInbox,
} from "@tabler/icons-react";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../api/client";
import type { ScheduleDraft } from "../api/types";
import { useLang, useT } from "../i18n";
import { tr } from "../i18n/tr";

type MenuItem = {
  /** K-79: sabit metin değil SÖZLÜK ANAHTARI — menü modül düzeyinde kurulduğu
   *  için (hook çağıramaz) etiket, render sırasında `t.nav[key]` ile çözülür.
   *  `keyof` sayesinde olmayan bir anahtar derlemede yakalanır. */
  key: keyof typeof tr.nav;
  path: string;
  icon: ComponentType<IconProps>;
  adminOnly?: boolean;
  /** K-59: yalnız onay yetkisi olanlarda görünür (ADMIN dahil — bayrağı
   *  sunucu ADMIN için true raporlar). Gizlemek GÖRÜNÜM kararıdır; otorite
   *  sunucuda (brief §10.2). */
  approverOnly?: boolean;
};

const MENU: MenuItem[] = [
  { key: "home", path: "/", icon: IconHome2 },
  { key: "dashboard", path: "/dashboard", icon: IconLayoutDashboard, adminOnly: true },
  { key: "departments", path: "/departments", icon: IconBuildingBank },
  { key: "courses", path: "/courses", icon: IconBook2 },
  { key: "classrooms", path: "/classrooms", icon: IconDoor },
  { key: "lecturers", path: "/lecturers", icon: IconUsers },
  { key: "weekly", path: "/weekly", icon: IconCalendarWeek },
  { key: "exams", path: "/exams", icon: IconPencil },
  // K-77: "Taslaklarım" + "Onay Bekleyenler" tek "Yayın Merkezi"nde birleşti.
  // Herkeste görünür (herkesin taslağı olabilir); rozet bekleyen sayısını verir.
  { key: "publishing", path: "/publishing", icon: IconInbox },
  { key: "conflicts", path: "/conflicts", icon: IconAlertTriangle },
];

const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 72;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const t = useT();
  const { lang, setLang } = useLang();
  // Tema: "auto"yu gerçek görünen şemaya (light/dark) çözer; düğme onu ters çevirir.
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  // Ray durumu localStorage'da: sayfa yenilense/gezinilse de korunur.
  const [collapsed, setCollapsed] = useLocalStorage({
    key: "sidebar-collapsed",
    defaultValue: false,
  });
  const { pathname } = useLocation();
  const pending = usePendingCount(pathname);

  // Menüde gizlemek GÜVENLİK DEĞİLDİR — otorite backend'de (403).
  // Buradaki filtre yalnız kullanıcıyı çalışmayacak bir sayfaya sokmamak için.
  const items = MENU.filter((m) =>
    (!m.adminOnly || user?.role === "ADMIN")
    && (!m.approverOnly || !!user?.can_approve_schedule));

  const themeLabel = scheme === "dark" ? t.layout.toLightMode : t.layout.toDarkMode;
  const ThemeIcon = scheme === "dark" ? IconSun : IconMoon;
  const toggleTheme = () => setColorScheme(scheme === "dark" ? "light" : "dark");

  // K-79: dil düğmesi tema düğmesinin ikizi — tek tıkla diğer dile geçer.
  // İki dil olduğu için açılır liste yerine değiştirici; etiket HEDEF dilde
  // yazılı ("Switch to English"), böylece yanlış dile düşen kullanıcı da
  // çıkış yolunu okuyabilir.
  const otherLang = lang === "tr" ? "en" : "tr";
  const langLabel = lang === "tr" ? t.layout.switchToEnglish : t.layout.switchToTurkish;
  const toggleLang = () => setLang(otherLang);

  return (
    // Üst bar KALDIRILDI (eski AppShell.Header): başlık, tema, rol ve çıkış artık
    // sol menüde. Menü masaüstünde ve mobilde HER ZAMAN görünür (yalnız daralır),
    // o yüzden ayrı bir mobil çekmece/burger'e gerek yok.
    <AppShell
      navbar={{
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: false, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Navbar p="xs">
        {/* ÜST: başlık + daraltma düğmesi */}
        <AppShell.Section>
          <Group gap="xs" wrap="nowrap" justify={collapsed ? "center" : "space-between"}>
            {!collapsed && (
              <Text fw={600} size="sm" style={{ lineHeight: 1.2 }}>
                {t.layout.appName}
              </Text>
            )}
            <Tooltip label={collapsed ? t.layout.expand : t.layout.collapse} position="right">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? t.layout.expand : t.layout.collapse}
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand size={20} />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={20} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        </AppShell.Section>

        <Divider my="xs" />

        {/* ORTA: menü öğeleri (kaydırılabilir) */}
        <AppShell.Section grow component={ScrollArea}>
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.path;
            const label = t.nav[item.key];
            // K-77: Yayın Merkezi'nde bekleyen onay sayısı rozeti.
            const badge = item.path === "/publishing" && pending > 0
              ? <Badge size="sm" circle variant="filled" color="blue">{pending}</Badge>
              : undefined;
            const link = (
              <NavLink
                component={Link}
                to={item.path}
                label={collapsed ? undefined : label}
                leftSection={<Icon size={20} stroke={1.5} />}
                rightSection={!collapsed ? badge : undefined}
                active={active}
                // Daraltılmışken ikonu ortala, boş etiket alanını gizle.
                styles={
                  collapsed
                    ? {
                        root: { justifyContent: "center", paddingInline: 0 },
                        section: { marginInlineEnd: 0 },
                        body: { display: "none" },
                      }
                    : undefined
                }
              />
            );
            // Daraltılmışken etiket ikonun yanında yok → hover'da tooltip göster.
            return collapsed ? (
              <Tooltip key={item.path} label={label} position="right" withArrow>
                {link}
              </Tooltip>
            ) : (
              <div key={item.path}>{link}</div>
            );
          })}
        </AppShell.Section>

        {/* ALT: kullanıcı + rol, tema, çıkış */}
        <AppShell.Section>
          <Divider mb="xs" />
          {/* GEÇİCİ TANI: oturum boşta-uyarısına kalan süre. Sistem düzgün
              çalışıyor mu diye bakmak için — sonra kaldırılacak. */}
          <SessionCountdown collapsed={collapsed} />
          {collapsed ? (
            <Stack gap="xs" align="center">
              <Tooltip label={langLabel} position="right" withArrow>
                {/* Daraltılmışken ikon yerine dil KODU: bayrak kullanmıyoruz
                    (bayrak dili değil ülkeyi gösterir) ve iki harf ikondan
                    daha okunur. */}
                <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleLang}
                  aria-label={langLabel}>
                  <Text size="xs" fw={700}>{otherLang.toUpperCase()}</Text>
                </ActionIcon>
              </Tooltip>
              <Tooltip label={themeLabel} position="right" withArrow>
                <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleTheme}
                  aria-label={themeLabel}>
                  <ThemeIcon size={20} />
                </ActionIcon>
              </Tooltip>
              <Tooltip
                label={`${user?.name} (${user?.role}) — ${t.layout.logout}`}
                position="right"
                withArrow
              >
                <ActionIcon variant="subtle" color="red" size="lg" onClick={logout}
                  aria-label={t.layout.logout}>
                  <IconLogout size={20} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          ) : (
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" truncate>{user?.name}</Text>
                  <Badge variant="light" size="sm">{user?.role}</Badge>
                </div>
                <Group gap={4} wrap="nowrap">
                  <Tooltip label={langLabel}>
                    <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleLang}
                      aria-label={langLabel}>
                      <Text size="xs" fw={700}>{otherLang.toUpperCase()}</Text>
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={themeLabel}>
                    <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleTheme}
                      aria-label={themeLabel}>
                      <ThemeIcon size={20} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconLogout size={16} />}
                onClick={logout}
                justify="flex-start"
              >
                Çıkış
              </Button>
            </Stack>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {/* key={pathname}: her rota değişiminde içerik yeniden monte olur ve
            route-fade animasyonu baştan oynar. Aynı yol + farklı query
            (deep-link) remount etmez. */}
        <div key={pathname} className="route-fade">
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}

/** K-77: sol menüdeki Yayın Merkezi rozeti — bekleyen onay sayısı.
 *
 *  Onaylayıcıda kapsamındaki tüm kuyruk (`/schedule-approvals`), değilse yalnız
 *  kendi bekleyen taleplerim (K-59 gizliliği — sayfayla aynı kaynak). Sayfada bir
 *  karar verilince `publishing:refresh` olayıyla, gezinince pathname ile tazelenir. */
function usePendingCount(pathname: string): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    let cancel = false;
    const fetchCount = () => {
      const p = user.can_approve_schedule
        ? api.get<ScheduleDraft[]>("/schedule-approvals").then((q) => q.length)
        : api.get<ScheduleDraft[]>("/schedule-drafts")
            .then((d) => d.filter((x) => x.status === "PENDING").length);
      p.then((n) => { if (!cancel) setCount(n); }).catch(() => { /* rozet ikincil */ });
    };
    fetchCount();
    window.addEventListener("publishing:refresh", fetchCount);
    return () => { cancel = true; window.removeEventListener("publishing:refresh", fetchCount); };
  }, [user, pathname]);
  return count;
}

/** GEÇİCİ TANI (kaldırılacak): oturum boşta-uyarısına kaç dk:sn kaldığını gösterir.
 *  Her saniye AuthContext'teki gerçek sayacı okur; fare/klavye hareketiyle
 *  lastActivity sıfırlanınca 15:00'e döner (idle mekanizması böyle doğrulanır). */
function SessionCountdown({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const { user, idleWarningRemainingMs } = useAuth();
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!user) return;
    setMs(idleWarningRemainingMs());
    const id = setInterval(() => setMs(idleWarningRemainingMs()), 1000);
    return () => clearInterval(id);
  }, [user, idleWarningRemainingMs]);

  if (!user) return null;
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const warn = sec <= 120;   // son 2 dk'da vurgula

  if (collapsed) {
    return (
      <Tooltip label={`${t.session.countdown}: ${label}`} position="right" withArrow>
        <Text ta="center" size="xs" mb="xs" c={warn ? "orange" : "dimmed"}
          style={{ fontVariantNumeric: "tabular-nums", cursor: "default" }}>
          {label}
        </Text>
      </Tooltip>
    );
  }
  return (
    <Text ta="center" size="xs" mb="xs" c={warn ? "orange" : "dimmed"}>
      {t.session.countdown}:{" "}
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{label}</b>
    </Text>
  );
}
