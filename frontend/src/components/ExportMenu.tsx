import { useState } from "react";
import { Button, Menu } from "@mantine/core";
import { IconDownload, IconFileSpreadsheet, IconFileText } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { api, ApiError } from "../api/client";

/** Excel/CSV indirme menüsü. Her sayfa yalnız `buildPath`'i verir; indirme,
 *  yükleniyor durumu ve hata bildirimi burada bir kez kodlanır. */
type Props = {
  /** Formata göre indirilecek TAM yol (query + format dahil). */
  buildPath: (format: "xlsx" | "csv") => string;
  disabled?: boolean;
  label?: string;
};

export default function ExportMenu({ buildPath, disabled, label = "Dışa Aktar" }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async (format: "xlsx" | "csv") => {
    setBusy(true);
    try {
      await api.download(buildPath(format));
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
        <Menu.Item leftSection={<IconFileSpreadsheet size={16} />} onClick={() => run("xlsx")}>
          Excel (.xlsx)
        </Menu.Item>
        <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => run("csv")}>
          CSV (.csv)
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
