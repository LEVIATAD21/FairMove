import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { api } from "../services/api";

const KEY_PREFIX = "offline_route_";

export type OfflineRouteData = {
  rideId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  routeCoordinates: Array<{ lat: number; lng: number }>;
  fareCents: number;
  distanceMeters: number;
  durationSeconds: number | null;
  source: "osrm" | "straight";
  downloadedAt: string;
};

/**
 * Cache offline da rota do motorista (CORREÇÃO 5):
 * - ao aceitar a corrida, baixa geometria + dados da rota e grava local;
 * - sem internet o motorista continua com origem/destino/rota disponíveis;
 * - quando a conexão volta, sincroniza status e descarta rotas encerradas.
 */
export class OfflineRouteManager {
  static async downloadRoute(rideId: string): Promise<OfflineRouteData | null> {
    try {
      const [ride, route] = await Promise.all([api.getRide(rideId), api.getRideRoute(rideId)]);
      const data: OfflineRouteData = {
        rideId,
        pickupLat: Number(ride.pickupLocationLat),
        pickupLng: Number(ride.pickupLocationLng),
        dropoffLat: Number(ride.dropoffLocationLat),
        dropoffLng: Number(ride.dropoffLocationLng),
        routeCoordinates: route.coordinates,
        fareCents: Number(ride.finalPassengerPrice),
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        source: route.source,
        downloadedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(`${KEY_PREFIX}${rideId}`, JSON.stringify(data));
      return data;
    } catch {
      // Sem rede/agora não há o que cachear — tenta de novo na reconexão.
      return null;
    }
  }

  static async getOfflineRoute(rideId: string): Promise<OfflineRouteData | null> {
    const stored = await AsyncStorage.getItem(`${KEY_PREFIX}${rideId}`);
    return stored ? (JSON.parse(stored) as OfflineRouteData) : null;
  }

  static async clearOfflineRoute(rideId: string): Promise<void> {
    await AsyncStorage.removeItem(`${KEY_PREFIX}${rideId}`);
  }

  /** Na reconexão: confere status de cada corrida cacheada e limpa as encerradas. */
  static async syncAndCleanup(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const routeKeys = keys.filter((k) => k.startsWith(KEY_PREFIX));
      for (const key of routeKeys) {
        const rideId = key.slice(KEY_PREFIX.length);
        try {
          const ride = await api.getRide(rideId);
          const terminal =
            ride.status === "COMPLETED" ||
            ride.status === "CANCELLED_BY_PASSENGER" ||
            ride.status === "CANCELLED_BY_DRIVER" ||
            ride.status === "CANCELLED_BY_SYSTEM" ||
            ride.status === "EXPIRED" ||
            ride.status === "FAILED";
          if (terminal) await AsyncStorage.removeItem(key);
        } catch {
          // 404/removida também some do cache
          await AsyncStorage.removeItem(key);
        }
      }
    } catch {
      // melhor falhar silencioso do que bloquear a UI do motorista
    }
  }

  /** Assina reconexões globais (chamar uma vez no provider). Retorna unsubscribe. */
  static subscribeOnReconnect(onReconnected?: () => void): () => void {
    return NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void OfflineRouteManager.syncAndCleanup().then(() => onReconnected?.());
      }
    });
  }
}
