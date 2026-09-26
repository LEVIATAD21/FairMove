import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/** Corridas do motorista — histórico (Fase 4 conecta a RideMachine). */
export default function DriverRides() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Suas corridas</AppText>

      <Card style={styles.empty}>
        <AppText variant="bodyStrong" align="center">
          Nenhuma corrida hoje
        </AppText>
        <AppText variant="body" align="center">
          Fique online para receber solicitações com o valor que você recebe mostrado na frente.
        </AppText>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          GARANTIAS
        </AppText>
        <AppText variant="body">• Você recebe exatamente o valor pago pelo passageiro</AppText>
        <AppText variant="body">• Zero comissão por corrida</AppText>
        <AppText variant="body">• Ganhos creditados após cada viagem concluída</AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  empty: { gap: spacing.sm, alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.xxl },
});
