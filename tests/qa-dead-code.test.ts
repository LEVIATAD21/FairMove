/**
 * QA AUDIT — Área 7: código morto, console.log e TODOs (scan executável).
 *
 * Bugs-alvo:
 *  [BUG-J1] DISPUTED era um estado da máquina de estados sem NENHUMA transição
 *           de entrada/saída e nunca era setado — enum morto espalhado por
 *           machine.ts, RideStatusSchema e shared-types.
 *  [BUG-J2] 8 exports de runtime sem uso em lugar nenhum (código morto com
 *           custo de manutenção):
 *           - canAccessRide (wrapper morto de loadRideForUser)
 *           - getActiveDriverDiscountPercent (duplicata morta — o subscription-
 *             engine tem a própria resolução de desconto ativa)
 *           - refreshTokenFingerprint (+helper sha256 do blacklist)
 *           - PLATFORM_REVENUE_ACCOUNT / DISCIPLINE_RESERVE_ACCOUNT (design
 *             antigo; o ledger usa a wallet do usuário platform)
 *           - RideStatusUpdateSchema / CouponSchema (rotas usam schemas inline)
 *           - SPLASH_SEQUENCE / RIDE_STATES / FAIR_PROMO_EXAMPLE (brand.ts)
 *
 * Guardas: console.log só no allowlist operacional (boot/cron/scheduler) e
 * TODO só no allowlist documentado (integracao de e-mail).
 *
 * NÃO requer DATABASE_URL (scan de fonte + execução da máquina de estados).
 */
import fs from "fs";
import path from "path";
import { canTransition } from "../packages/rides/src/state/machine";

const ROOT = path.resolve(__dirname, "..");
const SRC_ROOTS = ["packages", "backend/src"];

function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  for (const root of SRC_ROOTS) {
    const dir = path.join(ROOT, root);
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

function rel(file: string): string {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

describe("QA audit: código morto e higiene de código", () => {
  const files = listSourceFiles();

  test("[J-1] DISPUTED é inalcançável na máquina de estados", () => {
    const statuses = [
      "REQUESTED",
      "SEARCHING",
      "DRIVER_ASSIGNED",
      "DRIVER_ARRIVING",
      "DRIVER_AT_PICKUP",
      "PASSENGER_ONBOARD",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED_BY_PASSENGER",
      "CANCELLED_BY_DRIVER",
      "CANCELLED_BY_SYSTEM",
      "EXPIRED",
    ] as const;
    // Nenhum estado chega a DISPUTED nem sai dele.
    for (const from of statuses) {
      expect(canTransition(from, "DISPUTED")).toBe(false);
    }
    expect(canTransition("DISPUTED", "COMPLETED")).toBe(false);
  });

  test("[J-2] sem exports mortos definidos no código de produção", () => {
    const forbiddenDefinitions = [
      /\bDISPUTED\b/,
      /export\s+(?:async\s+)?function\s+canAccessRide\b/,
      /export\s+(?:async\s+)?function\s+getActiveDriverDiscountPercent\b/,
      /export\s+function\s+refreshTokenFingerprint\b/,
      /export\s+const\s+PLATFORM_REVENUE_ACCOUNT\b/,
      /export\s+const\s+DISCIPLINE_RESERVE_ACCOUNT\b/,
      /export\s+const\s+RideStatusUpdateSchema\b/,
      /export\s+const\s+CouponSchema\b/,
      /export\s+const\s+SPLASH_SEQUENCE\b/,
      /export\s+const\s+RIDE_STATES\b/,
      /export\s+const\s+FAIR_PROMO_EXAMPLE\b/,
    ];
    const found: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const pattern of forbiddenDefinitions) {
        if (pattern.test(src)) {
          found.push(`${pattern} em ${rel(file)}`);
        }
      }
    }
    console.log(`[J-2] definições mortas encontradas: ${JSON.stringify(found)}`);
    expect(found).toEqual([]); // RED pré-limpeza: DISPUTED + 8 exports
  });

  test("[J-3] console.log restrito ao allowlist operacional", () => {
    const allowlist = [
      "packages/events/src/scheduler.ts", // logs do agendador de leaderboards
      "backend/src/index.ts", // boot, cron RideExpiry, shutdown
    ];
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (/console\.log\(/.test(line) && !allowlist.includes(rel(file))) {
          violations.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    console.log(`[J-3] console.log fora do allowlist: ${JSON.stringify(violations)}`);
    expect(violations).toEqual([]);
  });

  test("[J-4] TODO/FIXME só no allowlist documentado", () => {
    const allowlist = [
      "packages/auth/src/routes.ts:344", // integracao de provedor de e-mail (pendencia real)
    ];
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
          const id = `${rel(file)}:${i + 1}`;
          if (!allowlist.some((a) => id === a || id.startsWith(a + ":"))) {
            violations.push(`${id}: ${line.trim().slice(0, 100)}`);
          }
        }
      });
    }
    console.log(`[J-4] TODOs fora do allowlist: ${JSON.stringify(violations)}`);
    expect(violations).toEqual([]);
  });
});
