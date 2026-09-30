"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BarList, Page, StatusPill } from "@/components/ui";
import {
  Card,
  CardHead,
  Empty,
  HeadLink,
  ListSkeleton,
  ModuleCard,
  ModuleHero,
  SectionHead,
  StatusBoard,
  ago,
  count,
  grams,
  lkr,
  type BoardState,
  type IconCmp,
} from "@/components/module-dashboard";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  CoinsIcon,
  CreditCardIcon,
  FileTextIcon,
  GemIcon,
  InboxIcon,
  PackagePlusIcon,
  PlusIcon,
  TagsIcon,
  TrendingUpIcon,
  TruckIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ types */

type Summary = { invoices: number; value_cents: number; paid_cents: number; outstanding_cents: number; gold_mg: number };
type Breakdown = { key: string | null; invoices: number; value_cents: number; gold_mg: number };
type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Bill = { id: string; number: string; supplier_name: string; total_cents: number; paid_cents: number; status: string; created_at: number };
type Paged<R> = { rows: R[]; total: number };

type State = BoardState;

/** A purchase order's life: drafted, sent to the supplier, then received into stock. */
const ORDER_STATES: State[] = [
  { status: "DRAFT", label: "Draft", hint: "Being prepared", bar: "bg-gold-light" },
  { status: "SENT", label: "Sent", hint: "Waiting on supplier", bar: "bg-gold" },
  { status: "RECEIVED", label: "Received", hint: "Stock posted", bar: "bg-emerald-500" },
  { status: "CANCELLED", label: "Cancelled", hint: "Withdrawn", bar: "bg-ink-5" },
];

/** Supplier bills by settlement, most urgent first. */
const BILL_STATES: State[] = [
  { status: "UNPAID", label: "Unpaid", hint: "Nothing paid yet", bar: "bg-amber-400" },
  { status: "PARTIAL", label: "Part-paid", hint: "Balance still owed", bar: "bg-gold" },
  { status: "PAID", label: "Paid", hint: "Settled in full", bar: "bg-emerald-500" },
  { status: "VOID", label: "Void", hint: "Cancelled", bar: "bg-ink-5" },
];

const pretty = (k: string | null, fallback: string) =>
  k ? k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : fallback;

function MixCard({
  icon,
  title,
  sub,
  rows,
  loading,
  fallback,
  by,
}: {
  icon: IconCmp;
  title: string;
  sub: string;
  rows: Breakdown[] | undefined;
  loading: boolean;
  fallback: string;
  by: "value" | "gold";
}) {
  const items = (rows ?? [])
    .filter((r) => (by === "gold" ? r.gold_mg : r.value_cents) > 0)
    .slice(0, 5)
    .map((r) => ({
      key: r.key ?? fallback,
      label: pretty(r.key, fallback),
      value: by === "gold" ? r.gold_mg : r.value_cents,
      secondary:
        by === "gold"
          ? `${r.invoices} bill${r.invoices === 1 ? "" : "s"} · ${lkr(r.value_cents)} LKR`
          : `${r.invoices} bill${r.invoices === 1 ? "" : "s"}${r.gold_mg ? ` · ${grams(r.gold_mg)} g` : ""}`,
    }));
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={<HeadLink href="/purchases/reports">Report</HeadLink>} />
      <div className="px-5 pb-5 sm:px-6">
        {loading ? (
          <ListSkeleton />
        ) : (
          <BarList
            tone="light"
            items={items}
            format={(n) => (by === "gold" ? `${grams(n)} g` : `${lkr(n)} LKR`)}
            empty={<Empty icon={icon} title="No purchases yet" desc="Supplier bills posted this month will be broken down here." />}
          />
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function PurchasingDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canCreate = hasPermission(perms, "purchases:create");
  const canSuppliers = hasPermission(perms, "masters:view");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const month = useQuery({ ...opt, queryKey: ["rep-summary", "month"], queryFn: () => api<Summary>("/api/v1/purchases/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["rep-summary", "all"], queryFn: () => api<Summary>("/api/v1/purchases/reports/summary?period=all") });
  const breakdown = (groupBy: string) => ({
    ...opt,
    queryKey: ["rep-breakdown", "month", groupBy],
    queryFn: () => api<Breakdown[]>(`/api/v1/purchases/reports/breakdown?period=month&groupBy=${groupBy}`),
  });
  const bySupplier = useQuery(breakdown("supplier"));
  const byPurity = useQuery(breakdown("purity"));
  const byCategory = useQuery(breakdown("category"));
  const bills = useQuery({ ...opt, queryKey: ["pur-dash", "bills"], queryFn: () => api<Paged<Bill>>("/api/v1/purchases/invoices?limit=6") });
  const suppliers = useQuery({
    ...opt,
    enabled: canSuppliers,
    queryKey: ["pur-dash", "suppliers"],
    queryFn: () => api<Paged<unknown>>("/api/v1/suppliers?limit=1"),
  });

  // Open orders (draft + sent) fetch a few rows for the worklist; the rest only need a count.
  const orderQueries = useQueries({
    queries: ORDER_STATES.map((s) => ({
      ...opt,
      queryKey: ["pur-dash", "order-state", s.status],
      queryFn: () => api<Paged<Order>>(`/api/v1/purchases/orders?status=${s.status}&limit=${s.status === "DRAFT" || s.status === "SENT" ? 6 : 1}`),
    })),
  });
  const billQueries = useQueries({
    queries: BILL_STATES.map((s) => ({
      ...opt,
      queryKey: ["pur-dash", "bill-state", s.status],
      queryFn: () => api<Paged<Bill>>(`/api/v1/purchases/invoices?status=${s.status}&limit=1`),
    })),
  });
  const orderCounts = orderQueries.map((q) => q.data?.total);
  const billCounts = billQueries.map((q) => q.data?.total);
  const ordersLoading = orderQueries.some((q) => q.isLoading);
  const billsLoading = billQueries.some((q) => q.isLoading);
  const openCount = (orderCounts[0] ?? 0) + (orderCounts[1] ?? 0);
  const openBills = (billCounts[0] ?? 0) + (billCounts[1] ?? 0);
  const openOrders = [...(orderQueries[0]?.data?.rows ?? []), ...(orderQueries[1]?.data?.rows ?? [])]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 6);

  const m = month.data;
  const a = allTime.data;

  return (
    <Page>
      <ModuleHero
        kicker="Purchasing"
        title={
          <>
            Buy right, <span className="home-gold-text">pay on time.</span>
          </>
        }
        description="Raise orders to suppliers, receive stock straight into inventory, and keep every supplier bill paid and accounted for."
        actions={
          <>
            {canCreate ? (
              <Link href="/purchases/orders?new=1" className="home-btn-gold h-10 px-4 text-sm">
                <PlusIcon size={15} />
                New order
              </Link>
            ) : null}
            {canCreate ? (
              <Link href="/purchases/invoices?new=1" className="home-btn-ghost h-10 px-4 text-sm">
                <PackagePlusIcon size={15} />
                Record a bill
              </Link>
            ) : null}
            <Link href="/purchases/reports" className="home-btn-ghost h-10 px-4 text-sm">
              <TrendingUpIcon size={15} />
              Reports
            </Link>
          </>
        }
        metrics={[
          { label: "Spend · month", value: m?.value_cents, format: lkr, unit: "LKR", icon: BanknoteIcon, href: "/purchases/reports" },
          { label: "Gold in · month", value: m?.gold_mg, format: grams, unit: "g", icon: GemIcon, href: "/purchases/reports" },
          { label: "Paid · month", value: m?.paid_cents, format: lkr, unit: "LKR", icon: CoinsIcon, href: "/purchases/invoices?status=PAID" },
          { label: "Owed to suppliers", value: a?.outstanding_cents, format: lkr, unit: "LKR", icon: CreditCardIcon, href: "/purchases/invoices?status=UNPAID" },
        ]}
      />

      {/* ------------------------------------------------------- workspaces */}
      <SectionHead index="01" title="Workspaces" sub="Jump into any part of purchasing" />
      <div className={cn("grid gap-4 sm:grid-cols-2", canSuppliers || !me.data ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        <ModuleCard
          href="/purchases/orders"
          index="01"
          icon={FileTextIcon}
          title="Orders"
          description="Draft orders to suppliers, then receive them to post stock and the journal."
          metric={ordersLoading ? "—" : openCount}
          metricLabel="Open orders"
          cta="Manage"
          loading={ordersLoading}
          alert={(orderCounts[1] ?? 0) > 0}
          delay={0}
        />
        <ModuleCard
          href="/purchases/invoices"
          index="02"
          icon={CreditCardIcon}
          title="Invoices"
          description="Supplier bills, direct purchases and the payments made against them."
          metric={billsLoading ? "—" : openBills}
          metricLabel="Bills to pay"
          cta="Pay bills"
          loading={billsLoading}
          alert={openBills > 0}
          delay={60}
        />
        <ModuleCard
          href="/purchases/reports"
          index="03"
          icon={TrendingUpIcon}
          title="Reports"
          description="Spend, gold intake and balances by supplier, purity or category."
          metric={m ? lkr(m.value_cents) : "—"}
          metricLabel="LKR spent this month"
          cta="View reports"
          loading={month.isLoading}
          delay={120}
        />
        {canSuppliers || !me.data ? (
          <ModuleCard
            href="/suppliers"
            index="04"
            icon={TruckIcon}
            title="Suppliers"
            description="The refiners, wholesalers and makers you buy from."
            metric={suppliers.data ? count(suppliers.data.total) : "—"}
            metricLabel="Suppliers on file"
            cta="Open list"
            loading={suppliers.isLoading && canSuppliers}
            delay={180}
          />
        ) : null}
      </div>

      {/* ------------------------------------------------------- pipelines */}
      <SectionHead index="02" title="Orders & payables" sub="Where orders stand, and what is still owed — tap a state to open it" />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusBoard
          icon={FileTextIcon}
          title="Order pipeline"
          sub={ordersLoading ? "Purchase orders by status" : `${openCount} open · ${orderCounts[2] ?? 0} received`}
          action={<HeadLink href="/purchases/orders">All orders</HeadLink>}
          states={ORDER_STATES}
          counts={orderCounts}
          loading={ordersLoading}
          href={(s) => `/purchases/orders?status=${s}`}
        />
        <StatusBoard
          icon={CreditCardIcon}
          title="Supplier bills"
          sub={a ? `${lkr(a.outstanding_cents)} LKR outstanding across ${openBills} bill${openBills === 1 ? "" : "s"}` : "Bills by payment status"}
          action={<HeadLink href="/purchases/invoices">All bills</HeadLink>}
          states={BILL_STATES}
          counts={billCounts}
          loading={billsLoading}
          href={(s) => `/purchases/invoices?status=${s}`}
        />
      </div>

      {/* ---------------------------------------------------- where it goes */}
      <SectionHead index="03" title="Where the money goes" sub="This month's purchases" />
      <div className="grid gap-4 lg:grid-cols-3">
        <MixCard icon={TruckIcon} title="By supplier" sub="Top suppliers by spend" rows={bySupplier.data} loading={bySupplier.isLoading} fallback="Unknown" by="value" />
        <MixCard icon={GemIcon} title="By purity" sub="Gold received" rows={byPurity.data} loading={byPurity.isLoading} fallback="Unspecified" by="gold" />
        <MixCard icon={TagsIcon} title="By category" sub="What you are stocking" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" by="value" />
      </div>

      {/* ---------------------------------------------------------- activity */}
      <SectionHead index="04" title="Worklist" sub="Orders to receive and the latest bills" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHead
            icon={InboxIcon}
            title="Waiting to receive"
            sub={ordersLoading ? "Draft and sent orders" : `${openCount} open order${openCount === 1 ? "" : "s"}`}
            action={<HeadLink href="/purchases/orders?status=SENT">Sent orders</HeadLink>}
          />
          <div className="px-5 pb-5 sm:px-6">
            {ordersLoading ? (
              <ListSkeleton />
            ) : openOrders.length === 0 ? (
              <Empty icon={CheckCircleIcon} title="Nothing on order" desc="Draft a purchase order and it will wait here until it is received." />
            ) : (
              <ul className="space-y-2">
                {openOrders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/purchases/orders?status=${o.status}`}
                      className="group flex items-center gap-3 rounded-xl bg-bone/70 px-3.5 py-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-gold-pale/60 hover:ring-gold-dark/20"
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1",
                          o.status === "SENT" ? "bg-amber-50 text-amber-600 ring-amber-200/70" : "bg-paper text-ink-4 ring-ink/[0.08]"
                        )}
                      >
                        <FileTextIcon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-xs font-semibold text-ink">{o.number}</span>
                          <span className="text-[11px] text-ink-5">{ago(o.created_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {o.supplier_name} · {o.items} item{o.items === 1 ? "" : "s"}
                        </span>
                      </span>
                      <StatusPill status={o.status} />
                      <ArrowRightIcon size={13} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHead icon={CreditCardIcon} title="Latest bills" sub="Most recent supplier invoices" action={<HeadLink href="/purchases/invoices">All bills</HeadLink>} />
          <div className="pb-2">
            {bills.isLoading ? (
              <div className="px-5 pb-4 sm:px-6">
                <ListSkeleton rows={4} className="h-11 rounded-lg" />
              </div>
            ) : (bills.data?.rows ?? []).length === 0 ? (
              <div className="px-5 pb-4 sm:px-6">
                <Empty icon={InboxIcon} title="No bills yet" desc="Receive an order or record a direct purchase to see it here." />
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {(bills.data?.rows ?? []).map((b) => {
                  const due = Math.max(0, b.total_cents - b.paid_cents);
                  return (
                    <li key={b.id}>
                      <Link href={`/purchases/invoices/${b.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="g-metric text-xs font-semibold text-ink group-hover:text-gold-dark">{b.number}</span>
                            <span className="text-[11px] text-ink-5">{ago(b.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-4">
                            {b.supplier_name}
                            {due > 0 && b.status !== "VOID" ? ` · ${lkr(due)} LKR due` : ""}
                          </span>
                        </span>
                        <span className="g-metric shrink-0 text-sm text-ink">{lkr(b.total_cents)}</span>
                        <StatusPill status={b.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
