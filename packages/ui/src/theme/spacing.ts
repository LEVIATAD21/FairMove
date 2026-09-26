import type { ViewStyle } from "react-native";
import { colors } from "./colors";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/** Glow dourado discreto (iOS shadow + Android elevation). */
export const glow = {
  gold: {
    shadowColor: colors.gold.DEFAULT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  } satisfies ViewStyle,
  subtle: {
    shadowColor: colors.gold.DEFAULT,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  } satisfies ViewStyle,
} as const;

/** Touch target mínimo acessível (52pt) usado por todos os controles interativos. */
export const MIN_TOUCH_TARGET = 52;

/** Valor absoluto do fundo das telas. */
export const screenBackground = colors.obsidian;
