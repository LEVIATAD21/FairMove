import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/** Histórico de corridas — empty state (dados chegam com MockServices na Fase 2). */
export default function PassengerRides() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Suas corridas</AppText>

      <Card style={styles.empty}>
        <AppText variant="bodyStrong" align="center">
          Nenhuma corrida ainda
        </AppText>
        <AppText variant="body" align="center">
          Quando você pedir uma corrida, ela aparece aqui com preço final travado.
        </AppText>
      </Card>

      <Card variant="solid" style={styles.rule}>
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          REGRAS
        </AppText>
        <AppText variant="body">• Preço final mostrado antes de confirmar</AppText>
        <AppText variant="body">• Motorista recebe exatamente o que você paga</AppText>
        <AppText variant="body">• Cancelamento sem taxa abusiva</AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  empty: { gap: spacing.sm, alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.xxl },
  rule: { gap: spacing.xs },
});
