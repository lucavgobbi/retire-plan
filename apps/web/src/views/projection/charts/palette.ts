/** One small palette constant module — the app's chart colors (plan §2, no UI kit). */
export const PALETTE = {
  ink: "#1f2933",
  muted: "#7b8794",
  color1: "#2563eb", // blue — net worth / tfsa / federal
  color2: "#0f766e", // teal — expenses / rrsp / provincial
  color3: "#b45309", // amber — shortfall / nonreg / surtax
  color4: "#7c3aed", // violet — cash / clawback
  color5: "#dc2626", // red — overlay accents
} as const;

export const STACK_COLORS = ["#2563eb", "#0f766e", "#b45309", "#7c3aed", "#dc2626"] as const;
