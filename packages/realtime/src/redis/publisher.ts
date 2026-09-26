import Redis from "ioredis";
import type { RideEvent } from "../types";

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Publicador de eventos de corrida.
 *
 * - Sem REDIS_URL configurado o publicador fica desativado (no-op), então o
 *   backend nunca quebra por falta de Redis.
 * - Erros de conexão são capturados (listener de "error") para não derrubar o
 *   processo.
 */
export class EventPublisher {
  private redis: Redis | null;
  private channel: string;
  private warned = false;

  constructor(
    redisUrl: string = process.env.REDIS_URL || "",
    namespace: string = "fairmove"
  ) {
    this.channel = `${namespace}:events`;
    if (!redisUrl) {
      this.redis = null;
      return;
    }
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.redis.on("error", (err) => {
      if (!this.warned) {
        console.warn(`[realtime] Redis unavailable, events will not be published: ${err.message}`);
        this.warned = true;
      }
    });
  }

  get enabled(): boolean {
    return this.redis !== null;
  }

  async publish(event: RideEvent): Promise<boolean> {
    if (!this.redis) return false;
    try {
      if (this.redis.status === "wait") {
        await this.redis.connect();
      }
      await this.redis.publish(this.channel, JSON.stringify(event));
      return true;
    } catch (error) {
      console.error("Failed to publish event:", error);
      return false;
    }
  }

  private async publishTyped(
    eventType: RideEvent["eventType"],
    rideId: string,
    event: Record<string, unknown>
  ): Promise<boolean> {
    const message = {
      eventType,
      rideId,
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };
    return this.publish(message as RideEvent);
  }

  async publishRideRequested(event: Record<string, unknown>) {
    return this.publishTyped("RideRequested", String(event.rideId ?? ""), event);
  }

  async publishDriverMatched(event: Record<string, unknown>) {
    return this.publishTyped("DriverMatched", String(event.rideId ?? ""), event);
  }

  async publishDriverArrived(event: Record<string, unknown>) {
    return this.publishTyped("DriverArrived", String(event.rideId ?? ""), event);
  }

  async publishRideStarted(event: Record<string, unknown>) {
    return this.publishTyped("RideStarted", String(event.rideId ?? ""), event);
  }

  async publishRideCompleted(event: Record<string, unknown>) {
    return this.publishTyped("RideCompleted", String(event.rideId ?? ""), event);
  }

  async publishRideCancelled(event: Record<string, unknown>) {
    return this.publishTyped("RideCancelled", String(event.rideId ?? ""), event);
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }
}

export const eventPublisher = new EventPublisher();
