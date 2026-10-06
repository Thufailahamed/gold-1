import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { haptic } from "@/lib/haptics";
import { radius, squircle, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";
import { Text } from "./Text";

export type ButtonVariant = "filled" | "tinted" | "gray" | "plain" | "destructive" | "destructiveTinted" | "dark" | "glass";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * iOS-style button. `filled` is the gold primary action (one per screen),
 * `tinted` a soft gold secondary, `gray` neutral, `plain` text-only,
 * `dark` the vault-black CTA used on light heroes, `glass` for dark heroes.
 */
export function Button({
  title,
  onPress,
  variant = "filled",
  size = "md",
  icon,
  iconRight,
  loading,
  disabled,
  block,
  style,
  haptics = true,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  haptics?: boolean;
}) {
  const { c } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string }> = {
    filled: { bg: c.goldBright, fg: c.onGold },
    tinted: { bg: c.goldSoft, fg: c.goldInk },
    gray: { bg: c.fill, fg: c.label },
    plain: { bg: "transparent", fg: c.gold },
    destructive: { bg: c.red, fg: c.white },
    destructiveTinted: { bg: "rgba(255,59,48,0.12)", fg: c.redText },
    dark: { bg: c.vault, fg: c.goldLight },
    glass: { bg: "rgba(255,255,255,0.12)", fg: c.onVault },
  };
  const p = palette[variant];
  const h = size === "lg" ? 52 : size === "sm" ? 34 : 44;
  const fontVariant = size === "sm" ? "subhead" : "headline";
  const off = disabled || loading;
  const r = size === "lg" ? radius.lg : size === "sm" ? radius.pill : radius.md + 2;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      scaleTo={variant === "plain" ? 1 : 0.96}
      dimTo={variant === "plain" ? 0.5 : 1}
      onPress={() => {
        if (haptics) haptic.light();
        onPress?.();
      }}
      style={[
        styles.base,
        squircle,
        {
          height: h,
          paddingHorizontal: variant === "plain" ? 4 : size === "sm" ? 14 : 20,
          backgroundColor: p.bg,
          borderRadius: r, borderCurve: "continuous",
          opacity: off ? 0.45 : 1,
          alignSelf: block ? "stretch" : "auto",
          overflow: "hidden",
        },
        variant === "glass" ? { borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.22)" } : null,
        style,
      ]}
    >
      {variant === "filled" ? (
        // A faint metallic sheen: lighter at the top, like polished gold.
        <LinearGradient colors={["rgba(255,244,199,0.55)", "rgba(255,244,199,0)"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      ) : null}
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={size === "sm" ? 14 : 17} color={p.fg} weight="semibold" /> : null}
          <Text variant={fontVariant} weight="600" color={p.fg} numberOfLines={1}>
            {title}
          </Text>
          {iconRight ? <Icon name={iconRight} size={size === "sm" ? 13 : 15} color={p.fg} weight="semibold" /> : null}
        </View>
      )}
    </PressableScale>
  );
}

/** Round icon-only button (toolbar, card corners). */
export function IconButton({
  name,
  onPress,
  size = 36,
  variant = "gray",
  color,
  disabled,
  accessibilityLabel,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  variant?: "gray" | "tinted" | "filled" | "plain" | "glass";
  color?: string;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const { c } = useTheme();
  const bg = { gray: c.fill, tinted: c.goldSoft, filled: c.goldBright, plain: "transparent", glass: "rgba(255,255,255,0.12)" }[variant];
  const fg = color ?? { gray: c.label, tinted: c.goldInk, filled: c.onGold, plain: c.gold, glass: c.onVault }[variant];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={8}
      scaleTo={0.88}
      dimTo={variant === "plain" ? 0.5 : 1}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2, borderCurve: "continuous",
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={name} size={size * 0.48} color={fg} weight="semibold" />
    </PressableScale>
  );
}

/** Text/icon button for the navigation bar (headerRight / headerLeft). */
export function HeaderButton({
  title,
  icon,
  onPress,
  disabled,
  bold,
  accessibilityLabel,
}: {
  title?: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  bold?: boolean;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: disabled ? 0.35 : pressed ? 0.5 : 1, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 4 })}
    >
      {icon ? <Icon name={icon} size={20} color={c.gold} weight="semibold" /> : null}
      {title ? (
        <Text variant="body" color={c.gold} weight={bold ? "600" : "400"}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", flexDirection: "row" },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
});
