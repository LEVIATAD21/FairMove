import { Router, type Request, type Response, type NextFunction } from "express";
import { db, users, wallets, ledger_transactions, ledger_entries, walletDeposits } from "@fairmove/shared-db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createPixDeposit, isMercadoPagoConfigured, MercadoPagoNotConfiguredError, MercadoPagoRequestError, processMercadoPagoPaymentWebhook, WalletDepositConflictError } from "../../payments/src/mercado-pago";
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

const PixDepositSchema = z.object({
  amount: z.number().min(5).max(5000).multipleOf(0.01),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
  payerCpf: z.string().min(11).max(14),
});

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
  console.error("Wallet error:", error instanceof Error ? (error.stack ?? error.message) : String(error));
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

function depositPayload(deposit: typeof walletDeposits.$inferSelect) {
  return {
    depositId: deposit.id,
    amountCents: deposit.amountCents,
    currency: "BRL",
    status: deposit.status,
    qrCode: deposit.qrCode,
    qrCodeBase64: deposit.qrCodeBase64,
    ticketUrl: deposit.ticketUrl,
    expiresAt: deposit.expiresAt?.toISOString() ?? null,
  };
}

// Recupera somente o último depósito pertencente à própria conta autenticada.
router.get("/deposits/latest", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(walletDeposits)
      .where(eq(walletDeposits.userId, req.user!.id))
      .orderBy(desc(walletDeposits.createdAt))
      .limit(1);
    return res.json(rows[0] ? depositPayload(rows[0]) : null);
  } catch (error) {
    handleError(res, error);
  }
});

// Atualiza o status de um Pix consultando o PSP; nunca confia em estado vindo do app.
router.post("/deposits/:depositId/refresh", requireAuth, async (req: Request, res: Response) => {
  try {
    const depositId = String(req.params.depositId ?? "");
    const rows = await db
      .select()
      .from(walletDeposits)
      .where(and(eq(walletDeposits.id, depositId), eq(walletDeposits.userId, req.user!.id)))
      .limit(1);
    const current = rows[0];
    if (!current) return res.status(404).json({ error: "deposit_not_found" });

    if (current.status === "pending" && current.providerPaymentId) {
      if (!isMercadoPagoConfigured()) {
        return res.status(503).json({ error: "payment_gateway_not_configured" });
      }
      await processMercadoPagoPaymentWebhook(current.providerPaymentId);
    }

    const updated = await db
      .select()
      .from(walletDeposits)
      .where(and(eq(walletDeposits.id, depositId), eq(walletDeposits.userId, req.user!.id)))
      .limit(1);
    return res.json(updated[0] ? depositPayload(updated[0]) : { error: "deposit_not_found" });
  } catch (error) {
    if (error instanceof MercadoPagoNotConfiguredError) {
      return res.status(503).json({ error: "payment_gateway_not_configured" });
    }
    if (error instanceof MercadoPagoRequestError) {
      return res.status(502).json({ error: "payment_provider_unavailable" });
    }
    handleError(res, error);
  }
});

// Depósito real via Pix. A carteira só é creditada pelo webhook assinado do PSP.
router.post(
  "/deposit",
  requireAuth,
  validateBody(PixDepositSchema),
  async (req: Request, res: Response) => {
    try {
      // Mesmo com o Pix de entrada implementado, não aceitamos dinheiro em
      // produção até existir um saque/liquidação real e validada para motoristas.
      // Isso evita acumular saldo de terceiros sem um caminho de pagamento.
      if (process.env.NODE_ENV === "production") {
        return res.status(503).json({
          error: "driver_payouts_not_configured",
          message: "Recargas ficam indisponíveis até o fluxo real de saque/liquidação para motoristas estar configurado e verificado.",
        });
      }

      const userId = req.user!.id;
      const accountRows = await db
        .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const account = accountRows[0];
      if (!account) return res.status(401).json({ error: "invalid_session" });
      if (process.env.NODE_ENV === "production" && !account.emailVerifiedAt) {
        return res.status(403).json({ error: "email_verification_required" });
      }

      const { amount, idempotencyKey, payerCpf } = req.body as z.infer<typeof PixDepositSchema>;
      const deposit = await createPixDeposit({
        userId,
        payerEmail: account.email,
        payerCpf,
        amountCents: Math.round(amount * 100),
        idempotencyKey,
      });
      return res.status(200).json(deposit);
    } catch (error) {
      if (error instanceof MercadoPagoNotConfiguredError) {
        return res.status(503).json({ error: "payment_gateway_not_configured" });
      }
      if (error instanceof WalletDepositConflictError) {
        return res.status(409).json({ error: "idempotency_key_conflict" });
      }
      if (error instanceof RangeError || error instanceof TypeError) {
        return res.status(400).json({ error: "invalid_deposit_request" });
      }
      if (error instanceof MercadoPagoRequestError) {
        return res.status(502).json({ error: "payment_provider_unavailable" });
      }
      handleError(res, error);
      return;
    }
  }
);

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

      // BUG-X10: consulta encapsulada no engine (ordenação H1 preservada lá).
      const transactions = await walletEngine.getTransactionHistory(userId, 200);

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
        // BUG-H1: mesmo problema das transactions — janela arbitrária.
        .orderBy(desc(ledger_entries.created_at), desc(ledger_entries.id))
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
