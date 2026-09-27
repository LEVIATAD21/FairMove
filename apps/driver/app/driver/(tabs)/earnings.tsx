import { ScrollView, StyleSheet, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import { mockWallet } from "../../../src/services/mock";

/**
 * Carteira e Ganhos: saldo disponível para saque (`wallet_balance`),
 * evolução semanal em gráfico de barras e últimas corridas com valor líquido.
 */
export default function DriverEarnings() {
  const maxWeekly = Math.max(...mockWallet.weeklyEarnings.map((d) => d.cents), 1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">Carteira</AppText>
        <AppText variant="title">Ganhos</AppText>
      </View>

      <Card variant="gold">
        <AppText variant="caption">SALDO DISPONÍVEL PARA SAQUE</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          {formatBRL(mockWallet.availableBalanceCents)}
        </AppText>
        <AppText variant="caption">
          Saque livre — prêmios da liga e corridas entram direto na sua carteira.
        </AppText>
        <Button title="SACAR" variant="primary" style={styles.btn} />
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          EVOLUÇÃO SEMANAL
        </AppText>
        <View style={styles.chart}>
          {mockWallet.weeklyEarnings.map((day) => {
            const heightPercent = Math.max(4, Math.round((day.cents / maxWeekly) * 100));
            return (
              <View key={day.day} style={styles.barColumn}>
                <AppText variant="caption" align="center" color={colors.gold.light}>
                  {formatBRL(day.cents).replace("R$ ", "")}
                </AppText>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
                </View>
                <AppText variant="caption" align="center">
                  {day.day}
                </AppText>
              </View>
            );
          })}
        </View>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT} style={styles.section}>
          ÚLTIMAS CORRIDAS — VALOR LÍQUIDO
        </AppText>
        {mockWallet.recentRides.map((ride) => (
          <View key={ride.id} style={styles.rideRow}>
            <View style={styles.rideInfo}>
              <AppText variant="body" numberOfLines={1}>
                {ride.label}
              </AppText>
            </View>
            <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
              {`+ ${formatBRL(ride.netCents)}`}
            </AppText>
          </View>
        ))}
        <AppText variant="caption">Zero comissão — este é o valor que chegou para você.</AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
  btn: { marginTop: spacing.md },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    height: 180,
    marginTop: spacing.sm,
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    height: "100%",
    justifyContent: "flex-end",
  },
  barTrack: {
    width: "100%",
    flex: 1,
    justifyContent: "flex-end",
    borderRadius: radius.sm,
    backgroundColor: colors.graphite.raised,
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    backgroundColor: colors.gold.DEFAULT,
    borderRadius: radius.sm,
  },
  rideRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glass.border,
  },
  rideInfo: { flex: 1 },
});
