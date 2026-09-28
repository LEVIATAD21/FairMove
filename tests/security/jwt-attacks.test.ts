/**
 * Ataques contra o JWT (requireAuth real, com sessão no banco):
 * - token "alg: none" (forgery clássico);
 * - assinatura com secret fraco ("secret");
 * - payload adulterado (role/vítima) re-assinado com chave errada;
 * - token expirado;
 * - token válido cuja sessão foi revogada;
 * - token válido + sessão → 200 (sanity).
 * Requer DATABASE_URL.
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import express from "express";
import request from "supertest";
import { createHash, randomUUID } from "crypto";
import { sign } from "jsonwebtoken";
import { inArray } from "drizzle-orm";
import { db, users, sessions } from "../../packages/shared-db/src/index";
import {
  getJwtSecret,
  requireAuth,
} from "../../packages/auth/src/middleware";

const app = express();
app.use(express.json());
app.get("/api/secure/me", requireAuth, (req, res) => {
  res.json({ userId: req.user!.id, role: req.user!.role });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

interface Session {
  userId: string;
  sessionId: string;
  role: string;
}

async function makeSession(role = "passenger"): Promise<Session> {
  const userId = randomUUID();
  const sessionId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: "JWT Attacker",
    email: `jwt-${userId}@sec.it`,
    passwordHash: "x",
    role,
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    role,
    token: sha256(`placeholder-${sessionId}`),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { userId, sessionId, role };
}

function validToken(s: Session): string {
  return sign(
    { userId: s.userId, role: s.role, sessionId: s.sessionId, jti: randomUUID() },
    getJwtSecret(),
    { expiresIn: "15m", algorithm: "HS256" }
  );
}

describeIfDb("security: JWT attacks", () => {
  const createdUserIds: string[] = [];
  const createdSessionIds: string[] = [];

  async function session(role = "passenger"): Promise<Session> {
    const s = await makeSession(role);
    createdUserIds.push(s.userId);
    createdSessionIds.push(s.sessionId);
    return s;
  }

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.id, createdSessionIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it("token válido + sessão ativa → 200 (sanity)", async () => {
    const s = await session();
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${validToken(s)}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(s.userId);
    expect(res.body.role).toBe(s.role);
  });

  it("alg: none (assinatura vazia) → 401", async () => {
    const s = await session();
    const header = b64url({ alg: "none", typ: "JWT" });
    const payload = b64url({
      userId: s.userId,
      role: "admin",
      sessionId: s.sessionId,
      jti: randomUUID(),
    });
    for (const token of [`${header}.${payload}.`, `${header}.${payload}`]) {
      const res = await request(app)
        .get("/api/secure/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it("assinatura com secret fraco 'secret' → 401", async () => {
    const s = await session();
    const forged = sign(
      { userId: s.userId, role: "admin", sessionId: s.sessionId, jti: randomUUID() },
      "secret",
      { expiresIn: "15m", algorithm: "HS256" }
    );
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("payload adulterado (role→admin) re-assinado com chave errada → 401", async () => {
    const s = await session();
    const payload = JSON.parse(
      Buffer.from(validToken(s).split(".")[1], "base64url").toString()
    );
    payload.role = "admin";
    const tampered = sign(payload, "attacker-key", { algorithm: "HS256" });
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it("token válido com payload corrompido (byte alterado) → 401", async () => {
    const s = await session();
    const parts = validToken(s).split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.role = "admin";
    const corrupted = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${corrupted}`);
    expect(res.status).toBe(401);
  });

  it("token expirado → 401", async () => {
    const s = await session();
    const expired = sign(
      { userId: s.userId, role: s.role, sessionId: s.sessionId, jti: randomUUID() },
      getJwtSecret(),
      { expiresIn: "-10s", algorithm: "HS256" }
    );
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("token válido com sessão revogada (linha removida) → 401", async () => {
    const s = await session();
    await db.delete(sessions).where(inArray(sessions.id, [s.sessionId]));
    const res = await request(app)
      .get("/api/secure/me")
      .set("Authorization", `Bearer ${validToken(s)}`);
    expect(res.status).toBe(401);
  });

  it("token de lixo / header ausente → 401", async () => {
    for (const token of ["not-a-jwt", "a.b.c", ""]) {
      const res = await request(app)
        .get("/api/secure/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
    const noAuth = await request(app).get("/api/secure/me");
    expect(noAuth.status).toBe(401);
  });
});
