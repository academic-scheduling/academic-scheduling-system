import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconArrowBackUp, IconCircleCheck, IconClockHour4, IconFilePencil,
  type IconProps,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import type { DraftStatus, ScheduleDraft } from "../api/types";
import { useT } from "../i18n";
import type { Dict } from "../i18n/tr";

/** Kaç kayıt gösterilir. Dört, tek satıra sığan en fazla kart sayısı;
 *  beşincisi ya kartları okunmaz daraltır ya da ikinci bir satır açar ve
 *  panel ana sayfanın yarısını yer. */
const LIMIT = 4;

/** Durum → renk + ikon. Yayın Merkezi'ndeki STATUS_META ile AYNI eşleme:
 *  aynı kaydın iki ekranda farklı renkte görünmesi, kullanıcıyı "bunlar aynı
 *  şey mi" diye düşündürürdü. */
const STATUS_META: Record<DraftStatus,
  { color: string; Icon: ComponentType<IconProps> }> = {
  OPEN:     { color: "yellow", Icon: IconFilePencil },
  PENDING:  { color: "blue",   Icon: IconClockHour4 },
  REJECTED: { color: "red",    Icon: IconArrowBackUp },
  APPROVED: { color: "green",  Icon: IconCircleCheck },
};

/** Gün + saat; yıl yok — panel SON hareketleri gösteriyor, yıl gürültü olurdu. */
function kisaZaman(iso: string, t: Dict): string {
  return new Date(iso).toLocaleString(t.locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Kartın açıklama satırı — duruma göre ZATEN elde olan alandan gelir.
 *
 *  Ek sunucu turu YOK: ret gerekçesi, gönderim notu ve onay özeti kaydın
 *  kendisinde taşınıyor. Açık taslakta not yoktur; "en son ne zaman
 *  dokunuldu" bilgisini üstteki tarih satırı zaten veriyor. */
function aciklama(d: ScheduleDraft): string | null {
  if (d.status === "REJECTED") return d.review_note;
  if (d.status === "APPROVED") return d.applied_summary;
  if (d.status === "PENDING") return d.submit_note;
  return null;
}

/**
 * Ana sayfadaki "Taslaklar ve onaylar" bandı (K-85).
 *
 *  Yayın Merkezi'nde görünen kayıtların EN SON DEĞİŞENİ dört tanesi. Eskiden
 *  burada "Son onaylar" (ChangeFeed) duruyordu: yalnız BİTMİŞ işleri
 *  gösteriyordu ve "şu an neyin üzerinde çalışıyorum" sorusunu cevapsız
 *  bırakıyordu. Yarım kalan taslak da, bana gelen bir onay talebi de aynı
 *  listede olmalı — ikisi de "bir sonraki işim" adayı.
 *
 *  Sıralama `updated_at`e göre (K-85'te eklendi): taslağın İÇİNDE yapılan
 *  değişiklik de, gönderim/onay/ret de o alana dokunuyor. Bu yüzden bir taslakta
 *  çalışırken başka birinden onay talebi gelirse talep en üste çıkar ve
 *  çalıştığın taslak hemen altında kalır.
 */
export default function RecentPublishing() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ScheduleDraft[] | null>(null);

  useEffect(() => {
    // Yayın Merkezi'nin okuduğu UÇLARIN AYNISI — kapsam (kimin neyi görebildiği)
    // orada üç ayrı görünürlük kuralıyla çözülmüş durumda ve burada yeniden
    // türetmek iki ekranı zamanla ayrıştırırdı.
    const jobs = [
      api.get<ScheduleDraft[]>("/schedule-drafts"),
      api.get<ScheduleDraft[]>("/schedule-approvals/history"),
    ];
    if (user?.can_approve_schedule) {
      jobs.push(api.get<ScheduleDraft[]>("/schedule-approvals"));
    }
    Promise.all(jobs)
      .then((listeler) => {
        // Aynı kayıt iki uçtan gelebilir: kendi bekleyen talebim hem
        // "taslaklarım"da hem onay kuyruğunda. id ile tekilleştiriliyor.
        const m = new Map<number, ScheduleDraft>();
        for (const liste of listeler) for (const d of liste) m.set(d.id, d);
        setItems([...m.values()]
          .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
          .slice(0, LIMIT));
      })
      // İKİNCİL panel: hatası ana sayfayı bozmamalı, boş görünür.
      .catch(() => setItems([]));
  }, [user]);

  if (items === null) return null;          // henüz yüklenmedi

  return (
    <Paper withBorder radius="md" p="lg" bg={PAGE_SURFACE} style={{ borderColor: BORDER }}>
      <Group justify="space-between" align="baseline" mb={items.length ? 12 : 6}>
        <Text fz={14} fw={700}>{t.recentPublishing.title}</Text>
        <Anchor component="button" type="button" fz={12}
          onClick={() => navigate("/publishing")}>
          {t.recentPublishing.openCenter}
        </Anchor>
      </Group>

      {items.length === 0 ? (
        <Text fz={13} c={TEXT_MUTED}>{t.recentPublishing.empty}</Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: LIMIT }} spacing="md">
          {items.map((d) => {
            const meta = STATUS_META[d.status];
            const not = aciklama(d);
            return (
              // Sol kenar durumun rengi: kart yığınında "hangisi bekliyor,
              // hangisi reddedildi" rozeti okumadan da seçilebilsin.
              <Paper key={d.id} withBorder radius="md" p="md" bg={PAGE_SURFACE}
                style={{
                  borderColor: BORDER,
                  borderLeft: `3px solid var(--mantine-color-${meta.color}-6)`,
                  display: "flex", flexDirection: "column",
                }}>
                <Group gap={6} mb={8} wrap="wrap">
                  <Badge size="sm" variant="light" color={meta.color}
                    leftSection={<meta.Icon size={12} />}>
                    {t.draft.status[d.status]}
                  </Badge>
                  {/* Tür etiketi Değişiklik Akışı'ndaki sözcüklerin AYNISI —
                      aynı kavram iki ekranda iki farklı adla anılmasın. */}
                  <Badge size="sm" variant="light" color="gray">
                    {d.kind === "EXAM" ? t.changeFeed.examSchedule : t.changeFeed.weeklySchedule}
                  </Badge>
                </Group>

                <Text fz={14} fw={700} truncate>
                  {d.department_code} · {t.courses.yearN(d.year)} · {t.enums.semester[d.semester]}
                </Text>
                <Text fz={12} c={TEXT_MUTED} truncate mt={2}>
                  {d.owner.name} · {kisaZaman(d.updated_at, t)}
                </Text>
                <Text fz={12} mt={6}>{t.publishing.changeCount(d.change_count)}</Text>
                {not && (
                  <Text fz={12} c={TEXT_MUTED} mt={6} lineClamp={2}>{not}</Text>
                )}

                {/* Düğme HER KARTTA aynı: buradaki iş "bak", karar Yayın
                    Merkezi'nde veriliyor. Karta göre değişen bir eylem
                    (gönder/geri çek/aç) ana sayfada tek tıkla geri alınamaz
                    sonuçlar doğururdu. mt:auto — kartlar farklı yükseklikte
                    olsa da düğmeler aynı hizada. */}
                <Button size="xs" variant="light" fullWidth
                  mt="sm" style={{ marginTop: "auto" }}
                  onClick={() => navigate(`/publishing?draft_id=${d.id}`)}>
                  {t.recentPublishing.view}
                </Button>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
    </Paper>
  );
}
