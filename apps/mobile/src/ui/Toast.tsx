import { BlurView } from "expo-blur";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Text } from "./Text";

/**
 * Toasts (web: sonner). `toast.success("Saved")`, `toast.error(err)`.
 * A global store rendered by <ToastViewport/> at the root and inside sheets,
 * so messages stay visible above modals.
 */
type ToastKind = "success" | "error" | "info" | "warning";
type ToastItem = { id: number; kind: ToastKind; title: string; message?: string };

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(kind: ToastKind, title: string, message?: string) {
  const id = ++seq;
  items = [...items.slice(-2), { id, kind, title, message }];
  emit();
  if (kind === "success") haptic.success();
  else if (kind === "error") haptic.error();
  else if (kind === "warning") haptic.warning();
  setTimeout(() => dismiss(id), kind === "error" ? 4500 : 2800);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, message?: string) => push("success", title, message),
  info: (title: string, message?: string) => push("info", title, message),
  warning: (title: string, message?: string) => push("warning", title, message),
  /** Accepts a string or any thrown value. */
  error: (err: unknown, fallback = "Something went wrong") =>
    push("error", typeof err === "string" ? err : errorMessage(err, fallback)),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ToastViewport() {
  const list = useSyncExternalStore(subscribe, () => items);
  const insets = useSafeAreaInsets();
  if (list.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 6, alignItems: "center" }]}>
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </View>
  );
}

function ToastCard({ t }: { t: ToastItem }) {
  const { c, dark } = useTheme();
  const y = useRef(new Animated.Value(-30)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 180 }),
      Animated.timing(o, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [o, y]);
  const meta: Record<ToastKind, { icon: IconName; color: string }> = {
    success: { icon: "checkCircle", color: c.green },
    error: { icon: "alert", color: c.red },
    warning: { icon: "warning", color: c.orange },
    info: { icon: "info", color: c.gold },
  };
  const m = meta[t.kind];
  return (
    <Animated.View style={{ transform: [{ translateY: y }], opacity: o, marginBottom: 8, maxWidth: 420, width: "92%" }}>
      <Pressable
        onPress={() => dismiss(t.id)}
        style={{
          borderRadius: 26,
          borderCurve: "continuous",
          shadowColor: "#000",
          shadowOpacity: dark ? 0.5 : 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
        }}
      >
        {/* Frosted capsule on iOS (like system banners); solid elsewhere. */}
        <BlurView
          intensity={Platform.OS === "ios" ? 100 : 0}
          tint={dark ? "systemThickMaterialDark" : "systemThickMaterialLight"}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 26,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: Platform.OS === "ios" ? undefined : dark ? "#2C2C2E" : "#FFFFFF",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
          }}
        >
        <Icon name={m.icon} size={20} color={m.color} weight="semibold" />
        <View style={{ flex: 1 }}>
          <Text variant="subhead" weight="600" numberOfLines={2}>
            {t.title}
          </Text>
          {t.message ? (
            <Text variant="footnote" tone="secondary" numberOfLines={3}>
              {t.message}
            </Text>
          ) : null}
        </View>
        </BlurView>
      </Pressable>
    </Animated.View>
  );
}
