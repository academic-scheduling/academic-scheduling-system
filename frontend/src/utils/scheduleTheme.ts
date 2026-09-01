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

/* Karanlık mod: her sabit `light-dark(açık, koyu)` ile iki değerli. Açık
 * değerler eskisiyle BİREBİR aynı; koyu değerler Mantine dark rampasına (body
 * #242424, yüzey #2C2E33, kenar #373A40) uyumlu seçildi. Tarayıcı `:root`
 * üzerindeki `color-scheme`e göre çözer (Mantine set eder). Kademeli katman
 * mantığı karanlıkta korunur: kart en açık (dolu), boş hücre daha koyu, ızgara
 * en koyu — yani "dolu/boş" ayrımı aydınlıktakiyle aynı okunur. */

/** Saat/slot satırlarını ayıran yatay çizgi — bilinçli olarak çok silik:
 *  ızgara okunmayı desteklemeli, dikkati kendine çekmemeli. */
export const LINE = "light-dark(#E3E9F0, #2C2C2C)";

/** Günleri ayıran DİKEY çizgi. Yataydan belirgin biçimde ayrık: bir günün
 *  nerede bitip diğerinin nerede başladığı takvimin en temel okuma sınırıdır. */
export const DAY_LINE = "light-dark(#94A3B8, #4A4E57)";

/** İmleç boş bir slotun üzerindeyken o alana düşen vurgu — "buraya
 *  eklenebilir" sinyali. Artı işaretiyle birlikte görünür. */
export const HOVER_CELL_BG = "light-dark(#E1E8F1, #31343B)";

export const BORDER = "light-dark(#E2E8F0, #373A40)";        // kart ve panel kenarı
export const BORDER_HOVER = "light-dark(#CBD5E1, #4A4E57)";  // hover'da bir tık belirginleşir
export const HEADER_BG = "light-dark(#E4EAF1, #2A2C31)";     // gün başlığı bandı
export const SIDEBAR_BG = "light-dark(#F8FAFC, #1E1F23)";    // sol panel zemini
export const PAGE_SURFACE = "light-dark(#FFFFFF, #2C2E33)";  // kart zemini (en açık katman)
// K-59: taslak modu şeridi. Kullanıcının "şu an yayına mı yazıyorum" sorusunu
// hiç sormaması gerekir; şerit bu yüzden zeminden AYRIŞIR. Koyu temada açık
// sarı kullanmak ekranı yırtıyordu — iki tema için ayrı ton.
export const DRAFT_SURFACE = "light-dark(#FFFBEB, #33301F)";
export const DRAFT_BORDER = "light-dark(#FDE68A, #6B5D2A)";

/** BOŞ slotun zemini: ızgara gövdesinden bir ton, karttan iki ton koyu.
 *  Böylece kart "dolu", boşluk "boş" olarak okunur — aydınlıkta beyaz kart /
 *  gri hücre, karanlıkta açık yüzey / koyu hücre.
 *
 *  K-85: aydınlık değer #F8FAFC idi ve beyaz kartla neredeyse aynı okunuyordu —
 *  dolu/boş ayrımı kayboluyordu. Bir ton koyulaştırıldı. Tek başına yetmezdi:
 *  LINE bu değerden AÇIK kalıp çizgileri ters çevirirdi, HOVER ve HEADER_BG ise
 *  yeni zemine yapışırdı. Bu yüzden aydınlık rampanın tamamı birlikte kaydı;
 *  sıralama korunuyor: kart (#FFF) > hücre > başlık ≈ hover > öğle bandı. */
export const GRID_CELL_BG = "light-dark(#EDF1F6, #242629)";

/** ÖĞLE ARASI bandının zemini (slots.LUNCH_SLOT = 12:30-13:15).
 *
 *  Ders konulması engellenmiyor, yalnız "bu saat öğle molasına denk geliyor"
 *  bilgisi veriliyor -- bu yüzden metin ya da ikon değil, yalnız zemin tonu.
 *
 *  Ton NÖTR: paletin kendi slate ailesinden (BORDER ile aynı değer), hiç
 *  sıcaklık taşımıyor. Sıcak/bej bir ton denenmişti ve turuncuya kaçıp
 *  ACCENT.warn ile karışıyordu; öğle arası bir UYARI değil, günün sabit bir
 *  dilimi.
 *
 *  Yön: band iki temada da zeminden DAHA KOYU. Böylece "çukurda kalan şerit"
 *  okuması ışık/karanlık fark etmeksizin aynı; HOVER_CELL_BG ise her zaman
 *  açığa gittiği için öğle satırında da vurgu görünür kalır (yoksa o satırda
 *  ekleme geri bildirimi kaybolur ve arayüz bozuk sanılır).
 */
export const LUNCH_CELL_BG = "light-dark(#D8DFE9, #191B1E)";

export const TIME_COLOR = "light-dark(#94A3B8, #6E7178)";    // saat cetveli — susturulmuş
export const TEXT_MUTED = "light-dark(#64748B, #909296)";    // ikincil metin (derslik, hoca)
export const TEXT_BODY = "light-dark(#334155, #C1C2C5)";     // ikincilden bir ton belirgin
export const TEXT_STRONG = "light-dark(#0F172A, #E6E8EC)";   // ders kodu

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
