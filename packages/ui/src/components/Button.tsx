import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { AppText } from "./AppText";
import { colors, glow, radius, MIN_TOUCH_TARGET } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * CTA principal com glow dourado discreto (variante `primary`).
 * Altura mínima de 52pt e estado busy/disabled exposto para leitores de tela.
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variantStyles[variant].container,
        variant === "primary" && glow.gold,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? colors.obsidian : colors.gold.DEFAULT}
          accessibilityLabel="Carregando"
        />
      ) : (
        <AppText variant="bodyStrong" style={variantStyles[variant].label}>
          {title}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles: Record<ButtonVariant, { container: ViewStyle; label: TextStyle }> = {
  primary: {
    container: { backgroundColor: colors.gold.DEFAULT },
    label: { color: colors.obsidian, fontWeight: "700" },
  },
  secondary: {
    container: {
      backgroundColor: colors.graphite.base,
      borderWidth: 1,
      borderColor: colors.glass.border,
    },
    label: { color: colors.ice.DEFAULT },
  },
  ghost: {
    container: {
      backgroundColor: colors.gold.ghost,
      borderWidth: 1,
      borderColor: colors.glass.goldBorder,
    },
    label: { color: colors.gold.DEFAULT },
  },
  danger: {
    container: { backgroundColor: colors.danger },
    label: { color: colors.ice.DEFAULT, fontWeight: "700" },
  },
};
