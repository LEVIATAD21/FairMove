import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { AppText, FVLogo, SLOGAN, BRAND, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../src/auth/AuthProvider";

/**
 * Splash cinematográfica: restaura a sessão antes de decidir a rota.
 * Usuários autenticados seguem para o app; visitantes vão para o login.
 */
export default function Splash() {
  const router = useRouter();
  const { status } = useAuth();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 850, useNativeDriver: true }),
      ])
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [pulse]);

  useEffect(() => {
    if (status === "restoring") return;
    const timeout = setTimeout(
      () => router.replace(status === "authed" ? "/passenger" : "/auth/login"),
      1200
    );
    return () => clearTimeout(timeout);
  }, [status, router]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.mark, { opacity: pulse }]}>
        <FVLogo size={96} />
      </Animated.View>

      <AppText variant="display" style={styles.brand}>
        {BRAND}
      </AppText>
      <AppText variant="slogan">{SLOGAN}</AppText>

      <AppText variant="caption" style={styles.footer}>
        Mobilidade justa. Zero comissão por corrida.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.absoluteBlack,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  mark: {
    marginBottom: spacing.xl,
  },
  brand: {
    letterSpacing: 6,
    marginBottom: spacing.sm,
  },
  footer: {
    position: "absolute",
    bottom: spacing.xxxl,
  },
});
