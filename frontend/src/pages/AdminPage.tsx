import { Stack, Title } from "@mantine/core";
import UsersSection from "./UsersSection";
import { useT } from "../i18n";

/** Yönetim (K-82) — yalnız ADMIN.
 *
 *  **Neden ayrı bir sayfa:** kullanıcı yönetimi eski dashboard'un dibinde,
 *  sayaçların ve çakışma tablosunun altında duruyordu. Dashboard ana sayfaya
 *  taşınıp herkese açılınca orada kalamazdı — davet ve yetkilendirme bir
 *  yönetim işidir, herkesin ilk gördüğü ekranda durmaz.
 *
 *  **Neden "Yönetim", "Kullanıcılar" değil:** bugün tek bölümü kullanıcı
 *  yönetimi, ama sınıfı belli olan bir kapı: buraya ileride yalnız admin'in
 *  gördüğü başka ayarlar da gelebilir. Sekme çubuğu YOK — tek sekmeli sekme
 *  çubuğu gürültüdür; ikinci bölüm gelince eklenir.
 *
 *  Menüde gizlemek ve buraya `RequireAdmin` koymak GÖRÜNÜM kararıdır; otorite
 *  sunucudadır — `/users` uçlarının hepsi `require_admin` ile korunuyor
 *  (brief §10.2, K-78 matrisi).
 */
export default function AdminPage() {
  const t = useT();
  return (
    <Stack gap="md">
      <Title order={3}>{t.nav.admin}</Title>
      <UsersSection />
    </Stack>
  );
}
