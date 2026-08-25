import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Group, Loader, Pagination, Paper, Select, Table, Text, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import { AUDIT_ACTION_COLORS } from "../api/types";
import type {
  AuditAction, AuditEntityType, AuditLogPage, ManagedUser,
} from "../api/types";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

const ALL = "__all__";

/** Sayfa başına satır.
 *
 *  K-82: 7 idi — dashboard'da dört bloktan biriydi ve ötekileri aşağı itmemesi
 *  gerekiyordu. Yönetim sayfasında kullanıcı tablosunun altında tek başına
 *  duruyor; o kısıt kalktı, kullanıcı tablosuyla aynı ölçüye geldi. */
const PAGE_SIZE = 12;

/** Sütun genişlikleri yüzde — kullanıcı tablosundaki gerekçenin aynısı:
 *  oran sabit kalsın (sayfa değişince kaymasın), genişlik ekrana göre esnesin. */
const COL = {
  zaman: "14%",
  kim: "14%",
  eylem: "11%",
  tur: "12%",
  kayit: "21%",
  degisiklik: "28%",
} as const;

const TABLE_MIN_WIDTH = 900;

/** Tarih + saat, tek satırda okunur biçimde. */
const bicimle = (iso: string, t: Dict) =>
  new Date(iso).toLocaleString(t.locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

/** Yönetim sayfasının işlem kayıtları bloğu (kontrat §12, K-35).
 *
 *  Brief §6.3 her create/update/delete'in kullanıcı ve zaman damgasıyla
 *  loglanmasını şart koşuyor; yazma tarafı WP2'den beri çalışıyordu ama
 *  kimse okuyamıyordu. Bu blok o izi görünür kılıyor.
 *
 *  Sayfalama SUNUCUDA: log tek büyüyen tablodur, kullanıcı listesi gibi
 *  hepsini çekip istemcide dilimlemek kısa sürede taşardı.
 *
 *  **K-82: yeri değişti.** Dashboard ana sayfayla birleşince blok bir tur
 *  kaldırıldı — herkesin ilk gördüğü ekranda "kim neyi değiştirdi" tablosunun
 *  işi yoktu. Ama izin kendisi silinmedi (kontrat §12 borcu) ve admin'in ona
 *  bakabileceği bir yer gerekiyordu: Yönetim sayfası. Ana sayfadaki "Son
 *  işlemleriniz" bununla KARIŞTIRILMAMALI — o kişinin kendi izi, filtresiz ve
 *  beş satır; bu ise denetim aracı: herkesin izi, filtreli, sayfalı.
 */
export default function AuditLogSection() {
  const t = useT();
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>(ALL);
  const [entityFilter, setEntityFilter] = useState<string>(ALL);
  const [userFilter, setUserFilter] = useState<string>(ALL);

  useEffect(() => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (actionFilter !== ALL) params.set("action", actionFilter);
    if (entityFilter !== ALL) params.set("entity_type", entityFilter);
    if (userFilter !== ALL) params.set("user_id", userFilter);

    api.get<AuditLogPage>(`/audit-logs?${params}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : t.audit.loadFailed));
  }, [page, actionFilter, entityFilter, userFilter]);

  // Fail filtresi için kullanıcı listesi bir kez çekilir.
  useEffect(() => {
    api.get<ManagedUser[]>("/users").then(setUsers).catch(() => setUsers([]));
  }, []);

  const userOptions = useMemo(
    () => [...users]
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      .map((u) => ({ value: String(u.id), label: u.name })),
    [users],
  );

  const toplamSayfa = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  /** Filtre değişince ilk sayfaya dön — daralan sonuçta boş sayfada kalmamak için. */
  const filtreDegistir = (setter: (v: string) => void) => (v: string | null) => {
    setter(v ?? ALL);
    setPage(1);
  };

  return (
    <>
      <Title order={4} mb="sm">{t.audit.title}</Title>

      <Group mb="sm">
        <Select
          data={[{ value: ALL, label: t.audit.allUsers }, ...userOptions]}
          value={userFilter}
          onChange={filtreDegistir(setUserFilter)}
          allowDeselect={false}
          searchable
          w={{ base: "100%", xs: 200 }}
        />
        <Select
          data={[
            { value: ALL, label: t.audit.allActions },
            ...(Object.keys(AUDIT_ACTION_COLORS) as AuditAction[]).map((a) => ({
              value: a, label: t.enums.auditAction[a],
            })),
          ]}
          value={actionFilter}
          onChange={filtreDegistir(setActionFilter)}
          allowDeselect={false}
          w={{ base: "100%", xs: 160 }}
        />
        <Select
          data={[
            { value: ALL, label: t.audit.allTypes },
            ...(Object.keys(t.enums.auditEntity) as AuditEntityType[]).map((tur) => ({
              value: tur, label: t.enums.auditEntity[tur],
            })),
          ]}
          value={entityFilter}
          onChange={filtreDegistir(setEntityFilter)}
          allowDeselect={false}
          w={{ base: "100%", xs: 180 }}
        />
      </Group>

      {error ? (
        <Alert color="red">{error}</Alert>
      ) : !data ? (
        <Loader />
      ) : (
        <>
          <Paper withBorder radius="md">
            <Table.ScrollContainer minWidth={TABLE_MIN_WIDTH} type="native">
              <Table verticalSpacing="xs" highlightOnHover layout="fixed">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={COL.zaman}>{t.audit.time}</Table.Th>
                    <Table.Th w={COL.kim}>{t.audit.who}</Table.Th>
                    <Table.Th w={COL.eylem}>{t.audit.action}</Table.Th>
                    <Table.Th w={COL.tur}>{t.audit.entityType}</Table.Th>
                    <Table.Th w={COL.kayit}>{t.audit.record}</Table.Th>
                    <Table.Th w={COL.degisiklik}>{t.audit.change}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.items.map((k) => {
                    const eylemRengi = AUDIT_ACTION_COLORS[k.action] ?? "gray";
                    return (
                      <Table.Tr key={k.id}>
                        <Table.Td>
                          <Text size="sm" c="dimmed">{bicimle(k.created_at, t)}</Text>
                        </Table.Td>
                        <Table.Td>
                          {/* user null yalnız teorik: PENDING hesap işlem
                              yapamaz, kullanılmış hesap silinemez (K-34). */}
                          <Text size="sm" truncate>{k.user?.name ?? "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={eylemRengi} size="sm">
                            {t.enums.auditAction[k.action] ?? k.action}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {t.enums.auditEntity[k.entity_type as AuditEntityType]
                              ?? k.entity_type}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {/* Etiket okuma anında çözülüyor; kayıt silinmişse
                              null gelir ve elimizde yalnız id kalır (K-35). */}
                          {k.entity_label ? (
                            <Text size="sm" truncate title={k.entity_label}>
                              {k.entity_label}
                            </Text>
                          ) : (
                            <Text size="sm" c="dimmed" fs="italic">
                              silinmiş kayıt (#{k.entity_id})
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {/* "Ne değişti" ayrı sütunda: entity_label hangi
                              kaydın etkilendiğini, bu sütun neyin değiştiğini
                              söyler (K-38). Tek metne sıkıştırılsalardı ikisi
                              de okunmaz olurdu. */}
                          {k.change_summary ? (
                            <Text size="sm" truncate title={k.change_summary}>
                              {k.change_summary}
                            </Text>
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {data.items.length === 0 && (
              <Text c="dimmed" size="sm" p="md">{t.audit.noMatch}</Text>
            )}
          </Paper>

          {toplamSayfa > 1 && (
            <Group justify="flex-end" mt="sm">
              <Pagination
                total={toplamSayfa}
                value={page}
                onChange={setPage}
                size="sm"
              />
            </Group>
          )}
        </>
      )}
    </>
  );
}
