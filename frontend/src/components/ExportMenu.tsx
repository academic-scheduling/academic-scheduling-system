import { useState, type ReactNode } from "react";
import { Button, Menu } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { api, ApiError } from "../api/client";

/** Menüdeki tek indirme seçeneği: görünen etiket + indirilecek TAM yol. */
export type ExportItem = { label: string; path: string; icon?: ReactNode };

/**
 * Ortak "Dışa Aktar" menüsü. Her sayfa yalnız seçeneklerini (`items`) verir;
 * indirme, "yükleniyor" durumu ve hata bildirimi burada TEK yerde kodlanır.
 *
 * `items` esnek bırakıldı (sabit xlsx/csv değil): haftalık program ve derslik
 * "Excel / CSV" sunarken, sınav programı resmi formatta "Vize / Final+Bütünleme"
 * sunuyor (K-09). Üç sayfa da aynı bileşeni ve aynı görünümü kullanır — tetikleyici
 * her yerde birebir aynı.
 */
type Props = {
  items: ExportItem[];
  disabled?: boolean;
  label?: string;
};

export default function ExportMenu({ items, disabled, label = "Dışa Aktar" }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async (path: string) => {
    setBusy(true);
    try {
      await api.download(path);
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İndirme başarısız",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu shadow="md" position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          size="xs" radius="md" variant="light" loading={busy} disabled={disabled}
          leftSection={<IconDownload size={16} />}
        >
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {items.map((it) => (
          <Menu.Item key={it.label} leftSection={it.icon} onClick={() => run(it.path)}>
            {it.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
