import * as SecureStore from "expo-secure-store";

/**
 * Sessão real do motorista: access/refresh tokens e dados do usuário
 * persistidos no Keychain/Keystore via expo-secure-store. Mantém também
 * uma cópia em memória para o cliente de API síncrono (sem I/O por request).
 */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

const KEY_ACCESS = "fairmove.accessToken";
const KEY_REFRESH = "fairmove.refreshToken";
const KEY_USER = "fairmove.user";

let memory: { tokens: SessionTokens | null; user: SessionUser | null } = {
  tokens: null,
  user: null,
};

function canUseSecureStore(): boolean {
  return typeof SecureStore.getItemAsync === "function";
}

/** Restaura a sessão do armazenamento seguro (chamado no boot do app). */
export async function loadSession(): Promise<void> {
  if (!canUseSecureStore()) return;
  try {
    const [accessToken, refreshToken, userJson] = await Promise.all([
      SecureStore.getItemAsync(KEY_ACCESS),
      SecureStore.getItemAsync(KEY_REFRESH),
      SecureStore.getItemAsync(KEY_USER),
    ]);
    if (accessToken && refreshToken) {
      memory.tokens = { accessToken, refreshToken };
      memory.user = userJson ? (JSON.parse(userJson) as SessionUser) : null;
    }
  } catch {
    // Armazenamento indisponível/corrompido: sessão nova (guest).
    memory = { tokens: null, user: null };
  }
}

export async function saveSession(tokens: SessionTokens, user: SessionUser): Promise<void> {
  memory = { tokens, user };
  if (!canUseSecureStore()) return;
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS, tokens.accessToken),
    SecureStore.setItemAsync(KEY_REFRESH, tokens.refreshToken),
    SecureStore.setItemAsync(KEY_USER, JSON.stringify(user)),
  ]);
}

/** Atualiza só o access token (após refresh, mantém refresh/user). */
export async function saveAccessToken(accessToken: string): Promise<void> {
  if (memory.tokens) memory.tokens = { ...memory.tokens, accessToken };
  if (!canUseSecureStore()) return;
  await SecureStore.setItemAsync(KEY_ACCESS, accessToken);
}

export async function clearSession(): Promise<void> {
  memory = { tokens: null, user: null };
  if (!canUseSecureStore()) return;
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_ACCESS),
    SecureStore.deleteItemAsync(KEY_REFRESH),
    SecureStore.deleteItemAsync(KEY_USER),
  ]);
}

export function getSessionTokens(): SessionTokens | null {
  return memory.tokens;
}

export function getSessionUser(): SessionUser | null {
  return memory.user;
}

export function setSessionUser(user: SessionUser): void {
  memory.user = user;
  if (canUseSecureStore()) {
    // Fire-and-forget: a UI já reflete o estado em memória.
    void SecureStore.setItemAsync(KEY_USER, JSON.stringify(user));
  }
}
