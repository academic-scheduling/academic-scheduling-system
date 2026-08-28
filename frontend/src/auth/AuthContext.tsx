import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { api, getToken, setToken, clearToken } from "../api/client";
import type { LoginResponse, User } from "../api/types";
import { useT } from "../i18n";

type AuthState = {
  /** null = girişli değil. loading true iken bu değere GÜVENME. */
  user: User | null;
  /** true = "girişli mi?" sorusunun cevabı henüz bilinmiyor (açılış kontrolü sürüyor). */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** GEÇİCİ TANI (kaldırılacak): boşta-uyarı modalına kalan ms. Gerçek
   *  `lastActivity` ref'inden hesaplanır — sidebar'daki sayaç bunu okur. */
  idleWarningRemainingMs: () => number;
};

const AuthContext = createContext<AuthState | null>(null);

/** K-80 — sekmeler arası kimlik izi.
 *
 *  Token zaten localStorage'da ama KİMLİK sorusunu cevaplamıyor: her tazelemede
 *  değeri değişir, oysa kullanıcı aynıdır. Yanına kullanıcı id'sini yazıyoruz;
 *  `storage` dinleyicisi "kim" değişti mi diye buna bakar. Gizli bir bilgi
 *  değildir (token'ın içinde zaten var), yalnız ucuz bir karşılaştırma anahtarı. */
const UID_KEY = "auth_uid";
const readUid = (): string | null => {
  try { return localStorage.getItem(UID_KEY); } catch { return null; }
};
const writeUid = (id: number | null): void => {
  try {
    if (id === null) localStorage.removeItem(UID_KEY);
    else localStorage.setItem(UID_KEY, String(id));
  } catch { /* kota/gizli mod: iz tutulamazsa sekme senkronu çalışmaz, oturum çalışır */ }
};

// --- Oturum yönetimi (K-47) ---
// Karar: MUTLAK 60 dk yerine BOŞTA-KALMA modeli. Aktif çalışırken token sessizce
// tazelenir (kesinti yok); yalnız hareketsizlikte "uzat/çık" sorulur.
//
// K-84: eşik 15 → 45 dk. Program hazırlamak ekrandan gözünü ayırmadan yapılan
// bir iş değil — kullanıcı basılı listeye, telefona, yan masaya dönüyor ve 15
// dakika bunun için kısaydı; uyarı, güvenlik kazancından çok kesinti üretiyordu.
//
// Üst sınır token'ın ömrüdür (backend `access_token_expire_minutes` = 60):
// keepalive son hareketten en geç 10 dk sonra durduğu için, uyarı anında
// token'ın yaşı en kötü 55 dk olur; 60 sn'lik mühletle 56. Eşik daha yukarı
// çekilecekse önce backend'deki ömür büyütülmeli, yoksa "Devam et" 401 alır.
const IDLE_LIMIT_MS = 45 * 60 * 1000;    // 45 dk hareketsizlik → uzatmayı sor
const GRACE_SEC = 60;                     // modal açıldıktan sonra otomatik çıkışa kalan saniye
const KEEPALIVE_MS = 10 * 60 * 1000;      // aktifken token'ı bu aralıkla sessizce tazele
const TICK_MS = 30 * 1000;                // boşta/keepalive denetim sıklığı
// Yalnız ref güncelleyen ucuz olaylar (render tetiklemez).
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  // I18nProvider bunun DIŞINDA (main.tsx) — oturum uyarısı da çevrilebilsin.
  const t = useT();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Oturum durumu: son etkinlik/tazeleme anları ref'te (render tetiklemesin).
  const lastActivity = useRef(Date.now());
  const lastRefresh = useRef(Date.now());
  /** K-80: bu sekmenin bildiği son KİMLİK. Token'ın kendisi karşılaştırılamaz:
   *  keepalive onu her 10 dakikada tazeliyor ve iki açık sekme birbirini
   *  durmadan yenilerdi. Değişmesi anlamlı olan şey kullanıcının KİM olduğu. */
  const sonGorulenUid = useRef<string | null>(readUid());
  const [promptOpen, setPromptOpen] = useState(false);   // boşta uyarı modalı açık mı
  const [grace, setGrace] = useState(GRACE_SEC);          // modaldaki geri sayım

  // Açılış kontrolü: localStorage'da token varsa hâlâ geçerli mi, kimin?
  // Cevabı yalnız backend bilir (60 dk dolmuş olabilir, hesap pasife alınmış olabilir).
  useEffect(() => {
    if (!getToken()) {
      setLoading(false); // token yok — sormaya gerek yok, kesin girişsiz
      return;
    }
    api
      .get<User>("/auth/me")
      .then((u) => {
        // K-80: kimlik izini burada da tazele — K-80 öncesinden gelen açık
        // oturumlarda `auth_uid` henüz yazılmamıştır.
        writeUid(u.id);
        sonGorulenUid.current = String(u.id);
        setUser(u);
      })
      .catch(() => {
        // 401 ise client.ts token'ı zaten sildi ve /login'e yönlendirdi.
        // Ağ hatasıysa (backend kapalı) token'a DOKUNMUYORUZ: kullanıcıyı
        // backend'in geçici arızası yüzünden oturumdan atmak yanlış olur.
      })
      .finally(() => setLoading(false));
  }, []);

  /** K-80 — BAŞKA SEKMEDE kimlik değişirse bu sekme eski kullanıcıyı gösteremez.
   *
   *  Token localStorage'da durur ve tüm sekmeler onu PAYLAŞIR. Bir sekmede
   *  başka bir hesapla giriş yapılınca bu sekmenin istekleri anında yeni
   *  kimlikle gitmeye başlar — sunucu tarafında sızıntı YOKTUR, yeni kullanıcı
   *  öncekinin taslağını çekemez (404). Kusur EKRANDA: React state hâlâ eski
   *  kullanıcıyı ve onun yüklenmiş listelerini tutar. Paylaşılan bir
   *  bilgisayarda bu, K-59'un "taslak sahibinden başkasına görünmez" kuralını
   *  görsel olarak deler.
   *
   *  Çözüm sayfayı baştan yüklemek. Nokta atışı bir state tazelemesi yerine
   *  reload seçildi: kimlik uygulamanın HER yerine dağılmış bir varsayımdır
   *  (yüklenmiş listeler, açık drawer'lar, taslak modu), tek tek tazelemeye
   *  çalışmak birini unutmak demektir. Kimlik değişimi ayrıca nadirdir.
   *
   *  `storage` olayı yalnız DİĞER sekmelerde tetiklenir; kendi login/logout
   *  akışımız bu yüzden döngüye girmez. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== UID_KEY) return;   // null = storage.clear()
      const suanki = readUid();
      if (suanki === sonGorulenUid.current) return;      // yalnız tazeleme yankısı
      sonGorulenUid.current = suanki;
      window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function login(email: string, password: string) {
    // Hata fırlatırsa (401 = şifre yanlış) bilerek yakalamıyoruz —
    // login formu ApiError'ı yakalayıp mesajı alanın altında gösterecek.
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    setToken(res.access_token);
    writeUid(res.user.id);
    sonGorulenUid.current = String(res.user.id);
    setUser(res.user);
    lastActivity.current = Date.now();
    lastRefresh.current = Date.now();
  }

  const logout = useCallback(() => {
    clearToken();
    writeUid(null);              // K-80: diğer sekmeler de çıkışı görsün
    sonGorulenUid.current = null;
    setUser(null);
    setPromptOpen(false);
  }, []);

  // Token'ı ileri taşı (yeni 60 dk). get_current_user ACTIVE arar; kapatılmış
  // hesap burada 401/403 alır → yenilenemez.
  const refresh = useCallback(async () => {
    const res = await api.post<LoginResponse>("/auth/refresh");
    setToken(res.access_token);
    writeUid(res.user.id);        // kimlik aynı; yankı `sonGorulenUid` ile susturulur
    sonGorulenUid.current = String(res.user.id);
    setUser(res.user);
    lastRefresh.current = Date.now();
  }, []);

  // "Oturumu uzat": tazele, sayacı sıfırla, modalı kapat. Tazelenemezse çık.
  const extend = useCallback(async () => {
    try {
      await refresh();
      lastActivity.current = Date.now();
      setPromptOpen(false);
    } catch {
      logout();
    }
  }, [refresh, logout]);

  // Etkinlik izleme + boşta/keepalive denetimi — yalnız girişliyken.
  useEffect(() => {
    if (!user) return;
    const onActivity = () => {
      // Modal açıkken sıradan hareket oturumu uzatmaz; kullanıcı bilerek seçmeli.
      if (!promptOpen) lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }));

    const tick = setInterval(() => {
      if (promptOpen) return;
      const now = Date.now();
      const idle = now - lastActivity.current;
      if (idle >= IDLE_LIMIT_MS) {
        setGrace(GRACE_SEC);
        setPromptOpen(true);                      // eşiği geçti → uzatmayı sor
      } else if (idle < KEEPALIVE_MS && now - lastRefresh.current >= KEEPALIVE_MS) {
        refresh().catch(() => { /* 401 → client.ts login'e atar */ });
      }
    }, TICK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(tick);
    };
  }, [user, promptOpen, refresh]);

  // Modal geri sayımı: her saniye azalır, 0'da otomatik çıkış.
  useEffect(() => {
    if (!promptOpen) return;
    if (grace <= 0) { logout(); return; }
    const t = setTimeout(() => setGrace((g) => g - 1), 1000);
    return () => clearTimeout(t);
  }, [promptOpen, grace, logout]);

  // GEÇİCİ TANI: boşta-uyarısına kalan süre (ms). Modal açıkken 0. Sidebar sayacı
  // her saniye bunu çağırır; hareket olunca lastActivity sıfırlanır → sayaç
  // eşiğe (45:00) döner.
  const idleWarningRemainingMs = useCallback(
    () => (promptOpen ? 0 : Math.max(0, IDLE_LIMIT_MS - (Date.now() - lastActivity.current))),
    [promptOpen]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, idleWarningRemainingMs }}>
      {children}
      <Modal
        opened={promptOpen}
        onClose={() => { /* dışarı tık/ESC ile kapanmaz — bilinçli seçim şart */ }}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        title={t.session.idleTitle}
      >
        <Stack>
          <Text size="sm">
            {/* Dakika SABİTTEN türetiliyor: eşik değişince cümle de değişsin,
                iki ayrı yerde 15/45 tutmaya çalışmayalım. */}
            {t.session.idleBody(IDLE_LIMIT_MS / 60000)}{" "}
            <b>{t.session.idleSeconds(grace)}</b>{t.session.idleTail}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={logout}>{t.layout.logout}</Button>
            <Button onClick={extend}>{t.session.extend}</Button>
          </Group>
        </Stack>
      </Modal>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth yalnızca <AuthProvider> içinde kullanılabilir");
  return ctx;
}

/** Bir bölümde YAZMA yetkisi var mı? (K-25 + K-26 iki boyutu tek yerde)
 *
 *  Ekranlar bunu çağırır: `canWriteIn(user, "can_manage_courses", dep.id)`.
 *  Kural burada tek yerde durur — 9 ekrana dağılırsa biri yanlış uygular.
 *  DİKKAT: bu yalnız GÖRÜNÜM kararıdır (butonu göster/gizle). Otorite
 *  sunucudadır; UI'da gizlemek güvenlik değildir (brief §10.2).
 */
export function canWriteIn(
  user: User | null,
  capability: keyof Pick<
    User,
    | "can_manage_courses"
    | "can_manage_weekly"
    | "can_manage_exams"
    | "can_manage_classrooms"
    | "can_manage_lecturers"
  >,
  departmentId?: number,
): boolean {
  if (!user) return false;
  if (!user[capability]) return false;              // 1. boyut: yetenek
  if (departmentId === undefined) return true;      // paylaşımlı kaynak (derslik, hoca)
  if (user.role === "ADMIN") return true;           // admin her bölümde yetkili
  return user.department_ids.includes(departmentId); // 2. boyut: üyelik
}