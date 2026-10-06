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

type Summary = { invoices: number; value_cents: number; paid_cents: number; outstanding_cents: number; gold_mg: number };
type Breakdown = { key: string | null; invoices: number; value_cents: number; gold_mg: number };
type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Bill = { id: string; number: string; supplier_name: string; total_cents: number; paid_cents: number; status: string; created_at: number };
type Paged<R> = { rows: R[]; total: number };

/** A purchase order's life: drafted, sent to the supplier, then received into stock. */
const ORDER_STATES = [
  { status: "DRAFT", label: "Draft", hint: "Being prepared", color: "#E7C65A" },
  { status: "SENT", label: "Sent", hint: "Waiting on supplier", color: "#C9A227" },
  { status: "RECEIVED", label: "Received", hint: "Stock posted", color: "#34C759" },
  { status: "CANCELLED", label: "Cancelled", hint: "Withdrawn", color: "#A8A29E" },
];
/** Supplier bills by settlement, most urgent first. */
const BILL_STATES = [
  { status: "UNPAID", label: "Unpaid", hint: "Nothing paid yet", color: "#FF9F0A" },
  { status: "PARTIAL", label: "Part-paid", hint: "Balance still owed", color: "#C9A227" },
  { status: "PAID", label: "Paid", hint: "Settled in full", color: "#34C759" },
  { status: "VOID", label: "Void", hint: "Cancelled", color: "#A8A29E" },
];

const pretty = (k: string | null, fallback: string) => (k ? k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()) : fallback);

function MixCard({ icon, title, subtitle, rows, loading, fallback, by }: { icon: IconName; title: string; subtitle: string; rows: Breakdown[] | undefined; loading: boolean; fallback: string; by: "value" | "gold" }) {
  const items = (rows ?? [])
    .filter((r) => (by === "gold" ? r.gold_mg : r.value_cents) > 0)
    .slice(0, 5)
    .map((r) => ({
      label: pretty(r.key, fallback),
      value: by === "gold" ? r.gold_mg : r.value_cents,
      sub: by === "gold" ? `${r.invoices} bill${r.invoices === 1 ? "" : "s"} · ${lkr0(r.value_cents)} LKR` : `${r.invoices} bill${r.invoices === 1 ? "" : "s"}${r.gold_mg ? ` · ${gramsShort(r.gold_mg)} g` : ""}`,
    }));
  return (
    <Card style={{ marginTop: 12 }}>
      <CardHeader icon={icon} title={title} subtitle={subtitle} action={{ label: "Report", onPress: () => router.push("/purchases/reports" as Href) }} />
      {loading ? (
        <View style={{ gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={30} />
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState compact icon={icon} title="No purchases yet" message="Supplier bills posted this month will be broken down here." />
      ) : (
        <BarList items={items} format={(n) => (by === "gold" ? `${gramsShort(n)} g` : `${lkr0(n)} LKR`)} />
      )}
    </Card>
  );
}

export default function PurchasesDashboardScreen() {
  const { c } = useTheme();
  const { can, me } = useSession();
  const canCreate = can("purchases:create");
  const canSuppliers = can("masters:view");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const month = useQuery({ ...opt, queryKey: ["rep-summary", "month"], queryFn: () => api<Summary>("/api/v1/purchases/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["rep-summary", "all"], queryFn: () => api<Summary>("/api/v1/purchases/reports/summary?period=all") });
  const breakdown = (groupBy: string) => ({ ...opt, queryKey: ["rep-breakdown", "month", groupBy], queryFn: () => api<Breakdown[]>(`/api/v1/purchases/reports/breakdown?period=month&groupBy=${groupBy}`) });
  const bySupplier = useQuery(breakdown("supplier"));
  const byPurity = useQuery(breakdown("purity"));
  const byCategory = useQuery(breakdown("category"));
  const bills = useQuery({ ...opt, queryKey: ["pur-dash", "bills"], queryFn: () => api<Paged<Bill>>("/api/v1/purchases/invoices?limit=6") });
  const suppliers = useQuery({ ...opt, enabled: canSuppliers, queryKey: ["pur-dash", "suppliers"], queryFn: () => api<Paged<unknown>>("/api/v1/suppliers?limit=1") });
  const orderQueries = useQueries({
    queries: ORDER_STATES.map((s) => ({
      ...opt,
      queryKey: ["pur-dash", "order-state", s.status],
      queryFn: () => api<Paged<Order>>(`/api/v1/purchases/orders?status=${s.status}&limit=${s.status === "DRAFT" || s.status === "SENT" ? 6 : 1}`),
    })),
  });
  const billQueries = useQueries({
    queries: BILL_STATES.map((s) => ({ ...opt, queryKey: ["pur-dash", "bill-state", s.status], queryFn: () => api<Paged<Bill>>(`/api/v1/purchases/invoices?status=${s.status}&limit=1`) })),
  });
  const refresh = useRefresh(month, allTime, bySupplier, byPurity, byCategory, bills, suppliers, ...orderQueries, ...billQueries);

  const orderCounts = orderQueries.map((q) => q.data?.total);
  const billCounts = billQueries.map((q) => q.data?.total);
  const ordersLoading = orderQueries.some((q) => q.isLoading);
  const billsLoading = billQueries.some((q) => q.isLoading);
  const openCount = (orderCounts[0] ?? 0) + (orderCounts[1] ?? 0);
  const openBills = (billCounts[0] ?? 0) + (billCounts[1] ?? 0);
  const openOrders = [...(orderQueries[0]?.data?.rows ?? []), ...(orderQueries[1]?.data?.rows ?? [])].sort((a, b) => b.created_at - a.created_at).slice(0, 6);
  const m = month.data;
  const a = allTime.data;

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Purchasing" }} />
      <ModuleHero
        kicker="Purchasing"
        title="Buy right, pay on time."
        description="Raise orders to suppliers, receive stock straight into inventory, and keep every supplier bill paid and accounted for."
        actions={
          <>
            {canCreate ? <Button title="New order" icon="plus" onPress={() => router.push("/purchases/orders?new=1" as Href)} /> : null}
            {canCreate ? <Button title="Record a bill" icon="package" variant="glass" onPress={() => router.push("/purchases/invoices?new=1" as Href)} /> : null}
            <Button title="Reports" icon="trendUp" variant="glass" onPress={() => router.push("/purchases/reports" as Href)} />
          </>
        }
        metrics={[
          { label: "Spend · month", value: m?.value_cents, format: lkr0, unit: "LKR", href: "/purchases/reports" },
          { label: "Gold in · month", value: m?.gold_mg, format: gramsShort, unit: "g", href: "/purchases/reports" },
          { label: "Paid · month", value: m?.paid_cents, format: lkr0, unit: "LKR", href: "/purchases/invoices?status=PAID" },
          { label: "Owed to suppliers", value: a?.outstanding_cents, format: lkr0, unit: "LKR", href: "/purchases/invoices?status=UNPAID" },
        ]}
      />

      <SectionHeading index="01" title="Workspaces" subtitle="Jump into any part of purchasing" />
      <ModuleGrid>
        {[
          <ModuleCard key="o" href="/purchases/orders" icon="document" title="Orders" description="Draft orders to suppliers, then receive them to post stock and the journal." metric={ordersLoading ? "—" : openCount} metricLabel="Open orders" loading={ordersLoading} alert={(orderCounts[1] ?? 0) > 0} />,
          <ModuleCard key="i" href="/purchases/invoices" icon="creditCard" title="Invoices" description="Supplier bills, direct purchases and the payments made against them." metric={billsLoading ? "—" : openBills} metricLabel="Bills to pay" loading={billsLoading} alert={openBills > 0} />,
          <ModuleCard key="r" href="/purchases/reports" icon="trendUp" title="Reports" description="Spend, gold intake and balances by supplier, purity or category." metric={m ? lkr0(m.value_cents) : "—"} metricLabel="LKR spent this month" loading={month.isLoading} />,
          canSuppliers || !me ? (
            <ModuleCard key="s" href="/suppliers" icon="truck" title="Suppliers" description="The refiners, wholesalers and makers you buy from." metric={suppliers.data ? count(suppliers.data.total) : "—"} metricLabel="Suppliers on file" loading={suppliers.isLoading && canSuppliers} />
          ) : null,
        ]}
      </ModuleGrid>

      <SectionHeading index="02" title="Orders & payables" subtitle="Where orders stand, and what is still owed — tap a state to open it" />
      <StatusBoard
        title="Order pipeline"
        subtitle={ordersLoading ? "Purchase orders by status" : `${openCount} open · ${orderCounts[2] ?? 0} received`}
        icon="document"
        states={ORDER_STATES}
        counts={orderCounts}
        loading={ordersLoading}
        href={(s) => `/purchases/orders?status=${s}`}
        action={{ label: "All orders", onPress: () => router.push("/purchases/orders" as Href) }}
      />
      <StatusBoard
        title="Supplier bills"
        subtitle={a ? `${lkr0(a.outstanding_cents)} LKR outstanding across ${openBills} bill${openBills === 1 ? "" : "s"}` : "Bills by payment status"}
        icon="creditCard"
        states={BILL_STATES}
        counts={billCounts}
        loading={billsLoading}
        href={(s) => `/purchases/invoices?status=${s}`}
        action={{ label: "All bills", onPress: () => router.push("/purchases/invoices" as Href) }}
      />

      <SectionHeading index="03" title="Where the money goes" subtitle="This month's purchases" />
      <MixCard icon="truck" title="By supplier" subtitle="Top suppliers by spend" rows={bySupplier.data} loading={bySupplier.isLoading} fallback="Unknown" by="value" />
      <MixCard icon="gem" title="By purity" subtitle="Gold received" rows={byPurity.data} loading={byPurity.isLoading} fallback="Unspecified" by="gold" />
      <MixCard icon="tags" title="By category" subtitle="What you are stocking" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" by="value" />

      <SectionHeading index="04" title="Worklist" subtitle="Orders to receive and the latest bills" />
      <Section title={ordersLoading ? "Waiting to receive" : `Waiting to receive · ${openCount} open`} action={{ label: "Sent orders", onPress: () => router.push("/purchases/orders?status=SENT" as Href) }}>
        {ordersLoading ? (
          <SkeletonRows rows={3} />
        ) : openOrders.length === 0 ? (
          <EmptyState compact icon="checkCircle" title="Nothing on order" message="Draft a purchase order and it will wait here until it is received." />
        ) : (
          openOrders.map((o) => (
            <Row
              key={o.id}
              icon="document"
              iconColor={o.status === "SENT" ? c.orange : c.gray}
              href={`/purchases/orders?status=${o.status}` as Href}
              title={
                <Text variant="body" mono weight="600">
                  {o.number}
                </Text>
              }
              subtitle={`${o.supplier_name} · ${o.items} item${o.items === 1 ? "" : "s"} · ${ago(o.created_at)}`}
              right={<StatusPill status={o.status} size="sm" />}
            />
          ))
        )}
      </Section>
      <Section title="Latest bills" action={{ label: "All bills", onPress: () => router.push("/purchases/invoices" as Href) }}>
        {bills.isLoading ? (
          <SkeletonRows rows={4} />
        ) : (bills.data?.rows ?? []).length === 0 ? (
          <EmptyState compact icon="inbox" title="No bills yet" message="Receive an order or record a direct purchase to see it here." />
        ) : (
          (bills.data?.rows ?? []).map((b) => {
            const due = Math.max(0, b.total_cents - b.paid_cents);
            return (
              <Row
                key={b.id}
                href={`/purchases/invoices/${b.id}` as Href}
                title={
                  <Text variant="body" mono weight="600">
                    {b.number}
                  </Text>
                }
                subtitle={`${b.supplier_name}${due > 0 && b.status !== "VOID" ? ` · ${lkr0(due)} LKR due` : ""} · ${ago(b.created_at)}`}
                right={
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Text variant="subhead" num weight="600">
                      {lkr0(b.total_cents)}
                    </Text>
                    <StatusPill status={b.status} size="sm" />
                  </View>
                }
              />
            );
          })
        )}
      </Section>
    </Screen>
  );
}
