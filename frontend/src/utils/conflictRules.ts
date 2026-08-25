/** Çakışma kurallarının TEK kaynağı — kod, şiddet, kol (K-82).
 *
 *  K-81'e kadar bu liste `ConflictsPage` içinde gömülüydü; oradaki tek
 *  tüketici kural sözlüğü pop-up'ıydı. K-82'de ana sayfaya "kural bazında
 *  dağılım" bloğu gelince ikinci bir tüketici doğdu. İki sayfa listeyi ayrı
 *  ayrı taşısaydı gün gelir biri ötekinden ayrışırdı: yeni bir kural eklenir,
 *  birine yazılır, ötekinde eksik kalır ve ekranlar aynı taramayı farklı
 *  anlatırdı. (K-80'de "gizlilik kuralı tek yerde dursun" derken kaçındığımız
 *  şeyin aynısı.)
 *
 *  Şiddetler `docs/cakisma_kural_seti_1.md` tablolarından birebir alınmıştır.
 */

/** Kural kolu: motorun üç ayrı taraması. Kodun İLK HARFİ bunu zaten söylüyor —
 *  ayrı bir eşleme tablosu tutmak, kod ile kol arasında ikinci bir gerçek
 *  kaynağı yaratmak olurdu. */
export type RuleFamily = "W" | "E" | "X";

/** Sıra motorun kod sırası DEĞİL, kolların sırası: haftalık (W) → sınav (E) →
 *  çapraz (X). Kullanıcı bir kuralı ararken hangi ekranla ilgili olduğunu
 *  bilir, kodun sayısını değil.
 *
 *  Şiddet ve sıra TEK listede duruyor: ayrı bir `RULE_SEVERITY` haritası
 *  olsaydı ikisi zamanla ayrışabilirdi; yan yana durunca eksik alan derleme
 *  hatası olur. */
export const RULE_CATALOG: { kod: string; hard: boolean }[] = [
  { kod: "W1", hard: true },   { kod: "W2", hard: true },   { kod: "W3", hard: true },
  { kod: "W4", hard: false },  { kod: "W5", hard: false },  { kod: "W6", hard: true },
  { kod: "W7", hard: false },  { kod: "W8", hard: false },  { kod: "W9", hard: false },
  { kod: "E1", hard: true },   { kod: "E2", hard: true },   { kod: "E3", hard: true },
  { kod: "E4a", hard: true },  { kod: "E4b", hard: false }, { kod: "E5", hard: false },
  { kod: "E5a", hard: false }, { kod: "E6", hard: true },   { kod: "E7", hard: false },
  { kod: "E8", hard: false },  { kod: "E9", hard: false },   // E9: K-81 gözetmen
  { kod: "X1", hard: true },   { kod: "X2", hard: false },  { kod: "X3", hard: false },
  { kod: "X4", hard: false },                                // X4: K-81 gözetmen
];

/** Kodun hangi kola ait olduğu. Tanınmayan kod (motor yeni kural eklemiş ama
 *  katalog güncellenmemiş) "W" sayılmaz — `null` döner ve çağıran onu
 *  gruplamanın dışında bırakır. Sessizce yanlış kola koymaktansa göstermemek
 *  yeğdir; yanlış kolda görünen satır kullanıcıyı yanlış ekrana yollar. */
export function ruleFamily(kod: string): RuleFamily | null {
  const harf = kod.charAt(0).toUpperCase();
  return harf === "W" || harf === "E" || harf === "X" ? harf : null;
}

/** Katalogdaki sırayı sayıya çevirir — dağılım listesini "önce çok vuran"
 *  diye sıralarken eşitlik durumunda kullanılır ki sıra rastgele olmasın. */
const SIRA = new Map(RULE_CATALOG.map(({ kod }, i) => [kod, i]));

export function ruleOrder(kod: string): number {
  return SIRA.get(kod) ?? Number.MAX_SAFE_INTEGER;
}
