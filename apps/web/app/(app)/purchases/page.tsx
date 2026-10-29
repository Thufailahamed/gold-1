"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
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
import {
  BILL_META,
  BILL_STATUSES,
  BillChip,
  Card,
  CardHead,
  Empty,
  GoldHero,
  HeadLink,
  HeroBadge,
  ORDER_META,
  ORDER_STATUSES,
  PoChip,
  RowsSkeleton,
  ShareBar,
  ago,
  count,
  grams,
  heroGhost,
  heroGold,
  lkr,
  pretty,
  th,
  thead,
  tr,
  type IconCmp,
} from "./kit";

/* ------------------------------------------------------------------ types */

type Summary = { invoices: number; value_cents: number; paid_cents: number; outstanding_cents: number; gold_mg: number };
type Breakdown = { key: string | null; invoices: number; value_cents: number; gold_mg: number };
type Order = { id: string; number: string; supplier_name: string; status: string; items: number; created_at: number };
type Bill = { id: string; number: string; supplier_name: string; total_cents: number; paid_cents: number; status: string; created_at: number };
type Paged<R> = { rows: R[]; total: number };

/** One state row in a pipeline panel. */
function Pipeline({
  states,
  meta,
  counts,
  loading,
  href,
}: {
  states: readonly string[];
  meta: Record<string, { label: string; hint: string; dot: string }>;
  counts: (number | undefined)[];
  loading: boolean;
  href: (s: string) => string;
}) {
  const max = Math.max(1, ...counts.map((c) => c ?? 0));
  return (
    <ul className="flex-1 divide-y divide-ink/[0.05]">
      {states.map((s, i) => {
        const c = counts[i];
        const m = meta[s]!;
        return (
          <li key={s}>
            <Link href={href(s)} className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gold-pale/40">
              <span className={cn("size-2 shrink-0 rounded-full", m.dot)} />
              <span className="w-24 shrink-0 leading-tight">
                <span className="block text-[12px] font-semibold text-ink group-hover:text-gold-dark">{m.label}</span>
                <span className="block truncate text-[10px] text-ink-5">{m.hint}</span>
              </span>
              <span className="min-w-0 flex-1">
                <ShareBar value={((c ?? 0) / max) * 100} color={m.dot} />
              </span>
              <span className="g-metric w-8 text-right text-[15px] text-ink">{loading ? "…" : c ?? "—"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Breakdown of this month's purchases one way. */
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
  const items = (rows ?? []).filter((r) => (by === "gold" ? r.gold_mg : r.value_cents) > 0).slice(0, 6);
  const total = items.reduce((n, r) => n + (by === "gold" ? r.gold_mg : r.value_cents), 0);
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={<HeadLink href="/purchases/reports">Report</HeadLink>} />
      {loading ? (
        <RowsSkeleton />
      ) : items.length === 0 ? (
        <Empty icon={icon} title="No purchases yet" desc="Supplier bills posted this month will be broken down here." />
      ) : (
        <ul className="space-y-2 p-4">
          {items.map((r) => {
            const v = by === "gold" ? r.gold_mg : r.value_cents;
            const share = total ? (v / total) * 100 : 0;
            return (
              <li key={r.key ?? fallback}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate font-semibold text-ink">{r.key ? pretty(r.key) : fallback}</span>
                  <span className="g-metric shrink-0 text-ink">
                    {by === "gold" ? `${grams(v)} g` : lkr(v)} <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                  </span>
                </div>
                <ShareBar value={share} className="mt-1" />
                <div className="mt-0.5 text-[10px] text-ink-5">
                  {r.invoices} bill{r.invoices === 1 ? "" : "s"}
                  {by === "gold" ? ` · ${lkr(r.value_cents)} LKR` : r.gold_mg ? ` · ${grams(r.gold_mg)} g` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}
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
  const bills = useQuery({ ...opt, queryKey: ["pur-dash", "bills", 8], queryFn: () => api<Paged<Bill>>("/api/v1/purchases/invoices?limit=8") });
  const suppliers = useQuery({
    ...opt,
    enabled: canSuppliers,
    queryKey: ["pur-dash", "suppliers"],
    queryFn: () => api<Paged<unknown>>("/api/v1/suppliers?limit=1"),
  });

  // Open orders (draft + sent) fetch a few rows for the worklist; the rest only need a count.
  const orderQueries = useQueries({
    queries: ORDER_STATUSES.map((s) => ({
      ...opt,
      queryKey: ["pur-dash", "order-state", s],
      queryFn: () => api<Paged<Order>>(`/api/v1/purchases/orders?status=${s}&limit=${s === "DRAFT" || s === "SENT" ? 6 : 1}`),
    })),
  });
  const billQueries = useQueries({
    queries: BILL_STATUSES.map((s) => ({
      ...opt,
      queryKey: ["pur-dash", "bill-state", s],
      queryFn: () => api<Paged<Bill>>(`/api/v1/purchases/invoices?status=${s}&limit=1`),
    })),
  });
  const orderCounts = orderQueries.map((q) => q.data?.total);
  const billCounts = billQueries.map((q) => q.data?.total);
  const ordersLoading = orderQueries.some((q) => q.isLoading);
  const billsLoading = billQueries.some((q) => q.isLoading);
  const sent = orderCounts[1] ?? 0;
  const openCount = (orderCounts[0] ?? 0) + sent;
  const openBills = (billCounts[0] ?? 0) + (billCounts[1] ?? 0);
  const openOrders = [...(orderQueries[0]?.data?.rows ?? []), ...(orderQueries[1]?.data?.rows ?? [])]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 6);

  const m = month.data;
  const a = allTime.data;
  const paidPct = m && m.value_cents ? Math.min(100, (m.paid_cents / m.value_cents) * 100) : undefined;
  const avgBill = m && m.invoices ? m.value_cents / m.invoices : undefined;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={TruckIcon}
        title="Purchasing"
        accent="desk"
        badge={
          openBills > 0 ? (
            <HeroBadge tone="warn">
              {openBills} bill{openBills === 1 ? "" : "s"} to pay
            </HeroBadge>
          ) : (
            <HeroBadge tone="good">All bills settled</HeroBadge>
          )
        }
        sub={
          <>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · raise orders, receive stock, pay every
            supplier on time
          </>
        }
        actions={
          <>
            {canCreate ? (
              <Link href="/purchases/orders?new=1" className={heroGold}>
                <PlusIcon size={13} />
                New order
              </Link>
            ) : null}
            {canCreate ? (
              <Link href="/purchases/invoices?new=1" className={heroGhost}>
                <PackagePlusIcon size={13} />
                Record a bill
              </Link>
            ) : null}
            {canSuppliers ? (
              <Link href="/suppliers" className={heroGhost}>
                <TruckIcon size={13} />
                Suppliers
              </Link>
            ) : null}
            <Link href="/purchases/reports" className={heroGhost}>
              <TrendingUpIcon size={13} />
              Reports
            </Link>
          </>
        }
        stats={[
          {
            label: "Owed to suppliers",
            value: a?.outstanding_cents,
            format: lkr,
            unit: "LKR",
            accent: true,
            href: "/purchases/invoices?status=UNPAID",
            loading: allTime.isLoading,
            sub: openBills ? `${openBills} open bill${openBills === 1 ? "" : "s"}` : "Every bill settled",
          },
          { label: "Spend · month", value: m?.value_cents, format: lkr, unit: "LKR", href: "/purchases/reports", loading: month.isLoading, sub: m ? `${m.invoices} bill${m.invoices === 1 ? "" : "s"}` : undefined },
          {
            label: "Paid · month",
            value: m?.paid_cents,
            format: lkr,
            unit: "LKR",
            tone: "good",
            href: "/purchases/invoices?status=PAID",
            loading: month.isLoading,
            sub: paidPct !== undefined ? `${paidPct.toFixed(0)}% of spend` : "Of this month's bills",
          },
          { label: "Gold in · month", value: m?.gold_mg, format: grams, unit: "g", href: "/purchases/reports", loading: month.isLoading, sub: "Received fine weight" },
          { label: "Avg bill · month", value: avgBill, format: lkr, unit: "LKR", loading: month.isLoading, sub: "Spend ÷ bills" },
          { label: "Open orders", value: ordersLoading ? undefined : openCount, href: "/purchases/orders", loading: ordersLoading, sub: `${orderCounts[0] ?? 0} draft · ${sent} sent` },
          { label: "With supplier", value: ordersLoading ? undefined : sent, tone: sent ? "warn" : undefined, href: "/purchases/orders?status=SENT", loading: ordersLoading, sub: "Waiting to receive" },
          canSuppliers
            ? { label: "Suppliers", value: suppliers.data?.total, href: "/suppliers", loading: suppliers.isLoading, sub: "On file" }
            : { label: "Spend · all time", value: a?.value_cents, format: lkr, unit: "LKR", loading: allTime.isLoading, sub: a ? `${a.invoices} bills` : undefined },
        ]}
      />

      {/* --------------------------------------------- worklists */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-5">
          <CardHead
            icon={InboxIcon}
            title="Waiting to receive"
            sub={ordersLoading ? "Draft and sent orders" : `${openCount} open order${openCount === 1 ? "" : "s"}`}
            action={
              <>
                {canCreate ? (
                  <Link href="/purchases/orders?new=1" className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light hover:bg-void/90">
                    <PlusIcon size={11} /> New
                  </Link>
                ) : null}
                <HeadLink href="/purchases/orders">Orders</HeadLink>
              </>
            }
          />
          {ordersLoading ? (
            <RowsSkeleton />
          ) : openOrders.length === 0 ? (
            <Empty icon={CheckCircleIcon} title="Nothing on order" desc="Draft a purchase order and it will wait here until it is received." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Order</th>
                  <th className={th}>Supplier</th>
                  <th className={cn(th, "text-right")}>Items</th>
                  <th className={cn(th, "pr-4 text-right")}>Status</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => (
                  <tr key={o.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                      <Link href={`/purchases/orders?status=${o.status}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {o.number}
                      </Link>
                      <span className="ml-1.5 text-[10px] text-ink-5">{ago(o.created_at)}</span>
                    </td>
                    <td className="max-w-[160px] truncate px-2 text-ink-3">{o.supplier_name}</td>
                    <td className="g-metric px-2 text-right text-ink-3">{o.items}</td>
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      <PoChip status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="xl:col-span-7">
          <CardHead
            icon={CreditCardIcon}
            title="Latest bills"
            sub={bills.data ? `${count(bills.data.total)} on file · most recent supplier invoices` : "Most recent supplier invoices"}
            action={<HeadLink href="/purchases/invoices">All bills</HeadLink>}
          />
          {bills.isLoading ? (
            <RowsSkeleton />
          ) : (bills.data?.rows ?? []).length === 0 ? (
            <Empty icon={InboxIcon} title="No bills yet" desc="Receive an order or record a direct purchase to see it here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Bill</th>
                    <th className={th}>Supplier</th>
                    <th className={cn(th, "text-right")}>Total LKR</th>
                    <th className={cn(th, "text-right")}>Due LKR</th>
                    <th className={cn(th, "pr-4 text-right")}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(bills.data?.rows ?? []).map((b) => {
                    const due = b.status === "VOID" ? 0 : Math.max(0, b.total_cents - b.paid_cents);
                    return (
                      <tr key={b.id} className={cn(tr, b.status === "VOID" && "opacity-60")}>
                        <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                          <Link href={`/purchases/invoices/${b.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                            {b.number}
                          </Link>
                          <span className="ml-1.5 text-[10px] text-ink-5">{ago(b.created_at)}</span>
                        </td>
                        <td className="max-w-[180px] truncate px-2 text-ink-3">{b.supplier_name}</td>
                        <td className="g-metric px-2 text-right text-ink">{lkr(b.total_cents)}</td>
                        <td className={cn("g-metric px-2 text-right", due > 0 ? "font-semibold text-amber-700" : "text-ink-6")}>{due > 0 ? lkr(due) : "—"}</td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          <BillChip status={b.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* --------------------------------------------- pipelines + payables */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHead
            icon={FileTextIcon}
            title="Order pipeline"
            sub={ordersLoading ? "Purchase orders by status" : `${openCount} open · ${orderCounts[2] ?? 0} received`}
            action={<HeadLink href="/purchases/orders">All</HeadLink>}
          />
          <Pipeline states={ORDER_STATUSES} meta={ORDER_META} counts={orderCounts} loading={ordersLoading} href={(s) => `/purchases/orders?status=${s}`} />
        </Card>
        <Card>
          <CardHead
            icon={CreditCardIcon}
            title="Supplier bills"
            sub={a ? `${lkr(a.outstanding_cents)} LKR outstanding` : "Bills by payment status"}
            action={<HeadLink href="/purchases/invoices">All</HeadLink>}
          />
          <Pipeline states={BILL_STATUSES} meta={BILL_META} counts={billCounts} loading={billsLoading} href={(s) => `/purchases/invoices?status=${s}`} />
        </Card>
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHead icon={CreditCardIcon} title="Payables" sub="What this month's spend has cost in cash so far" />
          <div className="flex-1 space-y-3 p-4">
            {month.isLoading || allTime.isLoading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : (
              <>
                <div>
                  <div className="flex items-baseline justify-between text-[11px] text-ink-4">
                    <span>Paid of this month&apos;s spend</span>
                    <span className="g-metric text-ink">{paidPct !== undefined ? `${paidPct.toFixed(0)}%` : "—"}</span>
                  </div>
                  <ShareBar value={paidPct ?? 0} className="mt-1.5 h-2" color="bg-gradient-to-r from-emerald-700 to-emerald-400" />
                  <p className="g-metric mt-1 text-[10.5px] text-ink-5">
                    {lkr(m?.paid_cents ?? 0)} of {lkr(m?.value_cents ?? 0)} LKR
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-ink/[0.06] text-center">
                  {[
                    ["Owed now", a ? `${lkr(a.outstanding_cents)}` : "—", a && a.outstanding_cents > 0 ? "text-amber-700" : "text-ink"],
                    ["Paid all time", a ? `${lkr(a.paid_cents)}` : "—", "text-ink"],
                    ["Spend all time", a ? `${lkr(a.value_cents)}` : "—", "text-ink"],
                    ["Gold all time", a ? `${grams(a.gold_mg)} g` : "—", "text-ink"],
                  ].map(([k, v, tone]) => (
                    <div key={k} className="bg-bone/70 px-2 py-2">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                      <div className={cn("g-metric text-[13px]", tone)}>{v}</div>
                    </div>
                  ))}
                </div>
                <Link href="/purchases/invoices?status=UNPAID" className="group flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-ink/20 hover:bg-void hover:text-gold-light">
                  Pay supplier bills <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------- where it goes */}
      <div className="grid gap-4 lg:grid-cols-3">
        <MixCard icon={TruckIcon} title="By supplier" sub="This month · top suppliers by spend" rows={bySupplier.data} loading={bySupplier.isLoading} fallback="Unknown" by="value" />
        <MixCard icon={GemIcon} title="By purity" sub="This month · fine gold received" rows={byPurity.data} loading={byPurity.isLoading} fallback="Unspecified" by="gold" />
        <MixCard icon={TagsIcon} title="By category" sub="This month · what you are stocking" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" by="value" />
      </div>
    </Page>
  );
}
