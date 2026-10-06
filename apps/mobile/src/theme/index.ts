import { Platform, useColorScheme, type TextStyle } from "react-native";

/**
 * GoldOS mobile design tokens. Built on Apple's semantic system colours
 * (grouped backgrounds, label hierarchy, hairline separators) so screens feel
 * native on iOS, with the brand gold as the app tint. Every colour has a
 * light and a dark value — never hard-code a hex in a screen; read `c.*`.
 */
const light = {
  // Backgrounds (iOS grouped)
  bg: "#F2F2F7",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardSecondary: "#F2F2F7",
  fill: "rgba(120,120,128,0.12)",
  fillStrong: "rgba(120,120,128,0.2)",
  // Labels
  label: "#000000",
  label2: "rgba(60,60,67,0.6)",
  label3: "rgba(60,60,67,0.3)",
  label4: "rgba(60,60,67,0.18)",
  separator: "rgba(60,60,67,0.29)",
  hairline: "rgba(60,60,67,0.12)",
  /** Row/cell pressed state (systemGray5 / systemGray4). */
  highlight: "#E5E5EA",
  // Brand
  gold: "#B8901C",
  goldBright: "#C9A227",
  goldLight: "#E7C65A",
  goldSoft: "#F6EDCF",
  goldInk: "#5C4710",
  onGold: "#1C1917",
  // Dark "vault" surfaces used by hero cards in both modes
  vault: "#0C0A09",
  vault2: "#1C1917",
  onVault: "#FFFFFF",
  onVault2: "rgba(255,255,255,0.6)",
  onVault3: "rgba(255,255,255,0.35)",
  // System
  blue: "#007AFF",
  green: "#34C759",
  greenText: "#248A3D",
  red: "#FF3B30",
  redText: "#D70015",
  orange: "#FF9500",
  orangeText: "#C93400",
  yellow: "#FFCC00",
  teal: "#30B0C7",
  indigo: "#5856D6",
  purple: "#AF52DE",
  pink: "#FF2D55",
  gray: "#8E8E93",
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(0,0,0,0.4)",
  shadow: "rgba(0,0,0,0.08)",
};

export type Palette = typeof light;

const dark: Palette = {
  bg: "#000000",
  bgElevated: "#1C1C1E",
  card: "#1C1C1E",
  cardSecondary: "#2C2C2E",
  fill: "rgba(120,120,128,0.24)",
  fillStrong: "rgba(120,120,128,0.36)",
  label: "#FFFFFF",
  label2: "rgba(235,235,245,0.6)",
  label3: "rgba(235,235,245,0.3)",
  label4: "rgba(235,235,245,0.16)",
  separator: "rgba(84,84,88,0.65)",
  hairline: "rgba(84,84,88,0.4)",
  highlight: "#3A3A3C",
  gold: "#E0B83A",
  goldBright: "#E7C65A",
  goldLight: "#F3D97A",
  goldSoft: "rgba(224,184,58,0.16)",
  goldInk: "#F3D97A",
  onGold: "#1C1917",
  vault: "#141210",
  vault2: "#24201C",
  onVault: "#FFFFFF",
  onVault2: "rgba(255,255,255,0.6)",
  onVault3: "rgba(255,255,255,0.35)",
  blue: "#0A84FF",
  green: "#30D158",
  greenText: "#30D158",
  red: "#FF453A",
  redText: "#FF6961",
  orange: "#FF9F0A",
  orangeText: "#FFB340",
  yellow: "#FFD60A",
  teal: "#40C8E0",
  indigo: "#5E5CE6",
  purple: "#BF5AF2",
  pink: "#FF375F",
  gray: "#8E8E93",
  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(0,0,0,0.6)",
  shadow: "rgba(0,0,0,0.5)",
};

export const palettes = { light, dark };

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return { c: isDark ? dark : light, dark: isDark };
}

/** Apple text styles (Dynamic Type "Large" sizes). */
export const typeScale = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.37 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: 0.36 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: 0.35 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: 0.38 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.41 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400", letterSpacing: -0.41 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400", letterSpacing: -0.32 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: -0.24 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400", letterSpacing: -0.08 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: "400", letterSpacing: 0 },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: "400", letterSpacing: 0.07 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof typeScale;

export const fonts = {
  /** SF Pro Rounded on iOS — used for big hero numbers. */
  rounded: Platform.select({ ios: "ui-rounded", default: undefined }),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, xxl: 28, pill: 999 } as const;

/**
 * Apple's continuous ("squircle") corner curve. Spread into every rounded
 * surface: `{ borderRadius: radius.lg, ...squircle }`. iOS only; ignored elsewhere.
 */
export const squircle = { borderCurve: "continuous" } as const;

/** Soft, diffuse elevation in the Apple style (large blur, low opacity). */
export const elevation = {
  low: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  mid: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  high: { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 32, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
} as const;

/** Standard horizontal inset for grouped content (matches iOS inset-grouped lists). */
export const GUTTER = 16;
