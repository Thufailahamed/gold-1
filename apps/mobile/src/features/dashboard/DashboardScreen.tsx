import { Pressable, StyleSheet, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, type MeData } from "@/lib/api";
import { useCountUp } from "@/lib/count-up";
import { ago, grams, greeting, humanize, lkr0 } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { useSession } from "@/lib/session";
import { GUTTER, radius, useTheme } from "@/theme";
import { PlatformNotices } from "@/features/platform/PlatformNotices";
import {
  AreaChart,
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  GoldGlow,
  Grid,
  Icon,
  Kicker,
  PressableScale,
  Ring,
  Screen,
  Skeleton,
  SkeletonRows,
  StatTile,
  StatusPill,
  Text,
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

/* ------------------------------------------------------------------ hero */

function HeroCard({ me, d }: { me: MeData | null; d: D }) {
  const firstName = me?.user.name?.split(" ")[0] ?? "there";
  const today = d.salesToday.data;
  const month = d.salesMonth.data;
  const pct = today && month ? (month.value_cents > 0 ? (today.value_cents / month.value_cents) * 100 : 0) : undefined;
  const todayValue = useCountUp(today ? today.value_cents / 100 : undefined);
  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);

  const strip: { label: string; value: string; icon: IconName; href: string }[] = [
    { label: "Month to date", value: month ? `LKR ${lkr0(month.value_cents)}` : "—", icon: "trendUp", href: "/sales/reports" },
    { label: "Invoices this month", value: month ? month.invoices.toLocaleString("en-US") : "—", icon: "inbox", href: "/sales/invoices" },
    { label: "Gold in workshop", value: wipMg !== undefined ? `${grams(wipMg)} g` : "—", icon: "flask", href: "/manufacturing/orders" },
    { label: "Pending approvals", value: d.approvals.data ? String(d.approvals.data.total) : "—", icon: "shield", href: "/approvals" },
  ];

  return (
    <View style={styles.hero}>
      <LinearGradient colors={["#2A2110", "#0C0A09", "#0C0A09"]} locations={[0, 0.6, 1]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <GoldGlow size={420} top={-220} right={-150} opacity={0.5} />
      <LinearGradient colors={["transparent", "rgba(231,198,90,0.55)", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hairline} />

      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={styles.kickerPill}>
            <View style={{ width: 6, height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: "#E7C65A" }} />
            <Kicker style={{ color: "#E7C65A" }}>Branch overview</Kicker>
          </View>
        </View>
        <Text variant="caption1" tone="onVault3" upper style={{ marginTop: 10, letterSpacing: 1 }}>
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </Text>
        <Text variant="title1" tone="onVault" style={{ marginTop: 4, letterSpacing: -0.5 }}>
          {greeting()}, <Text variant="title1" color="#E7C65A">{firstName}.</Text>
        </Text>
        <Text variant="subhead" tone="onVault2" style={{ marginTop: 6 }}>
          Here's how the counter, the vault and the workshop are moving today.
        </Text>

        {/* Today gauge */}
        <View style={styles.glass}>
          <Ring percent={pct ?? 0} size={104} stroke={9} dark>
            <Text variant="headline" tone="onVault" num rounded>
              {pct !== undefined ? `${Math.round(pct)}%` : "—"}
            </Text>
            <Text variant="caption2" tone="onVault3" upper weight="600">
              of month
            </Text>
          </Ring>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Kicker style={{ color: "rgba(231,198,90,0.8)" }}>Today's sales</Kicker>
            {d.salesToday.isLoading ? (
              <Skeleton width={130} height={30} style={{ marginTop: 8, backgroundColor: "rgba(255,255,255,0.1)" }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 4 }}>
                <Text variant="caption1" tone="onVault3">
                  LKR
                </Text>
                <Text variant="title1" tone="onVault" num rounded numberOfLines={1} adjustsFontSizeToFit style={{ flexShrink: 1 }}>
                  {today ? Math.round(todayValue).toLocaleString("en-US") : "—"}
                </Text>
              </View>
            )}
            <Text variant="caption1" tone="onVault2" style={{ marginTop: 6 }} num>
              {today ? today.invoices : "—"} invoices · {today ? grams(today.gold_mg) : "—"} g sold
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          {d.can("sales:create") ? <HeroButton primary icon="creditCard" label="New sale" onPress={() => router.push("/pos")} /> : null}
          <HeroButton icon="scan" label="Scan" onPress={() => router.push("/scanner")} />
          {d.can("products:view") ? <HeroButton icon="gem" label="Catalog" onPress={() => router.push("/products")} /> : null}
        </View>
      </View>

      {/* Strip */}
      <View style={styles.strip}>
        {strip.map((s, i) => (
          <Pressable
            key={s.label}
            onPress={() => {
              haptic.selection();
              router.push(s.href as Href);
            }}
            style={({ pressed }) => [
              styles.cell,
              { borderLeftWidth: i % 2 === 1 ? StyleSheet.hairlineWidth : 0, borderTopWidth: StyleSheet.hairlineWidth, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <View style={styles.cellIcon}>
              <Icon name={s.icon} size={13} color="#E7C65A" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption2" tone="onVault3" weight="600" upper numberOfLines={1} style={{ letterSpacing: 0.6 }}>
                {s.label}
              </Text>
              <Text variant="subhead" tone="onVault" weight="600" num numberOfLines={1} adjustsFontSizeToFit>
                {s.value}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function HeroButton({ label, icon, onPress, primary }: { label: string; icon: IconName; onPress: () => void; primary?: boolean }) {
  return (
    <PressableScale
      scaleTo={0.95}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={[
        styles.heroBtn,
        primary ? { backgroundColor: "#C9A227" } : { backgroundColor: "rgba(255,255,255,0.1)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.16)" },
        { flex: primary ? 1.2 : 1 },
      ]}
    >
      <Icon name={icon} size={15} color={primary ? "#1C1917" : "#FFFFFF"} weight="semibold" />
      <Text variant="subhead" weight="600" color={primary ? "#1C1917" : "#FFFFFF"} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/* ------------------------------------------------------------------ KPIs */

function Kpis({ d }: { d: D }) {
  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);
  const denied = (perm: string, q: { isError: boolean }) => !d.can(perm) || q.isError;
  const kpi = (
    label: string,
    icon: IconName,
    value: number | undefined,
    format: (n: number) => string,
    sub: string,
    href: string,
    loading: boolean,
    isDenied: boolean,
    prefix?: string,
    unit?: string
  ) => (
    <KpiTile key={label} label={label} icon={icon} value={value} format={format} sub={sub} href={href} loading={loading} denied={isDenied} prefix={prefix} unit={unit} />
  );
  return (
    <Grid style={{ marginTop: 16 }}>
      {kpi(
        "Today's sales",
        "banknote",
        d.salesToday.data ? d.salesToday.data.value_cents / 100 : undefined,
        (n) => Math.round(n).toLocaleString("en-US"),
        d.salesToday.data ? `${d.salesToday.data.invoices} invoices today` : "From sales invoices",
        "/sales/invoices",
        d.salesToday.isLoading,
        denied("sales:view", d.salesToday),
        "LKR"
      )}
      {kpi(
        "Gold sold",
        "gem",
        d.salesToday.data ? d.salesToday.data.gold_mg / 1000 : undefined,
        (n) => n.toFixed(3),
        "Net weight across today's pieces",
        "/sales/reports",
        d.salesToday.isLoading,
        denied("sales:view", d.salesToday),
        undefined,
        "g"
      )}
      {kpi(
        "Old gold bought",
        "scale",
        d.oldGoldToday.data ? d.oldGoldToday.data.fine_mg / 1000 : undefined,
        (n) => n.toFixed(3),
        "Fine gold taken in today",
        "/old-gold/items",
        d.oldGoldToday.isLoading,
        denied("oldgold:view", d.oldGoldToday),
        undefined,
        "g"
      )}
      {kpi(
        "Purchases",
        "truck",
        d.purchasesToday.data ? d.purchasesToday.data.value_cents / 100 : undefined,
        (n) => Math.round(n).toLocaleString("en-US"),
        wipMg !== undefined ? `${grams(wipMg)} g in the workshop` : "Supplier invoices today",
        "/purchases/invoices",
        d.purchasesToday.isLoading,
        denied("purchases:view", d.purchasesToday),
        "LKR"
      )}
    </Grid>
  );
}

function KpiTile(p: {
  label: string;
  icon: IconName;
  value: number | undefined;
  format: (n: number) => string;
  sub: string;
  href: string;
  loading: boolean;
  denied: boolean;
  prefix?: string;
  unit?: string;
}) {
  const n = useCountUp(p.value);
  return (
    <StatTile
      label={p.label}
      icon={p.icon}
      href={p.href as Href}
      loading={p.loading}
      prefix={p.denied ? undefined : p.prefix}
      unit={p.denied ? undefined : p.unit}
      value={p.denied ? "—" : p.value !== undefined ? p.format(n) : "—"}
      sub={p.denied ? "Not available for your role" : p.sub}
    />
  );
}

/* ------------------------------------------------------------------ panels */

function RevenuePanel({ d }: { d: D }) {
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
  return (
    <Card style={{ marginTop: 22 }}>
      <CardHeader icon="trendUp" title="Revenue trend" subtitle="Last six months · revenue and net profit" action={{ label: "Analytics", onPress: () => router.push("/analytics") }} />
      {denied ? (
        <EmptyState compact icon="trendUp" title="Accounts access needed" message="Revenue trends are visible to roles with accounts view." />
      ) : loading ? (
        <Skeleton height={190} r={12} />
      ) : !hasData ? (
        <EmptyState compact icon="trendUp" title="No trend data yet" message="Monthly figures appear once sales are posted." />
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
            <View>
              <Kicker>6-month revenue</Kicker>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 2 }}>
                <Text variant="caption1" tone="secondary">
                  LKR
                </Text>
                <Text variant="title2" num rounded>
                  {Math.round(total).toLocaleString("en-US")}
                </Text>
              </View>
            </View>
            <View style={{ gap: 4 }}>
              <Legend color="gold" label="Revenue" />
              <Legend label="Net profit" dashed />
            </View>
          </View>
          <AreaChart data={data} seriesLabels={["Revenue", "Net profit"]} format={(v) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)} />
        </>
      )}
    </Card>
  );
}

function Legend({ label, color, dashed }: { label: string; color?: "gold"; dashed?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 14, height: dashed ? 2 : 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: color ? c.gold : c.label, opacity: dashed ? 0.8 : 1 }} />
      <Text variant="caption1" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

function RatesPanel({ d }: { d: D }) {
  const rows = [...(d.rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const max = rows[0]?.rate_per_gram ?? 1;
  const updated = rows.reduce((m, r) => Math.max(m, r.effective_from), 0);
  return (
    <View style={[styles.rates]}>
      <LinearGradient colors={["#1F1A10", "#0C0A09"]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <GoldGlow size={300} top={-150} right={-110} opacity={0.4} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <LinearGradient colors={["#E7C65A", "#8C6D1F"]} style={styles.rateIcon}>
          <Icon name="coins" size={16} color="#0C0A09" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text variant="headline" tone="onVault">
            Board rates
          </Text>
          <Text variant="caption1" tone="onVault2">
            {updated ? `Updated ${ago(updated)}` : "Per gram, by karat"}
          </Text>
        </View>
        <View style={styles.live}>
          <View style={{ width: 6, height: 6, borderRadius: 3, borderCurve: "continuous", backgroundColor: "#30D158" }} />
          <Text variant="caption2" weight="700" color="#7EE2A0" upper>
            Live
          </Text>
        </View>
      </View>
      <View style={{ marginTop: 14, gap: 8 }}>
        {!d.can("masters:view") ? (
          <DarkEmpty title="Rates hidden" desc="Board rates need masters view." />
        ) : d.rates.isLoading ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={52} r={12} style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />)
        ) : rows.length === 0 ? (
          <DarkEmpty title="No rates published" desc="Publish today's board rates to price every piece." />
        ) : (
          rows.map((r) => (
            <View key={r.id} style={styles.rateRow}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={styles.karat}>
                  <Text variant="caption1" weight="700" color="#E7C65A" mono>
                    {r.karat}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                  <Text variant="caption2" tone="onVault3">
                    LKR
                  </Text>
                  <Text variant="headline" tone="onVault" num>
                    {r.rate_per_gram.toLocaleString("en-US")}
                  </Text>
                  <Text variant="caption2" tone="onVault3">
                    /g
                  </Text>
                </View>
              </View>
              <View style={styles.rateTrack}>
                <LinearGradient colors={["#8C6D1F", "#C9A227", "#E7C65A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, borderRadius: 2, borderCurve: "continuous", width: `${(r.rate_per_gram / max) * 100}%` }} />
              </View>
            </View>
          ))
        )}
      </View>
      <Pressable
        onPress={() => {
          haptic.selection();
          router.push("/gold-rates");
        }}
        style={({ pressed }) => [styles.manage, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text variant="footnote" weight="600" tone="onVault2">
          Manage rates
        </Text>
        <Icon name="chevronRight" size={11} color="rgba(255,255,255,0.6)" weight="bold" />
      </Pressable>
    </View>
  );
}

function DarkEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 20, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.15)" }}>
      <Icon name="coins" size={20} color="#F3D97A" />
      <Text variant="subhead" weight="600" tone="onVault" style={{ marginTop: 8 }}>
        {title}
      </Text>
      <Text variant="caption1" tone="onVault2" center style={{ marginTop: 2, maxWidth: 240 }}>
        {desc}
      </Text>
    </View>
  );
}

function RecentSales({ d }: { d: D }) {
  const { c } = useTheme();
  const rows = d.invoices.data?.rows ?? [];
  return (
    <Card padded={false} style={{ marginTop: 22 }}>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <CardHeader
          icon="banknote"
          title="Recent sales"
          subtitle={d.invoices.data ? `${d.invoices.data.total.toLocaleString("en-US")} invoices on record` : "Latest invoices"}
          action={{ label: "All", onPress: () => router.push("/sales/invoices") }}
        />
      </View>
      {!d.can("sales:view") ? (
        <EmptyState compact icon="banknote" title="Sales hidden" message="Recent invoices need sales view." />
      ) : d.invoices.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={44} r={10} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState compact icon="banknote" title="No sales yet" message="Invoices from the POS will show up here." />
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
              <View style={[styles.saleRow, { backgroundColor: pressed ? c.fill : "transparent", borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.separator }]}>
                <Avatar name={inv.customer_name ?? "Walk-in"} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="subhead" weight="600" numberOfLines={1}>
                    {inv.customer_name ?? "Walk-in customer"}
                  </Text>
                  <Text variant="caption1" tone="secondary" mono numberOfLines={1}>
                    {inv.number} · {ago(inv.created_at)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 3 }}>
                  <Text variant="subhead" num weight="600">
                    {lkr0(inv.total_cents)}
                  </Text>
                  <StatusPill status={inv.status} size="sm" />
                </View>
              </View>
            )}
          </Pressable>
        ))
      )}
      <View style={{ height: 6 }} />
    </Card>
  );
}

function Attention({ d }: { d: D }) {
  const { c, dark } = useTheme();
  const rows = d.approvals.data?.rows ?? [];
  const total = d.approvals.data?.total ?? 0;
  return (
    <Card style={{ marginTop: 22 }}>
      <CardHeader icon="shield" title="Needs attention" subtitle="Approvals waiting on a decision" action={total > 0 ? { label: `${total} open`, onPress: () => router.push("/approvals") } : undefined} />
      {d.approvals.isLoading ? (
        <View style={{ gap: 8 }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} height={46} r={12} />
          ))}
        </View>
      ) : d.approvals.isError || !d.approvals.data ? (
        <EmptyState compact icon="shield" title="Approvals unavailable" message="Your role can't view the approval queue." />
      ) : rows.length === 0 ? (
        <View style={[styles.allClear, { backgroundColor: dark ? "rgba(48,209,88,0.12)" : "#EAF8EE" }]}>
          <View style={styles.clearIcon}>
            <Icon name="check" size={18} color="#FFFFFF" weight="bold" />
          </View>
          <Text variant="subhead" weight="600">
            All clear
          </Text>
          <Text variant="caption1" tone="secondary">
            No approvals are waiting on you.
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                haptic.selection();
                router.push("/approvals");
              }}
              style={({ pressed }) => [styles.approval, { backgroundColor: "rgba(255,149,0,0.1)", opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, borderCurve: "continuous", backgroundColor: c.orange, marginTop: 6 }} />
              <View style={{ flex: 1 }}>
                <Text variant="subhead" weight="600" numberOfLines={1}>
                  {humanize(a.action)}
                </Text>
                <Text variant="caption1" tone="secondary" numberOfLines={1}>
                  {humanize(a.entity)} · {ago(a.createdAt)}
                </Text>
              </View>
              <Icon name="chevronRight" size={12} color={c.label3} weight="bold" />
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const ACTIONS: { label: string; desc: string; href: string; icon: IconName; perm: string }[] = [
  { label: "New sale", desc: "Open the POS", href: "/pos", icon: "creditCard", perm: "sales:create" },
  { label: "Scan", desc: "Look up a piece", href: "/scanner", icon: "scan", perm: "products:view" },
  { label: "Old gold", desc: "Weigh an intake", href: "/old-gold/intake", icon: "scale", perm: "oldgold:create" },
  { label: "Purchase", desc: "Supplier invoice", href: "/purchases/invoices", icon: "truck", perm: "purchases:view" },
  { label: "Melting", desc: "Batch old gold", href: "/gold/melting", icon: "flask", perm: "gold:view" },
  { label: "Day closing", desc: "Reconcile & lock", href: "/day-closing", icon: "clipboardCheck", perm: "accounts:view" },
  { label: "Catalog", desc: "Pieces & labels", href: "/products", icon: "package", perm: "products:view" },
  { label: "Gold rates", desc: "Publish board", href: "/gold-rates", icon: "coins", perm: "masters:view" },
];

function QuickActions({ d }: { d: D }) {
  const { c } = useTheme();
  const items = ACTIONS.filter((a) => d.can(a.perm));
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: 26 }}>
      <Text variant="title3" style={{ marginHorizontal: GUTTER, marginBottom: 10 }}>
        Quick actions
      </Text>
      <Grid columns={4}>
        {items.map((a) => (
          <Pressable
            key={a.href}
            onPress={() => {
              haptic.light();
              router.push(a.href as Href);
            }}
            style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 6, opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] })}
          >
            <View style={[styles.action, { backgroundColor: c.card }]}>
              <Icon name={a.icon} size={22} color={c.gold} />
            </View>
            <Text variant="caption1" weight="500" center numberOfLines={1}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </Grid>
    </View>
  );
}

function Activity({ d }: { d: D }) {
  const { c } = useTheme();
  const rows = d.audit.data?.rows ?? [];
  return (
    <Card style={{ marginTop: 22 }}>
      <CardHeader icon="history" title="Activity" subtitle="Latest audited changes" action={d.can("audit:view") ? { label: "Audit", onPress: () => router.push("/audit") } : undefined} />
      {!d.can("audit:view") ? (
        <EmptyState compact icon="history" title="Audit hidden" message="The activity feed needs audit view." />
      ) : d.audit.isLoading ? (
        <View style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={36} r={8} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState compact icon="history" title="Quiet so far" message="Changes across the branch will stream in here." />
      ) : (
        <View>
          {rows.map((r, i) => (
            <View key={r.id} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ alignItems: "center", width: 12 }}>
                <View style={{ width: 11, height: 11, borderRadius: 6, borderCurve: "continuous", marginTop: 4, backgroundColor: i === 0 ? c.goldBright : c.fillStrong }} />
                {i < rows.length - 1 ? <View style={{ width: 1.5, flex: 1, backgroundColor: c.hairline, marginVertical: 3 }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: i < rows.length - 1 ? 14 : 0 }}>
                <Text variant="subhead" numberOfLines={1}>
                  <Text variant="subhead" weight="600">
                    {humanize(r.action)}
                  </Text>
                  <Text variant="subhead" tone="secondary">
                    {" "}
                    · {humanize(r.entity)}
                  </Text>
                </Text>
                <Text variant="caption1" tone="tertiary" mono numberOfLines={1}>
                  {r.entity_id.slice(0, 14)} · {ago(r.created_at)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ screen */

export default function DashboardScreen() {
  const { me, can } = useSession();
  const d = useDashboard(me, can);
  const refresh = useRefresh(d.salesToday, d.salesMonth, d.purchasesToday, d.oldGoldToday, d.wip, d.rates, d.invoices, d.approvals, d.audit, ...d.trend);

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Today" }} />
      <PlatformNotices />
      <HeroCard me={me} d={d} />
      <Kpis d={d} />
      <QuickActions d={d} />
      <RevenuePanel d={d} />
      <RatesPanel d={d} />
      <RecentSales d={d} />
      <Attention d={d} />
      <Activity d={d} />
      {!me ? <SkeletonRows /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: GUTTER, marginTop: 8, borderRadius: radius.xxl - 4, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#0C0A09" },
  hairline: { height: 1, position: "absolute", top: 0, left: 0, right: 0 },
  kickerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999, borderCurve: "continuous",
    backgroundColor: "rgba(201,162,39,0.1)",
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.25)",
  },
  glass: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 14,
    borderRadius: 20, borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroBtn: { height: 42, borderRadius: 13, borderCurve: "continuous", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  strip: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderColor: "rgba(255,255,255,0.08)" },
  cellIcon: { width: 28, height: 28, borderRadius: 8, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  rates: { marginHorizontal: GUTTER, marginTop: 22, borderRadius: radius.xl - 2, borderCurve: "continuous", overflow: "hidden", padding: 16, backgroundColor: "#0C0A09" },
  rateIcon: { width: 30, height: 30, borderRadius: 9, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  live: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(48,209,88,0.12)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 , borderCurve: "continuous"},
  rateRow: { backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, borderCurve: "continuous", padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.08)" },
  karat: { backgroundColor: "rgba(201,162,39,0.16)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 , borderCurve: "continuous"},
  rateTrack: { marginTop: 10, height: 4, borderRadius: 2, borderCurve: "continuous", backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  manage: { marginTop: 14, height: 40, borderRadius: 12, borderCurve: "continuous", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  saleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11, marginHorizontal: 0 },
  allClear: { alignItems: "center", paddingVertical: 22, borderRadius: 14, borderCurve: "continuous", gap: 4 },
  clearIcon: { width: 40, height: 40, borderRadius: 20, borderCurve: "continuous", backgroundColor: "#34C759", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  approval: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12 , borderCurve: "continuous"},
  action: { width: 58, height: 58, borderRadius: 18, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
});
