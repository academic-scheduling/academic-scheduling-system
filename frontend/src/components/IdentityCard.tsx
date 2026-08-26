import { Badge, Group, Paper, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconEye, IconLogin } from "@tabler/icons-react";
import type { Department, User } from "../api/types";
import { CAPABILITIES } from "../api/types";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/** Ana sayfanın kimlik kartı (K-82).
 *
 *  **Neden var:** bu sistemde yazma yetkisi İKİ BOYUTLU — yetki bayrağı VE
 *  bölüm üyeliği (K-25 + K-26). "Neden bu düğmeyi göremiyorum" sorusunun
 *  cevabı bugüne kadar hiçbir ekranda yazmıyordu; kullanıcı yetkisini ancak
 *  bir işi deneyip başarısız olarak öğreniyordu. Kart iki boyutu yan yana
 *  koyar ve altına ikisinin BİRLİKTE gerektiğini yazar.
 *
 *  Yeni uç gerektirmez: her şey `/auth/me` + `/departments` içinde.
 */
export default function IdentityCard({
  user, departments,
}: {
  user: User;
  departments: Department[];
}) {
  const t = useT();
  const admin = user.role === "ADMIN";

  // ADMIN'in department_ids'i BOŞTUR ve bu "hiçbiri" değil "hepsi" demektir
  // (K-26): admin zaten her bölümde yetkilidir, ayrıca atanmaz. Boş listeyi
  // olduğu gibi çizmek kartın en yanıltıcı hâli olurdu.
  const bolumler = admin
    ? departments
    : departments.filter((d) => user.department_ids.includes(d.id));

  const acikYetki = CAPABILITIES.filter((c) => user[c.key]).length;

  return (
    // Genişliği ARTIK IZGARA belirliyor (ana sayfanın 7/5 sütunu), kartın
    // kendi `maw`'ı değil: sabit bir üst sınır, yanındaki özet kartlarıyla
    // arasında hizasız bir boşluk bırakıyordu. Yükseklik doğal — sağdaki sayaç
    // ızgarası buna göre UZATILMIYOR (deforme oluyordu).
    <Paper withBorder radius="md" bg={PAGE_SURFACE}
      style={{ borderColor: BORDER, overflow: "hidden" }}>
      {/* ÜST: kim olduğunuz */}
      <Group align="flex-start" gap="md" p="lg"
        style={{ borderBottom: `1px solid ${BORDER}` }}>
        <Avatar name={user.name} admin={admin} />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <Group gap="xs" align="center">
            <Text fz={19} fw={700}>{user.name}</Text>
            <Badge variant="light" color={admin ? "blue" : "gray"} size="sm">
              {admin ? t.layout.roleAdmin : t.layout.roleSubAccount}
            </Badge>
          </Group>
          {/* "Aktif hesap" rozeti YOK: oturum açabilmiş olmak zaten hesabın
              ACTIVE olduğunun kanıtı (sunucu her istekte arar). Hesap numarası
              da yok — kullanıcıya bir şey söylemiyor. */}
          <Text fz={13} c={TEXT_MUTED} mt={3}>{user.email}</Text>
          <Group gap={6} mt={8} c={TEXT_MUTED}>
            <IconLogin size={14} />
            <Text fz={12}>
              {user.previous_login_at
                ? t.home.identity.previousLogin(zaman(user.previous_login_at, t))
                : t.home.identity.firstLogin}
            </Text>
          </Group>
        </div>
      </Group>

      {/* ORTA: yetkinin iki boyutu, yan yana */}
      <Group align="stretch" gap={0} wrap="nowrap">
        <div style={{ flex: "1 1 0", minWidth: 0, padding: "14px 18px 16px",
          borderRight: `1px solid ${BORDER}` }}>
          <Group justify="space-between" gap="xs" mb={10}>
            <Text fz={12} fw={600} c={TEXT_MUTED} tt="uppercase">
              {t.home.identity.departments}
            </Text>
            <Text fz={12} c={TEXT_MUTED}>
              {admin ? t.home.identity.allDepartments
                : t.home.identity.depCount(bolumler.length)}
            </Text>
          </Group>

          {bolumler.length === 0 ? (
            <Text fz={13} c={TEXT_MUTED}>{t.home.identity.noDepartments}</Text>
          ) : (
            // ALT ALTA, yan yana değil: bölüm adları uzun ("Metalurji ve
            // Malzeme Mühendisliği") ve sarmalanınca satır sonları rastgele
            // düşüyor — liste okunmuyordu. Tek sütun hem taramayı kolaylaştırır
            // hem kodların hizasını korur.
            <Stack gap={6} align="flex-start">
              {bolumler.map((d) => (
                // tt="none": Badge varsayılanı BÜYÜK HARF. Bölüm adları özel
                // ad; büyük harfe çevrilince hem bağırıyor hem uzuyor.
                <Badge key={d.id} variant="default" size="lg" radius="xl" tt="none"
                  leftSection={<Text span fz={11} fw={700} c="blue">{d.code}</Text>}>
                  {d.name}
                </Badge>
              ))}
            </Stack>
          )}

          {/* Not YALNIZ alt hesapta: admin'de söylenecek bir şey yok
              (sütun zaten "tümü" diyor) ve her ekranda duran bir cümle bir
              süre sonra okunmuyor. */}
          {!admin && (
            <Text fz={12} c={TEXT_MUTED} mt={10} lh={1.5}>
              {bolumler.length === 0 ? t.home.identity.depNoteNone
                : t.home.identity.depNoteSub}
            </Text>
          )}
        </div>

        <div style={{ flex: "1 1 0", minWidth: 0, padding: "14px 18px 16px" }}>
          <Group justify="space-between" gap="xs" mb={4}>
            <Text fz={12} fw={600} c={TEXT_MUTED} tt="uppercase">
              {t.home.identity.capabilities}
            </Text>
            <Text fz={12} c={TEXT_MUTED}>
              {t.home.identity.capCount(acikYetki, CAPABILITIES.length)}
            </Text>
          </Group>

          <Stack gap={0}>
            {CAPABILITIES.map((c) => {
              const acik = user[c.key];
              return (
                <Group key={c.key} gap={10} wrap="nowrap"
                  style={{ padding: "8px 0", borderTop: `1px solid ${BORDER}` }}>
                  <Text fz={13} c={acik ? undefined : TEXT_MUTED} truncate
                    style={{ flex: "1 1 auto", minWidth: 0 }}>
                    {t.enums.capability[c.key]}
                  </Text>
                  {/* Kapalı yetki de YAZILIR, sadece silik. Listeden düşseydi
                      kullanıcı neyin var olduğunu değil neyin verildiğini
                      görürdü — "bende olmayan yetki nedir" cevapsız kalırdı. */}
                  <Badge size="sm" variant="light" color={acik ? "green" : "gray"}
                    leftSection={acik ? <IconCircleCheck size={12} /> : <IconEye size={12} />}
                    style={{ flex: "none" }}>
                    {acik ? t.home.identity.canWrite : t.home.identity.readOnly}
                  </Badge>
                </Group>
              );
            })}
          </Stack>

          {!admin && (
            <Text fz={12} c={TEXT_MUTED} mt={10} lh={1.5}>
              {t.home.identity.capNoteSub}
            </Text>
          )}
        </div>
      </Group>
    </Paper>
  );
}

/** Baş harfler — profil fotoğrafı diye bir alan yok, uydurmuyoruz. */
function Avatar({ name, admin }: { name: string; admin: boolean }) {
  const bas = name.trim().split(/\s+/).slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase("tr"))
    .join("");
  return (
    <div style={{
      width: 56, height: 56, flex: "none", borderRadius: 28,
      display: "grid", placeItems: "center", fontSize: 19, fontWeight: 700,
      background: admin ? "var(--mantine-color-blue-light)"
        : "var(--mantine-color-gray-light)",
      color: admin ? "var(--mantine-color-blue-filled)"
        : "var(--mantine-color-gray-7)",
    }}>
      {bas}
    </div>
  );
}

function zaman(iso: string, t: Dict): string {
  return new Date(iso).toLocaleString(t.locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
