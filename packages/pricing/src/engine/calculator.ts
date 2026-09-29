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
  /** BUG-X5: piso do preço final (após surge e desconto) — R$0 nunca. */
  minFare: 7.0,
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
 * - BUG-X5: o preço final tem PISO em `PRICING_RULES.minFare` (R$7) — aplicado
 *   DEPOIS do desconto, com o desconto reportado como o efetivamente
 *   concedido (original − final). Surge 0,5 em trecho curto ou cupom
 *   agressivo nunca entrega corrida abaixo do mínimo.
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

  const rawPassengerPriceCents = originalPriceCents - discountCents;
  // BUG-X5: piso após o desconto — piso acima do original (surge baixo em
  // trecho curto) também vale; a resposta mantém o originalPrice real.
  const passengerPriceCents = Math.max(rawPassengerPriceCents, toCents(PRICING_RULES.minFare));
  // Desconto EFETIVO honesto: se o piso subiu o preço, o desconto reportado
  // encolhe junto (nunca maior que o concedido nem maior que o possível).
  const effectiveDiscountCents = Math.min(
    discountCents,
    Math.max(0, originalPriceCents - passengerPriceCents)
  );
  const passengerPrice = fromCents(passengerPriceCents);

  // Regra de negócio: motorista recebe exatamente o que o passageiro pagou.
  const driverCredit = passengerPrice;

  return {
    originalPrice,
    promotionDiscount: fromCents(effectiveDiscountCents),
    passengerPrice,
    driverCredit,
  };
}
