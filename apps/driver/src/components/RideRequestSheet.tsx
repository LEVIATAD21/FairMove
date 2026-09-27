import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { AppText, Button, colors, radius, spacing } from "@fairmove/ui";
import {
  RIDE_REQUEST_COUNTDOWN_SECONDS,
  countdownLabel,
  formatBRL,
  type RideRequest,
} from "../logic/ride-request";

export interface RideRequestSheetProps {
  request: RideRequest;
  onAccept: () => void;
  onDecline: () => void;
  onTimeout: () => void;
  /** Janela de decisão em segundos (padrão 15). */
  countdownSeconds?: number;
  /** true enquanto o POST /accept está em voo (trava o botão ACEITAR). */
  acceptDisabled?: boolean;
  /** Mensagem de erro do aceite real (ex.: corrida já assumida). */
  acceptHint?: string | null;
}

/**
 * Modal de solicitação de corrida — interrompe a navegação (rota
 * `transparentModal`). Fundo escuro translúcido com blur, bordas douradas e
 * destaque absoluto no valor líquido "VOCÊ RECEBE". Após a janela de decisão
 * ocorre recusa automática.
 */
export function RideRequestSheet({
  request,
  onAccept,
  onDecline,
  onTimeout,
  countdownSeconds = RIDE_REQUEST_COUNTDOWN_SECONDS,
  acceptDisabled = false,
  acceptHint = null,
}: RideRequestSheetProps) {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const [decision, setDecision] = useState<"accept" | "decline" | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current) return;
    if (remaining <= 0) {
      settled.current = true;
      setDecision(null);
      onTimeout();
      return;
    }
    const timer = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const settle = (next: "accept" | "decline") => {
    if (settled.current) return;
    settled.current = true;
    setDecision(next);
    if (next === "accept") onAccept();
    else onDecline();
  };

  const disabled = decision !== null || remaining <= 0 || acceptDisabled;

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.dim} />

      <View style={styles.card}>
        <AppText variant="slogan" align="center">
          Nova solicitação
        </AppText>

        <View style={styles.rows}>
          <DataRow label="Origem" value={request.origin} />
          <DataRow label="Destino" value={request.destination} />
          <View style={styles.pairRow}>
            <DataRow label="Tempo" value={`${request.durationMinutes} min`} compact />
            <DataRow
              label="Distância"
              value={`${request.distanceKm.toFixed(1).replace(".", ",")} km`}
              compact
            />
          </View>
        </View>

        <View style={styles.receiveBox}>
          <AppText variant="display" align="center" color={colors.gold.DEFAULT}>
            {`VOCÊ RECEBE: ${formatBRL(request.driverReceivesCents)}`}
          </AppText>
          <AppText variant="caption" align="center" color={colors.gold.light}>
            Valor exato pago pelo passageiro — zero comissão.
          </AppText>
        </View>

        <AppText variant="caption" align="center">
          {countdownLabel(remaining)}
        </AppText>

        {acceptHint ? (
          <AppText variant="caption" align="center" color={colors.danger}>
            {acceptHint}
          </AppText>
        ) : null}
        <Button
          title={acceptDisabled ? "ACEITANDO..." : "ACEITAR"}
          variant="primary"
          onPress={() => settle("accept")}
          disabled={disabled}
          accessibilityLabel="Aceitar corrida"
        />
        <Button
          title="RECUSAR"
          variant="danger"
          onPress={() => settle("decline")}
          disabled={disabled}
          accessibilityLabel="Recusar corrida"
        />

        {decision === "accept" ? (
          <AppText variant="bodyStrong" align="center" color={colors.success}>
            Corrida aceita — seguindo para o embarque.
          </AppText>
        ) : decision === "decline" ? (
          <AppText variant="caption" align="center">
            Corrida recusada — procurando outra oferta.
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function DataRow({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <View style={[styles.dataRow, compact && styles.dataRowCompact]}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant={compact ? "bodyStrong" : "body"} style={styles.dataValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  dim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(5, 5, 5, 0.72)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.glass.goldBorder,
    backgroundColor: "rgba(11, 11, 13, 0.92)",
  },
  rows: {
    gap: spacing.md,
  },
  pairRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  dataRow: {
    gap: 2,
  },
  dataRowCompact: {
    flex: 1,
  },
  dataValue: {
    color: colors.ice.DEFAULT,
  },
  receiveBox: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.glass.goldBorder,
    backgroundColor: colors.gold.ghost,
  },
});

export default RideRequestSheet;
