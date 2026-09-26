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
