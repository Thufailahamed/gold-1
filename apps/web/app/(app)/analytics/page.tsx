"use client";

import { useId, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { Page, EmptyBlock, Skeleton } from "@/components/ui";
import { Card, CardHead, Empty, SectionHead } from "@/components/module-dashboard";
import {
  AlertCircleIcon,
  BanknoteIcon,
  CoinsIcon,
  GemIcon,
  PackageIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";

/* Chart palette, matched to the Emerald Vault theme tokens. */
const C = {
  gold: "#CDA853",
  goldLight: "#E2C27A",
  goldDeep: "#7E6223",
  emerald: "#0F4335",
  emeraldSoft: "#5E8C7C",
  tick: "#93A29C",
  grid: "rgba(16,32,27,0.06)",
};
const PURITY_COLORS = ["#CDA853", "#0F4335", "#E2C27A", "#5E8C7C", "#7E6223", "#CDD5D1"];
const AGING_COLORS = ["#CDA853", "#A88A3E", "#B45309", "#B42318", "#7F1D1D"];

const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const longMonth = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** Percentage change, or null when there is no meaningful base. */
function delta(cur: number | undefined, prev: number | undefined): number | null {
  if (cur === undefined || prev === undefined || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function Delta({ value, dark, invert }: { value: number | null; dark?: boolean; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn("text-[11px]", dark ? "text-paper/35" : "text-ink-5")}>no prior month</span>;
  }
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={cn(
        "g-metric inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold",
        dark
          ? good
            ? "bg-emerald-400/15 text-emerald-300"
            : "bg-rose-400/15 text-rose-300"
          : good
            ? "bg-emerald-700/[0.08] text-emerald-700"
            : "bg-rose-700/[0.08] text-rose-700"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%
    </span>
  );
}

/** Twelve-month sparkline for the hero; gaps stay gaps. */
function Sparkline({ values }: { values: (number | null)[] }) {
  const id = useId();
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <div className="h-12" />;
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 0);
  const span = max - min || 1;
  const W = 240;
  const H = 48;
  const pts = values.map((v, i) => (v === null ? null : ([(i / (values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)] as const)));
  const line = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : d), "");
  const first = pts.find(Boolean);
  const last = [...pts].reverse().find(Boolean);
  const zeroY = H - 4 - ((0 - min) / span) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-12 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.goldLight} stopOpacity="0.35" />
          <stop offset="1" stopColor={C.goldLight} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeDasharray="2 4" />
      {first && last ? <path d={`${line}L${last[0]},${H}L${first[0]},${H}Z`} fill={`url(#${id})`} /> : null}
      <path d={line} fill="none" stroke={C.goldLight} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r="3" fill={C.goldLight} stroke="#062A22" strokeWidth="1.5" /> : null}
    </svg>
  );
}

type TipProps = {
  active?: boolean;
  label?: string;
  payload?: { name?: string; value?: number | string | null; color?: string; dataKey?: string | number }[];
  unit: string;
};

function ChartTip({ active, label, payload, unit }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[10rem] rounded-xl bg-void px-3.5 py-3 text-paper shadow-[0_20px_40px_-16px_rgba(6,42,34,0.6),inset_0_0_0_1px_rgba(205,168,83,0.25)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-light">{label ? longMonth(label) : ""}</p>
      <ul className="mt-2 space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-paper/60">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="g-metric text-paper">
              {p.value === null || p.value === undefined ? "—" : Number(p.value).toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
              <span className="text-paper/45">{unit}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LegendDots({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] font-medium text-ink-4">
          {i.dashed ? (
            <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} />
          ) : (
            <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function HeroStat({
  label,
  value,
  unit,
  change,
  invert,
  index,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  change: number | null;
  invert?: boolean;
  index: number;
}) {
  const shown = useCountUp(value);
  return (
    <div
      className={cn(
        "min-w-0 px-5 py-4 sm:px-7",
        index % 2 === 1 && "border-l border-paper/[0.08]",
        index >= 2 && "border-t border-paper/[0.08] lg:border-t-0",
        index === 2 && "lg:border-l"
      )}
    >
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{label}</p>
      <p className="g-metric mt-1.5 flex items-baseline gap-1.5 truncate text-lg leading-none text-paper">
        {value === undefined ? "—" : unit === "g" ? (shown / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 }) : lkr(shown)}
        <span className="text-[11px] font-medium text-paper/45">{unit}</span>
      </p>
      <div className="mt-2">
        <Delta value={change} dark invert={invert} />
      </div>
    </div>
  );
}

function ChartSkeleton({ h = 280 }: { h?: number }) {
  return (
    <div style={{ height: h }}>
      <Skeleton className="size-full rounded-xl" />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function AnalyticsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const [branchId, setBranchId] = useState("");
  const allowed = hasPermission(me.data?.permissions ?? [], "branches:manage") && hasPermission(me.data?.permissions ?? [], "accounts:view");
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>("/api/v1/branches?limit=100"),
    enabled: allowed,
  });
  const months = last12Months(new Date());
  const trends = useQueries({
    queries: months.map((m) => ({
      queryKey: ["trend", m.year, m.month, branchId],
      queryFn: () => api<MonthlySummary>(`/api/v1/reports/monthly?month=${m.month}&year=${m.year}${branchId ? `&branchId=${branchId}` : ""}`),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });

  const loading = trends.some((t) => t.isLoading);
  const cur = trends[trends.length - 1]?.data;
  const prev = trends[trends.length - 2]?.data;
  const missing = trends.filter((t) => !t.isLoading && (t.isError || !t.data)).length;
  const noData = !loading && trends.every((t) => !t.data);
  const thisMonth = months[months.length - 1]?.label ?? "";
  const prevMonth = months[months.length - 2]?.label ?? "";

  const series = trends.map((t, i) => {
    const d = t.data;
    return {
      month: months[i]?.label ?? "",
      revenue: d ? d.profit.revenueCents / 100 : null,
      net: d ? d.profit.netProfitCents / 100 : null,
      cashIn: d ? d.cashflow.inflowsCents / 100 : null,
      cashOut: d ? d.cashflow.outflowsCents / 100 : null,
      goldIn: d ? d.gold.inFineMg / 1000 : null,
      goldOut: d ? d.gold.outFineMg / 1000 : null,
    };
  });

  const revenue12 = series.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const net12 = series.reduce((s, r) => s + (r.net ?? 0), 0);
  const margin = cur && cur.profit.revenueCents ? (cur.profit.netProfitCents / cur.profit.revenueCents) * 100 : null;
  const avgInvoice = cur && cur.sales.invoiceCount ? cur.sales.netCents / cur.sales.invoiceCount : null;
  const netShown = useCountUp(cur?.profit.netProfitCents);

  const purity = (cur?.inventory.byPurity ?? []).filter((p) => p.cents > 0).slice(0, 6);
  const purityTotal = purity.reduce((s, p) => s + p.cents, 0);
  const aging = cur ? Object.entries(cur.receivables.aging) : [];
  const agingMax = Math.max(1, ...aging.map(([, v]) => v));
  const stockTotal = cur ? cur.inventory.jewelleryCents + cur.inventory.goldCents : 0;
  const jewelleryPct = stockTotal ? (cur!.inventory.jewelleryCents / stockTotal) * 100 : 0;

  if (!allowed && !me.isLoading) {
    return (
      <Page>
        <EmptyBlock title="Not permitted" description="Analytics needs branch management and accounts view." />
      </Page>
    );
  }

  const axis = { tick: { fontSize: 11, fill: C.tick }, tickLine: false, axisLine: false } as const;

  return (
    <Page>
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-gold/20 blur-[100px]" />
        <div className="home-drift pointer-events-none absolute -bottom-40 left-1/4 size-72 rounded-full bg-gold-deep/20 blur-[110px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="relative flex flex-col gap-7 px-5 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Analytics · Owner
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-paper/40">{thisMonth ? longMonth(thisMonth) : ""}</span>
            </div>
            <h1 className="g-display mt-4 text-[28px] leading-[1.05] text-paper sm:text-[40px]">
              The business, <span className="home-gold-text">month by month.</span>
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper/60">
              Twelve months of ledger-posted sales, cash and gold, with this month in focus. Months without data are left as gaps, never filled in.
            </p>
            <div className="no-print mt-6 flex flex-wrap items-center gap-2">
              <label htmlFor="analytics-branch" className="sr-only">
                Branch
              </label>
              <select
                id="analytics-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-10 rounded-lg bg-paper/[0.06] px-3 pr-8 text-sm text-paper ring-1 ring-paper/15 transition-colors hover:bg-paper/[0.1] focus:outline-none focus:ring-gold/60"
              >
                <option value="" className="text-ink">
                  All branches
                </option>
                {(branches.data?.rows ?? []).map((b) => (
                  <option key={b.id} value={b.id} className="text-ink">
                    {b.name}
                  </option>
                ))}
              </select>
              <span className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs text-paper/55 ring-1 ring-paper/10">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                Ledger-posted
              </span>
              {missing > 0 ? (
                <span className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs text-amber-200/80 ring-1 ring-amber-300/20">
                  <AlertCircleIcon size={13} />
                  {missing} of 12 months unavailable
                </span>
              ) : null}
            </div>
          </div>

          <div className="min-w-0 lg:w-[22rem] lg:shrink-0">
            <div className="relative overflow-hidden rounded-2xl bg-paper/[0.04] p-5 ring-1 ring-gold/20 backdrop-blur-sm sm:p-6">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-light/60 to-transparent" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">Net profit · this month</p>
                {cur && prev ? <Delta value={delta(cur.profit.netProfitCents, prev.profit.netProfitCents)} dark /> : null}
              </div>
              {loading ? (
                <Skeleton className="mt-3 h-9 w-44 bg-paper/10" />
              ) : (
                <p className="g-metric mt-2 flex items-baseline gap-2 text-[34px] leading-none text-paper">
                  <span className="text-xs font-medium tracking-normal text-paper/45">LKR</span>
                  {cur ? lkr(netShown) : "—"}
                </p>
              )}
              <p className="mt-2 text-xs text-paper/50">
                {margin === null ? "No revenue posted yet" : `${margin.toFixed(1)}% margin on ${cur ? lkr(cur.profit.revenueCents) : "0"} LKR revenue`}
              </p>
              <div className="mt-4">
                <Sparkline values={series.map((s) => s.net)} />
                <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.14em] text-paper/30">
                  <span>{months[0] ? shortMonth(months[0].label) : ""}</span>
                  <span>12-month net {compact.format(net12)} LKR</span>
                  <span>{thisMonth ? shortMonth(thisMonth) : ""}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
          <HeroStat index={0} label="Net sales" unit="LKR" value={cur?.sales.netCents} change={delta(cur?.sales.netCents, prev?.sales.netCents)} />
          <HeroStat index={1} label="Closing cash" unit="LKR" value={cur?.cashflow.closingCents} change={delta(cur?.cashflow.closingCents, prev?.cashflow.closingCents)} />
          <HeroStat index={2} label="Gold closing" unit="g" value={cur?.gold.closingFineMg} change={delta(cur?.gold.closingFineMg, prev?.gold.closingFineMg)} />
          <HeroStat
            index={3}
            label="Receivables"
            unit="LKR"
            value={cur?.receivables.totalCents}
            change={delta(cur?.receivables.totalCents, prev?.receivables.totalCents)}
            invert
          />
        </div>
      </section>

      {noData ? (
        <EmptyBlock title="No data yet" description="Post sales or purchases and the trends will appear here." />
      ) : (
        <>
          {/* ---------------------------------------------------- performance */}
          <SectionHead index="01" title="Performance" sub={`Revenue and net profit over twelve months, compared with ${prevMonth ? shortMonth(prevMonth) : "last month"}`} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHead
                icon={TrendingUpIcon}
                title="Revenue & net profit"
                sub={`LKR · ${compact.format(revenue12)} revenue in 12 months`}
                action={
                  <LegendDots
                    items={[
                      { label: "Revenue", color: C.gold },
                      { label: "Net profit", color: C.emerald, dashed: true },
                    ]}
                  />
                }
              />
              <div className="px-3 pb-4 sm:px-4">
                {loading ? (
                  <ChartSkeleton h={300} />
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="an-rev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={C.gold} stopOpacity={0.32} />
                          <stop offset="1" stopColor={C.gold} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={48} {...axis} />
                      <Tooltip content={<ChartTip unit="LKR" />} cursor={{ stroke: "rgba(168,138,62,0.35)", strokeDasharray: "3 3" }} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke={C.gold}
                        strokeWidth={2.25}
                        fill="url(#an-rev)"
                        connectNulls={false}
                        activeDot={{ r: 5, fill: C.gold, stroke: "#fff", strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="net"
                        name="Net profit"
                        stroke={C.emerald}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        connectNulls={false}
                        activeDot={{ r: 4, fill: C.emerald, stroke: "#fff", strokeWidth: 2 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card>
              <CardHead icon={CoinsIcon} title="This month at a glance" sub={thisMonth ? longMonth(thisMonth) : undefined} />
              <dl className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {[
                  { k: "Revenue", v: cur ? `${lkr(cur.profit.revenueCents)}` : "—", u: "LKR", d: delta(cur?.profit.revenueCents, prev?.profit.revenueCents) },
                  { k: "Net profit", v: cur ? `${lkr(cur.profit.netProfitCents)}` : "—", u: "LKR", d: delta(cur?.profit.netProfitCents, prev?.profit.netProfitCents) },
                  { k: "Net margin", v: margin === null ? "—" : margin.toFixed(1), u: "%", d: null },
                  { k: "Invoices", v: cur ? cur.sales.invoiceCount.toLocaleString("en-US") : "—", u: "", d: delta(cur?.sales.invoiceCount, prev?.sales.invoiceCount) },
                  { k: "Average invoice", v: avgInvoice === null ? "—" : lkr(avgInvoice), u: "LKR", d: null },
                ].map((r) => (
                  <div key={r.k} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <dt className="text-xs text-ink-4">{r.k}</dt>
                    <dd className="flex items-center gap-2.5">
                      {r.d !== null ? <Delta value={r.d} /> : null}
                      <span className="g-metric text-[15px] text-ink">
                        {loading ? <Skeleton className="h-5 w-16" /> : r.v}
                        {r.u && !loading ? <span className="ml-1 text-[10px] text-ink-5">{r.u}</span> : null}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          {/* --------------------------------------------------- cash & gold */}
          <SectionHead index="02" title="Cash & gold" sub="What came in and what went out, month by month" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead
                icon={BanknoteIcon}
                title="Cash in vs out"
                sub={cur ? `${lkr(cur.cashflow.inflowsCents - cur.cashflow.outflowsCents)} LKR net this month` : "LKR · 12 months"}
                action={
                  <LegendDots
                    items={[
                      { label: "In", color: C.gold },
                      { label: "Out", color: C.emerald },
                    ]}
                  />
                }
              />
              <div className="px-3 pb-4 sm:px-4">
                {loading ? (
                  <ChartSkeleton h={250} />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={series} barGap={3} barCategoryGap="28%" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={48} {...axis} />
                      <Tooltip content={<ChartTip unit="LKR" />} cursor={{ fill: "rgba(205,168,83,0.08)" }} />
                      <Bar dataKey="cashIn" name="Cash in" fill={C.gold} radius={[5, 5, 0, 0]} />
                      <Bar dataKey="cashOut" name="Cash out" fill={C.emerald} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card>
              <CardHead
                icon={GemIcon}
                title="Fine gold in vs out"
                sub={cur ? `${((cur.gold.inFineMg - cur.gold.outFineMg) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} g net this month` : "grams · 12 months"}
                action={
                  <LegendDots
                    items={[
                      { label: "In", color: C.goldLight },
                      { label: "Out", color: C.emeraldSoft },
                    ]}
                  />
                }
              />
              <div className="px-3 pb-4 sm:px-4">
                {loading ? (
                  <ChartSkeleton h={250} />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={series} barGap={3} barCategoryGap="28%" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={48} {...axis} />
                      <Tooltip content={<ChartTip unit="g" />} cursor={{ fill: "rgba(205,168,83,0.08)" }} />
                      <Bar dataKey="goldIn" name="Gold in" fill={C.goldLight} radius={[5, 5, 0, 0]} />
                      <Bar dataKey="goldOut" name="Gold out" fill={C.emeraldSoft} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* --------------------------------------------- stock & receivables */}
          <SectionHead index="03" title="Stock & receivables" sub="Where the value sits today, and who still owes you" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead icon={PackageIcon} title="Inventory by purity" sub={stockTotal ? `${lkr(stockTotal)} LKR at book cost` : "Book cost"} />
              <div className="px-5 pb-6 sm:px-6">
                {loading ? (
                  <ChartSkeleton h={220} />
                ) : purity.length === 0 ? (
                  <Empty icon={PackageIcon} title="No stock valued yet" desc="Costed pieces will be grouped by purity here." />
                ) : (
                  <div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
                    <div className="relative mx-auto size-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={purity} dataKey="cents" nameKey="key" innerRadius={66} outerRadius={94} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}>
                            {purity.map((p, i) => (
                              <Cell key={p.key} fill={PURITY_COLORS[i % PURITY_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Total</span>
                        <span className="g-metric mt-1 text-xl leading-none text-ink">{compact.format(purityTotal / 100)}</span>
                        <span className="mt-1 text-[10px] text-ink-5">LKR</span>
                      </div>
                    </div>
                    <ul className="space-y-2.5">
                      {purity.map((p, i) => {
                        const pct = purityTotal ? (p.cents / purityTotal) * 100 : 0;
                        return (
                          <li key={p.key} className="flex items-center gap-3 text-sm">
                            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: PURITY_COLORS[i % PURITY_COLORS.length] }} />
                            <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.key}</span>
                            <span className="g-metric text-xs text-ink-4">{pct.toFixed(0)}%</span>
                            <span className="g-metric w-24 text-right text-xs text-ink">{lkr(p.cents)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {cur && stockTotal > 0 ? (
                  <div className="mt-6 border-t border-ink/[0.06] pt-4">
                    <div className="flex justify-between text-[11px] font-medium text-ink-4">
                      <span>Jewellery · {lkr(cur.inventory.jewelleryCents)} LKR</span>
                      <span>Gold · {lkr(cur.inventory.goldCents)} LKR</span>
                    </div>
                    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">
                      <span className="h-full bg-gold" style={{ width: `${jewelleryPct}%` }} />
                      <span className="h-full flex-1 bg-void" />
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHead icon={UsersIcon} title="Receivables aging" sub={cur ? `${lkr(cur.receivables.totalCents)} LKR outstanding` : "LKR by age"} />
              <div className="px-5 pb-6 sm:px-6">
                {loading ? (
                  <ChartSkeleton h={220} />
                ) : aging.length === 0 || aging.every(([, v]) => v === 0) ? (
                  <Empty icon={UsersIcon} title="Nothing outstanding" desc="Every customer balance is settled. Overdue amounts will be grouped by age here." />
                ) : (
                  <ul className="space-y-4">
                    {aging.map(([bucket, v], i) => {
                      const color = AGING_COLORS[Math.min(i, AGING_COLORS.length - 1)];
                      const share = cur?.receivables.totalCents ? (v / cur.receivables.totalCents) * 100 : 0;
                      return (
                        <li key={bucket}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-semibold text-ink">{bucket}</span>
                            <span className="flex items-baseline gap-2">
                              <span className="g-metric text-xs text-ink-5">{share.toFixed(0)}%</span>
                              <span className="g-metric text-sm text-ink">{lkr(v)}</span>
                              <span className="text-[10px] text-ink-5">LKR</span>
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink/[0.05]">
                            <div className="h-full rounded-full transition-[width] duration-700 ease-brand" style={{ width: `${(v / agingMax) * 100}%`, background: color }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {(cur?.estimates ?? []).length > 0 ? (
            <EstimatesNote items={cur!.estimates} />
          ) : null}
        </>
      )}
    </Page>
  );
}

function EstimatesNote({ items }: { items: MonthlySummary["estimates"] }): ReactNode {
  return (
    <Card>
      <CardHead icon={AlertCircleIcon} title="Estimates" sub="Shown for context only and left out of profit" />
      <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
        {items.map((e) => (
          <li key={e.label} className="flex items-start gap-3 px-5 py-3 sm:px-6">
            <span className="mt-0.5 shrink-0 rounded-full bg-amber-600/[0.1] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">Estimate</span>
            <span className="text-sm text-ink-3">
              <span className="font-medium text-ink">{e.label}</span> · {e.note}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
