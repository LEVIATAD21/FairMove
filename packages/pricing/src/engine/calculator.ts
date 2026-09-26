import { toCents, fromCents, safeNonNegative } from "@fairmove/shared-types";

export interface QuoteResult {
  originalPrice: number;
  promotionDiscount: number;
  passengerPrice: number;
  driverCredit: number;
}

/** Regras tarifárias da plataforma (valores em BRL). */
export const PRICING_RULES = {
  baseFare: 7.0,
  perKm: 1.0,
  perMinute: 0.918,
  minSurge: 0.5,
  maxSurge: 3.0,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Calcula a corrida inteiramente no backend.
 *
 * - Entradas inválidas/negativas caem em valores padrão seguros.
 * - `dynamicAdjustment` (surge/desconto dinâmico) é aplicado sobre a tarifa base
 *   e limitado a [0.5, 3.0].
 * - O desconto promocional nunca pode deixar o preço negativo.
 * - Regra do modelo de negócio: `driverCredit === passengerPrice` (sem comissão).
 */
export function calculateQuote(
  baseFare: number = PRICING_RULES.baseFare,
  distanceKm: number = 10.0,
  timeMinutes: number = 5.0,
  dynamicAdjustment: number = 1.0,
  promotionDiscount: number = 0
): QuoteResult {
  const safeBaseFare = safeNonNegative(baseFare, PRICING_RULES.baseFare);
  const safeDistanceKm = safeNonNegative(distanceKm, 0);
  const safeTimeMinutes = safeNonNegative(timeMinutes, 0);

  const surge = clamp(
    Number.isFinite(Number(dynamicAdjustment)) ? Number(dynamicAdjustment) : 1.0,
    PRICING_RULES.minSurge,
    PRICING_RULES.maxSurge
  );

  const baseFareCents = toCents(safeBaseFare);
  const distanceFareCents = toCents(safeDistanceKm * PRICING_RULES.perKm);
  const timeFareCents = toCents(safeTimeMinutes * PRICING_RULES.perMinute);

  const subtotalCents = baseFareCents + distanceFareCents + timeFareCents;
  const originalPriceCents = Math.round(subtotalCents * surge);
  const originalPrice = fromCents(originalPriceCents);

  const requestedDiscountCents = toCents(safeNonNegative(promotionDiscount, 0));
  const discountCents = clamp(requestedDiscountCents, 0, originalPriceCents);

  const passengerPriceCents = originalPriceCents - discountCents;
  const passengerPrice = fromCents(passengerPriceCents);

  // Regra de negócio: motorista recebe exatamente o que o passageiro pagou.
  const driverCredit = passengerPrice;

  return {
    originalPrice,
    promotionDiscount: fromCents(discountCents),
    passengerPrice,
    driverCredit,
  };
}
