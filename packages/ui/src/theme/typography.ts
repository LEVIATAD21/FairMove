import type { TextStyle } from "react-native";
import { colors } from "./colors";

/**
 * Tipografia do app: sistema (sans) com pesos altos e tracking largo nos
 * display/slogan — sem fontes customizadas na Fase 1.
 */
export const typography = {
  display: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "800",
    letterSpacing: 2,
    color: colors.ice.DEFAULT,
  } satisfies TextStyle,
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: colors.ice.DEFAULT,
  } satisfies TextStyle,
  subtitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: 0.2,
    color: colors.ice.dim,
  } satisfies TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "400",
    color: colors.ice.dim,
  } satisfies TextStyle,
  bodyStrong: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    color: colors.ice.DEFAULT,
  } satisfies TextStyle,
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 0.3,
    color: colors.ice.muted,
  } satisfies TextStyle,
  /** Slogan "RIDE FAIR. LIVE FORWARD." — caixa alta com tracking amplo. */
  slogan: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 4,
    textTransform: "uppercase",
    color: colors.gold.DEFAULT,
  } satisfies TextStyle,
} as const;

export type TypographyVariant = keyof typeof typography;
