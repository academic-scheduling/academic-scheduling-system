import { Stack, Title } from "@mantine/core";
import UsersSection from "./UsersSection";
import AuditLogSection from "./AuditLogSection";
import { useT } from "../i18n";

/** Yönetim (K-82) — yalnız ADMIN.
 *
 *  **Neden ayrı bir sayfa:** kullanıcı yönetimi eski dashboard'un dibinde,
 *  sayaçların ve çakışma tablosunun altında duruyordu. Dashboard ana sayfaya
 *  taşınıp herkese açılınca orada kalamazdı — davet ve yetkilendirme bir
 *  yönetim işidir, herkesin ilk gördüğü ekranda durmaz.
 *
 *  **Neden "Yönetim", "Kullanıcılar" değil:** sayfa iki bölüm taşıyor
 *  (kullanıcılar + işlem kayıtları) ve ikisinin ortak adı "kullanıcı" değil.
 *  Sınıfı belli bir kapı: buraya yalnız admin'in gördüğü başka ayarlar da
 *  gelebilir. Sekme çubuğu YOK — iki bölüm alt alta okunuyor; sekme, bir
 *  bölümü ötekinin arkasına saklamayı hak edecek kadar uzadıklarında gelir.
 *
 *  Menüde gizlemek ve buraya `RequireAdmin` koymak GÖRÜNÜM kararıdır; otorite
 *  sunucudadır — `/users` uçlarının hepsi `require_admin` ile korunuyor
 *  (brief §10.2, K-78 matrisi).
 */
export default function AdminPage() {
  const t = useT();
  return (
    <Stack gap="xl">
      <Title order={3}>{t.nav.admin}</Title>
      <UsersSection />
      {/* İşlem kayıtları: "kim neyi değiştirdi" bir DENETİM aracıdır ve
          denetim bir yönetim işidir. Ana sayfadaki "Son işlemleriniz" ile
          karıştırılmamalı — o kişinin kendi izi (filtresiz, beş satır), bu
          ise herkesin izi (filtreli, sayfalı, yalnız ADMIN). */}
      <AuditLogSection />
    </Stack>
  );
}
