import { z } from "zod";

export const RideStatusSchema = z.enum([
  "REQUESTED",
  "SEARCHING", 
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED_BY_PASSENGER",
  "CANCELLED_BY_DRIVER",
  "CANCELLED_BY_SYSTEM",
  "EXPIRED",
  "DISPUTED",
]);

export const PriceQuoteSchema = z.object({
  originalPrice: z.number(),
  promotionDiscount: z.number(),
  passengerPrice: z.number(),
  driverCredit: z.number(),
});

export const DriverSchema = z.object({
  plate: z.string().min(1),
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: z.string().optional(),
  vehicleType: z.enum(["CAR", "MOTORCYCLE"]),
});

export const PassengerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const TripSchema = z.object({
  pickupLocation: z.object({ lat: z.number(), lng: z.number() }),
  dropoffLocation: z.object({ lat: z.number(), lng: z.number() }),
});

export type RideStatus = z.infer<typeof RideStatusSchema>;
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;
export type Driver = z.infer<typeof DriverSchema>;
export type Passenger = z.infer<typeof PassengerSchema>;
export type Trip = z.infer<typeof TripSchema>;
