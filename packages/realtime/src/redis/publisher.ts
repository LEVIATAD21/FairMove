import Redis from "ioredis";
import { RideEvent, RideEventType } from "../types";

export class EventPublisher {
  private redis: Redis;
  private channel: string;

  constructor(redisUrl: string = "redis://localhost:6379", namespace: string = "fairmove") {
    this.redis = new Redis(redisUrl);
    this.channel = `${namespace}:events`;
  }

  async publish(event: RideEvent): Promise<boolean> {
    try {
      await this.redis.publish(this.channel, JSON.stringify(event));
      return true;
    } catch (error) {
      console.error("Failed to publish event:", error);
      return false;
    }
  }

  async publishRideRequested(event: Omit<RideRequestedEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "RideRequested",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async publishDriverMatched(event: Omit<DriverMatchedEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "DriverMatched",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async publishDriverArrived(event: Omit<DriverArrivedEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "DriverArrived",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async publishRideStarted(event: Omit<RideStartedEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "RideStarted",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async publishRideCompleted(event: Omit<RideCompletedEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "RideCompleted",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async publishRideCancelled(event: Omit<RideCancelledEvent, "eventType" | "rideId" | "timestamp" | "occurredAt">): Promise<boolean> {
    const message = {
      eventType: "RideCancelled",
      rideId: uuidv4(),
      timestamp: Date.now(),
      occurredAt: new Date().toISOString(),
      ...event,
    };

    return this.publish(message as RideEvent);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}