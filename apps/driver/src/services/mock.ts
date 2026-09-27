/**
 * Mock Services do app do motorista (Fase 2 — sem backend conectado).
 * Cenário fixo: motorista no Mês 3 do plano progressivo, R$ 287,00 na
 * reserva (migração + aportes) e uma solicitação de corrida que chega
 * 5 segundos após ficar online.
 */
import type { RideRequest } from "../logic/ride-request";
import { currentCycleFrom } from "../logic/subscription";

export const mockDriverProfile = {
  id: "driver-mock-001",
  name: "Alex Rocha",
  email: "alex.rocha@exemplo.com",
  /** Aprovação da assinatura — origem do ciclo progressivo. */
  subscriptionStartedAt: "2026-07-01T12:00:00",
  optedOutOfReserve: false,
  /** Integridade do perfil (documentação/veículo pendentes). */
  profileCompletionPercent: 80,
  vehicleRegistered: false,
  connection: "online" as "online" | "offline",
};

/** Mês ativo do mock (derivado da data de ativação — mesma regra do backend). */
export function mockCurrentCycle(now: Date = new Date()): number {
  return currentCycleFrom(mockDriverProfile.subscriptionStartedAt, now);
}

export const mockWallet = {
  /** Saque disponível (wallet_balance). */
  availableBalanceCents: 12_450,
  todayEarningsCents: 8_730,
  todayRidesCount: 5,
  /** Ganhos da semana (Dom→Sáb), centavos. */
  weeklyEarnings: [
    { day: "Seg", cents: 12_400 },
    { day: "Ter", cents: 9_800 },
    { day: "Qua", cents: 15_200 },
    { day: "Qui", cents: 11_300 },
    { day: "Sex", cents: 18_600 },
    { day: "Sáb", cents: 21_400 },
    { day: "Dom", cents: 8_730 },
  ],
  /** Últimas corridas — valor líquido recebido (zero comissão). */
  recentRides: [
    { id: "ride-005", label: "Centro → Aeroporto", netCents: 1_540 },
    { id: "ride-004", label: "Jardins → Estação Norte", netCents: 1_544 },
    { id: "ride-003", label: "Rodoviária → Praia", netCents: 1_890 },
    { id: "ride-002", label: "Universidade → Centro", netCents: 2_300 },
    { id: "ride-001", label: "Rua das Palmeiras → Aeroporto", netCents: 1_456 },
  ],
};

export interface ReserveContribution {
  month: string;
  year: number;
  cents: number;
  note?: string;
}

export const mockReserve: {
  balanceCents: number;
  goalCents: number;
  contributions: ReserveContribution[];
} = {
  balanceCents: 28_700,
  goalCents: 100_000,
  /** Extrato mais recente primeiro. */
  contributions: [
    { month: "Set", year: 2026, cents: 7_000 },
    { month: "Ago", year: 2026, cents: 4_900 },
    { month: "Jun", year: 2026, cents: 16_800, note: "saldo anterior (migração)" },
  ],
};

export const mockRideRequest: RideRequest = {
  id: "ride-request-001",
  origin: "Rua das Palmeiras, 240 — Centro",
  destination: "Aeroporto Internacional — Terminal 2",
  durationMinutes: 28,
  distanceKm: 14.2,
  /** Valor exato pago pelo passageiro — motorista recebe 100%. */
  driverReceivesCents: 1_456,
};

/**
 * Dispara a solicitação de corrida após `delayMs` (padrão 5s — tempo do
 * mock de "chegada de corrida"). Retorna a função de cancelamento.
 */
export function scheduleRideRequest(
  callback: () => void,
  delayMs: number = 5_000
): () => void {
  const timeout = setTimeout(callback, delayMs);
  return () => clearTimeout(timeout);
}
