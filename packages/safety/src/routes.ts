import { Router, type Request, type Response } from "express";
import { db, safety_events, trust_contacts, trip_codes, incidents } from "@fairmove/shared-db";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, type AuthUser } from "../../auth/src/middleware";
import {
  validateBody,
  SosSchema,
  TrustContactSchema,
  IncidentSchema,
  TripCodeSchema,
  TripCodeVerifySchema,
} from "@fairmove/validation";
import { loadRideForUser } from "../../rides/src/access";

const router = Router();

/** Responde 404/403 quando o usuário não participa da corrida (ou ela não existe). */
async function denyUnlessParticipant(
  res: Response,
  rideId: string,
  user: AuthUser
): Promise<boolean> {
  const access = await loadRideForUser(rideId, user);
  if (access.ok) return false;

  res.status(access.status).json({ error: access.message });
  return true;
}

// SOS - registra alerta crítico de segurança (sempre no contexto do usuário autenticado)
router.post("/sos", requireAuth, validateBody(SosSchema), async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body as { rideId: string };
    const user = req.user!;

    if (await denyUnlessParticipant(res, rideId, user)) return;

    const eventId = uuidv4();
    await db.insert(safety_events).values({
      id: eventId,
      rideId,
      eventType: "sos",
      title: "SOS triggered",
      severity: "critical",
      status: "open",
      reportedBy: user.id,
    });

    return res.status(201).json({ message: "SOS alert triggered", eventId });
  } catch (error) {
    console.error("SOS error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Eventos de segurança de uma corrida (participantes ou admin)
router.get("/events/:rideId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const user = req.user!;

    if (await denyUnlessParticipant(res, rideId, user)) return;

    const events = await db
      .select()
      .from(safety_events)
      .where(eq(safety_events.rideId, rideId))
      .orderBy(desc(safety_events.createdAt));

    return res.json(events);
  } catch (error) {
    console.error("Get safety events error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Adicionar contato de confiança (sempre para o próprio usuário)
router.post("/trusted-contacts", requireAuth, validateBody(TrustContactSchema), async (req: Request, res: Response) => {
  try {
    const { contactName, contactPhone, contactEmail, isPrimary } = req.body as {
      contactName: string;
      contactPhone: string;
      contactEmail?: string;
      isPrimary?: boolean;
    };
    const user = req.user!;

    const id = uuidv4();

    await db.insert(trust_contacts).values({
      id,
      userId: user.id,
      contactName,
      contactPhone,
      contactEmail: contactEmail ?? null,
      isPrimary: isPrimary ?? false,
    });

    return res.status(201).json({ message: "Trusted contact added", id });
  } catch (error) {
    console.error("Add trusted contact error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Listar contatos de confiança (próprio usuário ou admin)
router.get("/trusted-contacts/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };
    const user = req.user!;

    if (user.role !== "admin" && user.id !== userId) {
      return res.status(403).json({ error: "You do not have access to these contacts" });
    }

    const contacts = await db.select().from(trust_contacts).where(eq(trust_contacts.userId, userId));

    return res.json(contacts);
  } catch (error) {
    console.error("Get trusted contacts error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reportar incidente (reportado pelo usuário autenticado, participante da corrida)
router.post("/incidents", requireAuth, validateBody(IncidentSchema), async (req: Request, res: Response) => {
  try {
    const { rideId, type, severity, description } = req.body as {
      rideId: string;
      type: string;
      severity?: string;
      description?: string;
    };
    const user = req.user!;

    if (await denyUnlessParticipant(res, rideId, user)) return;

    const id = uuidv4();
    const incidentSeverity = severity ?? "medium";

    await db.insert(incidents).values({
      id,
      rideId,
      type,
      severity: incidentSeverity,
      description: description ?? "",
      status: "open",
      reportedBy: user.id,
    });

    await db.insert(safety_events).values({
      id: uuidv4(),
      rideId,
      eventType: "incident_reported",
      title: "Incident reported",
      severity: incidentSeverity,
      status: "open",
      reportedBy: user.id,
    });

    return res.status(201).json({ message: "Incident reported", id });
  } catch (error) {
    console.error("Report incident error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Incidentes de uma corrida (participantes ou admin)
router.get("/incidents/:rideId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const user = req.user!;

    if (await denyUnlessParticipant(res, rideId, user)) return;

    const incidentList = await db
      .select()
      .from(incidents)
      .where(eq(incidents.rideId, rideId))
      .orderBy(desc(incidents.createdAt));

    return res.json(incidentList);
  } catch (error) {
    console.error("Get incidents error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Gerar código de viagem (participante da corrida)
router.post("/trip-codes", requireAuth, validateBody(TripCodeSchema), async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body as { rideId: string };
    const user = req.user!;

    if (await denyUnlessParticipant(res, rideId, user)) return;

    const code = `FC${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    await db.insert(trip_codes).values({
      id: uuidv4(),
      rideId,
      code,
    });

    return res.status(201).json({ code, rideId });
  } catch (error) {
    console.error("Generate trip code error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verificar código de viagem (participante da corrida vinculada ao código)
router.post("/trip-codes/verify", requireAuth, validateBody(TripCodeVerifySchema), async (req: Request, res: Response) => {
  try {
    const { code } = req.body as { code: string };
    const user = req.user!;

    const rows = await db.select().from(trip_codes).where(eq(trip_codes.code, code));

    if (rows.length === 0) {
      return res.status(404).json({ error: "Trip code not found" });
    }

    const tripCode = rows[0];

    if (await denyUnlessParticipant(res, tripCode.rideId, user)) return;

    await db
      .update(trip_codes)
      .set({ isVerified: true })
      .where(eq(trip_codes.id, tripCode.id));

    return res.json({ code, verified: true });
  } catch (error) {
    console.error("Verify trip code error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const safetyRouter = router;
