import { db, ledger_transactions, type Transaction } from "@fairmove/shared-db";
import { sql } from "drizzle-orm";
import {
  walletEngine,
  InsufficientFundsError,
} from "../../wallets/src/engine/wallet-engine";
import { paymentProvider } from "./index";

export interface RideSettlementInput {
  rideId: string;
  /** userId do passageiro (pagador). */
  passengerId: string;
  /** userId do motorista (recebedor). */
  driverUserId: string;
  /** Valor cobrado do passageiro, em centavos. */
  fareCents: number;
  /** Valor creditado ao motorista, em centavos. */
  driverCreditCents: number;
}

export interface RideSettlementResult {
  paymentMethod: "wallet" | "card";
  alreadySettled: boolean;
  passengerTransactionId?: string;
  cardTransactionId?: string;
  driverTransactionId: string;
  passengerDebitedCents: number;
  driverCreditedCents: number;
}

async function existsIdempotencyKey(key: string): Promise<boolean> {
  const rows = await db
    .select({ id: ledger_transactions.id })
    .from(ledger_transactions)
    .where(sql`${ledger_transactions.idempotencyKey} = ${key}`)
    .limit(1);
  return rows.length > 0;
}

/**
 * Liquida o pagamento de uma corrida concluída:
 *
 * 1. debita o passageiro pela carteira quando há saldo;
 * 2. caso contrário, cobra no cartão (provedor de pagamento);
 * 3. credita o motorista pelo valor líquido (`driverCreditCents`);
 * 4. tudo é idempotente por corrida (chaves `ride:<id>:*`).
 */
export async function settleRidePayment(
  input: RideSettlementInput
): Promise<RideSettlementResult> {
  const driverKey = `ride:${input.rideId}:driver-credit`;

  // Já liquidada? (retry seguro)
  if (await existsIdempotencyKey(driverKey)) {
    const existing = await db
      .select({ id: ledger_transactions.id, metadata: ledger_transactions.metadata })
      .from(ledger_transactions)
      .where(sql`${ledger_transactions.idempotencyKey} = ${driverKey}`)
      .limit(1);

    let paymentMethod: "wallet" | "card" = "wallet";
    if (existing.length > 0 && existing[0].metadata) {
      try {
        const meta = JSON.parse(existing[0].metadata);
        if (meta?.paymentMethod === "card") paymentMethod = "card";
      } catch {
        // metadata ilegível — mantém o padrão
      }
    }

    return {
      paymentMethod,
      alreadySettled: true,
      driverTransactionId: existing[0]?.id ?? "",
      passengerDebitedCents: input.fareCents,
      driverCreditedCents: input.driverCreditCents,
    };
  }

  const passengerKey = `ride:${input.rideId}:passenger-debit`;

  // 1) Tenta saldo em carteira
  try {
    return await db.transaction(async (tx: Transaction) => {
      const passengerDebit = await walletEngine.debitCents(
        input.passengerId,
        input.fareCents,
        {
          idempotencyKey: passengerKey,
          description: `Ride payment ${input.rideId}`,
          metadata: { rideId: input.rideId },
        },
        tx
      );

      const driverCredit = await walletEngine.creditCents(
        input.driverUserId,
        input.driverCreditCents,
        {
          idempotencyKey: driverKey,
          description: `Ride earning ${input.rideId}`,
          metadata: { rideId: input.rideId, paymentMethod: "wallet" },
        },
        tx
      );

      return {
        paymentMethod: "wallet" as const,
        alreadySettled: false,
        passengerTransactionId: passengerDebit.transactionId,
        driverTransactionId: driverCredit.transactionId,
        passengerDebitedCents: input.fareCents,
        driverCreditedCents: input.driverCreditCents,
      };
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      // 2) Sem saldo: cobra no cartão (provedor)
      const authorized = await paymentProvider.authorize(input.fareCents / 100, "BRL", {
        rideId: input.rideId,
        passengerId: input.passengerId,
      });
      if (authorized.status !== "authorized") {
        throw new Error(authorized.error || "Payment authorization failed");
      }

      const captured = await paymentProvider.capture(authorized.transactionId, input.fareCents / 100);
      if (captured.status !== "captured") {
        throw new Error(captured.error || "Payment capture failed");
      }

      // 3) Crédito do motorista
      const driverCredit = await db.transaction(async (tx: Transaction) =>
        walletEngine.creditCents(
          input.driverUserId,
          input.driverCreditCents,
          {
            idempotencyKey: driverKey,
            description: `Ride earning ${input.rideId}`,
            metadata: { rideId: input.rideId, paymentMethod: "card" },
          },
          tx
        )
      );

      return {
        paymentMethod: "card" as const,
        alreadySettled: false,
        cardTransactionId: authorized.transactionId,
        driverTransactionId: driverCredit.transactionId,
        passengerDebitedCents: input.fareCents,
        driverCreditedCents: input.driverCreditCents,
      };
    }
    throw error;
  }
}
