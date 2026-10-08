import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, type MeData } from "@/lib/api";
import { useCountUp } from "@/lib/count-up";
import { ago, compact, grams, greeting, humanize, lkr0 } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { useBranch, useSession } from "@/lib/session";
import { elevation, GUTTER, radius, squircle, useTheme } from "@/theme";
import { PlatformNotices } from "@/features/platform/PlatformNotices";
import {
  AreaChart,
  Avatar,
  EmptyState,
  GoldGlow,
  Icon,
  Kicker,
  OptionSheet,
  PressableScale,
  Ring,
  Screen,
  Skeleton,
  SkeletonRows,
  StatusPill,
  Text,
  toast,
  useRefresh,
  type IconName,
} from "@/ui";

type Rate = { id: string; karat: string; rate_per_gram: number; effective_from: number };
type Invoice = { id: string; number: string; customer_name: string | null; total_cents: number; status: string; created_at: number };
type Approval = { id: string; action: string; entity: string; reason: string; createdAt: number };
type AuditRow = { id: string; action: string; entity: string; entity_id: string; created_at: number };

const opt = { retry: false, staleTime: 60_000 } as const;

/* ------------------------------------------------------------------ data */

function useDashboard(me: MeData | null, can: (p: string) => boolean) {
  const ready = !!me;
  const approvalsScope = can("branches:manage") ? "" : me?.branchIds[0] ? `&branchId=${encodeURIComponent(me.branchIds[0])}` : null;

  const salesToday = useQuery({
    ...opt,
    queryKey: ["dash", "sales", "today"],
    queryFn: () => api<{ invoices: number; value_cents: number; gold_mg: number }>("/api/v1/sales/reports/summary?period=today"),
    enabled: ready && can("sales:view"),
  });
  const salesMonth = useQuery({
    ...opt,
    queryKey: ["dash", "sales", "month"],
    queryFn: () => api<{ invoices: number; value_cents: number; gold_mg: number }>("/api/v1/sales/reports/summary?period=month"),
    enabled: ready && can("sales:view"),
  });
  const purchasesToday = useQuery({
    ...opt,
    queryKey: ["dash", "purchases", "today"],
    queryFn: () => api<{ value_cents: number }>("/api/v1/purchases/reports/summary?period=today"),
    enabled: ready && can("purchases:view"),
  });
  const oldGoldToday = useQuery({
    ...opt,
    queryKey: ["dash", "oldgold", "today"],
    queryFn: () => api<{ fine_mg: number }>("/api/v1/oldgold/reports/summary?period=today"),
    enabled: ready && can("oldgold:view"),
  });
  const wip = useQuery({
    ...opt,
    queryKey: ["dash", "mfg", "wip"],
    queryFn: () => api<{ allocatedMg: number }[]>("/api/v1/manufacturing/reports/wip"),
    enabled: ready && can("mfg:view"),
  });
  const rates = useQuery({
    ...opt,
    queryKey: ["dash", "rates"],
    queryFn: () => api<Rate[]>("/api/v1/gold-rates/current"),
    enabled: ready && can("masters:view"),
  });
  const invoices = useQuery({
    ...opt,
    queryKey: ["dash", "invoices"],
    queryFn: () => api<{ rows: Invoice[]; total: number }>("/api/v1/sales/invoices?limit=6&page=1"),
    enabled: ready && can("sales:view"),
  });
  const approvals = useQuery({
    ...opt,
    queryKey: ["dash", "approvals", approvalsScope],
    queryFn: () => api<{ rows: Approval[]; total: number }>(`/api/v1/approvals?status=PENDING&limit=4${approvalsScope ?? ""}`),
    enabled: ready && approvalsScope !== null,
  });
  const audit = useQuery({
    ...opt,
    queryKey: ["dash", "audit"],
    queryFn: () => api<{ rows: AuditRow[]; total: number }>("/api/v1/audit?limit=7&page=1"),
    enabled: ready && can("audit:view"),
  });
  const months = last12Months(new Date()).slice(-6);
  const trend = useQueries({
    queries: months.map((m) => ({
      ...opt,
      staleTime: 5 * 60_000,
      queryKey: ["dash", "trend", m.year, m.month],
      queryFn: () => api<MonthlySummary>(`/api/v1/reports/monthly?month=${m.month}&year=${m.year}`),
      enabled: ready && can("accounts:view"),
    })),
  });

  return { can, salesToday, salesMonth, purchasesToday, oldGoldToday, wip, rates, invoices, approvals, audit, months, trend };
}

type D = ReturnType<typeof useDashboard>;

/* ------------------------------------------------------------------ top header */

function HomeHeader({ me, d }: { me: MeData | null; d: D }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pendingCount = d.approvals.data?.total ?? 0;
  const firstName = me?.user.name?.split(" ")[0] ?? "Team";

  // On iOS the scroll view's automatic content inset already clears the status bar.
  const top = Platform.OS === "ios" ? 8 : insets.top + 12;

  return (
    <View style={[styles.topHeader, { paddingTop: top }]}>
      <View style={styles.headerLeft}>
        <View style={[styles.avatarRing, { borderColor: c.goldBright }]}>
          <Avatar name={me?.user.name} size={44} gold />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="footnote" tone="secondary" weight="500">
            {greeting()}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text variant="title1" weight="700" display numberOfLines={1} style={{ flexShrink: 1, lineHeight: 34 }}>
              {firstName}
            </Text>
            {d.can("branches:manage") ? (
              <View style={[styles.roleBadge, { backgroundColor: c.goldSoft }]}>
                <Icon name="crown" size={9} color={c.goldInk} weight="bold" />
                <Text variant="caption2" weight="800" color={c.goldInk} upper style={{ fontSize: 9, letterSpacing: 0.8 }}>
                  Admin
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <PressableScale
        scaleTo={0.9}
        accessibilityLabel={pendingCount > 0 ? `${pendingCount} pending approvals` : "Notifications"}
        onPress={() => {
          haptic.light();
          router.push("/approvals");
        }}
        style={[styles.iconBtn, { backgroundColor: c.card }, elevation.low]}
      >
        <Icon name="bell" size={18} color={c.label} weight="medium" />
        {pendingCount > 0 ? (
          <View style={[styles.bellBadge, { backgroundColor: c.red, borderColor: c.card }]}>
            <Text variant="caption2" weight="800" color="#FFFFFF" style={{ fontSize: 10, lineHeight: 12 }}>
              {pendingCount > 9 ? "9+" : pendingCount}
            </Text>
          </View>
        ) : null}
      </PressableScale>
    </View>
  );
}

/* ------------------------------------------------------------------ hero card */

function BranchChip() {
  const b = useBranch();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PressableScale
        scaleTo={0.95}
        accessibilityLabel="Switch branch"
        onPress={() => {
          haptic.selection();
          setOpen(true);
        }}
        style={styles.branchChip}
      >
        <View style={styles.liveDotHalo}>
          <View style={styles.liveDot} />
        </View>
        <Text variant="caption1" weight="700" color="#FFFFFF" numberOfLines={1} style={{ maxWidth: 120 }}>
          {b.branch?.name ?? "Branch"}
        </Text>
        <Icon name="chevronDown" size={9} color="rgba(255,255,255,0.55)" weight="bold" />
      </PressableScale>
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Switch Branch"
        value={b.branchId}
        options={b.branches.map((br) => ({ value: br.id, label: br.name, subtitle: br.code }))}
        onPick={(id) => {
          if (id) {
            b.setBranchId(id);
            toast.success("Branch switched", b.branches.find((x) => x.id === id)?.name);
          }
          setOpen(false);
        }}
      />
    </>
  );
}

function HeroCard({ d }: { d: D }) {
  const today = d.salesToday.data;
  const month = d.salesMonth.data;
  const pctValue = today && month && month.value_cents > 0 ? (today.value_cents / month.value_cents) * 100 : 0;
  const animatedValue = useCountUp(today ? today.value_cents / 100 : 0);
  const displaySales = today ? Math.round(animatedValue).toLocaleString("en-US") : "0";

  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);
  const oldGold = d.oldGoldToday.data;
  const purchases = d.purchasesToday.data;

  const quickStats: { label: string; value: string; prefix?: string; unit?: string; icon: IconName; href: string }[] = [
    { label: "Month to date", value: month ? lkr0(month.value_cents) : "—", prefix: month ? "LKR" : undefined, icon: "trendUp", href: "/sales/reports" },
    { label: "Purchases today", value: purchases ? lkr0(purchases.value_cents) : "—", prefix: purchases ? "LKR" : undefined, icon: "truck", href: "/purchases/invoices" },
    { label: "Old gold intake", value: oldGold ? grams(oldGold.fine_mg) : "—", unit: oldGold ? "g" : undefined, icon: "scale", href: "/old-gold" },
    { label: "In workshop", value: wipMg !== undefined ? grams(wipMg) : "—", unit: wipMg !== undefined ? "g" : undefined, icon: "flask", href: "/gold/stock" },
  ];

  const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const avgTicket = today && today.invoices > 0 ? compact(today.value_cents / 100 / today.invoices) : "—";

  return (
    <View style={styles.heroShadow}>
      <View style={styles.hero}>
        <LinearGradient
          colors={["#3A2D0E", "#1A150C", "#0B0A08"]}
          locations={[0, 0.5, 1]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <GoldGlow size={420} top={-220} right={-170} opacity={0.55} />
        <LinearGradient
          colors={["transparent", "rgba(243,217,122,0.8)", "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.hairline}
        />

        <View style={{ padding: 20, paddingBottom: 20 }}>
          {/* Meta row */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="calendar" size={12} color="rgba(243,217,122,0.8)" weight="semibold" />
              <Text variant="caption1" tone="onVault2" weight="600" upper style={{ letterSpacing: 1.2 }}>
                {todayStr}
              </Text>
            </View>
            <BranchChip />
          </View>

          {/* Revenue */}
          <View style={styles.revenueRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Kicker style={{ color: "rgba(243,217,122,0.9)", letterSpacing: 1.4 }}>Today's revenue</Kicker>
              {d.salesToday.isLoading ? (
                <Skeleton width={150} height={44} style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 10, marginTop: 8 }} />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                  <Text variant="callout" tone="onVault3" weight="700">
                    LKR
                  </Text>
                  <Text
                    tone="onVault"
                    num
                    display
                    weight="700"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{ fontSize: 46, lineHeight: 56, flexShrink: 1 }}
                  >
                    {displaySales}
                  </Text>
                </View>
              )}
              <Text variant="footnote" tone="onVault2" numberOfLines={1} style={{ marginTop: 2 }}>
                {today && today.invoices > 0 ? `From ${today.invoices} sale${today.invoices > 1 ? "s" : ""} so far today` : "No sales recorded yet today"}
              </Text>
            </View>
            <Ring percent={pctValue} size={76} stroke={6} dark>
              <Text variant="headline" tone="onVault" display num weight="700" style={{ fontSize: 19, lineHeight: 22 }}>
                {Math.round(pctValue)}%
              </Text>
              <Text variant="caption2" tone="onVault3" weight="600" upper style={{ fontSize: 8, letterSpacing: 0.8 }}>
                of month
              </Text>
            </Ring>
          </View>

          {/* Today metrics */}
          <View style={styles.metricsRow}>
            <MiniMetric value={today ? today.invoices.toLocaleString("en-US") : "0"} label="Invoices" />
            <View style={styles.miniSep} />
            <MiniMetric value={today ? grams(today.gold_mg) : "0.000"} unit="g" label="Gold sold" />
            <View style={styles.miniSep} />
            <MiniMetric value={avgTicket} label="Avg ticket" />
          </View>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            {d.can("sales:create") ? (
              <PressableScale
                scaleTo={0.96}
                onPress={() => {
                  haptic.medium();
                  router.push("/pos");
                }}
                style={[styles.primaryBtn, { flex: 1 }]}
              >
                <LinearGradient colors={["#F8E4A0", "#E2BC4A", "#B8901C"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
                <View style={styles.btnSheen} />
                <Icon name="plus" size={16} color="#1C1917" weight="bold" />
                <Text variant="headline" weight="700" color="#1C1917">
                  New Sale
                </Text>
              </PressableScale>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <GlassIconButton icon="scan" label="Scan piece" onPress={() => router.push("/scanner")} />
            {d.can("products:view") ? <GlassIconButton icon="package" label="Catalog" onPress={() => router.push("/products")} /> : null}
          </View>
        </View>

        {/* 2×2 metric strip */}
        <View style={styles.strip}>
          {quickStats.map((s, i) => (
            <Pressable
              key={s.label}
              onPress={() => {
                haptic.selection();
                router.push(s.href as Href);
              }}
              style={({ pressed }) => [
                styles.cell,
                {
                  borderLeftWidth: i % 2 === 1 ? StyleSheet.hairlineWidth : 0,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent",
                },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name={s.icon} size={11} color="rgba(243,217,122,0.75)" weight="semibold" />
                <Text variant="caption2" tone="onVault3" weight="700" upper numberOfLines={1} style={{ flex: 1, letterSpacing: 0.8, fontSize: 10 }}>
                  {s.label}
                </Text>
                <Icon name="chevronRight" size={8} color="rgba(255,255,255,0.25)" weight="bold" />
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                {s.prefix ? (
                  <Text variant="caption2" tone="onVault3" weight="700">
                    {s.prefix}
                  </Text>
                ) : null}
                <Text variant="headline" tone="onVault" weight="700" num rounded numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
                  {s.value}
                </Text>
                {s.unit ? (
                  <Text variant="caption1" tone="onVault3" weight="600">
                    {s.unit}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function MiniMetric({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
        <Text variant="headline" tone="onVault" weight="700" num rounded numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? (
          <Text variant="caption2" tone="onVault3" weight="600">
            {unit}
          </Text>
        ) : null}
      </View>
      <Text variant="caption2" tone="onVault3" weight="600" upper numberOfLines={1} style={{ marginTop: 2, fontSize: 9, letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

function GlassIconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <PressableScale
      scaleTo={0.92}
      accessibilityLabel={label}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={styles.glassBtn}
    >
      <Icon name={icon} size={20} color="#FFFFFF" weight="semibold" />
    </PressableScale>
  );
}

/* ------------------------------------------------------------------ section title */

function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: { label: string; onPress: () => void } }) {
  const { c } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text variant="title2" weight="700" display numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="tertiary" weight="500" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable hitSlop={8} onPress={action.onPress}>
          {({ pressed }) => (
            <View style={[styles.sectionAction, { backgroundColor: c.goldSoft, opacity: pressed ? 0.6 : 1 }]}>
              <Text variant="footnote" weight="600" color={c.goldInk}>
                {action.label}
              </Text>
              <Icon name="chevronRight" size={9} color={c.goldInk} weight="bold" />
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ urgent alert */

function UrgentAlert({ d }: { d: D }) {
  const { c } = useTheme();
  const pending = d.approvals.data?.total ?? 0;
  const first = d.approvals.data?.rows?.[0];
  if (pending === 0) return null;

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => {
        haptic.selection();
        router.push("/approvals");
      }}
      style={[styles.urgentCard, { backgroundColor: c.card }, styles.surfaceLift]}
    >
      <View style={[styles.urgentAccent, { backgroundColor: c.orange }]} />
      <View style={[styles.urgentIcon, { backgroundColor: `${c.orange}1F` }]}>
        <Icon name="shieldAlert" size={20} color={c.orange} weight="bold" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="subhead" weight="700" numberOfLines={1}>
          {pending} approval{pending > 1 ? "s" : ""} waiting
        </Text>
        <Text variant="footnote" tone="secondary" numberOfLines={1} style={{ marginTop: 1 }}>
          {first ? `${humanize(first.action)} · ${humanize(first.entity)}` : "Decisions awaiting your review"}
        </Text>
      </View>
      <View style={[styles.urgentActionBtn, { backgroundColor: c.orange }]}>
        <Text variant="footnote" weight="700" color="#FFFFFF">
          Review
        </Text>
      </View>
    </PressableScale>
  );
}

/* ------------------------------------------------------------------ quick operations */

const OP_ACTIONS: { label: string; href: string; icon: IconName; color: string; perm: string }[] = [
  { label: "New Sale", href: "/pos", icon: "cart", color: "#C9A227", perm: "sales:create" },
  { label: "Scan", href: "/scanner", icon: "scan", color: "#007AFF", perm: "products:view" },
  { label: "Old Gold", href: "/old-gold", icon: "scale", color: "#FF9500", perm: "oldgold:view" },
  { label: "Catalog", href: "/products", icon: "package", color: "#AF52DE", perm: "products:view" },
  { label: "Purchases", href: "/purchases/invoices", icon: "truck", color: "#30B0C7", perm: "purchases:view" },
  { label: "Melting", href: "/gold/melting", icon: "flame", color: "#FF6B3D", perm: "gold:view" },
  { label: "Transfers", href: "/inventory/transfers", icon: "swap", color: "#5856D6", perm: "products:view" },
  { label: "Day Close", href: "/day-closing", icon: "lock", color: "#34C759", perm: "accounts:view" },
];

const OP_COLS = 4;
const OP_PAD = 8;

function QuickOperations({ d }: { d: D }) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const items = OP_ACTIONS.filter((a) => d.can(a.perm));
  if (items.length === 0) return null;
  const tile = Math.floor((width - GUTTER * 2 - OP_PAD * 2 - 2) / OP_COLS);

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle title="Quick Actions" />
      <Surface style={styles.quickGrid}>
        {items.map((item) => (
          <PressableScale
            key={item.href}
            scaleTo={0.9}
            onPress={() => {
              haptic.light();
              router.push(item.href as Href);
            }}
            style={{ width: tile, alignItems: "center", paddingVertical: 10 }}
          >
            <View style={[styles.quickIconWrap, { backgroundColor: `${item.color}1A` }]}>
              <Icon name={item.icon} size={22} color={item.color} weight="semibold" />
            </View>
            <Text variant="caption1" weight="600" numberOfLines={1} style={{ marginTop: 7 }}>
              {item.label}
            </Text>
          </PressableScale>
        ))}
      </Surface>
    </View>
  );
}

/* ------------------------------------------------------------------ live rates */

function LiveBoardRates({ d }: { d: D }) {
  const rows = [...(d.rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const updated = rows.reduce((m, r) => Math.max(m, r.effective_from), 0);

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle
        title="Gold Board Rates"
        action={d.can("masters:view") ? { label: "Edit", onPress: () => router.push("/gold-rates") } : undefined}
      />
      <View style={styles.ratesCard}>
        <LinearGradient colors={["#241C0E", "#100E0B"]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        <GoldGlow size={300} top={-170} right={-130} opacity={0.35} />

        {!d.can("masters:view") ? (
          <DarkEmpty title="Rates Hidden" desc="Board rates require masters view permission." />
        ) : d.rates.isLoading ? (
          <View style={{ gap: 10 }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} height={52} r={12} style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
            ))}
          </View>
        ) : rows.length === 0 ? (
          <DarkEmpty title="No Rates Published" desc="Publish today's gold rates to price jewellery accurately." />
        ) : (
          <View>
            {rows.map((r, i) => {
              const sovereign = r.karat.includes("22") ? r.rate_per_gram * 8 : null;
              return (
                <View key={r.id} style={[styles.rateRow, i > 0 && styles.rateRowDivider]}>
                  <LinearGradient colors={["#F8E4A0", "#C9A227"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.karatBadge}>
                    <Text variant="footnote" weight="800" color="#1C1917" num>
                      {r.karat}
                    </Text>
                  </LinearGradient>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="subhead" tone="onVault" weight="600">
                      Per gram
                    </Text>
                    <Text variant="caption1" tone="onVault3" numberOfLines={1}>
                      {sovereign ? `Sovereign (8 g) · LKR ${Math.round(sovereign).toLocaleString("en-US")}` : "Fine gold"}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                    <Text variant="caption2" tone="onVault3" weight="700">
                      LKR
                    </Text>
                    <Text variant="title2" tone="onVault" num display weight="700">
                      {r.rate_per_gram.toLocaleString("en-US")}
                    </Text>
                  </View>
                </View>
              );
            })}
            <View style={styles.ratesFooter}>
              <Icon name="clock" size={11} color="rgba(255,255,255,0.35)" />
              <Text variant="caption1" tone="onVault3">
                {updated ? `Updated ${ago(updated)}` : "Official per-gram prices"}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function DarkEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <View style={styles.darkEmptyContainer}>
      <Icon name="coins" size={20} color="#F3D97A" />
      <Text variant="subhead" weight="600" tone="onVault" style={{ marginTop: 6 }}>
        {title}
      </Text>
      <Text variant="caption1" tone="onVault2" center style={{ marginTop: 2, maxWidth: 220 }}>
        {desc}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ surface */

/** Card on the grouped background: soft shadow outside, hairline edge inside. */
function Surface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, dark } = useTheme();
  return (
    <View style={[styles.surfaceShadow, { backgroundColor: c.card }, dark ? null : styles.surfaceLift]}>
      <View style={[styles.surface, { borderColor: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }, style]}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ recent invoices */

function RecentSalesCard({ d }: { d: D }) {
  const { c } = useTheme();
  const rows = d.invoices.data?.rows ?? [];

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle
        title="Recent Sales"
        subtitle={d.invoices.data ? `${d.invoices.data.total.toLocaleString("en-US")} invoices` : undefined}
        action={d.can("sales:view") ? { label: "View all", onPress: () => router.push("/sales/invoices") } : undefined}
      />
      <Surface>
        {!d.can("sales:view") ? (
          <EmptyState compact icon="receipt" title="Sales Hidden" message="Recent transactions need sales permission." />
        ) : d.invoices.isLoading ? (
          <View style={{ padding: 16, gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={48} r={12} />
            ))}
          </View>
        ) : rows.length === 0 ? (
          <EmptyState compact icon="cart" title="No Sales Yet" message="Invoices from the POS will appear here." />
        ) : (
          rows.map((inv, i) => (
            <Pressable
              key={inv.id}
              onPress={() => {
                haptic.selection();
                router.push(`/sales/invoices/${inv.id}`);
              }}
            >
              {({ pressed }) => (
                <View style={[styles.saleRow, { backgroundColor: pressed ? c.highlight : "transparent" }]}>
                  <Avatar name={inv.customer_name ?? "Walk-in"} size={40} />
                  <View style={[styles.saleBody, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="subhead" weight="600" numberOfLines={1}>
                        {inv.customer_name ?? "Walk-in customer"}
                      </Text>
                      <Text variant="caption1" tone="secondary" numberOfLines={1} style={{ marginTop: 2 }}>
                        {inv.number} · {ago(inv.created_at)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                        <Text variant="caption2" tone="tertiary" weight="600">
                          LKR
                        </Text>
                        <Text variant="subhead" num weight="700">
                          {lkr0(inv.total_cents)}
                        </Text>
                      </View>
                      <StatusPill status={inv.status} size="sm" />
                    </View>
                  </View>
                </View>
              )}
            </Pressable>
          ))
        )}
      </Surface>
    </View>
  );
}

/* ------------------------------------------------------------------ revenue trend */

function RevenueTrendCard({ d }: { d: D }) {
  const { c } = useTheme();
  const denied = !d.can("accounts:view");
  const data = d.trend.map((t, i) => {
    const m = d.months[i]!;
    return {
      label: new Date(m.year, m.month - 1, 1).toLocaleString("en-GB", { month: "short" }),
      value: t.data ? t.data.profit.revenueCents / 100 : null,
      value2: t.data ? t.data.profit.netProfitCents / 100 : null,
    };
  });
  const loading = d.trend.some((t) => t.isLoading);
  const hasData = data.some((p) => p.value !== null);
  const total = data.reduce((s, p) => s + (p.value ?? 0), 0);
  const profit = data.reduce((s, p) => s + (p.value2 ?? 0), 0);
  const margin = total > 0 ? Math.round((profit / total) * 100) : null;

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle
        title="Performance"
        subtitle="Last 6 months"
        action={denied ? undefined : { label: "Analytics", onPress: () => router.push("/analytics") }}
      />
      <Surface style={{ padding: 16 }}>
        {denied ? (
          <EmptyState compact icon="trendUp" title="Accounts Access Needed" message="Revenue trends are visible to accounts managers." />
        ) : loading ? (
          <Skeleton height={200} r={12} />
        ) : !hasData ? (
          <EmptyState compact icon="trendUp" title="No Trend Data Yet" message="Monthly figures appear once sales are posted." />
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              <TrendStat label="Revenue" value={compact(total)} swatch={c.gold} />
              <TrendStat label="Net profit" value={compact(profit)} swatch={c.label} dashed />
              {margin !== null ? <TrendStat label="Margin" value={`${margin}%`} /> : null}
            </View>
            <AreaChart data={data} seriesLabels={["Revenue", "Net profit"]} format={(v) => compact(v)} />
          </>
        )}
      </Surface>
    </View>
  );
}

function TrendStat({ label, value, swatch, dashed }: { label: string; value: string; swatch?: string; dashed?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.trendStat, { backgroundColor: c.cardSecondary }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {swatch ? <View style={{ width: 10, height: dashed ? 2 : 4, borderRadius: 2, backgroundColor: swatch }} /> : null}
        <Text variant="caption2" tone="secondary" weight="600" upper style={{ letterSpacing: 0.6, fontSize: 10 }}>
          {label}
        </Text>
      </View>
      <Text variant="headline" weight="700" num numberOfLines={1} adjustsFontSizeToFit style={{ marginTop: 4 }}>
        {value}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ activity feed */

function activityStyle(action: string, c: ReturnType<typeof useTheme>["c"]): { icon: IconName; color: string } {
  const a = action.toLowerCase();
  if (a.includes("delete") || a.includes("cancel") || a.includes("void")) return { icon: "trash", color: c.red };
  if (a.includes("approve")) return { icon: "check", color: c.green };
  if (a.includes("create") || a.includes("add")) return { icon: "plus", color: c.green };
  if (a.includes("update") || a.includes("edit")) return { icon: "edit", color: c.blue };
  if (a.includes("login") || a.includes("auth")) return { icon: "key", color: c.indigo };
  return { icon: "sparkles", color: c.gold };
}

function ActivityFeed({ d }: { d: D }) {
  const { c } = useTheme();
  const rows = d.audit.data?.rows ?? [];
  if (!d.can("audit:view")) return null;

  return (
    <View style={{ marginTop: 28 }}>
      <SectionTitle title="Store Activity" action={{ label: "Audit log", onPress: () => router.push("/audit") }} />
      <Surface style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
        {d.audit.isLoading ? (
          <View style={{ gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={40} r={10} />
            ))}
          </View>
        ) : rows.length === 0 ? (
          <EmptyState compact icon="history" title="No Recent Activity" message="System events and updates will appear here." />
        ) : (
          rows.map((r, i) => {
            const s = activityStyle(r.action, c);
            const last = i === rows.length - 1;
            return (
              <View key={r.id} style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ alignItems: "center", width: 30 }}>
                  <View style={[styles.activityDot, { backgroundColor: `${s.color}1F` }]}>
                    <Icon name={s.icon} size={12} color={s.color} weight="bold" />
                  </View>
                  {!last ? <View style={{ width: 1.5, flex: 1, backgroundColor: c.hairline, marginVertical: 4 }} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingTop: 5, paddingBottom: last ? 0 : 16 }}>
                  <Text variant="subhead" numberOfLines={1}>
                    <Text variant="subhead" weight="600">
                      {humanize(r.action)}
                    </Text>
                    <Text variant="subhead" tone="secondary">
                      {"  ·  "}
                      {humanize(r.entity)}
                    </Text>
                  </Text>
                  <Text variant="caption1" tone="tertiary" numberOfLines={1} style={{ marginTop: 2 }}>
                    {ago(r.created_at)} · #{r.entity_id.slice(0, 8)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </Surface>
    </View>
  );
}

/* ------------------------------------------------------------------ main screen */

export default function DashboardScreen() {
  const { me, can } = useSession();
  const d = useDashboard(me, can);
  const refresh = useRefresh(
    d.salesToday,
    d.salesMonth,
    d.purchasesToday,
    d.oldGoldToday,
    d.wip,
    d.rates,
    d.invoices,
    d.approvals,
    d.audit,
    ...d.trend
  );

  return (
    <Screen {...refresh} contentStyle={{ paddingBottom: 120 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <HomeHeader me={me} d={d} />
      <PlatformNotices />
      <HeroCard d={d} />
      <UrgentAlert d={d} />
      <QuickOperations d={d} />
      <LiveBoardRates d={d} />
      <RecentSalesCard d={d} />
      <RevenueTrendCard d={d} />
      <ActivityFeed d={d} />
      {!me ? <SkeletonRows /> : null}
    </Screen>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  topHeader: {
    paddingHorizontal: GUTTER,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  avatarRing: {
    padding: 2,
    borderRadius: 26,
    borderWidth: 1.5,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  heroShadow: {
    marginHorizontal: GUTTER,
    borderRadius: radius.xxl,
    ...squircle,
    backgroundColor: "#0C0A09",
    shadowColor: "#3A2A05",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  hero: {
    borderRadius: radius.xxl,
    ...squircle,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(231,198,90,0.3)",
  },
  hairline: {
    height: 1,
    position: "absolute",
    top: 0,
    left: 32,
    right: 32,
  },
  branchChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 8,
    paddingRight: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  liveDotHalo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "rgba(48,209,88,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#30D158",
  },
  revenueRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  metricsRow: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 16,
    ...squircle,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.09)",
    flexDirection: "row",
    alignItems: "center",
  },
  miniSep: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  primaryBtn: {
    height: 52,
    borderRadius: 16,
    ...squircle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,244,199,0.7)",
  },
  btnSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "48%",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  glassBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    ...squircle,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.09)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  cell: {
    width: "50%",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sectionTitle: {
    marginHorizontal: GUTTER,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  urgentCard: {
    marginHorizontal: GUTTER,
    marginTop: 14,
    borderRadius: radius.xl - 2,
    ...squircle,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  urgentAccent: {
    position: "absolute",
    left: 6,
    top: 16,
    bottom: 16,
    width: 3,
    borderRadius: 2,
  },
  urgentIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    ...squircle,
    alignItems: "center",
    justifyContent: "center",
  },
  urgentActionBtn: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: OP_PAD,
  },
  quickIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    ...squircle,
    alignItems: "center",
    justifyContent: "center",
  },
  ratesCard: {
    marginHorizontal: GUTTER,
    borderRadius: radius.xl,
    ...squircle,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#0C0A09",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(231,198,90,0.25)",
  },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  rateRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  karatBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    ...squircle,
    alignItems: "center",
    justifyContent: "center",
  },
  ratesFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 10,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  darkEmptyContainer: {
    alignItems: "center",
    paddingVertical: 18,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.15)",
  },
  surfaceShadow: {
    marginHorizontal: GUTTER,
    borderRadius: radius.xl,
    ...squircle,
  },
  surfaceLift: {
    shadowColor: "#1C1408",
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  surface: {
    borderRadius: radius.xl,
    ...squircle,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
  },
  saleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 16,
  },
  saleBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingRight: 16,
  },
  trendStat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    ...squircle,
  },
  activityDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
});
