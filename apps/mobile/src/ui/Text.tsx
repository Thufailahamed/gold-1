import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { fonts, typeScale, useTheme, type Palette, type TypeVariant } from "@/theme";

export type TextTone =
  | "label"
  | "secondary"
  | "tertiary"
  | "gold"
  | "goldInk"
  | "success"
  | "danger"
  | "warning"
  | "blue"
  | "onVault"
  | "onVault2"
  | "onVault3"
  | "onGold"
  | "white";

const toneColor = (c: Palette, tone: TextTone): string =>
  ({
    label: c.label,
    secondary: c.label2,
    tertiary: c.label3,
    gold: c.gold,
    goldInk: c.goldInk,
    success: c.greenText,
    danger: c.redText,
    warning: c.orangeText,
    blue: c.blue,
    onVault: c.onVault,
    onVault2: c.onVault2,
    onVault3: c.onVault3,
    onGold: c.onGold,
    white: c.white,
  })[tone];

/**
 * Text in Apple's type scale. `tone` picks a semantic colour; `num` turns on
 * tabular figures (use for every amount, weight and count so columns align);
 * `rounded` uses SF Pro Rounded for hero numbers.
 */
export function Text({
  variant = "body",
  tone = "label",
  color,
  weight,
  num,
  mono,
  rounded,
  upper,
  center,
  right,
  style,
  ...rest
}: TextProps & {
  variant?: TypeVariant;
  tone?: TextTone;
  color?: string;
  weight?: TextStyle["fontWeight"];
  num?: boolean;
  mono?: boolean;
  rounded?: boolean;
  upper?: boolean;
  center?: boolean;
  right?: boolean;
}) {
  const { c } = useTheme();
  const base = typeScale[variant];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        base,
        { color: color ?? toneColor(c, tone) },
        weight ? { fontWeight: weight } : null,
        num || mono ? { fontVariant: ["tabular-nums"] } : null,
        mono ? { fontFamily: fonts.mono, letterSpacing: 0 } : null,
        rounded && fonts.rounded ? { fontFamily: fonts.rounded } : null,
        upper ? { textTransform: "uppercase", letterSpacing: 0.6 } : null,
        center ? { textAlign: "center" } : null,
        right ? { textAlign: "right" } : null,
        style,
      ]}
    />
  );
}

/** Small uppercase overline, like a section kicker. */
export function Kicker({ children, tone = "secondary", style }: { children: React.ReactNode; tone?: TextTone; style?: TextStyle }) {
  return (
    <Text variant="caption2" tone={tone} weight="600" upper style={[{ letterSpacing: 1.1 }, style]}>
      {children}
    </Text>
  );
}
