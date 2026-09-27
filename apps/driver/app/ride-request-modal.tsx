import { useRouter } from "expo-router";
import { RideRequestSheet } from "../src/components/RideRequestSheet";
import { mockRideRequest } from "../src/services/mock";

/**
 * Rota global de solicitação de corrida — apresentada como `transparentModal`,
 * interrompendo a navegação com blur + bordas douradas.
 */
export default function RideRequestModal() {
  const router = useRouter();

  return (
    <RideRequestSheet
      request={mockRideRequest}
      onAccept={() => router.back()}
      onDecline={() => router.back()}
      onTimeout={() => router.back()}
    />
  );
}
