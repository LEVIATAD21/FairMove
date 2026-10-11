import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../../auth/src/middleware";
import { validateBody } from "@fairmove/validation";
import { MockPaymentProvider } from "./index";

const router = Router();
const paymentProvider = new MockPaymentProvider();

// ---------------------------------------------------------------------------
// Segurança: o adaptador abaixo é simulado e guarda transações apenas em memória.
// Nunca permitir que ele autorize/capture/refunde em produção: responder 503 até
// um PSP real, persistente e verificado por webhook ser configurado.
// ---------------------------------------------------------------------------
router.use((req: Request, res: Response, next) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(503).json({ error: "payment_provider_not_configured" });
  }
  return requireRole("admin")(req, res, next);
});

const AuthorizeSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  currency: z.string().length(3).default("BRL"),
  driverId: z.string().trim().min(1).max(64),
  rideId: z.string().uuid().optional(),
});

const TransactionRefSchema = z.object({
  transactionId: z.string().trim().min(1).max(128),
});

const CaptureSchema = TransactionRefSchema.extend({
  amount: z.number().positive().max(1_000_000_000).optional(),
});

// Authorize payment
router.post("/authorize", validateBody(AuthorizeSchema), async (req, res) => {
  try {
    const { amount, currency, driverId, rideId } = req.body as z.infer<typeof AuthorizeSchema>;

    const result = await paymentProvider.authorize(amount, currency, { driverId, rideId });

    return res.json(result);
  } catch (error) {
    console.error("Authorize payment error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Capture payment
router.post("/capture", validateBody(CaptureSchema), async (req, res) => {
  try {
    const { transactionId, amount } = req.body as z.infer<typeof CaptureSchema>;

    const result = await paymentProvider.capture(transactionId, amount);

    return res.json(result);
  } catch (error) {
    console.error("Capture payment error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Refund payment
router.post("/refund", validateBody(TransactionRefSchema), async (req, res) => {
  try {
    const { transactionId } = req.body as z.infer<typeof TransactionRefSchema>;

    const result = await paymentProvider.refund(transactionId);

    return res.json(result);
  } catch (error) {
    console.error("Refund payment error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get payment status (consulta de estorno não pode ser oráculo anônimo)
router.post("/status", validateBody(TransactionRefSchema), async (req, res) => {
  try {
    const { transactionId } = req.body as z.infer<typeof TransactionRefSchema>;

    const result = await paymentProvider.getStatus(transactionId);

    return res.json(result);
  } catch (error) {
    console.error("Get payment status error:", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const paymentRouter = router;
