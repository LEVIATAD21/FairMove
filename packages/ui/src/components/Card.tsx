import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";

export type CardVariant = "glass" | "gold" | "solid";

export interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}

/**
 * Superfície com glassmorphism sutil (fill translúcido + borda fina).
 * Variante `gold` acende a borda dourada (destaques de preço/premiação).
 */
export function Card({ children, variant = "glass", style }: CardProps) {
  return <View style={[styles.base, variantStyles[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
  },
});

const variantStyles = StyleSheet.create({
  glass: {
    backgroundColor: colors.glass.fill,
    borderColor: colors.glass.border,
  },
  gold: {
    backgroundColor: colors.gold.ghost,
    borderColor: colors.glass.goldBorder,
  },
  solid: {
    backgroundColor: colors.graphite.deep,
    borderColor: colors.glass.border,
  },
} as const);
