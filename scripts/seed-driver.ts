/**
 * Seed de contas de teste REAIS para o E2E da corrida (PASSO 4).
 *
 * - Escreve APENAS no Postgres real (banco configurado em .env).
 * - Idempotente: pode ser executado quantas vezes for preciso.
 * - Cria:
 *   1. motorista driver@test.com (role "driver", senha Test123!),
 *      profile com telefone, linha em drivers (online/available),
 *      carteira 0/0 e assinatura ativa mês 1 (trial) via subscriptionEngine;
 *   2. admin admin@fairmove.dev (role "admin") — usado pelo E2E para
 *      creditar a carteira do passageiro via POST /api/v1/wallets/:id/credit.
 *
 * Uso: pnpm build && node dist/scripts/seed-driver.js
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, users, profiles, drivers, vehicles } from "@fairmove/shared-db";
import { hashPassword } from "../packages/auth/src/utils/password";
import { subscriptionEngine } from "../packages/subscriptions/src/engine/subscription-engine";
import { walletEngine } from "../packages/wallets/src/engine/wallet-engine";

interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: "driver" | "admin";
}

const DRIVER_ACCOUNT: SeedAccount = {
  email: "driver@test.com",
  password: "Test123!",
  name: "Motorista Teste",
  role: "driver",
};

const ADMIN_ACCOUNT: SeedAccount = {
  email: "admin@fairmove.dev",
  password: "Test123!",
  name: "Admin Teste",
  role: "admin",
};

/** Praça de São Paulo — ponto de referência do motorista no seed. */
const DRIVER_HOME_LAT = "-23.5505";
const DRIVER_HOME_LNG = "-46.6333";

async function upsertAccount(account: SeedAccount): Promise<{ id: string; created: boolean }> {
  const passwordHash = await hashPassword(account.password);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, account.email));

  if (existing.length > 0) {
    const id = existing[0].id;
    await db
      .update(users)
      .set({ name: account.name, role: account.role, passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
    return { id, created: false };
  }

  const inserted = await db
    .insert(users)
    .values({
      name: account.name,
      email: account.email,
      passwordHash,
      role: account.role,
    })
    .returning({ id: users.id });
  return { id: inserted[0].id, created: true };
}

async function ensureProfile(userId: string, phone: string): Promise<void> {
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, userId));

  if (existing.length === 0) {
    await db.insert(profiles).values({ userId, phone });
  } else {
    await db
      .update(profiles)
      .set({ phone, updatedAt: new Date() })
      .where(eq(profiles.id, existing[0].id));
  }
}

async function ensureDriverRow(userId: string): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, userId));

  if (existing.length > 0) {
    const id = existing[0].id;
    // Estado base conhecido do ambiente de teste: uma corrida aceitada e
    // abandonada deixa available=false; o seed sempre devolve o motorista
    // ao estado online/disponível em casa.
    await db
      .update(drivers)
      .set({
        status: "online",
        available: true,
        currentLocationLat: DRIVER_HOME_LAT,
        currentLocationLng: DRIVER_HOME_LNG,
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, id));
    return { id, created: false };
  }

  const inserted = await db
    .insert(drivers)
    .values({
      userId,
      status: "online",
      available: true,
      currentLocationLat: DRIVER_HOME_LAT,
      currentLocationLng: DRIVER_HOME_LNG,
    })
    .returning({ id: drivers.id });
  return { id: inserted[0].id, created: true };
}

/** Veículo real do motorista — obrigatório para o matching (PostGIS nearby). */
async function ensureVehicle(driverRowId: string): Promise<{ created: boolean }> {
  const existing = await db
    .select({ id: vehicles.id, vehicleType: vehicles.vehicleType })
    .from(vehicles)
    .where(eq(vehicles.driverId, driverRowId));

  let vehicleId: string;
  if (existing.length === 0) {
    const inserted = await db
      .insert(vehicles)
      .values({
        driverId: driverRowId,
        brand: "Fiat",
        model: "Argo",
        year: 2020,
        color: "Branco",
        plate: "FMOV0001",
        vehicleType: "car",
      })
      .returning({ id: vehicles.id });
    vehicleId = inserted[0].id;
  } else {
    vehicleId = existing[0].id;
  }

  const row = await db
    .select({ vehicleId: drivers.vehicleId })
    .from(drivers)
    .where(eq(drivers.id, driverRowId));
  if (row[0]?.vehicleId !== vehicleId) {
    await db.update(drivers).set({ vehicleId }).where(eq(drivers.id, driverRowId));
  }

  return { created: existing.length === 0 };
}

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@");
  console.log("[seed-driver] conectando ao Postgres real (%s)", dbUrl || "DATABASE_URL não encontrada");

  const driver = await upsertAccount(DRIVER_ACCOUNT);
  console.log(
    "[seed-driver] users: motorista %s → %s (id=%s, role=driver, senha=Test123!)",
    DRIVER_ACCOUNT.email,
    driver.created ? "CRIADO" : "ATUALIZADO",
    driver.id
  );

  await ensureProfile(driver.id, "+5511999999999");
  console.log("[seed-driver] profiles: telefone +5511999999999 garantido");

  const driverRow = await ensureDriverRow(driver.id);
  console.log(
    "[seed-driver] drivers: linha %s (id=%s, status=online, available=true, home=%s,%s)",
    driverRow.created ? "CRIADA" : "EXISTENTE",
    driverRow.id,
    DRIVER_HOME_LAT,
    DRIVER_HOME_LNG
  );

  const vehicle = await ensureVehicle(driverRow.id);
  console.log(
    "[seed-driver] vehicles: %s (Fiat Argo 2020, placa FMOV0001, car)",
    vehicle.created ? "CRIADO" : "EXISTENTE"
  );

  await walletEngine.ensureWallet(driver.id);
  console.log("[seed-driver] wallets: carteira do motorista garantida (0/0/0)");

  const sub = await subscriptionEngine.activateSubscription(driver.id);
  console.log(
    "[seed-driver] subscriptions: %s (cycle=1, trial, opted_out_of_reserve=false) — %s",
    sub.success ? "ATIVADA" : "JÁ EXISTE",
    sub.message
  );

  const admin = await upsertAccount(ADMIN_ACCOUNT);
  console.log(
    "[seed-driver] users: admin %s → %s (id=%s, role=admin) — funding do E2E via API",
    ADMIN_ACCOUNT.email,
    admin.created ? "CRIADO" : "ATUALIZADO",
    admin.id
  );

  console.log("[seed-driver] OK — contas reais prontas, nenhum dado de negócio inventado.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed-driver] FALHOU:", error);
    process.exit(1);
  });
