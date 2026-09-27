import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import {
  AppText,
  Button,
  Card,
  MonogramWatermark,
  colors,
  spacing,
} from "@fairmove/ui";
import { formatBRL, formatCoord } from "../../../src/logic/format";
import { canSearch, searchPlaces, type PlaceSuggestion } from "../../../src/services/geocode";
import type { QuoteResponse } from "../../../src/services/api";
import { api } from "../../../src/services/api";
import { useRealtime } from "../../../src/realtime/RealtimeProvider";

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Procurando motorista...",
  SEARCHING: "Procurando motorista...",
  DRIVER_ASSIGNED: "Motorista a caminho",
  DRIVER_ARRIVING: "Motorista a caminho",
  DRIVER_AT_PICKUP: "Motorista no local",
  PASSENGER_ONBOARD: "Embarcado",
  IN_PROGRESS: "Em viagem",
};

/** Distância exibida ao usuário (display puro — o matching é do PostGIS no servidor). */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Home do passageiro — ciclo completo REAL:
 * - pickup = posição real do aparelho (permissão obrigatória);
 * - destino = geocoding OSM (Nominatim) por texto;
 * - preço = quote real do pricing engine antes de confirmar;
 * - pedido = POST /rides; acompanhamento por WebSocket (sem polling);
 * - corrida ativa mostra motorista real (nome/placa) e posição em tempo real.
 */
export default function PassengerHome() {
  const {
    connected,
    activeRide,
    matchedDriver,
    driverLocation,
    requestRide,
    cancelRide,
    error,
  } = useRealtime();

  const [pickup, setPickup] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupDenied, setPickupDenied] = useState(false);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destination, setDestination] = useState<PlaceSuggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locateMe = useCallback(async () => {
    setPickupLoading(true);
    setPickupDenied(false);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setPickupDenied(true);
        setPickup(null);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPickup({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setPickupDenied(true);
    } finally {
      setPickupLoading(false);
    }
  }, []);

  useEffect(() => {
    void locateMe();
  }, [locateMe]);

  // Busca de destino com debounce (Nominatim policy: sem pressa).
  const onDestinationText = (text: string) => {
    setDestinationQuery(text);
    setDestination(null);
    setQuote(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!canSearch(text)) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      void searchPlaces(text)
        .then(setSuggestions)
        .finally(() => setSearching(false));
    }, 450);
  };

  const pickDestination = (place: PlaceSuggestion) => {
    setDestination(place);
    setDestinationQuery(place.label);
    setSuggestions([]);
  };

  // Quote real assim que pickup+destino estão prontos.
  useEffect(() => {
    if (!pickup || !destination) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    api
      .quote({
        pickupLocationLat: pickup.lat,
        pickupLocationLng: pickup.lng,
        dropoffLocationLat: destination.lat,
        dropoffLocationLng: destination.lng,
      })
      .then((result) => {
        if (!cancelled) setQuote(result);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickup, destination]);

  const onRequest = async () => {
    if (!pickup || !destination || requesting) return;
    setRequesting(true);
    try {
      await requestRide(pickup, destination);
    } catch {
      // erro já no contexto (error)
    } finally {
      setRequesting(false);
    }
  };

  const onCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelRide("Cancelado pelo passageiro no app");
    } finally {
      setCancelling(false);
    }
  };

  const driverDistanceKm =
    pickup && driverLocation
      ? haversineKm(pickup, { lat: driverLocation.lat, lng: driverLocation.lng })
      : null;

  // ---- Corrida ativa (acompanhamento por WS) --------------------------------
  if (activeRide) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <MonogramWatermark />
        <View style={styles.header}>
          <AppText variant="slogan">Corrida em andamento</AppText>
          <AppText variant="title">
            {STATUS_LABEL[activeRide.status] ?? activeRide.status}
          </AppText>
          <AppText variant="caption">
            {connected ? "Tempo real conectado" : "Reconectando..."}
          </AppText>
        </View>

        {matchedDriver ? (
          <Card variant="gold">
            <AppText variant="caption">SEU MOTORISTA</AppText>
            <AppText variant="subtitle">{matchedDriver.driverName}</AppText>
            <AppText variant="body" color={colors.ice.muted}>
              {matchedDriver.vehiclePlate || "Placa não informada"}
            </AppText>
            {driverDistanceKm !== null ? (
              <AppText variant="caption">
                Distância do motorista: ~{driverDistanceKm.toFixed(1).replace(".", ",")} km
              </AppText>
            ) : null}
          </Card>
        ) : (
          <Card>
            <ActivityIndicator color={colors.gold.DEFAULT} />
            <AppText variant="body" align="center">
              Aguardando um motorista aceitar sua corrida...
            </AppText>
          </Card>
        )}

        <Card>
          <AppText variant="caption">PREÇO TRAVADO</AppText>
          <AppText variant="title" color={colors.gold.DEFAULT}>
            {formatBRL(activeRide.fareCents)}
          </AppText>
          <AppText variant="caption">
            Zero comissão — o motorista recebe exatamente isso.
          </AppText>
        </Card>

        {error ? (
          <AppText variant="caption" color={colors.danger} align="center">
            {error}
          </AppText>
        ) : null}

        <Button
          title={cancelling ? "Cancelando..." : "CANCELAR CORRIDA"}
          variant="danger"
          onPress={() => void onCancel()}
          disabled={cancelling}
        />
      </ScrollView>
    );
  }

  // ---- Pedido de corrida ----------------------------------------------------
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="title">Para onde vamos?</AppText>
        <AppText variant="caption">
          {connected ? "Tempo real conectado" : "Conectando ao servidor..."}
        </AppText>
      </View>

      <Card>
        <AppText variant="caption">PICKUP (SUA POSIÇÃO REAL)</AppText>
        {pickup ? (
          <AppText variant="body" color={colors.ice.DEFAULT}>
            {formatCoord(pickup.lat, pickup.lng)}
          </AppText>
        ) : (
          <AppText variant="body" color={pickupDenied ? colors.danger : colors.ice.muted}>
            {pickupDenied
              ? "Permissão de localização negada — é obrigatória para pedir corrida."
              : pickupLoading
                ? "Obtendo sua posição..."
                : "Posição indisponível."}
          </AppText>
        )}
        <Button
          title="ATUALIZAR POSIÇÃO"
          variant="ghost"
          onPress={() => void locateMe()}
          disabled={pickupLoading}
        />
      </Card>

      <Card>
        <AppText variant="caption">DESTINO</AppText>
        <TextInput
          style={styles.input}
          placeholder="Buscar endereço (ex: Avenida Paulista)"
          placeholderTextColor={colors.ice.muted}
          value={destinationQuery}
          onChangeText={onDestinationText}
          autoCapitalize="words"
        />
        {searching ? <AppText variant="caption">Buscando...</AppText> : null}
        {suggestions.map((place) => (
          <Button
            key={`${place.lat},${place.lng}`}
            title={place.label.length > 70 ? `${place.label.slice(0, 70)}…` : place.label}
            variant="ghost"
            onPress={() => pickDestination(place)}
          />
        ))}
        {destination ? (
          <AppText variant="caption" color={colors.success}>
            Destino selecionado: {formatCoord(destination.lat, destination.lng)}
          </AppText>
        ) : null}
      </Card>

      <Card variant="gold">
        <AppText variant="caption">PREÇO ANTES DE CONFIRMAR</AppText>
        {quoting ? (
          <AppText variant="body">Calculando com o pricing real...</AppText>
        ) : quote ? (
          <>
            <View style={styles.priceRow}>
              <View>
                <AppText variant="caption">Você paga</AppText>
                <AppText variant="title" color={colors.gold.DEFAULT}>
                  {formatBRL(Math.round(quote.passengerPrice * 100))}
                </AppText>
              </View>
              <View>
                <AppText variant="caption">Motorista recebe</AppText>
                <AppText variant="title" color={colors.ice.DEFAULT}>
                  {formatBRL(Math.round(quote.driverCredit * 100))}
                </AppText>
              </View>
            </View>
            <AppText variant="caption" color={colors.success}>
              {quote.distanceKm.toFixed(1).replace(".", ",")} km · ~
              {quote.timeMinutes} min · zero comissão
            </AppText>
          </>
        ) : (
          <AppText variant="body" color={colors.ice.muted}>
            Selecione o destino para ver o preço final.
          </AppText>
        )}
      </Card>

      {error ? (
        <AppText variant="caption" color={colors.danger} align="center">
          {error}
        </AppText>
      ) : null}

      <Button
        title={requesting ? "PEDINDO..." : "PEDIR CORRIDA"}
        variant="primary"
        style={styles.cta}
        onPress={() => void onRequest()}
        disabled={!pickup || !destination || !quote || requesting}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.glass.border,
    borderRadius: 8,
    backgroundColor: colors.graphite.deepest,
    color: colors.ice.DEFAULT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cta: { marginTop: spacing.sm },
});
