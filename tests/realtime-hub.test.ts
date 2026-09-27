import {
  WsHub,
  interpretClientMessage,
  type WsClient,
  type WsLike,
} from "../packages/realtime/src/ws/hub";

function fakeSocket(): WsLike & { sent: string[]; fail?: boolean } {
  return {
    sent: [],
    send(data: string) {
      if (this.fail) throw new Error("socket morto");
      this.sent.push(data);
    },
  };
}

function client(userId: string, socket: WsLike, role: WsClient["role"] = "passenger"): WsClient {
  return { userId, role, socket, connectedAt: Date.now() };
}

describe("interpretClientMessage — protocolo de entrada", () => {
  test("ping válido vira intent", () => {
    expect(interpretClientMessage(JSON.stringify({ type: "ping", data: {} }), "driver")).toEqual({
      kind: "ping",
    });
  });

  test("JSON inválido retorna null", () => {
    expect(interpretClientMessage("{oops", "driver")).toBeNull();
  });

  test("tipo desconhecido retorna null", () => {
    expect(
      interpretClientMessage(JSON.stringify({ type: "admin:shutdown", data: {} }), "admin")
    ).toBeNull();
  });

  test("driver:location válido para role=driver", () => {
    const intent = interpretClientMessage(
      JSON.stringify({ type: "driver:location", data: { lat: -23.55, lng: -46.63 } }),
      "driver"
    );
    expect(intent).toEqual({ kind: "driver_location", lat: -23.55, lng: -46.63 });
  });

  test("driver:location recusado para role=passenger", () => {
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: -23.55, lng: -46.63 } }),
        "passenger"
      )
    ).toBeNull();
  });

  test("passenger:location recusado para role=driver", () => {
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "passenger:location", data: { lat: -23.55, lng: -46.63 } }),
        "driver"
      )
    ).toBeNull();
  });

  test("coordenada fora de faixa é rejeitada", () => {
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: 100, lng: 0 } }),
        "driver"
      )
    ).toBeNull();
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: 0, lng: -200 } }),
        "driver"
      )
    ).toBeNull();
  });

  test("coordenada não numérica (NaN/string) é rejeitada", () => {
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: "abc", lng: 0 } }),
        "driver"
      )
    ).toBeNull();
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: NaN, lng: 0 } }),
        "driver"
      )
    ).toBeNull();
  });

  test("admin pode usar os dois fluxos de localização", () => {
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "driver:location", data: { lat: 1, lng: 2 } }),
        "admin"
      )
    ).toEqual({ kind: "driver_location", lat: 1, lng: 2 });
    expect(
      interpretClientMessage(
        JSON.stringify({ type: "passenger:location", data: { lat: 1, lng: 2 } }),
        "admin"
      )
    ).toEqual({ kind: "passenger_location", lat: 1, lng: 2 });
  });

  test("payload não-objeto vira objeto vazio → intent inválido", () => {
    expect(interpretClientMessage(JSON.stringify({ type: "driver:location", data: "x" }), "driver")).toBeNull();
  });
});

describe("WsHub — registro e roteamento", () => {
  test("adiciona, marca online e reporta size", () => {
    const hub = new WsHub();
    const socket = fakeSocket();
    expect(hub.isOnline("u1")).toBe(false);
    hub.add(client("u1", socket));
    expect(hub.isOnline("u1")).toBe(true);
    expect(hub.size).toBe(1);
    expect(hub.get(socket)?.userId).toBe("u1");
  });

  test("sendToUser entrega para todos os sockets do usuário (multi-device)", () => {
    const hub = new WsHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(client("u1", a));
    hub.add(client("u1", b));
    const sent = hub.sendToUser("u1", { type: "ride:status", data: { status: "COMPLETED" } });
    expect(sent).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0])).toEqual({ type: "ride:status", data: { status: "COMPLETED" } });
  });

  test("sendToUser para usuário desconhecido retorna 0", () => {
    const hub = new WsHub();
    expect(hub.sendToUser("ghost", { type: "x", data: {} })).toBe(0);
  });

  test("remove desconecta: último socket sai → offline", () => {
    const hub = new WsHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(client("u1", a));
    hub.add(client("u1", b));
    expect(hub.remove(a)).toBeDefined();
    expect(hub.isOnline("u1")).toBe(true);
    expect(hub.remove(b)).toBeDefined();
    expect(hub.isOnline("u1")).toBe(false);
    expect(hub.size).toBe(0);
    expect(hub.remove(b)).toBeUndefined();
  });

  test("socket que lança em send não derruba o broadcast", () => {
    const hub = new WsHub();
    const dead = fakeSocket();
    dead.fail = true;
    const alive = fakeSocket();
    hub.add(client("u1", dead));
    hub.add(client("u1", alive));
    const sent = hub.sendToUser("u1", { type: "hello", data: {} });
    expect(sent).toBe(1);
    expect(alive.sent).toHaveLength(1);
  });

  test("sendToUsers soma os envios de todos os usuários", () => {
    const hub = new WsHub();
    hub.add(client("u1", fakeSocket()));
    hub.add(client("u2", fakeSocket()));
    hub.add(client("u3", fakeSocket()));
    const sent = hub.sendToUsers(["u1", "u2", "ghost"], { type: "ride:requested", data: {} });
    expect(sent).toBe(2);
    expect(hub.sendToUsers(["u1"], { type: "x", data: {} })).toBe(1);
  });
});
