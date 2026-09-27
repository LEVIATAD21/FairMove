/**
 * DEMO E2E — ciclo completo em tempo real (FASE 3).
 *
 * Valida, contra o backend REAL (Postgres + Redis + WebSocket):
 *   1. passageiro solicita corrida;
 *   2. motorista recebe `ride:requested` via WebSocket em <1s;
 *   3. motorista aceita → passageiro vê `ride:matched` instantaneamente;
 *   4. ambos acompanham `ride:status` a cada transição (sem polling);
 *   5. localização em tempo real nos dois sentidos;
 *   6. finalização simultânea + saldo do motorista sobe / do passageiro desce;
 *   7. ledger com 2 entradas (débito + crédito) na transação da corrida.
 *
 * Uso: pnpm build && pnpm db:seed-driver && pnpm demo:e2e
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import { WebSocket } from "ws";
import { Client } from "pg";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = `${BASE}/api/v1`;
const SLA_MS = 1000;

// Coordenadas que o pricing real cobra R$ 14,62 (2,3 km — ver README PASSO 4).
const PICKUP = { lat: -23.5505, lng: -46.6333 };
const DROPOFF = { lat: -23.5505, lng: -46.61071170140521 };

interface ApiResponse<T = any> {
  status: number;
  json: T;
}

async function api<T = any>(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // resposta sem corpo
  }
  return { status: response.status, json };
}

function fail(message: string): never {
  console.error(`\nFALHA: ${message}`);
  process.exit(1);
}

function check(condition: boolean, label: string, detail = ""): void {
  if (!condition) fail(`${label} ${detail}`);
  console.log(`  OK  ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Cliente WS com fila de mensagens e espera tipada com medição de latência. */
class WsProbe {
  private ws: WebSocket;
  private queue: Array<{ type: string; data: any; at: number }> = [];
  private waiters: Array<{
    type: string;
    predicate: (data: any) => boolean;
    resolve: (msg: { type: string; data: any; at: number }) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      let msg: { type?: string; data?: any };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg.type) return;
      const entry = { type: msg.type, data: msg.data, at: Date.now() };
      const index = this.waiters.findIndex(
        (w) => w.type === entry.type && w.predicate(entry.data)
      );
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(entry);
      } else {
        this.queue.push(entry);
      }
      // descarta fila antiga para não crescer sem limite
      if (this.queue.length > 200) this.queue.splice(0, 100);
    });
  }

  static connect(token: string, label: string): Promise<WsProbe> {
    const wsUrl = `${BASE.replace(/^http/, "ws")}/ws`;
    return new Promise((resolve, reject) => {
      // Token via subprotocolo — nunca na query string (vazaria nos logs).
      const ws = new WebSocket(wsUrl, ["fairmove.auth", token]);
      const probe = new WsProbe(ws);
      const timer = setTimeout(
        () => reject(new Error(`${label}: timeout conectando ao /ws`)),
        5000
      );
      ws.on("open", () => {
        probe
          .waitFor("hello", 5000)
          .then(() => {
            clearTimeout(timer);
            console.log(`  OK  ${label} conectado ao /ws (JWT validado no handshake)`);
            resolve(probe);
          })
          .catch(reject);
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  waitFor(
    type: string,
    timeoutMs: number,
    predicate: (data: any) => boolean = () => true
  ): Promise<{ type: string; data: any; at: number }> {
    const queued = this.queue.findIndex((m) => m.type === type && predicate(m.data));
    if (queued >= 0) {
      const [msg] = this.queue.splice(queued, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout ${timeoutMs}ms esperando evento '${type}'`));
      }, timeoutMs);
      this.waiters.push({ type, predicate, resolve, reject, timer });
    });
  }

  send(type: string, data: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ type, data }));
  }

  close(): void {
    this.ws.close();
  }
}

async function ensurePassenger(): Promise<{ token: string; userId: string }> {
  const email = "e2e.passenger@fairmove.dev";
  const password = "Test123!";
  const login = await api("POST", "/auth/login", undefined, { email, password });
  if (login.status === 200) {
    return { token: login.json.token, userId: login.json.user.id };
  }
  const register = await api("POST", "/auth/register", undefined, {
    name: "Passageiro E2E",
    email,
    password,
  });
  if (register.status !== 201) fail(`register passageiro → HTTP ${register.status}`);
  return { token: register.json.token, userId: register.json.user.id };
}

async function login(email: string, password: string): Promise<string> {
  const response = await api("POST", "/auth/login", undefined, { email, password });
  if (response.status !== 200) fail(`login ${email} → HTTP ${response.status}`);
  return response.json.token;
}

async function balance(token: string): Promise<number> {
  const response = await api("GET", "/wallets/me/balance", token);
  if (response.status !== 200) fail(`balance → HTTP ${response.status}`);
  return response.json.availableBalance as number;
}

async function main(): Promise<void> {
  console.log(`\n=== DEMO E2E FASE 3 — ${BASE} ===`);

  // 0) contas reais (seed idempotente do PASSO 4)
  const seed = spawnSync(process.execPath, ["dist/scripts/seed-driver.js"], {
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    fail(`seed-driver falhou:\n${seed.stderr || seed.stdout}`);
  }
  console.log("  OK  seed de motorista/admin executado");

  const driverToken = await login("driver@test.com", "Test123!");
  const passenger = await ensurePassenger();
  const adminToken = await login("admin@fairmove.dev", "Test123!");

  // limpeza de corridas pendentes de runs anteriores (o cancel real do
  // passageiro também devolve available=true ao motorista)
  const history = await api("GET", "/rides/history/me", passenger.token);
  const pending: Array<{ id: string; status: string }> = (history.json?.rides ?? []).filter(
    (r: { id: string; status: string }) =>
      r.status !== "COMPLETED" && !r.status.startsWith("CANCELLED")
  );
  for (const r of pending) {
    const cancelled = await api("POST", `/rides/${r.id}/cancel`, passenger.token, {
      reason: "demo cleanup",
    });
    if (cancelled.status === 200) {
      console.log(`  OK  cancelada corrida pendente ${r.id.slice(0, 8)} (${r.status})`);
    }
  }

  // 1) WebSocket dos dois lados (handshake JWT)
  const driverWs = await WsProbe.connect(driverToken, "motorista");
  const passengerWs = await WsProbe.connect(passenger.token, "passageiro");

  // 2) funding real do passageiro (ledger de dupla entrada, role=admin)
  const credit = await api("POST", `/wallets/${passenger.userId}/credit`, adminToken, {
    amount: 50,
    description: "DEMO E2E FASE3 funding",
    idempotencyKey: `demo-e2e-funding-${Date.now()}`,
  });
  if (credit.status !== 201) fail(`funding → HTTP ${credit.status}`);
  const passengerBefore = await balance(passenger.token);
  const driverBefore = await balance(driverToken);
  console.log(
    `  OK  funding: passageiro=${passengerBefore}¢ motorista=${driverBefore}¢`
  );

  // 3) passageiro solicita → motorista recebe em <1s
  const t0 = Date.now();
  const ride = await api("POST", "/rides", passenger.token, {
    pickupLocationLat: PICKUP.lat,
    pickupLocationLng: PICKUP.lng,
    dropoffLocationLat: DROPOFF.lat,
    dropoffLocationLng: DROPOFF.lng,
  });
  if (ride.status !== 201) fail(`criar corrida → HTTP ${ride.status} ${JSON.stringify(ride.json)}`);
  const rideId: string = ride.json.rideId;
  const requested = await driverWs.waitFor("ride:requested", SLA_MS + 4000);
  const latencyRequested = requested.at - t0;
  console.log(
    `  --  passageiro pediu ${ride.json.totalFare} → motorista recebeu ride:requested em ${latencyRequested}ms`
  );
  check(latencyRequested < SLA_MS, "critério 2: motorista recebe em <1s", `(${latencyRequested}ms)`);
  check(requested.data.rideId === rideId, "payload ride:requested correto");
  check(requested.data.originalPrice === 14.62, "preço real no evento", String(requested.data.originalPrice));

  // 4) motorista aceita → passageiro vê na hora
  const t1 = Date.now();
  const accept = await api("POST", `/rides/${rideId}/accept`, driverToken);
  if (accept.status !== 200) fail(`accept → HTTP ${accept.status} ${JSON.stringify(accept.json)}`);
  const matched = await passengerWs.waitFor("ride:matched", SLA_MS + 4000);
  const latencyMatched = matched.at - t1;
  console.log(`  --  passageiro recebeu ride:matched em ${latencyMatched}ms`);
  check(latencyMatched < SLA_MS, "critério 4: passageiro vê aceitação <1s", `(${latencyMatched}ms)`);
  check(matched.data.vehiclePlate === "FMOV0001", "dados reais do motorista", matched.data.vehiclePlate);

  // 5) transições de status → ambos acompanham sem polling
  for (const status of [
    "DRIVER_ARRIVING",
    "DRIVER_AT_PICKUP",
    "PASSENGER_ONBOARD",
    "IN_PROGRESS",
  ]) {
    const t = Date.now();
    const patch = await api("PATCH", `/rides/${rideId}/status`, driverToken, { status });
    if (patch.status !== 200) fail(`status ${status} → HTTP ${patch.status}`);
    const passengerMsg = await passengerWs.waitFor(
      "ride:status",
      SLA_MS + 4000,
      (d) => d.status === status
    );
    check(passengerMsg.at - t < SLA_MS, `critério: passageiro vê ${status} <1s`);
  }

  // 6) localização em tempo real nos dois sentidos
  const tDriverLoc = Date.now();
  driverWs.send("driver:location", { lat: -23.5508, lng: -46.6335 });
  const driverLoc = await passengerWs.waitFor("driver:location", SLA_MS + 4000);
  check(
    driverLoc.at - tDriverLoc < SLA_MS,
    "critério 6: passageiro vê motorista se movendo <1s",
    `(${driverLoc.at - tDriverLoc}ms)`
  );

  const tPassLoc = Date.now();
  passengerWs.send("passenger:location", { lat: -23.5506, lng: -46.6334 });
  const passLoc = await driverWs.waitFor("passenger:location", SLA_MS + 4000);
  check(
    passLoc.at - tPassLoc < SLA_MS,
    "critério 5: motorista vê localização do passageiro <1s",
    `(${passLoc.at - tPassLoc}ms)`
  );

  // 7) finalização → ambos recebem ao mesmo tempo
  const t2 = Date.now();
  const complete = await api("POST", `/rides/${rideId}/complete`, driverToken);
  if (complete.status !== 200) fail(`complete → HTTP ${complete.status}`);
  check(complete.json.paymentMethod === "wallet", "liquidação em carteira (sem gateway mock)");
  const passengerEnd = await passengerWs.waitFor(
    "ride:status",
    SLA_MS + 4000,
    (d) => d.status === "COMPLETED"
  );
  const driverEnd = await driverWs.waitFor(
    "ride:status",
    SLA_MS + 4000,
    (d) => d.status === "COMPLETED"
  );
  const maxEnd = Math.max(passengerEnd.at - t2, driverEnd.at - t2);
  check(maxEnd < SLA_MS, "critério 8: ambos veem 'Corrida finalizada' <1s", `(${maxEnd}ms)`);

  // 8) saldos
  const driverAfter = await balance(driverToken);
  const passengerAfter = await balance(passenger.token);
  const fareCents = Math.round(complete.json.totalFare * 100);
  check(
    driverAfter - driverBefore === fareCents,
    "critério 9a: saldo do motorista aumentou",
    `${driverBefore}→${driverAfter}¢ (+${fareCents})`
  );
  check(
    passengerBefore - passengerAfter === fareCents,
    "critério 9b: saldo do passageiro diminuiu",
    `${passengerBefore}→${passengerAfter}¢ (-${fareCents})`
  );

  // 9) ledger: exatamente 2 lançamentos (débito + crédito) para esta corrida
  if (!process.env.DATABASE_URL) fail("DATABASE_URL ausente para conferir o ledger");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  const ledger = await pg.query(
    `SELECT transaction_type, amount FROM ledger_transactions
     WHERE idempotency_key IN ($1, $2) ORDER BY transaction_type`,
    [`ride:${rideId}:passenger-debit`, `ride:${rideId}:driver-credit`]
  );
  await pg.end();
  check(ledger.rowCount === 2, "critério 10: ledger tem 2 entradas", `${ledger.rowCount} linhas`);
  const types = ledger.rows.map((r: { transaction_type: string }) => r.transaction_type).join(",");
  check(types === "credit,debit", "ledger = débito + crédito", types);

  driverWs.close();
  passengerWs.close();

  console.log("\nDEMO E2E FASE 3 OK — 10/10 critérios validados em tempo real.");
}

main().catch((error) => {
  console.error("\nFALHA:", error instanceof Error ? error.message : error);
  process.exit(1);
});
