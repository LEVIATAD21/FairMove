import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Switch, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import { cycleLabel, feeSplitLabel, monthlyFeeLabel } from "../../../src/logic/subscription";
import { mockCurrentCycle, mockDriverProfile } from "../../../src/services/mock";

/**
 * Perfil do motorista — ciclo do plano progressivo, divisão da taxa e
 * opt-out da Reserva de Disciplina (com modal de confirmação sério).
 */
export default function DriverProfile() {
  const [optedOut, setOptedOut] = useState(mockDriverProfile.optedOutOfReserve);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const monthsActive = mockCurrentCycle();

  const handleToggle = (value: boolean) => {
    if (value) {
      // Ativar opt-out exige confirmação explícita.
      setConfirmOpen(true);
    } else {
      setOptedOut(false);
    }
  };

  const confirmOptOut = () => {
    setOptedOut(true);
    setConfirmOpen(false);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Perfil</AppText>

      <Card>
        <AppText variant="subtitle">{mockDriverProfile.name}</AppText>
        <AppText variant="body" color={colors.ice.muted}>
          {mockDriverProfile.email}
        </AppText>
        <AppText variant="caption" style={styles.status}>
          {`Status: offline · Perfil ${mockDriverProfile.profileCompletionPercent}% completo`}
        </AppText>
      </Card>

      <Card variant="gold">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          SEU CICLO ATUAL
        </AppText>
        <AppText variant="subtitle">{cycleLabel(monthsActive)}</AppText>
        <AppText variant="bodyStrong" style={styles.split}>
          {feeSplitLabel(monthsActive, optedOut)}
        </AppText>
        <AppText variant="caption">{monthlyFeeLabel(monthsActive, optedOut)}</AppText>
        <AppText variant="caption">
          {optedOut
            ? "Opt-out ativo: taxa fixa integralmente para a plataforma, sem aportes na reserva."
            : "A reserva é um direito seu — este valor continua protegido e nunca sai da conta."}
        </AppText>
      </Card>

      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <AppText variant="bodyStrong">Sair do plano de reserva</AppText>
            <AppText variant="caption">
              Deseja sair do plano de reserva e pagar {formatBRL(15_000)} fixos?
            </AppText>
          </View>
          <Switch
            value={optedOut}
            onValueChange={handleToggle}
            trackColor={{ false: colors.graphite.raised, true: colors.gold.dark }}
            thumbColor={optedOut ? colors.gold.DEFAULT : colors.graphite.line}
            accessibilityLabel="Sair do plano de reserva"
          />
        </View>
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          COMPROMISSO FAIRMOVE
        </AppText>
        <AppText variant="body">• Zero comissão por corrida</AppText>
        <AppText variant="body">• Primeiro mês grátis (trial)</AppText>
        <AppText variant="body">• Reserva de Disciplina e Emergência transparente</AppText>
      </Card>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <AppText variant="title" color={colors.danger}>
              Sair da Reserva de Disciplina?
            </AppText>
            <AppText variant="body">
              Ao confirmar, a Reserva de Disciplina e Emergência será{" "}
              <AppText variant="bodyStrong" color={colors.danger}>
                congelada permanentemente
              </AppText>
              : os {formatBRL(28_700)} já acumulados ficam retidos até uma emergência validada ou o
              seu desligamento, e nenhum novo aporte será feito.
            </AppText>
            <AppText variant="body">
              Sua taxa mensal passa a ser fixa de {formatBRL(15_000)}, integralmente para a
              plataforma — esta mudança é permanente e não pode ser desfeita.
            </AppText>
            <Button title="CONFIRMAR SAÍDA" variant="danger" onPress={confirmOptOut} />
            <Button title="MANTER NA RESERVA" variant="secondary" onPress={() => setConfirmOpen(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  status: { marginTop: spacing.sm },
  split: { color: colors.gold.DEFAULT, marginTop: spacing.sm },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
  },
  toggleInfo: { flex: 1, gap: spacing.xs },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: "rgba(5, 5, 5, 0.85)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.graphite.deep,
  },
});
