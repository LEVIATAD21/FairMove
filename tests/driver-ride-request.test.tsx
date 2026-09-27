import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { RideRequestSheet } from "../apps/driver/src/components/RideRequestSheet";
import { mockRideRequest } from "../apps/driver/src/services/mock";

jest.useFakeTimers();

/** Avança o relógio tick a tick — cada setState reagenda o timer no effect. */
async function tick(ms = 1_000) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function setup(overrides: Partial<Parameters<typeof RideRequestSheet>[0]> = {}) {
  const onAccept = jest.fn();
  const onDecline = jest.fn();
  const onTimeout = jest.fn();
  const utils = await render(
    <RideRequestSheet
      request={mockRideRequest}
      onAccept={onAccept}
      onDecline={onDecline}
      onTimeout={onTimeout}
      {...overrides}
    />
  );
  return { ...utils, onAccept, onDecline, onTimeout };
}

describe("RideRequestSheet — solicitação de corrida", () => {
  test("renderiza origem, destino, tempo e distância do mock", async () => {
    const { getByText } = await setup();

    expect(getByText("Rua das Palmeiras, 240 — Centro")).toBeTruthy();
    expect(getByText("Aeroporto Internacional — Terminal 2")).toBeTruthy();
    expect(getByText("28 min")).toBeTruthy();
    expect(getByText("14,2 km")).toBeTruthy();
  });

  test("destaque em dourado: VOCÊ RECEBE com o valor exato do passageiro", async () => {
    const { getByText } = await setup();

    expect(getByText("VOCÊ RECEBE: R$ 14,56")).toBeTruthy();
    expect(getByText(/Valor exato pago pelo passageiro/)).toBeTruthy();
  });

  test("contador regressivo inicia em 15s e decrementa a cada segundo", async () => {
    const { getByText } = await setup();

    expect(getByText("Recusa automática em 15s")).toBeTruthy();

    await tick();
    expect(getByText("Recusa automática em 14s")).toBeTruthy();

    await tick();
    await tick();
    await tick();
    expect(getByText("Recusa automática em 11s")).toBeTruthy();
  });

  test("recusa automática ao esgotar os 15 segundos (uma única vez)", async () => {
    const { onTimeout, onAccept } = await setup();

    for (let i = 0; i < 15; i++) {
      await tick();
    }

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  test("ACEITAR dispara onAccept e desabilita os botões", async () => {
    const { onAccept, onDecline, getByLabelText } = await setup();

    await fireEvent.press(getByLabelText("Aceitar corrida"));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();

    await tick();
    expect(getByLabelText("Aceitar corrida").props.accessibilityState.disabled).toBe(true);
  });

  test("RECUSAR dispara onDecline", async () => {
    const { onDecline, onAccept, getByLabelText } = await setup();

    await fireEvent.press(getByLabelText("Recusar corrida"));

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  test("janela de decisão personalizada zera e expira", async () => {
    const { onTimeout, getByText } = await setup({ countdownSeconds: 3 });

    expect(getByText("Recusa automática em 3s")).toBeTruthy();
    await tick();
    await tick();
    await tick();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(getByText("Tempo esgotado — recusa automática")).toBeTruthy();
  });
});
