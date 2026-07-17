// Uygulamanın TEK fetch noktası. Kontratın genel kuralları (Bearer başlığı,
// {detail} hata formatı, 401 oturum düşmesi) burada bir kez kodlanır;
// ekranlar api.get/post/patch/delete dışında hiçbir şey bilmez.

const BASE_URL = "/api"; // vite.config.ts proxy'si /api -> localhost:8000
const TOKEN_KEY = "access_token";

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
        const msg = String(item.msg ?? "Geçersiz değer");
        return field ? `${field}: ${msg}` : msg;
      })
      .join(" · ");
  }

  return null;
}

// --- Çekirdek istek fonksiyonu ---

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
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
    throw new ApiError(0, "Sunucuya ulaşılamıyor — backend çalışıyor mu?");
  }

  // 401 + elimizde token VARDI = token reddedildi (60 dk doldu ya da geçersiz).
  // Oturumu düşür, login'e dön. DİKKAT: token YOKKEN gelen 401 buraya girmez —
  // o, login denemesinin kendisinin hatasıdır ve formda gösterilmelidir.
  if (response.status === 401 && token) {
    clearToken();
    window.location.assign("/login");
    throw new ApiError(401, "Oturum süresi doldu");
  }

  if (response.status === 204) return undefined as T; // DELETE cevabı: gövdesiz

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      normalizeDetail(data) ?? `Beklenmeyen hata (HTTP ${response.status})`,
      data
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};