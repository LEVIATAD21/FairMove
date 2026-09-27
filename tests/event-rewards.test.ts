import fc from "fast-check";
import {
  buildEventRewards,
  totalCashPrizeCents,
  type RewardDefinition,
} from "../packages/events/src/engine/rewards-engine";

const validTypes = new Set(["cash_prize", "discount_coupon", "cinema_voucher"]);

describe("FairMove League — tabela oficial de recompensas", () => {
  test("1º lugar: R$ 2.000 + 4× Cinema FairMove", () => {
    const rewards = buildEventRewards(1);
    const cash = rewards.filter((r) => r.rewardType === "cash_prize");
    const cinema = rewards.filter((r) => r.rewardType === "cinema_voucher");

    expect(cash).toHaveLength(1);
    expect(cash[0].rewardValueCents).toBe(200_000);
    expect(cinema).toHaveLength(4);
    expect(cinema.every((c) => c.rewardValueCents === 0)).toBe(true);
  });

  test("2º lugar: R$ 1.000 + cupom 50% por 2 meses", () => {
    const rewards = buildEventRewards(2);
    const cash = rewards.find((r) => r.rewardType === "cash_prize");
    const coupon = rewards.find((r) => r.rewardType === "discount_coupon");

    expect(cash?.rewardValueCents).toBe(100_000);
    expect(coupon?.discountPercent).toBe(50);
    expect(coupon?.durationMonths).toBe(2);
  });

  test("3º lugar: R$ 500 + cupom 25% por 2 meses", () => {
    const rewards = buildEventRewards(3);
    expect(rewards.find((r) => r.rewardType === "cash_prize")?.rewardValueCents).toBe(50_000);
    const coupon = rewards.find((r) => r.rewardType === "discount_coupon");
    expect(coupon?.discountPercent).toBe(25);
    expect(coupon?.durationMonths).toBe(2);
  });

  test("4º lugar: R$ 200 + cupom 20%", () => {
    const rewards = buildEventRewards(4);
    expect(rewards.find((r) => r.rewardType === "cash_prize")?.rewardValueCents).toBe(20_000);
    expect(rewards.find((r) => r.rewardType === "discount_coupon")?.discountPercent).toBe(20);
  });

  test("5º ao 10º: apenas cupom 20%", () => {
    for (let rank = 5; rank <= 10; rank++) {
      const rewards = buildEventRewards(rank);
      expect(rewards).toHaveLength(1);
      expect(rewards[0].rewardType).toBe("discount_coupon");
      expect(rewards[0].discountPercent).toBe(20);
      expect(rewards[0].durationMonths).toBe(1);
      expect(rewards[0].rewardValueCents).toBe(0);
    }
  });

  test("posições fora do top-10 não recebem nada", () => {
    expect(buildEventRewards(11)).toEqual([]);
    expect(buildEventRewards(99)).toEqual([]);
    expect(buildEventRewards(0)).toEqual([]);
  });

  test("total distribuído em dinheiro: R$ 3.700,00", () => {
    expect(totalCashPrizeCents()).toBe(370_000);
  });

  test("cupons nunca possuem valor em dinheiro (0 centavos)", () => {
    for (let rank = 1; rank <= 10; rank++) {
      for (const reward of buildEventRewards(rank)) {
        if (reward.rewardType !== "cash_prize") {
          expect(reward.rewardValueCents).toBe(0);
        }
      }
    }
  });
});

describe("FairMove League — propriedades (10.000 combinações)", () => {
  const rankArb = fc.integer({ min: 1, max: 12 });

  test("recompensas sempre têm valores inteiros e não negativos", () => {
    fc.assert(
      fc.property(rankArb, (rank) => {
        for (const reward of buildEventRewards(rank)) {
          expect(Number.isInteger(reward.rewardValueCents)).toBe(true);
          expect(reward.rewardValueCents).toBeGreaterThanOrEqual(0);
          expect(validTypes.has(reward.rewardType)).toBe(true);
          if (reward.rewardType === "discount_coupon") {
            expect(reward.discountPercent).toBeGreaterThanOrEqual(1);
            expect(reward.discountPercent).toBeLessThanOrEqual(100);
            expect(reward.durationMonths).toBeGreaterThanOrEqual(1);
          }
        }
      }),
      { numRuns: 10_000 }
    );
  });

  test("total de dinheiro é monótono não decrescente por posição (somatório do top-N)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (topN) => {
        const sum = (n: number) => {
          let total = 0;
          for (let r = 1; r <= n; r++) {
            for (const reward of buildEventRewards(r)) total += reward.rewardValueCents;
          }
          return total;
        };
        expect(sum(topN)).toBeLessThanOrEqual(sum(10));
        if (topN > 1) expect(sum(topN)).toBeGreaterThanOrEqual(sum(topN - 1));
      }),
      { numRuns: 10_000 }
    );
  });

  test("slugs de recompensa são únicos dentro de uma posição (idempotência)", () => {
    fc.assert(
      fc.property(rankArb, (rank) => {
        const rewards = buildEventRewards(rank);
        const slugs = rewards.map((r: RewardDefinition) => r.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      }),
      { numRuns: 10_000 }
    );
  });
});
