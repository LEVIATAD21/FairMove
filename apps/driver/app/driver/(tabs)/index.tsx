import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import { completionPercent } from "../../../src/logic/profile";
import { api, type DriverMeResponse, type RideHistoryItem } from "../../../src/services/api";
import { useAuth } from "../../../src/auth/AuthProvider";

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * Home do motorista — dados REAIS do backend:
 * - saudação/autenticação via sessão (SecureStore);
 * - ganhos de hoje e corridas de hoje derivadas do histórico real;
 * - integridade do perfil calculada do profile persistido.
 * Sem mocks: sem corridas no banco → R$ 0,00 / 0 corridas.
 */
export default function DriverHome() {
  const router = useRouter();
  const { user } = useAuth();
  const [online, setOnline] = useState(false);
  const [me, setMe] = useState<DriverMeResponse | null>(null);
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const glow = useRef(new Animated.Value(0.25)).current;

  const refresh = useCallback(async () => {
    try {
      const [meResponse, rideHistory] = await Promise.all([api.getMe(), api.getRides()]);
      setMe(meResponse);
      setRides(rideHistory);
    } catch {
      // Sessão inválida já redireciona pelo AuthProvider; aqui fica "sem dados".
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Glow pulsante enquanto estiver online.
  useEffect(() => {
    if (!online) {
      glow.setValue(0.25);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.25, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [online, glow]);

  const todayRides = rides.filter(
    (ride) => ride.status === "COMPLETED" && isToday(ride.completedAt ?? ride.createdAt)
  );
  const todayEarningsCents = todayRides.reduce((sum, ride) => sum + ride.driverCredit, 0);
  const profilePercent = completionPercent(me?.profile ?? null);
  const vehicleRegistered = Boolean(me?.driver?.vehicleId);
  const firstName = (user?.name ?? me?.user.name ?? "").split(" ")[0] || "motorista";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">100% para você</AppText>
        <AppText variant="title">Bom trabalho, {firstName}!</AppText>
      </View>

      <View style={styles.statusWrap}>
        <Animated.View
          pointerEvents="none"
          style={[styles.glowLayer, { opacity: online ? glow : 0 }]}
        />
        <Card variant={online ? "gold" : "glass"} style={styles.statusCard}>
          <AppText variant="caption">STATUS DE CONEXÃO</AppText>
          <AppText variant="title" color={online ? colors.success : colors.ice.muted}>
            {online ? "● ONLINE" : "○ OFFLINE"}
          </AppText>
          <AppText variant="caption">
            {online
              ? "Aguardando solicitações reais de passageiros."
              : "Você não está visível para passageiros."}
          </AppText>
          <Button
            title={online ? "FICAR OFFLINE" : "FICAR ONLINE"}
            variant={online ? "secondary" : "primary"}
            onPress={() => setOnline((v) => !v)}
            style={styles.statusBtn}
            accessibilityLabel={online ? "Ficar offline" : "Ficar online"}
          />
        </Card>
      </View>

      <View style={styles.cardsRow}>
        <Card style={styles.flexCard}>
          <AppText variant="caption">GANHOS HOJE</AppText>
          <AppText variant="subtitle" color={colors.gold.DEFAULT}>
            {formatBRL(todayEarningsCents)}
          </AppText>
          <AppText variant="caption">Sem comissão</AppText>
        </Card>

        <Card style={styles.flexCard}>
          <AppText variant="caption">CORRIDAS REALIZADAS</AppText>
          <AppText variant="subtitle" color={colors.ice.DEFAULT}>
            {todayRides.length}
          </AppText>
          <AppText variant="caption">hoje</AppText>
        </Card>
      </View>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          INTEGRIDADE DO PERFIL
        </AppText>
        <AppText variant="bodyStrong">
          {loaded ? `Perfil ${profilePercent}% completo` : "Carregando perfil..."}
        </AppText>
        <AppText variant="caption">
          {vehicleRegistered
            ? "Documentação em dia — você pode operar normalmente."
            : "Envie CNH e documento do veículo para liberar 100% das corridas."}
        </AppText>
        {!vehicleRegistered ? (
          <Button
            title="COMPLETAR CADASTRO"
            variant="ghost"
            onPress={() => router.push("/driver/profile")}
            style={styles.statusBtn}
          />
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  statusWrap: { borderRadius: radius.lg },
  glowLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.gold.DEFAULT,
    backgroundColor: colors.gold.ghost,
  },
  statusCard: { gap: spacing.xs },
  statusBtn: { marginTop: spacing.md },
  cardsRow: { flexDirection: "row", gap: spacing.lg },
  flexCard: { flex: 1, gap: spacing.xs },
});
