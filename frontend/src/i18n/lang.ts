/** K-79: dilin SAKLANMASI — React'ten bağımsız, sade modül.
 *
 *  Neden ayrı dosya: API istemcisi (`api/client.ts`) de dili bilmek zorunda
 *  (`Accept-Language` başlığı), ama o bir React bileşeni değil ve hook
 *  kullanamaz. Provider ile istemci aynı iki fonksiyonu paylaşsın diye saklama
 *  kararı burada TEK yerde duruyor — token'ın `client.ts`'te tek yerde durması
 *  gibi.
 *
 *  Tercih localStorage'da (K-79 kullanıcı kararı): tema tercihiyle aynı desen,
 *  sunucu turu yok, DB migration gerekmez. Bedeli: başka cihazda tekrar seçilir.
 */

export type Lang = "tr" | "en";

export const LANGS: readonly Lang[] = ["tr", "en"] as const;
export const DEFAULT_LANG: Lang = "tr";

const LANG_KEY = "lang";

export function readLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    if (raw === "tr" || raw === "en") return raw;
  } catch {
    /* localStorage kapalıysa (gizli sekme/izin) varsayılana düş */
  }
  return DEFAULT_LANG;
}

export function writeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* yazılamazsa tercih oturumluk kalır — akışı kesmeye değmez */
  }
}
