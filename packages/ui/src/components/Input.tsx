import { useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { AppText } from "./AppText";
import { colors, radius, spacing, MIN_TOUCH_TARGET } from "../theme";

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Campo de texto escuro com foco dourado e alvo de toque generoso (52pt).
 * O erro é anunciado por leitores de tela (accessibilityHint/live region).
 */
export function Input({ label, error, containerStyle, style, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <AppText variant="caption" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <TextInput
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        placeholderTextColor={colors.ice.muted}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.errored,
          style,
        ]}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "stretch",
    gap: spacing.xs,
  },
  label: {
    marginLeft: 2,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.graphite.deep,
    borderColor: colors.glass.border,
    color: colors.ice.DEFAULT,
    fontSize: 16,
  },
  focused: {
    borderColor: colors.gold.DEFAULT,
    backgroundColor: colors.graphite.base,
  },
  errored: {
    borderColor: colors.danger,
  },
});
