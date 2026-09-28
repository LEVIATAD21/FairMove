import { Router, type Request, type Response } from "express";
import { db, rides, rideLocationEvents, users, drivers, vehicles, risk_scores, type Ride } from "@fairmove/shared-db";
import { eq, and, or, desc, sql, inArray, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, type AuthUser } from "../../auth/src/middleware";
import { validateBody, CreateRideSchema, CancelRideSchema } from "@fairmove/validation";
import { z } from "zod";
import {
  haversineKm,
  estimateDurationMinutes,
  toCents,
} from "@fairmove/shared-types";
import { canTransition, transitionRide } from "./state/machine";
import { getDriverByUserId, loadRide, loadRideForUser } from "./access";
import { calculateQuote, PRICING_RULES } from "../../pricing/src/engine/calculator";
import { applyPromotion, releaseRedemptions } from "../../promotions/src/engine/promotion-engine";
import { setDriverAvailability } from "../../matching/src/engine/matching-engine";
import { settleRidePayment } from "../../payments/src/settlement";
import { DuplicateOperationError } from "../../wallets/src/engine/wallet-engine";
import { eventPublisher } from "../../realtime/src/redis/publisher";

const router = Router();

const StatusUpdateSchema = z.object({
  status: z.enum([
    "DRIVER_ARRIVING",
    "DRIVER_AT_PICKUP",
    "PASSENGER_ONBOARD",
    "IN_PROGRESS",
  ]),
});

/** Estados que o motorista pode assumir (COMPLETED tem rota própria). */
const DRIVER_ADVANCE_STATUSES = new Set([
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
]);

/** Status em que a corrida ainda consome recursos (bloqueia nova corrida/accept). */
const ACTIVE_RIDE_STATUSES = [
  "REQUESTED",
  "SEARCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
] as const;

function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

export async function recordRideEvent(
  rideId: string,
  eventType: string,
  lat: string | null,
  lng: string | null,
  metadata?: Record<string, unknown>
) {
  await db.insert(rideLocationEvents).values({
    id: uuidv4(),
    rideId,
    eventType,
    lat: lat ?? "0",
    lng: lng ?? "0",
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

// Criar corrida (passageiro autenticado)
router.post("/", requireAuth, validateBody(CreateRideSchema), async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const {
      pickupLocationLat,
      pickupLocationLng,
      dropoffLocationLat,
      dropoffLocationLng,
      couponCode,
    } = req.body as {
      pickupLocationLat: number;
      pickupLocationLng: number;
      dropoffLocationLat: number;
      dropoffLocationLng: number;
      couponCode?: string;
    };

    const pickup = { lat: pickupLocationLat, lng: pickupLocationLng };
    const dropoff = { lat: dropoffLocationLat, lng: dropoffLocationLng };

    const distanceKm = haversineKm(pickup, dropoff);
    if (!Number.isFinite(distanceKm) || distanceKm < 0.05) {
      res.status(400).json({ error: "Pickup and dropoff locations must be different" });
      return;
    }

    // Portão de fraude: contas com risco crítico não podem solicitar corridas
    const riskRows = await db
      .select({ riskLevel: risk_scores.riskLevel })
      .from(risk_scores)
      .where(eq(risk_scores.userId, user.id));
    if (riskRows.length > 0 && riskRows[0].riskLevel === "CRITICAL") {
      res.status(403).json({ error: "Account blocked due to risk policy" });
      return;
    }

    // Corridas fantasmas: um passageiro só pode ter UMA corrida ativa por vez.
    // Sem isso, spam de POST criava N corridas REQUESTED concorrentes que
    // disparavam N broadcasts de match e drenavam a fila de motoristas.
    const activeRows = await db
      .select({ id: rides.id, status: rides.status })
      .from(rides)
      .where(
        and(
          eq(rides.passengerId, user.id),
          inArray(rides.status, [...ACTIVE_RIDE_STATUSES])
        )
      );
    if (activeRows.length > 0) {
      res.status(409).json({
        error: "Passenger already has an active ride",
        rideId: activeRows[0].id,
        status: activeRows[0].status,
      });
      return;
    }

    const timeMinutes = estimateDurationMinutes(distanceKm);
    const quote = calculateQuote(PRICING_RULES.baseFare, distanceKm, timeMinutes, 1.0, 0);

    const baseFareCents = toCents(PRICING_RULES.baseFare);
    const distanceFareCents = toCents(distanceKm * PRICING_RULES.perKm);
    const timeFareCents = toCents(timeMinutes * PRICING_RULES.perMinute);
    const originalPriceCents = toCents(quote.originalPrice);

    const rideId = uuidv4();

    await db.insert(rides).values({
      id: rideId,
      passengerId: user.id,
      status: "REQUESTED",
      pickupLocationLat: String(pickupLocationLat),
      pickupLocationLng: String(pickupLocationLng),
      dropoffLocationLat: String(dropoffLocationLat),
      dropoffLocationLng: String(dropoffLocationLng),
      baseFare: baseFareCents,
      distanceFare: distanceFareCents,
      timeFare: timeFareCents,
      promotionDiscount: 0,
      finalPassengerPrice: originalPriceCents,
      driverCredit: originalPriceCents,
      estimatedDistance: Math.round(distanceKm * 1000),
      estimatedTime: Math.round(timeMinutes * 60),
    });

    // Cupom (opcional): valida e persiste o desconto na corrida
    if (couponCode) {
      try {
        await applyPromotion(rideId, user.id, couponCode);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode ?? 500;
        if (status >= 400 && status < 500) {
          await db.delete(rides).where(eq(rides.id, rideId));
          res.status(status).json({ error: (error as Error).message });
          return;
        }
        throw error;
      }
    }

    const finalRide = await loadRide(rideId);

    await recordRideEvent(rideId, "REQUESTED", String(pickupLocationLat), String(pickupLocationLng), {
      passengerId: user.id,
      distanceKm: Math.round(distanceKm * 100) / 100,
      timeMinutes,
      quotedPrice: centsToNumber(originalPriceCents),
    });

    await eventPublisher.publishRideRequested({
      rideId,
      passengerId: user.id,
      pickupLocation: pickup,
      dropoffLocation: dropoff,
    });

    res.status(201).json({
      rideId,
      status: finalRide?.status ?? "REQUESTED",
      distanceKm: Math.round(distanceKm * 100) / 100,
      estimatedTimeSeconds: Math.round(timeMinutes * 60),
      originalPrice: centsToNumber(originalPriceCents),
      promotionDiscount: centsToNumber(finalRide?.promotionDiscount ?? 0),
      totalFare: centsToNumber(finalRide?.finalPassengerPrice ?? originalPriceCents),
      currency: "BRL",
    });
  } catch (error) {
    console.error("Create ride error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Detalhe da corrida (participantes ou admin)
router.get("/:rideId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const result = await loadRideForUser(rideId, req.user!);

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    res.json({
      ...result.ride,
      totalFare: centsToNumber(result.ride.finalPassengerPrice),
      driverCreditAmount: centsToNumber(result.ride.driverCredit),
    });
  } catch (error) {
    console.error("Get ride error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Motorista aceita a corrida
router.post("/:rideId/accept", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const user = req.user!;

    if (user.role !== "driver" && user.role !== "admin") {
      res.status(403).json({ error: "Only drivers can accept rides" });
      return;
    }

    const ride = await loadRide(rideId);
    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    const driver = await getDriverByUserId(user.id);
    if (!driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    if (!["REQUESTED", "SEARCHING"].includes(ride.status)) {
      res.status(400).json({ error: `Ride cannot be accepted in status ${ride.status}` });
      return;
    }

    if (!driver.available || driver.status === "offline") {
      res.status(409).json({ error: "Driver is not available" });
      return;
    }

    // Claim + atribuição numa ÚNICA transação:
    // - o UPDATE condicional do motorista fecha o TOCTOU: o mesmo motorista
    //   não aceita duas corridas em paralelo (o guard da corrida sozinho não
    //   impedia isso);
    // - rollback automático devolve `available` se a corrida já saiu da fila.
    const outcome = await db.transaction(async (tx): Promise<
      "driver_busy" | "searching_gone" | "taken" | "assigned"
    > => {
      const claimed = await tx
        .update(drivers)
        .set({ available: false, updatedAt: new Date() })
        .where(
          and(
            eq(drivers.id, driver.id),
            eq(drivers.available, true),
            ne(drivers.status, "offline")
          )
        )
        .returning({ id: drivers.id });
      if (claimed.length === 0) return "driver_busy";

      // Garante que a corrida está em busca (REQUESTED -> SEARCHING)
      if (ride.status === "REQUESTED") {
        const advanced = await tx
          .update(rides)
          .set({ status: "SEARCHING", updatedAt: new Date() })
          .where(and(eq(rides.id, rideId), eq(rides.status, "REQUESTED")))
          .returning({ id: rides.id });
        if (advanced.length === 0) return "searching_gone";
      }

      // Atômico: apenas um motorista consegue atribuir a corrida
      const assigned = await tx
        .update(rides)
        .set({
          status: "DRIVER_ASSIGNED",
          driverId: driver.id,
          vehicleId: driver.vehicleId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(rides.id, rideId), eq(rides.status, "SEARCHING"), sql`${rides.driverId} IS NULL`)
        )
        .returning({ id: rides.id });
      if (assigned.length === 0) return "taken";

      return "assigned";
    });

    if (outcome === "driver_busy") {
      res.status(409).json({ error: "Driver is not available" });
      return;
    }
    if (outcome === "searching_gone") {
      res.status(409).json({ error: "Ride is not available for search anymore" });
      return;
    }
    if (outcome === "taken") {
      res.status(409).json({ error: "Ride was already accepted by another driver" });
      return;
    }

    await recordRideEvent(
      rideId,
      "DRIVER_ASSIGNED",
      ride.pickupLocationLat,
      ride.pickupLocationLng,
      { driverId: driver.id }
    );

    let vehiclePlate = "";
    if (driver.vehicleId) {
      const vehicleRows = await db
        .select({ plate: vehicles.plate })
        .from(vehicles)
        .where(eq(vehicles.id, driver.vehicleId));
      vehiclePlate = vehicleRows[0]?.plate ?? "";
    }

    await eventPublisher.publishDriverMatched({
      rideId,
      driverId: driver.id,
      driverName: (await db.select({ name: users.name }).from(users).where(eq(users.id, user.id)))[0]?.name ?? "",
      vehiclePlate,
    });

    res.json({ rideId, status: "DRIVER_ASSIGNED", driverId: driver.id });
  } catch (error) {
    console.error("Accept ride error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

// Avanço de estado pelo motorista
router.patch(
  "/:rideId/status",
  requireAuth,
  validateBody(StatusUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const { rideId } = req.params as { rideId: string };
      const { status } = req.body as { status: string };
      const user = req.user!;

      const result = await loadRideForUser(rideId, user);
      if (!result.ok) {
        res.status(result.status).json({ error: result.message });
        return;
        }
      const ride = result.ride;

      if (!DRIVER_ADVANCE_STATUSES.has(status)) {
        res.status(400).json({ error: `Status ${status} cannot be set through this endpoint` });
        return;
      }

      if (user.role !== "admin") {
        const driver = await getDriverByUserId(user.id);
        if (!driver || ride.driverId !== driver.id) {
          res.status(403).json({ error: "Only the assigned driver can update this ride" });
          return;
        }
      }

      const transition = transitionRide(ride.status, status);
      if (!transition.success) {
        res.status(400).json({ error: transition.error });
        return;
      }

      const patch: Record<string, unknown> = { status, updatedAt: new Date() };
      if (status === "IN_PROGRESS" && !ride.startedAt) {
        patch.startedAt = new Date();
      }

      const updated = await db
        .update(rides)
        .set(patch)
        .where(and(eq(rides.id, rideId), eq(rides.status, ride.status)))
        .returning({ id: rides.id });

      if (updated.length === 0) {
        res.status(409).json({ error: "Ride state changed concurrently" });
        return;
      }

    await recordRideEvent(rideId, status, ride.pickupLocationLat, ride.pickupLocationLng, {
      from: ride.status,
      to: status,
    });

    await eventPublisher.publishRideStatusChanged({
      rideId,
      status,
      from: ride.status,
      passengerId: ride.passengerId,
      driverId: ride.driverId,
    });

      if (status === "DRIVER_ARRIVING") {
        await eventPublisher.publishDriverArrived({
          rideId,
          driverId: ride.driverId,
        });
      }
      if (status === "IN_PROGRESS") {
        await eventPublisher.publishRideStarted({
          rideId,
          driverId: ride.driverId,
          startedAt: new Date().toISOString(),
        });
      }

      res.json({ rideId, status });
    } catch (error) {
      console.error("Update ride status error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Concluir corrida: liquida pagamento e credita o motorista
router.post("/:rideId/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params as { rideId: string };
    const user = req.user!;

    const result = await loadRideForUser(rideId, user);
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    const ride = result.ride;

    if (user.role !== "admin") {
      const driver = await getDriverByUserId(user.id);
      if (!driver || ride.driverId !== driver.id) {
        res.status(403).json({ error: "Only the assigned driver can complete this ride" });
        return;
      }
    }

    if (ride.status !== "IN_PROGRESS") {
      res.status(400).json({ error: `Ride cannot be completed in status ${ride.status}` });
      return;
    }

    const transition = transitionRide(ride.status, "COMPLETED");
    if (!transition.success) {
      res.status(400).json({ error: transition.error });
      return;
    }

    // Preço é sempre o calculado pelo backend (nunca vem do cliente)
    const fareCents = Number(ride.finalPassengerPrice);
    const driverCreditCents = Number(ride.driverCredit);

    const driverUserId = ride.driverId
      ? (
          await db
            .select({ userId: drivers.userId })
            .from(drivers)
            .where(eq(drivers.id, ride.driverId))
        )[0]?.userId
      : null;

    if (!driverUserId) {
      res.status(400).json({ error: "Ride has no assigned driver" });
      return;
    }

    // 1) CLAIM de estado ANTES do dinheiro (BUG-E3): o settle corria antes do
    // CAS — cancelamento concorrente vencia o status DEPOIS do débito/crédito
    // já commitados, deixando corrida CANCELLED com passageiro debitado e
    // motorista creditado (sem estorno). Agora só o vencedor do CAS liquida.
    const claimed = await db
      .update(rides)
      .set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(rides.id, rideId), eq(rides.status, "IN_PROGRESS")))
      .returning({ id: rides.id });

    if (claimed.length === 0) {
      res.status(409).json({ error: "Ride state changed concurrently" });
      return;
    }

    // 2) Liquidação financeira (idempotente). Falhou → devolve IN_PROGRESS e
    // propaga: dinheiro e status nunca ficam divergentes (retry é seguro —
    // settle é idempotente por corrida). DuplicateOperationError = corrida já
    // liquidada por tentativa anterior → NÃO reverta: COMPLETED é o estado
    // certo; a pré-checagem do settle devolve o resultado já registrado.
    let settlement: Awaited<ReturnType<typeof settleRidePayment>>;
    try {
      settlement = await settleRidePayment({
        rideId,
        passengerId: ride.passengerId,
        driverUserId,
        fareCents,
        driverCreditCents,
      });
    } catch (settleError) {
      if (settleError instanceof DuplicateOperationError) {
        settlement = await settleRidePayment({
          rideId,
          passengerId: ride.passengerId,
          driverUserId,
          fareCents,
          driverCreditCents,
        });
      } else {
        await db
          .update(rides)
          .set({ status: "IN_PROGRESS", completedAt: null, updatedAt: new Date() })
          .where(and(eq(rides.id, rideId), eq(rides.status, "COMPLETED")));
        throw settleError;
      }
    }

    // 3) Motorista volta a ficar disponível
    if (ride.driverId) {
      await setDriverAvailability(ride.driverId, true);
    }

    await recordRideEvent(rideId, "COMPLETED", ride.dropoffLocationLat, ride.dropoffLocationLng, {
      settlement: {
        paymentMethod: settlement.paymentMethod,
        alreadySettled: settlement.alreadySettled,
        driverTransactionId: settlement.driverTransactionId,
      },
      totalFare: centsToNumber(fareCents),
    });

    await eventPublisher.publishRideCompleted({
      rideId,
      driverId: ride.driverId,
      completedAt: new Date().toISOString(),
      totalFare: centsToNumber(fareCents),
    });

    res.json({
      rideId,
      status: "COMPLETED",
      totalFare: centsToNumber(fareCents),
      driverCredit: centsToNumber(driverCreditCents),
      paymentMethod: settlement.paymentMethod,
      alreadySettled: settlement.alreadySettled,
      currency: "BRL",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "InsufficientFundsError") {
      res.status(402).json({ error: "Payment could not be processed" });
      return;
    }
    if (error instanceof DuplicateOperationError) {
      // Liquidação desta corrida já processada por requisição concorrente —
      // o claim de status abaixo decide; nunca expor500 por corrida.
      res.status(409).json({ error: "Ride already settled" });
      return;
    }
    console.error("Complete ride error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

// Cancelar corrida (passageiro, motorista atribuído ou admin)
router.post(
  "/:rideId/cancel",
  requireAuth,
  validateBody(CancelRideSchema),
  async (req: Request, res: Response) => {
    try {
      const { rideId } = req.params as { rideId: string };
      const { reason } = req.body as { reason?: string };
      const user = req.user!;

      const result = await loadRideForUser(rideId, user);
      if (!result.ok) {
        res.status(result.status).json({ error: result.message });
        return;
        }
      const ride = result.ride;

      let cancelStatus: string;
      if (user.role === "admin") {
        cancelStatus = "CANCELLED_BY_SYSTEM";
      } else if (ride.passengerId === user.id) {
        cancelStatus = "CANCELLED_BY_PASSENGER";
      } else {
        const driver = await getDriverByUserId(user.id);
        if (driver && ride.driverId === driver.id) {
          cancelStatus = "CANCELLED_BY_DRIVER";
        } else {
          res.status(403).json({ error: "You cannot cancel this ride" });
          return;
        }
      }

      if (!canTransition(ride.status, cancelStatus)) {
        res.status(400).json({
          error: `Invalid transition from ${ride.status} to ${cancelStatus}`,
        });
        return;
      }

      const updated = await db
        .update(rides)
        .set({
          status: cancelStatus,
          cancellationReason: reason || null,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(rides.id, rideId), eq(rides.status, ride.status)))
        .returning({ id: rides.id });

      if (updated.length === 0) {
        res.status(409).json({ error: "Ride state changed concurrently" });
        return;
      }

      // Libera o motorista e devolve o cupom ao passageiro
      if (ride.driverId) {
        await setDriverAvailability(ride.driverId, true);
      }
      try {
        await releaseRedemptions(rideId);
      } catch (error) {
        console.error("Release redemptions error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      }

      await recordRideEvent(
        rideId,
        cancelStatus,
        ride.pickupLocationLat,
        ride.pickupLocationLng,
        { reason: reason || null, cancelledBy: user.id }
      );

      await eventPublisher.publishRideCancelled({
        rideId,
        cancelledBy:
          cancelStatus === "CANCELLED_BY_PASSENGER"
            ? "passenger"
            : cancelStatus === "CANCELLED_BY_DRIVER"
              ? "driver"
              : "system",
        cancellationReason: reason,
      });

      res.json({ rideId, status: cancelStatus });
    } catch (error) {
      console.error("Cancel ride error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Histórico do próprio usuário (como passageiro ou motorista)
router.get("/history/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const driver = await getDriverByUserId(user.id);

    const conditions = [eq(rides.passengerId, user.id)];
    if (driver) {
      conditions.push(eq(rides.driverId, driver.id));
    }

    const history = await db
      .select()
      .from(rides)
      .where(or(...conditions))
      .orderBy(desc(rides.createdAt))
      .limit(100);

    res.json({
      rides: history.map((ride: Ride) => ({
        ...ride,
        totalFare: centsToNumber(ride.finalPassengerPrice),
        driverCreditAmount: centsToNumber(ride.driverCredit),
      })),
    });
  } catch (error) {
    console.error("Get ride history error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
    res.status(500).json({ error: "Internal server error" });
  }
});

export const rideRouter = router;
