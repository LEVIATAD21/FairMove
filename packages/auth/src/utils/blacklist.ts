import Redis from "ioredis";
import { createHash } from "crypto";

/**
 * Blacklist de refresh tokens no Redis.
 *
 * A remoção da linha `sessions` no banco já invalida o refresh (fonte primária).
 * Esta camada extra, exigida pela operação, bloqueia o token mesmo que uma
 * corrida/race recrie a sessão — dupla proteção com degradação graciosa:
 * sem REDIS_URL ou com Redis fora, o check é pulado e a sessão continua
 * sendo a autoridade final.
 */

function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let client: Redis | null = null;
let unavailable = false;

function getClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url || unavailable) return null;
  if (!client) {
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 2000,
    });
    client.on("error", () => {
      unavailable = true;
      client = null;
    });
  }
  return client;
}

function key(sessionId: string): string {
  return `fairmove:auth:blacklist:${sessionId}`;
}

/** Marca a sessão/refresh token como revogado com TTL igual ao do refresh. */
export async function blacklistRefreshSession(
  sessionId: string,
  refreshTtlSeconds: number
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.set(key(sessionId), "1", "EX", Math.max(refreshTtlSeconds, 1));
  } catch {
    // Redis indisponível: a invalidação via banco (sessions.delete) já cobre.
    unavailable = true;
    client = null;
  }
}

/** true se a sessão estiver na blacklist. Ausência de Redis = false (não bloqueia). */
export async function isRefreshSessionBlacklisted(sessionId: string): Promise<boolean> {
  const redis = getClient();
  if (!redis) return false;
  try {
    if (redis.status === "wait") await redis.connect();
    const result = await redis.get(key(sessionId));
    return result !== null;
  } catch {
    return false;
  }
}

/** Hash do token para logs/correlação sem expor o valor cru. */
export function refreshTokenFingerprint(token: string): string {
  return sha256(token).slice(0, 12);
}
