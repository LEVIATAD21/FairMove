/**
 * Paleta "FV Cinematic": Preto Obsidiana, Grafite, Dourado Metálico, Branco Gelo.
 * Todos os hexadecimais em caixa alta; superfícies em rgba para glassmorphism.
 */
export const colors = {
  /** Preto Obsidiana — fundo raiz de todas as telas. */
  obsidian: "#050505",
  /** Preto Absoluto — camada abaixo da obsidiana (modais, splash). */
  absoluteBlack: "#000000",

  /** Escala de grafite (aliases legíveis — chaves numéricas não são válidas em dot-access). */
  graphite: {
    deepest: "#0B0B0D" /* 900: superfícies de tab bar/modais */,
    deep: "#121214" /* 800: campos e cards sólidos */,
    base: "#1C1C1F" /* 700: superfícies elevadas */,
    raised: "#2A2A2E" /* 600: trilhos, controles */,
    line: "#3A3A40" /* 500: bordas vivas */,
    muted: "#55555C" /* 400: separadores */,
  },

  /** Dourado Metálico — CTA, rota, foco, marca. */
  gold: {
    DEFAULT: "#D4AF37",
    light: "#E8C766",
    dark: "#A8871F",
    /** Glow discreto de CTAs (rgba p/ bordas e sombras). */
    glow: "rgba(212, 175, 55, 0.35)",
    soft: "rgba(212, 175, 55, 0.14)",
    ghost: "rgba(212, 175, 55, 0.08)",
  },

  /** Branco Gelo — texto principal e altos. */
  ice: {
    DEFAULT: "#F5F7FA",
    dim: "#C9CEDA",
    muted: "#8A90A0",
  },

  /** Superfícies de glassmorphism sutil. */
  glass: {
    fill: "rgba(255, 255, 255, 0.06)",
    fillStrong: "rgba(255, 255, 255, 0.10)",
    border: "rgba(255, 255, 255, 0.10)",
    goldBorder: "rgba(212, 175, 55, 0.35)",
  },

  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
} as const;

export type AppColors = typeof colors;
