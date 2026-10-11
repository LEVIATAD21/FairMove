import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";
import { cycleLabel, feeSplitLabel, monthlyFeeLabel } from "../../../src/logic/subscription";
import { completionPercent } from "../../../src/logic/profile";
import { api, type DriverMeResponse, type SubscriptionResponse } from "../../../src/services/api";
import { useAuth } from "../../../src/auth/AuthProvider";

/**
 * Perfil do motorista — dados REAIS:
 * - identidade da sessão (SecureStore) + profile do banco (integridade %);
 * - assinatura real (GET /subscriptions/:id): sem assinatura → estado vazio
 *   honesto, sem ciclo/split inventados;
 * - plano fixo: primeiro mês grátis; depois R$ 100/mês (R$ 59 plataforma + R$ 41 reserva);
 * - logout real (POST /auth/logout + blacklist Redis no servidor).
 */
export default function DriverProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [me, setMe] = useState<DriverMeResponse | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
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
  const cycle = activeSub?.currentBillingCycle ?? 0;
  const profilePercent = completionPercent(me?.profile ?? null);

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
              {feeSplitLabel(cycle, false)}
            </AppText>
            <AppText variant="caption">{monthlyFeeLabel(cycle, false)}</AppText>
            <AppText variant="caption">R$ 41,00 da mensalidade são destinados à sua Reserva de Disciplina e Emergência.</AppText>
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

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          PLANO TRANSPARENTE
        </AppText>
        <AppText variant="bodyStrong">
          Primeiro mês grátis; depois R$ 100,00 por mês.
        </AppText>
        <AppText variant="body">
          R$ 59,00 para a plataforma e R$ 41,00 para a Reserva de Disciplina e Emergência, sem comissão por corrida.
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

      <Button
        title={busy ? "AGUARDE..." : "SAIR DA CONTA"}
        variant="secondary"
        onPress={onLogout}
      />

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  status: { marginTop: spacing.sm },
  split: { color: colors.gold.DEFAULT, marginTop: spacing.sm },
});
