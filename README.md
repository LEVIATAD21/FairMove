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

- Node.js 22.x (CI and Docker use Node 22)
- pnpm 11.13.1+
- Docker (for PostgreSQL and Redis)

### Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Configure required variables in an untracked local `.env` file; never commit credentials
4. Start only the local database and cache: `docker compose up -d postgres redis`
5. Set `DATABASE_URL` to a host-reachable URL using `localhost:5432`, then run versioned migrations: `pnpm db:migrate`
6. Build the backend: `pnpm build`
7. Start the host backend on the same port used by the apps: `NODE_ENV=development PORT=3000 pnpm start`
8. Run tests: `pnpm test`

This Quick Start runs the backend on the host. Do not start the Compose `backend` service in this mode; it is for container-network deployment, where `DATABASE_URL` must use the `postgres` service hostname. Apply versioned migrations before starting the containerized backend.

### Environment configuration

Required variables include `DATABASE_URL`, `JWT_SECRET`, and a distinct `REFRESH_TOKEN_SECRET`; production secrets must be at least 64 characters and must come from a secret manager.

Docker Compose requires `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, a distinct `REFRESH_TOKEN_SECRET`, and an explicit `CORS_ORIGIN`. The containerized backend resolves PostgreSQL using the `postgres` service hostname and listens on port `3000`; the host-run backend uses `localhost` in `DATABASE_URL`. Keep `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL` identical. Production requires an explicit HTTPS CORS origin; only local development may use `http://localhost:3000`. There is no committed production `.env`; keep local credentials untracked.

When running the backend directly on the host instead of through Docker Compose, override only the database hostname in `DATABASE_URL` from `postgres` to `localhost`.

`REDIS_URL` is optional: without it the realtime layer runs as a no-op.

Production authentication mail uses the Resend HTTPS adapter. Set `RESEND_API_KEY` and `EMAIL_FROM` in the deployment secret manager only after verifying the sender/domain in Resend. Never commit these values. Production registration requires email verification; registration, verification resend, and password-recovery flows return HTTP 503 if delivery is unconfigured or rejected by the provider.

### Primeiro Acesso em Produção

Em produção as credenciais vêm **apenas** de variáveis de ambiente seguras
(secret manager / cofre) — nada de senhas em código, repo ou logs.

1. Configure os segredos diretamente no secret manager de produção. Para desenvolvimento local, use um `.env` não versionado. Gere os segredos:
   ```bash
   openssl rand -base64 48  # JWT_SECRET
   openssl rand -base64 48  # REFRESH_TOKEN_SECRET (deve ser DIFERENTE do anterior)
   ```
2. Rode as migrações:
   ```bash
   pnpm db:migrate
   ```
3. Provisione a primeira conta administrativa somente por um procedimento operacional privado, revisado e auditado, executado por operador autorizado com acesso restrito ao banco. Esse procedimento deve criar a identidade, definir o papel e registrar auditoria; não existe bootstrap administrativo por rota pública e esse passo não deve ser automatizado pelo app.
4. Confirme a identidade do operador, habilite MFA no provedor operacional e valide o acesso administrativo fora dos apps públicos.
5. Nunca configure `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` em produção nem mantenha credenciais iniciais persistentes.

Contas E2E só podem ser criadas em bancos não produtivos com `FAIRMOVE_ENABLE_TEST_SEED=true`; o script recusa `NODE_ENV=production`.

### Available Scripts

- `pnpm test` - Run all tests
- `pnpm lint` - Run lint check
- `pnpm typecheck` - Run typecheck
- `pnpm build` - Build TypeScript (tsc + tsc-alias)
- `pnpm start` - Run the built backend (`dist/backend/src/index.js`)
- `pnpm db:generate` - Generate a SQL migration from the Drizzle schema
- `pnpm db:migrate` - Apply pending migrations
- `pnpm db:push` - Disposable local database only; do not use as the migration process for shared, staging, or production databases
- `pnpm db:studio` - Open Drizzle Studio
- `pnpm docker:up` - Start Docker infrastructure
- `pnpm docker:down` - Stop Docker infrastructure
- `NODE_ENV=development FAIRMOVE_ENABLE_TEST_SEED=true pnpm db:seed-driver` - fixtures sintéticas em banco local; exige NODE_ENV development/test, flag explícita e host local/Docker Compose
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

Hardening audit and automated regression coverage include
`tests/security/double-spend.test.ts`,
`tests/security/race-conditions-and-idor.test.ts`,
`tests/security/ws-handshake.test.ts`, and
`tests/security/subscription-trial.test.ts`. Verify the CI result for the exact commit being released; historical test counts are not a release guarantee.

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
- **Payments**: `POST /payments/*` requires JWT **and** `admin` role, and validates bodies with Zod. The current provider is an in-memory mock; production requests are deliberately rejected with HTTP 503 until a real PSP is integrated.
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
- No real PSP is integrated yet. Mock payment endpoints are disabled in production with HTTP 503; card/PIX collection, verified webhooks, reconciliation, and settlement still block a real launch.
- The release-readiness PR runs migrations, tests, production Android bundle exports, TypeScript compilation, and a Docker build; verify the latest GitHub Actions result before merging.

## Backend real + app mobile (staging local)

### 1. Infraestrutura (Postgres + Redis reais)
```bash
# Configure um .env local não versionado com POSTGRES_PASSWORD, REDIS_PASSWORD, DATABASE_URL, JWT_SECRET e REFRESH_TOKEN_SECRET
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
# Defina EXPO_PUBLIC_API_URL no ambiente local não versionado:
# EXPO_PUBLIC_API_URL=https://xxxx.ngrok-free.app/api/v1
```
Sem ngrok, em desenvolvimento, o celular na mesma rede Wi-Fi usa o IP da máquina:
`EXPO_PUBLIC_API_URL=http://192.168.1.5:3000/api/v1` (veja com `hostname -I`). Em produção, a URL deve ser HTTPS.

### 3. Rodar o app do motorista
```bash
pnpm app:driver               # abre no Expo Go (celular) ou emulador
```
- Login/registro reais → `POST /api/v1/auth/*` (bcrypt 12, JWT 15min + refresh 7d)
- Tokens no SecureStore (Keychain/Keystore), refresh automático em 401
- Saldos/vazio: telas mostram R$ 0,00 e "sem dados" quando o banco está vazio

### 4. Criar contas reais (via API real — nada fake no banco)
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Nome","email":"contato@fairmove.com.br","password":"SUA_SENHA_FORTE_AQUI"}'
```

### 5. Fixtures sintéticas de motorista + E2E da corrida (somente desenvolvimento)
```bash
pnpm build
NODE_ENV=development FAIRMOVE_ENABLE_TEST_SEED=true pnpm db:seed-driver # fixtures sintéticas; apenas banco local de E2E
                         # + admin@fairmove.com.br para funding via API
                         # senhas em .env (gitignored) — ver "Primeiro Acesso"
pnpm e2e:ride            # fluxo completo contra o Postgres real
```
O E2E local usa contas sintéticas: login motorista → register passageiro → admin de teste credita R$ 50
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
FAIRMOVE_ENABLE_TEST_SEED=true pnpm db:seed-driver
pnpm demo:e2e        # 10 critérios medidos, tudo <1s, outputs crus
```

A demo conecta dois WebSockets reais (`/ws`, JWT validado no handshake por
`Sec-WebSocket-Protocol: fairmove.auth`) e mede a latência ponta a ponta:

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

### Play Store / EAS — requisitos de release

Os apps de passageiro e motorista têm perfis EAS separados em `apps/passenger/eas.json` e `apps/driver/eas.json`: desenvolvimento, preview interno (APK) e produção (Android App Bundle). Para cada build de produção, configure `EXPO_PUBLIC_API_URL` no ambiente de build EAS como a origem HTTPS da API publicada. A configuração dinâmica rejeita builds de produção sem URL HTTPS, e os clientes móveis não podem cair silenciosamente em `localhost`.

Ainda exigem configuração nas contas do proprietário: vincular os projetos EAS, configurar assinatura Android, implantar a API em domínio HTTPS real e cadastrar os segredos de produção no cofre de deploy. O adaptador de e-mail Resend está conectado, mas o e-mail de produção não estará ativo até configurar `RESEND_API_KEY` e um `EMAIL_FROM` verificado, e testar a entrega de ponta a ponta. A integração de um provedor de pagamento real (PIX/cartão, webhooks verificados, reconciliação, estornos e disputas) continua pendente; os endpoints financeiros permanecem bloqueados em produção para não simular movimentação de dinheiro. O SOS também precisa de despacho real verificado. O proprietário ainda deve preparar política de privacidade, Termos de Uso, declarações Data safety e justificativas de permissões da Google Play, testar em aparelhos Android físicos e com acessibilidade, e executar uma faixa de teste interno no Play Console. Exports do CI não são AABs assinados e nenhuma publicação foi disparada automaticamente.

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
| WS | `/ws` + `Sec-WebSocket-Protocol: fairmove.auth` | eventos push (ver FASE 3) |
| POST | `/api/v1/subscriptions/:id/opt-out` | endpoint legado, retorna 410; a contribuição de R$ 41/mês é fixa |
