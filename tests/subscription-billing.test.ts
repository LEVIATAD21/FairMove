import fc from "fast-check";
import {
  calculateMonthlyFee,
  resolveMonthsActive,
  SUBSCRIPTION_FEES,
  MONTHLY_FEE_CAP_CENTS,
  OPT_OUT_FEE_CENTS,
} from "../packages/subscriptions/src/engine/billing-calculator";

/** Entradas cobertas pelo property test: meses (inclusive inválidos) × flag. */
const billingState = () =>
  fc.record({
    monthsActive: fc.integer({ min: -50, max: 1_200 }),
    optedOutOfReserve: fc.boolean(),
  });

describe("calculateMonthlyFee — regras fixas", () => {
  test("mês 1 é trial: tudo zerado, mesmo com opt-out sinalizado", () => {
    expect(calculateMonthlyFee({ monthsActive: 1, optedOutOfReserve: false })).toEqual({
      totalFee: 0,
      platformShare: 0,
      reserveShare: 0,
      tier: "trial",
    });
    expect(calculateMonthlyFee({ monthsActive: 1, optedOutOfReserve: true }).totalFee).toBe(0);
  });

  test("mês 2: R$100 → R$51 plataforma + R$49 reserva", () => {
    expect(calculateMonthlyFee({ monthsActive: 2, optedOutOfReserve: false })).toEqual({
      totalFee: 10_000,
      platformShare: 5_100,
      reserveShare: 4_900,
      tier: "standard",
    });
  });

  test("mês 3 em diante: teto de R$200 → R$130 plataforma + R$70 reserva", () => {
    for (const monthsActive of [3, 4, 12, 120, 1_200]) {
      expect(calculateMonthlyFee({ monthsActive, optedOutOfReserve: false })).toEqual({
        totalFee: 20_000,
        platformShare: 13_000,
        reserveShare: 7_000,
        tier: "full",
      });
    }
  });

  test("opt-out a partir do mês 2: R$150 fixos só para a plataforma", () => {
    for (const monthsActive of [2, 3, 4, 60, 1_200]) {
      expect(calculateMonthlyFee({ monthsActive, optedOutOfReserve: true })).toEqual({
        totalFee: 15_000,
        platformShare: 15_000,
        reserveShare: 0,
        tier: "optOut",
      });
    }
  });

  test("entradas inválidas caem no trial (mês 1)", () => {
    for (const monthsActive of [0, -7, Number.NaN, Number.POSITIVE_INFINITY, 1.9]) {
      expect(calculateMonthlyFee({ monthsActive, optedOutOfReserve: false }).tier).toBe("trial");
    }
    expect(calculateMonthlyFee({ monthsActive: 2.9, optedOutOfReserve: false }).tier).toBe(
      "standard"
    );
  });

  test("as taxas declaradas batem com os valores em centavos das regras", () => {
    expect(SUBSCRIPTION_FEES.trial).toMatchObject({ totalFee: 0, platformShare: 0, reserveShare: 0 });
    expect(SUBSCRIPTION_FEES.standard).toMatchObject({
      totalFee: 10_000,
      platformShare: 5_100,
      reserveShare: 4_900,
    });
    expect(SUBSCRIPTION_FEES.full).toMatchObject({
      totalFee: 20_000,
      platformShare: 13_000,
      reserveShare: 7_000,
    });
    expect(SUBSCRIPTION_FEES.optOut).toMatchObject({
      totalFee: 15_000,
      platformShare: 15_000,
      reserveShare: 0,
    });
    expect(MONTHLY_FEE_CAP_CENTS).toBe(20_000);
    expect(OPT_OUT_FEE_CENTS).toBe(15_000);
  });
});

describe("calculateMonthlyFee — property-based (10.000 combinações)", () => {
  test("split sempre fecha: platformShare + reserveShare === totalFee", () => {
    fc.assert(
      fc.property(billingState(), (state) => {
        const fee = calculateMonthlyFee(state);
        expect(fee.platformShare + fee.reserveShare).toBe(fee.totalFee);
      }),
      { numRuns: 10_000 }
    );
  });

  test("valores sempre são centavos inteiros não negativos", () => {
    fc.assert(
      fc.property(billingState(), (state) => {
        const fee = calculateMonthlyFee(state);
        for (const value of [fee.totalFee, fee.platformShare, fee.reserveShare]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 10_000 }
    );
  });

  test("a taxa nunca excede o teto de R$200", () => {
    fc.assert(
      fc.property(billingState(), (state) => {
        expect(calculateMonthlyFee(state).totalFee).toBeLessThanOrEqual(MONTHLY_FEE_CAP_CENTS);
      }),
      { numRuns: 10_000 }
    );
  });

  test("com opt-out (mês ≥ 2): R$150 para a plataforma e nada na reserva", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1_200 }),
        fc.boolean(),
        (monthsActive, optedOutOfReserve) => {
          const fee = calculateMonthlyFee({ monthsActive, optedOutOfReserve });
          if (optedOutOfReserve) {
            expect(fee).toMatchObject({ totalFee: 15_000, platformShare: 15_000, reserveShare: 0 });
          } else if (monthsActive === 2) {
            expect(fee).toMatchObject({ totalFee: 10_000, platformShare: 5_100, reserveShare: 4_900 });
          } else {
            expect(fee).toMatchObject({ totalFee: 20_000, platformShare: 13_000, reserveShare: 7_000 });
          }
        }
      ),
      { numRuns: 10_000 }
    );
  });

  test("determinística: mesma entrada ⇒ mesma saída", () => {
    fc.assert(
      fc.property(billingState(), (state) => {
        expect(calculateMonthlyFee(state)).toEqual(calculateMonthlyFee(state));
      }),
      { numRuns: 10_000 }
    );
  });
});

describe("resolveMonthsActive", () => {
  const start = new Date("2026-01-15T12:00:00");

  test("sem aprovação retorna 0 (ciclo não começou)", () => {
    expect(resolveMonthsActive(null)).toBe(0);
    expect(resolveMonthsActive(undefined)).toBe(0);
    expect(resolveMonthsActive("data-invalida")).toBe(0);
  });

  test("primeiro mês é o trial", () => {
    expect(resolveMonthsActive(start, new Date("2026-01-15T13:00:00"))).toBe(1);
    expect(resolveMonthsActive(start, new Date("2026-02-14T13:00:00"))).toBe(1);
  });

  test("avança um mês a cada mês civil completo", () => {
    expect(resolveMonthsActive(start, new Date("2026-02-15T13:00:00"))).toBe(2);
    expect(resolveMonthsActive(start, new Date("2026-03-15T13:00:00"))).toBe(3);
    expect(resolveMonthsActive(start, new Date("2027-01-15T13:00:00"))).toBe(13);
  });

  test("aprovação no futuro não gera ciclo negativo", () => {
    expect(resolveMonthsActive(new Date("2026-12-01T00:00:00"), new Date("2026-01-01T00:00:00"))).toBe(0);
  });

  test("aceita string ISO", () => {
    expect(resolveMonthsActive("2026-01-15T12:00:00", new Date("2026-03-15T13:00:00"))).toBe(3);
  });
});

describe("calculateMonthlyFee — cupom FairMove League (só fatia da plataforma)", () => {
  const couponState = () =>
    fc.record({
      monthsActive: fc.integer({ min: 2, max: 1_200 }),
      optedOutOfReserve: fc.boolean(),
      discountPercent: fc.float({ min: 0, max: 100, noNaN: true }),
    });

  test("cupom nunca reduz a parcela da reserva", () => {
    fc.assert(
      fc.property(couponState(), (state) => {
        const withoutCoupon = calculateMonthlyFee({ ...state, discountPercent: 0 });
        const withCoupon = calculateMonthlyFee(state);
        expect(withCoupon.reserveShare).toBe(withoutCoupon.reserveShare);
      }),
      { numRuns: 10_000 }
    );
  });

  test("totalFee sempre equivale a platformShare + reserveShare", () => {
    fc.assert(
      fc.property(couponState(), (state) => {
        const fee = calculateMonthlyFee(state);
        expect(fee.totalFee).toBe(fee.platformShare + fee.reserveShare);
      }),
      { numRuns: 10_000 }
    );
  });

  test("cupom nunca reduz a parcela da plataforma a valores negativos e respeita o percentual", () => {
    fc.assert(
      fc.property(couponState(), (state) => {
        const base = calculateMonthlyFee({ ...state, discountPercent: 0 });
        const fee = calculateMonthlyFee(state);
        const expected = Math.max(0, Math.round(base.platformShare * (1 - state.discountPercent / 100)));
        expect(fee.platformShare).toBe(expected);
        expect(fee.platformShare).toBeGreaterThanOrEqual(0);
        expect(fee.platformShare).toBeLessThanOrEqual(base.platformShare);
      }),
      { numRuns: 10_000 }
    );
  });

  test("cupom de 100% zera somente a plataforma (reserva intacta)", () => {
    const fee = calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: false, discountPercent: 100 });
    expect(fee.platformShare).toBe(0);
    expect(fee.reserveShare).toBe(7_000);
    expect(fee.totalFee).toBe(7_000);
  });

  test("cupom 50% no mês 2: R$ 25,50 plataforma + R$ 49,00 reserva = R$ 74,50", () => {
    const fee = calculateMonthlyFee({ monthsActive: 2, optedOutOfReserve: false, discountPercent: 50 });
    expect(fee.platformShare).toBe(2_550);
    expect(fee.reserveShare).toBe(4_900);
    expect(fee.totalFee).toBe(7_450);
    expect(fee.tier).toBe("standard");
  });

  test("cupom não altera o trial (mês 1 continua R$ 0)", () => {
    const fee = calculateMonthlyFee({ monthsActive: 1, optedOutOfReserve: false, discountPercent: 80 });
    expect(fee.totalFee).toBe(0);
    expect(fee.tier).toBe("trial");
  });

  test("percentuais fora da faixa são normalizados", () => {
    expect(
      calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: false, discountPercent: -20 }).platformShare
    ).toBe(13_000);
    expect(
      calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: false, discountPercent: 250 }).platformShare
    ).toBe(0);
    expect(
      calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: false, discountPercent: Number.NaN })
        .platformShare
    ).toBe(13_000);
  });
});

describe("matriz progressiva completa (mês × opt-out × cupom)", () => {
  test("cobertura exata da tabela oficial de 1 a 12 meses", () => {
    const expected: Record<string, [number, number, number]> = {
      // [totalFee, platformShare, reserveShare]
      "1:false": [0, 0, 0],
      "1:true": [0, 0, 0],
      "2:false": [10_000, 5_100, 4_900],
      "2:true": [15_000, 15_000, 0],
    };
    for (let m = 3; m <= 12; m++) {
      expected[`${m}:false`] = [20_000, 13_000, 7_000];
      expected[`${m}:true`] = [15_000, 15_000, 0];
    }

    for (const [key, [total, platform, reserve]] of Object.entries(expected)) {
      const [months, optedOut] = key.split(":");
      const fee = calculateMonthlyFee({
        monthsActive: Number(months),
        optedOutOfReserve: optedOut === "true",
      });
      expect([fee.totalFee, fee.platformShare, fee.reserveShare]).toEqual([total, platform, reserve]);
      expect(total).toBe(platform + reserve);
      expect(Number.isInteger(total)).toBe(true);
    }
  });
});
