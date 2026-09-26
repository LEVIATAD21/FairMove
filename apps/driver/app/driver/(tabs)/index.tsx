import { StyleSheet, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/**
 * Home do motorista: status online/offline + ganhos do dia.
 * Placeholder até a Fase 2 conectar a máquina de estados (XState).
 */
export default function DriverHome() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">100% PARA VOCÊ</AppText>
        <AppText variant="title">Bom trabalho!</AppText>
      </View>

      <Card variant="gold">
        <AppText variant="caption">STATUS</AppText>
        <AppText variant="title" color={colors.gold.DEFAULT}>
          Offline
        </AppText>
        <Button title="Ficar online" variant="secondary" style={styles.statusBtn} />
      </Card>

      <Card>
        <AppText variant="caption">GANHOS DE HOJE</AppText>
        <AppText variant="display" color={colors.ice.DEFAULT}>
          R$ 0,00
        </AppText>
        <AppText variant="caption">Sem comissão — você recebe o valor exato das corridas.</AppText>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          PRÓXIMA CORRIDA
        </AppText>
        <AppText variant="body">
          A solicitação aparecerá aqui mostrando “Você recebe R$ X” antes de aceitar.
        </AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  statusBtn: { marginTop: spacing.md },
});
