import React from "react";
import { render } from "@testing-library/react-native";
import DriverReserve from "../apps/driver/app/driver/(tabs)/reserve";
import {
  contributionLabel,
  progressPercent,
  reserveProgressLabel,
} from "../apps/driver/src/logic/reserve";
import { mockReserve } from "../apps/driver/src/services/mock";

describe("Tela de Reserva — Reserva de Disciplina e Emergência", () => {
  test("renderiza título e a explicação de proteção do valor", async () => {
    const { getByText } = await render(<DriverReserve />);

    expect(getByText("Reserva de Disciplina e Emergência")).toBeTruthy();
    expect(
      getByText(
        "Este valor é seu e está protegido para manutenção, emergências ou imprevistos."
      )
    ).toBeTruthy();
  });

  test("barra de progresso reflete o saldo do mock (R$ 287 de R$ 1.000)", async () => {
    const { getByText } = await render(<DriverReserve />);

    expect(getByText("R$ 287 de R$ 1.000 da meta")).toBeTruthy();
    expect(getByText("28.7% da meta concluída")).toBeTruthy();
  });

  test("histórico de aportes mensais formatado em BRL", async () => {
    const { getByText } = await render(<DriverReserve />);

    expect(getByText("+ R$ 70,00 em Set/2026")).toBeTruthy();
    expect(getByText("+ R$ 49,00 em Ago/2026")).toBeTruthy();
    expect(getByText("+ R$ 168,00 em Jun/2026 · saldo anterior (migração)")).toBeTruthy();
  });

  test("exibe aviso de saque bloqueado", async () => {
    const { getByText } = await render(<DriverReserve />);
    expect(getByText(/Saque bloqueado/)).toBeTruthy();
  });
});

describe("Lógica da Reserva (funções puras)", () => {
  test("progressPercent é limitado a [0, 100]", () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(-500)).toBe(0);
    expect(progressPercent(mockReserve.balanceCents, mockReserve.goalCents)).toBe(28.7);
    expect(progressPercent(200_000)).toBe(100);
    expect(progressPercent(100, 0)).toBe(100);
  });

  test("reserveProgressLabel usa compactação BRL", () => {
    expect(reserveProgressLabel(28_700, 100_000)).toBe("R$ 287 de R$ 1.000 da meta");
    expect(reserveProgressLabel(28_750, 100_000)).toBe("R$ 287,50 de R$ 1.000 da meta");
  });

  test("contributionLabel formata sinal, valor e mês/ano", () => {
    expect(contributionLabel(7_000, "Set", 2026)).toBe("+ R$ 70,00 em Set/2026");
    expect(contributionLabel(-1_000, "Jan", 2027)).toBe("- R$ 10,00 em Jan/2027");
    expect(contributionLabel(16_800, "Jun", 2026, "migração")).toBe(
      "+ R$ 168,00 em Jun/2026 · migração"
    );
  });

  test("soma do histórico confere com o saldo do mock", () => {
    const total = mockReserve.contributions.reduce((acc, entry) => acc + entry.cents, 0);
    expect(total).toBe(mockReserve.balanceCents);
  });
});
