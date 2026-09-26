import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

const COLORS = {
  bg: '#080B17',
  surface: '#172033',
  primary: '#F5C542',
  primaryDark: '#D9A900',
  white: '#FFFFFF',
  textSecondary: '#AAB3C5',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.logoContainer}>
        <Text style={styles.logoIcon}>⚡</Text>
        <Text style={styles.logoText}>FairMove</Text>
        <Text style={styles.subtitle}>Mobilidade Justa</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Passageiro</Text>
        <Text style={styles.cardText}>
          Conectando você a motoristas de forma segura e justa
        </Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: COLORS.success }]} />
          <Text style={styles.statusText}>Sistema operacional</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>R$ 7,03</Text>
          <Text style={styles.statLabel}>Desconto</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>100%</Text>
          <Text style={styles.statLabel}>Motorista</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>R$ 41</Text>
          <Text style={styles.statLabel}>Reserva</Text>
        </View>
      </View>

      <Text style={styles.version}>v1.0.0 • MVP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoIcon: {
    fontSize: 64,
    marginBottom: 12,
  },
  logoText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 8,
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: COLORS.success,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginBottom: 32,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  version: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
