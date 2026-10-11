import fc from "fast-check";
import {
  calculateMonthlyFee,
  resolveMonthsActive,
  SUBSCRIPTION_FEES,
  MONTHLY_FEE_CAP_CENTS,
} from "../packages/subscriptions/src/engine/billing-calculator";

const billingState = () =>
  fc.record({
    monthsActive: fc.integer({ min: -50, max: 1_200 }),
    optedOutOfReserve: fc.boolean(),
    discountPercent: fc.float({ min: 0, max: 100, noNaN: true }),
  });

describe("calculateMonthlyFee — regra comercial fixa FairMove", () => {
  test("mês 1 é grátis, independentemente de flags legadas", () => {
    for (const optedOutOfReserve of [false, true]) {
      for (const discountPercent of [0, 50, 100]) {
        expect(calculateMonthlyFee({ monthsActive: 1, optedOutOfReserve, discountPercent })).toEqual({
          totalFee: 0,
          platformShare: 0,
          reserveShare: 0,
          tier: "trial",
        });
      }
    }
  });

  test("do mês 2 em diante: R$100 = R$59 plataforma + R$41 reserva, sempre", () => {
    for (const monthsActive of [2, 3, 4, 12, 120, 1_200]) {
      for (const optedOutOfReserve of [false, true]) {
        for (const discountPercent of [0, 50, 100]) {
          expect(calculateMonthlyFee({ monthsActive, optedOutOfReserve, discountPercent })).toEqual({
            totalFee: 10_000,
            platformShare: 5_900,
            reserveShare: 4_100,
            tier: "standard",
          });
        }
      }
    }
  });

  test("os valores centrais de contrato são os mesmos que o cálculo executa", () => {
    expect(SUBSCRIPTION_FEES.trial).toEqual({ totalFee: 0, platformShare: 0, reserveShare: 0 });
    expect(SUBSCRIPTION_FEES.standard).toEqual({
      totalFee: 10_000,
      platformShare: 5_900,
      reserveShare: 4_100,
    });
    expect(MONTHLY_FEE_CAP_CENTS).toBe(10_000);
  });

  test("mês ativo é normalizado de forma determinística", () => {
    for (const monthsActive of [0, -7, Number.NaN, Number.POSITIVE_INFINITY, 1.9]) {
      expect(calculateMonthlyFee({ monthsActive }).tier).toBe("trial");
    }
    expect(calculateMonthlyFee({ monthsActive: 2.9 }).tier).toBe("standard");
  });
});

describe("calculateMonthlyFee — property-based (10.000 combinações)", () => {
  test("split fecha e meses pagos nunca mudam preço por flags antigas", () => {
    fc.assert(
      fc.property(billingState(), (state) => {
        const fee = calculateMonthlyFee(state);
        expect(fee.platformShare + fee.reserveShare).toBe(fee.totalFee);
        for (const value of [fee.totalFee, fee.platformShare, fee.reserveShare]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        if (Math.floor(state.monthsActive) >= 2) {
          expect(fee).toEqual({
            totalFee: 10_000,
            platformShare: 5_900,
            reserveShare: 4_100,
            tier: "standard",
          });
        }
        expect(fee.totalFee).toBeLessThanOrEqual(MONTHLY_FEE_CAP_CENTS);
      }),
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
  const start = new Date("2026-01-15T12:00:00Z");

  test("sem aprovação ou com data inválida retorna zero", () => {
    expect(resolveMonthsActive(null)).toBe(0);
    expect(resolveMonthsActive(undefined)).toBe(0);
    expect(resolveMonthsActive("data-invalida")).toBe(0);
  });

  test("primeiro mês permanece trial até completar um mês civil", () => {
    expect(resolveMonthsActive(start, new Date("2026-01-15T13:00:00Z"))).toBe(1);
    expect(resolveMonthsActive(start, new Date("2026-02-14T13:00:00Z"))).toBe(1);
  });

  test("avança por mês completo em UTC", () => {
    expect(resolveMonthsActive(start, new Date("2026-02-15T13:00:00Z"))).toBe(2);
    expect(resolveMonthsActive(start, new Date("2026-03-15T13:00:00Z"))).toBe(3);
    expect(resolveMonthsActive(start, new Date("2027-01-15T13:00:00Z"))).toBe(13);
  });

  test("data no futuro não gera ciclo negativo", () => {
    expect(resolveMonthsActive(new Date("2026-12-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toBe(0);
  });

  test("aceita string ISO", () => {
    expect(resolveMonthsActive("2026-01-15T12:00:00Z", new Date("2026-03-15T13:00:00Z"))).toBe(3);
  });
});
