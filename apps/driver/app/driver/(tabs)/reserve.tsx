import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { AppText, Card, MonogramWatermark, colors, radius, spacing } from "@fairmove/ui";
import {
  RESERVE_GOAL_CENTS,
  contributionLabel,
  progressPercent,
  reserveProgressLabel,
} from "../../../src/logic/reserve";
import { api, type LedgerTransaction, type WalletBalance } from "../../../src/services/api";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

type Contribution = { cents: number; month: string; year: number; note?: string };

/** Aportes reais: transações do ledger com tipo reserve_contribution. */
function toContributions(transactions: LedgerTransaction[]): Contribution[] {
  return transactions
    .filter((tx) => tx.transactionType === "reserve_contribution")
    .map((tx) => {
      const date = new Date(tx.created_at);
      return {
        cents: tx.amount,
        month: MONTHS_PT[date.getMonth()],
        year: date.getFullYear(),
        note: tx.description && tx.description !== "Reserve contribution" ? tx.description : undefined,
      };
    });
}

/**
 * Reserva de Disciplina e Emergência — saldo REAL de `wallets.reserve_balance`
 * e histórico REAL de aportes no ledger. Banco vazio → R$ 0 da meta e
 * "sem aportes ainda" (nada de dados inventados).
 */
export default function DriverReserve() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [balanceResponse, transactions] = await Promise.all([
        api.getBalance(),
        api.getTransactions(),
      ]);
      setBalance(balanceResponse);
      setContributions(toContributions(transactions));
    } catch {
      // Sem rede/sessão: mantém zeros — AuthProvider cuida do redirecionamento.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const balanceCents = balance?.reserveBalance ?? 0;
  const percent = progressPercent(balanceCents, RESERVE_GOAL_CENTS);

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
          {loaded ? reserveProgressLabel(balanceCents, RESERVE_GOAL_CENTS) : "—"}
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
        {contributions.length === 0 ? (
          <AppText variant="body">
            {loaded
              ? "Nenhum aporte ainda — seus aportes mensais aparecerão aqui assim que a reserva começar."
              : "Carregando aportes..."}
          </AppText>
        ) : (
          contributions.map((entry) => (
            <View key={`${entry.month}-${entry.year}`} style={styles.contributionRow}>
              <AppText variant="bodyStrong" color={colors.success}>
                {contributionLabel(entry.cents, entry.month, entry.year, entry.note)}
              </AppText>
            </View>
          ))
        )}
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
