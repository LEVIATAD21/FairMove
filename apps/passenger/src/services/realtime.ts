import { API_BASE_URL } from "./api";
import { getSessionTokens } from "./session";

/**
 * RealTimeClient WebSocket do motorista — transporte real para `/ws`.
 *
 * - URL deriva de EXPO_PUBLIC_API_URL (`http://host:3000/api/v1` → `ws://host:3000/ws`);
 * - JWT (access token) vai como Sec-WebSocket-Protocol (subprotocolo), jamais
 *   na query string (URL com token vaza em logs de proxy/CDN/histórico);
 *   o servidor valida e recusa 401;
 * - reconexão automática com backoff exponencial + jitter (1s → 30s);
 * - handlers por tipo de evento, com unsubscribe idiomático.
 * Sem polling: tudo que chega é push do servidor.
 */

export type RealtimeHandler = (data: Record<string, unknown>) => void;

type WebSocketLike = {
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type WebSocketCtor = new (url: string, protocols?: string[]) => WebSocketLike;

const OPEN = 1;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** `http://host:3000/api/v1` → `ws://host:3000/ws` (token vai no subprotocolo). */
export function wsEndpoint(apiBaseUrl: string = API_BASE_URL): string {
  const withoutApiSuffix = apiBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${withoutApiSuffix.replace(/^http/, "ws")}/ws`;
}

export class RealTimeClient {
  private ws: WebSocketLike | null = null;
  private handlers = new Map<string, Set<RealtimeHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly endpoint: string = wsEndpoint()) {}

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN;
  }

  /** Conecta (ou reconecta) usando o access token vigente da sessão. */
  connect(): void {
    const token = getSessionTokens()?.accessToken;
    if (!token) return;
    this.stopped = false;
    this.openSocket(token);
  }

  /** Fecha por decisão do app (logout/tela destruída) e cancela reconexões. */
  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try {
        socket.close(1000, "client disconnect");
      } catch {
        // socket já fechado
      }
    }
  }

  /** Assina um tipo de evento; retorna a função de unsubscribe. */
  on(type: string, handler: RealtimeHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  send(type: string, data: Record<string, unknown>): boolean {
    if (!this.connected || !this.ws) return false;
    this.ws.send(JSON.stringify({ type, data }));
    return true;
  }

  private openSocket(token: string): void {
    // Auth via subprotocol: o token nunca aparece na URL do handshake.
    const Ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!Ctor) return;

    const socket = new Ctor(this.endpoint, ["fairmove.auth", token]);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit("open", {});
    };

    socket.onmessage = (event) => {
      let message: { type?: string; data?: Record<string, unknown> };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (!message.type) return;
      this.emit(message.type, message.data ?? {});
    };

    socket.onerror = () => {
      // onclose dispara em seguida — a reconexão é agendada lá.
    };

    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
      this.emit("close", {});
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const exponential = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** this.reconnectAttempts
    );
    const jitter = Math.floor(Math.random() * 400);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, exponential + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emit(type: string, data: Record<string, unknown>): void {
    this.handlers.get(type)?.forEach((handler) => {
      try {
        handler(data);
      } catch {
        // Handler com erro não pode derrubar o transporte.
      }
    });
  }
}
