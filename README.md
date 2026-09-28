# FairMove

Brazilian mobility platform with transparent economic relationship between passenger, driver, and platform.

## Architecture

FairMove is a modular monolith built with TypeScript, Node.js, and PostgreSQL. The project uses pnpm workspaces for dependency management.

## Structure

```
FairMove/
  apps/
    passenger/          # Passenger app (Expo + Expo Router)
    driver/             # Driver app (Expo + Expo Router)
  backend/              # Node.js Express entrypoint (backend/src/index.ts)
  packages/
    auth/               # Authentication (JWT, password hashing, sessions)
    config/             # Configuration utilities
    ui/                 # "FV Cinematic" design system (tema + componentes)
    fraud/              # Fraud detection engine
    matching/           # Driver matching / nearby search
    payments/           # Payment provider interface + Mock + settlement
    pricing/            # Pricing engine (calculateQuote)
    promotions/         # Promotion engine (coupons, campaigns)
    realtime/           # Redis publisher/subscriber (optional)
    reserves/           # Emergency reserve module
    rides/              # Ride requests and state machine
    safety/             # Safety features (SOS, trusted contacts, incidents)
    shared-db/          # Drizzle schema + lazy DB client
    shared-types/       # Shared TypeScript types and helpers
    subscriptions/      # Driver subscription billing
    users/              # User management (passengers + drivers)
    validation/         # Validation schemas (zod)
    vehicles/           # Vehicle management
    wallets/            # Financial wallet with ledger
  drizzle/              # SQL migrations (drizzle-kit)
  tests/                # Unit tests (Jest)
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 11.13.0+
- Docker (for PostgreSQL and Redis)

### Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and replace every placeholder with environment-specific values
4. Start infrastructure: `docker compose up -d`
5. Run migrations: `pnpm db:migrate` (or `pnpm db:push` for schema sync)
6. Build the backend: `pnpm build`
7. Start the backend: `pnpm start`
8. Run tests: `pnpm test`

### Environment configuration

Required variables (validated at boot): `DATABASE_URL` and `JWT_SECRET` (min 32 chars in production).

The `.env.example` values are designed for Docker Compose: the backend container resolves PostgreSQL using the `postgres` service hostname and listens on port `3000`. Keep `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL` identical.

When running the backend directly on the host instead of through Docker Compose, override only the database hostname in `DATABASE_URL` from `postgres` to `localhost`.

`REDIS_URL` is optional: without it the realtime layer runs as a no-op.

### Available Scripts

- `pnpm test` - Run all tests
- `pnpm lint` - Run lint check
- `pnpm typecheck` - Run typecheck
- `pnpm build` - Build TypeScript (tsc + tsc-alias)
- `pnpm start` - Run the built backend (`dist/backend/src/index.js`)
- `pnpm db:generate` - Generate a SQL migration from the Drizzle schema
- `pnpm db:migrate` - Apply pending migrations
- `pnpm db:push` - Push the schema directly to the database
- `pnpm db:studio` - Open Drizzle Studio
- `pnpm docker:up` - Start Docker infrastructure
- `pnpm docker:down` - Stop Docker infrastructure
- `pnpm db:seed-driver` - Seed idempotente de driver/admin reais (PASSO 4)
- `pnpm e2e:ride` - E2E REST da corrida completa (Postgres real)
- `pnpm demo:e2e` - Demo E2E tempo real: WebSocket +10 critérios &lt;1s

## Core Features (MVP)

### Payment Model

- Platform does NOT take commission from rides
- `driverCredit = passengerPrice` (exact same amount)
- Pricing calculated exclusively by backend
- Passenger and driver receive the same amount

### Driver Subscription

- First month: FREE
- Starting second month: R$100/month
- R$59 → platform revenue
- R$41 → driver emergency reserve (separate ledger)

### Ride States

- REQUESTED → SEARCHING → DRIVER_ASSIGNED → DRIVER_ARRIVING
- DRIVER_AT_PICKUP → PASSENGER_ONBOARD → IN_PROGRESS → COMPLETED
- CANCELLED_BY_PASSENGER, CANCELLED_BY_DRIVER, CANCELLED_BY_SYSTEM
- EXPIRED, DISPUTED

### Financial Ledger

- Double-entry ledger architecture
- wallets, wallet_accounts, ledger_transactions, ledger_entries
- reserve_transactions, emergency_reserves
- All operations are transactional, idempotent, and auditables
- Idempotency keys on critical operations

## Security

Hardening audit: all critical/high findings fixed, validated by automated
tests (`tests/security/double-spend.test.ts`,
`tests/security/race-conditions-and-idor.test.ts`,
`tests/security/ws-handshake.test.ts`,
`tests/security/subscription-trial.test.ts`) —
147 tests green.

Red team mission (full attack + fix cycle): see
[PENETRATION_TEST_REPORT.md](PENETRATION_TEST_REPORT.md),
[THREAT_MODEL.md](THREAT_MODEL.md) and [SECURITY.md](SECURITY.md).
Automated security regression suite lives in `tests/security/`
(7 suites, 42 tests, covering IDOR, JWT attacks, race conditions,
coupon limits, input validation and WS handshake).

### Critical

- **Wallet double-spend**: every balance mutation (`credit`, `debit`,
  `creditReserve`, `moveEmergencyReserve`, `moveRideSettlement`) now runs in a
  single database transaction; idempotency checks and ledger inserts are inside
  the same transaction (unique violation `23505` → rollback, balance unchanged).
- **JWT secrets**: startup fails if `JWT_SECRET`/`REFRESH_TOKEN_SECRET` are
  missing, shorter than 32 chars (64 in production), identical to each other,
  or if `JWT_EXPIRES_IN` uses days in production. Generate with
  `openssl rand -base64 48`.
- **Payments**: `POST /payments/*` requires JWT **and** `admin` role (was
  open to the world), body validated with Zod.
- **Ride state races**: a passenger can only hold one active ride (409);
  driver acceptance is an atomic claim (`available` driver row + ride row in
  one transaction) — two parallel accepts result in exactly one winner.
- **Password reset**: reset tokens are never written to logs
  (`token redacted from logs`) nor returned in responses.
- **Infrastructure**: Postgres/Redis bound to `127.0.0.1`, Redis requires a
  password (`REDIS_URL` with `requirepass`), ephemeral secrets generated per
  CI run (no hardcoded credentials in the workflow).

### High

- **Refresh tokens**: stored only as SHA-256 fingerprints (legacy plaintext
  rows are migrated on first use); reuse of a rotated token revokes the whole
  session; JWT verification pinned to `HS256`.
- **WebSocket**: token only via `Sec-WebSocket-Protocol: fairmove.auth` —
  never in the query string; server validates the session row on every
  handshake; handshake rate limited (15/min/IP).
- **Trial loop**: reactivation never re-grants the 30-day trial nor extends a
  billing period that already ended (monthly fee becomes due again).
- **Event enrollments**: capacity cap, reward balance check (402 if
  insufficient), deterministic idempotency key; admin-only leaderboard access.
- **Trust proxy**: off by default, enabled only via `TRUST_PROXY` env —
  `X-Forwarded-For` cannot forge rate-limit identity.

### Medium (selected)

- `/matching/drivers/nearby` and promotion campaigns are admin-only; fraud
  calculation details and event metadata stripped for non-admins; login rate
  limited per account (5/15min) plus per-IP auth limiter; generic registration
  error (no account enumeration); URL-encoded body limited to 10kb;
  `/health`/`/ready` expose status only (no internal error messages);
  `compression` enabled; error logs use stack traces instead of objects.

### Accepted risks (documented)

- Account enumeration is mitigated by rate limiting and a uniform
  "if an account exists" response, not fully eliminated.
- Mock payment gateway remains (no real PSP integrated yet): endpoint
  responses are simulated, but authorization rules and Zod validation are real.
- Node 20 Docker image fails to build this monorepo (`ERR_UNKNOWN_BUILTIN_MODULE`);
  local/staging runs on Node 22.

## Backend real + app mobile (staging local)

### 1. Infraestrutura (Postgres + Redis reais)
```bash
cp .env.example .env          # preencha POSTGRES_PASSWORD, JWT_SECRET, REFRESH_TOKEN_SECRET
docker compose up -d postgres redis
pnpm db:migrate               # aplica as migrações no Postgres real
pnpm build && pnpm start      # backend em http://localhost:3000
curl http://localhost:3000/ready   # {"status":"ready","checks":{"database":"up","redis":"up"}}
```

### 2. Expor a API para o celular (ngrok)
```bash
npm install -g ngrok
ngrok config add-authtoken <SEU_AUTHTOKEN>   # dashboard.ngrok.com/get-started
ngrok http 3000                              # gera https://xxxx.ngrok-free.app
```
Com a URL pública em mãos, atualize o app:
```bash
cp apps/driver/.env.example apps/driver/.env
# EXPO_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api/v1
```
Sem ngrok, o celular na mesma rede Wi-Fi usa o IP da máquina:
`EXPO_PUBLIC_API_URL=http://192.168.1.5:3000/api/v1` (veja com `hostname -I`).

### 3. Rodar o app do motorista
```bash
pnpm app:driver               # abre no Expo Go (celular) ou emulador
```
- Login/registro reais → `POST /api/v1/auth/*` (bcrypt 12, JWT 15min + refresh 7d)
- Tokens no SecureStore (Keychain/Keystore), refresh automático em 401
- Saldos/vazio: telas mostram R$ 0,00 e "sem dados" quando o banco está vazio

### 4. Contas de teste (via API real — nada fake no banco)
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nome","email":"voce@exemplo.com","password":"SenhaForte#2026"}'
```

### 5. Seed de motorista + E2E da corrida (PASSO 4)
```bash
pnpm build
pnpm db:seed-driver      # idempotente: driver@test.com (role=driver, mês 1 trial)
                         # + admin@fairmove.dev para funding via API
pnpm e2e:ride            # fluxo completo contra o Postgres real
```
O E2E executa: login motorista → register passageiro → admin credita R$ 50
(`POST /wallets/:id/credit`, ledger de dupla entrada) → cria corrida de
R$ 14,62 (pricing real, 2,3 km) → aceita → `DRIVER_ARRIVING → … → IN_PROGRESS`
→ `complete` com liquidação em transação única (`paymentMethod: "wallet"`,
sem gateway) → confere os saldos e o ledger no Postgres.
Re-execuções são seguras (register cai em 409→login; funding usa chave de
idempotência única por execução; corrida nova a cada rodada).

Nota: o engine de pricing pula de R$ 14,53 para R$ 14,62 num intervalo de
0,005 km (arredondamento do tempo) — não existe tarifa de R$ 14,56 sem cupom.

### 6. FASE 3 — ciclo completo em tempo real (WebSocket)

```bash
pnpm build
pnpm db:seed-driver
pnpm demo:e2e        # 10 critérios medidos, tudo <1s, outputs crus
```

A demo conecta dois WebSockets reais (`/ws?token=` — JWT validado no
handshake) e mede a latência ponta a ponta de cada etapa:

| Critério | Caminho | SLA |
|---|---|---|
| passageiro pediu → motorista recebe `ride:requested` | `POST /rides` → Redis Pub/Sub → `ST_DWithin` (PostGIS) → WS | &lt;1s |
| motorista aceita → passageiro vê `ride:matched` | `POST /rides/:id/accept` → Redis → WS (placa real) | &lt;1s |
| transições de status (`ride:status`) | `PATCH /rides/:id/status` → Redis → WS | &lt;1s |
| localização nos dois sentidos (`driver:location` / `passenger:location`) | WS ↔ WS | &lt;1s |
| `complete` → saldos + ledger (débito/crédito) | transação única `paymentMethod: "wallet"` | — |

Garantias da FASE 3:
- **Sem polling**: dados chegam por push; o único timer é o TX de
  localização (3s, outbound, só com motorista online).
- **Matching 100% PostGIS**: `ST_DWithin` (filtro) + `ST_DDistance`
  (ordenação) sobre `drivers.current_location_*` — distância nunca é
  calculada em JS no servidor.
- **Sem localização falsa**: motorista offline nunca transmite posição
  (servidor recusa) e sem permissão o app não envia nada.
- **Warm-up de boot**: plan PostGIS + conexão Redis do publicador são
  aquecidos no startup — o primeiro evento real não paga cold start
  (run frio mede ~292ms).
- **Reconexão automática**: backoff exponencial + jitter (1s → 30s) no
  app; JWT sempre reenviado no handshake.
- **Apps**: motorista (WS abre o modal de oferta com preço real, accept
  via `POST /rides/:id/accept`, online/offline real, TX de posição) e
  passageiro (pickup = posição do aparelho, destino = geocoding OSM
  real, quote do pricing antes de confirmar, acompanhamento da corrida
  por WS, histórico/saldo/extrato reais).

### Endpoints principais (v1)
| Método | Rota | Observação |
|---|---|---|
| POST | `/api/v1/auth/register` \| `login` \| `refresh` \| `logout` | JWT + blacklist Redis |
| GET | `/api/v1/drivers/me` | perfil real do usuário |
| GET | `/api/v1/wallets/me/balance` | saldo real (centavos) |
| POST | `/api/v1/wallets/deposit` | **501** enquanto não houver gateway PIX real |
| POST | `/api/v1/wallets/:userId/credit` | crédito manual (role=admin, ledger) |
| POST | `/api/v1/rides` | cria corrida (preço calculado no backend) |
| POST | `/api/v1/rides/:rideId/accept` \| `complete` | motorista aceita/conclui |
| PATCH | `/api/v1/rides/:rideId/status` | avanço de estados da corrida |
| GET | `/api/v1/rides/history/me` | histórico de corridas |
| POST | `/api/v1/matching/driver/status` | motorista online/offline (real) |
| POST | `/api/v1/matching/driver/location` | posição REST (o app usa WS) |
| GET | `/api/v1/matching/drivers/nearby?lat&lng&radiusKm` | busca PostGIS |
| POST | `/api/v1/pricing/quote` | orçamento real (persistido p/ auditoria) |
| WS | `/ws?token=<accessToken>` | eventos push (ver FASE 3) |
| POST | `/api/v1/subscriptions/:id/opt-out` | opt-out irreversível da reserva |
