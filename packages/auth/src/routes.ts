import { Router, type Request, type Response } from "express";
import { db, users, sessions, verificationTokens, onboardingCompletion } from "@fairmove/shared-db";
import { eq, and, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { sign, verify, TokenExpiredError, JsonWebTokenError } from "jsonwebtoken";
import {
  RegisterSchema,
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  VerifyEmailSchema,
  validateBody,
} from "@fairmove/validation";
import { hashPassword, comparePassword } from "./utils/password";
import {
  blacklistRefreshSession,
  isRefreshSessionBlacklisted,
} from "./utils/blacklist";
import {
  requireAuth,
  getJwtSecret,
  getRefreshTokenSecret,
  type JwtPayloadShape,
} from "./middleware";

const router = Router();

/** Todos os verify() pinam o algoritmo: nenhum header `alg` escolhido pelo cliente. */
const JWT_ALGORITHMS = ["HS256"] as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Comparação em tempo constante (hash de ambos os lados ⇒ tamanhos iguais). */
function safeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Spec de produção: access 15min (curto p/ mobile), refresh 7d. */
function accessTokenTtl(): string {
  return process.env.JWT_EXPIRES_IN || "15m";
}

function refreshTokenTtl(): string {
  return process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
}

/** ms de uma duração tipo "15m"/"30d"/"1d" — usada para alinhar a sessão. */
function ttlToMs(ttl: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(ttl.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2] || "s";
  const factor: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * factor[unit];
}

/** Verificação de e-mail exigida apenas com REQUIRE_EMAIL_VERIFICATION=true. */
function emailVerificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

/** Expor o código na resposta só em dev (EXPOSE_VERIFICATION_CODE=true). */
function exposeVerificationCode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.EXPOSE_VERIFICATION_CODE === "true";
}

/**
 * Emite código de 6 dígitos para verificação de e-mail (guarda apenas o hash,
 * 15 min de validade). Sem provedor de e-mail integrado (pendência: SMTP/Mailgun/SES),
 * o código só chega ao cliente via EXPOSE_VERIFICATION_CODE em desenvolvimento.
 */
async function issueVerificationCode(userId: string): Promise<string> {
  await db.delete(verificationTokens).where(eq(verificationTokens.userId, userId));
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(verificationTokens).values({
    id: uuidv4(),
    userId,
    token: hashToken(code),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  return code;
}

async function issueTokens(userId: string, role: string, sessionId?: string) {
  const sid = sessionId || uuidv4();
  const accessToken = sign({ userId, role, sessionId: sid }, getJwtSecret(), {
    expiresIn: accessTokenTtl(),
    algorithm: "HS256",
  });
  const refreshToken = sign(
    { userId, role, sessionId: sid, type: "refresh" },
    getRefreshTokenSecret(),
    { expiresIn: refreshTokenTtl(), algorithm: "HS256" }
  );

  const expiresAt = new Date(Date.now() + Math.max(ttlToMs(refreshTokenTtl()), ttlToMs(accessTokenTtl())));

  // O refresh token NUNCA é gravado em claro: só o SHA-256 (fingerprint).
  // Com isso um dump da tabela `sessions` não entrega tokens utilizáveis.
  if (sessionId) {
    await db
      .update(sessions)
      .set({ token: hashToken(refreshToken), role, expiresAt, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  } else {
    await db
      .insert(sessions)
      .values({ id: sid, userId, role, token: hashToken(refreshToken), expiresAt });
  }

  return { accessToken, refreshToken, sessionId: sid };
}

function publicUser(row: { id: string; name: string; email: string; role: string }) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function isUniqueViolation(error: unknown): boolean {
  const pg = error as { code?: string };
  return pg?.code === "23505";
}

// Register
router.post("/register", validateBody(RegisterSchema), async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existingUser.length > 0) {
      // Mensagem única de falha de registro (não confirma qual campo colidiu —
      // enumeração de e-mails cadastrados mitigada; ver README).
      res.status(409).json({ error: "Registration could not be completed" });
      return;
    }

    const passwordHash = await hashPassword(password);

    let newUser: { id: string; name: string; email: string; role: string };
    try {
      const created = await db
        .insert(users)
        .values({ id: uuidv4(), name, email, passwordHash, role: "passenger" })
        .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      newUser = created[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Registration could not be completed" });
        return;
      }
      throw error;
    }

    await db.insert(onboardingCompletion).values({
      userId: newUser.id,
      step: "basic_info",
      completed: true,
      completedAt: new Date(),
    });

    // REQUIRE_EMAIL_VERIFICATION: conta criada, MAS sem tokens até o código.
    if (emailVerificationRequired()) {
      const verificationCode = await issueVerificationCode(newUser.id);
      res.status(201).json({
        user: publicUser(newUser),
        verificationRequired: true,
        ...(exposeVerificationCode() ? { verificationCode } : {}),
      });
      return;
    }

    const { accessToken, refreshToken } = await issueTokens(newUser.id, newUser.role);

    res.status(201).json({
      user: publicUser(newUser),
      token: accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Register error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
router.post("/login", validateBody(LoginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await db.select().from(users).where(eq(users.email, email));
    if (user.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValidPassword = await comparePassword(password, user[0].passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (emailVerificationRequired() && !user[0].emailVerifiedAt) {
      res.status(403).json({ error: "Email not verified", verificationRequired: true });
      return;
    }

    const { accessToken, refreshToken } = await issueTokens(user[0].id, user[0].role);

    res.json({
      user: publicUser(user[0]),
      token: accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Login error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Refresh token (com rotação: o refresh antigo é invalidado)
async function refreshHandler(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken } = req.body ?? {};

    if (!refreshToken || typeof refreshToken !== "string") {
      res.status(400).json({ error: "Refresh token is required" });
      return;
    }

    let payload: JwtPayloadShape & { type?: string };
    try {
      payload = verify(refreshToken, getRefreshTokenSecret(), {
        algorithms: [...JWT_ALGORITHMS],
      }) as JwtPayloadShape & { type?: string };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        res.status(401).json({ error: "Refresh token expired" });
        return;
      }
      if (error instanceof JsonWebTokenError) {
        res.status(401).json({ error: "Invalid refresh token" });
        return;
      }
      throw error;
    }

    if (payload.type !== "refresh" || !payload.sessionId || !payload.userId) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    // Blacklist Redis (camada extra; a sessão removida do banco já invalida).
    if (await isRefreshSessionBlacklisted(payload.sessionId)) {
      res.status(401).json({ error: "Refresh token revoked" });
      return;
    }

    const session = await db.select().from(sessions).where(eq(sessions.id, payload.sessionId));
    if (session.length === 0) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    // O banco guarda o SHA-256 do refresh (nunca o token em claro). Sessões
    // legadas com token cru são aceitas UMA vez e migradas na hora.
    const presentedHash = hashToken(refreshToken);
    const storedToken = session[0].token;
    const matchesHash = safeEquals(storedToken, presentedHash);
    const matchesLegacy = !matchesHash && safeEquals(storedToken, refreshToken);

    if (!matchesHash && !matchesLegacy) {
      // Reuso detectado: revoga a sessão inteira por segurança.
      await db.delete(sessions).where(eq(sessions.id, session[0].id));
      res.status(401).json({ error: "Refresh token reuse detected, session revoked" });
      return;
    }

    if (matchesLegacy) {
      await db
        .update(sessions)
        .set({ token: presentedHash, updatedAt: new Date() })
        .where(eq(sessions.id, session[0].id));
    }

    if (session[0].expiresAt && session[0].expiresAt.getTime() < Date.now()) {
      res.status(401).json({ error: "Session expired" });
      return;
    }

    const user = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, payload.userId));

    if (user.length === 0) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const tokens = await issueTokens(user[0].id, user[0].role, session[0].id);

    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch (error) {
    console.error("Refresh token error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(401).json({ error: "Invalid refresh token" });
  }
}

// Aliases: nomenclatura da spec (/refresh) e a clássica (/refresh-token)
router.post("/refresh-token", refreshHandler);
router.post("/refresh", refreshHandler);

// Verificação de e-mail: valida código de 6 dígitos e emite tokens
router.post("/verify-email", validateBody(VerifyEmailSchema), async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body as { email: string; code: string };

    const found = await db.select().from(users).where(eq(users.email, email));
    if (found.length === 0 || found[0].emailVerifiedAt) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    const tokenRows = await db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, found[0].id),
          eq(verificationTokens.token, hashToken(code))
        )
      );

    if (tokenRows.length === 0) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }
    if (tokenRows[0].expiresAt && tokenRows[0].expiresAt.getTime() < Date.now()) {
      await db.delete(verificationTokens).where(eq(verificationTokens.id, tokenRows[0].id));
      res.status(400).json({ error: "Verification code expired" });
      return;
    }

    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, found[0].id));
    await db.delete(verificationTokens).where(eq(verificationTokens.userId, found[0].id));

    const { accessToken, refreshToken } = await issueTokens(found[0].id, found[0].role);
    res.json({
      user: publicUser(found[0]),
      token: accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Verify email error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reenviar código de verificação (resposta genérica: não revela se existe conta)
router.post("/resend-verification", validateBody(ForgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    const response = {
      message: "If an account with this email needs verification, a new code has been sent.",
    };

    const found = await db.select().from(users).where(eq(users.email, email));
    if (found.length > 0 && !found[0].emailVerifiedAt) {
      const verificationCode = await issueVerificationCode(found[0].id);
      console.info(`[verify-email] userId=${found[0].id} (code redacted from logs)`);
      res.json(
        exposeVerificationCode() ? { ...response, verificationCode } : response
      );
      return;
    }
    res.json(response);
  } catch (error) {
    console.error("Resend verification error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify token
router.get("/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, req.user!.id));

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user: user[0] });
  } catch (error) {
    console.error("Verify token error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Logout (revoga a sessão no banco + blacklist do refresh token no Redis)
router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    await db.delete(sessions).where(eq(sessions.id, req.user!.sessionId));
    await blacklistRefreshSession(
      req.user!.sessionId,
      Math.floor(ttlToMs(refreshTokenTtl()) / 1000)
    );
    res.status(204).send();
  } catch (error) {
    console.error("Logout error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Forgot password — nunca expõe o token em produção
router.post(
  "/forgot-password",
  validateBody(ForgotPasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      const user = await db.select().from(users).where(eq(users.email, email));

      const response = {
        message: "If an account with this email exists, a password reset link has been sent.",
      };

      if (user.length === 0) {
        res.json(response);
        return;
      }

      // Invalida tokens anteriores não utilizados
      await db.delete(verificationTokens).where(eq(verificationTokens.userId, user[0].id));

      const rawToken = randomBytes(32).toString("hex");
      await db.insert(verificationTokens).values({
        id: uuidv4(),
        userId: user[0].id,
        token: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hora
      });

      // TODO: integrar provedor de e-mail (SMTP/Mailgun/SES).
      // O token de reset é SEGREDO: jamais vai para log (vazaria o vetor de
      // takeover de conta). No dev, o corpo da resposta pode trazê-lo quando
      // EXPOSE_RESET_TOKEN=true (única via permitida).
      console.info(`[password-reset] userId=${user[0].id} (token redacted from logs)`);

      // Em desenvolvimento, permite obter o token para testar o fluxo.
      const exposeToken =
        process.env.NODE_ENV !== "production" && process.env.EXPOSE_RESET_TOKEN === "true";
      res.json(exposeToken ? { ...response, resetToken: rawToken } : response);
    } catch (error) {
      console.error("Forgot password error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Reset password
router.post(
  "/reset-password",
  validateBody(ResetPasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;

      const found = await db
        .select()
        .from(verificationTokens)
        .where(eq(verificationTokens.token, hashToken(token)));

      if (found.length === 0) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      if (found[0].expiresAt && found[0].expiresAt.getTime() < Date.now()) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      const passwordHash = await hashPassword(password);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, found[0].userId));

      // Token de uso único + força reautenticação
      await db.delete(verificationTokens).where(eq(verificationTokens.userId, found[0].userId));
      await db.delete(sessions).where(eq(sessions.userId, found[0].userId));

      res.json({ message: "Password has been reset. Please sign in again." });
    } catch (error) {
      console.error("Reset password error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Change password (usuário autenticado)
router.post(
  "/change-password",
  requireAuth,
  validateBody(ChangePasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };

      const user = await db.select().from(users).where(eq(users.id, req.user!.id));
      if (user.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const valid = await comparePassword(currentPassword, user[0].passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const passwordHash = await hashPassword(newPassword);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, req.user!.id));

      // Revoga as demais sessões, mantendo a atual ativa
      await db
        .delete(sessions)
        .where(
          and(eq(sessions.userId, req.user!.id), ne(sessions.id, req.user!.sessionId))
        );

      res.json({ message: "Password updated" });
    } catch (error) {
      console.error("Change password error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Sessões ativas do usuário
router.get("/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        current: eq(sessions.id, req.user!.sessionId),
      })
      .from(sessions)
      .where(eq(sessions.userId, req.user!.id));

    res.json({ sessions: rows });
  } catch (error) {
    console.error("List sessions error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoga uma sessão específica (apenas a própria)
router.delete("/sessions/:sessionId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as { sessionId: string };
    const deleted = await db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, req.user!.id)))
      .returning({ id: sessions.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error("Delete session error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export const authRouter = router;
