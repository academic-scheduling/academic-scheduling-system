import { useEffect, useState } from "react";
import { Alert, Button, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { IconCircleCheck, IconDownload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { api, ApiError } from "../api/client";
import type { Department } from "../api/types";

type ImportResult = {
  total_parsed: number;
  added_count: number;
  skipped_count: number;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  departments: Department[];          // yalnız yazılabilir bölümler (can_manage_courses)
  defaultDepartmentId: string | null; // Dersler sayfasındaki bölüm filtresinden ön-seçim
  onImported: () => void;             // başarıda listeyi yenile
};

/** Bologna bilgi paketinden bir bölümün derslerini içe aktarma modalı.
 *  Yalnız ders bilgisi eklenir; zaten kayıtlı dersler backend'de atlanır. */
export default function ImportCoursesModal({
  opened, onClose, departments, defaultDepartmentId, onImported,
}: Props) {
  const [depId, setDepId] = useState<string | null>(defaultDepartmentId);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Modal her açılışta filtredeki bölümle başlasın, önceki sonuç sıfırlansın.
  useEffect(() => {
    if (opened) {
      setDepId(defaultDepartmentId);
      setUrl("");
      setResult(null);
      setBusy(false);
    }
  }, [opened, defaultDepartmentId]);

  const submit = async () => {
    if (!depId || !url.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<ImportResult>("/import/courses", {
        department_id: Number(depId),
        url: url.trim(),
      });
      setResult(res);
      onImported();
      notifications.show({
        color: "green",
        message: `${res.added_count} ders eklendi, ${res.skipped_count} zaten vardı`,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        message: e instanceof ApiError ? e.message : "İçe aktarma başarısız",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Bologna'dan Ders İçe Aktar" centered>
      {result ? (
        <Stack>
          <Alert color="green" icon={<IconCircleCheck size={18} />}>
            <Text fw={600}>{result.added_count} yeni ders eklendi.</Text>
            <Text size="sm" c="dimmed">
              {result.skipped_count} ders zaten kayıtlıydı (atlandı) · toplam{" "}
              {result.total_parsed} ders okundu.
            </Text>
          </Alert>
          <Button onClick={onClose}>Kapat</Button>
        </Stack>
      ) : (
        <Stack>
          <Select
            label="Hedef bölüm"
            description="Bologna'daki bölümün dersleri bu bölüme eklenir. Karşılığı yoksa önce Bölümler'den oluşturun."
            placeholder="Bölüm seçin"
            data={departments.map((d) => ({
              value: String(d.id), label: `${d.code} — ${d.name}`,
            }))}
            value={depId}
            onChange={setDepId}
            required
          />
          <TextInput
            label="Bologna sayfası adresi"
            description="Bölümün bilgi paketi ders sayfasının URL'ini yapıştırın (…curSunit=… içermeli)."
            placeholder="https://obs.mu.edu.tr/oibs/bologna/index.aspx?...&curSunit=253"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            required
          />
          <Button
            leftSection={<IconDownload size={16} />}
            onClick={submit}
            loading={busy}
            disabled={!depId || !url.trim()}
          >
            İçe Aktar
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
