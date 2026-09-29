import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../src/auth/AuthProvider";

/**
 * Cadastro real: POST /api/v1/auth/register (conta criada no backend,
 * tokens no SecureStore). Duplo clique bloqueado.
 */
export default function Register() {
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
    if (!name.trim() || !email.trim() || password.length < 8) {
      setError("Preencha nome, e-mail e senha com pelo menos 8 caracteres.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await register(name.trim(), email.trim(), password);
      router.replace("/passenger");
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message.includes("HTTP 4")
          ? "Não foi possível criar a conta (dados inválidos ou e-mail já usado)."
          : "Sem conexão com o servidor.";
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
            Criar conta
          </AppText>
          <AppText variant="body" align="center">
            Você paga o preço exato e o motorista recebe 100%.
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
            placeholder="Mínimo 8 caracteres"
            secureTextEntry
            autoComplete="password-new"
            value={password}
            onChangeText={setPassword}
          />

          {error ? (
            <AppText variant="caption" color={colors.danger} align="center">
              {error}
            </AppText>
          ) : null}

          <Button
            title={busy ? "Criando..." : "Criar conta"}
            onPress={() => void onRegister()}
            disabled={busy}
          />
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
