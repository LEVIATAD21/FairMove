import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText, Button, Input, Monogram, Screen, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../src/auth/AuthProvider";
import { ApiError } from "../../src/services/api";

/**
 * Verificação de e-mail (REQUIRE_EMAIL_VERIFICATION=true):
 * código de 6 dígitos → POST /auth/verify-email → sessão salva → app.
 * devCode (dev com EXPOSE_VERIFICATION_CODE) já preenche o campo.
 */
export default function PassengerVerifyEmail() {
  const router = useRouter();
  const { verifyEmail, resendVerification } = useAuth();
  const params = useLocalSearchParams<{ email?: string; devCode?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const [code, setCode] = useState(typeof params.devCode === "string" ? params.devCode : "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const onVerify = async () => {
    if (busyRef.current || !email) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Informe o código de 6 dígitos.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(email, code);
      router.replace("/passenger");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("Código inválido ou expirado. Peça um novo.");
      } else {
        setError("Não foi possível verificar agora. Tente novamente.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (busyRef.current || !email) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await resendVerification(email);
      if (result.verificationCode) {
        setCode(result.verificationCode);
        setInfo("Novo código gerado (dev).");
      } else {
        setInfo("Se a conta precisa de verificação, um novo código foi enviado.");
      }
    } catch {
      setError("Não foi possível reenviar agora.");
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
            Verifique seu e-mail
          </AppText>
          <AppText variant="body" align="center">
            {email ? `Enviamos um código para ${email}.` : "Informe o código recebido por e-mail."}
          </AppText>
        </View>

        <View style={styles.form}>
          <Input
            label="Código de 6 dígitos"
            placeholder="000000"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          {error ? <AppText variant="caption" color={colors.danger}>{error}</AppText> : null}
          {info ? <AppText variant="caption" color={colors.success}>{info}</AppText> : null}
          <Button
            title="VERIFICAR"
            onPress={() => void onVerify()}
            disabled={busy}
            accessibilityLabel="Verificar código"
          />
          <Button
            title="REENVIAR CÓDIGO"
            variant="ghost"
            onPress={() => void onResend()}
            disabled={busy}
          />
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
});
