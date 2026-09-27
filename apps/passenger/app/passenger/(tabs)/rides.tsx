import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/format";
import { api, type RideHistoryItem } from "../../../src/services/api";

const STATUS_PT: Record<string, string> = {
  REQUESTED: "Procurando motorista",
  SEARCHING: "Procurando motorista",
  DRIVER_ASSIGNED: "Motorista designado",
  DRIVER_ARRIVING: "Motorista a caminho",
  DRIVER_AT_PICKUP: "Motorista no local",
  PASSENGER_ONBOARD: "Embarcado",
  IN_PROGRESS: "Em viagem",
  COMPLETED: "Concluída",
  CANCELLED_BY_PASSENGER: "Cancelada por você",
  CANCELLED_BY_DRIVER: "Cancelada pelo motorista",
  CANCELLED_BY_SYSTEM: "Cancelada",
  FAILED: "Falhou",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Histórico REAL do passageiro (GET /rides/history/me), sem mocks. */
export default function PassengerRides() {
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const history = await api.getRides();
      setRides(history);
      setError(null);
    } catch {
      setError("Não foi possível carregar o histórico.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <MonogramWatermark />
      <AppText variant="title">Suas corridas</AppText>

      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}

      {!loaded ? (
        <Card style={styles.empty}>
          <AppText variant="body" align="center">
            Carregando histórico...
          </AppText>
        </Card>
      ) : rides.length === 0 ? (
        <Card style={styles.empty}>
          <AppText variant="bodyStrong" align="center">
            Nenhuma corrida ainda
          </AppText>
          <AppText variant="body" align="center">
            Quando você pedir uma corrida, ela aparece aqui com preço final travado.
          </AppText>
        </Card>
      ) : (
        rides.map((ride) => (
          <Card key={ride.id}>
            <View style={styles.rideRow}>
              <View style={styles.rideInfo}>
                <AppText variant="bodyStrong">
                  {STATUS_PT[ride.status] ?? ride.status}
                </AppText>
                <AppText variant="caption">
                  {formatDate(ride.createdAt)}
                </AppText>
              </View>
              <AppText variant="subtitle" color={colors.gold.DEFAULT}>
                {formatBRL(Math.round((ride.totalFare ?? 0) * 100))}
              </AppText>
            </View>
          </Card>
        ))
      )}

      <Card variant="solid" style={styles.rule}>
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          REGRAS
        </AppText>
        <AppText variant="body">• Preço final mostrado antes de confirmar</AppText>
        <AppText variant="body">• Motorista recebe exatamente o que você paga</AppText>
        <AppText variant="body">• Cancelamento sem taxa abusiva</AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  empty: {
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  rule: { gap: spacing.xs },
  rideRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  rideInfo: { gap: 2, flex: 1 },
});
