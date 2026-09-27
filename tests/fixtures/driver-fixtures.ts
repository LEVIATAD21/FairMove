import type { RideRequest } from "../../apps/driver/src/logic/ride-request";

/**
 * Fixtures de TESTE (isoladas em tests/ — o app não contém mocks).
 * Cenário: reserva com R$ 287,00 (migração + aportes) e uma solicitação
 * de corrida de R$ 14,56 para exercitar a UI.
 */

export const fixtureRideRequest: RideRequest = {
  id: "ride-request-001",
  origin: "Rua das Palmeiras, 240 — Centro",
  destination: "Aeroporto Internacional — Terminal 2",
  durationMinutes: 28,
  distanceKm: 14.2,
  driverReceivesCents: 1_456,
};

export const fixtureReserve = {
  balanceCents: 28_700,
  goalCents: 100_000,
  contributions: [
    { month: "Set", year: 2026, cents: 7_000 },
    { month: "Ago", year: 2026, cents: 4_900 },
    { month: "Jun", year: 2026, cents: 16_800, note: "saldo anterior (migração)" },
  ],
};

export const fixtureWalletBalance = {
  availableBalance: 12_450,
  pendingBalance: 0,
  reserveBalance: 28_700,
  currency: "BRL",
};

/** Transações do ledger que produzem o histórico acima (formato da API real). */
export const fixtureReserveTransactions = [
  {
    id: "tx-3",
    transactionType: "reserve_contribution",
    amount: 7_000,
    currency: "BRL",
    description: "Reserve contribution",
    status: "completed",
    created_at: "2026-09-05T12:00:00",
  },
  {
    id: "tx-2",
    transactionType: "reserve_contribution",
    amount: 4_900,
    currency: "BRL",
    description: "Reserve contribution",
    status: "completed",
    created_at: "2026-08-05T12:00:00",
  },
  {
    id: "tx-1",
    transactionType: "reserve_contribution",
    amount: 16_800,
    currency: "BRL",
    description: "saldo anterior (migração)",
    status: "completed",
    created_at: "2026-06-10T12:00:00",
  },
];
