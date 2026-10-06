import { View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ago, count, gramsShort, lkr0 } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";
import {
  BarList,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ModuleCard,
  ModuleGrid,
  ModuleHero,
  Row,
  Screen,
  Section,
  SectionHeading,
  Skeleton,
  SkeletonRows,
  StatusBoard,
  StatusPill,
  Text,
  useRefresh,
  type IconName,
} from "@/ui";

type Summary = { invoices: number; value_cents: number; discount_cents: number; gold_mg: number };
type Breakdown = { key: string | null; invoices: number; value_cents: number; gold_mg: number };
type Invoice = { id: string; number: string; customer_name: string | null; total_cents: number; paid_cents: number; status: string; created_at: number };
type Return = { id: string; number: string; invoice_id: string; type: string; reason: string; refund_cents: number; status: string; created_at: number };

/** Invoice settlement states, in the order a counter cares about them. */
const STATES = [
  { status: "PAID", label: "Paid", hint: "Settled in full", color: "#34C759" },
  { status: "PARTIAL", label: "Part-paid", hint: "Balance on credit", color: "#C9A227" },
  { status: "UNPAID", label: "Unpaid", hint: "Nothing received yet", color: "#FF9F0A" },
  { status: "VOID", label: "Void", hint: "Cancelled", color: "#A8A29E" },
];

const pretty = (k: string | null, fallback: string) => (k ? k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()) : fallback);

function MixCard({ icon, title, subtitle, rows, loading, fallback }: { icon: IconName; title: string; subtitle: string; rows: Breakdown[] | undefined; loading: boolean; fallback: string }) {
  const items = (rows ?? [])
    .filter((r) => r.value_cents > 0)
    .slice(0, 5)
    .map((r) => ({
      label: pretty(r.key, fallback),
      value: r.value_cents,
      sub: `${r.invoices} invoice${r.invoices === 1 ? "" : "s"}${r.gold_mg ? ` · ${gramsShort(r.gold_mg)} g` : ""}`,
    }));
  return (
    <Card style={{ marginTop: 12 }}>
      <CardHeader icon={icon} title={title} subtitle={subtitle} action={{ label: "Report", onPress: () => router.push("/sales/reports") }} />
      {loading ? (
        <View style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={30} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState compact icon={icon} title="No sales yet" message="Invoices posted this month will be broken down here." />
      ) : (
        <BarList items={items} format={(n) => `${lkr0(n)} LKR`} />
      )}
    </Card>
  );
}

export default function SalesDashboardScreen() {
  const { c } = useTheme();
  const { can, me } = useSession();
  const canSell = can("sales:create");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const today = useQuery({ ...opt, queryKey: ["sales-summary", "today"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=today") });
  const month = useQuery({ ...opt, queryKey: ["sales-summary", "month"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=month") });
  const breakdown = (groupBy: string) => ({
    ...opt,
    queryKey: ["sales-breakdown", "month", groupBy],
    queryFn: () => api<Breakdown[]>(`/api/v1/sales/reports/breakdown?period=month&groupBy=${groupBy}`),
  });
  const byCategory = useQuery(breakdown("category"));
  const byPayment = useQuery(breakdown("payment"));
  const bySalesperson = useQuery(breakdown("salesperson"));
  const recent = useQuery({ ...opt, queryKey: ["sales-dash", "recent"], queryFn: () => api<{ rows: Invoice[]; total: number }>("/api/v1/sales/invoices?limit=6") });
  const returns = useQuery({ ...opt, queryKey: ["sales-dash", "returns"], queryFn: () => api<{ rows: Return[]; total: number }>("/api/v1/sales/returns?limit=5") });

  // Counts per settlement state; the credit states also fetch rows so the open
  // balance can be summed (up to the API's 100-row page).
  const stateQueries = useQueries({
    queries: STATES.map((s) => {
      const credit = s.status === "PARTIAL" || s.status === "UNPAID";
      return {
        ...opt,
        queryKey: ["sales-dash", "state", s.status],
        queryFn: () => api<{ rows: Invoice[]; total: number }>(`/api/v1/sales/invoices?status=${s.status}&limit=${credit ? 100 : 1}`),
      };
    }),
  });
  const counts = stateQueries.map((q) => q.data?.total);
  const statesLoading = stateQueries.some((q) => q.isLoading);
  const creditRows = stateQueries.slice(1, 3).flatMap((q) => q.data?.rows ?? []);
  const creditCount = (counts[1] ?? 0) + (counts[2] ?? 0);
  const owed = creditRows.reduce((s, r) => s + Math.max(0, r.total_cents - r.paid_cents), 0);
  const owedPartial = creditRows.length < creditCount;

  const refresh = useRefresh(today, month, byCategory, byPayment, bySalesperson, recent, returns, ...stateQueries);

  const t = today.data;
  const m = month.data;
  const avgTicket = t && t.invoices > 0 ? t.value_cents / t.invoices : undefined;

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Sales" }} />
      <ModuleHero
        kicker="Sales"
        title="Every piece, sold with proof."
        description="Ring up sales at the counter, keep an eye on credit, handle returns and see what is selling."
        actions={
          <>
            {canSell ? <Button title="Open POS" icon="scan" onPress={() => router.push("/pos")} /> : null}
            <Button title="Invoices" icon="creditCard" variant="glass" onPress={() => router.push("/sales/invoices")} />
            <Button title="Returns" icon="return" variant="glass" onPress={() => router.push("/sales/returns")} />
          </>
        }
        metrics={[
          { label: "Sales today", value: t?.value_cents, format: lkr0, unit: "LKR", href: "/sales/reports" },
          { label: "Invoices today", value: t?.invoices, format: count, unit: "sales", href: "/sales/invoices" },
          { label: "Sales · month", value: m?.value_cents, format: lkr0, unit: "LKR", href: "/sales/reports" },
          { label: "Gold out · month", value: m?.gold_mg, format: gramsShort, unit: "g", href: "/sales/reports" },
        ]}
      />

      <SectionHeading index="01" title="Workspaces" subtitle="Jump into any part of the sales desk" />
      <ModuleGrid>
        {[
          canSell || !me ? (
            <ModuleCard key="pos" href="/pos" icon="scan" title="Point of sale" description="Scan pieces, apply discounts, split payments and print the invoice." metric={t ? t.invoices : "—"} metricLabel="Sales rung up today" loading={today.isLoading} />
          ) : null,
          <ModuleCard
            key="inv"
            href="/sales/invoices"
            icon="creditCard"
            title="Invoices"
            description="Every completed sale, with payments, lines and the linked pieces."
            metric={recent.data ? count(recent.data.total) : "—"}
            metricLabel="Invoices on file"
            loading={recent.isLoading}
            alert={creditCount > 0}
          />,
          <ModuleCard key="ret" href="/sales/returns" icon="return" title="Returns" description="Refunds and exchanges, with the gold movement reversed." metric={returns.data ? count(returns.data.total) : "—"} metricLabel="Returns recorded" loading={returns.isLoading} />,
          <ModuleCard key="rep" href="/sales/reports" icon="trendUp" title="Reports" description="Sales by category, purity, branch, salesperson, payment or product." metric={m ? lkr0(m.value_cents) : "—"} metricLabel="LKR sold this month" loading={month.isLoading} />,
        ]}
      </ModuleGrid>

      <SectionHeading index="02" title="Collections" subtitle="How invoices stand on payment — tap a state to see them" />
      <Section>
        <Row
          icon="wallet"
          iconColor={c.orange}
          title="Owed on credit"
          subtitle={creditCount > 0 ? `Across ${creditCount} open invoice${creditCount === 1 ? "" : "s"}` : "No open balances"}
          value={statesLoading ? "—" : `${lkr0(owed)}${owedPartial ? "+" : ""} LKR`}
          valueTone="label"
        />
        <Row
          icon="receipt"
          iconColor={c.blue}
          title="Average sale today"
          subtitle={t ? `${t.invoices} sale${t.invoices === 1 ? "" : "s"} so far` : "Per invoice"}
          value={avgTicket === undefined ? "—" : `${lkr0(avgTicket)} LKR`}
          valueTone="label"
        />
        <Row
          icon="percent"
          iconColor={c.purple}
          title="Discounts · month"
          subtitle={m && m.value_cents > 0 ? `${((m.discount_cents / (m.value_cents + m.discount_cents)) * 100).toFixed(1)}% of list price` : "Given at the counter"}
          value={m ? `${lkr0(m.discount_cents)} LKR` : "—"}
          valueTone="label"
        />
      </Section>
      <StatusBoard
        title="Settlement"
        subtitle="Invoices by payment state"
        icon="creditCard"
        states={STATES}
        counts={counts}
        loading={statesLoading}
        href={(s) => `/sales/invoices?status=${s}`}
      />

      <SectionHeading index="03" title="What's selling" subtitle="This month, by value" />
      <MixCard icon="tag" title="By category" subtitle="Top categories" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" />
      <MixCard icon="coins" title="By payment" subtitle="How customers pay" rows={byPayment.data} loading={byPayment.isLoading} fallback="Unrecorded" />
      <MixCard icon="people" title="By salesperson" subtitle="Who is selling" rows={bySalesperson.data} loading={bySalesperson.isLoading} fallback="Unassigned" />

      <SectionHeading index="04" title="Recent activity" subtitle="The latest sales and returns at the counter" />
      {recent.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (recent.data?.rows ?? []).length === 0 ? (
        <EmptyState compact icon="inbox" title="No sales yet" message="Ring up your first sale from the POS and it will show here." />
      ) : (
        <Section title="Latest invoices" action={{ label: "All invoices", onPress: () => router.push("/sales/invoices") }}>
          {(recent.data?.rows ?? []).map((r) => {
            const due = Math.max(0, r.total_cents - r.paid_cents);
            return (
              <Row
                key={r.id}
                href={`/sales/invoices/${r.id}` as Href}
                title={
                  <Text variant="body" mono weight="600" numberOfLines={1}>
                    {r.number}
                  </Text>
                }
                subtitle={`${r.customer_name ?? "Walk-in"}${due > 0 && r.status !== "VOID" ? ` · ${lkr0(due)} LKR due` : ""} · ${ago(r.created_at)}`}
                right={
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Text variant="subhead" num weight="600">
                      {lkr0(r.total_cents)}
                    </Text>
                    <StatusPill status={r.status} size="sm" />
                  </View>
                }
              />
            );
          })}
        </Section>
      )}
      <Section
        title={returns.data ? `Latest returns · ${returns.data.total} on the register` : "Latest returns"}
        action={{ label: "Register", onPress: () => router.push("/sales/returns") }}
      >
        {returns.isLoading ? (
          <View style={{ padding: 16 }}>
            <Skeleton height={40} />
          </View>
        ) : (returns.data?.rows ?? []).length === 0 ? (
          <EmptyState compact icon="checkCircle" title="No returns" message="Returns recorded against an invoice will appear here." />
        ) : (
          (returns.data?.rows ?? []).map((r) => (
            <Row
              key={r.id}
              icon="return"
              iconColor={c.teal}
              href={`/sales/invoices/${r.invoice_id}` as Href}
              title={
                <Text variant="body" mono weight="600" numberOfLines={1}>
                  {r.number}
                </Text>
              }
              subtitle={`${pretty(r.type, "Return")} · ${r.reason} · ${ago(r.created_at)}`}
              value={lkr0(r.refund_cents)}
              valueTone="label"
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
