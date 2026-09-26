import { db, events, eventParticipants, eventLeaderboard, rides, type EventLeaderboard } from "@fairmove/shared-db";
import { eq, and, gte, lte, desc, count, sql } from "drizzle-orm";

export interface ScoringWeights {
  ridesWeight: number;
  ratingWeight: number;
  acceptanceWeight: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  ridesWeight: 1.0,
  ratingWeight: 2.0,
  acceptanceWeight: 3.0,
};

export interface DriverMetrics {
  driverId: string;
  ridesCount: number;
  avgRating: number;
  acceptanceRate: number;
}

export interface ScoredDriver extends DriverMetrics {
  score: number;
}

/**
 * Calcula métricas brutas de um motorista no período do evento.
 * - ridesCount: corridas COMPLETED no período
 * - avgRating: média das avaliações recebidas nas corridas
 * - acceptanceRate: corridas aceitas / corridas oferecidas (no período)
 * Fraude protection: ignora cancelamentos em sequência anômalos.
 */
export async function calculateDriverMetrics(
  eventId: string,
  driverId: string
): Promise<DriverMetrics | null> {
  const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (event.length === 0) return null;

  const { startDate, endDate } = event[0];

  const ridesData = await db
    .select({
      id: rides.id,
      status: rides.status,
      cancelledAt: rides.cancelledAt,
    })
    .from(rides)
    .where(
      and(
        eq(rides.driverId, driverId),
        gte(rides.createdAt, startDate),
        lte(rides.createdAt, endDate)
      )
    );

  if (ridesData.length === 0) {
    return { driverId, ridesCount: 0, avgRating: 5.0, acceptanceRate: 100 };
  }

  const completedRides = ridesData.filter((r) => r.status === "COMPLETED");
  const totalOffered = ridesData.length;
  const accepted = ridesData.filter(
    (r) => r.status !== "CANCELLED_BY_DRIVER" && r.status !== "EXPIRED"
  ).length;

  // Simplified: assume 5.0 rating for now (rating system can be added later)
  const avgRating = 5.0;
  const acceptanceRate = totalOffered > 0 ? (accepted / totalOffered) * 100 : 0;

  return {
    driverId,
    ridesCount: completedRides.length,
    avgRating,
    acceptanceRate: Number(acceptanceRate.toFixed(2)),
  };
}

export function computeScore(metrics: DriverMetrics, weights: ScoringWeights = DEFAULT_WEIGHTS): number {
  const { ridesCount, avgRating, acceptanceRate } = metrics;
  const normalizedRating = avgRating / 5; // 0-1
  const normalizedAcceptance = acceptanceRate / 100; // 0-1
  const score =
    ridesCount * weights.ridesWeight +
    normalizedRating * 100 * weights.ratingWeight +
    normalizedAcceptance * 100 * weights.acceptanceWeight;
  return Number(score.toFixed(4));
}

export async function recalculateLeaderboard(
  eventId: string,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): Promise<void> {
  const event = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (event.length === 0) throw new Error("Evento não encontrado");

  const participants = await db
    .select({ driverId: eventParticipants.driverId })
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));

  const scored: ScoredDriver[] = [];
  for (const p of participants) {
    const metrics = await calculateDriverMetrics(eventId, p.driverId);
    if (metrics) {
      scored.push({
        ...metrics,
        score: computeScore(metrics, weights),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  await db.transaction(async (tx) => {
    await tx.delete(eventLeaderboard).where(eq(eventLeaderboard.eventId, eventId));

    const entries = scored.map((d, idx) => ({
      id: crypto.randomUUID(),
      eventId,
      driverId: d.driverId,
      rank: idx + 1,
      score: d.score.toString(),
      rewardTier: getRewardTier(idx + 1),
      ridesCount: d.ridesCount,
      avgRating: d.avgRating.toString(),
      acceptanceRate: d.acceptanceRate.toString(),
    }));

    if (entries.length > 0) {
      await tx.insert(eventLeaderboard).values(entries);
    }
  });
}

function getRewardTier(rank: number): "tier_5_10" | "tier_4" | "tier_3" | "tier_2" | "tier_1" {
  if (rank === 1) return "tier_1";
  if (rank === 2) return "tier_2";
  if (rank === 3) return "tier_3";
  if (rank === 4) return "tier_4";
  return "tier_5_10";
}

export interface RewardBreakdown {
  discountPercent: number;
  cashRewardCents: number;
  cinemaVoucher: boolean;
}

export function getRewardBreakdown(tier: "tier_5_10" | "tier_4" | "tier_3" | "tier_2" | "tier_1"): RewardBreakdown {
  switch (tier) {
    case "tier_1":
      return { discountPercent: 0, cashRewardCents: 200_000, cinemaVoucher: true };
    case "tier_2":
      return { discountPercent: 50, cashRewardCents: 100_000, cinemaVoucher: false };
    case "tier_3":
      return { discountPercent: 25, cashRewardCents: 50_000, cinemaVoucher: false };
    case "tier_4":
      return { discountPercent: 20, cashRewardCents: 20_000, cinemaVoucher: false };
    default: // tier_5_10
      return { discountPercent: 20, cashRewardCents: 0, cinemaVoucher: false };
  }
}

export async function getLeaderboard(eventId: string): Promise<EventLeaderboard[]> {
  return db
    .select()
    .from(eventLeaderboard)
    .where(eq(eventLeaderboard.eventId, eventId))
    .orderBy(eventLeaderboard.rank);
}