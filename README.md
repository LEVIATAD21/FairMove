# FairMove

Brazilian mobility platform with a transparent economic relationship between passenger, driver, and platform.

## Architecture

FairMove is a modular monolith built with TypeScript, Node.js, PostgreSQL/PostGIS, Redis, and pnpm workspaces.

## Structure

```
FairMove/
  apps/
    passenger/          # Passenger app (Expo + Expo Router)
    driver/             # Driver app (Expo + Expo Router)
  backend/              # Node.js Express API
  packages/             # Domain modules, shared DB/types, design system
  drizzle/              # SQL migrations
  tests/                # Automated tests
```

## Runtime requirements

- Node.js 22.x (the CI and Docker toolchain use Node 22)
- pnpm 11.13.0
- Docker Engine / Docker Compose for local infrastructure
- PostgreSQL/PostGIS and Redis for the backend services

## Local development

1. Install Node.js 22 and pnpm 11.13.0.
2. Configure the required environment variables in your local secret store or untracked `.env` file. Never commit real credentials.
3. Start infrastructure with `docker compose up -d`.
4. Install dependencies with `pnpm install --frozen-lockfile`.
5. Apply the schema with `pnpm db:migrate` (preferred for repeatable environments); use `pnpm db:push` only for disposable development databases.
6. Run checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
7. Start the API with `pnpm start`; run the passenger and driver apps from their respective Expo scripts.

## Production secrets

Production credentials must be configured directly in the deployment platform's secret manager. Do not place production keys, passwords, payment credentials, signing keys, or personal data in Git, app bundles, logs, or this repository. Generate distinct high-entropy JWT and refresh-token secrets for each environment and rotate them if exposed.

Required environment variables and their validation are defined in the backend configuration code and Docker Compose configuration. Verify the exact deployment environment before starting production; local development credentials are not production credentials.

## FairMove business rules

- FairMove does not deduct a per-ride commission from the driver.
- The passenger's final displayed ride fare and the driver's ride credit must match exactly, subject to explicitly documented refunds, chargebacks, or disputes.
- Driver subscription: first month free; from month two, R$100/month, split into R$59 platform revenue and R$41 emergency reserve.
- The reserve must be tracked separately and transparently; it is not unrestricted platform revenue.
- Initial vehicle categories: cars and motorcycles. Delivery services are outside the MVP.

## Ride lifecycle

`REQUESTED → SEARCHING → DRIVER_ASSIGNED → DRIVER_ARRIVING → DRIVER_AT_PICKUP → PASSENGER_ONBOARD → IN_PROGRESS → COMPLETED`

Terminal/exception states include passenger/driver/system cancellation, expiration, and dispute. Every transition must be validated server-side.

## Design direction

The product identity is premium black and metallic gold, with high-contrast accessible text, the FV monogram, FAIRMOVE wordmark, and the tagline “RIDE FAIR. LIVE FORWARD.” The public passenger and driver apps must not expose administrative control surfaces.

## CI

Pull requests and pushes to `main` and `develop` run lint, type checking, database schema application, tests, TypeScript build, and a Docker image build. The CI workflow builds the image without publishing it. Release publishing must be configured as a separate, explicitly authorized workflow.

## Release readiness

A green CI run alone does not establish Play Store readiness. Before release, validate real provider integrations, production secrets, database migrations/backups, observability and incident response, Android release signing, app privacy disclosures, Data safety declarations, permissions, and end-to-end passenger/driver flows on physical devices. Do not represent mock payment providers or local-only infrastructure as production integrations.
