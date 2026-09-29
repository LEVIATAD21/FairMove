import { db, emergency_reserves, reserve_transactions, type Executor } from "@fairmove/shared-db";
import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

type Exec = Executor;

export type ReservePurpose =
  | "fuel"
  | "maintenance"
  | "accident"
  | "mechanical"
  | "period_without_work"
  | "emergency";

export const RESERVE_PURPOSES: ReservePurpose[] = [
  "fuel",
  "maintenance",
  "accident",
  "mechanical",
  "period_without_work",
  "emergency",
];

type BucketColumn =
  | "fuel_reserve"
  | "maintenance_reserve"
  | "accident_reserve"
  | "mechanical_reserve"
  | "period_without_work_reserve"
  | "emergency_usage";

/** Coluna do bucket correspondente a cada finalidade. */
const PURPOSE_COLUMN: Record<ReservePurpose, BucketColumn> = {
  fuel: "fuel_reserve",
  maintenance: "maintenance_reserve",
  accident: "accident_reserve",
  mechanical: "mechanical_reserve",
  period_without_work: "period_without_work_reserve",
  emergency: "emergency_usage",
};

export class ReservePurposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservePurposeError";
  }
}

export class ReserveLockedError extends Error {
  constructor() {
    super("Emergency reserve is locked");
    this.name = "ReserveLockedError";
  }
}

export class InsufficientReserveFundsError extends Error {
  constructor(purpose: string) {
    super(`Insufficient funds in "${purpose}" reserve bucket`);
    this.name = "InsufficientReserveFundsError";
  }
}

function normalizePurpose(purpose?: string): ReservePurpose {
  const normalized = (purpose || "emergency").trim().toLowerCase().replace(/\s+/g, "_");
  if ((RESERVE_PURPOSES as string[]).includes(normalized)) {
    return normalized as ReservePurpose;
  }
  // Sinônimos aceitos
  const aliases: Record<string, ReservePurpose> = {
    "period without work": "period_without_work",
    without_work: "period_without_work",
    no_work: "period_without_work",
  };
  if (aliases[normalized]) return aliases[normalized];
  throw new ReservePurposeError(
    `Unknown reserve purpose "${purpose}". Valid: ${RESERVE_PURPOSES.join(", ")}`
  );
}

/**
 * BUG-X1: a API era em "reais" — o caminho da mensalidade passava
 * `fee.reserveShare / 100` (centavos→reais) e este módulo reverte com
 * `toCents` (reais→centavos). Roundtrip era lossless, mas o contrato
 * "centavos vestidos de reais" é um footgun de 100x. Agora a engine é
 * NATIVA em centavos: a entrada já é o valor persistido.
 */
function assertCents(amountCents: number): number {
  if (
    typeof amountCents !== "number" ||
    !Number.isFinite(amountCents) ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new ReservePurposeError("Amount must be a positive integer number of cents");
  }
  return amountCents;
}

/**
 * Reserva de emergência do motorista.
 *
 * Invariante: `total_reserve` é sempre a soma dos buckets
 * (fuel + maintenance + accident + mechanical + period_without_work + emergency_usage).
 *
 * `driverId` armazena o **usuário** do motorista (users.id), o mesmo identificador
 * usado por carteiras e assinaturas.
 *
 * BUG-X9 (docs): **não existe `moveBetweenBuckets`** — movimentação entre
 * buckets só via SQL direto/UPGRADE. Motivo: cada bucket tem semântica
 * própria (emergency_usage é gasto; fuel/maintenance/etc. são reservas) e
 * aceitar transferir livremente permitiria usar "fuel" como giro de
 * "emergency". Se um dia precisar de transferência, ela deve nascer com
 * regra (ex.: só para o bucket de emergência, com ledger audit trail).
 */
export class ReserveEngine {
  async getReserve(driverUserId: string, exec: Exec = db) {
    const reserve = await exec
      .select()
      .from(emergency_reserves)
      .where(eq(emergency_reserves.driverId, driverUserId));
    return reserve.length > 0 ? reserve[0] : null;
  }

  async initializeReserve(driverUserId: string, exec: Exec = db) {
    const existing = await this.getReserve(driverUserId, exec);
    if (existing) return existing;

    try {
      const created = await exec
        .insert(emergency_reserves)
        .values({
          id: uuidv4(),
          driverId: driverUserId,
          total_reserve: 0,
          fuel_reserve: 0,
          maintenance_reserve: 0,
          accident_reserve: 0,
          mechanical_reserve: 0,
          period_without_work_reserve: 0,
          emergency_usage: 0,
          is_locked: false,
        })
        .returning();
      return created[0];
    } catch (error) {
      const again = await this.getReserve(driverUserId, exec);
      if (again) return again;
      throw error;
    }
  }

  /**
   * Contribui para a reserva (buckets).
   * Não move dinheiro da carteira — combine com `walletEngine` numa transação.
   * @param amountCents parcela em CENTAVOS (ex.: 4900 = R$49,00).
   */
  async contributeToReserve(
    driverUserId: string,
    amountCents: number,
    purpose?: string,
    exec: Exec = db
  ) {
    const cents = assertCents(amountCents);
    const bucket = PURPOSE_COLUMN[normalizePurpose(purpose)];

    await this.initializeReserve(driverUserId, exec);

    const patch: Record<string, unknown> = {
      total_reserve: sql`${emergency_reserves.total_reserve} + ${cents}`,
      updated_at: new Date(),
    };
    patch[bucket] = sql`${emergency_reserves[bucket]} + ${cents}`;

    await exec
      .update(emergency_reserves)
      .set(patch as Record<string, never>)
      .where(eq(emergency_reserves.driverId, driverUserId));

    return this.getReserve(driverUserId, exec);
  }

  /**
   * Resgata da reserva (buckets).
   * Não devolve dinheiro para a carteira — combine com `walletEngine`.
   */
  async payoutFromReserve(
    driverUserId: string,
    amountCents: number,
    purpose?: string,
    exec: Exec = db,
    options: { ledgerTransactionId?: string } = {}
  ) {
    const cents = assertCents(amountCents);
    const normalized = normalizePurpose(purpose);
    const bucket = PURPOSE_COLUMN[normalized];

    const reserve = await this.getReserve(driverUserId, exec);
    if (!reserve) {
      throw new InsufficientReserveFundsError(normalized);
    }
    if (reserve.is_locked) {
      throw new ReserveLockedError();
    }

    const bucketBalance = Number(
      reserve[bucket as keyof typeof reserve] as unknown as number
    );
    if (bucketBalance < cents) {
      throw new InsufficientReserveFundsError(normalized);
    }

    const patch: Record<string, unknown> = {
      total_reserve: sql`${emergency_reserves.total_reserve} - ${cents}`,
      updated_at: new Date(),
    };
    patch[bucket] = sql`${emergency_reserves[bucket]} - ${cents}`;

    await exec
      .update(emergency_reserves)
      .set(patch as Record<string, never>)
      .where(eq(emergency_reserves.driverId, driverUserId));

    const updated = await this.getReserve(driverUserId, exec);
    const reserveId = updated?.id ?? reserve.id;
    const transactionId = options.ledgerTransactionId ?? uuidv4();

    await exec.insert(reserve_transactions).values({
      id: uuidv4(),
      reserveId,
      transactionId,
      amount: cents,
      currency: "BRL",
      purpose: normalized,
      direction: "payout",
      status: "completed",
      description: `Reserve payout (${normalized})`,
    });

    return updated;
  }

  /** Registra uma contribuição no histórico (chame junto com o wallet move). */
  async recordContribution(
    driverUserId: string,
    amountCents: number,
    purpose: string | undefined,
    exec: Exec = db,
    options: { ledgerTransactionId?: string } = {}
  ) {
    const cents = assertCents(amountCents);
    const reserve = await this.getReserve(driverUserId, exec);
    const transactionId = options.ledgerTransactionId ?? uuidv4();

    await exec.insert(reserve_transactions).values({
      id: uuidv4(),
      reserveId: reserve?.id ?? uuidv4(),
      transactionId,
      amount: cents,
      currency: "BRL",
      purpose: normalizePurpose(purpose),
      direction: "contribution",
      status: "completed",
      description: "Reserve contribution",
    });
  }
}

export const reserveEngine = new ReserveEngine();
