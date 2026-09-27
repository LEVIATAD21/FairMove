import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RideRequestSheet } from "../src/components/RideRequestSheet";
import type { RideRequest } from "../src/logic/ride-request";
import { api } from "../src/services/api";
import { useRealtime } from "../src/realtime/RealtimeProvider";

/**
 * Rota global de solicitação de corrida — `transparentModal` com blur +
 * bordas douradas. Os dados chegam por params preenchidos pelo WebSocket
 * (`ride:requested`) quando um passageiro solicita corrida de verdade.
 * Sem params → fecha (nada de corrida inventada).
 * ACEITAR chama o backend real (POST /rides/:id/accept).
 */
export default function RideRequestModal() {
  const router = useRouter();
  const { clearPendingRequest, activeRide } = useRealtime();
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const params = useLocalSearchParams<{
    id?: string;
    origin?: string;
    destination?: string;
    durationMinutes?: string;
    distanceKm?: string;
    driverReceivesCents?: string;
  }>();

  const request: RideRequest | null = useMemo(() => {
    if (!params.origin || !params.destination || !params.driverReceivesCents) return null;
    return {
      id: params.id ?? "ride-request",
      origin: params.origin,
      destination: params.destination,
      durationMinutes: Number(params.durationMinutes ?? 0),
      distanceKm: Number(params.distanceKm ?? 0),
      driverReceivesCents: Number(params.driverReceivesCents),
    };
  }, [params]);

  useEffect(() => {
    if (!request) router.back();
  }, [request, router]);

  // Outro motorista (ou o servidor) já assumiu a corrida → fecha sozinho.
  useEffect(() => {
    if (activeRide && request && activeRide.rideId === request.id) {
      clearPendingRequest();
      router.back();
    }
  }, [activeRide, request, clearPendingRequest, router]);

  const dismiss = () => {
    clearPendingRequest();
    router.back();
  };

  const handleAccept = async () => {
    if (!request || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      await api.acceptRide(request.id);
      clearPendingRequest();
      router.back();
    } catch (cause) {
      // Corrida já aceita por outro / estado inválido → mostra e fecha.
      setAcceptError(
        cause instanceof Error && "status" in cause
          ? `Não foi possível aceitar (HTTP ${(cause as { status: number }).status}).`
          : "Não foi possível aceitar a corrida."
      );
      setTimeout(dismiss, 1600);
    } finally {
      setAccepting(false);
    }
  };

  if (!request) return null;

  return (
    <RideRequestSheet
      request={request}
      onAccept={() => void handleAccept()}
      onDecline={dismiss}
      onTimeout={dismiss}
      acceptDisabled={accepting}
      acceptHint={acceptError}
    />
  );
}
