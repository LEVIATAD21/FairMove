import { StyleSheet, Text, type TextStyle, type ViewStyle, type StyleProp } from "react-native";
import { MONOGRAM } from "../brand";
import { colors } from "../theme";

interface MonogramBaseProps {
  size?: number;
  color?: string;
}

export interface MonogramProps extends MonogramBaseProps {
  /** Estilo de logo (default): monograma dourado central. */
  style?: StyleProp<TextStyle>;
}

/**
 * Monograma "FV" — usado em Splash, loading states e assinaturas de tela.
 */
export function Monogram({ size = 56, color = colors.gold.DEFAULT, style }: MonogramProps) {
  return (
    <Text
      accessibilityRole="image"
      accessibilityLabel={`Monograma ${MONOGRAM} da FairMove`}
      style={[styles.base, { fontSize: size, color }, style]}
    >
      {MONOGRAM}
    </Text>
  );
}

export interface MonogramWatermarkProps extends MonogramBaseProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Marca d'água sutil do "FV" no canto inferior das telas.
 */
export function MonogramWatermark({ size = 40, color = colors.gold.DEFAULT, style }: MonogramWatermarkProps) {
  return (
    <Text
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.watermark, { fontSize: size, color }, style]}
    >
      {MONOGRAM}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
  },
  watermark: {
    position: "absolute",
    right: 16,
    bottom: 16,
    fontWeight: "800",
    letterSpacing: 2,
    opacity: 0.07,
  },
});
