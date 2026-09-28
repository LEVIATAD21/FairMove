import "dotenv/config";
import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "@fairmove/shared-db";
import { authRouter } from "../../packages/auth/src/routes";
import { usersRouter } from "../../packages/users/src/routes";
import { rideRouter } from "../../packages/rides/src/routes";
import { matchingRouter } from "../../packages/matching/src/routes";
import { pricingRouter } from "../../packages/pricing/src/routes";
import { promotionRouter } from "../../packages/promotions/src/routes";
import { paymentRouter } from "../../packages/payments/src/routes";
import { walletRouter } from "../../packages/wallets/src/routes";
import { reserveRouter } from "../../packages/reserves/src/routes";
import { safetyRouter } from "../../packages/safety/src/routes";
import { fraudRouter } from "../../packages/fraud/src/routes";
import { subscriptionRouter } from "../../packages/subscriptions/src/routes";
import { eventsRouter } from "../../packages/events/src/routes";
import { eventScheduler } from "../../packages/events/src/scheduler";
import { attachRealtimeServer } from "../../packages/realtime/src/ws/server";
import { errorHandler } from "./error-handler";
import { eventPublisher } from "../../packages/realtime/src/redis/publisher";
import { findNearbyDrivers } from "../../packages/matching/src/engine/matching-engine";

/** Fail-fast: variáveis obrigatórias precisam existir antes de subir o servidor. */
function assertRequiredEnv(): void {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Política de segredos: mínimo absoluto de 32 chars em qualquer ambiente e
  // 64+ em produção (entropia suficiente p/ HS256). Gere com `openssl rand -base64 48`.
  const isProduction = process.env.NODE_ENV === "production";
  const minSecretLength = isProduction ? 64 : 32;
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < minSecretLength) {
    throw new Error(
      `JWT_SECRET must be at least ${minSecretLength} characters ` +
        `(got ${jwtSecret.length}). Generate one with: openssl rand -base64 48`
    );
  }

  const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
  if (!refreshSecret) {
    console.warn("[config] REFRESH_TOKEN_SECRET ausente — usando JWT_SECRET para refresh tokens.");
  } else {
    if (refreshSecret.length < minSecretLength) {
      throw new Error(
        `REFRESH_TOKEN_SECRET must be at least ${minSecretLength} characters ` +
          `(got ${refreshSecret.length}). Generate one with: openssl rand -base64 48`
      );
    }
    if (refreshSecret === jwtSecret) {
      throw new Error("REFRESH_TOKEN_SECRET must be different from JWT_SECRET.");
    }
  }

  const expires = process.env.JWT_EXPIRES_IN;
  if (expires && /(\d+)\s*d/.test(expires) && isProduction) {
    throw new Error(
      `JWT_EXPIRES_IN=${expires} is too long for production (use 15m, see spec).`
    );
  }
}

assertRequiredEnv();

const app: Express = express();
const port: number = Number(process.env.PORT) || 4000;

// Trust proxy: NUNCA hardcoded. Sem proxy real, `trust proxy` faria o
// express-rate-limit confiar em X-Forwarded-For forjável (burla todo rate
// limit). Só ativa com TRUST_PROXY explícito (ex.: 1 atrás de nginx/LB).
const trustProxyEnv = (process.env.TRUST_PROXY ?? "").trim();
if (trustProxyEnv === "true" || trustProxyEnv === "1") {
  app.set("trust proxy", 1);
} else if (trustProxyEnv && !Number.isNaN(Number(trustProxyEnv))) {
  app.set("trust proxy", Number(trustProxyEnv));
}
app.disable("x-powered-by");

app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(morgan("combined"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." },
});
app.use("/api/", limiter);

// Rate limit agressivo em autenticação (login/reset/refresh são vetores de abuso).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." },
});

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

type DependencyCheck = {
  status: "up" | "down" | "skipped";
  latencyMs?: number;
  error?: string;
};

/** Ping real no Postgres (SELECT 1) com latência medida. */
async function checkDatabase(): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: "up", latencyMs: Date.now() - startedAt };
  } catch (error) {
    // A mensagem do erro NUNCA sai daqui: vaza internals de infra (host, dsn).
    console.error(
      "[health] database check failed:",
      error instanceof Error ? error.message : error
    );
    return { status: "down", latencyMs: Date.now() - startedAt };
  }
}

let readinessRedis: Redis | null = null;

/** PING real no Redis. Sem REDIS_URL, o check é "skipped" (não bloqueia readiness). */
async function checkRedis(): Promise<DependencyCheck> {
  const url = process.env.REDIS_URL;
  if (!url) return { status: "skipped" };
  const startedAt = Date.now();
  try {
    if (!readinessRedis) {
      readinessRedis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        commandTimeout: 2000,
      });
      // Erros de conexão são reportados pelo corpo da resposta, nunca derrubam o processo.
      readinessRedis.on("error", () => undefined);
    }
    if (readinessRedis.status === "wait") {
      await readinessRedis.connect();
    }
    const reply = await readinessRedis.ping();
    if (reply !== "PONG") throw new Error(`unexpected reply: ${String(reply)}`);
    return { status: "up", latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Descarta o cliente com estado quebrado; o próximo probe reconecta do zero.
    readinessRedis?.disconnect();
    readinessRedis = null;
    console.error(
      "[health] redis check failed:",
      error instanceof Error ? error.message : error
    );
    return { status: "down", latencyMs: Date.now() - startedAt };
  }
}

// /health e /ready ficam fora do limiter global (/api/) — limite próprio evita
// flood esgotar o pool do Postgres (cada probe faz SELECT 1 + PING).
const healthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many health checks, please try again later." },
});
app.use(["/health", "/ready"], healthLimiter);

app.get("/health", async (_req: Request, res: Response) => {
  const database = await checkDatabase();
  const ok = database.status === "up";
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "unavailable",
    service: "fairmove-backend",
    checks: { database },
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (_req: Request, res: Response) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ok = database.status === "up" && redis.status !== "down";
  res.status(ok ? 200 : 503).json({
    status: ok ? "ready" : "not_ready",
    service: "fairmove-backend",
    checks: { database, redis },
    timestamp: new Date().toISOString(),
  });
});

// Lockout por CONTA (o limiter de IP não pega brute-force de senha que troca
// de IP a cada request): 5 tentativas de login por e-mail a cada 15 min.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== "POST",
  keyGenerator: (req) =>
    `login:${((req.body as { email?: unknown } | undefined)?.email ?? "unknown")
      .toString()
      .toLowerCase()}`,
  message: { error: "Too many login attempts for this account, please try again later." },
});

app.use(["/api/auth/login", "/api/v1/auth/login"], loginLimiter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/users", usersRouter);
app.use("/api/rides", rideRouter);
app.use("/api/matching", matchingRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/promotions", promotionRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/wallets", walletRouter);
app.use("/api/reserves", reserveRouter);
app.use("/api/safety", safetyRouter);
app.use("/api/fraud", fraudRouter);
app.use("/api/subscriptions", subscriptionRouter);
app.use("/api/events", eventsRouter);

// Aliases v1 (spec da API pública). Mesmos handlers, contrato versionado —
// /api/* continua válido para compatibilidade.
app.use("/api/v1/auth", authLimiter, authRouter);
app.use("/api/v1/users", usersRouter);
// GET /api/v1/drivers/me (spec) → mesmo handler de GET /users/me
app.use("/api/v1/drivers", usersRouter);
app.use("/api/v1/rides", rideRouter);
app.use("/api/v1/matching", matchingRouter);
app.use("/api/v1/pricing", pricingRouter);
app.use("/api/v1/promotions", promotionRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/wallets", walletRouter);
app.use("/api/v1/reserves", reserveRouter);
app.use("/api/v1/safety", safetyRouter);
app.use("/api/v1/fraud", fraudRouter);
app.use("/api/v1/subscriptions", subscriptionRouter);
app.use("/api/v1/events", eventsRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// JSON malformado/limite de payload → 400/413/415 (código testável em
// tests/security/input-validation.test.ts); demais erros → 500 genérico.
app.use(errorHandler);

const server = app.listen(port, () => {
  eventScheduler.start();
  console.log(`FairMove backend running on port ${port}`);
});

// WebSocket /ws (JWT no handshake + Redis Pub/Sub + PostGIS broadcast).
const realtime = attachRealtimeServer(server);
console.log("WebSocket /ws ready");

// Warm-up pós-boot: aquece o pool Postgres (plan da query PostGIS de
// matching) e a conexão Redis do publicador. Sem isso o primeiro
// ride:requested real paga o cold start e estoura o SLA de 1s.
void (async () => {
  try {
    await findNearbyDrivers(-23.5505, -46.6333, undefined, 5);
    await eventPublisher.warmup();
    console.log("Warm-up done (PostGIS plan + Redis publisher)");
  } catch (error) {
    console.warn(
      "Warm-up skipped:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
})();

function shutdown(signal: string): void {
  eventScheduler.stop();
  console.log(`${signal} received, shutting down gracefully...`);
  void realtime.close().catch(() => undefined);
  server.close(() => {
    process.exit(0);
  });
  // Cast defensivo: os globals de tipos do React Native (monorepo) fazem
  // `setTimeout` inferir `number` — em runtime Node o retorno é um Timeout.
  const forceExit = setTimeout(() => process.exit(1), 10_000) as unknown as {
    unref?: () => void;
  };
  forceExit.unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app };
