import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import {
  mockDriverProfile,
  mockWallet,
  scheduleRideRequest,
} from "../../../src/services/mock";

/**
 * Home do motorista: ficar online/offline (com glow dourado pulsante quando
 * ativo), resumo do dia e integridade do perfil.
 * Mock: 5 s após ficar online chega uma solicitação de corrida (modal global).
 */
export default function DriverHome() {
  const router = useRouter();
  const [online, setOnline] = useState(false);
  const glow = useRef(new Animated.Value(0.25)).current;

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

  // Mock de solicitação: chega 5 segundos após ficar online.
  useEffect(() => {
    if (!online) return;
    const cancel = scheduleRideRequest(() => router.push("/ride-request-modal"));
    return cancel;
  }, [online, router]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">100% para você</AppText>
        <AppText variant="title">Bom trabalho, {mockDriverProfile.name.split(" ")[0]}!</AppText>
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
              ? "Recebendo solicitações — prepare-se para a próxima corrida."
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
            {formatBRL(mockWallet.todayEarningsCents)}
          </AppText>
          <AppText variant="caption">Sem comissão</AppText>
        </Card>

        <Card style={styles.flexCard}>
          <AppText variant="caption">CORRIDAS REALIZADAS</AppText>
          <AppText variant="subtitle" color={colors.ice.DEFAULT}>
            {mockWallet.todayRidesCount}
          </AppText>
          <AppText variant="caption">hoje</AppText>
        </Card>
      </View>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          INTEGRIDADE DO PERFIL
        </AppText>
        <AppText variant="bodyStrong">
          Perfil {mockDriverProfile.profileCompletionPercent}% completo
        </AppText>
        <AppText variant="caption">
          {mockDriverProfile.vehicleRegistered
            ? "Documentação em dia — você pode operar normalmente."
            : "Envie CNH e documento do veículo para liberar 100% das corridas."}
        </AppText>
        {!mockDriverProfile.vehicleRegistered ? (
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
