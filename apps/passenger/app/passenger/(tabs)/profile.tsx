import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { AppText, Button, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";
import { useAuth } from "../../../src/auth/AuthProvider";
import { api, type UserMeResponse } from "../../../src/services/api";

/** Perfil REAL do passageiro (GET /users/me) — sem email inventado. */
export default function PassengerProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [me, setMe] = useState<UserMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.getMe();
      setMe(response);
      setError(null);
    } catch {
      setError("Dados indisponíveis no momento.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const email = me?.user.email ?? user?.email ?? "—";
  const name = me?.user.name ?? user?.name ?? "Passageiro";

  const onLogout = async () => {
    await logout();
    router.replace("/auth/login");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <MonogramWatermark />
      <AppText variant="title">Perfil</AppText>

      <Card>
        <AppText variant="subtitle">{name}</AppText>
        <AppText variant="body" color={colors.ice.muted}>
          {email}
        </AppText>
        <AppText variant="caption" color={colors.ice.muted}>
          {error ?? `Conta ${me?.user.role === "passenger" ? "passageiro" : ""} FairMove`}
        </AppText>
      </Card>

      <Button title="SAIR DA CONTA" variant="secondary" onPress={() => void onLogout()} />

      <Card variant="solid">
        <AppText variant="caption" color={colors.gold.DEFAULT}>
          IDENTIDADE FAIRMOVE
        </AppText>
        <AppText variant="body">• Preço transparente: você vê o total antes de pedir</AppText>
        <AppText variant="body">• Zero comissão por corrida para o motorista</AppText>
        <AppText variant="body">• Avaliação mútua passageiro ↔ motorista</AppText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidian },
  container: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
});
