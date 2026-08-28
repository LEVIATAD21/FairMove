import { Router } from "express";
import { db, wallets } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { walletEngine } from "./engine/wallet-engine";

const router = Router();

// Get user wallet
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };

    const wallet = await walletEngine.getWallet(userId);

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    return res.json({
      availableBalance: Number(wallet.available_balance),
      pendingBalance: Number(wallet.pending_balance),
      reserveBalance: Number(wallet.reserve_balance),
    });
  } catch (error) {
    console.error("Get wallet error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Credit wallet (example: from ride completion)
router.post("/:userId/credit", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await walletEngine.creditWallet(userId, amount, "credit");

    return res.json({
      transactionId: result.transactionId,
      entryId: result.entryId,
      newAvailableBalance: result.newAvailableBalance,
      newPendingBalance: result.newPendingBalance,
      newReserveBalance: result.newReserveBalance,
    });
  } catch (error) {
    console.error("Credit wallet error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Debit wallet (example: trip start)
router.post("/:userId/debit", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await walletEngine.creditWallet(userId, amount, "debit");

    return res.json({
      transactionId: result.transactionId,
      entryId: result.entryId,
      newAvailableBalance: result.newAvailableBalance,
      newPendingBalance: result.newPendingBalance,
      newReserveBalance: result.newReserveBalance,
    });
  } catch (error) {
    console.error("Debit wallet error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Contribute to reserve (from earnings)
router.post("/:userId/contribute-reserve", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const { amount, purpose } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await walletEngine.contributeToReserve(userId, amount, purpose || "emergency");

    return res.json({
      transactionId: result.transactionId,
      entryId: result.entryId,
      newReserveBalance: result.newReserveBalance,
    });
  } catch (error) {
    console.error("Contribute to reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Payout from reserve
router.post("/:userId/payout-reserve", async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const { amount, purpose } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const result = await walletEngine.payoutFromReserve(userId, amount, purpose || "emergency");

    return res.json({
      transactionId: result.transactionId,
      entryId: result.entryId,
      newReserveBalance: result.newReserveBalance,
      newAvailableBalance: result.newAvailableBalance,
    });
  } catch (error) {
    console.error("Payout from reserve error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const walletRouter = router;
