import fc from "fast-check";
import { computeScore, DEFAULT_WEIGHTS, type DriverMetrics } from "../packages/events/src/engine/scoring-engine";

describe("scoring-engine — property-based (10.000 combinações)", () => {
  const weights = DEFAULT_WEIGHTS;

  const validRating = () => fc.float({ min: 0, max: 5, noNaN: true });
  const validAcceptance = () => fc.float({ min: 0, max: 100, noNaN: true });
  // Use integers divided to get controlled floats
  const ratingDiff = () => fc.integer({ min: 1, max: 50 }).map((n) => n / 100); // 0.01 to 0.50
  const acceptanceDiff = () => fc.integer({ min: 1, max: 1000 }).map((n) => n / 10); // 0.1 to 100

  test("score é sempre >= 0 para métricas válidas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        validRating(),
        validAcceptance(),
        (ridesCount, avgRating, acceptanceRate) => {
          const metrics: DriverMetrics = { driverId: "test", ridesCount, avgRating, acceptanceRate };
          const score = computeScore(metrics, DEFAULT_WEIGHTS);
          expect(score).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 10_000 }
    );
  });

  test("score aumenta monoticamente com mais corridas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        validRating(),
        validAcceptance(),
        (baseRides, extraRides, rating, acceptance) => {
          const m1: DriverMetrics = { driverId: "test", ridesCount: baseRides, avgRating: rating, acceptanceRate: acceptance };
          const m2: DriverMetrics = { driverId: "test", ridesCount: baseRides + extraRides, avgRating: rating, acceptanceRate: acceptance };
          expect(computeScore(m2)).toBeGreaterThanOrEqual(computeScore(m1));
        }
      ),
      { numRuns: 10_000 }
    );
  });

  test("score aumenta com rating mais alto (outros iguais)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        validRating(),
        ratingDiff(),
        validAcceptance(),
        (rides, rating1, diff, acceptance) => {
          const rating2 = Math.min(5, rating1 + diff);
          const m1: DriverMetrics = { driverId: "test", ridesCount: rides, avgRating: rating1, acceptanceRate: acceptance };
          const m2: DriverMetrics = { driverId: "test", ridesCount: rides, avgRating: rating2, acceptanceRate: acceptance };
          expect(computeScore(m2)).toBeGreaterThanOrEqual(computeScore(m1));
        }
      ),
      { numRuns: 10_000 }
    );
  });

  test("score aumenta com aceitação mais alta (outros iguais)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        validRating(),
        validAcceptance(),
        acceptanceDiff(),
        (rides, rating, acceptance1, diff) => {
          const acceptance2 = Math.min(100, acceptance1 + diff);
          const m1: DriverMetrics = { driverId: "test", ridesCount: rides, avgRating: rating, acceptanceRate: acceptance1 };
          const m2: DriverMetrics = { driverId: "test", ridesCount: rides, avgRating: rating, acceptanceRate: acceptance2 };
          expect(computeScore(m2)).toBeGreaterThanOrEqual(computeScore(m1));
        }
      ),
      { numRuns: 10_000 }
    );
  });

  test("pesos proporcionais: rating (2x) > aceitação (3x normalizado) > corridas (1x)", () => {
    const base: DriverMetrics = { driverId: "t", ridesCount: 10, avgRating: 4.0, acceptanceRate: 80 };
    const deltaRides = computeScore({ ...base, ridesCount: 11 }) - computeScore(base);
    const deltaRating = computeScore({ ...base, avgRating: 4.2 }) - computeScore(base);
    const deltaAccept = computeScore({ ...base, acceptanceRate: 82 }) - computeScore(base);

    expect(deltaRating).toBeGreaterThan(deltaAccept);
    expect(deltaAccept).toBeGreaterThan(deltaRides);
  });

  test("score zero para driver sem corridas", () => {
    const m: DriverMetrics = { driverId: "t", ridesCount: 0, avgRating: 0, acceptanceRate: 0 };
    expect(computeScore(m)).toBe(0);
  });

  test("score máximo teórico não estoura number", () => {
    const m: DriverMetrics = { driverId: "t", ridesCount: 1000, avgRating: 5, acceptanceRate: 100 };
    const score = computeScore(m);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  test("score é determinístico", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        validRating(),
        validAcceptance(),
        (ridesCount, avgRating, acceptanceRate) => {
          const m: DriverMetrics = { driverId: "test", ridesCount, avgRating, acceptanceRate };
          expect(computeScore(m)).toBe(computeScore(m));
        }
      ),
      { numRuns: 10_000 }
    );
  });
});