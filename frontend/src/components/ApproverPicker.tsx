import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { api, ApiError } from "../api/client";
import type { DraftApproverCandidate } from "../api/types";
import { TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";

/* ==================================================================
 * K-83 · Onay talebinin ADRESİ
 *
 * K-83'e kadar onaya gönderilen taslak, o bölümde onay yetkisi olan HERKESİN
 * (ve her yöneticinin) kuyruğuna düşüyordu; gönderenin adres üzerinde söz
 * hakkı yoktu. Artık gönderen alıcıları seçiyor ve talep yalnız onlara gidiyor.
 *
 * Bileşen İKİ gönderim yolunda birden kullanılıyor — Yayın Merkezi'nin inceleme
 * paneli ve program ekranındaki gönderim penceresi (DraftBar). İki ekranın aynı
 * listeyi farklı kurallarla çizmesi, aynı sorunun iki cevabı olurdu.
 *
 * Aday listesi SUNUCUDAN gelir (`/schedule-drafts/{id}/approver-candidates`):
 * bölümün onay yetkilileri + tüm yöneticiler, gönderenin kendisi hariç
 * (öz-onay yasak). İstemci havuzu kendi hesaplamaz — seçim sunucuda yeniden
 * doğrulanır, yani buradaki liste yalnızca bir kolaylıktır, yetki kaynağı değil.
 * ================================================================== */

/** Adayları çeker. `enabled` false iken hiç istek atılmaz: liste yalnız
 *  GÖNDERİLEBİLİR bir taslakta anlamlı, bekleyende/onaylanmışta değil. */
export function useApproverCandidates(draftId: number, enabled: boolean) {
  const t = useT();
  const [list, setList] = useState<DraftApproverCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) { setList(null); setError(null); return; }
    let iptal = false;
    setList(null);
    setError(null);
    api.get<DraftApproverCandidate[]>(`/schedule-drafts/${draftId}/approver-candidates`)
      .then((r) => { if (!iptal) setList(r); })
      .catch((e) => {
        if (!iptal) setError(e instanceof ApiError ? e.message : t.draft.approversLoadFailed);
      });
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, enabled]);

  return { list, error };
}

/** Havuz boş değilken en az bir kişi seçilmiş olmalı.
 *
 *  Havuz BOŞSA gönderim engellenmez: adreslenecek kimse yokken talebi de
 *  bloke etmek, tek yetkilisi olan bir bölümü büsbütün kilitlerdi. Sunucu bu
 *  durumda talebi adressiz kaydeder ve sonradan yetki alan biri görebilir. */
export function approversReady(
  list: DraftApproverCandidate[] | null, selected: number[],
): boolean {
  if (list === null) return false;          // henüz yüklenmedi
  return list.length === 0 || selected.length > 0;
}

export function ApproverPicker({ list, error, value, onChange }: {
  list: DraftApproverCandidate[] | null;
  error: string | null;
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const t = useT();

  if (error) return <Text fz="xs" c="red">{error}</Text>;
  if (list === null) {
    return (
      <Group gap={8}>
        <Loader size="xs" />
        <Text fz="xs" c={TEXT_MUTED}>{t.publishing.loading}</Text>
      </Group>
    );
  }
  if (list.length === 0) {
    return <Text fz="xs" c={TEXT_MUTED}>{t.draft.approversEmpty}</Text>;
  }

  const cevir = (id: number, isaretli: boolean) =>
    onChange(isaretli ? [...value, id] : value.filter((x) => x !== id));

  const hepsiSecili = value.length === list.length;

  return (
    <Stack gap={8}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text fz={11} c={TEXT_MUTED}>
          {value.length > 0 ? t.draft.approversSelected(value.length) : t.draft.approversHelp}
        </Text>
        {/* Tek düğme iki yönlü: hepsi seçiliyken "temizle"ye dönüşür. İki ayrı
            düğme, dar sütunda listenin kendisinden fazla yer kaplardı. */}
        <Button variant="subtle" size="compact-xs"
          onClick={() => onChange(hepsiSecili ? [] : list.map((c) => c.id))}>
          {hepsiSecili ? t.draft.approversNone : t.draft.approversAll}
        </Button>
      </Group>
      {/* Uzun listede panel büyümesin; kısa listede kutu boşuna yer kaplamasın. */}
      <ScrollArea.Autosize mah={190} type="auto">
        <Stack gap={10}>
          {list.map((c) => (
            <Checkbox
              key={c.id}
              checked={value.includes(c.id)}
              onChange={(e) => cevir(c.id, e.currentTarget.checked)}
              label={
                <Group gap={6} wrap="nowrap">
                  <Text fz="sm" truncate>{c.name}</Text>
                  {/* Yönetici bölüm üyesi olmasa da listede olabilir; rozet
                      "bu kişi neden burada?" sorusunu listenin içinde cevaplar. */}
                  {c.is_admin && (
                    <Badge size="xs" variant="light" color="grape">
                      {t.draft.approversAdminBadge}
                    </Badge>
                  )}
                </Group>
              }
              description={c.email}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
