import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../../auth/src/middleware";
import { validateBody } from "@fairmove/validation";
import { MockPaymentProvider } from "./index";

const router = Router();
const paymentProvider = new MockPaymentProvider();

// ---------------------------------------------------------------------------
// Autorização: apenas operação interna (admin). O gateway movimenta dinheiro —
// sem requireRole qualquer conta autenticada (ou anônima) capturava/reembolsava.
// ---------------------------------------------------------------------------
router.use(requireRole("admin"));

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
