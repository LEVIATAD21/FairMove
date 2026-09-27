/**
 * Lógica pura da tela "Reserva de Disciplina e Emergência".
 */
import { formatBRL, formatBRLCompact } from "./ride-request";

/** Meta padrão da reserva (R$ 1.000,00 em centavos). */
export const RESERVE_GOAL_CENTS = 100_000;

/** Progresso em `[0, 100]` (arredondado a 1 casa) — seguro para a largura da barra. */
export function progressPercent(currentCents: number, goalCents: number = RESERVE_GOAL_CENTS): number {
  if (!Number.isFinite(currentCents) || currentCents <= 0) return 0;
  if (!Number.isFinite(goalCents) || goalCents <= 0) return 100;
  const percent = (currentCents / goalCents) * 100;
  return Math.min(100, Math.round(percent * 10) / 10);
}

/** Rótulo do progresso: `R$ 287 de R$ 1.000 da meta`. */
export function reserveProgressLabel(
  currentCents: number,
  goalCents: number = RESERVE_GOAL_CENTS
): string {
  return `${formatBRLCompact(currentCents)} de ${formatBRLCompact(goalCents)} da meta`;
}

/** Linha do histórico de aportes: `+ R$ 70,00 em Set/2026`. */
export function contributionLabel(
  cents: number,
  monthAbbrev: string,
  year: number,
  note?: string
): string {
  const sign = cents >= 0 ? "+" : "-";
  const base = `${sign} ${formatBRL(Math.abs(cents))} em ${monthAbbrev}/${year}`;
  return note ? `${base} · ${note}` : base;
}

/** Quanto falta para a meta (nunca negativo). */
export function remainingToGoalCents(
  currentCents: number,
  goalCents: number = RESERVE_GOAL_CENTS
): number {
  return Math.max(0, goalCents - Math.max(0, currentCents));
}
