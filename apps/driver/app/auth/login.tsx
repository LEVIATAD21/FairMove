import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../src/auth/AuthProvider";
import { ApiError } from "../../src/services/api";

/** Login real: POST /api/v1/auth/login → tokens no SecureStore → app autenticado. */
export default function DriverLogin() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const onLogin = async () => {
    if (busyRef.current) return;
    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/driver");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("E-mail ou senha incorretos.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Muitas tentativas. Aguarde alguns minutos.");
      } else {
        setError("Não foi possível conectar ao servidor. Verifique sua rede.");
      }
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
            Área do motorista
          </AppText>
          <AppText variant="body" align="center">
            Fique online, ganhe com transparência e construa sua reserva.
          </AppText>
        </View>

        <View style={styles.form}>
          <Input
            label="E-mail"
            placeholder="voce@exemplo.com"
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
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}

          <Button title={busy ? "ENTRANDO..." : "Entrar"} onPress={onLogin} />
        </View>

        <View style={styles.footer}>
          <AppText variant="body">Ainda não tem conta? </AppText>
          <Link href="/auth/register" replace>
            <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
              Cadastrar veículo
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
