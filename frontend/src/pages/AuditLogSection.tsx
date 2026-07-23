import { useEffect, useMemo, useState } from "react";
import {
  Alert, Badge, Group, Loader, Pagination, Paper, Select, Table, Text, Title,
} from "@mantine/core";
import { api, ApiError } from "../api/client";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "../api/types";
import type {
  AuditAction, AuditEntityType, AuditLogPage, ManagedUser,
} from "../api/types";

const ALL = "__all__";
const PAGE_SIZE = 7;

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
const bicimle = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

/** Dashboard'un işlem kayıtları bloğu (kontrat §12, K-35).
 *
 *  Brief §6.3 her create/update/delete'in kullanıcı ve zaman damgasıyla
 *  loglanmasını şart koşuyor; yazma tarafı WP2'den beri çalışıyordu ama
 *  kimse okuyamıyordu. Bu blok o izi görünür kılıyor.
 *
 *  Sayfalama SUNUCUDA: log tek büyüyen tablodur, kullanıcı listesi gibi
 *  hepsini çekip istemcide dilimlemek kısa sürede taşardı.
 */
export default function AuditLogSection() {
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
      .catch((e) => setError(e instanceof ApiError ? e.message : "Kayıtlar yüklenemedi"));
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
      <Title order={4} mt="xl" mb="sm">İşlem Kayıtları</Title>

      <Group mb="sm">
        <Select
          data={[{ value: ALL, label: "Tüm kullanıcılar" }, ...userOptions]}
          value={userFilter}
          onChange={filtreDegistir(setUserFilter)}
          allowDeselect={false}
          searchable
          w={{ base: "100%", xs: 200 }}
        />
        <Select
          data={[
            { value: ALL, label: "Tüm eylemler" },
            ...(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((a) => ({
              value: a, label: AUDIT_ACTION_LABELS[a].label,
            })),
          ]}
          value={actionFilter}
          onChange={filtreDegistir(setActionFilter)}
          allowDeselect={false}
          w={{ base: "100%", xs: 160 }}
        />
        <Select
          data={[
            { value: ALL, label: "Tüm türler" },
            ...(Object.keys(AUDIT_ENTITY_LABELS) as AuditEntityType[]).map((t) => ({
              value: t, label: AUDIT_ENTITY_LABELS[t],
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
                    <Table.Th w={COL.zaman}>Zaman</Table.Th>
                    <Table.Th w={COL.kim}>Kim</Table.Th>
                    <Table.Th w={COL.eylem}>Eylem</Table.Th>
                    <Table.Th w={COL.tur}>Tür</Table.Th>
                    <Table.Th w={COL.kayit}>Kayıt</Table.Th>
                    <Table.Th w={COL.degisiklik}>Değişiklik</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.items.map((k) => {
                    const eylem = AUDIT_ACTION_LABELS[k.action]
                      ?? { label: k.action, color: "gray" };
                    return (
                      <Table.Tr key={k.id}>
                        <Table.Td>
                          <Text size="sm" c="dimmed">{bicimle(k.created_at)}</Text>
                        </Table.Td>
                        <Table.Td>
                          {/* user null yalnız teorik: PENDING hesap işlem
                              yapamaz, kullanılmış hesap silinemez (K-34). */}
                          <Text size="sm" truncate>{k.user?.name ?? "—"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={eylem.color} size="sm">
                            {eylem.label}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {AUDIT_ENTITY_LABELS[k.entity_type as AuditEntityType]
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
              <Text c="dimmed" size="sm" p="md">Filtreye uyan işlem kaydı yok.</Text>
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
