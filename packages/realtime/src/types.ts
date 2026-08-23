export type RideEventType =
  | "RideRequested"
  | "DriverMatched"
  | "DriverArrived"
  | "RideStarted"
  | "RideCompleted"
  | "RideCancelled"
  | "PaymentAuthorized"
  | "PaymentCaptured"
  | "DriverCredited"
  | "ReserveContributionCreated"
  | "PromotionApplied"
  | "DriverSubscriptionPaid";

export interface RideEventBase {
  eventType: RideEventType;
  rideId: string;
  timestamp: number;
  occurredAt: string;
}

export interface RideRequestedEvent extends RideEventBase {
  eventType: "RideRequested";
  passengerId: string;
  pickupLocation: { lat: number; lng: number };
  dropoffLocation: { lat: number; lng: number };
}

export interface DriverMatchedEvent extends RideEventBase {
  eventType: "DriverMatched";
  rideId: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
}

export interface DriverArrivedEvent extends RideEventBase {
  eventType: "DriverArrived";
  rideId: string;
  driverId: string;
}

export interface RideStartedEvent extends RideEventBase {
  eventType: "RideStarted";
  rideId: string;
  driverId: string;
  startedAt: string;
}

export interface RideCompletedEvent extends RideEventBase {
  eventType: "RideCompleted";
  rideId: string;
  driverId: string;
  completedAt: string;
  totalFare: number;
}

export interface RideCancelledEvent extends RideEventBase {
  eventType: "RideCancelled";
  rideId: string;
  cancelledBy: "passenger" | "driver" | "system";
  cancellationReason?: string;
}

export type RideEvent =
  | RideRequestedEvent
  | DriverMatchedEvent
  | DriverArrivedEvent
  | RideStartedEvent
  | RideCompletedEvent
  | RideCancelledEvent;

export interface RealtimeConfig {
  redisUrl: string;
  namespace: string;
}