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
]);

export const PriceQuoteSchema = z.object({
  originalPrice: z.number(),
  promotionDiscount: z.number(),
  passengerPrice: z.number(),
  driverCredit: z.number(),
});

export const VehicleTypeSchema = z.enum(["car", "motorcycle", "CAR", "MOTORCYCLE"]);

/**
 * Placa Mercosul (ABC1D23) ou antiga (ABC1234) — case-insensitive,
 * normalizada para MAIÚSCULAS. Formato livre ("AB") era aceito antes.
 */
export const PlateSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), {
    message: "Placa inválida (use formato Mercosul ABC1D23 ou antigo ABC1234)",
  });

/** CNH: 11 dígitos (sem máscara). */
export const CnhNumberSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => /^\d{11}$/.test(v), { message: "CNH deve ter 11 dígitos" });

/** Renavam: 11 dígitos. */
export const RenavamSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => /^\d{11}$/.test(v), { message: "Renavam deve ter 11 dígitos" });

export const DriverSchema = z.object({
  plate: PlateSchema,
  brand: z.string().trim().min(1).max(50),
  model: z.string().trim().min(1).max(50),
  year: z.coerce.number().int().min(1990).max(new Date().getFullYear() + 1),
  color: z.string().trim().max(30).optional(),
  vehicleType: VehicleTypeSchema,
});

/** Tipos de documento exigidos da CONDUTORA do programa. */
export const DriverDocTypeSchema = z.enum([
  "cnh_front",
  "cnh_back",
  "vehicle_front",
  "vehicle_back",
  "vehicle_side",
  "crlv",
]);

export const ALLOWED_DOC_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** ~1,5 MB de base64 por imagem (4/3 do tamanho binário ≈ 1,1 MB). */
export const MAX_DOC_DATA_CHARS = 1_500_000;

export const DriverDocumentSchema = z
  .object({
    docType: DriverDocTypeSchema,
    mimeType: z.enum(ALLOWED_DOC_MIME_TYPES),
    data: z.string().min(64).max(MAX_DOC_DATA_CHARS),
    cnhNumber: CnhNumberSchema.optional(),
    cnhExpiresOn: z.coerce.date().optional(),
    renavam: RenavamSchema.optional(),
  })
  .superRefine((doc, ctx) => {
    if (doc.docType === "cnh_front") {
      if (!doc.cnhNumber) {
        ctx.addIssue({ code: "custom", path: ["cnhNumber"], message: "cnhNumber obrigatório para cnh_front" });
      }
      if (!doc.cnhExpiresOn) {
        ctx.addIssue({ code: "custom", path: ["cnhExpiresOn"], message: "cnhExpiresOn obrigatório para cnh_front" });
      } else if (doc.cnhExpiresOn.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", path: ["cnhExpiresOn"], message: "CNH vencida" });
      }
    }
    if (doc.docType === "crlv" && !doc.renavam) {
      ctx.addIssue({ code: "custom", path: ["renavam"], message: "renavam obrigatório para crlv" });
    }
    if (!doc.data.startsWith(`data:${doc.mimeType};base64,`)) {
      ctx.addIssue({ code: "custom", path: ["data"], message: "data URL não bate com mimeType" });
    }
  });

export const SubmitDriverDocumentsSchema = z.object({
  documents: z.array(DriverDocumentSchema).min(6).max(12),
});

export const ApplicationActionSchema = z.object({
  action: z.enum(["approve", "reject", "suspend", "reinstate"]),
  reason: z.string().trim().min(3).max(500).optional(),
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

/** Código de verificação de e-mail: 6 dígitos. */
export const VerifyEmailSchema = z.object({
  email: EmailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const ResetPasswordSchema = z.object({
  // O emissor gera randomBytes(32).toString("hex") = 64 chars hex (não UUID).
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "Invalid reset token format"),
  password: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(72),
  newPassword: PasswordSchema,
});

// BUG-I1: z.coerce.number() puro aceitava null→0, ""→0 e true→1 — corrida
// nascia na Ilha Nula (0,0), o motorista sumia do matching e o nearby
// consultava (0,lng) com 200. Só number finito ou string numérica não-vazia
// é coordenada válida.
function coordinateSchema(min: number, max: number, label: string) {
  return z
    .unknown()
    .refine(
      (v): v is number | string =>
        (typeof v === "number" && Number.isFinite(v)) ||
        (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))),
      `${label} must be a number`
    )
    .transform((v) => (typeof v === "string" ? Number(v.trim()) : v))
    .refine((v) => v >= min && v <= max, `${label} out of range`);
}

export const LatSchema = coordinateSchema(-90, 90, "Latitude");

export const LngSchema = coordinateSchema(-180, 180, "Longitude");

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



export const CancelRideSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});


// BUG-I2: z.coerce.date() NÃO ignora null (new Date(null) = 1970-01-01) —
// front-ends que mandam null em data vazia criavam campanha com janela já
// encerrada (cupom morto). null vira "campo ausente".
const OptionalDate = z.preprocess(
  (v) => (v === null ? undefined : v),
  z.coerce.date().optional()
);

export const CampaignSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.coerce.number().positive().max(100_000),
  targetType: z.enum(["ride", "user", "region", "category"]).optional(),
  targetValue: z.string().trim().max(100).optional(),
  maxUses: z.coerce.number().int().positive().optional(),
  startDate: OptionalDate,
  endDate: OptionalDate,
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
