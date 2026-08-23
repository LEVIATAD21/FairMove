"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const jsonwebtoken_1 = require("jsonwebtoken");
const uuid_1 = require("uuid");
const router = (0, express_1.Router)();
// Register
router.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email and password are required" });
        }
        const existingUser = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email));
        if (existingUser.length > 0) {
            return res.status(409).json({ error: "Email already registered" });
        }
        const passwordHash = await hashPassword(password);
        const newUser = await db_1.db.insert(schema_1.users).values({
            id: crypto.randomUUID(),
            name,
            email,
            passwordHash,
            role: "passenger",
        }).returning({ id: schema_1.users.id, name: schema_1.users.name, email: schema_1.users.email, role: schema_1.users.role });
        // Create default onboarding completion entries
        await db_1.db.insert(onboardingCompletion).values({
            userId: newUser[0].id,
            step: "basic_info",
            completed: true,
        });
        // Create session
        const token = (0, jsonwebtoken_1.sign)({ userId: newUser[0].id, role: newUser[0].role }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || "1d",
        });
        const sessionId = (0, uuid_1.v4)();
        await db_1.db.insert(schema_1.sessions).values({
            id: sessionId,
            userId: newUser[0].id,
            token,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        return res.status(201).json({
            user: newUser[0],
            token,
        });
    }
    catch (error) {
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
        const user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email));
        if (user.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const isValidPassword = await comparePassword(password, user[0].passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const token = (0, jsonwebtoken_1.sign)({ userId: user[0].id, role: user[0].role }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || "1d",
        });
        const sessionId = (0, uuid_1.v4)();
        await db_1.db.insert(schema_1.sessions).values({
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
    }
    catch (error) {
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
        const decoded = (0, jsonwebtoken_1.verify)(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const session = await db_1.db.select().from(schema_1.sessions).where((0, drizzle_orm_1.eq)(schema_1.sessions.token, refreshToken));
        if (session.length === 0) {
            return res.status(401).json({ error: "Invalid refresh token" });
        }
        const newToken = (0, jsonwebtoken_1.sign)({ userId: session[0].userId, role: session[0].role }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || "1d",
        });
        await db_1.db.update(schema_1.sessions).set({
            token: newToken,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }).where((0, drizzle_orm_1.eq)(schema_1.sessions.id, session[0].id));
        return res.json({ token: newToken });
    }
    catch (error) {
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
        const decoded = (0, jsonwebtoken_1.verify)(token, process.env.JWT_SECRET);
        const user = await db_1.db.select({ id: schema_1.users.id, name: schema_1.users.name, email: schema_1.users.email, role: schema_1.users.role }).from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, decoded.userId));
        if (user.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        return res.json({ user: user[0] });
    }
    catch (error) {
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
        const user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.email, email));
        if (user.length === 0) {
            // Don't reveal if user exists
            return res.json({ message: "If an account with this email exists, a password reset link has been sent." });
        }
        // Create verification token for password reset
        const resetToken = (0, uuid_1.v4)();
        await db_1.db.insert(schema_1.verificationTokens).values({
            id: (0, uuid_1.v4)(),
            userId: user[0].id,
            token: resetToken,
            expiresAt: new Date(Date.now() + 3600000), // 1 hour
        });
        // In a real app, send email here
        // For MVP, we'll just return the token info
        return res.json({ message: "Password reset token generated", resetToken });
    }
    catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.authRouter = router;
//# sourceMappingURL=routes.js.map