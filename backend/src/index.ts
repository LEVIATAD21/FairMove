import "dotenv/config";
import express, { Express, NextFunction, Request, Response } from "express";
import helmet from "helmet";
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

/** Fail-fast: variáveis obrigatórias precisam existir antes de subir o servidor. */
function assertRequiredEnv(): void {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!process.env.REFRESH_TOKEN_SECRET) {
    console.warn("[config] REFRESH_TOKEN_SECRET ausente — usando JWT_SECRET para refresh tokens.");
  }
  if (process.env.NODE_ENV === "production" && (process.env.JWT_SECRET ?? "").length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production.");
  }
}

assertRequiredEnv();

const app: Express = express();
const port: number = Number(process.env.PORT) || 4000;

// Necessário para express-rate-limit identificar o IP real atrás de proxy reverso.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
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
app.use(express.urlencoded({ extended: false }));

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
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "unknown error",
    };
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
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}

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

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// JSON malformado vira 400 em vez de 500 genérico.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("Unhandled error:", message);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(port, () => {
  eventScheduler.start();
  console.log(`FairMove backend running on port ${port}`);
});

function shutdown(signal: string): void {
  eventScheduler.stop();
  console.log(`${signal} received, shutting down gracefully...`);
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
