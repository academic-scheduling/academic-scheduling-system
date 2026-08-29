// Uygulamanın TEK fetch noktası. Kontratın genel kuralları (Bearer başlığı,
// {detail} hata formatı, 401 oturum düşmesi) burada bir kez kodlanır;
// ekranlar api.get/post/patch/delete dışında hiçbir şey bilmez.

// Geliştirmede "/api" kalır ve vite.config.ts proxy'si isteği localhost:8000'e
// taşır. Üretim derlemesinde proxy diye bir şey YOKTUR — dev sunucusuna aitti —
// bu yüzden yayına çıkarken VITE_API_BASE_URL ile backend'in gerçek adresi
// verilir. Değişken derleme anında gömülür (VITE_ öneki olmayanı Vite yaymaz).
//
// ?? DEĞİL: .env dosyasında "VITE_API_BASE_URL=" satırı değişkeni tanımsız
// değil BOŞ STRING yapar; ?? yalnız null/undefined yakaladığı için adres boşa
// düşer ve tüm istekler yanlış yola gider. Sondaki "/" da temizleniyor, yoksa
// "https://api.x/" + "/courses" çift eğik çizgi üretir.
import { readLang } from "../i18n/lang";
import { tr } from "../i18n/tr";
import { en } from "../i18n/en";

// K-79: bu modül bir React bileşeni DEĞİL, hook kullanamaz. Sözlüğü
// localStorage'daki dilden doğrudan seçer — provider ile aynı kaynağı
// okuduğu için ikisi ayrışmaz.
const dict = () => (readLang() === "en" ? en : tr);

const RAW_BASE = import.meta.env.VITE_API_BASE_URL?.trim();
const BASE_URL = RAW_BASE ? RAW_BASE.replace(/\/+$/, "") : "/api";
const TOKEN_KEY = "access_token";

// K-79: sunucu metinlerinin dili (hata mesajları, çakışma cümleleri, export
// başlıkları) bu başlıkla belirlenir. Tek yerde kuruluyor ki `request()` ve
// `download()` birbirinden ayrışmasın — export'un dili sessizce Türkçe kalırdı.
// localStorage'dan HER İSTEKTE okunuyor (modül yüklenirken bir kez değil):
// kullanıcı dili değiştirdiği anda sonraki istek yeni dili taşısın.
function langHeaders(): Record<string, string> {
  return { "Accept-Language": readLang() };
}

// --- Token saklama ---
// localStorage kararı SADECE bu üç fonksiyonda yaşıyor; sessionStorage'a
// geçmek istersek yalnız buradaki kelime değişir.

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// --- Hata modeli ---

export class ApiError extends Error {
  readonly status: number;
  /** Ham cevap gövdesi. Kontrat §7: submit 409'u detail'in YANINDA
   *  conflicts listesi de taşır — mesajı gösterip gövdeyi atamayız. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// FastAPI'nin iki hata şekli var: kontratın vaat ettiği {"detail": "mesaj"}
// ve Pydantic doğrulamasının ürettiği 422 {"detail": [{loc, msg, ...}]}.
// İkisini de tek okunur mesaja indirger.
function normalizeDetail(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: unknown[]; msg?: unknown }) => {
        const field = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1]) : "";
        const msg = String(item.msg ?? dict().common.invalidValue);
        return field ? `${field}: ${msg}` : msg;
      })
      .join(" · ");
  }

  return null;
}

// --- Çekirdek istek fonksiyonu ---

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = langHeaders();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // fetch YALNIZ ağ hatasında fırlatmaz: isteğin kendisi geçersizse de
    // fırlatır (bozuk başlık değeri, geçersiz URL...). İkisini mesaj metninden
    // ayırmak tarayıcıya bağlı ve kırılgan. O yüzden ayırmıyoruz ama asıl
    // hatayı da YUTMUYORUZ: kullanıcıya dostça mesaj, geliştiriciye konsolda
    // gerçek sebep. Yutulan hata = saatlerce yanlış yerde arama.
    console.error(`[api] ${method} ${path} gönderilemedi:`, cause);
    throw new ApiError(0, dict().common.serverUnreachable);
  }

  // Veri ucundan gelen HER 401 = oturum yok/geçersiz → düşür ve login'e dön.
  // Token'ın elimizde OLUP olmadığına bakmıyoruz: süresi dolan token bir önceki
  // istekte temizlenmiş olabilir, ya da paralel isteklerden biri token'sız
  // çıkmış olabilir; ikisi de "Not authenticated" (401) döner ve kullanıcı
  // ekranda hata görüp asılı KALMAMALI — dışarı atılmalı.
  // İSTİSNA: /auth/* uçları (login, şifre sıfırlama, davet) kendi 401'lerini
  // formda gösterir; onları login'e yönlendirmek sonsuz döngü olurdu.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    clearToken();
    if (window.location.pathname !== "/login") window.location.assign("/login");
    throw new ApiError(401, dict().common.sessionExpired);
  }

  if (response.status === 204) return undefined as T; // DELETE cevabı: gövdesiz

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      normalizeDetail(data) ?? dict().common.unknownError(response.status),
      data
    );
  }

  return data as T;
}

// --- Dosya indirme (blob) ---
// request() gövdeyi JSON okur; export uçları dosya döndürdüğü için ayrı bir
// yol gerekir. Auth başlığı + 401 oturum düşmesi burada da aynı kodlanır.
// Dosya adı sunucunun Content-Disposition başlığından alınır (tek kaynak).
async function download(path: string): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = langHeaders();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { headers });
  } catch (cause) {
    console.error(`[api] indirme gönderilemedi ${path}:`, cause);
    throw new ApiError(0, dict().common.serverUnreachable);
  }

  if (response.status === 401 && !path.startsWith("/auth/")) {
    clearToken();
    if (window.location.pathname !== "/login") window.location.assign("/login");
    throw new ApiError(401, dict().common.sessionExpired);
  }

  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      normalizeDetail(data) ?? dict().common.unknownError(response.status),
      data
    );
  }

  const blob = await response.blob();
  const disp = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disp);
  const filename = match ? match[1] : "indirilen-dosya";

  // Blob'u geçici bir <a download> ile tarayıcıya indirtir, sonra temizler.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),
  download: (path: string) => download(path),
};