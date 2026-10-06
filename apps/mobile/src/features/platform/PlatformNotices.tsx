import { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GUTTER, radius, useTheme } from "@/theme";
import { Callout, Icon, Text } from "@/ui";

type Limit = { used: number; max: number | null; near: boolean; over: boolean };
export type PlatformContext =
  | { managed: false }
  | {
      managed: true;
      tenant: { name: string; slug: string; status: string };
      maintenance: string | null;
      supportEmail: string;
      subscription?: { plan: string; status: string; trialEndsAt: number | null; currentPeriodEnd: number; cancelAtPeriodEnd: boolean } | null;
      billing?: { openInvoices: number; balanceCents: number; firstDueAt: number | null };
      limits?: { users: Limit; branches: Limit; products: Limit } | null;
      features?: Record<string, boolean>;
      announcements?: Array<{ id: string; title: string; body: string; severity: string }>;
    };

const DISMISS_KEY = "goldos.dismissedAnnouncements";

export function usePlatformContext() {
  return useQuery({
    queryKey: ["platform-context"],
    queryFn: () => api<PlatformContext>("/api/v1/platform/context"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const days = (ms: number) => Math.max(0, Math.ceil(ms / 864e5));

/**
 * Account notices from the platform (web PlatformBanner): trial clock,
 * overdue balance, pending cancellation, plan limits, maintenance and
 * published announcements. Renders nothing on an unmanaged deployment.
 */
export function PlatformNotices() {
  const { c } = useTheme();
  const ctx = usePlatformContext();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    SecureStore.getItemAsync(DISMISS_KEY)
      .then((raw) => setDismissed(raw ? (JSON.parse(raw) as string[]) : []))
      .catch(() => undefined);
  }, []);

  const d = ctx.data;
  if (!d || !d.managed) return null;

  const now = Date.now();
  const mail = d.supportEmail;
  const notices: { key: string; tone: "warning" | "danger" | "info"; text: string }[] = [];
  if (d.maintenance) notices.push({ key: "maint", tone: "warning", text: d.maintenance });
  const s = d.subscription;
  if (s?.status === "TRIALING" && s.trialEndsAt && s.trialEndsAt - now < 7 * 864e5) {
    const n = days(s.trialEndsAt - now);
    notices.push({ key: "trial", tone: "info", text: `Your ${s.plan} trial ends in ${n} day${n === 1 ? "" : "s"}. Contact ${mail} to continue without interruption.` });
  }
  if (s?.status === "PAST_DUE" || (d.billing?.firstDueAt && d.billing.firstDueAt < now && (d.billing.balanceCents ?? 0) > 0)) {
    const bal = ((d.billing?.balanceCents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    notices.push({ key: "pastdue", tone: "danger", text: `Payment overdue: LKR ${bal}. Access is suspended if it stays unpaid — contact ${mail}.` });
  }
  if (s?.cancelAtPeriodEnd) {
    notices.push({
      key: "cancel",
      tone: "warning",
      text: `Your subscription ends on ${new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
    });
  }
  for (const [k, l] of Object.entries(d.limits ?? {})) {
    if (l.over) notices.push({ key: `limit-${k}`, tone: "warning", text: `You've reached your plan's limit of ${l.max} ${k}. Upgrade to add more.` });
    else if (l.near) notices.push({ key: `limit-${k}`, tone: "info", text: `You're using ${l.used} of ${l.max} ${k} on your plan.` });
  }
  const announcements = (d.announcements ?? []).filter((a) => !dismissed.includes(a.id));
  if (notices.length === 0 && announcements.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    SecureStore.setItemAsync(DISMISS_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  return (
    <View style={{ gap: 10, marginTop: 8 }}>
      {notices.map((n) => (
        <Pressable key={n.key} onPress={() => (n.text.includes(mail) ? void Linking.openURL(`mailto:${mail}`) : undefined)}>
          <Callout tone={n.tone}>{n.text}</Callout>
        </Pressable>
      ))}
      {announcements.map((a) => {
        const critical = a.severity === "CRITICAL";
        const warn = a.severity === "WARNING";
        return (
          <View
            key={a.id}
            style={{
              marginHorizontal: GUTTER,
              borderRadius: radius.lg, borderCurve: "continuous",
              padding: 14,
              backgroundColor: critical ? "rgba(255,59,48,0.12)" : warn ? "rgba(255,149,0,0.12)" : c.goldSoft,
              flexDirection: "row",
              gap: 10,
            }}
          >
            <Icon name={critical ? "alert" : warn ? "warning" : "bell"} size={18} color={critical ? c.red : warn ? c.orange : c.gold} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subhead" weight="600">
                {a.title}
              </Text>
              <Text variant="footnote" tone="secondary">
                {a.body}
              </Text>
            </View>
            {!critical ? (
              <Pressable hitSlop={10} onPress={() => dismiss(a.id)} accessibilityLabel="Dismiss announcement">
                <Icon name="close" size={14} color={c.label2} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
