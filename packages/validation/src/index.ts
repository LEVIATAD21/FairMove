import { z } from "zod";
import type { Request, RequestHandler, Response } from "express";

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

export const VehicleTypeSchema = z.enum(["car", "motorcycle", "CAR", "MOTORCYCLE"]);

export const DriverSchema = z.object({
  plate: z.string().trim().min(2).max(10),
  brand: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: z.string().trim().max(30).optional(),
  vehicleType: VehicleTypeSchema,
});

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((v) => /[A-Za-z]/.test(v), "Password must contain a letter")
  .refine((v) => /[0-9]/.test(v), "Password must contain a number");

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

export const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: EmailSchema,
  password: PasswordSchema,
});

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(72),
});

export const ForgotPasswordSchema = z.object({ email: EmailSchema });

export const ResetPasswordSchema = z.object({
  token: z.string().uuid(),
  password: PasswordSchema,
});

export const LatSchema = z.coerce
  .number()
  .refine((v) => v >= -90 && v <= 90, "Latitude out of range");

export const LngSchema = z.coerce
  .number()
  .refine((v) => v >= -180 && v <= 180, "Longitude out of range");

export const CreateRideSchema = z.object({
  pickupLocationLat: LatSchema,
  pickupLocationLng: LngSchema,
  dropoffLocationLat: LatSchema,
  dropoffLocationLng: LngSchema,
  couponCode: z.string().trim().min(1).max(40).optional(),
});

export const MoneySchema = z.coerce
  .number()
  .positive("Amount must be positive")
  .max(1_000_000, "Amount too large");

export const ReservePurposeSchema = z.enum([
  "fuel",
  "maintenance",
  "accident",
  "mechanical",
  "period_without_work",
  "emergency",
]);

export const WalletOperationSchema = z.object({
  amount: MoneySchema,
  description: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const ReserveOperationSchema = z.object({
  amount: MoneySchema,
  purpose: ReservePurposeSchema.optional(),
});

export const RideStatusUpdateSchema = z.object({
  status: RideStatusSchema,
});

export const CancelRideSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const CouponSchema = z.object({
  code: z.string().trim().min(3).max(40),
});

export const CampaignSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.coerce.number().positive().max(100_000),
  targetType: z.enum(["ride", "user", "region", "category"]).optional(),
  targetValue: z.string().trim().max(100).optional(),
  maxUses: z.coerce.number().int().positive().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const ProfileUpdateSchema = z
  .object({
    phone: z.string().trim().max(20).optional(),
    documentNumber: z.string().trim().max(30).optional(),
    documentType: z.string().trim().max(20).optional(),
    documentUrl: z.string().trim().url().max(500).optional(),
  })
  .strict();

export const TrustContactSchema = z.object({
  contactName: z.string().trim().min(2).max(100),
  contactPhone: z.string().trim().min(8).max(20),
  contactEmail: z.string().trim().email().max(254).optional(),
  isPrimary: z.boolean().optional(),
});

export const IncidentSchema = z.object({
  rideId: z.string().uuid(),
  type: z.enum(["accident", "harassment", "vehicle_damage", "theft", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  description: z.string().trim().max(2000).optional(),
});

export const TripCodeSchema = z.object({ rideId: z.string().uuid() });

export const SosSchema = z.object({ rideId: z.string().uuid() });

export const TripCodeVerifySchema = z.object({ code: z.string().trim().min(6).max(32) });

export const FraudEventSchema = z.object({
  userId: z.string().uuid(),
  rideId: z.string().uuid().nullable().optional(),
  eventType: z.enum(["device_risk", "account_risk", "behavioral_risk"]),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  score: z.coerce.number().int().min(0).max(100),
  description: z.string().trim().min(1).max(500),
  metadata: z.record(z.unknown()).optional(),
});

export type RideStatus = z.infer<typeof RideStatusSchema>;
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;
export type Driver = z.infer<typeof DriverSchema>;
export type Passenger = z.infer<typeof PassengerSchema>;
export type Trip = z.infer<typeof TripSchema>;

export const PassengerSchema = RegisterSchema;
export const TripSchema = z.object({
  pickupLocation: z.object({ lat: LatSchema, lng: LngSchema }),
  dropoffLocation: z.object({ lat: LatSchema, lng: LngSchema }),
});

function validationResponse(res: Response, issues: z.ZodIssue[]) {
  res.status(400).json({
    error: "Validation failed",
    details: issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/**
 * Middleware de validação do corpo da requisição.
 * Retorna 400 com a lista de erros quando o payload não corresponde ao schema.
 */
export function validateBody(schema: z.ZodTypeAny): RequestHandler {
  return (req: Request, res: Response, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      validationResponse(res, result.error.issues);
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Middleware de validação da query string (req.query).
 */
export function validateQuery(schema: z.ZodTypeAny): RequestHandler {
  return (req: Request, res: Response, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) {
      validationResponse(res, result.error.issues);
      return;
    }
    // Express 5: req.query é um getter que reparsa a cada leitura, então
    // Object.assign não persiste. Shadowa a propriedade na instância com os
    // dados já parseados/coeridos pelo Zod para o handler receber tipos reais.
    Object.defineProperty(req, "query", {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
}
