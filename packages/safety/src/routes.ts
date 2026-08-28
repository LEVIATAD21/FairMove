import { Router } from "express";
import { db, safety_events, trust_contacts, trip_codes, incidents } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// SOS endpoint - trigger safety alert
router.post("/sos", async (req, res) => {
  try {
    const { rideId, reportedBy } = req.body;

    if (!rideId || !reportedBy) {
      return res.status(400).json({ error: "Ride ID and reported by are required" });
    }

    // Create safety event
    const eventId = uuidv4();
    await db.insert(safety_events).values({
      id: eventId,
      rideId,
      eventType: "sos",
      title: "SOS triggered",
      severity: "critical",
      status: "open",
      reportedBy,
    });

    // In a real implementation, this would trigger SMS, email, and notification to trusted contacts
    // For MVP, just record the event

    return res.json({ message: "SOS alert triggered", eventId });
  } catch (error) {
    console.error("SOS error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get safety events for a ride
router.get("/events/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params as { rideId: string };

    const { desc } = await import("drizzle-orm");
    const events = await db.select().from(safety_events).where(
      eq(safety_events.rideId, rideId)
    ).orderBy(desc(safety_events.createdAt));

    return res.json(events);
  } catch (error) {
    console.error("Get safety events error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Add trusted contact
router.post("/trusted-contacts", async (req, res) => {
  try {
    const { userId, contactName, contactPhone, contactEmail, isPrimary } = req.body;

    if (!userId || !contactName || !contactPhone) {
      return res.status(400).json({ error: "User ID, contact name and phone are required" });
    }

    const id = uuidv4();

    await db.insert(trust_contacts).values({
      id,
      userId,
      contactName,
      contactPhone,
      contactEmail,
      isPrimary: isPrimary || false,
    });

    return res.status(201).json({ message: "Trusted contact added" });
  } catch (error) {
    console.error("Add trusted contact error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get trusted contacts
router.get("/trusted-contacts/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const contacts = await db.select().from(trust_contacts).where(
      eq(trust_contacts.userId, userId)
    );

    return res.json(contacts);
  } catch (error) {
    console.error("Get trusted contacts error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Report incident
router.post("/incidents", async (req, res) => {
  try {
    const { rideId, type, severity, description, reportedBy } = req.body;

    if (!rideId || !type || !reportedBy) {
      return res.status(400).json({ error: "Ride ID, type and reported by are required" });
    }

    const id = uuidv4();

    await db.insert(incidents).values({
      id,
      rideId,
      type,
      severity: severity || "medium",
      description: description || "",
      status: "open",
      reportedBy,
    });

    // Create safety event for the incident
    await db.insert(safety_events).values({
      id: uuidv4(),
      rideId,
      eventType: "incident_reported",
      title: "Incident reported",
      severity,
      status: "open",
      reportedBy,
    });

    return res.status(201).json({ message: "Incident reported" });
  } catch (error) {
    console.error("Report incident error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get incidents for a ride
router.get("/incidents/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params as { rideId: string };

    const { desc } = await import("drizzle-orm");
    const incidentList = await db.select().from(incidents).where(
      eq(incidents.rideId, rideId)
    ).orderBy(desc(incidents.createdAt));

    return res.json(incidentList);
  } catch (error) {
    console.error("Get incidents error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Generate trip code
router.post("/trip-codes", async (req, res) => {
  try {
    const { rideId, createdBy } = req.body;

    if (!rideId || !createdBy) {
      return res.status(400).json({ error: "Ride ID and created by are required" });
    }

    const code = `FC${uuidv4().toString().substring(0, 8).toUpperCase()}`;

    await db.insert(trip_codes).values({
      id: uuidv4(),
      rideId,
      code,
    });

    return res.json({ code });
  } catch (error) {
    console.error("Generate trip code error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify trip code
router.post("/trip-codes/verify", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const tripCode = await db.select().from(trip_codes).where(
      eq(trip_codes.code, code)
    );

    if (tripCode.length === 0) {
      return res.status(404).json({ error: "Trip code not found" });
    }

    // Mark as verified
    await db.update(trip_codes).set({
      isVerified: true,
    }).where(eq(trip_codes.code, code));

    return res.json({ code, verified: true });
  } catch (error) {
    console.error("Verify trip code error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const safetyRouter = router;
