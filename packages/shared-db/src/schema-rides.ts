import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./schema-auth";

export const rides = pgTable(
  "rides",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  passengerId: text("passenger_id").notNull().references(() => users.id),
  driverId: text("driver_id"),
  vehicleId: text("vehicle_id"),
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
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // BUG-H2: histórico do passageiro/motorista e sweep de expiração
    // (cron a cada minuto) rodavam Seq Scan — índices cobrem as duas janelas.
    passengerCreatedIdx: index("idx_rides_passenger_created").on(t.passengerId, t.createdAt),
    driverCreatedIdx: index("idx_rides_driver_created").on(t.driverId, t.createdAt),
    statusCreatedIdx: index("idx_rides_status_created").on(t.status, t.createdAt),
  })
);

export const rideLocationEvents = pgTable(
  "ride_location_events",
  {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  rideId: text("ride_id").notNull().references(() => rides.id),
  eventType: text("event_type").notNull(),
  lat: text("lat").notNull(),
  lng: text("lng").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    rideIdx: index("idx_ride_location_events_ride").on(t.rideId),
  })
);

export type Ride = typeof rides.$inferSelect;
export type RideLocationEvent = typeof rideLocationEvents.$inferSelect;
