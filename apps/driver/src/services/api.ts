import {
  clearSession,
  getSessionTokens,
  getSessionUser,
  saveAccessToken,
  saveSession,
  setSessionUser,
  type SessionUser,
} from "./session";

/**
 * RealApiClient do motorista — 100% HTTP real contra o backend FairMove.
 *
 * - Base: EXPO_PUBLIC_API_URL (LAN/ngrok/emulador) com fallback localhost.
 * - Bearer token em toda rota autenticada.
 * - Refresh automático single-flight em 401 (uma tentativa de retry).
 * - Sessão perdida dispara listeners (AuthProvider manda pro login).
 * Sem mocks: dado inexistente chega vazio do servidor — a UI mostra "sem dados".
 */

const DEFAULT_BASE_URL = "http://localhost:3000/api/v1";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || DEFAULT_BASE_URL
).replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

type SessionLostListener = () => void;
const sessionLostListeners = new Set<SessionLostListener>();

export function onSessionLost(listener: SessionLostListener): () => void {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

function emitSessionLost(): void {
  sessionLostListeners.forEach((listener) => listener());
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  retrying = false
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (auth) {
    const tokens = getSessionTokens();
    if (!tokens) {
      emitSessionLost();
      throw new ApiError(401, { error: "no_session" }, "Sem sessão ativa");
    }
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (response.ok) return payload as T;

  // 401 com token: tenta refresh UMA vez e refaz a chamada original.
  if (response.status === 401 && auth && !retrying && !path.startsWith("/auth/")) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(path, options, true);
    }
    emitSessionLost();
    throw new ApiError(401, payload, "Sessão expirada");
  }

  throw new ApiError(response.status, payload);
}

let refreshInFlight: Promise<string | null> | null = null;

/** Refresh single-flight: várias telas 401 ao mesmo tempo = um único POST /auth/refresh. */
function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const tokens = getSessionTokens();
  if (!tokens?.refreshToken) return null;
  try {
    const result = await request<{ token: string; refreshToken: string }>(
      "/auth/refresh",
      { method: "POST", body: { refreshToken: tokens.refreshToken }, auth: false },
      true
    );
    await saveAccessToken(result.token);
    // Rotação: o servidor também emite novo refresh — persiste o par novo.
    const user = getSessionUser();
    if (user) {
      await saveSession({ accessToken: result.token, refreshToken: result.refreshToken }, user);
    }
    return result.token;
  } catch {
    // Refresh inválido/revogado: derruba a sessão de verdade.
    await clearSession();
    emitSessionLost();
    return null;
  }
}

export type LoginResponse = {
  user: SessionUser;
  token: string;
  refreshToken: string;
};

export type DriverMeResponse = {
  user: SessionUser;
  profile: Record<string, unknown> | null;
  driver: Record<string, unknown> | null;
};

export type WalletBalance = {
  availableBalance: number;
  pendingBalance: number;
  reserveBalance: number;
  currency: string;
};

export type LedgerTransaction = {
  id: string;
  transactionType: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  created_at: string;
};

export type RideHistoryItem = {
  id: string;
  status: string;
  driverCredit: number;
  finalPassengerPrice: number;
  createdAt: string;
  completedAt: string | null;
  pickupLocationLat: string | null;
  pickupLocationLng: string | null;
  dropoffLocationLat: string | null;
  dropoffLocationLng: string | null;
};

export type SubscriptionResponse =
  | { hasSubscription: false; status: string }
  | {
      hasSubscription: true;
      subscription: {
        status: string;
        startedAt: string;
        subscriptionStartedAt: string | null;
        currentBillingCycle: number;
        optedOutOfReserve: boolean;
        cancelAt: boolean;
        currentPeriodEnd: string | null;
      };
    };

export const api = {
  async login(email: string, password: string): Promise<SessionUser> {
    const data = await request<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await saveSession(
      { accessToken: data.token, refreshToken: data.refreshToken },
      data.user
    );
    return data.user;
  },

  async register(name: string, email: string, password: string): Promise<SessionUser> {
    const data = await request<LoginResponse>("/auth/register", {
      method: "POST",
      body: { name, email, password },
      auth: false,
    });
    await saveSession(
      { accessToken: data.token, refreshToken: data.refreshToken },
      data.user
    );
    return data.user;
  },

  async logout(): Promise<void> {
    try {
      await request<void>("/auth/logout", { method: "POST" });
    } finally {
      await clearSession();
    }
  },

  getMe(): Promise<DriverMeResponse> {
    return request<DriverMeResponse>("/drivers/me");
  },

  getBalance(): Promise<WalletBalance> {
    return request<WalletBalance>("/wallets/me/balance");
  },

  async getTransactions(): Promise<LedgerTransaction[]> {
    const user = getSessionUser();
    if (!user) return [];
    const data = await request<{ transactions: LedgerTransaction[] }>(
      `/wallets/${user.id}/transactions`
    );
    return data.transactions;
  },

  async getRides(): Promise<RideHistoryItem[]> {
    const data = await request<{ rides: RideHistoryItem[] }>("/rides/history/me");
    return data.rides;
  },

  async getSubscription(): Promise<SubscriptionResponse> {
    const user = getSessionUser();
    if (!user) return { hasSubscription: false, status: "none" };
    return request<SubscriptionResponse>(`/subscriptions/${user.id}`);
  },

  optOutReserve(): Promise<{ optedOutOfReserve: boolean }> {
    const user = getSessionUser();
    if (!user) return Promise.reject(new ApiError(401, { error: "no_session" }));
    return request<{ optedOutOfReserve: boolean }>(
      `/subscriptions/${user.id}/opt-out`,
      { method: "POST" }
    );
  },
};
