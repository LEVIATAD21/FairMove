import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/** Perfil do motorista — veículo, documentos e conta (Fase 4 detalha). */
export default function DriverProfile() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Perfil</AppText>

      <Card>
        <AppText variant="subtitle">Motorista</AppText>
        <AppText variant="body" color={colors.ice.muted}>
          conta@exemplo.com
        </AppText>
        <AppText variant="caption" style={styles.status}>
          Status: offline · Veículo não cadastrado
        </AppText>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          COMPROMISSO FAIRMOVE
        </AppText>
        <AppText variant="body">• Zero comissão por corrida</AppText>
        <AppText variant="body">• Primeiro mês grátis (trial)</AppText>
        <AppText variant="body">• Reserva de Disciplina e Emergência transparente</AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  status: { marginTop: spacing.sm },
});
