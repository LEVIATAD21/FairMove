import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../src/auth/AuthProvider";

/**
 * Login real: POST /api/v1/auth/login com tokens no SecureStore.
 * Sessão já restaurada no boot → entra direto. Duplo clique bloqueado
 * (restrição de idempotência).
 */
export default function Login() {
  const router = useRouter();
  const { status, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (status === "authed") router.replace("/passenger");
  }, [status, router]);

  const onLogin = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/passenger");
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message.includes("HTTP 4")
          ? "E-mail ou senha inválidos."
          : "Não foi possível entrar. Verifique sua conexão.";
      setError(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Monogram size={48} />
          <AppText variant="title" style={styles.title}>
            Bem-vindo de volta
          </AppText>
          <AppText variant="body" align="center">
            Entre para pedir corridas com preço transparente.
          </AppText>
        </View>

        <View style={styles.form}>
          <Input
            label="E-mail"
            placeholder="contato@fairmove.com.br"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            label="Senha"
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />

          {error ? (
            <AppText variant="caption" color={colors.danger} align="center">
              {error}
            </AppText>
          ) : null}

          <Button title={busy ? "Entrando..." : "Entrar"} onPress={() => void onLogin()} disabled={busy} />
        </View>

        <View style={styles.footer}>
          <AppText variant="body">Ainda não tem conta? </AppText>
          <Link href="/auth/register" replace>
            <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
              Criar conta
            </AppText>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxl,
  },
  title: { marginTop: spacing.md },
  form: { gap: spacing.lg },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "auto",
    paddingVertical: spacing.xl,
  },
});
