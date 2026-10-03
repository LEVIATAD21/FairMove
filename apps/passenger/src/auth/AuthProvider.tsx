import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, onSessionLost } from "../services/api";
import { clearSession, getSessionUser, loadSession, type SessionUser } from "../services/session";

export type AuthStatus = "restoring" | "authed" | "guest";

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string
  ) => Promise<{ verificationRequired: boolean; verificationCode?: string }>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendVerification: (email: string) => Promise<{ verificationCode?: string }>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  status: "restoring",
  user: null,
  login: async () => undefined,
  register: async () => ({ verificationRequired: false }),
  verifyEmail: async () => undefined,
  resendVerification: async () => ({}),
  logout: async () => undefined,
});

/**
 * Estado de autenticação real do passageiro:
 * 1. boot → restaura tokens do SecureStore e valida no backend (/users/me,
 *    com refresh automático se o access expirou);
 * 2. login/registro reais via POST /api/v1/auth/*;
 * 3. sessão perdida (refresh revogado/logout em outro device) → guest.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadSession();
      const restored = getSessionUser();
      if (!restored) {
        if (!cancelled) setStatus("guest");
        return;
      }
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setUser(me.user);
        setStatus("authed");
      } catch {
        await clearSession();
        if (!cancelled) {
          setUser(null);
          setStatus("guest");
        }
      }
    })();

    const unsubscribe = onSessionLost(() => {
      if (!cancelled) {
        setUser(null);
        setStatus("guest");
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const logged = await api.login(email, password);
    setUser(logged);
    setStatus("authed");
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const created = await api.register(name, email, password);
    if (created.verificationRequired) {
      return {
        verificationRequired: true as const,
        verificationCode: created.verificationCode,
      };
    }
    setUser(created.user);
    setStatus("authed");
    return { verificationRequired: false as const };
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const verified = await api.verifyEmail(email, code);
    setUser(verified);
    setStatus("authed");
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    return api.resendVerification(email);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("guest");
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, verifyEmail, resendVerification, logout }),
    [status, user, login, register, verifyEmail, resendVerification, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
