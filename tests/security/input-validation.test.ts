/**
 * Validação de entrada e mapeamento de erros HTTP (regressão dos PoCs):
 * - payload JSON >10kb → 413 (antes: 500 "Unhandled error: request entity too large");
 * - JSON malformado → 400;
 * - charset não suportado → 415;
 * - erro inesperado → 500 com corpo genérico (sem vazar stack);
 * - SQLi em login/corrida → 400/401/404, nunca 500 nem bypass;
 * - register com role=admin → role passenger no banco;
 * - prototype pollution via register → Object.prototype intacto.
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, users, sessions, rides, onboardingCompletion } from "../../packages/shared-db/src/index";
import { authRouter } from "../../packages/auth/src/routes";
import { rideRouter } from "../../packages/rides/src/routes";
import { errorHandler } from "../../backend/src/error-handler";

describe("security: error handler (express.json limit 10kb)", () => {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.post("/api/echo", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/boom", () => {
    throw new Error("internal detail with stack trace");
  });
  app.use(errorHandler);

  it("JSON acima do limite → 413 (antes 500)", async () => {
    const res = await request(app)
      .post("/api/echo")
      .send({ name: "x".repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Payload too large");
  });

  it("JSON malformado → 400", async () => {
    const res = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json")
      .send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Malformed JSON body");
  });

  it("charset não suportado → erro de cliente (400/415), nunca 500", async () => {
    const res = await request(app)
      .post("/api/echo")
      .set("Content-Type", "application/json; charset=utf-16")
      .send("{}");
    expect([400, 415]).toContain(res.status);
    expect(res.body.error).toBeTruthy();
  });

  it("erro inesperado → 500 genérico sem vazar stack", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app).get("/api/boom");
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(JSON.stringify(res.body)).not.toContain("stack");
    expect(JSON.stringify(res.body)).not.toContain("internal detail");
  });
});

describeIfDb("security: input validation (rotas reais)", () => {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/auth", authRouter);
  app.use("/api/rides", rideRouter);
  app.use(errorHandler);

  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const rideRows = await db
        .select({ id: rides.id })
        .from(rides)
        .where(inArray(rides.passengerId, createdUserIds));
      if (rideRows.length > 0) {
        await db.delete(rides).where(inArray(rides.id, rideRows.map((r) => r.id)));
      }
      await db.delete(sessions).where(inArray(sessions.userId, createdUserIds));
      await db
        .delete(onboardingCompletion)
        .where(inArray(onboardingCompletion.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
  });

  it("SQLi no password de login → 401, sem bypass", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "victim@sec.it", password: "' OR '1'='1" });
    expect([400, 401]).toContain(res.status);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });

  it("SQLi no email de login → 400 (Zod), nunca 500", async () => {
    const payloads = [
      "admin' OR '1'='1",
      "a@b.c'; DROP TABLE users;--",
      '" OR ""="',
    ];
    for (const email of payloads) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "x" });
      expect([400, 401]).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
    // tabela users intacta
    const rows = await db.select({ id: users.id }).from(users).limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("SQLi/GUID inválido no path de corrida → 400/404, nunca 500", async () => {
    const payloads = [
      "1'%20OR%20'1'='1",
      "..%2F..%2Fetc%2Fpasswd",
      "1;DROP TABLE rides;--",
    ];
    for (const id of payloads) {
      const res = await request(app).get(`/api/rides/${id}`);
      expect([400, 401, 404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
  });

  it("register com role=admin → role passenger no banco", async () => {
    const email = `escalate-${randomUUID()}@sec.it`;
    const res = await request(app).post("/api/auth/register").send({
      name: "Privilege Escalation",
      email,
      password: "Str0ng!Pass",
      role: "admin",
    });
    expect([201, 400]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body.user.role).toBe("passenger");
      const rows = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.email, email));
      expect(rows[0].role).toBe("passenger");
      createdUserIds.push(res.body.user.id);
    }
  });

  it("prototype pollution via register não polui Object.prototype", async () => {
    const email = `proto-${randomUUID()}@sec.it`;
    await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send(
        `{"name":"Proto","email":"${email}","password":"Str0ng!Pass","role":"admin","__proto__":{"isAdmin":true},"constructor":{"prototype":{"pwned":true}}}`
      );
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).pwned).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});
