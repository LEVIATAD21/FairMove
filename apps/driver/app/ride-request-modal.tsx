import { useEffect, useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RideRequestSheet } from "../src/components/RideRequestSheet";
import type { RideRequest } from "../src/logic/ride-request";

/**
 * Rota global de solicitação de corrida — `transparentModal` com blur +
 * bordas douradas. Os dados chegam por params (origin/destination/...),
 * preenchidos pelo transporte em tempo real (WebSocket) quando um passageiro
 * solicitar corrida de verdade. Sem params → fecha (nada de corrida inventada).
 */
export default function RideRequestModal() {
  const router = useRouter();
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

  if (!request) return null;

  return (
    <RideRequestSheet
      request={request}
      onAccept={() => router.back()}
      onDecline={() => router.back()}
      onTimeout={() => router.back()}
    />
  );
}
