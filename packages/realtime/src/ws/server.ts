import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { verify, TokenExpiredError, JsonWebTokenError } from "jsonwebtoken";
import { db, rides, drivers } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { getJwtSecret, type JwtPayloadShape } from "../../../auth/src/middleware";
import { isRefreshSessionBlacklisted } from "../../../auth/src/utils/blacklist";
import { eventSubscriber } from "../redis/subscriber";
import type { RideEvent } from "../types";
import {
  WsHub,
  interpretClientMessage,
  type WsClient,
  type WsRole,
} from "./hub";
import {
  findNearbyDrivers,
  updateDriverLocation,
} from "../../../matching/src/engine/matching-engine";

/** Raio de broadcast do ride:requested para motoristas próximos (PostGIS). */
const RIDE_REQUEST_RADIUS_KM = 5;

/** Status em que a corrida tem motorista e passageiro envolvidos. */
const ACTIVE_RIDE_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
] as const;

function toOutbound(type: string, data: Record<string, unknown>) {
  return { type, data };
}

interface RideRecipients {
  rideId: string;
  passengerId: string;
  driverUserId: string | null;
}

/** Carrega a corrida e o userId do motorista (via linha drivers). */
async function rideRecipients(rideId: string): Promise<RideRecipients | null> {
  const rideRows = await db.select().from(rides).where(eq(rides.id, rideId));
  if (rideRows.length === 0) return null;
  const ride = rideRows[0];
  let driverUserId: string | null = null;
  if (ride.driverId) {
    const driverRows = await db
      .select({ userId: drivers.userId })
      .from(drivers)
      .where(eq(drivers.id, ride.driverId));
    driverUserId = driverRows[0]?.userId ?? null;
  }
  return { rideId, passengerId: ride.passengerId, driverUserId };
}

export interface RealtimeServer {
  hub: WsHub;
  close(): Promise<void>;
}

/**
 * Anexa o WebSocket `/ws` ao servidor HTTP do Express.
 *
 * - Handshake autentica JWT (access token) e bloqueia sessão na blacklist;
 * - eventos vêm do Redis Pub/Sub (`fairmove:events`) — escala horizontal:
 *   cada instância entrega apenas aos sockets locais;
 * - `ride:requested` é direcionado por PostGIS (ST_DWithin) aos motoristas
 *   online/available no raio de 5 km do pickup;
 * - localização só encaminha quando o motorista NÃO está offline.
 */
export function attachRealtimeServer(httpServer: HttpServer): RealtimeServer {
  const hub = new WsHub();
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakMap<WebSocket, boolean>();

  async function authenticate(
    token: string | null
  ): Promise<JwtPayloadShape | null> {
    if (!token) return null;
    try {
      const payload = verify(token, getJwtSecret()) as JwtPayloadShape;
      if (!payload.userId || !payload.sessionId) return null;
      if (await isRefreshSessionBlacklisted(payload.sessionId)) return null;
      return payload;
    } catch (error) {
      if (error instanceof TokenExpiredError || error instanceof JsonWebTokenError) {
        return null;
      }
      throw error;
    }
  }

  httpServer.on("upgrade", (req, socket: Duplex, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    authenticate(token)
      .then((payload) => {
        if (!payload) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          onConnection(ws, payload);
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  function onConnection(ws: WebSocket, payload: JwtPayloadShape): void {
    const client: WsClient = {
      userId: payload.userId,
      role: (payload.role as WsRole) ?? "passenger",
      socket: ws,
      connectedAt: Date.now(),
    };
    hub.add(client);
    alive.set(ws, true);

    ws.send(JSON.stringify(toOutbound("hello", { role: client.role, userId: client.userId })));

    ws.on("pong", () => alive.set(ws, true));

    ws.on("message", (raw: RawData) => {
      void handleClientMessage(ws, client, raw.toString());
    });

    ws.on("close", () => {
      hub.remove(ws);
      alive.delete(ws);
    });

    ws.on("error", () => {
      hub.remove(ws);
      alive.delete(ws);
    });
  }

  async function handleClientMessage(
    ws: WebSocket,
    client: WsClient,
    raw: string
  ): Promise<void> {
    try {
      const intent = interpretClientMessage(raw, client.role);
      if (!intent) {
        ws.send(
          JSON.stringify(
            toOutbound("error", { code: "bad_message", message: "Invalid message" })
          )
        );
        return;
      }

      if (intent.kind === "ping") {
        ws.send(JSON.stringify(toOutbound("pong", {})));
        return;
      }

      if (intent.kind === "driver_location") {
        const driverRows = await db
          .select({ id: drivers.id, status: drivers.status })
          .from(drivers)
          .where(eq(drivers.userId, client.userId));
        const driver = driverRows[0];
        // Restrição operacional: motorista offline nunca tem localização repassada.
        if (!driver || driver.status === "offline") {
          ws.send(
            JSON.stringify(
              toOutbound("error", {
                code: "driver_offline",
                message: "Driver is offline; location not forwarded",
              })
            )
          );
          return;
        }

        await updateDriverLocation(driver.id, intent.lat, intent.lng);

        const rideRows = await db
          .select({ id: rides.id, status: rides.status, passengerId: rides.passengerId })
          .from(rides)
          .where(eq(rides.driverId, driver.id));
        const activeRide = rideRows.find((r) =>
          (ACTIVE_RIDE_STATUSES as readonly string[]).includes(r.status)
        );
        if (!activeRide) return;

        hub.sendToUser(activeRide.passengerId, {
          type: "driver:location",
          data: { rideId: activeRide.id, lat: intent.lat, lng: intent.lng, at: Date.now() },
        });
        return;
      }

      if (intent.kind === "passenger_location") {
        const rideRows = await db
          .select({ id: rides.id, status: rides.status, driverId: rides.driverId })
          .from(rides)
          .where(eq(rides.passengerId, client.userId));
        const activeRide = rideRows.find((r) =>
          (ACTIVE_RIDE_STATUSES as readonly string[]).includes(r.status)
        );
        if (!activeRide || !activeRide.driverId) return;

        const driverRows = await db
          .select({ userId: drivers.userId })
          .from(drivers)
          .where(eq(drivers.id, activeRide.driverId));
        const driverUserId = driverRows[0]?.userId;
        if (!driverUserId) return;

        hub.sendToUser(driverUserId, {
          type: "passenger:location",
          data: { rideId: activeRide.id, lat: intent.lat, lng: intent.lng, at: Date.now() },
        });
      }
    } catch (error) {
      console.error("[realtime] client message error:", error);
    }
  }

  // ---- Redis Pub/Sub → sockets locais -------------------------------------

  async function notifyRideParticipants(
    rideId: string,
    type: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const recipients = await rideRecipients(rideId);
    if (!recipients) return;
    const message = toOutbound(type, { rideId, ...extra });
    hub.sendToUser(recipients.passengerId, message);
    if (recipients.driverUserId) {
      hub.sendToUser(recipients.driverUserId, message);
    }
  }

  eventSubscriber.on("RideRequested", (event: RideEvent) => {
    void (async () => {
      if (event.eventType !== "RideRequested") return;
      const nearby = await findNearbyDrivers(
        event.pickupLocation.lat,
        event.pickupLocation.lng,
        undefined,
        RIDE_REQUEST_RADIUS_KM
      );
      if (nearby.length === 0) return;
      const rideRows = await db.select().from(rides).where(eq(rides.id, event.rideId));
      const ride = rideRows[0];
      hub.sendToUsers(
        nearby.map((d) => d.driverUserId),
        toOutbound("ride:requested", {
          rideId: event.rideId,
          pickup: event.pickupLocation,
          dropoff: event.dropoffLocation,
          distanceKm: ride ? Math.round(Number(ride.estimatedDistance) / 100) / 10 : null,
          estimatedTimeSeconds: ride?.estimatedTime ?? null,
          originalPrice: ride ? Math.round(Number(ride.finalPassengerPrice)) / 100 : null,
        })
      );
    })().catch((error) => console.error("[realtime] RideRequested error:", error));
  });

  eventSubscriber.on("DriverMatched", (event: RideEvent) => {
    void (async () => {
      if (event.eventType !== "DriverMatched") return;
      const recipients = await rideRecipients(event.rideId);
      if (!recipients) return;
      hub.sendToUser(
        recipients.passengerId,
        toOutbound("ride:matched", {
          rideId: event.rideId,
          driverId: event.driverId,
          driverName: event.driverName,
          vehiclePlate: event.vehiclePlate,
        })
      );
    })().catch((error) => console.error("[realtime] DriverMatched error:", error));
  });

  const statusEvents = new Set([
    "RideStatusChanged",
    "DriverArrived",
    "RideStarted",
    "RideCompleted",
    "RideCancelled",
  ]);

  for (const eventType of statusEvents) {
    eventSubscriber.on(eventType as never, (event: RideEvent) => {
      void (async () => {
        const status =
          eventType === "RideCompleted"
            ? "COMPLETED"
            : eventType === "RideCancelled"
              ? "CANCELLED"
              : eventType === "RideStarted"
                ? "IN_PROGRESS"
                : eventType === "DriverArrived"
                  ? "DRIVER_ARRIVING"
                  : (event as { status?: string }).status ?? "UNKNOWN";
        await notifyRideParticipants(event.rideId, "ride:status", { status });
      })().catch((error) =>
        console.error(`[realtime] ${eventType} error:`, error)
      );
    });
  }

  eventSubscriber.startListening().catch((error) => {
    console.error("[realtime] subscriber start error:", error);
  });

  // ---- heartbeat (remove sockets zumbis) ----------------------------------
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000) as unknown as { unref?: () => void };
  heartbeat.unref?.();

  return {
    hub,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      clearInterval(heartbeat as unknown as number);
      await eventSubscriber.close();
    },
  };
}
