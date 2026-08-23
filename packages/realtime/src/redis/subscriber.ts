import Redis from "ioredis";
import { RideEvent, RideEventType } from "../types";
import { v4 as uuidv4 } from "uuid";

export class EventSubscriber {
  private redis: Redis;
  private channel: string;
  private eventHandlers: Map<RideEventType, ((event: RideEvent) => void)[]>;

  constructor(redisUrl: string = "redis://localhost:6379", namespace: string = "fairmove") {
    this.redis = new Redis(redisUrl);
    this.channel = `${namespace}:events`;
    this.eventHandlers = new Map();
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
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(this.channel);

    subscriber.on("message", (channel, message) => {
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
    await this.redis.quit();
  }
}