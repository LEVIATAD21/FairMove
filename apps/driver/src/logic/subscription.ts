/**
 * Exibição da mensalidade fixa FairMove na tela de perfil.
 * Fonte única de verdade: `packages/subscriptions` (mesma regra cobrada no backend).
 */
import {
  calculateMonthlyFee,
  resolveMonthsActive,
} from "../../../../packages/subscriptions/src/engine/billing-calculator";
import { formatBRL } from "./ride-request";

/** "Você está no Mês 3 do Plano FairMove" */
export function cycleLabel(monthsActive: number): string {
  const month = Math.max(1, Math.floor(monthsActive));
  return `Você está no Mês ${month} do Plano FairMove`;
}

/** "R$ 59,00 Plataforma | R$ 41,00 Reserva" em todos os meses pagos. */
export function feeSplitLabel(monthsActive: number, _optedOutOfReserve = false): string {
  const fee = calculateMonthlyFee({ monthsActive });
  return `${formatBRL(fee.platformShare)} Plataforma | ${formatBRL(fee.reserveShare)} Reserva`;
}

/** Texto da mensalidade: grátis no primeiro mês; R$ 100,00 a partir do segundo. */
export function monthlyFeeLabel(monthsActive: number, _optedOutOfReserve = false): string {
  const fee = calculateMonthlyFee({ monthsActive });
  return `Mensalidade: ${formatBRL(fee.totalFee)}`;
}

/** Mês ativo do motorista a partir da data de ativação da assinatura. */
export function currentCycleFrom(startedAt: Date | string | null, now: Date = new Date()): number {
  return resolveMonthsActive(startedAt, now);
}

export { calculateMonthlyFee, resolveMonthsActive };
