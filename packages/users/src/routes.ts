import { Router, type Request, type Response } from "express";
import { db, users, profiles, drivers, vehicles, driverDocuments, type Transaction } from "@fairmove/shared-db";
import { eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireRole } from "../../auth/src/middleware";
import {
  validateBody,
  ProfileUpdateSchema,
  DriverSchema,
  SubmitDriverDocumentsSchema,
  ApplicationActionSchema,
} from "@fairmove/validation";

const router = Router();

// Get current user profile
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, req.user!.id));

    if (user.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const profile = await db.select().from(profiles).where(eq(profiles.userId, req.user!.id));
    const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));

    res.json({
      user: user[0],
      profile: profile[0] || null,
      driver: driver[0] || null,
    });
  } catch (error) {
    console.error("Get user profile error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update profile (apenas campos próprios, validados)
router.put("/profile", requireAuth, validateBody(ProfileUpdateSchema), async (req: Request, res: Response) => {
  try {
    const { phone, documentNumber, documentType, documentUrl } = req.body as {
      phone?: string;
      documentNumber?: string;
      documentType?: string;
      documentUrl?: string;
    };

    const existing = await db.select().from(profiles).where(eq(profiles.userId, req.user!.id));

    if (existing.length > 0) {
      await db
        .update(profiles)
        .set({
          phone,
          documentNumber,
          documentType,
          documentUrl,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, req.user!.id));
    } else {
      await db.insert(profiles).values({
        userId: req.user!.id,
        phone,
        documentNumber,
        documentType,
        documentUrl,
      });
    }

    const user = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, req.user!.id));

    res.json({ user: user[0] });
  } catch (error) {
    console.error("Update profile error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Driver onboarding: nasce PENDING — não opera até aprovação manual (CORREÇÃO 1/3).
// BUG corrigido aqui: vehicles era inserido ANTES de drivers (FK vehicles.driver_id
// → drivers.id imediata) → 500 em todo o onboard. Ordem correta: drivers → vehicles.
router.post(
  "/driver/onboard",
  requireAuth,
  validateBody(DriverSchema),
  async (req: Request, res: Response) => {
    try {
      const { plate, brand, model, year, color, vehicleType } = req.body as {
        plate: string;
        brand: string;
        model: string;
        year: number;
        color?: string;
        vehicleType: string;
      };

      const existingDriver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
      if (existingDriver.length > 0) {
        res.status(409).json({ error: "Driver profile already exists" });
        return;
      }

      const existingVehicle = await db.select().from(vehicles).where(eq(vehicles.plate, plate));
      if (existingVehicle.length > 0) {
        res.status(409).json({ error: "Vehicle plate already registered" });
        return;
      }

      const driverId = uuidv4();
      const vehicleId = uuidv4();
      const normalizedType = vehicleType.toLowerCase();

      await db.transaction(async (tx: Transaction) => {
        // 1) driver primeiro (vehicles.driver_id referencia drivers.id)
        await tx.insert(drivers).values({
          id: driverId,
          userId: req.user!.id,
          vehicleId,
          status: "offline",
          available: true,
          earnedToday: 0,
          pendingBalance: 0,
          reserveBalance: 0,
          subscriptionStatus: "free",
          approvalStatus: "pending",
        });

        // 2) veículo depois
        await tx.insert(vehicles).values({
          id: vehicleId,
          driverId,
          brand,
          model,
          year,
          color,
          plate,
          vehicleType: normalizedType,
          status: "available",
        });

        await tx
          .update(users)
          .set({ role: "driver", updatedAt: new Date() })
          .where(eq(users.id, req.user!.id));
      });

      res.status(201).json({
        message: "Driver onboarded, pending approval",
        driverId,
        vehicleId,
        approvalStatus: "pending",
      });
    } catch (error) {
      console.error("Driver onboarding error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Localização/perfil do motorista autenticado
router.get("/driver/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const driver = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
    if (driver.length === 0) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }
    const vehicle = driver[0].vehicleId
      ? await db.select().from(vehicles).where(eq(vehicles.id, driver[0].vehicleId))
      : [];
    res.json({ driver: driver[0], vehicle: vehicle[0] || null });
  } catch (error) {
    console.error("Get driver profile error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Envio dos documentos obrigatórios (CORREÇÃO 2): CNH frente/verso, fotos do
// veículo (frente/trás/lado) e CRLV. Reenvio após REJECTED volta para PENDING.
router.post(
  "/driver/documents",
  requireAuth,
  validateBody(SubmitDriverDocumentsSchema),
  async (req: Request, res: Response) => {
    try {
      const driverRows = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
      if (driverRows.length === 0) {
        res.status(404).json({ error: "Driver profile not found — run /driver/onboard first" });
        return;
      }
      const driver = driverRows[0];
      if (driver.approvalStatus === "suspended") {
        res.status(403).json({ error: "Driver suspended — documents cannot be changed" });
        return;
      }

      const { documents } = req.body as {
        documents: Array<{
          docType: string;
          mimeType: string;
          data: string;
          cnhNumber?: string;
          cnhExpiresOn?: Date;
          renavam?: string;
        }>;
      };

      // Conjunto obrigatório: qualquer incompleto é 422 (não vira "aprovável").
      const required = ["cnh_front", "cnh_back", "vehicle_front", "vehicle_back", "vehicle_side", "crlv"];
      const provided = new Set(documents.map((d) => d.docType));
      const missing = required.filter((t) => !provided.has(t));
      if (missing.length > 0) {
        res.status(422).json({ error: "Missing required documents", missing });
        return;
      }

      await db.transaction(async (tx: Transaction) => {
        // troca completa do conjunto (reenvio = substitui os anteriores)
        await tx.delete(driverDocuments).where(eq(driverDocuments.driverId, driver.id));
        await tx.insert(driverDocuments).values(
          documents.map((d) => ({
            id: uuidv4(),
            driverId: driver.id,
            docType: d.docType,
            mimeType: d.mimeType,
            data: d.data,
            cnhNumber: d.cnhNumber ?? null,
            cnhExpiresOn: d.cnhExpiresOn ?? null,
            renavam: d.renavam ?? null,
            status: "submitted",
          }))
        );

        // Reenvio pós-rejeição reabre a candidatura
        if (driver.approvalStatus === "rejected") {
          await tx
            .update(drivers)
            .set({ approvalStatus: "pending", approvalReason: null, updatedAt: new Date() })
            .where(eq(drivers.id, driver.id));
        }
      });

      res.status(201).json({
        message: "Documents submitted",
        count: documents.length,
        approvalStatus: driver.approvalStatus === "rejected" ? "pending" : driver.approvalStatus,
      });
    } catch (error) {
      console.error("Submit documents error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Documentos enviados pelo motorista autenticado
router.get("/driver/documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const driverRows = await db.select().from(drivers).where(eq(drivers.userId, req.user!.id));
    if (driverRows.length === 0) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }
    const docs = await db
      .select({
        id: driverDocuments.id,
        docType: driverDocuments.docType,
        mimeType: driverDocuments.mimeType,
        data: driverDocuments.data,
        cnhNumber: driverDocuments.cnhNumber,
        cnhExpiresOn: driverDocuments.cnhExpiresOn,
        renavam: driverDocuments.renavam,
        status: driverDocuments.status,
        rejectionReason: driverDocuments.rejectionReason,
        createdAt: driverDocuments.createdAt,
      })
      .from(driverDocuments)
      .where(eq(driverDocuments.driverId, driverRows[0].id));
    res.json({ documents: docs, approvalStatus: driverRows[0].approvalStatus });
  } catch (error) {
    console.error("Get documents error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin: lista candidaturas (aprovacao manual estilo Uber/99)
router.get(
  "/driver/applications",
  requireAuth,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    try {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
      const driverRows = await db.select().from(drivers);
      const userIds = driverRows.map((d) => d.userId);
      const userRows = userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
      const userById = new Map(userRows.map((u) => [u.id, u]));
      const vehicleRows = await db.select().from(vehicles);
      const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]));

      const applications = driverRows
        .map((d) => ({
          driverId: d.id,
          userId: d.userId,
          name: userById.get(d.userId)?.name ?? null,
          email: userById.get(d.userId)?.email ?? null,
          approvalStatus: d.approvalStatus,
          approvalReason: d.approvalReason,
          vehicle: d.vehicleId ? vehicleById.get(d.vehicleId) ?? null : null,
          createdAt: d.createdAt,
        }))
        .filter((a) => (statusFilter ? a.approvalStatus === statusFilter : true));

      res.json({ applications });
    } catch (error) {
      console.error("List applications error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Admin: aprova/rejeita/suspende/restaura candidatura (CORREÇÃO 3)
router.patch(
  "/driver/applications/:driverId",
  requireAuth,
  requireRole("admin"),
  validateBody(ApplicationActionSchema),
  async (req: Request, res: Response) => {
    try {
      const { driverId } = req.params as { driverId: string };
      const { action, reason } = req.body as { action: string; reason?: string };

      const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId));
      if (driverRows.length === 0) {
        res.status(404).json({ error: "Driver not found" });
        return;
      }

      if ((action === "reject" || action === "suspend") && !reason) {
        res.status(422).json({ error: `reason obrigatório para '${action}'` });
        return;
      }

      const transitions: Record<string, string> = {
        approve: "approved",
        reject: "rejected",
        suspend: "suspended",
        reinstate: "approved",
      };
      const nextStatus = transitions[action];

      await db
        .update(drivers)
        .set({
          approvalStatus: nextStatus,
          approvalReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      // Papel permanece "driver"; a OPERAÇÃO é bloqueada por approvalStatus
      // em /matching/driver/status (online) e /rides/:id/accept.
      res.json({ driverId, approvalStatus: nextStatus, action });
    } catch (error) {
      console.error("Application action error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export const usersRouter = router;
