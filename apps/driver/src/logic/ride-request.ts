/**
 * Lógica pura do modal de solicitação de corrida (FairMove).
 * Funções testáveis sem renderização — usadas pelo `RideRequestSheet`.
 */

/** Janela de decisão do motorista antes da recusa automática (segundos). */
export const RIDE_REQUEST_COUNTDOWN_SECONDS = 15;

export interface RideRequest {
  id: string;
  origin: string;
  destination: string;
  durationMinutes: number;
  distanceKm: number;
  /** Centavos exatos que o motorista recebe (valor pago pelo passageiro, sem taxas). */
  driverReceivesCents: number;
}

/**
 * Formata centavos inteiros como BRL: `1456 → "R$ 14,56"`, `300000 → "R$ 3.000,00"`.
 * Implementação manual (sem `Intl`) — determinística em Hermes e Node.
 */
export function formatBRL(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const units = Math.floor(abs / 100).toString();
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = (abs % 100).toString().padStart(2, "0");
  return `${sign}R$ ${grouped},${decimals}`;
}

/**
 * Formatação compacta para metas: omite os centavos quando são `00`
 * (`28700 → "R$ 287"`, `28750 → "R$ 287,50"`).
 */
export function formatBRLCompact(cents: number): string {
  const formatted = formatBRL(cents);
  return formatted.replace(/,00$/, "");
}

/**
 * Segundos restantes do contador regressivo (arredondados para cima,
 * sempre dentro de `[0, totalSeconds]`).
 */
export function countdownRemainingSeconds(
  elapsedMs: number,
  totalSeconds: number = RIDE_REQUEST_COUNTDOWN_SECONDS
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return totalSeconds;
  const remaining = totalSeconds - elapsedMs / 1000;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining);
}

/** `true` quando a janela de decisão expirou (recusa automática). */
export function isCountdownExpired(
  elapsedMs: number,
  totalSeconds: number = RIDE_REQUEST_COUNTDOWN_SECONDS
): boolean {
  return countdownRemainingSeconds(elapsedMs, totalSeconds) === 0;
}

/** Rótulo do contador exibido no modal. */
export function countdownLabel(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return "Tempo esgotado — recusa automática";
  return `Recusa automática em ${remainingSeconds}s`;
}

export type RideRequestOutcome = "accepted" | "declined" | "expired";

/**
 * Resolve o resultado da decisão. `now` e `startedAt` em ms (mesma base de tempo).
 * O motorista ainda pode agir dentro da janela; após ela, tudo vira `expired`.
 */
export function resolveRideRequestOutcome(
  decision: "accept" | "decline" | null,
  elapsedMs: number,
  totalSeconds: number = RIDE_REQUEST_COUNTDOWN_SECONDS
): RideRequestOutcome {
  if (decision === null || isCountdownExpired(elapsedMs, totalSeconds)) return "expired";
  return decision === "accept" ? "accepted" : "declined";
}
