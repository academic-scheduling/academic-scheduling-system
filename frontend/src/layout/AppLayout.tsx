import { Link, Outlet, useLocation } from "react-router-dom";
import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  NavLink,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
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
  IconMoon,
  IconPencil,
  IconSun,
  IconUsers,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { useAuth } from "../auth/AuthContext";

type MenuItem = {
  label: string;
  path: string;
  icon: ComponentType<IconProps>;
  adminOnly?: boolean;
};

const MENU: MenuItem[] = [
  { label: "Ana Sayfa", path: "/", icon: IconHome2 },
  { label: "Dashboard", path: "/dashboard", icon: IconLayoutDashboard, adminOnly: true },
  { label: "Bölümler", path: "/departments", icon: IconBuildingBank },
  { label: "Dersler", path: "/courses", icon: IconBook2 },
  { label: "Derslikler", path: "/classrooms", icon: IconDoor },
  { label: "Öğretim Üyeleri", path: "/lecturers", icon: IconUsers },
  { label: "Haftalık Program", path: "/weekly", icon: IconCalendarWeek },
  { label: "Sınavlar", path: "/exams", icon: IconPencil },
  { label: "Çakışma Raporu", path: "/conflicts", icon: IconAlertTriangle },
];

const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 72;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();          // mobil çekmece
  // Tema: "auto"yu gerçek görünen şemaya (light/dark) çözer; düğme onu ters çevirir.
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  // Masaüstü ray durumu localStorage'da: sayfa yenilense/gezinilse de korunur.
  const [collapsed, setCollapsed] = useLocalStorage({
    key: "sidebar-collapsed",
    defaultValue: false,
  });
  const { pathname } = useLocation();

  // Menüde gizlemek GÜVENLİK DEĞİLDİR — otorite backend'de (403).
  // Buradaki filtre yalnız kullanıcıyı çalışmayacak bir sayfaya sokmamak için.
  const items = MENU.filter((m) => !m.adminOnly || user?.role === "ADMIN");

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        breakpoint: "sm",
        // Masaüstünde ASLA gizlenmez, yalnız daralır. Mobilde çekmece davranışı sürer.
        collapsed: { mobile: !opened, desktop: false },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            {/* Mobil: çekmeceyi aç/kapat */}
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            {/* Masaüstü: menüyü daralt/genişlet */}
            <Tooltip label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() => setCollapsed((c) => !c)}
                visibleFrom="sm"
                aria-label="Menüyü daralt/genişlet"
              >
                {collapsed ? (
                  <IconLayoutSidebarLeftExpand size={20} />
                ) : (
                  <IconLayoutSidebarLeftCollapse size={20} />
                )}
              </ActionIcon>
            </Tooltip>
            <Text fw={600}>Akademik Program Yönetimi</Text>
          </Group>
          <Group gap="sm">
            <Tooltip label={scheme === "dark" ? "Aydınlık moda geç" : "Karanlık moda geç"}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}
                aria-label="Temayı değiştir"
              >
                {scheme === "dark" ? <IconSun size={20} /> : <IconMoon size={20} />}
              </ActionIcon>
            </Tooltip>
            <Text size="sm">{user?.name}</Text>
            <Badge variant="light">{user?.role}</Badge>
            <Button variant="subtle" size="xs" onClick={logout}>
              Çıkış
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.path;
          const link = (
            <NavLink
              component={Link}
              to={item.path}
              label={collapsed ? undefined : item.label}
              leftSection={<Icon size={20} stroke={1.5} />}
              active={active}
              onClick={close}
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
            <Tooltip key={item.path} label={item.label} position="right" withArrow>
              {link}
            </Tooltip>
          ) : (
            <div key={item.path}>{link}</div>
          );
        })}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
