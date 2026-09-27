/**
 * Hub de conexões WebSocket do FairMove.
 *
 * Parte pura do realtime: registro de clientes, roteamento de mensagens e
 * interpretação do protocolo — sem I/O, o que a torna unit-testável.
 *
 * Protocolo (envelope JSON `{ type, data }`):
 *
 * servidor → cliente:
 *   hello              {role, userId}
 *   ride:requested     {rideId, pickup, dropoff, distanceKm, estimatedTimeSeconds, originalPrice}
 *   ride:matched       {rideId, driverId, driverName, vehiclePlate}
 *   ride:status        {rideId, status, from}
 *   driver:location    {rideId, lat, lng, at}
 *   passenger:location {rideId, lat, lng, at}
 *   error              {code, message}
 *   pong               {}
 *
 * cliente → servidor:
 *   driver:location    {lat, lng}          (apenas role=driver)
 *   passenger:location {lat, lng}          (apenas role=passenger)
 *   ping               {}
 */

export interface WsLike {
  send(data: string): void;
}

export type WsRole = "driver" | "passenger" | "admin";

export interface WsClient {
  userId: string;
  role: WsRole;
  socket: WsLike;
  connectedAt: number;
}

export interface OutboundMessage {
  type: string;
  data: Record<string, unknown>;
}

export type ClientIntent =
  | { kind: "driver_location"; lat: number; lng: number }
  | { kind: "passenger_location"; lat: number; lng: number }
  | { kind: "ping" };

export function isValidCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Interpretador do protocolo de entrada. Papel errado ou payload inválido → null. */
export function interpretClientMessage(raw: string, role: WsRole): ClientIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { type, data } = parsed as { type?: unknown; data?: unknown };
  if (typeof type !== "string") return null;
  const payload =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

  switch (type) {
    case "ping":
      return { kind: "ping" };
    case "driver:location": {
      if (role !== "driver" && role !== "admin") return null;
      const { lat, lng } = payload;
      if (!isValidCoordinate(lat) || !isValidCoordinate(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { kind: "driver_location", lat, lng };
    }
    case "passenger:location": {
      if (role !== "passenger" && role !== "admin") return null;
      const { lat, lng } = payload;
      if (!isValidCoordinate(lat) || !isValidCoordinate(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { kind: "passenger_location", lat, lng };
    }
    default:
      return null;
  }
}

/** Registro e roteamento de sockets conectados (1:N por userId — multi-device). */
export class WsHub {
  private bySocket = new Map<WsLike, WsClient>();
  private byUser = new Map<string, Set<WsLike>>();

  add(client: WsClient): void {
    this.bySocket.set(client.socket, client);
    let sockets = this.byUser.get(client.userId);
    if (!sockets) {
      sockets = new Set();
      this.byUser.set(client.userId, sockets);
    }
    sockets.add(client.socket);
  }

  remove(socket: WsLike): WsClient | undefined {
    const client = this.bySocket.get(socket);
    if (!client) return undefined;
    this.bySocket.delete(socket);
    const sockets = this.byUser.get(client.userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) this.byUser.delete(client.userId);
    }
    return client;
  }

  get(socket: WsLike): WsClient | undefined {
    return this.bySocket.get(socket);
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  /** Envia para todos os sockets do usuário. Retorna quantos receberam. */
  sendToUser(userId: string, message: OutboundMessage): number {
    const sockets = this.byUser.get(userId);
    if (!sockets || sockets.size === 0) return 0;
    const payload = JSON.stringify(message);
    let sent = 0;
    for (const socket of sockets) {
      try {
        socket.send(payload);
        sent += 1;
      } catch {
        // Socket morto: o evento 'close' remove do hub em seguida.
      }
    }
    return sent;
  }

  /** Envia para vários usuários (broadcast seletivo). Retorna total de envios. */
  sendToUsers(userIds: string[], message: OutboundMessage): number {
    let sent = 0;
    for (const userId of userIds) {
      sent += this.sendToUser(userId, message);
    }
    return sent;
  }

  get size(): number {
    return this.bySocket.size;
  }
}
