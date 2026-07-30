import type { CSSProperties } from "react";

/** Haftalık Program ve Sınav Takvimi ekranlarının ORTAK görsel belirteçleri.
 *
 *  Neden ayrı dosya: iki ekran aynı takvim dilini konuşuyor ama sabitleri
 *  kendi dosyalarında ayrı ayrı tutuyordu. Değerler zamanla birbirinden
 *  ayrıştı (gün başlığı 42'ye karşı 48, palet 190'a karşı 214, gri tonları
 *  "benzer ama aynı değil") ve iki sayfa yan yana konunca farklı ürünlerden
 *  gelmiş gibi duruyordu. Tek kaynak, ayrışmayı yapısal olarak imkânsız kılar.
 */

/* --- Renkler ------------------------------------------------------------ */

/** Saat/slot satırlarını ayıran yatay çizgi — bilinçli olarak çok açık:
 *  ızgara okunmayı desteklemeli, dikkati kendine çekmemeli. */
export const LINE = "#F1F5F9";

/** Günleri ayıran DİKEY çizgi. Yataydan belirgin biçimde koyu: bir günün
 *  nerede bitip diğerinin nerede başladığı takvimin en temel okuma sınırıdır;
 *  yatay saat çizgileriyle yakın tonda olunca sütunlar birbirine akıyordu. */
export const DAY_LINE = "#94A3B8";

/** İmleç boş bir slotun üzerindeyken o alana düşen vurgu — "buraya
 *  eklenebilir" sinyali. Artı işaretiyle birlikte görünür. */
export const HOVER_CELL_BG = "#E9EEF5";

export const BORDER = "#E2E8F0";        // kart ve panel kenarı
export const BORDER_HOVER = "#CBD5E1";  // hover'da bir tık koyulaşır
export const HEADER_BG = "#EEF2F7";     // gün başlığı bandı — hücrelerden koyu
export const SIDEBAR_BG = "#F8FAFC";    // sol panel zemini
export const PAGE_SURFACE = "#FFFFFF";  // kart zemini

/** BOŞ slotun zemini. Izgara gövdesi hafif gri, kartlar beyaz: böylece kart
 *  "dolu", boşluk "boş" olarak okunur. Her ikisi de beyazken slotun dolu mu
 *  boş mu olduğu ancak kenarlığa bakılarak anlaşılıyordu.
 *  Tonlar bilerek kademeli: başlık (#EEF2F7) > hover (#E9EEF5 koyu vurgu)
 *  ... boş hücre (#F8FAFC) > kart (beyaz). */
export const GRID_CELL_BG = "#F8FAFC";

export const TIME_COLOR = "#94A3B8";    // saat cetveli — susturulmuş
export const TEXT_MUTED = "#64748B";    // ikincil metin (derslik, hoca)
export const TEXT_BODY = "#334155";     // ikincilden bir ton koyu
export const TEXT_STRONG = "#0F172A";   // ders kodu

/** Durum vurgusu — YALNIZ ince sol çizgide ve küçük ikonda kullanılır.
 *  Kart zemini her durumda beyaz kalır; renkli dolgu, yan yana duran
 *  kartları okunmaz bir vitrine çeviriyordu. */
export const ACCENT = {
  normal: "#2563EB",
  warn: "#F59E0B",
  hard: "#EF4444",
  draft: "#94A3B8",
};

/* --- Gölgeler ----------------------------------------------------------- */

export const SHADOW = "0 1px 2px rgba(15, 23, 42, 0.06)";
export const SHADOW_HOVER = "0 4px 12px rgba(15, 23, 42, 0.10)";
export const SHADOW_SELECTED = "0 6px 16px rgba(37, 99, 235, 0.16)";

/* --- Ölçüler ------------------------------------------------------------ */

export const CONTROL_H = 34;   // araç çubuğundaki her kontrol aynı yükseklikte
export const HEAD_H = 48;      // gün başlığı bandı (iki satır: gün + tarih)
export const TIME_COL_W = 52;  // sol saat cetveli — sabit genişlik
export const SIDE_W = 214;     // sol ders paneli
export const MIN_DAY_W = 172;  // bir günün en dar hâli
export const MIN_LANE_W = 176; // paralel kart şeridinin en dar hâli

/** Izgara gövdesinin yüksekliği. İki ekranın dikey ölçeği farklı — haftalıkta
 *  9 slot, sınavda 08:00-21:00 arası 13 saatlik dilim — ama TOPLAM yükseklik
 *  aynı olmalı ki iki sayfa arasında geçerken takvim "zıplamasın".
 *  Sayılar bunun için seçildi:  9 × 91 = 819  ·  13 × 63 = 819
 *  (Sınav penceresi 21:00'de kalır: K-06 akşam sınavına izin veriyor, pencereyi
 *  daraltmak geç saatli bir sınavı sessizce kırpardı.) */
export const GRID_BODY_H = 819;
export const WEEKLY_ROW_H = 91;   // bir slot
export const EXAM_HOUR_H = 63;    // bir saat

/** Kart iç yerleşimi — iki ekranda da aynı. */
export const CARD_RADIUS = 10;
export const CARD_PADDING = "8px 9px";

/** Sol paneldeki ders satırının kart görünümü — iki ekranda da birebir aynı.
 *
 *  Satır, gri panelin üzerinde BEYAZ ve çerçeveli durur: zeminle aynı renk
 *  olduğunda nerede başlayıp bittiği belirsizdi ve liste tek bir metin
 *  yığınına dönüşüyordu.
 *
 *  Sol kenar HER ZAMAN 2px: yalnız rengi değişir. Kalınlığı hover'da
 *  büyütmek satırı yatayda oynatır ve liste titrer.
 *
 *  Kenarlar uzun formda yazılır — `border` kısayolu ile `borderLeftColor`
 *  birlikte kullanılırsa React yeniden render'da kısayolu uygulayıp uzun
 *  formu atlar ve vurgu sessizce kaybolur (kart tarafında yaşanan hata).
 */
export function paletteItemStyle(hover: boolean): CSSProperties {
  return {
    padding: "7px 9px",
    borderRadius: 8,
    background: PAGE_SURFACE,
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 2,
    borderTopStyle: "solid", borderRightStyle: "solid",
    borderBottomStyle: "solid", borderLeftStyle: "solid",
    borderTopColor: hover ? BORDER_HOVER : BORDER,
    borderRightColor: hover ? BORDER_HOVER : BORDER,
    borderBottomColor: hover ? BORDER_HOVER : BORDER,
    borderLeftColor: hover ? ACCENT.normal : BORDER,
    boxShadow: hover ? SHADOW_HOVER : SHADOW,
    transition: "box-shadow 120ms ease, border-color 120ms ease",
  };
}
