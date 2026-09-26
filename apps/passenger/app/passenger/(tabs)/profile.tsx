import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/** Perfil do passageiro (placeholder até a Fase 2). */
export default function PassengerProfile() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Perfil</AppText>

      <Card>
        <AppText variant="subtitle">Passageiro</AppText>
        <AppText variant="body" color={colors.ice.muted}>
          conta@exemplo.com
        </AppText>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          IDENTIDADE FAIRMOVE
        </AppText>
        <AppText variant="body">• Preço transparente: você vê o total antes de pedir</AppText>
        <AppText variant="body">• Zero comissão por corrida para o motorista</AppText>
        <AppText variant="body">• Avaliação mútua passageiro ↔ motorista</AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
});
