import { pgTable, text, boolean, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";

/**
 * Destinos de receita no ledger de cobrança de assinatura.
 *
 * - `PLATFORM_REVENUE`: parcela da mensalidade que fica com o FairMove.
 * - `DRIVER_DISCIPLINE_RESERVE`: parcela que entra na
 *   "Reserva de Disciplina e Emergência" do motorista (bloqueada para saque
 *   imediato; resgate só em emergência validada ou no desligamento).
 */
export const billingLedgerDestinations = pgEnum("billing_ledger_destination", [
  "PLATFORM_REVENUE",
  "DRIVER_DISCIPLINE_RESERVE",
]);

export type BillingLedgerDestination = "PLATFORM_REVENUE" | "DRIVER_DISCIPLINE_RESERVE";

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().unique(),
  status: text("status").notNull().default("free"),
  plan: text("plan").notNull().default("free"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAt: boolean("cancel_at").default(false).notNull(),
  canceledAt: timestamp("canceled_at"),
  /**
   * Momento da aprovação do cadastro do motorista — marco zero do ciclo de
   * "meses ativos" (mês 1 = trial, mês 2 = plano padrão, mês 3+ = pleno).
   * `null` enquanto o cadastro não foi aprovado.
   */
  subscriptionStartedAt: timestamp("subscription_started_at"),
  /**
   * Mês ativo atual do motorista (1-based), derivado de `subscriptionStartedAt`.
   * `0` = ciclo ainda não começou (cadastro não aprovado).
   */
  currentBillingCycle: integer("current_billing_cycle").default(0).notNull(),
  /**
   * Opt-out da "Reserva de Disciplina e Emergência": quando `true`, a mensalidade
   * (a partir do mês 2) vira um valor fixo pago integralmente ao FairMove.
   */
  optedOutOfReserve: boolean("opted_out_of_reserve").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
