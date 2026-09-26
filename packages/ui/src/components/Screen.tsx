import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { MonogramWatermark } from "./Monogram";
import { colors } from "../theme";

export interface ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  /** Ativa a marca d'água sutil do FV no canto inferior direito. */
  watermark?: boolean;
}

/**
 * Container raiz das telas: fundo obsidiana, safe area e marca d'água opcional.
 */
export function Screen({
  children,
  style,
  edges = ["top", "bottom"],
  watermark = true,
}: ScreenProps) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {children}
      {watermark ? <MonogramWatermark /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.obsidian,
  },
});
