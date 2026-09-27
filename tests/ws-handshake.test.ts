/**
 * Handshake do WebSocket /ws:
 * - o token NUNCA vai na query string (vazaria em logs de proxy/CDN);
 * - o token vai como Sec-WebSocket-Protocol e o servidor valida;
 * - sessão revogada (linha removida de `sessions`) não abre novo socket.
 *
 * Requer DATABASE_URL (validação de sessão consulta o banco).
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { createHash, randomUUID } from "crypto";
import { WebSocket } from "ws";
import { sign } from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, users, sessions } from "../packages/shared-db/src/index";
import { getJwtSecret } from "../packages/auth/src/middleware";
import { attachRealtimeServer, type RealtimeServer } from "../packages/realtime/src/ws/server";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface WsActor {
  id: string;
  sessionId: string;
  token: string;
}

async function makeWsActor(): Promise<WsActor> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    name: "Ws Sec",
    email: `ws-${id}@sec.it`,
    passwordHash: "x",
    role: "passenger",
  });
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: id,
    role: "passenger",
    token: sha256(`placeholder-${sessionId}`),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const token = sign({ userId: id, role: "passenger", sessionId }, getJwtSecret(), {
    expiresIn: "15m",
    algorithm: "HS256",
  });
  return { id, sessionId, token };
}

type ConnectResult =
  | { ok: true; hello: Record<string, unknown> }
  | { ok: false; reason: string };

function connect(url: string, protocols?: string[]): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ ok: false, reason: "timeout" });
    }, 3_000);

    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      ws.terminate();
      resolve({ ok: false, reason: `http_${res.statusCode}` });
    });

    ws.on("message", (raw) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "hello") {
          ws.close();
          resolve({ ok: true, hello: msg as Record<string, unknown> });
          return;
        }
      } catch {
        // mensagem não-JSON
      }
      ws.close();
      resolve({ ok: false, reason: "unexpected_message" });
    });

    ws.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "connection_error" });
    });

    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `closed_${code}` });
    });
  });
}

describeIfDb("security: WS handshake", () => {
  let server: Server;
  let realtime: RealtimeServer;
  let baseUrl: string;
  const createdUserIds: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    server = createServer();
    realtime = attachRealtimeServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdSessionIds.length > 0) {
      await db.delete(sessions).where(eq(sessions.id, createdSessionIds[0]));
    }
    if (createdUserIds.length > 0) {
      await db.delete(sessions).where(eq(sessions.userId, createdUserIds[0]));
      await db.delete(users).where(eq(users.id, createdUserIds[0]));
    }
  });

  it("conecta com o token no subprotocolo fairmove.auth", async () => {
    const actor = await makeWsActor();
    createdUserIds.push(actor.id);
    createdSessionIds.push(actor.sessionId);

    const result = await connect(baseUrl, ["fairmove.auth", actor.token]);
    expect(result.ok).toBe(true);
  });

  it("query string ?token= é REJEITada (não vaza em logs)", async () => {
    const actor = await makeWsActor();
    createdUserIds.push(actor.id);
    createdSessionIds.push(actor.sessionId);

    const result = await connect(`${baseUrl}?token=${encodeURIComponent(actor.token)}`);
    expect(result.ok).toBe(false);
  });

  it("sessão revogada (linha removida) não abre novo socket", async () => {
    const actor = await makeWsActor();
    createdUserIds.push(actor.id);

    // Revoga a sessão como faria o logout / troca de senha.
    await db.delete(sessions).where(eq(sessions.id, actor.sessionId));

    const result = await connect(baseUrl, ["fairmove.auth", actor.token]);
    expect(result.ok).toBe(false);
  });

  it("sem subprotocolo nenhum → recusado", async () => {
    const actor = await makeWsActor();
    createdUserIds.push(actor.id);
    createdSessionIds.push(actor.sessionId);

    const result = await connect(baseUrl);
    expect(result.ok).toBe(false);
  });
});
