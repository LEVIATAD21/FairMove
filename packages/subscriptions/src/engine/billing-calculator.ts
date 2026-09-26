/**
 * Motor de cálculo da mensalidade do motorista (Billing Engine).
 *
 * Regras de negócio do FairMove — progressão por "meses ativos" contados a
 * partir da aprovação do cadastro:
 *
 * | Mês ativo | Taxa total | Plataforma | Reserva de Disciplina e Emergência |
 * |-----------|-----------:|-----------:|-----------------------------------:|
 * | 1 (trial) | R$ 0,00    | R$ 0,00    | R$ 0,00                            |
 * | 2         | R$ 100,00  | R$ 51,00   | R$ 49,00                           |
 * | 3+ (pleno)| R$ 200,00  | R$ 130,00  | R$ 70,00                           |
 *
 * Opt-out da reserva (a partir do mês 2): taxa fixa de R$ 150,00, integralmente
 * para a plataforma.
 *
 * TODOS os valores são centavos inteiros. Converta para reais apenas na camada
 * de apresentação (dividindo por 100).
 */

/** Conta de destino da parcela da plataforma no ledger. */
export const PLATFORM_REVENUE_ACCOUNT = "platform_revenue_account";
/** Conta de destino da reserva (bloqueada para saque imediato). */
export const DISCIPLINE_RESERVE_ACCOUNT = "discipline_and_emergency_reserve_account";

/** Teto máximo da mensalidade (R$ 200,00), nunca é excedido. */
export const MONTHLY_FEE_CAP_CENTS = 20_000;
/** Mensalidade fixa quando o motorista fez opt-out da reserva (R$ 150,00). */
export const OPT_OUT_FEE_CENTS = 15_000;

export const SUBSCRIPTION_FEES = {
  /** Mês 1 — trial/boas-vindas: motorista recebe 100% das corridas. */
  trial: { totalFee: 0, platformShare: 0, reserveShare: 0 },
  /** Mês 2 — entrada no plano padrão (R$ 100,00). */
  standard: { totalFee: 10_000, platformShare: 5_100, reserveShare: 4_900 },
  /** Mês 3 em diante — plano pleno (R$ 200,00, teto). */
  full: { totalFee: 20_000, platformShare: 13_000, reserveShare: 7_000 },
  /** Mês 2+ com opt-out da reserva: R$ 150,00 fixos para a plataforma. */
  optOut: { totalFee: 15_000, platformShare: 15_000, reserveShare: 0 },
} as const;

export type BillingTier = keyof typeof SUBSCRIPTION_FEES;

export interface SubscriptionBillingState {
  /** Mês ativo (1-based) desde a aprovação do cadastro. */
  monthsActive: number;
  /** `true` quando o motorista saiu da Reserva de Disciplina e Emergência. */
  optedOutOfReserve: boolean;
}

export interface MonthlyFeeBreakdown {
  /** Taxa total do ciclo em centavos. */
  totalFee: number;
  /** Parcela da plataforma (FairMove) em centavos. */
  platformShare: number;
  /** Parcela da Reserva de Disciplina e Emergência em centavos (0 se opt-out). */
  reserveShare: number;
  /** Faixa de cobrança aplicada (útil para logs e exibição no app). */
  tier: BillingTier;
}

/**
 * Normaliza a entrada para um mês ativo válido (inteiro, ≥ 1).
 * Entradas não finitas ou negativas caem no mês 1 (trial).
 */
function normalizeMonthsActive(monthsActive: number): number {
  if (!Number.isFinite(monthsActive)) return 1;
  return Math.max(1, Math.floor(monthsActive));
}

/**
 * Calcula a mensalidade do próximo ciclo de um motorista.
 *
 * Pura e determinística: mesma entrada ⇒ mesma saída, sem acesso a banco ou
 * relógio — a base ideal para testes property-based.
 *
 * @example
 * calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: false });
 * // => { totalFee: 20000, platformShare: 13000, reserveShare: 7000, tier: "full" }
 */
export function calculateMonthlyFee(state: SubscriptionBillingState): MonthlyFeeBreakdown {
  const months = normalizeMonthsActive(state?.monthsActive);
  const optedOut = state?.optedOutOfReserve === true;

  let tier: BillingTier;
  if (months <= 1) tier = "trial";
  else if (optedOut) tier = "optOut";
  else if (months === 2) tier = "standard";
  else tier = "full";

  const fee = SUBSCRIPTION_FEES[tier];
  return { ...fee, tier };
}

/**
 * Calcula o mês ativo atual a partir da data de aprovação do cadastro.
 *
 * Retorna `0` quando ainda não há aprovação (`null`/inválida); caso contrário
 * `1` durante o primeiro mês, `2` após completar um mês completo, etc.
 */
export function resolveMonthsActive(
  subscriptionStartedAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  if (!subscriptionStartedAt) return 0;
  const start = new Date(subscriptionStartedAt);
  if (Number.isNaN(start.getTime())) return 0;

  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return 0;

  return months + 1;
}
