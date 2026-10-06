import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, View, type StyleProp, type ViewStyle } from "react-native";
import { errorMessage } from "@/lib/api";
import { GUTTER, radius, squircle, useTheme } from "@/theme";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

export function EmptyState({
  icon = "inbox",
  title,
  message,
  action,
  compact,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
  compact?: boolean;
}) {
  const { c } = useTheme();
  return (
    // Mirrors iOS ContentUnavailableView: a large quiet symbol, bold title, short explanation.
    <View style={{ alignItems: "center", paddingVertical: compact ? 24 : 64, paddingHorizontal: 36, gap: compact ? 6 : 8 }}>
      <Icon name={icon} size={compact ? 34 : 48} color={c.label3} weight="regular" style={{ marginBottom: compact ? 4 : 10 }} />
      <Text variant={compact ? "headline" : "title3"} weight="700" center>
        {title}
      </Text>
      {message ? (
        <Text variant={compact ? "footnote" : "subhead"} tone="secondary" center style={{ maxWidth: 300 }}>
          {message}
        </Text>
      ) : null}
      {action ? <Button title={action.label} icon={action.icon} onPress={action.onPress} variant="tinted" size="sm" style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load" }: { error: unknown; onRetry?: () => void; title?: string }) {
  const code = (error as { code?: string } | null)?.code;
  const forbidden = code === "FORBIDDEN";
  return (
    <EmptyState
      icon={forbidden ? "lock" : "warning"}
      title={forbidden ? "Not available for your role" : title}
      message={forbidden ? "Ask an owner or manager for access." : errorMessage(error)}
      action={onRetry && !forbidden ? { label: "Try again", onPress: onRetry, icon: "refresh" } : undefined}
    />
  );
}

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ paddingVertical: 60, alignItems: "center", justifyContent: "center" }, style]}>
      <ActivityIndicator color={c.gold} />
    </View>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ height = 16, width = "100%", style, r = 8 }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle>; r?: number }) {
  const { c } = useTheme();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ height, width, borderRadius: r, borderCurve: "continuous", backgroundColor: c.fillStrong, opacity: v }, style]} />;
}

/** A grouped card of skeleton rows while a list loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ marginHorizontal: GUTTER, marginTop: 18, backgroundColor: c.card, borderRadius: radius.lg - 2, ...squircle, paddingHorizontal: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 }}>
          <Skeleton width={30} height={30} r={8} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="35%" height={11} />
          </View>
          <Skeleton width={60} height={13} />
        </View>
      ))}
    </View>
  );
}
