import { useEffect, useState } from "react";
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, Animated } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button, Card, MonogramWatermark, colors, spacing } from "@fairmove/ui";

interface LeagueEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  buyInFee: number;
  status: string;
}

interface LeaderboardEntry {
  id: string;
  eventId: string;
  driverId: string;
  rank: number;
  score: number;
  rewardTier: string;
  ridesCount: number;
  avgRating: number;
  acceptanceRate: number;
  reward?: {
    discountPercent: number;
    cashRewardCents: number;
    cinemaVoucher: boolean;
  };
}

interface MyRewardsResponse {
  id: string;
  eventId: string;
  driverId: string;
  type: string;
  amount: number;
  description: string;
  status: string;
  createdAt: string;
}

const API_BASE = "/api/events";

function formatCurrency(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function League() {
  const router = useRouter();
  const [activeEvent, setActiveEvent] = useState<LeagueEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [rewards, setRewards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  const fetchData = async () => {
    try {
      const [eventsRes, lbRes, myRes, rewardsRes] = await Promise.all([
        fetch(`${API_BASE}/active`).then(r => r.json()),
        fetch(`${API_BASE}/active`).then(r => r.json()).then(data => data[0] && fetch(`${API_BASE}/${data[0].id}/leaderboard`).then(r => r.json())).catch(() => []),
        fetch(`${API_BASE}/active`).then(r => r.json()).then(data => data[0] && fetch(`${API_BASE}/${data[0].id}/my-position`).then(r => r.json())).catch(() => null),
        fetch(`${API_BASE}/my-rewards`).then(r => r.json()),
      ]);
      setActiveEvent(eventsRes[0] || null);
      setLeaderboard(lbRes || []);
      setMyEntry(myRes || null);
      setRewards(rewardsRes || []);
    } catch (e) {
      console.error("League fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEnroll = async () => {
    if (!activeEvent || enrolling) return;
    setEnrolling(true);
    try {
      const res = await fetch(`${API_BASE}/${activeEvent.id}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `enroll-${activeEvent.id}-${Date.now()}` },
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) { console.error(e); }
    finally { setEnrolling(false); }
  };

  const handleCinemaClaim = async () => {
    if (!activeEvent || !myEntry?.reward?.cinemaVoucher) return;
    const link = prompt("Link da sala de cinema ou Chave PIX:");
    if (!link) return;
    await fetch(`${API_BASE}/cinema/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: activeEvent.id, cinemaLink: link }),
    });
    alert("Solicitação enviada para aprovação!");
  };

  const rewardTierLabels: Record<string, string> = {
    tier_1: "🥇 1º Lugar",
    tier_2: "🥈 2º Lugar",
    tier_3: "🥉 3º Lugar",
    tier_4: "4º Lugar",
    tier_5_10: "5º–10º Lugar",
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <AppText variant="slogan">FAIRMOVE LEAGUE</AppText>
      </View>
    );
  }

  if (!activeEvent) {
    return (
      <View style={styles.empty}>
        <MonogramWatermark />
        <AppText variant="title">FairMove League</AppText>
        <AppText variant="body" align="center" color={colors.ice.muted}>
          Nenhum evento ativo no momento. Volte em breve!
        </AppText>
      </View>
    );
  }

  const isEnrolled = !!myEntry;
  const canEnroll = activeEvent.status === "running" && !isEnrolled;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <MonogramWatermark />

      {/* Banner do evento ativo */}
      <Card variant="gold" style={styles.banner}>
        <View style={styles.bannerTop}>
          <AppText variant="caption" color={colors.obsidian}>EVENTO ATIVO</AppText>
          <AppText variant="title" style={styles.eventTitle}>{activeEvent.title}</AppText>
        </View>
        <View style={styles.bannerStats}>
          <View style={styles.stat}>
            <AppText variant="caption" color={colors.obsidian}>INSCRIÇÃO</AppText>
            <AppText variant="bodyStrong" color={colors.obsidian}>{formatCurrency(activeEvent.buyInFee)}</AppText>
          </View>
          <View style={styles.stat}>
            <AppText variant="caption" color={colors.obsidian}>INÍCIO</AppText>
            <AppText variant="bodyStrong" color={colors.obsidian}>{formatDate(activeEvent.startDate)}</AppText>
          </View>
          <View style={styles.stat}>
            <AppText variant="caption" color={colors.obsidian}>FIM</AppText>
            <AppText variant="bodyStrong" color={colors.obsidian}>{formatDate(activeEvent.endDate)}</AppText>
          </View>
        </View>
        {canEnroll && (
          <Button title={enrolling ? "Inscrito ✓" : "Participar"} onPress={handleEnroll} disabled={enrolling || isEnrolled} variant="primary" style={styles.cta} />
        )}
        {isEnrolled && !enrolling && (
          <AppText variant="bodyStrong" color={colors.success} align="center">Inscrito com sucesso!</AppText>
        )}
      </Card>

      {/* Meus Prêmios / Minha Posição */}
      {isEnrolled && myEntry && (
        <Card style={styles.myPosition}>
          <View style={styles.positionHeader}>
            <AppText variant="caption">MINHA POSIÇÃO</AppText>
            <AppText variant="title" color={colors.gold.DEFAULT}>
              #{myEntry.rank} · {rewardTierLabels[myEntry.rewardTier]}
            </AppText>
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <AppText variant="display" color={colors.gold.DEFAULT}>{myEntry.ridesCount}</AppText>
              <AppText variant="caption">Corridas</AppText>
            </View>
            <View style={styles.metric}>
              <AppText variant="display" color={colors.ice.DEFAULT}>{myEntry.avgRating.toFixed(1)}</AppText>
              <AppText variant="caption">Rating</AppText>
            </View>
            <View style={styles.metric}>
              <AppText variant="display" color={colors.ice.DEFAULT}>{myEntry.acceptanceRate.toFixed(0)}%</AppText>
              <AppText variant="caption">Aceitação</AppText>
            </View>
          </View>
          {myEntry.reward && (
            <View style={styles.rewardPreview}>
              <AppText variant="caption" color={colors.gold.DEFAULT}>PRÊMIO DESTE RANK</AppText>
              <View style={styles.rewardBadges}>
                {myEntry.reward.discountPercent > 0 && (
                  <View style={[styles.badge, styles.badgeGold]}>
                    <AppText variant="caption" color={colors.obsidian}>
                      {myEntry.reward.discountPercent}% OFF mensalidade (2 meses)
                    </AppText>
                  </View>
                )}
                {myEntry.reward.cashRewardCents > 0 && (
                  <View style={[styles.badge, styles.badgeGold]}>
                    <AppText variant="caption" color={colors.obsidian}>
                      + {formatCurrency(myEntry.reward.cashRewardCents)} em dinheiro
                    </AppText>
                  </View>
                )}
                {myEntry.reward.cinemaVoucher && (
                  <Button title="Resgatar Cinema FairMove" variant="ghost" onPress={handleCinemaClaim} style={styles.cinemaBtn} />
                )}
              </View>
            </View>
          )}
        </Card>
      )}

      {/* Leaderboard */}
      <Card style={styles.lbCard}>
        <AppText variant="caption" color={colors.gold.DEFAULT}>RANKING GERAL</AppText>
        {leaderboard.length === 0 ? (
          <AppText variant="body" align="center" color={colors.ice.muted}>
            Ranking será atualizado ao final do evento
          </AppText>
        ) : (
          <View style={styles.lbList}>
            {leaderboard.slice(0, 10).map((entry, idx) => {
              const isMe = entry.driverId === myEntry?.driverId;
              return (
                <View key={entry.id} style={[styles.lbRow, isMe && styles.lbRowMe]}>
                  <View style={styles.rankCol}>
                    {idx < 3 ? (
                      <AppText variant="display" color={colors.gold.DEFAULT}>
                        {["🥇", "🥈", "🥉"][idx]}
                      </AppText>
                    ) : (
                      <AppText variant="bodyStrong">{idx + 1}º</AppText>
                    )}
                  </View>
                  <View style={styles.infoCol}>
                    <AppText variant={isMe ? "bodyStrong" : "body"}>
                      Motorista {entry.driverId.slice(0, 8)}
                    </AppText>
                    <AppText variant="caption">
                      {entry.ridesCount} corridas · {entry.avgRating.toFixed(1)} ⭐ · {entry.acceptanceRate.toFixed(0)}% aceitação
                    </AppText>
                  </View>
                  <View style={styles.scoreCol}>
                    <AppText variant="bodyStrong" color={colors.gold.DEFAULT}>{entry.score.toFixed(0)}</AppText>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {/* Meus Prêmios (Histórico) */}
      {rewards.length > 0 && (
        <Card style={styles.rewardsCard}>
          <AppText variant="caption" color={colors.gold.DEFAULT}>MEUS PRÊMIOS</AppText>
          <View style={styles.rewardsList}>
            {rewards.map(r => (
              <View key={r.id} style={styles.rewardItem}>
                <View style={styles.rewardInfo}>
                  <AppText variant="body">{r.description}</AppText>
                  <AppText variant="caption" color={colors.ice.muted}>
                    {formatDate(r.createdAt)} · {r.type === "credit" ? "Crédito" : "Débito"}
                  </AppText>
                </View>
                <AppText variant="bodyStrong" color={r.type === "credit" ? colors.success : colors.danger}>
                  {r.type === "credit" ? "+" : "-"} {formatCurrency(r.amount)}
                </AppText>
              </View>
            ))}
          </View>
        </Card>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.obsidian },
  content: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxxl },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl, gap: spacing.lg },
  banner: { gap: spacing.md },
  bannerTop: { gap: spacing.xs },
  eventTitle: { color: colors.obsidian },
  bannerStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(5,5,5,0.15)",
    paddingTop: spacing.md,
  },
  stat: { alignItems: "center" },
  cta: { marginTop: spacing.md },
  myPosition: { gap: spacing.md },
  positionHeader: { gap: spacing.xs },
  metricsRow: { flexDirection: "row", justifyContent: "space-around" },
  metric: { alignItems: "center", gap: 2 },
  rewardPreview: { borderTopWidth: 1, borderTopColor: colors.glass.border, paddingTop: spacing.md, gap: spacing.sm },
  rewardBadges: { gap: spacing.sm },
  badge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: spacing.radius?.pill || 999 },
  badgeGold: { backgroundColor: colors.gold.DEFAULT },
  cinemaBtn: { marginTop: spacing.sm },
  lbCard: { gap: spacing.md },
  lbList: { gap: spacing.sm },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glass.border,
  },
  lbRowMe: { backgroundColor: colors.gold.ghost },
  rankCol: { width: 48, alignItems: "center" },
  infoCol: { flex: 1, gap: 2 },
  scoreCol: { alignItems: "flex-end", width: 70 },
  rewardsCard: { gap: spacing.md },
  rewardsList: { gap: spacing.sm },
  rewardItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.glass.border,
  },
  rewardInfo: { flex: 1, gap: 2 },
});