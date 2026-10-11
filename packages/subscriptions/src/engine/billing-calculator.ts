/**
 * Cálculo determinístico e único da assinatura FairMove.
 *
 * Regra comercial:
 * - Primeiro mês: grátis (R$ 0,00).
 * - Do segundo mês em diante: R$ 100,00 por mês.
 * - Divisão fixa de cada mensalidade paga: R$ 59,00 plataforma + R$ 41,00
 *   para a Reserva de Disciplina e Emergência.
 *
 * Flags antigas de opt-out/desconto são aceitas temporariamente por
 * compatibilidade com registros e clientes antigos, mas NÃO alteram a taxa.
 * Valores monetários são centavos inteiros em todas as camadas.
 */

export const MONTHLY_FEE_CAP_CENTS = 10_000;

export const SUBSCRIPTION_FEES = {
  trial: { totalFee: 0, platformShare: 0, reserveShare: 0 },
  standard: { totalFee: 10_000, platformShare: 5_900, reserveShare: 4_100 },
} as const;

export type BillingTier = keyof typeof SUBSCRIPTION_FEES;

export interface SubscriptionBillingState {
  /** Mês ativo (1-based) desde a ativação do cadastro. */
  monthsActive: number;
  /** Campo legado: ignorado. A reserva é parte fixa e obrigatória do plano. */
  optedOutOfReserve?: boolean;
  /** Campo legado: ignorado. Cupons não alteram a mensalidade de assinatura fixa. */
  discountPercent?: number;
}

export interface MonthlyFeeBreakdown {
  totalFee: number;
  platformShare: number;
  reserveShare: number;
  tier: BillingTier;
}

/** Entradas inválidas e negativas caem no primeiro mês grátis. */
function normalizeMonthsActive(monthsActive: number): number {
  if (!Number.isFinite(monthsActive)) return 1;
  return Math.max(1, Math.floor(monthsActive));
}

/**
 * Regra única de preço. Meses 2+ sempre retornam o mesmo valor e a mesma
 * divisão, independentemente de flags legadas, cupons ou atraso do job.
 */
export function calculateMonthlyFee(state: SubscriptionBillingState): MonthlyFeeBreakdown {
  const months = normalizeMonthsActive(state?.monthsActive);
  const tier: BillingTier = months <= 1 ? "trial" : "standard";
  return { ...SUBSCRIPTION_FEES[tier], tier };
}

/**
 * Calcula o mês ativo a partir da data de ativação.
 * Retorna 0 quando ainda não existe uma data válida ou ela está no futuro.
 * UTC é usado para que o ciclo não dependa do fuso do servidor.
 */
export function resolveMonthsActive(
  subscriptionStartedAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  if (!subscriptionStartedAt) return 0;
  const start = new Date(subscriptionStartedAt);
  if (Number.isNaN(start.getTime())) return 0;

  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) return 0;

  return months + 1;
}
