/**
 * QA AUDIT — Área 1: lógica de assinaturas e trial (execução real, não estática).
 *
 * Cenários da missão:
 *  1. Opt-out no Mês 1 → Mês 2 cobra R$150? (e mês 3+ continua R$150 fixo)
 *  2. Cancel → reativa: trial é re-grantado? (deve ser NÃO)
 *  3. Trial expirado há 6 meses reativa → R$100 ou R$200? (deve ser R$200)
 *  4. subscriptionStartedAt no futuro → não explode, não cobra errado
 *  5. Timezone: cálculo de mês depende da TZ do servidor? (não deve)
 *
 * Bug-alvo desta suíte (encontrado na auditoria):
 *  [CRITICAL] A taxa cobrada depende do DIA DO DISPARO, não do ciclo do
 *  motorista: `chargeMonthlyFee` deriva o tier de `resolveMonthsActive`
 *  (calendário no instante do chamado) e `currentBillingCycle` é apenas
 *  fallback. Como NÃO existe job automático de cobrança (só rota admin),
 *  o atraso do disparo é a regra — e um mesmo estado de assinatura cobra
 *  R$100 ou R$200 conforme o dia em que o admin aciona.
 *
 * Requer DATABASE_URL.
 */
import "dotenv/config";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inArray, eq, like, or } from "drizzle-orm";
import {
  db,
  users,
  subscriptions,
  wallets,
  ledger_transactions,
  ledger_entries,
  emergency_reserves,
  reserve_transactions,
} from "../packages/shared-db/src/index";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";
import { subscriptionEngine } from "../packages/subscriptions/src/engine/subscription-engine";
import {
  calculateMonthlyFee,
  resolveMonthsActive,
} from "../packages/subscriptions/src/engine/billing-calculator";

const DAY = 24 * 60 * 60 * 1000;
const createdUserIds: string[] = [];

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(users).values({
    id,
    name: "QA Audit",
    email: `qa-audit-${id}@sec.it`,
    passwordHash: "x",
    role: "driver",
  });
  createdUserIds.push(id);
  return id;
}

interface SubSeed {
  startedAt: Date;
  trialEndsAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cycle?: number;
  status?: string;
  optedOut?: boolean;
}

async function seedSub(userId: string, seed: SubSeed): Promise<string> {
  const id = randomUUID();
  await db.insert(subscriptions).values({
    id,
    userId,
    status: seed.status ?? "active",
    plan: "pro",
    trialEndsAt: seed.trialEndsAt,
    currentPeriodStart: seed.periodStart,
    currentPeriodEnd: seed.periodEnd,
    subscriptionStartedAt: seed.startedAt,
    currentBillingCycle: seed.cycle ?? 1,
    optedOutOfReserve: seed.optedOut ?? false,
  });
  return id;
}

describeIfDb("QA audit: assinaturas e trial", () => {
  afterAll(async () => {
    if (createdUserIds.length === 0) return;
    const walletRows = await db
      .select({ id: wallets.id })
      .from(wallets)
      .where(inArray(wallets.userId, createdUserIds));
    const walletIds = walletRows.map((w) => w.id);

    const reserveRows = await db
      .select({ id: emergency_reserves.id })
      .from(emergency_reserves)
      .where(inArray(emergency_reserves.driverId, createdUserIds));
    const reserveIds = reserveRows.map((r) => r.id);
    if (reserveIds.length > 0) {
      await db
        .delete(reserve_transactions)
        .where(inArray(reserve_transactions.reserveId, reserveIds));
      await db
        .delete(emergency_reserves)
        .where(inArray(emergency_reserves.id, reserveIds));
    }

    if (walletIds.length > 0) {
      await db.delete(ledger_entries).where(inArray(ledger_entries.walletId, walletIds));
      await db
        .delete(ledger_transactions)
        .where(inArray(ledger_transactions.walletId, walletIds));
      await db.delete(wallets).where(inArray(wallets.id, walletIds));
    }
    // Lançamentos da conta plataforma criados por ESTAS cobranças
    // (idempotency_key namespaceia por userId do teste — limpa por padrão LIKE).
    const platformWallet = await walletEngine.getWallet(
      process.env.PLATFORM_USER_ID || "platform"
    );
    if (platformWallet) {
      const platformTx = await db
        .select({ id: ledger_transactions.id })
        .from(ledger_transactions)
        .where(
          or(
            ...createdUserIds.map((uid) =>
              like(ledger_transactions.idempotencyKey, `subscription:${uid}:%`)
            )
          )
        );
      const platformTxIds = platformTx.map((t) => t.id);
      if (platformTxIds.length > 0) {
        await db
          .delete(ledger_entries)
          .where(inArray(ledger_entries.transactionId, platformTxIds));
        await db
          .delete(ledger_transactions)
          .where(inArray(ledger_transactions.id, platformTxIds));
      }
    }
    await db.delete(subscriptions).where(inArray(subscriptions.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  });

  test("[MISSÃO 1/2] opt-out: R$150 no mês 2 e fixo no mês 3+; opt-out repetido é bloqueado", async () => {
    // Regra da tabela: mês 1 com opt-out continua R$0 (trial intocável).
    expect(calculateMonthlyFee({ monthsActive: 1, optedOutOfReserve: true }).totalFee).toBe(0);
    // Mês 2 com opt-out → R$150 (não R$100).
    expect(calculateMonthlyFee({ monthsActive: 2, optedOutOfReserve: true }).totalFee).toBe(15_000);
    // Mês 3+ com opt-out → continua R$150 fixo (não volta para R$200).
    expect(calculateMonthlyFee({ monthsActive: 3, optedOutOfReserve: true }).totalFee).toBe(15_000);
    expect(calculateMonthlyFee({ monthsActive: 48, optedOutOfReserve: true }).totalFee).toBe(15_000);

    // Execução real: opt-out duas vezes no engine (a rota mapeia 2º → 409).
    const userId = await makeUser();
    await subscriptionEngine.activateSubscription(userId);
    const first = await subscriptionEngine.optOutOfReserve(userId);
    const second = await subscriptionEngine.optOutOfReserve(userId);
    console.log(
      `[MISSÃO 1] opt-out #1 success=${first.success} | #2 success=${second.success} msg="${second.message}"`
    );
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    const sub = await subscriptionEngine.getSubscription(userId);
    expect(sub!.optedOutOfReserve).toBe(true);
  });

  test("[MISSÃO 3] cancel → reativação NÃO re-granta trial nem estende período vencido", async () => {
    const userId = await makeUser();
    await subscriptionEngine.activateSubscription(userId);
    const before = await subscriptionEngine.getSubscription(userId);
    const trialBefore = before!.trialEndsAt!.getTime();
    const periodBefore = before!.currentPeriodEnd!.getTime();

    await subscriptionEngine.cancelSubscription(userId);
    const reactivate = await subscriptionEngine.activateSubscription(userId);
    const after = await subscriptionEngine.getSubscription(userId);

    console.log(
      `[MISSÃO 3] reativação: trial ${
        after!.trialEndsAt!.getTime() === trialBefore ? "PRESERVADO" : "RE-GRANTADO (bug)"
      } | período ${
        after!.currentPeriodEnd!.getTime() === periodBefore ? "PRESERVADO" : "ESTENDIDO (bug)"
      } | status=${after!.status} | activate.msg="${reactivate.message.slice(0, 40)}..."`
    );
    expect(after!.status).toBe("active");
    expect(after!.trialEndsAt!.getTime()).toBe(trialBefore);
    expect(after!.currentPeriodEnd!.getTime()).toBe(periodBefore);
  });

  test("[MISSÃO 4] trial expirado há 6 meses → reativação cobra R$200 (pleno), nunca R$100", async () => {
    const userId = await makeUser();
    const startedAt = new Date(Date.now() - 180 * DAY);
    await seedSub(userId, {
      startedAt,
      trialEndsAt: new Date(Date.now() - 150 * DAY),
      periodStart: new Date(Date.now() - 150 * DAY),
      periodEnd: new Date(Date.now() - 150 * DAY),
      cycle: 1,
      status: "cancelled",
    });
    await walletEngine.ensureWallet(userId);
    await walletEngine.creditCents(userId, 50_000);

    const re = await subscriptionEngine.activateSubscription(userId);
    expect(re.success).toBe(true);

    const charge = await subscriptionEngine.chargeMonthlyFee(userId);
    console.log(
      `[MISSÃO 4] reativação após 180 dias → charge: success=${charge.success} tier=${charge.tier} amount=${charge.amountChargedCents} msg="${charge.message}"`
    );
    expect(charge.success).toBe(true);
    expect(charge.amountChargedCents).toBe(20_000); // mês ativo ~7 → pleno
  });

  test("[MISSÃO 5] subscriptionStartedAt no futuro: activate não degrada o ciclo e charge não cobra", async () => {
    const userId = await makeUser();
    const future = new Date(Date.now() + 60 * DAY);
    await seedSub(userId, {
      startedAt: future,
      trialEndsAt: future,
      periodStart: null,
      periodEnd: future,
      cycle: 1,
      status: "cancelled",
    });

    await subscriptionEngine.activateSubscription(userId);
    const sub = await subscriptionEngine.getSubscription(userId);
    console.log(
      `[MISSÃO 5] reativação com start futuro → currentBillingCycle=${sub!.currentBillingCycle} status=${sub!.status}`
    );
    expect(sub!.currentBillingCycle).toBeGreaterThanOrEqual(1);
    expect(sub!.status).toBe("active");

    const charge = await subscriptionEngine.chargeMonthlyFee(userId);
    console.log(`[MISSÃO 5] charge com trial futuro → success=${charge.success} msg="${charge.message}"`);
    expect(charge.success).toBe(false);
    expect(charge.message).toMatch(/não é hora/i);
  });

  test("[MISSÃO 6] timezone: mesmo instante, mês ativo NÃO pode mudar com a TZ do servidor", () => {
    // O jest congela a troca de TZ in-process (probe provou: Date ignora
    // process.env.TZ após worker init). Executamos o módulo REAL compilado
    // em filhos node com TZ por processo — execução real, sem cópia da fórmula.
    const projectRoot = path.resolve(__dirname, "..");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-billing-tz-"));
    execFileSync(
      "npx",
      [
        "tsc",
        "packages/subscriptions/src/engine/billing-calculator.ts",
        "--outDir",
        outDir,
        "--ignoreConfig",
        "--module",
        "commonjs",
        "--target",
        "es2020",
        "--skipLibCheck",
      ],
      { cwd: projectRoot, stdio: "pipe" }
    );
    const findJs = (dir: string): string => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findJs(full);
          if (found) return found;
        } else if (entry.name === "billing-calculator.js") {
          return full;
        }
      }
      return "";
    };
    const modPath = findJs(outDir);
    expect(modPath).not.toBe("");

    const monthsIn = (tz: string): number =>
      Number(
        execFileSync(
          "node",
          [
            "-e",
            `const m=require(${JSON.stringify(modPath)});` +
              `process.stdout.write(String(m.resolveMonthsActive(` +
              `'2026-09-01T00:00:00Z', new Date('2026-10-01T02:00:00Z'))))`,
          ],
          { env: { ...process.env, TZ: tz }, stdio: "pipe" }
        ).toString()
      );

    const utc = monthsIn("UTC");
    const sp = monthsIn("America/Sao_Paulo");
    const tk = monthsIn("Asia/Tokyo");
    console.log(
      `[MISSÃO 6] resolveMonthsActive real para mesmos instantes — UTC=${utc} SP=${sp} Tokyo=${tk}`
    );
    // 2026-09-01 → 2026-10-01 é mês ativo 2 em QUALQUER timezone.
    expect(utc).toBe(2);
    expect(sp).toBe(utc);
    expect(tk).toBe(utc);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test("[BUG-A] mesmo estado de assinatura cobra o tier do MÊS 2 (R$100), não o do dia do disparo", async () => {
    // Estado: motorista aprovado em 15/07; charge1 (trial) fechou ciclo1 em 14/08;
    // ciclo2 venceu em 13/09 (disparo "no dia" = R$100). O admin dispara HOJE.
    const userId = await makeUser();
    await seedSub(userId, {
      startedAt: new Date("2026-07-15T12:00:00Z"),
      trialEndsAt: new Date("2026-08-14T12:00:00Z"),
      periodStart: new Date("2026-08-14T12:00:00Z"),
      periodEnd: new Date("2026-09-13T12:00:00Z"),
      cycle: 2, // ciclo2 pendente (próxima taxa = mês 2 = R$100)
    });
    await walletEngine.ensureWallet(userId);
    await walletEngine.creditCents(userId, 100_000);

    // Evidência: o tier correto do ciclo é o mesmo on-time e hoje.
    const onTime = calculateMonthlyFee({
      monthsActive: resolveMonthsActive("2026-07-15T12:00:00Z", new Date("2026-09-13T12:00:00Z")),
      optedOutOfReserve: false,
    });
    const charge = await subscriptionEngine.chargeMonthlyFee(userId);

    console.log(
      `[BUG-A] ciclo2 (venceu 13/09): on-time(13/09)=R$${(onTime.totalFee / 100).toFixed(2)} ` +
        `| disparo hoje=${charge.success ? `R$${((charge.amountChargedCents ?? 0) / 100).toFixed(2)}` : "FALHOU"} ` +
        `(tier=${charge.tier})`
    );

    expect(charge.success).toBe(true);
    // O estado manda: ciclo2 pendente ⇒ R$100, independentemente do dia do disparo.
    expect(charge.amountChargedCents).toBe(10_000);

    // BUG-D: a parcela da reserva (49% do mês 2) precisa ser registrada e
    // LEGÍVEL em reserve_transactions (modelo reserve_id) — o insert/select
    // desta tabela explodia antes da correção (coluna wallet_id órfã).
    const reserveHistory = await db
      .select({ amount: reserve_transactions.amount, direction: reserve_transactions.direction })
      .from(reserve_transactions)
      .innerJoin(emergency_reserves, eq(emergency_reserves.id, reserve_transactions.reserveId))
      .where(eq(emergency_reserves.driverId, userId));
    console.log(
      `[BUG-D] histórico de reserva: ${reserveHistory.length} linha(s) ${JSON.stringify(reserveHistory)}`
    );
    expect(reserveHistory).toHaveLength(1);
    expect(reserveHistory[0].amount).toBe(4_900); // 49% de R$100,00
    expect(reserveHistory[0].direction).toBe("contribution");
  });

  test("[BUG-A] sequência de ciclos 0 → R$100 → R$200 é determinística (3 posições)", async () => {
    const positions: Array<{
      cycle: number;
      startedAt: Date;
      trialEnds: Date;
      periodEnd: Date;
      expected: number;
      label: string;
    }> = [
      {
        cycle: 1,
        startedAt: new Date(Date.now() - 31 * DAY),
        trialEnds: new Date(Date.now() - 1 * DAY),
        periodEnd: new Date(Date.now() - 1 * DAY),
        expected: 0,
        label: "charge1 fecha trial → R$0",
      },
      {
        cycle: 2,
        startedAt: new Date("2026-07-15T12:00:00Z"),
        trialEnds: new Date("2026-08-14T12:00:00Z"),
        periodEnd: new Date("2026-09-13T12:00:00Z"),
        expected: 10_000,
        label: "charge2 fecha mês2 → R$100",
      },
      {
        cycle: 3,
        startedAt: new Date("2026-06-01T12:00:00Z"),
        trialEnds: new Date("2026-07-01T12:00:00Z"),
        periodEnd: new Date("2026-07-31T12:00:00Z"),
        expected: 20_000,
        label: "charge3 fecha mês3 → R$200",
      },
    ];

    for (const pos of positions) {
      const userId = await makeUser();
      await seedSub(userId, {
        startedAt: pos.startedAt,
        trialEndsAt: pos.trialEnds,
        periodStart: pos.trialEnds,
        periodEnd: pos.periodEnd,
        cycle: pos.cycle,
      });
      await walletEngine.ensureWallet(userId);
      await walletEngine.creditCents(userId, 100_000);

      const charge = await subscriptionEngine.chargeMonthlyFee(userId);
      console.log(
        `[BUG-A] ${pos.label}: disparo=${charge.success} amount=${charge.amountChargedCents} tier=${charge.tier}`
      );
      expect(charge.success).toBe(true);
      expect(charge.amountChargedCents).toBe(pos.expected);
    }
  });

  test("[BUG-A] corrida: duas cobranças simultâneas do mesmo ciclo debitam exatamente 1×", async () => {
    const userId = await makeUser();
    await seedSub(userId, {
      startedAt: new Date("2026-07-15T12:00:00Z"),
      trialEndsAt: new Date("2026-08-14T12:00:00Z"),
      periodStart: new Date("2026-08-14T12:00:00Z"),
      periodEnd: new Date("2026-09-13T12:00:00Z"),
      cycle: 2,
    });
    await walletEngine.ensureWallet(userId);
    await walletEngine.creditCents(userId, 100_000);

    const [a, b] = await Promise.all([
      subscriptionEngine.chargeMonthlyFee(userId),
      subscriptionEngine.chargeMonthlyFee(userId),
    ]);

    const withAmount = [a, b].filter((r) => r.amountChargedCents !== undefined);
    console.log(
      `[BUG-A] corrida: a={success:${a.success}, amount:${a.amountChargedCents ?? "-"}}, ` +
        `b={success:${b.success}, amount:${b.amountChargedCents ?? "-"}}`
    );
    expect(withAmount).toHaveLength(1); // um cobra, o outro reconhece a cobrança
    expect([a, b].every((r) => r.success)).toBe(true);

    // Ledger: exatamente UM débito da mensalidade deste usuário.
    const wallet = await walletEngine.getWallet(userId);
    const debits = await db
      .select({ key: ledger_transactions.idempotencyKey })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.walletId, wallet!.id));
    const feeDebits = debits.filter(
      (d) => d.key !== null && d.key.startsWith(`subscription:${userId}`) && d.key.endsWith(":debit")
    );
    expect(feeDebits).toHaveLength(1);
  });

  test("[MISSÃO 3b] past_due: saldo insuficiente → atraso sem débito; fundir + reativar cobra o ciclo devido", async () => {
    const userId = await makeUser();
    await seedSub(userId, {
      startedAt: new Date(Date.now() - 60 * DAY),
      trialEndsAt: new Date(Date.now() - 30 * DAY),
      periodStart: new Date(Date.now() - 30 * DAY),
      periodEnd: new Date(Date.now() - 10 * DAY),
      cycle: 2,
    });
    // Carteira criada e SEM saldo.
    await walletEngine.ensureWallet(userId);

    const broke = await subscriptionEngine.chargeMonthlyFee(userId);
    console.log(`[MISSÃO 3b] sem saldo → success=${broke.success} status=${broke.status} msg="${broke.message}"`);
    expect(broke.success).toBe(false);
    expect(broke.status).toBe("past_due");

    // Débito nenhum aconteceu.
    const wallet = await walletEngine.getWallet(userId);
    const afterBroke = await db
      .select({ key: ledger_transactions.idempotencyKey })
      .from(ledger_transactions)
      .where(eq(ledger_transactions.walletId, wallet!.id));
    expect(
      afterBroke.filter((d) => d.key !== null && d.key.endsWith(":debit"))
    ).toHaveLength(0);

    // Recuperação documentada: sem saldo → past_due → precisa de ATIVAÇÃO
    // (a rota de charge recusa status != active) → depois cobra normal.
    const retryStuck = await subscriptionEngine.chargeMonthlyFee(userId);
    console.log(`[MISSÃO 3b] retry estando past_due → success=${retryStuck.success} msg="${retryStuck.message}"`);
    expect(retryStuck.success).toBe(false);

    await subscriptionEngine.activateSubscription(userId);
    await walletEngine.creditCents(userId, 50_000);
    const recovered = await subscriptionEngine.chargeMonthlyFee(userId);
    console.log(
      `[MISSÃO 3b] após fundir+ativar → success=${recovered.success} amount=${recovered.amountChargedCents} tier=${recovered.tier}`
    );
    expect(recovered.success).toBe(true);
    expect(recovered.amountChargedCents).toBe(10_000); // ciclo2 → R$100
  });
});
