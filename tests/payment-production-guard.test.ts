/**
 * Regression guard: a real production settlement must never fall through to
 * the in-memory card provider when wallet funds are insufficient.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  wallets,
  ledger_transactions,
  ledger_entries,
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import {
  PaymentProviderNotConfiguredError,
  settleRidePayment,
} from "../packages/payments/src/settlement";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("production payment-provider guard", () => {
  const passengerId = `it-psp-passenger-${randomUUID()}`;
  const driverId = `it-psp-driver-${randomUUID()}`;
  const rideId = randomUUID();

  beforeAll(async () => {
    await walletEngine.ensureWallet(passengerId);
    await walletEngine.ensureWallet(driverId);
  });

  afterAll(async () => {
    const walletRows = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(inArray(wallets.userId, [passengerId, driverId]));
    const walletIds = walletRows.map((row) => row.id);
    if (walletIds.length > 0) {
      await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
      await db.delete(ledger_transactions).where(inArray(ledger_transactions.walletId, walletIds));
      await db.delete(wallets).where(inArray(wallets.userId, [passengerId, driverId]));
    }
  });

  it("fails closed without moving money when a production card fallback is required", async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await expect(
        settleRidePayment({
          rideId,
          passengerId,
          driverUserId: driverId,
          fareCents: 1500,
          driverCreditCents: 1500,
        })
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredError);
    } finally {
      if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorNodeEnv;
    }

    expect(await walletEngine.getAvailableBalance(passengerId)).toBe(0);
    expect(await walletEngine.getAvailableBalance(driverId)).toBe(0);

    const passengerDebit = await db
      .select({ id: ledger_transactions.id })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.idempotencyKey, `ride:${rideId}:passenger-debit`));
    const driverCredit = await db
      .select({ id: ledger_transactions.id })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.idempotencyKey, `ride:${rideId}:driver-credit`));
    expect(passengerDebit).toHaveLength(0);
    expect(driverCredit).toHaveLength(0);
  });
});
