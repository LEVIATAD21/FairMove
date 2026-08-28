# FairMove




Brazilian mobility platform with transparent economic relationship between passenger, driver, and platform.




## Architecture




FairMove is a modular monolith built with TypeScript, Node.js, and PostgreSQL. The project uses pnpm workspaces for dependency management.




## Structure




```
FairMove/
  apps/              # Passenger and Driver applications (React Native/Expo)
  packages/          # Shared packages
    shared-types/    # Shared TypeScript types
    design-system/   # Shared design system components
    validation/      # Validation schemas (zod)
    config/          # Configuration utilities
    auth/            # Authentication (JWT, password hashing, sessions)
    users/           # User management (passengers + drivers)
    vehicles/        # Vehicle management
    rides/           # Ride requests and state machine
    pricing/         # Pricing engine (calculateQuote)
    promotions/      # Promotion engine (coupons, campaigns)
    payments/        # Payment provider interface + Mock
    wallets/         # Financial wallet with ledger
    reserves/        # Emergency reserve module
    notifications/   # Notification provider
    safety/          # Safety features (SOS, trusted contacts)
    support/         # Support ticket system
    fraud/           # Fraud detection engine
  backend/           # Node.js Express backend
  docker/            # Docker configuration
  docs/              # Documentation
  tests/             # Unit tests
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
5. Run migrations: `pnpm db:push` (Drizzle ORM)
6. Start the backend: `pnpm start` (or `node backend/src/index.js`)
7. Run tests: `pnpm test`

### Environment configuration

The `.env.example` values are designed for Docker Compose: the backend container resolves PostgreSQL using the `postgres` service hostname and listens on port `3000`. Keep `POSTGRES_PASSWORD` and the password segment of `DATABASE_URL` identical.

When running the backend directly on the host instead of through Docker Compose, override only the database hostname in `DATABASE_URL` from `postgres` to `localhost`.




### Available Scripts




- `pnpm test` - Run all tests
- `pnpm lint` - Run lint check
- `pnpm typecheck` - Run typecheck
- `pnpm build` - Build TypeScript
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
