import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/** Carteira do passageiro (placeholder até a Fase 2 conectar o serviço). */
export default function PassengerWallet() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Carteira</AppText>

      <Card variant="gold">
        <AppText variant="caption">SALDO DISPONÍVEL</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          R$ 0,00
        </AppText>
        <AppText variant="caption">Sem mensalidade. Sem taxa escondida.</AppText>
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          COMO FUNCIONA
        </AppText>
        <AppText variant="body">• Você paga somente o valor final da corrida</AppText>
        <AppText variant="body">• Promoções reduzem o valor sem mudar o que o motorista recebe</AppText>
        <AppText variant="body">• Recarga e histórico chegam na Fase 2</AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
});
