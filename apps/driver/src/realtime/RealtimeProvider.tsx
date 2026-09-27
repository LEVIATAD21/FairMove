import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { router } from "expo-router";
import * as Location from "expo-location";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../services/api";
import { RealTimeClient } from "../services/realtime";
import { formatCoord, type RideRequest } from "../logic/ride-request";

/** Intervalo de TX de localização do motorista (único timer do app, outbound). */
const LOCATION_TX_INTERVAL_MS = 3_000;

export type ActiveRide = {
  rideId: string;
  status: string;
};

type RealtimeContextValue = {
  /** true quando o WebSocket está aberto (push do servidor, sem polling). */
  connected: boolean;
  /** Estado online/offline REAL do motorista (espelho confirmado pelo backend). */
  online: boolean;
  setOnline: (next: boolean) => Promise<void>;
  /** Pedido de corrida aguardando decisão (abre o modal transparente). */
  pendingRequest: RideRequest | null;
  clearPendingRequest: () => void;
  /** Corrida em andamento (DRIVER_ASSIGNED → COMPLETED). */
  activeRide: ActiveRide | null;
  /** Falha na permissão de localização (o app nunca inventa posição). */
  locationDenied: boolean;
  error: string | null;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  online: false,
  setOnline: async () => undefined,
  pendingRequest: null,
  clearPendingRequest: () => undefined,
  activeRide: null,
  locationDenied: false,
  error: null,
});

function rideRequestFromEvent(data: Record<string, unknown>): RideRequest | null {
  const rideId = data.rideId;
  const pickup = data.pickup as { lat?: number; lng?: number } | undefined;
  const dropoff = data.dropoff as { lat?: number; lng?: number } | undefined;
  if (typeof rideId !== "string" || !pickup || !dropoff) return null;
  if (typeof pickup.lat !== "number" || typeof pickup.lng !== "number") return null;
  if (typeof dropoff.lat !== "number" || typeof dropoff.lng !== "number") return null;

  const originalPrice = Number(data.originalPrice ?? 0);
  const distanceKm = Number(data.distanceKm ?? 0);
  const estimatedTimeSeconds = Number(data.estimatedTimeSeconds ?? 0);

  return {
    id: rideId,
    origin: formatCoord(pickup.lat, pickup.lng),
    destination: formatCoord(dropoff.lat, dropoff.lng),
    durationMinutes: Math.max(1, Math.round(estimatedTimeSeconds / 60)),
    distanceKm,
    // Zero comissão: o motorista recebe exatamente o que o passageiro pagou.
    driverReceivesCents: Math.round(originalPrice * 100),
  };
}

/**
 * Transporte em tempo real do motorista:
 * 1. conecta o WebSocket quando a sessão está autenticada (reconecta sozinho);
 * 2. `ride:requested` → abre o modal de oferta com dados REAIS da corrida;
 * 3. online/offline real via POST /matching/driver/status;
 * 4. enquanto online, transmite a posição real do aparelho a cada 3s
 *    (permissão obrigatória — sem permissão, nada é enviado);
 * 5. `ride:matched`/`ride:status` mantêm a corrida ativa em estado React.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const clientRef = useRef<RealTimeClient | null>(null);
  const modalOpenRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [online, setOnlineState] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<RideRequest | null>(null);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPendingRequest = useCallback(() => {
    modalOpenRef.current = false;
    setPendingRequest(null);
  }, []);

  // Ciclo de vida do transporte: authed → conecta; guest → desconecta.
  useEffect(() => {
    if (status !== "authed") {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setConnected(false);
      setOnlineState(false);
      setActiveRide(null);
      clearPendingRequest();
      return;
    }

    const client = new RealTimeClient();
    clientRef.current = client;

    const offOpen = client.on("open", () => setConnected(true));
    const offClose = client.on("close", () => setConnected(false));

    const offRequested = client.on("ride:requested", (data) => {
      const request = rideRequestFromEvent(data);
      if (!request) return;
      setPendingRequest(request);
      if (!modalOpenRef.current) {
        modalOpenRef.current = true;
        router.push({
          pathname: "/ride-request-modal",
          params: {
            id: request.id,
            origin: request.origin,
            destination: request.destination,
            durationMinutes: String(request.durationMinutes),
            distanceKm: String(request.distanceKm),
            driverReceivesCents: String(request.driverReceivesCents),
          },
        });
      }
    });

    const offMatched = client.on("ride:matched", (data) => {
      const rideId = data.rideId;
      if (typeof rideId !== "string") return;
      clearPendingRequest();
      setActiveRide({ rideId, status: "DRIVER_ASSIGNED" });
      setError(null);
    });

    const offStatus = client.on("ride:status", (data) => {
      const rideId = data.rideId;
      const rideStatus = data.status;
      if (typeof rideId !== "string" || typeof rideStatus !== "string") return;
      if (
        rideStatus === "COMPLETED" ||
        rideStatus.startsWith("CANCELLED") ||
        rideStatus === "FAILED"
      ) {
        setActiveRide((current) => (current?.rideId === rideId ? null : current));
        setOnlineState(false);
        return;
      }
      setActiveRide({ rideId, status: rideStatus });
    });

    client.connect();

    return () => {
      offOpen();
      offClose();
      offRequested();
      offMatched();
      offStatus();
      client.disconnect();
      clientRef.current = null;
    };
  }, [status, clearPendingRequest]);

  // TX de localização real: só enquanto ONLINE, a cada 3s, com permissão.
  useEffect(() => {
    if (!online || status !== "authed") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          setLocationDenied(true);
          return;
        }
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        clientRef.current?.send("driver:location", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      } catch {
        // Sem posição (serviço de localização desligado): não envia nada.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), LOCATION_TX_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online, status]);

  const setOnline = useCallback(async (next: boolean) => {
    setError(null);
    try {
      if (next) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setLocationDenied(true);
          setError("Permissão de localização negada — ficar online exige sua posição real.");
          return;
        }
        setLocationDenied(false);
      }
      await api.setDriverStatus(next ? "online" : "offline");
      setOnlineState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar status");
    }
  }, []);

  const value = useMemo(
    () => ({
      connected,
      online,
      setOnline,
      pendingRequest,
      clearPendingRequest,
      activeRide,
      locationDenied,
      error,
    }),
    [connected, online, setOnline, pendingRequest, clearPendingRequest, activeRide, locationDenied, error]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
