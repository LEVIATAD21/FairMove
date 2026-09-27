import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import { cycleLabel, feeSplitLabel, monthlyFeeLabel } from "../../../src/logic/subscription";
import { completionPercent } from "../../../src/logic/profile";
import { api, type DriverMeResponse, type SubscriptionResponse } from "../../../src/services/api";
import { useAuth } from "../../../src/auth/AuthProvider";

/**
 * Perfil do motorista — dados REAIS:
 * - identidade da sessão (SecureStore) + profile do banco (integridade %);
 * - assinatura real (GET /subscriptions/:id): sem assinatura → estado vazio
 *   honesto, sem ciclo/split inventados;
 * - opt-out da Reserva → POST /subscriptions/:id/opt-out (irreversível);
 * - logout real (POST /auth/logout + blacklist Redis no servidor).
 */
export default function DriverProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [me, setMe] = useState<DriverMeResponse | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [meResponse, sub] = await Promise.all([api.getMe(), api.getSubscription()]);
      setMe(meResponse);
      setSubscription(sub);
    } catch {
      // Sessão inválida → AuthProvider redireciona; tela fica com dados vazios.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeSub =
    subscription && subscription.hasSubscription ? subscription.subscription : null;
  const optedOut = activeSub?.optedOutOfReserve ?? false;
  const cycle = activeSub?.currentBillingCycle ?? 0;
  const profilePercent = completionPercent(me?.profile ?? null);

  const handleToggle = (value: boolean) => {
    if (value) {
      setConfirmOpen(true);
      return;
    }
    // Opt-out é irreversível por regra de negócio — não há "voltar".
  };

  const confirmOptOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.optOutReserve();
      await refresh();
      setConfirmOpen(false);
    } catch (error) {
      Alert.alert(
        "Não foi possível sair",
        error instanceof Error && error.message.includes("HTTP")
          ? "O servidor recusou a operação. Tente novamente."
          : "Verifique sua conexão e tente novamente."
      );
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
      router.replace("/auth/login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Perfil</AppText>

      <Card>
        <AppText variant="subtitle">{user?.name ?? "—"}</AppText>
        <AppText variant="body" color={colors.ice.muted}>
          {user?.email ?? "—"}
        </AppText>
        <AppText variant="caption" style={styles.status}>
          {`Status: offline · Perfil ${profilePercent}% completo`}
        </AppText>
      </Card>

      <Card variant="gold">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          SEU CICLO ATUAL
        </AppText>
        {activeSub ? (
          <>
            <AppText variant="subtitle">{cycleLabel(cycle)}</AppText>
            <AppText variant="bodyStrong" style={styles.split}>
              {feeSplitLabel(cycle, optedOut)}
            </AppText>
            <AppText variant="caption">{monthlyFeeLabel(cycle, optedOut)}</AppText>
            <AppText variant="caption">
              {optedOut
                ? "Opt-out ativo: taxa fixa integralmente para a plataforma, sem aportes na reserva."
                : "A reserva é um direito seu — este valor continua protegido e nunca sai da conta."}
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="subtitle">Sem assinatura ativa</AppText>
            <AppText variant="caption">
              {subscription
                ? "Seu ciclo começa quando o cadastro do motorista for aprovado."
                : "Não foi possível consultar a assinatura agora."}
            </AppText>
          </>
        )}
      </Card>

      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <AppText variant="bodyStrong">Sair do plano de reserva</AppText>
            <AppText variant="caption">
              {activeSub
                ? `Deseja sair do plano de reserva e pagar ${formatBRL(15_000)} fixos?`
                : "Disponível assim que sua assinatura estiver ativa."}
            </AppText>
          </View>
          <Switch
            value={optedOut}
            disabled={!activeSub || optedOut}
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

      <Button
        title={busy ? "AGUARDE..." : "SAIR DA CONTA"}
        variant="secondary"
        onPress={onLogout}
      />

      <Modal
        visible={confirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmOpen(false)}
      >
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
              : o valor já acumulado fica retido até uma emergência validada ou o seu
              desligamento, e nenhum novo aporte será feito.
            </AppText>
            <AppText variant="body">
              Sua taxa mensal passa a ser fixa de {formatBRL(15_000)}, integralmente para a
              plataforma — esta mudança é permanente e não pode ser desfeita.
            </AppText>
            <Button title="CONFIRMAR SAÍDA" variant="danger" onPress={confirmOptOut} />
            <Button
              title="MANTER NA RESERVA"
              variant="secondary"
              onPress={() => setConfirmOpen(false)}
            />
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
