import type { NextFunction, Request, Response } from "express";
import { verify, JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { db, sessions, users } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";

export interface AuthUser {
  id: string;
  role: string;
  sessionId: string;
}

export interface JwtPayloadShape {
  userId: string;
  role: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Falha rápido e com mensagem clara quando o segredo não está configurado. */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "JWT_SECRET is not configured (or is shorter than 16 chars). Set it in the environment."
    );
  }
  return secret;
}

export function getRefreshTokenSecret(): string {
  const secret = process.env.REFRESH_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "REFRESH_TOKEN_SECRET is not configured (or is shorter than 16 chars). Set it in the environment."
    );
  }
  return secret;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/**
 * Exige um access token JWT válido cuja sessão ainda exista e não tenha
 * expirado (permite revogação via logout).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "Authorization header required" });
      return;
    }

    let payload: JwtPayloadShape;
    try {
      // Algoritmo fixo por policy: nenhum header `alg` escolhido pelo cliente.
      payload = verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as JwtPayloadShape;
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        res.status(401).json({ error: "Token expired" });
        return;
      }
      if (err instanceof JsonWebTokenError) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      throw err;
    }

    if (!payload?.userId || !payload?.sessionId) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }

    const session = await db
      .select({ id: sessions.id, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, payload.sessionId));

    if (session.length === 0) {
      res.status(401).json({ error: "Session revoked" });
      return;
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

    req.user = { id: user[0].id, role: user[0].role, sessionId: payload.sessionId };
    next();
  } catch (error) {
    next(error);
  }
}

/** Autentica e exige um dos papéis informados. */
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requireAuth(req, res, (err?: unknown) => {
        if (err) return next(err);
        if (!req.user || !roles.includes(req.user.role)) {
          res.status(403).json({ error: "Insufficient permissions" });
          return;
        }
        next();
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Garante que o recurso pertence ao usuário autenticado (ou que o usuário
 * possui um dos papéis permitidos).
 */
export function requireSelfOrRole(paramName: string, ...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authorization header required" });
      return;
    }
    const targetId = req.params[paramName];
    if (targetId && targetId === user.id) {
      next();
      return;
    }
    if (roles.includes(user.role)) {
      next();
      return;
    }
    res.status(403).json({ error: "Insufficient permissions" });
  };
}
