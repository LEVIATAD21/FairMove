import { Router, type Request, type Response } from "express";
import { db, reserve_transactions, type Transaction } from "@fairmove/shared-db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireSelfOrRole } from "../../auth/src/middleware";
import { validateBody, ReserveOperationSchema } from "@fairmove/validation";
import { walletEngine } from "../../wallets/src/engine/wallet-engine";
import {
  reserveEngine,
  ReservePurposeError,
  ReserveLockedError,
  InsufficientReserveFundsError,
} from "./engine/reserve-engine";
import { InvalidAmountError, InsufficientFundsError } from "../../wallets/src/engine/wallet-engine";

const router = Router();

function handleError(res: Response, error: unknown): void {
  if (error instanceof ReservePurposeError || error instanceof InvalidAmountError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (
    error instanceof InsufficientFundsError ||
    error instanceof InsufficientReserveFundsError ||
    error instanceof ReserveLockedError
  ) {
    res.status(409).json({ error: error.message });
    return;
  }
  console.error("Reserve error:", error);
  res.status(500).json({ error: "Internal server error" });
}

function reserveResponse(reserve: {
  total_reserve: number;
  fuel_reserve: number;
  maintenance_reserve: number;
  accident_reserve: number;
  mechanical_reserve: number;
  period_without_work_reserve: number;
  emergency_usage: number;
  is_locked: boolean;
}) {
  return {
    totalReserve: Number(reserve.total_reserve),
    fuelReserve: Number(reserve.fuel_reserve),
    maintenanceReserve: Number(reserve.maintenance_reserve),
    accidentReserve: Number(reserve.accident_reserve),
    mechanicalReserve: Number(reserve.mechanical_reserve),
    periodWithoutWorkReserve: Number(reserve.period_without_work_reserve),
    emergencyReserve: Number(reserve.emergency_usage),
    isLocked: reserve.is_locked,
    currency: "BRL",
  };
}

// Get driver's emergency reserve (cria se não existir)
router.get(
  "/:driverId",
  requireAuth,
  requireSelfOrRole("driverId", "admin"),
  async (req: Request, res: Response) => {
    try {
      const { driverId } = req.params as { driverId: string };
      const reserve = await reserveEngine.initializeReserve(driverId);
      if (!reserve) {
        res.status(500).json({ error: "Could not initialize reserve" });
        return;
      }
      res.json(reserveResponse(reserve));
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Contribuir para a reserva (debita a carteira + atualiza os buckets)
router.post(
  "/:driverId/contribute",
  requireAuth,
  requireSelfOrRole("driverId", "admin"),
  validateBody(ReserveOperationSchema),
  async (req: Request, res: Response) => {
    try {
      const { driverId } = req.params as { driverId: string };
      const { amount, purpose } = req.body as { amount: number; purpose?: string };

      const cents = Math.round(amount * 100);

      const result = await db.transaction(async (tx: Transaction) => {
        const walletMove = await walletEngine.moveAvailableToReserveCents(
          driverId,
          cents,
          { description: `Reserve contribution (${purpose || "emergency"})` },
          tx
        );
        await reserveEngine.contributeToReserve(driverId, amount, purpose, tx);
        await reserveEngine.recordContribution(driverId, amount, purpose, tx, {
          ledgerTransactionId: walletMove.transactionId,
        });
        return walletMove;
      });

      const reserve = await reserveEngine.getReserve(driverId);

      res.status(201).json({
        transactionId: result.transactionId,
        newWalletReserveBalance: result.newReserveBalance,
        newWalletAvailableBalance: result.newAvailableBalance,
        reserve: reserve ? reserveResponse(reserve) : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Resgatar da reserva (devolve para o saldo disponível da carteira)
router.post(
  "/:driverId/payout",
  requireAuth,
  requireSelfOrRole("driverId", "admin"),
  validateBody(ReserveOperationSchema),
  async (req: Request, res: Response) => {
    try {
      const { driverId } = req.params as { driverId: string };
      const { amount, purpose } = req.body as { amount: number; purpose?: string };

      const cents = Math.round(amount * 100);

      const result = await db.transaction(async (tx: Transaction) => {
        // Validação de bucket/lock antes de mexer no dinheiro
        const updated = await reserveEngine.payoutFromReserve(driverId, amount, purpose, tx);
        const walletMove = await walletEngine.moveReserveToAvailableCents(
          driverId,
          cents,
          { description: `Reserve payout (${purpose || "emergency"})` },
          tx
        );
        return { updated, walletMove };
      });

      res.status(201).json({
        transactionId: result.walletMove.transactionId,
        newWalletReserveBalance: result.walletMove.newReserveBalance,
        newWalletAvailableBalance: result.walletMove.newAvailableBalance,
        reserve: result.updated ? reserveResponse(result.updated) : null,
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Histórico de movimentações da reserva
router.get(
  "/:driverId/transactions",
  requireAuth,
  requireSelfOrRole("driverId", "admin"),
  async (req: Request, res: Response) => {
    try {
      const { driverId } = req.params as { driverId: string };

      const reserve = await reserveEngine.getReserve(driverId);
      if (!reserve) {
        res.json({ transactions: [] });
        return;
      }

      const transactions = await db
        .select()
        .from(reserve_transactions)
        .where(eq(reserve_transactions.reserveId, reserve.id))
        .orderBy(desc(reserve_transactions.created_at))
        .limit(200);

      res.json({ transactions });
    } catch (error) {
      handleError(res, error);
    }
  }
);

export const reserveRouter = router;
