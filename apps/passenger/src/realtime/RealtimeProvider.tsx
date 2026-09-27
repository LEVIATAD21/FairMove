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
import * as Location from "expo-location";
import { useAuth } from "../auth/AuthProvider";
import { api, type RideHistoryItem } from "../services/api";
import { RealTimeClient } from "../services/realtime";

/** Intervalo de TX de localização do passageiro (único timer, outbound). */
const LOCATION_TX_INTERVAL_MS = 3_000;

/** Status em que o passageiro está na viagem (localização faz sentido). */
const ONBOARD_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVING",
  "DRIVER_AT_PICKUP",
  "PASSENGER_ONBOARD",
  "IN_PROGRESS",
] as const;

export type ActiveRide = {
  rideId: string;
  status: string;
  /** Preço final em centavos (travado no pedido). */
  fareCents: number;
};

export type MatchedDriver = {
  driverId: string | null;
  driverName: string;
  vehiclePlate: string;
};

export type DriverLocation = {
  lat: number;
  lng: number;
  at: number;
};

type RealtimeContextValue = {
  connected: boolean;
  /** Corrida em andamento (recuperada do histórico no boot ou criada agora). */
  activeRide: ActiveRide | null;
  matchedDriver: MatchedDriver | null;
  driverLocation: DriverLocation | null;
  /** Cria a corrida real e passa a acompanhar por WS. */
  requestRide: (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) => Promise<void>;
  cancelRide: (reason: string) => Promise<void>;
  error: string | null;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  activeRide: null,
  matchedDriver: null,
  driverLocation: null,
  requestRide: async () => undefined,
  cancelRide: async () => undefined,
  error: null,
});

function isActiveStatus(status: string): boolean {
  return (
    status === "REQUESTED" ||
    status === "SEARCHING" ||
    (ONBOARD_STATUSES as readonly string[]).includes(status)
  );
}

function rideFromHistory(item: RideHistoryItem): ActiveRide {
  return {
    rideId: item.id,
    status: item.status,
    fareCents: Math.round((item.totalFare ?? 0) * 100),
  };
}

/**
 * Transporte em tempo real do passageiro:
 * 1. WebSocket conecta quando autenticado (reconexão automática);
 * 2. no boot, recupera corrida ativa do histórico real (restart seguro);
 * 3. `ride:matched` traz motorista real (nome/placa), `ride:status` as
 *    transições e `driver:location` a posição do motorista — tudo push;
 * 4. enquanto houver viagem, transmite a posição real do aparelho a cada 3s;
 * 5. nunca polling — todos os dados de corrida vêm do servidor.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const clientRef = useRef<RealTimeClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [activeRide, setActiveRide] = useState<ActiveRide | null>(null);
  const [matchedDriver, setMatchedDriver] = useState<MatchedDriver | null>(null);
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearRide = useCallback(() => {
    setActiveRide(null);
    setMatchedDriver(null);
    setDriverLocation(null);
  }, []);

  // Ciclo de vida do transporte + recuperação de corrida ativa.
  useEffect(() => {
    if (status !== "authed") {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setConnected(false);
      clearRide();
      return;
    }

    let cancelled = false;
    const client = new RealTimeClient();
    clientRef.current = client;

    const offOpen = client.on("open", () => setConnected(true));
    const offClose = client.on("close", () => setConnected(false));

    const offMatched = client.on("ride:matched", (data) => {
      const rideId = data.rideId;
      if (typeof rideId !== "string") return;
      setMatchedDriver({
        driverId: typeof data.driverId === "string" ? data.driverId : null,
        driverName: typeof data.driverName === "string" ? data.driverName : "Motorista",
        vehiclePlate: typeof data.vehiclePlate === "string" ? data.vehiclePlate : "",
      });
      setActiveRide((current) =>
        current && current.rideId === rideId
          ? { ...current, status: "DRIVER_ASSIGNED" }
          : current
      );
    });

    const offStatus = client.on("ride:status", (data) => {
      const rideId = data.rideId;
      const rideStatus = data.status;
      if (typeof rideId !== "string" || typeof rideStatus !== "string") return;
      if (!isActiveStatus(rideStatus)) {
        setActiveRide((current) => (current?.rideId === rideId ? null : current));
        setMatchedDriver(null);
        setDriverLocation(null);
        return;
      }
      setActiveRide((current) =>
        current && current.rideId === rideId ? { ...current, status: rideStatus } : current
      );
    });

    const offDriverLocation = client.on("driver:location", (data) => {
      if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
      setDriverLocation({ lat: data.lat, lng: data.lng, at: Date.now() });
    });

    client.connect();

    // Recupera corrida em andamento (app reiniciou durante a viagem).
    void (async () => {
      try {
        const rides = await api.getRides();
        if (cancelled) return;
        const open = rides.find((ride) => isActiveStatus(ride.status));
        if (open) {
          setActiveRide(rideFromHistory(open));
        }
      } catch {
        // Sem histórico agora — estado vazio é válido.
      }
    })();

    return () => {
      cancelled = true;
      offOpen();
      offClose();
      offMatched();
      offStatus();
      offDriverLocation();
      client.disconnect();
      clientRef.current = null;
    };
  }, [status, clearRide]);

  // TX de localização real do passageiro: só com corrida em viagem.
  useEffect(() => {
    if (!activeRide || status !== "authed") return;
    if (!(ONBOARD_STATUSES as readonly string[]).includes(activeRide.status)) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        clientRef.current?.send("passenger:location", {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      } catch {
        // Sem posição disponível: não envia nada.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), LOCATION_TX_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeRide, status]);

  const requestRide = useCallback(
    async (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) => {
      setError(null);
      try {
        const ride = await api.createRide({
          pickupLocationLat: pickup.lat,
          pickupLocationLng: pickup.lng,
          dropoffLocationLat: dropoff.lat,
          dropoffLocationLng: dropoff.lng,
        });
        setMatchedDriver(null);
        setDriverLocation(null);
        setActiveRide({
          rideId: ride.rideId,
          status: ride.status,
          fareCents: Math.round(ride.totalFare * 100),
        });
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Falha ao pedir corrida";
        setError(message);
        throw cause;
      }
    },
    []
  );

  const cancelRide = useCallback(
    async (reason: string) => {
      setError(null);
      const ride = activeRide;
      if (!ride) return;
      try {
        await api.cancelRide(ride.rideId, reason);
      } catch (cause) {
        // Corrida já finalizada em paralelo → limpa do mesmo jeito.
        if (!(cause instanceof Error && "status" in cause)) {
          const message = cause instanceof Error ? cause.message : "Falha ao cancelar";
          setError(message);
          throw cause;
        }
      }
      clearRide();
    },
    [activeRide, clearRide]
  );

  const value = useMemo(
    () => ({
      connected,
      activeRide,
      matchedDriver,
      driverLocation,
      requestRide,
      cancelRide,
      error,
    }),
    [connected, activeRide, matchedDriver, driverLocation, requestRide, cancelRide, error]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
