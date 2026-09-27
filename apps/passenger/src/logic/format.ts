/**
 * Lógica pura de formatação do passageiro — mesmas regras do motorista
 * (BRL determinístico, sem Intl — funciona igual em Hermes e Node).
 */

/** `1456 → "R$ 14,56"`, `300000 → "R$ 3.000,00"` (centavos inteiros). */
export function formatBRL(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const units = Math.floor(abs / 100).toString();
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = (abs % 100).toString().padStart(2, "0");
  return `${sign}R$ ${grouped},${decimals}`;
}

/** Representação textual de coordenada real (sem geocoder): `-23.5505, -46.6333`. */
export function formatCoord(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "—";
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
