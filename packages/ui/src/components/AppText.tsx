import { Text, type TextProps, type TextStyle } from "react-native";
import { typography, type TypographyVariant } from "../theme";

export interface AppTextProps extends TextProps {
  /** Variante tipográfica do tema FV Cinematic. */
  variant?: TypographyVariant;
  /** Sobrescreve a cor da variante. */
  color?: string;
  /** Sobrescreve o peso (ex.: acessibilidade/contraste alto). */
  weight?: TextStyle["fontWeight"];
  align?: TextStyle["textAlign"];
}

/** Texto raiz do app: aplica as variantes do tema e mantém contraste alto. */
export function AppText({
  variant = "body",
  color,
  weight,
  align,
  style,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        color ? { color } : null,
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
