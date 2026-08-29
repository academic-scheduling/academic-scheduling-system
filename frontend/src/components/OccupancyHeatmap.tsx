import { Group, Paper, Text, Tooltip } from "@mantine/core";
import type { OccupancySummary } from "../api/types";
import { SLOT_TIMES } from "../utils/slots";
import { BORDER, PAGE_SURFACE, TEXT_MUTED } from "../utils/scheduleTheme";
import { useT } from "../i18n";

const GUNLER = [1, 2, 3, 4, 5];
const LEGEND = [0.1, 0.3, 0.5, 0.75, 1];

/** Haftalık derslik doluluk ısı haritası (K-82).
 *
 *  Izgaranın şekli uydurma değil, sistemin kendi zaman modeli: dokuz slot
 *  (`utils/slots`) × beş çalışma günü. Sayılar `/dashboard/occupancy`'den
 *  hazır gelir — hücrede o gün/saatte DOLU olan ayrı derslik sayısı, payda
 *  aktif derslik sayısı.
 *
 *  Neden hücrede sayı da yazılı: rengi ayırt edemeyen kullanıcı için tek
 *  başına renk yeterli bilgi taşımaz (brief §6.2). Renk hızlı taramaya,
 *  sayı kesinliğe hizmet ediyor.
 */
export default function OccupancyHeatmap({ data }: { data: OccupancySummary }) {
  const t = useT();
  const slotlar = Object.keys(SLOT_TIMES).map(Number).sort((a, b) => a - b);
  const payda = data.classrooms;

  // Hiç yerleşim yoksa boş bir ızgara çizmek yerine tek cümle: dokuz satır
  // sıfır, kullanıcıya "bir şey bozuk mu" dedirtir.
  const doluVar = data.grid.some((satir) => satir.some((h) => h > 0));

  /** Renk ölçeği HAFTANIN EN YOĞUN hücresine göre normalize edilir, toplam
   *  derslik sayısına göre DEĞİL.
   *
   *  Gerekçe: gerçek bir fakültede tek bir saatte dersliklerin tamamı hiç
   *  dolmaz — tipik tepe %20-30 bandındadır. Ölçek 0-100 olsaydı ızgaranın
   *  tamamı en soluk iki tona sıkışır ve harita hiçbir şey göstermezdi; oysa
   *  bu blok tam olarak "hangi saat sıkışık, hangisi boş" sorusu için var.
   *
   *  Kesinlik kaybolmuyor: hücredeki SAYI ve ipucu mutlak gerçeği söylüyor
   *  ("33 dersliğin 5 tanesi dolu"). Renk yalnız göze dağılımı okutuyor —
   *  efsanenin "az / çok" demesi de bu yüzden, "%0 / %100" değil. */
  const enYogun = Math.max(1, ...data.grid.flat());

  return (
    // Kart sütunu doldurur (sayfadaki bütün kartlar gibi); sınır IZGARANIN
    // kendisinde. Sütunlar `1fr` olduğu için kapsayıcı ne kadar genişse o
    // kadar açılıyor ve hücreler haber niteliğini yitirip birer şeride
    // dönüşüyordu — üst sınır onları kareye yakın tutuyor.
    <Paper withBorder radius="md" p="lg" bg={PAGE_SURFACE}
      style={{ borderColor: BORDER }}>
      <Group justify="space-between" align="center" mb="md" gap="sm">
        <Text fz={14} fw={700}>{t.home.occupancy.title}</Text>
        <Group gap={6} align="center" c={TEXT_MUTED}>
          <Text fz={11}>{t.home.occupancy.less}</Text>
          {LEGEND.map((v) => (
            <div key={v} style={{
              width: 16, height: 10, borderRadius: 2, background: renk(v),
            }} />
          ))}
          <Text fz={11}>{t.home.occupancy.more}</Text>
        </Group>
      </Group>

      {!doluVar ? (
        <Text fz={13} c={TEXT_MUTED}>{t.home.occupancy.empty}</Text>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: `56px repeat(${GUNLER.length}, minmax(0, 1fr))`,
          gap: 4,
          maxWidth: 640,
        }}>
          <span />
          {GUNLER.map((g) => (
            <Text key={g} fz={11} fw={600} ta="center" c={TEXT_MUTED}>
              {t.days.short[g]}
            </Text>
          ))}

          {slotlar.map((slot) => {
            const satir = data.grid[slot - 1] ?? [];
            const saat = SLOT_TIMES[slot].start;
            return (
              <Hucreler key={slot} saat={saat} satir={satir}
                payda={payda} enYogun={enYogun} />
            );
          })}
        </div>
      )}
    </Paper>
  );
}

/** Bir slot satırı: sol saat etiketi + beş hücre.
 *
 *  Fragment döner (grid'in kendi hücreleri olsunlar diye) — araya bir sarmalayıcı
 *  koymak ızgarayı bozardı.
 */
function Hucreler({ saat, satir, payda, enYogun }: {
  saat: string; satir: number[]; payda: number; enYogun: number;
}) {
  const t = useT();
  return (
    <>
      <Text fz={11} c={TEXT_MUTED} lh="26px"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {saat}
      </Text>
      {GUNLER.map((gun) => {
        const dolu = satir[gun - 1] ?? 0;
        const oran = dolu / enYogun;
        return (
          <Tooltip key={gun} withArrow fz={11}
            label={t.home.occupancy.cellTip(t.days.short[gun], saat, dolu, payda)}>
            <div style={{
              height: 26, borderRadius: 3, background: renk(oran),
              display: "grid", placeItems: "center",
              fontSize: 10, fontWeight: 600,
              color: oran > 0.5 ? YOGUN_YAZI : "var(--mantine-color-dimmed)",
              cursor: "default",
            }}>
              {dolu > 0 ? dolu : ""}
            </div>
          </Tooltip>
        );
      })}
    </>
  );
}

/** Doluluk oranı → renk. Boş hücre nötr zemin; dolduça mavi belirginleşir.
 *
 *  Tek renkte yoğunlaşma (sequential) bilinçli: kırmızı-yeşil gibi anlamlı bir
 *  ölçek kullanmak "dolu = kötü" derdi, oysa doluluk ne iyi ne kötü — bir
 *  gerçek. Yorum kullanıcıya ait.
 *
 *  İki ayrı taban rengi: aydınlık temada KOYU mavi zemine doğru gider, karanlık
 *  temada AÇIK maviye. Tek taban (koyu mavi) kullanılırsa karanlık temada düşük
 *  oranlı hücreler zeminden ayırt edilemiyor — ısı haritası da tam olarak düşük
 *  ile yüksek arasındaki farkı göstermek için var.
 */
function renk(oran: number): string {
  if (oran < 0.03) return "var(--mantine-color-default-border)";
  const alfa = (0.14 + oran * 0.76).toFixed(2);
  return `light-dark(rgba(34, 139, 230, ${alfa}), rgba(116, 192, 252, ${alfa}))`;
}

/** Yoğun hücrede zemin kontrastı ters döner: aydınlıkta koyu mavi (beyaz yazı),
 *  karanlıkta açık mavi (koyu yazı). */
const YOGUN_YAZI = "light-dark(#FFFFFF, #16181C)";
