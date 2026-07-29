import { useEffect, useRef, useState } from "react";
import { Text } from "@mantine/core";

/** Google reCAPTCHA v2 site anahtarı. Tanımsızsa CAPTCHA kapalıdır (K-44). */
export const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || "";

/** CAPTCHA devrede mi? Backend'in `recaptcha.is_enabled()` karşılığı —
 *  iki taraf da "anahtar yoksa kapalı" kuralına uyar, yoksa biri doğrulama
 *  beklerken diğeri token göndermez ve form kalıcı 400 alırdı. */
export const captchaEnabled = () => RECAPTCHA_SITE_KEY.length > 0;

const SCRIPT_ID = "recaptcha-api";
const SCRIPT_SRC = "https://www.google.com/recaptcha/api.js?render=explicit";

/** Script'i bir kez yükler; sonraki çağrılar aynı sözü paylaşır. */
function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.grecaptcha) return resolve();

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("script")));
      return;
    }

    const el = document.createElement("script");
    el.id = SCRIPT_ID;
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("script"));
    document.head.appendChild(el);
  });
}

type Props = {
  /** Kullanıcı kutuyu işaretleyince token, süresi dolunca null gelir. */
  onChange: (token: string | null) => void;
};

/**
 * "Ben robot değilim" kutusu (K-44).
 *
 * Anahtar tanımlı değilse hiçbir şey çizmez ve hiçbir ağ isteği yapmaz —
 * yerel geliştirme ile demo makinesi internetsiz de çalışsın diye.
 */
export default function Recaptcha({ onChange }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!captchaEnabled()) return;

    let cancelled = false;
    loadScript()
      .then(() => {
        // StrictMode geliştirmede efektleri iki kez çalıştırır; grecaptcha
        // aynı kutuyu ikinci kez render etmeyi hata sayar.
        if (cancelled || rendered.current || !holder.current || !window.grecaptcha) return;
        rendered.current = true;
        window.grecaptcha.render(holder.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback: (token) => onChange(token),
          // Token'ın ömrü kısadır; dolduğunda butonu tekrar kilitlemek için
          // null yollanır, yoksa kullanıcı ölü bir token'la 400 alırdı.
          "expired-callback": () => onChange(null),
          "error-callback": () => onChange(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // onChange her render'da yeni referans olabilir; efektin tekrar
    // çalışmaması için bilerek bağımlılık listesine alınmadı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!captchaEnabled()) return null;

  if (failed) {
    return (
      <Text c="red" size="sm" mt="md">
        Doğrulama bileşeni yüklenemedi. İnternet bağlantınızı kontrol edip
        sayfayı yenileyin.
      </Text>
    );
  }

  return <div ref={holder} style={{ marginTop: "var(--mantine-spacing-md)" }} />;
}
