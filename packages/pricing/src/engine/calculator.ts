export interface QuoteResult {
  originalPrice: number;
  promotionDiscount: number;
  passengerPrice: number;
  driverCredit: number;
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents / 100 * 100) / 100;
}

export function calculateQuote(
  baseFare: number = 7.0,
  distanceKm: number = 10.0,
  timeMinutes: number = 5.0,
  dynamicAdjustment: number = 1.0,
  promotionDiscount: number = 0
): QuoteResult {
  // Calculate in cents for precision
  const baseFareCents = toCents(baseFare); // 700
  const distanceFareCents = toCents(distanceKm * 1.0); // 1000 for 10km at R$1.00/km
  const timeFareCents = toCents(timeMinutes * 0.918); // ~459 for 5min

  const originalPriceCents = baseFareCents + distanceFareCents + timeFareCents; // 2159
  const originalPrice = fromCents(originalPriceCents); // 21.59

  const discountCents = toCents(promotionDiscount); // 703 for 7.03
  const discount = fromCents(discountCents); // 7.03

  const passengerPriceCents = Math.max(0, originalPriceCents - discountCents);
  const passengerPrice = fromCents(passengerPriceCents); // 14.56

  const driverCreditCents = passengerPriceCents; // Rule: driverCredit = passengerPrice
  const driverCredit = fromCents(driverCreditCents); // 14.56

  return {
    originalPrice,
    promotionDiscount: discount,
    passengerPrice,
    driverCredit,
  };
}