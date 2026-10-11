import { useCallback, useEffect, useState } from "react";
import { Image, Linking, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";
import { formatBRL } from "../../../src/logic/format";
import {
  ApiError,
  api,
  type LedgerTransaction,
  type PixDepositResponse,
  type WalletBalance,
} from "../../../src/services/api";

const pixFlowAvailableInBuild = typeof __DEV__ !== "undefined" && __DEV__;

function createIdempotencyKey(): string {
  // Identificador de repetição da requisição, não uma credencial de segurança.
  return `pix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    const sum = [...digits.slice(0, length)].reduce(
      (total, digit, index) => total + Number(digit) * (length + 1 - index),
      0
    );
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

function parseBRLAmount(value: string): number {
  const raw = value.trim().replace(/\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  return Number(normalized);
}

/**
 * Carteira do passageiro. Todos os valores do ledger chegam em centavos.
 * O Pix só aparece no build de desenvolvimento até a liquidação/saque de
 * ganhos dos motoristas estar pronta para produção; nenhum saldo é simulado.
 */
export default function PassengerWallet() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("25,00");
  const [payerCpf, setPayerCpf] = useState("");
  const [deposit, setDeposit] = useState<PixDepositResponse | null>(null);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [balanceResult, transactionsResult] = await Promise.all([
        api.getBalance(),
        api.getTransactions(),
      ]);
      setBalance(balanceResult);
      setTransactions(transactionsResult);
      // Recover the latest owned deposit after app restart without blocking
      // the balance/extract if the Pix service is temporarily unavailable.
      try {
        setDeposit(await api.getLatestPixDeposit());
      } catch {
        // Keep the last known deposit state; balance and extract remain usable.
      }
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

  const onCreatePix = async () => {
    if (depositBusy) return;
    const amount = parseBRLAmount(amountText);
    if (!Number.isFinite(amount) || Math.round(amount * 100) < 500 || Math.round(amount * 100) > 500000) {
      setDepositError("Informe um valor entre R$ 5,00 e R$ 5.000,00.");
      return;
    }
    if (!isValidCpf(payerCpf)) {
      setDepositError("Informe um CPF válido com 11 números para gerar o Pix.");
      return;
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
      setDepositError("Informe no máximo duas casas decimais.");
      return;
    }

    const key = idempotencyKey ?? createIdempotencyKey();
    setIdempotencyKey(key);
    setDepositBusy(true);
    setDepositError(null);
    try {
      const result = await api.createPixDeposit(amount, key, payerCpf);
      setDeposit(result);
      setIdempotencyKey(null);
      setAmountText("");
      setPayerCpf("");
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setDepositError(
        status === 503
          ? "O Pix está indisponível neste ambiente. Nenhum saldo foi alterado."
          : status === 409
            ? "Esta tentativa entrou em conflito. Descarte a tentativa ou tente novamente com o mesmo valor."
            : status === 400
              ? "Confira o valor informado e tente novamente."
              : status === 502
                ? "O provedor de pagamento não respondeu corretamente. Tente novamente sem alterar o valor."
                : "Não foi possível criar a cobrança Pix. Verifique a conexão e tente novamente."
      );
    } finally {
      setDepositBusy(false);
    }
  };

  const refreshDeposit = async () => {
    if (!deposit || depositBusy) return;
    setDepositBusy(true);
    setDepositError(null);
    try {
      const refreshed = await api.refreshPixDeposit(deposit.depositId);
      setDeposit(refreshed);
      if (refreshed.status === "approved") {
        await load();
      }
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setDepositError(
        status === 503
          ? "A consulta do provedor está indisponível neste ambiente."
          : status === 502
            ? "O provedor não respondeu corretamente. Tente novamente em instantes."
            : status === 404
              ? "Não encontramos esta cobrança na sua conta."
              : "Não foi possível atualizar o pagamento. Tente novamente."
      );
    } finally {
      setDepositBusy(false);
    }
  };

  const resetDeposit = () => {
    setDeposit(null);
    setDepositError(null);
    setIdempotencyKey(null);
  };

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
          {balance ? formatBRL(balance.availableBalance) : loaded ? "—" : "Carregando..."}
        </AppText>
        <AppText variant="caption">O saldo só muda após uma movimentação confirmada pelo backend.</AppText>
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
                {formatBRL(transaction.amount)}
              </AppText>
            </View>
          ))
        )}
      </Card>

      {pixFlowAvailableInBuild ? (
        <Card>
          <AppText variant="caption" style={styles.section}>
            RECARGA VIA PIX
          </AppText>
          <AppText variant="body">
            Geração real via provedor configurado. O saldo só é liberado depois da confirmação assinada do pagamento.
          </AppText>
          {!deposit ? (
            <>
              <AppText variant="caption">VALOR DA RECARGA (R$ 5,00–R$ 5.000,00)</AppText>
              <TextInput
                accessibilityLabel="Valor da recarga Pix em reais"
                value={amountText}
                onChangeText={setAmountText}
                placeholder="25,00"
                placeholderTextColor={colors.ice.muted}
                keyboardType="decimal-pad"
                editable={!depositBusy && idempotencyKey === null}
                style={styles.amountInput}
                maxLength={12}
              />
              <AppText variant="caption">CPF DO PAGADOR</AppText>
              <TextInput
                accessibilityLabel="CPF do pagador Pix"
                value={payerCpf}
                onChangeText={(value) => setPayerCpf(value.replace(/\D/g, "").slice(0, 11))}
                placeholder="Somente os 11 números"
                placeholderTextColor={colors.ice.muted}
                keyboardType="number-pad"
                editable={!depositBusy && idempotencyKey === null}
                style={styles.amountInput}
                maxLength={11}
              />
              <AppText variant="caption">
                O CPF é enviado ao Mercado Pago para identificar o pagamento e não é salvo neste registro de recarga.
              </AppText>
              <Button
                title={depositBusy ? "CRIANDO PIX..." : idempotencyKey ? "TENTAR NOVAMENTE" : "GERAR QR PIX"}
                onPress={() => void onCreatePix()}
                disabled={depositBusy}
              />
            </>
          ) : (
            <View style={styles.depositContent}>
              <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
                {deposit.status === "approved" ? "Pagamento confirmado" : "Aguardando pagamento"}
              </AppText>
              <AppText variant="title" color={colors.gold.DEFAULT}>
                {formatBRL(deposit.amountCents)}
              </AppText>
              {deposit.qrCodeBase64 ? (
                <Image
                  accessibilityLabel="QR Code Pix da recarga"
                  source={{ uri: `data:image/png;base64,${deposit.qrCodeBase64}` }}
                  resizeMode="contain"
                  style={styles.qrImage}
                />
              ) : null}
              {deposit.qrCode ? (
                <AppText variant="caption" selectable>
                  {deposit.qrCode}
                </AppText>
              ) : null}
              {deposit.ticketUrl ? (
                <Button
                  title="ABRIR DETALHES DO PIX"
                  variant="secondary"
                  onPress={() => {
                    void Linking.openURL(deposit.ticketUrl!).catch(() => {
                      setDepositError("Não foi possível abrir a página do provedor.");
                    });
                  }}
                />
              ) : null}
              <AppText variant="caption">
                O saldo só será liberado depois da confirmação do provedor. Não gere outra cobrança enquanto esta estiver pendente.
              </AppText>
              <Button
                title={depositBusy ? "CONSULTANDO..." : "ATUALIZAR STATUS DO PAGAMENTO"}
                variant="secondary"
                onPress={() => void refreshDeposit()}
                disabled={depositBusy}
              />
              {deposit.status !== "pending" ? (
                <Button title="NOVA RECARGA" variant="secondary" onPress={resetDeposit} disabled={depositBusy} />
              ) : null}
            </View>
          )}
          {depositError ? (
            <AppText variant="caption" color={colors.danger}>
              {depositError}
            </AppText>
          ) : null}
          {depositError && idempotencyKey ? (
            <Button
              title="DESCARTAR TENTATIVA E EDITAR VALOR"
              variant="secondary"
              disabled={depositBusy}
              onPress={() => {
                setIdempotencyKey(null);
                setDepositError(null);
              }}
            />
          ) : null}
        </Card>
      ) : (
        <Card>
          <AppText variant="caption" style={styles.section}>
            RECARGA VIA PIX
          </AppText>
          <AppText variant="body">
            Recargas ficam desativadas nesta versão enquanto o fluxo real de liquidação e saque dos ganhos dos motoristas não estiver configurado e validado.
          </AppText>
        </Card>
      )}

      <Card>
        <AppText variant="caption" style={styles.section}>
          COMO FUNCIONA
        </AppText>
        <AppText variant="body">• Você paga somente o valor final da corrida</AppText>
        <AppText variant="body">• Promoções reduzem o valor sem mudar o que o motorista recebe</AppText>
        <AppText variant="body">• Nenhum pagamento é confirmado pela tela: a confirmação vem do backend e do provedor</AppText>
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
  amountInput: {
    minHeight: 48,
    backgroundColor: colors.graphite.raised,
    borderWidth: 1,
    borderColor: colors.glass.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    color: colors.ice.DEFAULT,
    fontSize: 18,
  },
  depositContent: { alignItems: "center", gap: spacing.md },
  qrImage: { width: 224, height: 224, backgroundColor: "#FFFFFF", borderRadius: 12 },
});
