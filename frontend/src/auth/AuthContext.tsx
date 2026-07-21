import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken, clearToken } from "../api/client";
import type { LoginResponse, User } from "../api/types";

type AuthState = {
  /** null = girişli değil. loading true iken bu değere GÜVENME. */
  user: User | null;
  /** true = "girişli mi?" sorusunun cevabı henüz bilinmiyor (açılış kontrolü sürüyor). */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Açılış kontrolü: localStorage'da token varsa hâlâ geçerli mi, kimin?
  // Cevabı yalnız backend bilir (60 dk dolmuş olabilir, hesap pasife alınmış olabilir).
  useEffect(() => {
    if (!getToken()) {
      setLoading(false); // token yok — sormaya gerek yok, kesin girişsiz
      return;
    }
    api
      .get<User>("/auth/me")
      .then(setUser)
      .catch(() => {
        // 401 ise client.ts token'ı zaten sildi ve /login'e yönlendirdi.
        // Ağ hatasıysa (backend kapalı) token'a DOKUNMUYORUZ: kullanıcıyı
        // backend'in geçici arızası yüzünden oturumdan atmak yanlış olur.
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    // Hata fırlatırsa (401 = şifre yanlış) bilerek yakalamıyoruz —
    // login formu ApiError'ı yakalayıp mesajı alanın altında gösterecek.
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    setToken(res.access_token);
    setUser(res.user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
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