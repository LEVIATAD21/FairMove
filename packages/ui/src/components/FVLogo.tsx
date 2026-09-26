import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { MONOGRAM, BRAND } from "../brand";
import { colors } from "../theme";

export interface FVLogoProps {
  /** Tamanho da fonte do monograma (padrão 56). */
  size?: number;
  /** Mostra o wordmark "FAIRMOVE" sob o monograma. */
  showWordmark?: boolean;
  /** Animação de glow/pulse (padrão true). */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  monogramStyle?: StyleProp<TextStyle>;
}

/**
 * Logo oficial FairMove — monograma "FV" com glow dourado pulsante
 * (metálico sobre obsidiana). Design System "FV Cinematic".
 */
export function FVLogo({
  size = 56,
  showWordmark = false,
  animate = true,
  style,
  monogramStyle,
}: FVLogoProps) {
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      glow.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [animate, glow]);

  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });
  const glowSize = size * 2.2;

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.glowLayer, { width: glowSize, height: glowSize }]}>
        <Animated.View
          style={[
            styles.glow,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
      </View>
      <Text
        accessibilityRole="image"
        accessibilityLabel={`Logo FairMove — monograma ${MONOGRAM}`}
        style={[styles.monogram, { fontSize: size }, monogramStyle]}
      >
        {MONOGRAM}
      </Text>
      {showWordmark ? <Text style={[styles.wordmark, { fontSize: size * 0.24 }]}>{BRAND}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  glowLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    backgroundColor: colors.gold.soft,
    borderWidth: 1,
    borderColor: colors.glass.goldBorder,
  },
  monogram: {
    color: colors.gold.DEFAULT,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
    textShadowColor: colors.gold.glow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  wordmark: {
    marginTop: 10,
    color: colors.champagne,
    fontWeight: "700",
    letterSpacing: 6,
    textAlign: "center",
  },
});
