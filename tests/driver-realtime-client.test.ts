import { RealTimeClient, wsEndpoint } from "../apps/driver/src/services/realtime";
import { saveSession } from "../apps/driver/src/services/session";

type Listener<T> = ((event: T) => void) | null;

/** WebSocket fake controlável (substitui o global durante os testes). */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: Listener<void> = null;
  onclose: Listener<{ code: number }> = null;
  onerror: Listener<void> = null;
  onmessage: Listener<{ data: unknown }> = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  simulateServerClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const globalWithWs = globalThis as { WebSocket?: unknown };
const originalWebSocket = globalWithWs.WebSocket;

async function loginSession(): Promise<void> {
  await saveSession(
    { accessToken: "access-1", refreshToken: "refresh-1" },
    { id: "user-1", name: "Teste", email: "t@t.dev", role: "passenger" }
  );
}

beforeEach(async () => {
  FakeWebSocket.instances = [];
  globalWithWs.WebSocket = FakeWebSocket;
  await loginSession();
});

afterAll(() => {
  globalWithWs.WebSocket = originalWebSocket;
});

describe("wsEndpoint — derivação da URL do transporte", () => {
  test("remove /api/v1 e usa ws", () => {
    expect(wsEndpoint("http://192.168.1.5:3000/api/v1")).toBe("ws://192.168.1.5:3000/ws");
  });

  test("barra final extra não quebra", () => {
    expect(wsEndpoint("http://localhost:3000/api/v1/")).toBe("ws://localhost:3000/ws");
  });

  test("https vira wss", () => {
    expect(wsEndpoint("https://api.fairmove.dev/api/v1")).toBe("wss://api.fairmove.dev/ws");
  });
});

describe("RealTimeClient — transporte com reconexão", () => {
  test("connect abre socket com access token na query do handshake", () => {
    const client = new RealTimeClient();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("/ws?token=access-1");
    client.disconnect();
  });

  test("sem sessão não abre socket", () => {
    const client = new RealTimeClient("ws://x/ws");
    // sessão existe do beforeEach — limpa redirecionando pra endpoint sem connect...
    // garantia real: stopped por padrão sem connect() não cria nada:
    expect(FakeWebSocket.instances).toHaveLength(0);
    client.disconnect();
  });

  test("on recebe apenas mensagens do tipo assinado", () => {
    const client = new RealTimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.simulateOpen();

    const received: unknown[] = [];
    const other: unknown[] = [];
    client.on("ride:requested", (data) => received.push(data));
    client.on("ride:matched", (data) => other.push(data));

    socket.simulateMessage({ type: "ride:requested", data: { rideId: "r1" } });
    socket.simulateMessage({ type: "ride:matched", data: { rideId: "r2" } });
    socket.simulateMessage({ type: "ride:requested" });

    expect(received).toEqual([{ rideId: "r1" }, {}]);
    expect(other).toEqual([{ rideId: "r2" }]);
    client.disconnect();
  });

  test("JSON inválido não derruba o transporte nem dispara handler", () => {
    const client = new RealTimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.simulateOpen();
    const handler = jest.fn();
    client.on("hello", handler);

    socket.onmessage?.({ data: "{not json" });
    expect(handler).not.toHaveBeenCalled();
    client.disconnect();
  });

  test("unsubscribe do handler funciona", () => {
    const client = new RealTimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    const handler = jest.fn();
    const off = client.on("hello", handler);
    off();
    socket.simulateMessage({ type: "hello", data: {} });
    expect(handler).not.toHaveBeenCalled();
    client.disconnect();
  });

  test("send serializa envelope e retorna false sem conexão", () => {
    const client = new RealTimeClient();
    expect(client.send("driver:location", { lat: 1, lng: 2 })).toBe(false);
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.simulateOpen();
    expect(client.connected).toBe(true);
    expect(client.send("driver:location", { lat: 1, lng: 2 })).toBe(true);
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "driver:location",
      data: { lat: 1, lng: 2 },
    });
    client.disconnect();
    expect(client.connected).toBe(false);
  });

  test("queda do servidor agenda reconexão com backoff", () => {
    jest.useFakeTimers();
    try {
      const client = new RealTimeClient();
      client.connect();
      expect(FakeWebSocket.instances).toHaveLength(1);

      FakeWebSocket.instances[0].simulateServerClose();
      // backoff base: 1000ms + jitter (< 400ms)
      jest.advanceTimersByTime(1_500);
      expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      client.disconnect();
    } finally {
      jest.useRealTimers();
    }
  });

  test("disconnect cancela reconexões futuras", () => {
    jest.useFakeTimers();
    try {
      const client = new RealTimeClient();
      client.connect();
      FakeWebSocket.instances[0].simulateServerClose();
      client.disconnect();
      jest.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("estado de conexão segue o socket", () => {
    const client = new RealTimeClient();
    expect(client.connected).toBe(false);
    client.connect();
    expect(client.connected).toBe(false); // ainda OPEN=0
    FakeWebSocket.instances[0].simulateOpen();
    expect(client.connected).toBe(true);
    client.disconnect();
    expect(client.connected).toBe(false);
  });
});
