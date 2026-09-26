import { StyleSheet, View } from "react-native";
import { AppText, Button, Card, MonogramWatermark, SLOGAN, colors, spacing } from "@fairmove/ui";

/**
 * Home do passageiro (Fase 1): mapa/chat placeholder + demonstração da regra
 * de transparência — o preço final pago é exatamente o que o motorista recebe.
 */
export default function PassengerHome() {
  return (
    <View style={styles.container}>
      <MonogramWatermark />

      <View style={styles.header}>
        <AppText variant="slogan">{SLOGAN}</AppText>
        <AppText variant="title">Para onde vamos?</AppText>
      </View>

      <Card variant="gold" style={styles.mapPlaceholder}>
        <AppText variant="caption" align="center">
          MAPA DARK · ROTA DOURADA
        </AppText>
        <AppText variant="body" align="center" style={styles.mapHint}>
          (React Native Maps entra na Fase 3)
        </AppText>
      </Card>

      <Card>
        <AppText variant="caption" style={styles.section}>
          TRANSPARÊNCIA RADICAL
        </AppText>
        <View style={styles.priceRow}>
          <View style={styles.priceCol}>
            <AppText variant="caption">Preço base</AppText>
            <AppText variant="body" color={colors.ice.muted}>
              R$ 21,59
            </AppText>
          </View>
          <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
            →
          </AppText>
          <View style={styles.priceCol}>
            <AppText variant="caption">Você paga</AppText>
            <AppText variant="title" color={colors.gold.DEFAULT}>
              R$ 14,56
            </AppText>
          </View>
          <View style={styles.priceCol}>
            <AppText variant="caption">Motorista recebe</AppText>
            <AppText variant="title" color={colors.ice.DEFAULT}>
              R$ 14,56
            </AppText>
          </View>
        </View>
        <AppText variant="caption" color={colors.success} style={styles.commission}>
          Zero comissão por corrida
        </AppText>
      </Card>

      <Button title="Buscar destino" variant="primary" style={styles.cta} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.lg, padding: spacing.xl },
  header: { gap: spacing.xs, marginTop: spacing.lg },
  mapPlaceholder: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.graphite.deepest,
  },
  mapHint: { marginTop: spacing.xs },
  section: { letterSpacing: 1.2, textTransform: "uppercase" },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  priceCol: { gap: 2, alignItems: "flex-start" },
  commission: { marginTop: spacing.md, color: colors.success },
  cta: { marginTop: "auto" },
});
