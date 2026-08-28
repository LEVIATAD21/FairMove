import { Router } from "express";
import { db, users, sessions, verificationTokens, onboardingCompletion } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { sign, verify } from "jsonwebtoken";
import { hash, compare } from "bcrypt";

async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash);
}

const router = Router();

// Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }

    const existingUser = await db.select().from(users).where(eq(users.email, email));

    if (existingUser.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    const newUser = await db.insert(users).values({
      id: uuidv4(),
      name,
      email,
      passwordHash,
      role: "passenger",
    }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });

    // Create default onboarding completion entries
    await db.insert(onboardingCompletion).values({
      userId: newUser[0].id,
      step: "basic_info",
      completed: true,
    });

    // Create session
    const token = sign({ userId: newUser[0].id, role: newUser[0].role }, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    });

    const sessionId = uuidv4();
    await db.insert(sessions).values({
      id: sessionId,
      userId: newUser[0].id,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return res.status(201).json({
      user: newUser[0],
      token,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await db.select().from(users).where(eq(users.email, email));

    if (user.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValidPassword = await comparePassword(password, user[0].passwordHash);

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = sign({ userId: user[0].id, role: user[0].role }, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    });

    const sessionId = uuidv4();
    await db.insert(sessions).values({
      id: sessionId,
      userId: user[0].id,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return res.json({
      user: {
        id: user[0].id,
        name: user[0].name,
        email: user[0].email,
        role: user[0].role,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Refresh token
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    const decoded = verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!) as { userId: string };

    const session = await db.select().from(sessions).where(eq(sessions.token, refreshToken));

    if (session.length === 0) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const newToken = sign({ userId: session[0].userId, role: session[0].role }, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    });

    await db.update(sessions).set({
      token: newToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).where(eq(sessions.id, session[0].id));

    return res.json({ token: newToken });
  } catch (error) {
    console.error("Refresh token error:", error);
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

// Verify token
router.get("/verify", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header required" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = verify(token, process.env.JWT_SECRET!) as { userId: string; role: string };

    const user = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, decoded.userId));

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ user: user[0] });
  } catch (error) {
    console.error("Verify token error:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
});

// Forgot password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await db.select().from(users).where(eq(users.email, email));

    if (user.length === 0) {
      // Don't reveal if user exists
      return res.json({ message: "If an account with this email exists, a password reset link has been sent." });
    }

    // Create verification token for password reset
    const resetToken = uuidv4();
    await db.insert(verificationTokens).values({
      id: uuidv4(),
      userId: user[0].id,
      token: resetToken,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    });

    // In a real app, send email here
    // For MVP, we'll just return the token info
    return res.json({ message: "Password reset token generated", resetToken });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const authRouter = router;
