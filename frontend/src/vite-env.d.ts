/// <reference types="vite/client" />

/** Uygulamanın okuduğu derleme zamanı değişkenleri.
 *
 *  Vite yalnız VITE_ önekli değişkenleri istemciye yayar; buradaki tip bildirimi
 *  de yanlış isim yazıldığında derlemede yakalanmasını sağlar.
 */
interface ImportMetaEnv {
  /** Backend'in kök adresi. Geliştirmede tanımsız bırakılır ve "/api" proxy'si
   *  devreye girer; yayında "https://<backend-adresi>" verilir. */
  readonly VITE_API_BASE_URL?: string;

  /** Google reCAPTCHA v2 site anahtarı (K-44). Tanımsızken şifre sıfırlama
   *  formunda CAPTCHA hiç gösterilmez — backend de doğrulamayı atlar, ikisi
   *  aynı "anahtar yoksa kapalı" kuralına uyar. */
  readonly VITE_RECAPTCHA_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Google'ın script'i yüklendiğinde window'a eklediği API (K-44).
 *  Kütüphane eklemek yerine doğrudan bildirim: tek bir formda kullanılıyor,
 *  bir react wrapper paketi bağımlılık maliyetine değmez. */
interface Window {
  grecaptcha?: {
    /** Yükleyici script'in ilk anda tanımladığı taslakta DA bulunur; `render`
     *  ise asıl paket inince belirir. Bu yüzden ikisi ayrı opsiyonel. */
    ready?: (callback: () => void) => void;
    render?: (
      container: HTMLElement,
      params: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      },
    ) => number;
    reset: (widgetId?: number) => void;
  };
}
