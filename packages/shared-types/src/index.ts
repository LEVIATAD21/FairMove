export type RideStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "DRIVER_ASSIGNED"
  | "DRIVER_ARRIVING"
  | "DRIVER_AT_PICKUP"
  | "PASSENGER_ONBOARD"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED_BY_PASSENGER"
  | "CANCELLED_BY_DRIVER"
  | "CANCELLED_BY_SYSTEM"
  | "EXPIRED"
  | "DISPUTED";

export type VehicleType = "CAR" | "MOTORCYCLE";

export interface PriceQuote {
  originalPrice: number;
  promotionDiscount: number;
  passengerPrice: number;
  driverCredit: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Raio médio da Terra em km. */
const EARTH_RADIUS_KM = 6371;

/** Velocidade média urbana usada para estimar duração da corrida (km/h). */
export const AVG_CITY_SPEED_KMH = 24;

export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: unknown): lng is number {
  return typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/**
 * Distância em km entre dois pontos usando a fórmula de Haversine.
 * Retorna NaN quando as coordenadas são inválidas.
 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  if (!isValidLatitude(a.lat) || !isValidLongitude(a.lng)) return NaN;
  if (!isValidLatitude(b.lat) || !isValidLongitude(b.lng)) return NaN;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimativa de duração (minutos) de uma viagem a partir da distância. */
export function estimateDurationMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / AVG_CITY_SPEED_KMH) * 60 * 10) / 10);
}

/** Converte reais (float) para centavos inteiros com arredondamento bancário simples. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Converte centavos inteiros para reais. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Garante um número finito >= 0; caso contrário usa o fallback. */
export function safeNonNegative(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return fallback;
  return n;
}
