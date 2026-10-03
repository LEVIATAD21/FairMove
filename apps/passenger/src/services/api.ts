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
 * RealApiClient do passageiro — 100% HTTP real contra o backend FairMove.
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
    const user = getSessionUser();
    if (user) {
      await saveSession({ accessToken: result.token, refreshToken: result.refreshToken }, user);
    }
    return result.token;
  } catch {
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

export type UserMeResponse = {
  user: SessionUser;
  profile: Record<string, unknown> | null;
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
  totalFare: number;
  driverCreditAmount?: number;
  createdAt: string;
  completedAt: string | null;
  pickupLocationLat: string | null;
  pickupLocationLng: string | null;
  dropoffLocationLat: string | null;
  dropoffLocationLng: string | null;
  cancellationReason?: string | null;
};

export type QuoteResponse = {
  quoteId: string;
  originalPrice: number;
  promotionDiscount: number;
  passengerPrice: number;
  driverCredit: number;
  distanceKm: number;
  timeMinutes: number;
  currency: string;
};

export type CreateRideResponse = {
  rideId: string;
  status: string;
  distanceKm: number;
  estimatedTimeSeconds: number;
  originalPrice: number;
  promotionDiscount: number;
  totalFare: number;
  currency: string;
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

  /**
   * Registro. Com REQUIRE_EMAIL_VERIFICATION=true o servidor responde
   * { verificationRequired: true } SEM tokens — a sessão só é salva após
   * verifyEmail().
   */
  async register(
    name: string,
    email: string,
    password: string
  ): Promise<{ user: SessionUser; verificationRequired: boolean; verificationCode?: string }> {
    const data = await request<
      LoginResponse & { verificationRequired?: boolean; verificationCode?: string }
    >("/auth/register", {
      method: "POST",
      body: { name, email, password },
      auth: false,
    });
    if (data.verificationRequired) {
      return {
        user: data.user,
        verificationRequired: true,
        verificationCode: data.verificationCode,
      };
    }
    await saveSession(
      { accessToken: data.token, refreshToken: data.refreshToken },
      data.user
    );
    return { user: data.user, verificationRequired: false };
  },

  /** Confirma o código de 6 dígitos e salva a sessão. */
  async verifyEmail(email: string, code: string): Promise<SessionUser> {
    const data = await request<LoginResponse>("/auth/verify-email", {
      method: "POST",
      body: { email, code },
      auth: false,
    });
    await saveSession(
      { accessToken: data.token, refreshToken: data.refreshToken },
      data.user
    );
    return data.user;
  },

  /** Pede novo código (resposta genérica; código só em dev via EXPOSE_*). */
  resendVerification(email: string): Promise<{ verificationCode?: string }> {
    return request("/auth/resend-verification", {
      method: "POST",
      body: { email },
      auth: false,
    });
  },

  async logout(): Promise<void> {
    try {
      await request<void>("/auth/logout", { method: "POST" });
    } finally {
      await clearSession();
    }
  },

  getMe(): Promise<UserMeResponse> {
    return request<UserMeResponse>("/users/me");
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

  /** Orçamento real do pricing engine (persistido para auditoria). */
  quote(input: {
    pickupLocationLat: number;
    pickupLocationLng: number;
    dropoffLocationLat: number;
    dropoffLocationLng: number;
  }): Promise<QuoteResponse> {
    return request<QuoteResponse>("/pricing/quote", { method: "POST", body: input });
  },

  /** Pedido real de corrida (REQUESTED → busca motorista via Redis/PostGIS). */
  createRide(input: {
    pickupLocationLat: number;
    pickupLocationLng: number;
    dropoffLocationLat: number;
    dropoffLocationLng: number;
  }): Promise<CreateRideResponse> {
    return request<CreateRideResponse>("/rides", { method: "POST", body: input });
  },

  cancelRide(rideId: string, reason: string): Promise<unknown> {
    return request(`/rides/${rideId}/cancel`, {
      method: "POST",
      body: { reason },
    });
  },
};
