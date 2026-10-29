"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { Page, Skeleton } from "@/components/ui";
import { Card, CardHead, Empty, GoldHero, HeadLink, HeroBadge, RowsSkeleton, heroGhost, heroGold, th, thead, tr } from "@/components/console-kit";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  GemIcon,
  HammerIcon,
  HistoryIcon,
  LayoutGridIcon,
  PackageIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  ShieldIcon,
  TrendingUpIcon,
  TruckIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;
type Total = { total: number };
type Rate = { id: string; karat: string; rate_per_gram: number; effective_from: number };
type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  status: string;
  created_at: number;
};
type AuditRow = { id: string; action: string; entity: string; entity_id: string; created_at: number };

const lkr = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");
const grams = (mg: number) =>
  (mg / 1000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const humanize = (s: string) => s.replace(/[._-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------------ data */

function useDashboard(perms: string[], me: MeData | undefined) {
  const can = (p: string) => hasPermission(perms, p);
  const ready = !!me;
  const opt = { retry: false, staleTime: 60_000 } as const;

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

  // Work queues: one `limit=1` read each, only the total is used.
  const count = (key: string, path: string, perm: string) => ({
    ...opt,
    queryKey: ["dash", "count", key],
    queryFn: () => api<Total>(path),
    enabled: ready && can(perm),
  });
  const queues = useQueries({
    queries: [
      count("stock", "/api/v1/products?limit=1&page=1&status=IN_STOCK", "products:view"),
      count("reserved", "/api/v1/products?limit=1&page=1&status=RESERVED", "products:view"),
      count("rep-bench", "/api/v1/repairs?status=IN_PROGRESS&limit=1", "sales:view"),
      count("rep-ready", "/api/v1/repairs?status=READY&limit=1", "sales:view"),
      count("og-test", "/api/v1/oldgold/items?status=RECEIVED&limit=1", "oldgold:view"),
      count("og-valued", "/api/v1/oldgold/items?status=VALUED&limit=1", "oldgold:view"),
      count("mfg-bench", "/api/v1/manufacturing/orders?status=IN_PRODUCTION&limit=1", "mfg:view"),
      count("mfg-qc", "/api/v1/manufacturing/orders?status=QC_FAILED&limit=1", "mfg:view"),
    ],
  });

  return { can, salesToday, salesMonth, purchasesToday, oldGoldToday, wip, rates, invoices, audit, months, trend, queues };
}

/* ------------------------------------------------------------------ panels */

const INV_CHIP: Record<string, string> = {
  PAID: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25",
  PARTIAL: "bg-gold/15 text-gold-deep ring-gold/35",
  UNPAID: "bg-amber-500/10 text-amber-800 ring-amber-500/25",
  VOID: "bg-ink/[0.04] text-ink-5 ring-ink/20",
};

function RevenuePanel({ d }: { d: ReturnType<typeof useDashboard> }) {
  const denied = !d.can("accounts:view");
  const data = d.trend.map((t, i) => {
    const m = d.months[i]!;
    return {
      label: new Date(m.year, m.month - 1, 1).toLocaleString("en-GB", { month: "short" }),
      revenue: t.data ? t.data.profit.revenueCents / 100 : null,
      net: t.data ? t.data.profit.netProfitCents / 100 : null,
    };
  });
  const loading = d.trend.some((t) => t.isLoading);
  const hasData = data.some((p) => p.revenue !== null);
  const total = data.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const netTotal = data.reduce((s, p) => s + (p.net ?? 0), 0);
  const withRev = data.filter((p) => p.revenue !== null);
  const best = withRev.reduce<(typeof data)[number] | null>((a, p) => (a == null || (p.revenue ?? 0) > (a.revenue ?? 0) ? p : a), null);
  const last = withRev[withRev.length - 1];
  const prev = withRev[withRev.length - 2];
  const mom = last && prev && prev.revenue ? (((last.revenue ?? 0) - prev.revenue) / prev.revenue) * 100 : null;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

  return (
    <Card className="xl:col-span-8">
      <CardHead icon={TrendingUpIcon} title="Revenue trend" sub="Last six months · revenue and net profit" action={<HeadLink href="/analytics">Analytics</HeadLink>} />
      {denied ? (
        <Empty icon={TrendingUpIcon} title="Accounts access needed" desc="Revenue trends are visible to roles with accounts view." />
      ) : loading ? (
        <div className="p-4">
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : !hasData ? (
        <Empty icon={TrendingUpIcon} title="No trend data yet" desc="Monthly figures appear once sales are posted." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-ink/20 bg-ink/[0.05] sm:grid-cols-4">
            {[
              { k: "6-month revenue", v: `LKR ${fmt(total)}`, tone: "text-ink" },
              { k: "Net profit", v: `LKR ${fmt(netTotal)}`, tone: netTotal < 0 ? "text-rose-700" : "text-emerald-700", sub: total ? `${((netTotal / total) * 100).toFixed(1)}% margin` : undefined },
              { k: "Best month", v: best ? best.label : "—", tone: "text-ink", sub: best ? `LKR ${fmt(best.revenue ?? 0)}` : undefined },
              {
                k: "Month on month",
                v: mom == null ? "—" : `${mom > 0 ? "+" : ""}${mom.toFixed(1)}%`,
                tone: mom == null ? "text-ink-5" : mom >= 0 ? "text-emerald-700" : "text-rose-700",
                sub: last && prev ? `${last.label} vs ${prev.label}` : undefined,
              },
            ].map((m) => (
              <div key={m.k} className="bg-paper px-4 py-2">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{m.k}</div>
                <div className={cn("g-metric mt-0.5 truncate text-[14px] font-semibold", m.tone)}>{m.v}</div>
                {m.sub ? <div className="truncate text-[10.5px] text-ink-5">{m.sub}</div> : null}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-4 px-4 pt-2 text-[10.5px] text-ink-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-gradient-to-r from-gold-light to-gold-dark" />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-emerald-600" />
              Net profit
            </span>
          </div>
          <div className="h-52 px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#CDA853" stopOpacity={0.35} />
                    <stop offset="1" stopColor="#CDA853" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rev-stroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#E2C27A" />
                    <stop offset="1" stopColor="#A88A3E" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(16,32,27,0.06)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#5d6e68", fontSize: 10.5 }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fill: "#93a29c", fontSize: 10 }}
                  tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(168,138,62,0.35)", strokeDasharray: "3 3" }}
                  contentStyle={{ borderRadius: 12, border: "none", background: "#062a22", color: "#fff", fontSize: 12, boxShadow: "0 20px 40px -16px rgba(0,0,0,0.5)" }}
                  labelStyle={{ color: "#E2C27A", fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ color: "#f6f5f0" }}
                  formatter={(v) => `LKR ${Number(v ?? 0).toLocaleString("en-US")}`}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="url(#rev-stroke)"
                  strokeWidth={2.5}
                  fill="url(#rev-fill)"
                  connectNulls
                  activeDot={{ r: 5, fill: "#E2C27A", stroke: "#fff", strokeWidth: 2 }}
                />
                <Line type="monotone" dataKey="net" name="Net profit" stroke="#059669" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

function RatesPanel({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = [...(d.rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const max = rows[0]?.rate_per_gram ?? 1;
  const updated = rows.reduce((m, r) => Math.max(m, r.effective_from), 0);
  const stale = updated > 0 && Date.now() - updated > 86_400_000;

  return (
    <section className="relative flex flex-col overflow-hidden rounded-2xl bg-void text-paper shadow-4 xl:col-span-4">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]" />
      <div className="relative flex items-center justify-between gap-3 border-b border-paper/[0.08] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <CoinsIcon size={14} />
          </span>
          <div className="leading-tight">
            <h2 className="text-[13.5px] font-semibold text-paper">Board rates</h2>
            <p className="text-[11px] text-paper/45">{updated ? `Updated ${ago(updated)}` : "Per gram, by karat"}</p>
          </div>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em]",
            stale ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"
          )}
        >
          <span className={cn("size-1.5 rounded-full", stale ? "bg-amber-400" : "animate-pulse-soft bg-emerald-400")} />
          {stale ? "Stale" : "Live"}
        </span>
      </div>

      <div className="relative flex-1 p-3">
        {!d.can("masters:view") ? (
          <p className="px-1 py-6 text-center text-[12px] text-paper/50">Board rates need masters view.</p>
        ) : d.rates.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg bg-paper/10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] text-paper/50">No rates published yet — publish today's board to price every piece.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg bg-paper/[0.04] px-3 py-2 ring-1 ring-paper/[0.06]">
                <div className="flex items-center gap-2.5">
                  <span className="g-metric rounded bg-gold/15 px-1.5 py-px text-[10.5px] font-bold text-gold-light ring-1 ring-gold/25">{r.karat}</span>
                  <span className="flex-1 text-[10.5px] text-paper/40">
                    pawn <span className="g-metric text-paper/70">{Math.round(r.rate_per_gram * 8).toLocaleString("en-US")}</span>
                  </span>
                  <span className="g-metric text-[14px] text-paper">{Math.round(r.rate_per_gram).toLocaleString("en-US")}</span>
                  <span className="text-[9.5px] text-paper/40">/g</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold-deep via-gold to-gold-light" style={{ width: `${(r.rate_per_gram / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative grid grid-cols-2 border-t border-paper/[0.08] text-[11.5px] font-medium">
        <Link href="/live-rates" className="flex items-center justify-center gap-1.5 py-2 text-paper/60 transition-colors hover:bg-paper/[0.05] hover:text-paper">
          <TrendingUpIcon size={12} />
          Live market
        </Link>
        <Link href="/gold-rates" className="flex items-center justify-center gap-1.5 border-l border-paper/[0.08] py-2 text-gold-light transition-colors hover:bg-gold hover:text-void">
          Manage rates
          <ArrowRightIcon size={11} />
        </Link>
      </div>
    </section>
  );
}

/** Work waiting on someone, across counter, vault and workshop. */
function Queues({ d }: { d: ReturnType<typeof useDashboard> }) {
  const n = (i: number) => d.queues[i]?.data?.total;
  const loading = (i: number) => !!d.queues[i]?.isLoading;
  const tiles: { label: string; hint: string; i: number; href: string; icon: IconCmp; tone: string; perm: string; alert?: boolean }[] = [
    { label: "In stock", hint: "pieces on the shelf", i: 0, href: "/products?status=IN_STOCK", icon: PackageIcon, tone: "#059669", perm: "products:view" },
    { label: "Reserved", hint: "held for customers", i: 1, href: "/products?status=RESERVED", icon: GemIcon, tone: "#D97706", perm: "products:view", alert: true },
    { label: "Repairs on bench", hint: "being worked on", i: 2, href: "/repairs", icon: HammerIcon, tone: "#7C3AED", perm: "sales:view" },
    { label: "Ready to collect", hint: "repairs to hand back", i: 3, href: "/repairs", icon: CheckCircleIcon, tone: "#0D9488", perm: "sales:view", alert: true },
    { label: "Awaiting test", hint: "old gold received", i: 4, href: "/old-gold/testing", icon: FlaskConicalIcon, tone: "#0284C7", perm: "oldgold:view", alert: true },
    { label: "Offer pending", hint: "valued, customer to accept", i: 5, href: "/old-gold/items?status=VALUED", icon: ScaleIcon, tone: "#B8923F", perm: "oldgold:view", alert: true },
    { label: "Workshop orders", hint: "in production", i: 6, href: "/manufacturing/orders", icon: HammerIcon, tone: "#4F46E5", perm: "mfg:view" },
    { label: "QC failed", hint: "needs rework", i: 7, href: "/manufacturing/orders", icon: ShieldIcon, tone: "#E11D48", perm: "mfg:view", alert: true },
  ].filter((t) => d.can(t.perm));
  if (!tiles.length) return null;
  const waiting = tiles.filter((t) => t.alert && (n(t.i) ?? 0) > 0).length;

  return (
    <Card>
      <CardHead
        icon={ClipboardCheckIcon}
        title="Work queues"
        sub="What's waiting on someone across the counter, vault and workshop"
        action={
          waiting ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-500/25">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-amber-500" />
              {waiting} need attention
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/25">
              <CheckCircleIcon size={11} />
              All clear
            </span>
          )
        }
      />
      <div className="grid grid-cols-2 gap-px bg-ink/[0.05] sm:grid-cols-4 xl:grid-cols-8">
        {tiles.map((t) => {
          const v = n(t.i);
          const hot = t.alert && (v ?? 0) > 0;
          return (
            <Link key={t.label} href={t.href} className="group relative bg-paper px-3.5 py-3 transition-colors hover:bg-bone/60">
              <span className="absolute inset-x-0 top-0 h-[2px] transition-opacity" style={{ background: t.tone, opacity: hot ? 1 : 0.35 }} aria-hidden />
              <div className="flex items-center justify-between">
                <span className="flex size-7 items-center justify-center rounded-lg" style={{ color: t.tone, background: `${t.tone}14` }}>
                  <t.icon size={13} />
                </span>
                {hot ? <span className="size-2 animate-pulse-soft rounded-full" style={{ background: t.tone }} /> : null}
              </div>
              {loading(t.i) ? (
                <Skeleton className="mt-2 h-6 w-10" />
              ) : (
                <div className={cn("g-metric mt-2 text-[22px] leading-none", v ? "text-ink" : "text-ink-5")}>{v ?? "—"}</div>
              )}
              <div className="mt-1 truncate text-[11.5px] font-semibold text-ink-2">{t.label}</div>
              <div className="truncate text-[10px] text-ink-5">{t.hint}</div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function RecentSales({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = d.invoices.data?.rows ?? [];
  const sum = rows.filter((r) => r.status !== "VOID").reduce((a, r) => a + r.total_cents, 0);
  return (
    <Card className="xl:col-span-8">
      <CardHead
        icon={BanknoteIcon}
        title="Recent sales"
        sub={d.invoices.data ? `${d.invoices.data.total.toLocaleString("en-US")} invoices on record` : "Latest invoices"}
        action={<HeadLink href="/sales/invoices">All invoices</HeadLink>}
      />
      {!d.can("sales:view") ? (
        <Empty icon={BanknoteIcon} title="Sales hidden" desc="Recent invoices need sales view." />
      ) : d.invoices.isLoading ? (
        <RowsSkeleton />
      ) : rows.length === 0 ? (
        <Empty icon={BanknoteIcon} title="No sales yet" desc="Invoices from the POS will show up here." />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-[12.5px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Customer</th>
                <th className={th}>Invoice</th>
                <th className={th}>Status</th>
                <th className={cn(th, "text-right")}>Total LKR</th>
                <th className={cn(th, "pr-4 text-right")}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className={cn(tr, "group")}>
                  <td className="py-1.5 pl-4 pr-2">
                    <Link href={`/sales/invoices/${inv.id}`} className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-[11px] font-semibold text-gold-light">
                        {(inv.customer_name ?? "W").charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate font-semibold text-ink group-hover:text-gold-deep">{inv.customer_name ?? "Walk-in customer"}</span>
                    </Link>
                  </td>
                  <td className="g-metric px-2 text-[11.5px] text-ink-3">{inv.number}</td>
                  <td className="px-2">
                    <span className={cn("inline-flex rounded-full px-2 py-px text-[10.5px] font-semibold capitalize ring-1 ring-inset", INV_CHIP[inv.status] ?? "bg-ink/[0.05] text-ink-3 ring-ink/20")}>
                      {inv.status.toLowerCase()}
                    </span>
                  </td>
                  <td className={cn("g-metric px-2 text-right font-semibold", inv.status === "VOID" ? "text-ink-5 line-through" : "text-ink")}>{lkr(inv.total_cents)}</td>
                  <td className="whitespace-nowrap px-2 pr-4 text-right text-[11px] text-ink-4">{ago(inv.created_at)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink/20 bg-bone/50 text-[12px] font-semibold">
                <td className="py-1.5 pl-4 pr-2 text-ink-3" colSpan={3}>
                  Last {rows.length} invoices
                </td>
                <td className="g-metric px-2 text-right text-ink">{lkr(sum)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function Activity({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = d.audit.data?.rows ?? [];
  return (
    <Card className="xl:col-span-4">
      <CardHead icon={HistoryIcon} title="Activity" sub="Latest audited changes" action={<HeadLink href="/audit">Audit</HeadLink>} />
      {!d.can("audit:view") ? (
        <Empty icon={HistoryIcon} title="Audit hidden" desc="The activity feed needs audit view." />
      ) : d.audit.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <Empty icon={HistoryIcon} title="Quiet so far" desc="Changes across the branch will stream in here." />
      ) : (
        <ol className="relative space-y-3 px-4 py-3 before:absolute before:bottom-4 before:left-[21px] before:top-4 before:w-px before:bg-gradient-to-b before:from-gold/60 before:to-ink/5">
          {rows.map((r, i) => (
            <li key={r.id} className="relative flex gap-3 pl-5">
              <span className={cn("absolute left-0 top-1 size-[11px] rounded-full ring-4 ring-paper", i === 0 ? "bg-gold" : "bg-ink/15")} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12.5px] text-ink">
                  <span className="font-semibold">{humanize(r.action)}</span>
                  <span className="text-ink-4"> · {humanize(r.entity)}</span>
                </span>
                <span className="g-metric block truncate text-[10.5px] text-ink-5">
                  {r.entity_id.slice(0, 12)} · {ago(r.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const ACTIONS: { label: string; desc: string; href: string; icon: IconCmp; perm: string; tone: string }[] = [
  { label: "New sale", desc: "Open the POS", href: "/pos", icon: CreditCardIcon, perm: "sales:create", tone: "#B8923F" },
  { label: "Scan", desc: "Look up a piece", href: "/scan", icon: ScanBarcodeIcon, perm: "products:view", tone: "#059669" },
  { label: "Old gold", desc: "Weigh an intake", href: "/old-gold/intake", icon: ScaleIcon, perm: "oldgold:create", tone: "#D97706" },
  { label: "Purchase", desc: "Supplier invoice", href: "/purchases/invoices", icon: TruckIcon, perm: "purchases:view", tone: "#EA580C" },
  { label: "Melting", desc: "Batch old gold", href: "/gold/melting", icon: FlaskConicalIcon, perm: "gold:view", tone: "#E11D48" },
  { label: "Day closing", desc: "Reconcile & lock", href: "/day-closing", icon: ClipboardCheckIcon, perm: "dayclose:view", tone: "#4F46E5" },
  { label: "Catalogue", desc: "Pieces & labels", href: "/products", icon: PackageIcon, perm: "products:view", tone: "#7C3AED" },
  { label: "Gold rates", desc: "Publish board", href: "/gold-rates", icon: CoinsIcon, perm: "masters:view", tone: "#0284C7" },
];

function QuickActions({ d }: { d: ReturnType<typeof useDashboard> }) {
  const items = ACTIONS.filter((a) => d.can(a.perm));
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {items.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex items-center gap-2.5 rounded-xl bg-paper px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_14px_30px_-20px_rgba(16,32,27,0.5)]"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-transform group-hover:scale-105"
            style={{ background: `linear-gradient(145deg, ${a.tone}, ${a.tone}cc)` }}
          >
            <a.icon size={14} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[12.5px] font-semibold text-ink">{a.label}</span>
            <span className="block truncate text-[10.5px] text-ink-5">{a.desc}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function DashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const d = useDashboard(me.data?.permissions ?? [], me.data);
  const firstName = me.data?.user.name?.split(" ")[0] ?? "there";
  const today = d.salesToday.data;
  const month = d.salesMonth.data;
  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);
  const now = new Date();
  const dayOfMonth = now.getDate();
  // Pace: today against this month's average day so far.
  const avgDay = month ? month.value_cents / Math.max(1, dayOfMonth) : undefined;
  const pace = today && avgDay ? (avgDay > 0 ? (today.value_cents / avgDay) * 100 : 0) : undefined;
  const avgInvoice = month && month.invoices ? month.value_cents / month.invoices : undefined;
  const topRate = [...(d.rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram)[0];
  const lk = (c: number) => Math.round(c).toLocaleString("en-US");
  const can = d.can;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={LayoutGridIcon}
        title={`${greeting()},`}
        accent={`${firstName}.`}
        badge={<HeroBadge tone="gold">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</HeroBadge>}
        sub="Branch overview · how the counter, the vault and the workshop are moving today"
        actions={
          <>
            <Link href="/scan" className={heroGhost}>
              <ScanBarcodeIcon size={13} />
              Scan
            </Link>
            <Link href="/products" className={heroGhost}>
              <PackageIcon size={13} />
              Catalogue
            </Link>
            {can("sales:create") ? (
              <Link href="/pos" className={heroGold}>
                <CreditCardIcon size={13} />
                New sale
              </Link>
            ) : null}
          </>
        }
        stats={[
          {
            label: "Today's sales",
            value: today ? today.value_cents / 100 : undefined,
            format: lk,
            unit: "LKR",
            accent: true,
            loading: d.salesToday.isLoading,
            sub: today ? `${today.invoices} invoices` : can("sales:view") ? undefined : "needs sales view",
            href: "/sales/invoices",
          },
          { label: "Gold sold today", value: today ? today.gold_mg : undefined, format: grams, unit: "g", loading: d.salesToday.isLoading, href: "/sales/reports" },
          {
            label: "Month to date",
            value: month ? month.value_cents / 100 : undefined,
            format: lk,
            unit: "LKR",
            loading: d.salesMonth.isLoading,
            sub: month ? `${month.invoices} invoices · ${grams(month.gold_mg)} g` : undefined,
            href: "/sales/reports",
          },
          { label: "Avg invoice", value: avgInvoice !== undefined ? avgInvoice / 100 : undefined, format: lk, unit: "LKR", loading: d.salesMonth.isLoading, sub: "this month" },
          {
            label: "Old gold today",
            value: d.oldGoldToday.data?.fine_mg,
            format: grams,
            unit: "g",
            loading: d.oldGoldToday.isLoading,
            sub: "fine taken in",
            href: "/old-gold",
          },
          {
            label: "Purchases today",
            value: d.purchasesToday.data ? d.purchasesToday.data.value_cents / 100 : undefined,
            format: lk,
            unit: "LKR",
            loading: d.purchasesToday.isLoading,
            href: "/purchases",
          },
          { label: "In the workshop", value: wipMg, format: grams, unit: "g", loading: d.wip.isLoading, sub: "gold allocated", href: "/manufacturing" },
          {
            label: topRate ? `Board · ${topRate.karat}` : "Board rate",
            value: topRate?.rate_per_gram,
            format: lk,
            unit: "LKR/g",
            loading: d.rates.isLoading,
            sub: topRate ? `set ${ago(topRate.effective_from)}` : undefined,
            href: "/gold-rates",
          },
        ]}
      >
        {pace !== undefined ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-paper/55">
            <span className="font-semibold uppercase tracking-[0.14em] text-paper/40">Today's pace</span>
            <div className="relative h-1.5 min-w-[160px] flex-1 overflow-hidden rounded-full bg-paper/10">
              <div
                className={cn("h-full rounded-full", pace >= 100 ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-gradient-to-r from-gold-deep to-gold-light")}
                style={{ width: `${Math.min(100, pace / 2)}%` }}
              />
              <span className="absolute inset-y-0 left-1/2 w-px bg-paper/40" title="Average day" />
            </div>
            <span>
              <span className={cn("g-metric font-semibold", pace >= 100 ? "text-emerald-300" : "text-gold-light")}>{Math.round(pace)}%</span> of an average day
              {avgDay !== undefined ? (
                <span className="text-paper/40">
                  {" "}
                  · avg <span className="g-metric">LKR {lk(avgDay / 100)}</span> over {dayOfMonth} days
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
      </GoldHero>

      <QuickActions d={d} />

      <Queues d={d} />

      <div className="grid gap-4 xl:grid-cols-12">
        <RevenuePanel d={d} />
        <RatesPanel d={d} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <RecentSales d={d} />
        <Activity d={d} />
      </div>
    </Page>
  );
}
