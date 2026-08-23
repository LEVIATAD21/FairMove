import { Router } from "express";
import { subscriptionEngine } from "../engine/subscription-engine";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// Get user subscription
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await subscriptionEngine.getSubscription(userId);

    if (!subscription) {
      return res.json({ hasSubscription: false, status: "none" });
    }

    return res.json({
      hasSubscription: true,
      subscription,
    });
  } catch (error) {
    console.error("Get subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Activate subscription (trial)
router.post("/:userId/activate", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await subscriptionEngine.activateSubscription(userId);

    return res.json(result);
  } catch (error) {
    console.error("Activate subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel subscription
router.post("/:userId/cancel", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await subscriptionEngine.cancelSubscription(userId);

    return res.json(result);
  } catch (error) {
    console.error("Cancel subscription error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Check trial expiration
router.post("/:userId/trial-status", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await subscriptionEngine.checkTrialExpiration(userId);

    return res.json(result);
  } catch (error) {
    console.error("Check trial status error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Charge monthly fee
router.post("/:userId/charge", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await subscriptionEngine.chargeMonthlyFee(userId);

    return res.json(result);
  } catch (error) {
    console.error("Charge monthly fee error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const subscriptionRouter = router;