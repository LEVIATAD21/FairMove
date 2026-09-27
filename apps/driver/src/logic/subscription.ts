/**
 * Exibição do ciclo de cobrança progressiva na tela de perfil.
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

/** "R$ 130,00 Plataforma | R$ 70,00 Reserva" (ou opt-out: "R$ 150,00 | R$ 0,00"). */
export function feeSplitLabel(monthsActive: number, optedOutOfReserve: boolean): string {
  const fee = calculateMonthlyFee({ monthsActive, optedOutOfReserve });
  return `${formatBRL(fee.platformShare)} Plataforma | ${formatBRL(fee.reserveShare)} Reserva`;
}

/** Texto da mensalidade total do ciclo ("Mensalidade: R$ 200,00"). */
export function monthlyFeeLabel(monthsActive: number, optedOutOfReserve: boolean): string {
  const fee = calculateMonthlyFee({ monthsActive, optedOutOfReserve });
  return `Mensalidade: ${formatBRL(fee.totalFee)}`;
}

/** Mês ativo do motorista a partir da data de ativação da assinatura. */
export function currentCycleFrom(startedAt: Date | string | null, now: Date = new Date()): number {
  return resolveMonthsActive(startedAt, now);
}

export { calculateMonthlyFee, resolveMonthsActive };
