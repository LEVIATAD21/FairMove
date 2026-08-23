import { pgTable, text, integer, boolean, pgEnum, timestamp } from "drizzle-orm/pg-core";

export const rides = pgTable("rides", {
  id: text("id").primaryKey().$defaultRandom(),
  passengerId: text("passenger_id").notNull(),
  driverId: text("driver_id").references(() => drivers.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  pickupLocationLat: text("pickup_location_lat"),
  pickupLocationLng: text("pickup_location_lng"),
  dropoffLocationLat: text("dropoff_location_lat"),
  dropoffLocationLng: text("dropoff_location_lng"),
  status: text("status").default("REQUESTED").notNull(),
  baseFare: integer("base_fare").default(0).notNull(),
  distanceFare: integer("distance_fare").default(0).notNull(),
  timeFare: integer("time_fare").default(0).notNull(),
  promotionDiscount: integer("promotion_discount").default(0).notNull(),
  finalPassengerPrice: integer("final_passenger_price").notNull(),
  driverCredit: integer("driver_credit").notNull(),
  estimatedDistance: integer("estimated_distance"),
  estimatedTime: integer("estimated_time"),
  startedAt: timestamp("started_at", { mode: "nullable" }),
  completedAt: timestamp("completed_at", { mode: "nullable" }),
  cancelledAt: timestamp("cancelled_at", { mode: "nullable" }),
  cancellationReason: text("cancellation_reason", { mode: "nullable" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rideLocationEvents = pgTable("ride_location_events", {
  id: text("id").primaryKey().$defaultRandom(),
  rideId: text("ride_id").notNull().references(() => rides.id),
  eventType: text("event_type").notNull(), // REQUESTED, ARRIVED, ONBOARD, etc.
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  metadata: text("metadata", { mode: "json" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Ride = typeof rides.$inferSelect;
export type RideLocationEvent = typeof rideLocationEvents.$inferSelect;