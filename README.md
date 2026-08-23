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
3. Copy .env.example to .env and configure
4. Start infrastructure: `docker-compose up -d`
5. Run migrations: `pnpm db:push` (Drizzle ORM)
6. Start the backend: `pnpm start` (or `node backend/src/index.js`)
7. Run tests: `pnpm test`

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

### Emergency Reserve

- Separate from operational balance
- Categories: fuel, maintenance, accident, mechanical, period without work, emergency
- All movements recorded in reserve_transactions table

### Pricing Engine

- base_fare + distance_fare + time_fare + dynamic_adjustment
- promotion_discount applied to final_passenger_price
- driverCredit = passengerPrice (mandatory rule)

### Mock Payment Provider

- Interface-based design (PaymentProvider)
- MockImplementation for MVP
- Easy to swap to real PSP without rewriting domain logic

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js 20
- **ORM**: Drizzle ORM
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **Package Manager**: pnpm
- **Testing**: Jest
- **CI**: GitHub Actions
- **Container**: Docker

## Monorepo Packages

- `@fairmove/shared-types` - Shared TypeScript types
- `@fairmove/design-system` - Design system components
- `@fairmove/validation` - Zod validation schemas
- `@fairmove/config` - Configuration utilities
- `@fairmove/auth` - Authentication service
- `@fairmove/users` - User management
- `@fairmove/vehicles` - Vehicle management
- `@fairmove/rides` - Ride state machine
- `@fairmove/pricing` - Pricing engine
- `@fairmove/promotions` - Promotion engine
- `@fairmove/payments` - Payment provider interface
- `@fairmove/wallets` - Financial wallet with ledger
- `@fairmove/reserves` - Emergency reserve module
- `@fairmove/notifications` - Notification provider
- `@fairmove/safety` - Safety features
- `@fairmove/support` - Support ticket system
- `@fairmove/fraud` - Fraud detection engine