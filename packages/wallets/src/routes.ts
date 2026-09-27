import { Router, type Request, type Response, type NextFunction } from "express";
import { db, wallets, ledger_transactions, ledger_entries } from "@fairmove/shared-db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, requireSelfOrRole } from "../../auth/src/middleware";
import { validateBody, WalletOperationSchema, ReserveOperationSchema } from "@fairmove/validation";
import {
  walletEngine,
  InsufficientFundsError,
  InsufficientReserveError,
  InvalidAmountError,
  DuplicateOperationError,
} from "./engine/wallet-engine";

const router = Router();

function handleError(res: Response, error: unknown): void {
  if (error instanceof InsufficientFundsError || error instanceof InsufficientReserveError) {
    res.status(409).json({ error: error.message });
    return;
  }
  if (error instanceof InvalidAmountError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof DuplicateOperationError) {
    res.status(409).json({
      error: "Operation already processed",
      transactionId: error.existingTransactionId,
    });
    return;
  }
  console.error("Wallet error:", error);
  res.status(500).json({ error: "Internal server error" });
}

function walletResponse(wallet: {
  available_balance: number;
  pending_balance: number;
  reserve_balance: number;
  currency: string;
}) {
  return {
    availableBalance: Number(wallet.available_balance),
    pendingBalance: Number(wallet.pending_balance),
    reserveBalance: Number(wallet.reserve_balance),
    currency: wallet.currency,
  };
}

// Carteira do próprio usuário (cria automaticamente)
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const wallet = await walletEngine.ensureWallet(req.user!.id);
    res.json(walletResponse(wallet));
  } catch (error) {
    handleError(res, error);
  }
});

// Saldo resumido (alias da spec: GET /api/v1/wallets/me/balance)
router.get("/me/balance", requireAuth, async (req: Request, res: Response) => {
  try {
    const wallet = await walletEngine.ensureWallet(req.user!.id);
    res.json(walletResponse(wallet));
  } catch (error) {
    handleError(res, error);
  }
});

// Depósito — NÃO simula pagamento: sem gateway real configurado, 501 com docs.
router.post("/deposit", (_req: Request, res: Response) => {
  res.status(501).json({
    error: "payment_gateway_not_configured",
    message:
      "POST /api/v1/wallets/deposit exige um gateway de pagamento real (PIX via Pagar.me, Stripe ou similar). Enquanto não houver credenciais, o endpoint não credita saldo.",
    docs: {
      manual_credit:
        "Crédito manual (backoffice): POST /api/v1/wallets/:userId/credit — requer role=admin, passa pelo ledger de dupla entrada e aceita idempotencyKey.",
      required_env: ["PAGARME_API_KEY ou STRIPE_SECRET_KEY"],
      no_fake_data: "Nenhum saldo é criado por este endpoint sem liquidação real.",
    },
  });
});

// Carteira de um usuário específico (próprio usuário ou admin)
router.get("/:userId", requireAuth, requireSelfOrRole("userId", "admin"), async (req, res) => {
  try {
    const { userId } = req.params as { userId: string };
    const wallet = await walletEngine.ensureWallet(userId);
    res.json(walletResponse(wallet));
  } catch (error) {
    handleError(res, error);
  }
});

// Extrato de transações (próprio usuário ou admin)
router.get(
  "/:userId/transactions",
  requireAuth,
  requireSelfOrRole("userId", "admin"),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const wallet = await walletEngine.getWallet(userId);
      if (!wallet) {
        res.json({ transactions: [] });
        return;
      }

      const transactions = await db
        .select()
        .from(ledger_transactions)
        .where(eq(ledger_transactions.walletId, wallet.id))
        .limit(200);

      res.json({ transactions });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Extrato contábil (entradas do livro-razão)
router.get(
  "/:userId/entries",
  requireAuth,
  requireSelfOrRole("userId", "admin"),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const wallet = await walletEngine.getWallet(userId);
      if (!wallet) {
        res.json({ entries: [] });
        return;
      }

      const entries = await db
        .select()
        .from(ledger_entries)
        .where(eq(ledger_entries.walletId, wallet.id))
        .limit(500);

      res.json({ entries });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Crédito manual (operação de sistema/admin — não é exposto ao app do usuário)
router.post(
  "/:userId/credit",
  requireRole("admin"),
  validateBody(WalletOperationSchema),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { amount, description, idempotencyKey } = req.body as {
        amount: number;
        description?: string;
        idempotencyKey?: string;
      };

      const result = await walletEngine.creditWallet(userId, amount, "credit", {
        description,
        idempotencyKey,
      });

      res.status(201).json({
        transactionId: result.transactionId,
        entryId: result.entryId,
        newAvailableBalance: result.newAvailableBalance,
        newPendingBalance: result.newPendingBalance,
        newReserveBalance: result.newReserveBalance,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Débito manual (operação de sistema/admin)
router.post(
  "/:userId/debit",
  requireRole("admin"),
  validateBody(WalletOperationSchema),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { amount, description, idempotencyKey } = req.body as {
        amount: number;
        description?: string;
        idempotencyKey?: string;
      };

      const result = await walletEngine.creditWallet(userId, amount, "debit", {
        description,
        idempotencyKey,
      });

      res.status(201).json({
        transactionId: result.transactionId,
        entryId: result.entryId,
        newAvailableBalance: result.newAvailableBalance,
        newPendingBalance: result.newPendingBalance,
        newReserveBalance: result.newReserveBalance,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Contribuir para a reserva (parte do saldo disponível)
router.post(
  "/:userId/contribute-reserve",
  requireAuth,
  requireSelfOrRole("userId", "admin"),
  validateBody(ReserveOperationSchema),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { amount, purpose } = req.body as { amount: number; purpose?: string };

      const result = await walletEngine.contributeToReserve(userId, amount, purpose || "emergency");

      res.status(201).json({
        transactionId: result.transactionId,
        entryId: result.entryId,
        newReserveBalance: result.newReserveBalance,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Resgatar da reserva para o saldo disponível
router.post(
  "/:userId/payout-reserve",
  requireAuth,
  requireSelfOrRole("userId", "admin"),
  validateBody(ReserveOperationSchema),
  async (req, res) => {
    try {
      const { userId } = req.params as { userId: string };
      const { amount, purpose } = req.body as { amount: number; purpose?: string };

      const result = await walletEngine.payoutFromReserve(userId, amount, purpose || "emergency");

      res.status(201).json({
        transactionId: result.transactionId,
        entryId: result.entryId,
        newReserveBalance: result.newReserveBalance,
        newAvailableBalance: result.newAvailableBalance,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

export const walletRouter = router;
