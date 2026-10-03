import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../src/auth/AuthProvider";
import { ApiError } from "../../src/services/api";

/** Cadastro real: POST /api/v1/auth/register → usuário criado no Postgres → app. */
export default function DriverRegister() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const onRegister = async () => {
    if (busyRef.current) return;
    if (!name.trim() || !email.trim() || !password) {
      setError("Preencha nome, e-mail e senha.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await register(name.trim(), email.trim().toLowerCase(), password);
      if (result.verificationRequired) {
        // REQUIRE_EMAIL_VERIFICATION: sem sessão até confirmar o código.
        router.push({
          pathname: "/auth/verify",
          params: {
            email: email.trim().toLowerCase(),
            devCode: result.verificationCode ?? "",
          },
        });
        return;
      }
      router.replace("/driver");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Este e-mail já está cadastrado.");
      } else if (err instanceof ApiError && err.status === 400) {
        setError("Senha fraca: use ao menos 8 caracteres com letras e números.");
      } else {
        setError("Não foi possível criar a conta agora. Tente novamente.");
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
            Seja FairMove
          </AppText>
          <AppText variant="body" align="center">
            Primeiro mês grátis. Zero comissão por corrida, sempre.
          </AppText>
        </View>

        <View style={styles.form}>
          <Input
            label="Nome"
            placeholder="Seu nome"
            autoComplete="name"
            value={name}
            onChangeText={setName}
          />
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
            placeholder="Mínimo de 8 caracteres"
            secureTextEntry
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
          />

          {error ? (
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}

          <Button title={busy ? "CRIANDO CONTA..." : "Criar conta"} onPress={onRegister} />
        </View>

        <View style={styles.footer}>
          <AppText variant="body">Já tem conta? </AppText>
          <Link href="/auth/login" replace>
            <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
              Entrar
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
