import { useEffect, useRef, useState } from "react";
import { Text } from "@mantine/core";
import { useT } from "../i18n";

/** Google reCAPTCHA v2 site anahtarı. Tanımsızsa CAPTCHA kapalıdır (K-44). */
export const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim() || "";

/** CAPTCHA devrede mi? Backend'in `recaptcha.is_enabled()` karşılığı —
 *  iki taraf da "anahtar yoksa kapalı" kuralına uyar, yoksa biri doğrulama
 *  beklerken diğeri token göndermez ve form kalıcı 400 alırdı. */
export const captchaEnabled = () => RECAPTCHA_SITE_KEY.length > 0;

const SCRIPT_ID = "recaptcha-api";
const SCRIPT_SRC = "https://www.google.com/recaptcha/api.js?render=explicit";
const READY_TIMEOUT_MS = 15000;

/**
 * `grecaptcha.render` GERÇEKTEN çağrılabilir olana kadar bekler.
 *
 * Neden script'in `onload`'u YETMEZ: Google'ın api.js'i (~1 KB) asıl
 * kütüphane değil, bir YÜKLEYİCİDİR. Çalıştığı anda `window.grecaptcha`
 * nesnesini yalnızca `ready` taşıyan bir TASLAK olarak tanımlar; `render`
 * asıl paket arkadan indikten sonra belirir. `onload`'da "hazır" sayıp
 * `render()` çağırmak bu yüzden `undefined is not a function` veriyordu —
 * ve hata, bileşenin "yüklenemedi" dalına düşüyordu.
 *
 * Yoklama (poll) tercih edildi: hem taslak→tam geçişini, hem script'in
 * zaten yüklü olduğu durumu (sayfa içi ikinci mount) tek kodla karşılar.
 */
function whenRenderReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (typeof window.grecaptcha?.render === "function") return resolve();
      if (Date.now() - started > READY_TIMEOUT_MS) {
        // Buraya düşmenin tipik sebebi script'in hiç inememesidir
        // (ağ yok, kurumsal güvenlik duvarı, reklam/gizlilik engelleyici).
        return reject(new Error("recaptcha-timeout"));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/** Script'i bir kez enjekte eder, sonra API'nin hazır olmasını bekler. */
function loadScript(): Promise<void> {
  if (typeof window.grecaptcha?.render === "function") return Promise.resolve();

  if (!document.getElementById(SCRIPT_ID)) {
    const el = document.createElement("script");
    el.id = SCRIPT_ID;
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    document.head.appendChild(el);
  }

  // Yükleme hatası ayrı bir dal gerektirmez: script inemezse `render` hiç
  // tanımlanmaz ve zaman aşımı devreye girer.
  return whenRenderReady();
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
  const t = useT();
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
        if (cancelled || rendered.current || !holder.current) return;
        if (typeof window.grecaptcha?.render !== "function") return;
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
        {t.auth.captchaFailed}
      </Text>
    );
  }

  return <div ref={holder} style={{ marginTop: "var(--mantine-spacing-md)" }} />;
}
