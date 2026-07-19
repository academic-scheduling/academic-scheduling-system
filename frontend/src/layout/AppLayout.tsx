import { Link, Outlet, useLocation } from "react-router-dom";
import { AppShell, Badge, Burger, Button, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useAuth } from "../auth/AuthContext";

type MenuItem = { label: string; path: string; adminOnly?: boolean };

const MENU: MenuItem[] = [
  { label: "Ana Sayfa", path: "/" },
  { label: "Dashboard", path: "/dashboard", adminOnly: true },
  { label: "Bölümler", path: "/departments" },
  { label: "Dersler", path: "/courses" },
  { label: "Derslikler", path: "/classrooms" },
  { label: "Öğretim Üyeleri", path: "/lecturers" },
  { label: "Haftalık Program", path: "/weekly" },
  { label: "Sınavlar", path: "/exams" },
  { label: "Çakışma Raporu", path: "/conflicts" },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();

  // Menüde gizlemek GÜVENLİK DEĞİLDİR — otorite backend'de (403).
  // Buradaki filtre yalnız kullanıcıyı çalışmayacak bir sayfaya sokmamak için.
  const items = MENU.filter((m) => !m.adminOnly || user?.role === "ADMIN");

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={600}>Akademik Program Yönetimi</Text>
          </Group>
          <Group gap="sm">
            <Text size="sm">{user?.name}</Text>
            <Badge variant="light">{user?.role}</Badge>
            <Button variant="subtle" size="xs" onClick={logout}>
              Çıkış
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {items.map((item) => (
          <NavLink
            key={item.path}
            component={Link}
            to={item.path}
            label={item.label}
            active={pathname === item.path}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}