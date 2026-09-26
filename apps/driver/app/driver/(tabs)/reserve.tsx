import { StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

/**
 * Fair Reserve — "Reserva de Disciplina e Emergência":
 * carteira separada, bloqueada para saque imediato (resgate só em emergência
 * validada ou no desligamento). Mostra o plano progressivo de assinatura.
 */
export default function DriverReserve() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Fair Reserve</AppText>
      <AppText variant="caption">Reserva de Disciplina e Emergência</AppText>

      <Card variant="gold">
        <AppText variant="caption">SALDO NA RESERVA</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          R$ 0,00
        </AppText>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <AppText variant="caption">Meta: R$ 1.000,00 · 0% concluído</AppText>
        <AppText variant="caption" color={colors.warning}>
          Saque bloqueado — resgate em emergência validada ou no desligamento
        </AppText>
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          SEU PLANO PROGRESSIVO
        </AppText>
        <AppText variant="bodyStrong" color={colors.success}>
          Mês 1 · Trial — R$ 0,00
        </AppText>
        <AppText variant="caption">Primeiro mês grátis: opere livre, receba 100%.</AppText>

        <AppText variant="bodyStrong" style={styles.planRow}>
          Mês 2 — R$ 100,00
        </AppText>
        <AppText variant="caption">R$ 51,00 plataforma + R$ 49,00 para a sua reserva.</AppText>

        <AppText variant="bodyStrong" style={styles.planRow}>
          Mês 3 em diante — R$ 200,00 (teto)
        </AppText>
        <AppText variant="caption">R$ 130,00 plataforma + R$ 70,00 para a sua reserva.</AppText>

        <AppText variant="bodyStrong" style={styles.planRow} color={colors.warning}>
          Opt-out — R$ 150,00 fixos
        </AppText>
        <AppText variant="caption">
          Sair da reserva zera o aporte e mantém a mensalidade fixa para a plataforma.
        </AppText>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
  planRow: { marginTop: spacing.md },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.graphite.raised,
    overflow: "hidden",
    marginVertical: spacing.sm,
  },
  progressFill: {
    width: "0%",
    height: "100%",
    backgroundColor: colors.gold.DEFAULT,
    borderRadius: 4,
  },
});
