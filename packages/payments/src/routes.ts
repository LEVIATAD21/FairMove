import { Router } from "express";
import { MockPaymentProvider } from "./index";

const router = Router();
const paymentProvider = new MockPaymentProvider();

// Authorize payment
router.post("/authorize", async (req, res) => {
  try {
    const { amount, currency, driverId, rideId } = req.body;

    if (!amount || !driverId) {
      return res.status(400).json({ error: "Amount and driver ID are required" });
    }

    const result = await paymentProvider.authorize(
      amount,
      currency || "BRL",
      { driverId, rideId }
    );

    return res.json(result);
  } catch (error) {
    console.error("Authorize payment error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Capture payment
router.post("/capture", async (req, res) => {
  try {
    const { transactionId, amount } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    const result = await paymentProvider.capture(transactionId, amount);

    return res.json(result);
  } catch (error) {
    console.error("Capture payment error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Refund payment
router.post("/refund", async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    const result = await paymentProvider.refund(transactionId);

    return res.json(result);
  } catch (error) {
    console.error("Refund payment error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get payment status
router.post("/status", async (req, res) => {
  try {
    const { transactionId } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    const result = await paymentProvider.getStatus(transactionId);

    return res.json(result);
  } catch (error) {
    console.error("Get payment status error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const paymentRouter = router;
