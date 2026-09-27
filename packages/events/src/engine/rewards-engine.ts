import {
  db,
  events,
  eventLeaderboard,
  eventRewards,
  rewardWalletTransactions,
  drivers,
  type EventReward,
  type Transaction,
} from "@fairmove/shared-db";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { walletEngine } from "../../../wallets/src/engine/wallet-engine";

/**
 * FairMove League — distribuição de recompensas.
 *
 * Tabela oficial da liga (centavos inteiros, valores exatos):
 *
 * | Posição | Dinheiro           | Cupom                          |
 * |---------|--------------------|--------------------------------|
 * | 1º      | R$ 2.000,00        | 4× Cinema FairMove             |
 * | 2º      | R$ 1.000,00        | 50% off por 2 meses            |
 * | 3º      | R$ 500,00          | 25% off por 2 meses            |
 * | 4º      | R$ 200,00          | 20% off                        |
 * | 5º–10º  | —                  | 20% off                        |
 *
 * Regras invariáveis:
 * - Prêmios em dinheiro entram em `wallet_balance` (saque livre) — NUNCA na
 *   Reserva de Disciplina e Emergência.
 * - Cupons de desconto valem apenas para a fatia da PLATAFORMA da mensalidade;
 *   a parcela da reserva jamais é reduzida.
 * - Toda movimentação de dinheiro ocorre dentro de `db.transaction()`.
 */

export type EventRewardType = "cash_prize" | "discount_coupon" | "cinema_voucher";

export interface RewardDefinition {
  rewardType: EventRewardType;
  /** Centavos creditados em `wallet_balance` (0 para cupons e vouchers). */
  rewardValueCents: number;
  /** Percentual (0–100) do cupom — apenas `discount_coupon`. */
  discountPercent?: number;
  /** Vigência do cupom em meses — apenas `discount_coupon`. */
  durationMonths?: number;
  /** Identificador estável do item na recompensa (para idempotência). */
  slug: string;
}

const CASH = (cents: number): RewardDefinition => ({
  rewardType: "cash_prize",
  rewardValueCents: cents,
  slug: "cash",
});
const COUPON = (percent: number, months: number): RewardDefinition => ({
  rewardType: "discount_coupon",
  rewardValueCents: 0,
  discountPercent: percent,
  durationMonths: months,
  slug: `coupon_${percent}pct`,
});
const CINEMA = (index: number): RewardDefinition => ({
  rewardType: "cinema_voucher",
  rewardValueCents: 0,
  slug: `cinema_${index}`,
});

/**
 * Retorna as recompensas de uma posição (1–10). Posições fora da tabela
 * não recebem nada (array vazio).
 */
export function buildEventRewards(rank: number): RewardDefinition[] {
  switch (rank) {
    case 1:
      return [
        CASH(200_000),
        CINEMA(1),
        CINEMA(2),
        CINEMA(3),
        CINEMA(4),
      ];
    case 2:
      return [CASH(100_000), COUPON(50, 2)];
    case 3:
      return [CASH(50_000), COUPON(25, 2)];
    case 4:
      return [CASH(20_000), COUPON(20, 1)];
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
    case 10:
      return [COUPON(20, 1)];
    default:
      return [];
  }
}

/** Soma total em dinheiro distribuída por evento (centavos): R$ 3.700,00. */
export function totalCashPrizeCents(): number {
  let total = 0;
  for (let rank = 1; rank <= 10; rank++) {
    for (const reward of buildEventRewards(rank)) {
      total += reward.rewardValueCents;
    }
  }
  return total;
}

export interface DistributedReward {
  id: string;
  eventId: string;
  driverId: string;
  rank: number;
  rewardType: EventRewardType;
  rewardValueCents: number;
  discountPercent: number | null;
  durationMonths: number | null;
}

/**
 * Distribui as recompensas do evento com base no leaderboard final.
 *
 * - Idempotente: se o evento já tem recompensas emitidas, retorna as existentes.
 * - Exige leaderboard calculado (senão lança erro — chame `recalculateLeaderboard`).
 * - Prêmios em dinheiro são creditados em `wallet_balance` (saque livre) dentro
 *   da MESMA transação que registra as linhas em `event_rewards` — nunca na
 *   Reserva de Disciplina e Emergência.
 */
export async function calculateEventRewards(eventId: string): Promise<DistributedReward[]> {
  const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (event.length === 0) throw new Error("Evento não encontrado");

  const existing = await db
    .select()
    .from(eventRewards)
    .where(eq(eventRewards.eventId, eventId))
    .orderBy(asc(eventRewards.rank));
  if (existing.length > 0) {
    return existing.map(toDistributed);
  }

  const leaderboard = await db
    .select()
    .from(eventLeaderboard)
    .where(eq(eventLeaderboard.eventId, eventId))
    .orderBy(asc(eventLeaderboard.rank));
  if (leaderboard.length === 0) {
    throw new Error("Leaderboard não calculado — execute recalculateLeaderboard antes");
  }

  // Mapa driverId → userId (a carteira opera por usuário, não por driver).
  const driverIds = leaderboard.filter((e) => e.rank <= 10).map((e) => e.driverId);
  const driverRows = driverIds.length
    ? await db.select({ id: drivers.id, userId: drivers.userId }).from(drivers)
    : [];
  const driverUserIds = new Map(driverRows.map((d) => [d.id, d.userId]));

  const distributed: DistributedReward[] = [];

  await db.transaction(async (tx: Transaction) => {
    for (const entry of leaderboard) {
      if (entry.rank > 10) continue;

      const rewards = buildEventRewards(entry.rank);
      if (rewards.length === 0) continue;

      for (const reward of rewards) {
        const id = uuidv4();
        const idempotencyKey = `event-reward:${eventId}:${entry.driverId}:${entry.rank}:${reward.slug}`;

        await tx.insert(eventRewards).values({
          id,
          eventId,
          driverId: entry.driverId,
          rank: entry.rank,
          rewardType: reward.rewardType,
          rewardValueCents: reward.rewardValueCents,
          discountPercent: reward.discountPercent ?? null,
          durationMonths: reward.durationMonths ?? null,
          status: reward.rewardType === "cash_prize" ? "credited" : "pending",
          idempotencyKey,
        });

        // Dinheiro → wallet_balance (saque livre). NUNCA discipline reserve.
        if (reward.rewardType === "cash_prize" && reward.rewardValueCents > 0) {
          const userId = driverUserIds.get(entry.driverId);
          if (!userId) throw new Error(`Motorista ${entry.driverId} sem usuário vinculado`);

          await walletEngine.creditCents(
            userId,
            reward.rewardValueCents,
            {
              idempotencyKey: `${idempotencyKey}:wallet`,
              description: `Prêmio FairMove League — ${event[0].title} (${entry.rank}º lugar)`,
              metadata: { eventId, driverId: entry.driverId, rank: entry.rank },
            },
            tx
          );

          await tx.insert(rewardWalletTransactions).values({
            id: uuidv4(),
            driverId: entry.driverId,
            eventId,
            type: "credit",
            amount: reward.rewardValueCents,
            currency: "BRL",
            description: `Prêmio em dinheiro — ${entry.rank}º lugar (saque livre)`,
            status: "completed",
            idempotencyKey: `${idempotencyKey}:ledger`,
          });
        }

        distributed.push({
          id,
          eventId,
          driverId: entry.driverId,
          rank: entry.rank,
          rewardType: reward.rewardType,
          rewardValueCents: reward.rewardValueCents,
          discountPercent: reward.discountPercent ?? null,
          durationMonths: reward.durationMonths ?? null,
        });
      }
    }
  });

  return distributed;
}

/**
 * Maior cupom de desconto vigente do motorista (0–100). Considera a vigência
 * `durationMonths` a partir da emissão. Base do cálculo da mensalidade
 * (somente fatia da plataforma).
 */
export async function getActiveDriverDiscountPercent(
  driverId: string,
  now: Date = new Date()
): Promise<number> {
  const coupons = await db
    .select()
    .from(eventRewards)
    .where(and(eq(eventRewards.driverId, driverId), eq(eventRewards.rewardType, "discount_coupon")));

  let best = 0;
  for (const coupon of coupons) {
    const issuedAt = new Date(coupon.createdAt);
    const expiresAt = new Date(issuedAt);
    expiresAt.setMonth(expiresAt.getMonth() + (coupon.durationMonths ?? 1));
    if (now >= issuedAt && now < expiresAt) {
      best = Math.max(best, coupon.discountPercent ?? 0);
    }
  }
  return best;
}

function toDistributed(row: EventReward): DistributedReward {
  return {
    id: row.id,
    eventId: row.eventId,
    driverId: row.driverId,
    rank: row.rank,
    rewardType: row.rewardType as EventRewardType,
    rewardValueCents: row.rewardValueCents,
    discountPercent: row.discountPercent,
    durationMonths: row.durationMonths,
  };
}
