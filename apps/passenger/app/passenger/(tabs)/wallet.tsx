import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/format";
import {
  api,
  type LedgerTransaction,
  type WalletBalance,
} from "../../../src/services/api";

/**
 * Carteira REAL do passageiro: saldo de /wallets/me/balance + extrato de
 * /wallets/:id/transactions. Recarga via gateway não existe ainda (501).
 */
export default function PassengerWallet() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [balanceResult, transactionsResult] = await Promise.all([
        api.getBalance(),
        api.getTransactions(),
      ]);
      setBalance(balanceResult);
      setTransactions(transactionsResult);
      setError(null);
    } catch {
      setError("Não foi possível carregar a carteira.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toCents = (value: number) => Math.round(value * 100);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <MonogramWatermark />
      <AppText variant="title">Carteira</AppText>

      <Card variant="gold">
        <AppText variant="caption">SALDO DISPONÍVEL</AppText>
        <AppText variant="display" color={colors.gold.DEFAULT}>
          {balance ? formatBRL(toCents(balance.availableBalance)) : loaded ? "—" : "Carregando..."}
        </AppText>
        <AppText variant="caption">Sem mensalidade. Sem taxa escondida.</AppText>
        {error ? (
          <AppText variant="caption" color={colors.danger}>
            {error}
          </AppText>
        ) : null}
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          EXTRATO
        </AppText>
        {loaded && transactions.length === 0 ? (
          <AppText variant="body" color={colors.ice.muted}>
            Nenhuma movimentação ainda.
          </AppText>
        ) : (
          transactions.slice(0, 20).map((transaction) => (
            <View key={transaction.id} style={styles.txRow}>
              <View style={styles.txInfo}>
                <AppText variant="body" numberOfLines={1}>
                  {transaction.description ?? transaction.transactionType}
                </AppText>
                <AppText variant="caption">
                  {new Date(transaction.created_at).toLocaleDateString("pt-BR")}
                </AppText>
              </View>
              <AppText
                variant="bodyStrong"
                color={
                  transaction.transactionType === "credit"
                    ? colors.success
                    : colors.ice.DEFAULT
                }
              >
                {transaction.transactionType === "credit" ? "+" : "−"}
                {formatBRL(toCents(transaction.amount))}
              </AppText>
            </View>
          ))
        )}
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          COMO FUNCIONA
        </AppText>
        <AppText variant="body">• Você paga somente o valor final da corrida</AppText>
        <AppText variant="body">• Promoções reduzem o valor sem mudar o que o motorista recebe</AppText>
        <AppText variant="body">• Recarga com cartão chega com o gateway oficial</AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  section: { letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.xs },
  txRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  txInfo: { gap: 2, flex: 1 },
});
