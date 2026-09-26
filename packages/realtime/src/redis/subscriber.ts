import Redis from "ioredis";
import { RideEvent, RideEventType } from "../types";

/**
 * Assinante de eventos de corrida.
 * Sem REDIS_URL configurado, `startListening` vira no-op seguro.
 */
export class EventSubscriber {
  private redis: Redis | null;
  private channel: string;
  private eventHandlers: Map<RideEventType, ((event: RideEvent) => void)[]>;

  constructor(
    redisUrl: string = process.env.REDIS_URL || "",
    namespace: string = "fairmove"
  ) {
    this.channel = `${namespace}:events`;
    this.eventHandlers = new Map();
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
      console.warn(`[realtime] subscriber Redis error: ${err.message}`);
    });
  }

  on(eventType: RideEventType, handler: (event: RideEvent) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  off(eventType: RideEventType, handler: (event: RideEvent) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async startListening(): Promise<void> {
    if (!this.redis) return;

    if (this.redis.status === "wait") {
      await this.redis.connect();
    }
    const subscriber = this.redis.duplicate();
    subscriber.on("error", (err) => {
      console.warn(`[realtime] subscriber connection error: ${err.message}`);
    });
    await subscriber.subscribe(this.channel);

    subscriber.on("message", (channel, message) => {
      if (channel !== this.channel) return;
      try {
        const event: RideEvent = JSON.parse(message);
        const handlers = this.eventHandlers.get(event.eventType);
        if (handlers) {
          handlers.forEach((handler) => handler(event));
        }
      } catch (error) {
        console.error("Failed to handle event:", error);
      }
    });
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }
}

export const eventSubscriber = new EventSubscriber();
