import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { ApiError, api } from "../../src/services/api";

type Stage = "request" | "reset" | "done";

export default function ForgotPassword() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("request");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestReset = async () => {
    if (!email.trim()) {
      setError("Informe o e-mail da sua conta.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setNotice("Se houver uma conta com esse e-mail, enviaremos um token de recuperação. Confira sua caixa de entrada e o spam.");
      setStage("reset");
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setError(status === 503
        ? "A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde."
        : status === 429
          ? "Muitas tentativas. Aguarde alguns minutos."
          : "Não foi possível solicitar a recuperação. Verifique sua conexão.");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!/^[a-f0-9]{64}$/i.test(token.trim())) {
      setError("O token deve ter 64 caracteres hexadecimais. Solicite outro se ele estiver expirado ou incompleto.");
      return;
    }
    if (
      password.length < 8 ||
      password.length > 72 ||
      !/[A-Za-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setError("Use uma senha de 8 a 72 caracteres, com pelo menos uma letra e um número.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.resetPassword(token.trim(), password);
      setStage("done");
      setNotice("Senha alterada com sucesso. Entre novamente com sua nova senha.");
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : 0;
      setError(status === 400
        ? "Token inválido ou expirado. Solicite uma nova recuperação."
        : status === 503
          ? "O serviço de recuperação está temporariamente indisponível."
          : "Não foi possível alterar a senha. Verifique sua conexão e tente novamente.");
    } finally {
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
            {stage === "request" ? "Recuperar senha" : stage === "reset" ? "Criar nova senha" : "Senha atualizada"}
          </AppText>
          <AppText variant="body" align="center">
            {stage === "request"
              ? "Vamos ajudar você a recuperar o acesso à sua conta."
              : stage === "reset"
                ? "Use o token enviado por e-mail. Ele é válido por uma hora e só pode ser usado uma vez."
                : "Sua conta está pronta para um novo acesso."}
          </AppText>
        </View>

        {stage === "request" ? (
          <View style={styles.form}>
            <Input
              label="E-mail da conta"
              placeholder="voce@exemplo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <Button title={busy ? "ENVIANDO..." : "Enviar instruções"} onPress={() => void requestReset()} disabled={busy} />
          </View>
        ) : stage === "reset" ? (
          <View style={styles.form}>
            <Input
              label="Token de recuperação"
              placeholder="Cole o token recebido por e-mail"
              autoCapitalize="none"
              autoCorrect={false}
              value={token}
              onChangeText={setToken}
            />
            <Input
              label="Nova senha"
              placeholder="Pelo menos 8 caracteres"
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
            />
            <Button title={busy ? "ATUALIZANDO..." : "Alterar senha"} onPress={() => void resetPassword()} disabled={busy} />
            <Button title="Solicitar outro token" variant="secondary" onPress={() => { setStage("request"); setToken(""); setPassword(""); setError(null); setNotice(null); }} disabled={busy} />
          </View>
        ) : (
          <View style={styles.form}>
            <Button title="Voltar ao login" onPress={() => router.replace("/auth/login")} />
          </View>
        )}

        {error ? (
          <AppText variant="caption" color={colors.danger} style={styles.message}>
            {error}
          </AppText>
        ) : null}
        {notice ? (
          <AppText variant="caption" color={colors.gold.DEFAULT} style={styles.message}>
            {notice}
          </AppText>
        ) : null}

        <View style={styles.footer}>
          <Link href="/auth/login" replace>
            <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>
              Voltar ao login
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
  message: { marginTop: spacing.lg },
  footer: {
    justifyContent: "center",
    alignItems: "center",
    marginTop: "auto",
    paddingVertical: spacing.xl,
  },
});
