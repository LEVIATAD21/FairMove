import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/ride-request";
import {
  api,
  type LedgerTransaction,
  type RideHistoryItem,
  type WalletBalance,
} from "../../../src/services/api";

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const CREDIT_TYPES = new Set(["credit", "deposit", "ride_credit"]);

/**
 * Carteira e Ganhos — TUDO real do backend:
 * - saldo: GET /api/v1/wallets/me/balance (centavos vindos do ledger);
 * - semana: soma de créditos por dia a partir de GET /wallets/:id/transactions;
 * - últimas corridas: GET /api/v1/rides/history/me (driverCredit).
 * Banco vazio → R$ 0,00, barras zeradas e lista "sem dados".
 */
export default function DriverEarnings() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [balanceResponse, txs, rideHistory] = await Promise.all([
        api.getBalance(),
        api.getTransactions(),
        api.getRides(),
      ]);
      setBalance(balanceResponse);
      setTransactions(txs);
      setRides(rideHistory);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Últimos 7 dias (inclui hoje), soma de créditos reais por dia.
  const weekly = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - offset));
    const cents = transactions
      .filter((tx) => {
        if (!CREDIT_TYPES.has(tx.transactionType)) return false;
        const created = new Date(tx.created_at);
        return (
          created.getFullYear() === date.getFullYear() &&
          created.getMonth() === date.getMonth() &&
          created.getDate() === date.getDate()
        );
      })
      .reduce((sum, tx) => sum + tx.amount, 0);
    return { day: WEEK_DAYS[date.getDay()], cents };
  });
  const maxWeekly = Math.max(...weekly.map((d) => d.cents), 1);

  const recentRides = rides.slice(0, 5);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">Carteira</AppText>
        <AppText variant="title">Ganhos</AppText>
      </View>

      <Card variant="gold">
        <AppText variant="caption">SALDO DISPONÍVEL PARA SAQUE</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          {balance ? formatBRL(balance.availableBalance) : "—"}
        </AppText>
        <AppText variant="caption">
          Saque livre — prêmios da liga e corridas entram direto na sua carteira.
        </AppText>
        <Button
          title="SACAR"
          variant="primary"
          style={styles.btn}
          onPress={() =>
            Alert.alert(
              "Saque",
              "O fluxo de saque bancário ainda não está configurado. Assim que o meio de pagamento real for conectado, o botão passa a executar transferências de verdade."
            )
          }
        />
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          EVOLUÇÃO SEMANAL
        </AppText>
        <View style={styles.chart}>
          {weekly.map((day) => {
            const heightPercent = Math.max(4, Math.round((day.cents / maxWeekly) * 100));
            return (
              <View key={`${day.day}-${day.cents}`} style={styles.barColumn}>
                <AppText variant="caption" align="center" color={colors.gold.light}>
                  {formatBRL(day.cents).replace("R$ ", "")}
                </AppText>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
                </View>
                <AppText variant="caption" align="center">
                  {day.day}
                </AppText>
              </View>
            );
          })}
        </View>
        {transactions.length === 0 && !error ? (
          <AppText variant="caption">Sem movimentação nos últimos 7 dias.</AppText>
        ) : null}
      </Card>

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT} style={styles.section}>
          ÚLTIMAS CORRIDAS — VALOR LÍQUIDO
        </AppText>
        {recentRides.length === 0 ? (
          <AppText variant="body">
            {error
              ? "Não foi possível carregar suas corridas agora."
              : "Nenhuma corrida ainda — a primeira aparecerá aqui quando você completar uma corrida."}
          </AppText>
        ) : (
          recentRides.map((ride) => (
            <View key={ride.id} style={styles.rideRow}>
              <View style={styles.rideInfo}>
                <AppText variant="body" numberOfLines={1}>
                  {`Corrida ${ride.id.slice(0, 8).toUpperCase()} · ${ride.status}`}
                </AppText>
              </View>
              <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
                {`+ ${formatBRL(ride.driverCredit)}`}
              </AppText>
            </View>
          ))
        )}
        <AppText variant="caption">Zero comissão — este é o valor que chegou para você.</AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
  btn: { marginTop: spacing.md },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    height: 180,
    marginTop: spacing.sm,
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    height: "100%",
    justifyContent: "flex-end",
  },
  barTrack: {
    width: "100%",
    flex: 1,
    justifyContent: "flex-end",
    borderRadius: radius.sm,
    backgroundColor: colors.graphite.raised,
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    backgroundColor: colors.gold.DEFAULT,
    borderRadius: radius.sm,
  },
  rideRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glass.border,
  },
  rideInfo: { flex: 1 },
});
