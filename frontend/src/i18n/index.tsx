/** K-79: dil bağlamı (provider + hook'lar).
 *
 *  Kullanım ekranlarda tek satır:
 *      const t = useT();
 *      <Button>{t.common.save}</Button>
 *      <Text>{t.layout.logoutFrom(user.email)}</Text>
 *
 *  `t` bir FONKSİYON DEĞİL, sözlüğün kendisi. Böylece anahtar bir metin değil
 *  gerçek bir alan erişimi: yanlış yazım derlemede patlar, editör tamamlar,
 *  "anahtar bulunamadı" diye bir çalışma zamanı hâli yok (bkz. `tr.ts`).
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";

import { en } from "./en";
import { tr, type Dict } from "./tr";
import { readLang, writeLang, type Lang } from "./lang";

export type { Lang } from "./lang";
export { LANGS, DEFAULT_LANG, readLang } from "./lang";

const DICTS: Record<Lang, Dict> = { tr, en };

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
};

// Varsayılan değer sağlanıyor ki provider dışında kullanım (test, izole
// bileşen) patlamak yerine Türkçeye düşsün.
const I18nContext = createContext<I18nValue>({
  lang: "tr",
  setLang: () => {},
  t: tr,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  // <html lang="..."> ekran okuyucular ve tarayıcı çevirisi için doğru olmalı;
  // ayrıca CSS'te :lang() seçicisi kullanılabilir hâle gelir.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    writeLang(next);          // önce kalıcı yaz: API istemcisi localStorage'ı
    setLangState(next);       // okuyor, sonraki istek doğru dili taşısın.
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: DICTS[lang] }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Sözlük. Ekranların %95'i yalnız bunu kullanır. */
export function useT(): Dict {
  return useContext(I18nContext).t;
}

/** Dili okumak/değiştirmek gerekenler (dil düğmesi, tarihe göre biçimleme). */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const { lang, setLang } = useContext(I18nContext);
  return { lang, setLang };
}
