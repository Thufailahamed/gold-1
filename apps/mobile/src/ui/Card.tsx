import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { router, type Href } from "expo-router";
import { haptic } from "@/lib/haptics";
import { elevation, GUTTER, radius, squircle, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";
import { Kicker, Text } from "./Text";

/** Plain rounded surface on the grouped background. */
export function Card({
  children,
  style,
  padded = true,
  inset = true,
  onPress,
  href,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  inset?: boolean;
  onPress?: () => void;
  href?: Href;
}) {
  const { c } = useTheme();
  const base: ViewStyle = {
    backgroundColor: c.card,
    borderRadius: radius.xl - 2,
    ...squircle,
    padding: padded ? 16 : 0,
    marginHorizontal: inset ? GUTTER : 0,
    overflow: "hidden",
  };
  if (!onPress && !href) return <View style={[base, style]}>{children}</View>;
  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => {
        haptic.selection();
        if (onPress) onPress();
        else if (href) router.push(href);
      }}
      style={[base, style]}
    >
      {children}
    </PressableScale>
  );
}

/** Card title row: icon chip + title/subtitle + optional action. */
export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  dark,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
  dark?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            ...squircle,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: dark ? "rgba(231,198,90,0.16)" : c.goldSoft,
          }}
        >
          <Icon name={icon} size={15} color={dark ? c.goldLight : c.goldInk} weight="semibold" />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="headline" tone={dark ? "onVault" : "label"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone={dark ? "onVault2" : "secondary"} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable hitSlop={8} onPress={action.onPress}>
          {({ pressed }) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, opacity: pressed ? 0.5 : 1 }}>
              <Text variant="subhead" color={dark ? c.goldLight : c.gold} weight="600">
                {action.label}
              </Text>
              <Icon name="chevronRight" size={11} color={dark ? c.goldLight : c.gold} weight="bold" />
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export type HeroStat = { label: string; value: string; onPress?: () => void };

/**
 * The dark "vault" hero used at the top of every module dashboard: gold
 * glow, kicker, big title, optional stat strip and actions. Same in both
 * colour schemes — it is the brand moment.
 */
export function Hero({
  kicker,
  title,
  subtitle,
  stats,
  children,
  actions,
  style,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  stats?: HeroStat[];
  children?: ReactNode;
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const r = radius.xxl - 4;
  return (
    // The outer view carries the shadow (a clipped view cannot cast one).
    <View style={[{ marginHorizontal: GUTTER, borderRadius: r, ...squircle, backgroundColor: c.vault }, dark ? null : elevation.mid, style]}>
    <View style={{ borderRadius: r, ...squircle, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.09)" }}>
      <LinearGradient
        colors={["#2A2110", "#0C0A09", "#0C0A09"]}
        locations={[0, 0.55, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <GoldGlow />
      <LinearGradient
        colors={["transparent", "rgba(231,198,90,0.55)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 1, position: "absolute", top: 0, left: 0, right: 0 }}
      />
      <View style={{ padding: 20, gap: 6 }}>
        {kicker ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: c.goldLight }} />
            <Kicker tone="gold" style={{ color: c.goldLight }}>
              {kicker}
            </Kicker>
          </View>
        ) : null}
        <Text variant="title1" tone="onVault" weight="800" style={{ letterSpacing: -0.6 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="subhead" tone="onVault2">
            {subtitle}
          </Text>
        ) : null}
        {children}
        {actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>{actions}</View> : null}
      </View>
      {stats && stats.length > 0 ? (
        <View style={styles.statStrip}>
          {stats.map((s, i) => {
            const inner = (
              <View style={{ paddingVertical: 14, paddingHorizontal: 16, gap: 3 }}>
                <Text variant="caption2" tone="onVault3" weight="600" upper numberOfLines={1} style={{ letterSpacing: 0.9 }}>
                  {s.label}
                </Text>
                <Text variant="title3" tone="onVault" num rounded numberOfLines={1} adjustsFontSizeToFit>
                  {s.value}
                </Text>
              </View>
            );
            const cellStyle: ViewStyle = {
              width: "50%",
              borderLeftWidth: i % 2 === 1 ? StyleSheet.hairlineWidth : 0,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: "rgba(255,255,255,0.1)",
            };
            return s.onPress ? (
              <Pressable key={s.label} style={({ pressed }) => [cellStyle, { opacity: pressed ? 0.6 : 1 }]} onPress={s.onPress}>
                {inner}
              </Pressable>
            ) : (
              <View key={s.label} style={cellStyle}>
                {inner}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
    </View>
  );
}

/** Big number tile for KPI grids. */
export function StatTile({
  label,
  value,
  unit,
  prefix,
  sub,
  icon,
  tone = "default",
  onPress,
  href,
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  prefix?: string;
  sub?: string;
  icon?: IconName;
  tone?: "default" | "success" | "danger" | "warning" | "gold";
  onPress?: () => void;
  href?: Href;
  loading?: boolean;
}) {
  const { c } = useTheme();
  const accent = { default: c.label, success: c.greenText, danger: c.redText, warning: c.orangeText, gold: c.gold }[tone];
  const content = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        {icon ? (
          <View style={{ width: 24, height: 24, borderRadius: 7, ...squircle, backgroundColor: c.goldSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name={icon} size={13} color={c.goldInk} weight="semibold" />
          </View>
        ) : null}
        <Text variant="footnote" tone="secondary" weight="500" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {onPress || href ? <Icon name="chevronRight" size={11} color={c.label3} weight="bold" /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 12 }}>
        {prefix ? (
          <Text variant="caption1" tone="secondary" weight="600">
            {prefix}
          </Text>
        ) : null}
        {loading ? (
          <View style={{ height: 28, width: 90, borderRadius: 6, borderCurve: "continuous", backgroundColor: c.fill }} />
        ) : (
          <Text variant="title2" color={accent} num rounded numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
            {value}
          </Text>
        )}
        {unit ? (
          <Text variant="footnote" tone="secondary" weight="600">
            {unit}
          </Text>
        ) : null}
      </View>
      {sub ? (
        <Text variant="caption1" tone="secondary" numberOfLines={1} style={{ marginTop: 3 }}>
          {sub}
        </Text>
      ) : null}
    </>
  );
  const style: ViewStyle = { flex: 1, backgroundColor: c.card, borderRadius: radius.lg + 2, ...squircle, padding: 14, minWidth: 0 };
  if (!onPress && !href) return <View style={style}>{content}</View>;
  return (
    <PressableScale
      scaleTo={0.97}
      style={style}
      onPress={() => {
        haptic.selection();
        if (onPress) onPress();
        else if (href) router.push(href);
      }}
    >
      {content}
    </PressableScale>
  );
}

/** Lays children out in a 2-column grid with standard gutters. */
export function Grid({ children, columns = 2, style }: { children: ReactNode; columns?: number; style?: StyleProp<ViewStyle> }) {
  const items = (Array.isArray(children) ? children : [children]).flat().filter(Boolean) as ReactNode[];
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View style={[{ marginHorizontal: GUTTER, gap: 10 }, style]}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          {r}
          {r.length < columns ? Array.from({ length: columns - r.length }).map((_, k) => <View key={`pad${k}`} style={{ flex: 1 }} />) : null}
        </View>
      ))}
    </View>
  );
}

/** Horizontal labelled bars ("BarList" on web) for breakdowns. */
export function BarList({
  items,
  format,
  color,
}: {
  items: { label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  color?: string;
}) {
  const { c } = useTheme();
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <View style={{ gap: 12 }}>
      {items.map((it) => (
        <View key={it.label} style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text variant="subhead" numberOfLines={1} style={{ flex: 1 }}>
              {it.label}
            </Text>
            <Text variant="subhead" num tone="secondary">
              {format(it.value)}
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: c.fill, overflow: "hidden" }}>
            <LinearGradient
              colors={color ? [color, color] : [c.goldLight, c.gold]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ height: 6, width: `${Math.max(2, (Math.abs(it.value) / max) * 100)}%`, borderRadius: 3 , borderCurve: "continuous"}}
            />
          </View>
          {it.sub ? (
            <Text variant="caption1" tone="secondary">
              {it.sub}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Coloured banner for warnings/info ("Callout" on web). */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  style,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: ReactNode;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const t = {
    info: { bg: c.goldSoft, fg: c.goldInk, icon: "info" as IconName },
    warning: { bg: dark ? "rgba(255,159,10,0.16)" : "#FFF4E0", fg: c.orangeText, icon: "warning" as IconName },
    danger: { bg: dark ? "rgba(255,69,58,0.16)" : "#FFECEB", fg: c.redText, icon: "alert" as IconName },
    success: { bg: dark ? "rgba(48,209,88,0.16)" : "#E9F8EE", fg: c.greenText, icon: "checkCircle" as IconName },
  }[tone];
  return (
    <View style={[{ marginHorizontal: GUTTER, backgroundColor: t.bg, borderRadius: radius.lg, ...squircle, padding: 14, flexDirection: "row", gap: 10 }, style]}>
      <Icon name={icon ?? t.icon} size={18} color={t.fg} weight="semibold" />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="subhead" weight="600" color={t.fg}>
            {title}
          </Text>
        ) : null}
        {typeof children === "string" ? (
          <Text variant="footnote" color={dark ? c.label : t.fg}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** Soft radial gold light in the top-right corner of dark surfaces. */
export function GoldGlow({ size = 340, top = -170, right = -120, opacity = 0.5 }: { size?: number; top?: number; right?: number; opacity?: number }) {
  return (
    <Svg width={size} height={size} style={{ position: "absolute", top, right }} pointerEvents="none">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#E7C65A" stopOpacity={opacity} />
          <Stop offset="0.5" stopColor="#C9A227" stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor="#C9A227" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#glow)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  statStrip: { flexDirection: "row", flexWrap: "wrap" },
});
