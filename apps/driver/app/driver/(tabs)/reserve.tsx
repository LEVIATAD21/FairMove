import { ScrollView, StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import {
  RESERVE_GOAL_CENTS,
  contributionLabel,
  progressPercent,
  reserveProgressLabel,
} from "../../../src/logic/reserve";
import { mockReserve } from "../../../src/services/mock";

/**
 * Reserva de Disciplina e Emergência — saldo protegido, meta de R$ 1.000 e
 * histórico de aportes mensais. Este valor é do motorista; saque apenas em
 * emergência validada ou no desligamento.
 */
export default function DriverReserve() {
  const percent = progressPercent(mockReserve.balanceCents, mockReserve.goalCents);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="title">Reserva de Disciplina e Emergência</AppText>
        <AppText variant="caption">
          Este valor é seu e está protegido para manutenção, emergências ou imprevistos.
        </AppText>
      </View>

      <Card variant="gold">
        <AppText variant="caption">SEU PROGRESSO</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          {reserveProgressLabel(mockReserve.balanceCents, mockReserve.goalCents)}
        </AppText>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
        <AppText variant="caption">{`${percent}% da meta concluída`}</AppText>

        <AppText variant="caption" color={colors.warning}>
          Saque bloqueado — resgate em emergência validada ou no desligamento.
        </AppText>
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          HISTÓRICO DE APORTES
        </AppText>
        {mockReserve.contributions.map((entry) => (
          <View key={`${entry.month}-${entry.year}`} style={styles.contributionRow}>
            <AppText variant="bodyStrong" color={colors.success}>
              {contributionLabel(entry.cents, entry.month, entry.year, entry.note)}
            </AppText>
          </View>
        ))}
        <AppText variant="caption">
          Aportes mensais conforme seu ciclo: R$ 49,00 no mês 2 e R$ 70,00 do mês 3 em diante.
        </AppText>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT} style={styles.section}>
          COMO FUNCIONA
        </AppText>
        <AppText variant="body">• O dinheiro fica separado da sua carteira de saque.</AppText>
        <AppText variant="body">• Rende conforme as regras do plano FairMove.</AppText>
        <AppText variant="body">
          • Emergências validadas liberam o resgate — ou você recebe tudo ao desligar.
        </AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { gap: spacing.sm, marginTop: spacing.lg },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
  progressTrack: {
    height: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.graphite.raised,
    overflow: "hidden",
    marginTop: spacing.sm,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.gold.DEFAULT,
    borderRadius: radius.sm,
  },
  contributionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glass.border,
  },
});
