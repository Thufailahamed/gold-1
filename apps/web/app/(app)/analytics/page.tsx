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
import { last12Months, type MonthlyReport } from "@/lib/monthly";
import { Page, EmptyBlock, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  BanknoteIcon,
  CreditCardIcon,
  GemIcon,
  HistoryIcon,
  PackageIcon,
  ScaleIcon,
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

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
const lkrSigned = (c: number) => `${c < 0 ? "−" : ""}${lkr(Math.abs(c))}`;
const grams = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short" });
const longMonth = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const monthYear = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });

/** Percentage change, or null when there is no meaningful base. */
function delta(cur: number | undefined | null, prev: number | undefined | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function Delta({ value, dark, invert, empty = "—" }: { value: number | null; dark?: boolean; invert?: boolean; empty?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn("text-[10.5px]", dark ? "text-paper/30" : "text-ink-5")}>{empty}</span>;
  }
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={cn(
        "g-metric inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
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

/** Twelve-month sparkline; gaps stay gaps. */
function Sparkline({ values, h = 28, color = C.goldLight, dark = true }: { values: (number | null)[]; h?: number; color?: string; dark?: boolean }) {
  const id = useId();
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <div style={{ height: h }} className={cn("flex items-center text-[9.5px]", dark ? "text-paper/25" : "text-ink-5")}>Not enough history</div>;
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: h }} className="w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke={dark ? "rgba(255,255,255,0.12)" : "rgba(16,32,27,0.12)"} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      {first && last ? <path d={`${line}L${last[0]},${H}L${first[0]},${H}Z`} fill={`url(#${id})`} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last ? <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} stroke={dark ? "#062A22" : "#fff"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
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
    <div className="min-w-[10rem] rounded-xl bg-void px-3 py-2.5 text-paper shadow-[0_20px_40px_-16px_rgba(6,42,34,0.6),inset_0_0_0_1px_rgba(205,168,83,0.25)]">
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
    <div className="flex flex-wrap items-center gap-3">
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

/* ------------------------------------------------------------- surfaces */

function Card({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-2xl",
        dark ? "bg-void text-paper shadow-4" : "bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_18px_40px_-30px_rgba(16,32,27,0.28)]",
        className
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      {children}
    </section>
  );
}

function CardHead({ icon: Icon, title, sub, action }: { icon: IconCmp; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink/20 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
          <Icon size={14} />
        </span>
        <div className="min-w-0 leading-tight">
          <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
          {sub ? <p className="truncate text-[11px] text-ink-4">{sub}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function Empty({ icon: Icon, title, desc }: { icon: IconCmp; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-ink/20 bg-bone/60 px-4 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="text-[11px] leading-snug text-ink-4">{desc}</p>
      </div>
    </div>
  );
}

/** One KPI in the hero strip: figure, change vs last month, 12-month spark. */
function Kpi({
  label,
  value,
  format = lkr,
  unit,
  change,
  invert,
  spark,
  sub,
  accent,
  loading,
}: {
  label: string;
  value: number | undefined | null;
  format?: (n: number) => string;
  unit?: string;
  change: number | null;
  invert?: boolean;
  spark: (number | null)[];
  sub?: ReactNode;
  accent?: boolean;
  loading?: boolean;
}) {
  const shown = useCountUp(value ?? undefined);
  return (
    <div className={cn("min-w-0 px-4 pb-2 pt-2.5", accent ? "bg-void bg-gradient-to-br from-gold/[0.14] via-void to-void" : "bg-void")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">{label}</span>
        <Delta value={change} dark invert={invert} />
      </div>
      {loading ? (
        <Skeleton className="mt-1.5 h-5 w-24 bg-paper/10" />
      ) : (
        <div className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
          <span className={cn("g-metric truncate leading-none", accent ? "text-[21px] text-gold-light" : "text-[17px] text-paper")}>
            {value == null ? "—" : format(shown)}
          </span>
          {unit ? <span className="text-[9.5px] font-semibold text-paper/35">{unit}</span> : null}
        </div>
      )}
      <div className="mt-1.5">
        <Sparkline values={spark} h={22} />
      </div>
      {sub ? <div className="mt-1 truncate text-[10px] text-paper/40">{sub}</div> : null}
    </div>
  );
}

function ChartSkeleton({ h = 240 }: { h?: number }) {
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
      queryFn: () => api<MonthlyReport>(`/api/v1/reports/monthly?month=${m.month}&year=${m.year}${branchId ? `&branchId=${branchId}` : ""}`),
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
      d,
      revenue: d ? d.profit.revenueCents / 100 : null,
      net: d ? d.profit.netProfitCents / 100 : null,
      cashIn: d ? d.cashflow.inflowsCents / 100 : null,
      cashOut: d ? d.cashflow.outflowsCents / 100 : null,
      goldIn: d ? d.gold.inFineMg / 1000 : null,
      goldOut: d ? d.gold.outFineMg / 1000 : null,
    };
  });
  const pick = (f: (d: MonthlyReport) => number) => series.map((s) => (s.d ? f(s.d) : null));
  const marginOf = (d: MonthlyReport) => (d.profit.revenueCents ? (d.profit.netProfitCents / d.profit.revenueCents) * 100 : 0);

  const revenue12 = series.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const net12 = series.reduce((s, r) => s + (r.net ?? 0), 0);
  const withData = series.filter((s) => s.d).length;
  const best = series.reduce<(typeof series)[number] | null>((a, b) => (b.revenue !== null && (!a || b.revenue > (a.revenue ?? -Infinity)) ? b : a), null);
  const margin = cur && cur.profit.revenueCents ? marginOf(cur) : null;
  const prevMargin = prev && prev.profit.revenueCents ? marginOf(prev) : null;
  const avgInvoice = cur && cur.sales.invoiceCount ? cur.sales.netCents / cur.sales.invoiceCount : null;
  const prevAvgInvoice = prev && prev.sales.invoiceCount ? prev.sales.netCents / prev.sales.invoiceCount : null;

  const purity = (cur?.inventory.byPurity ?? []).filter((p) => p.cents > 0).slice(0, 6);
  const purityTotal = purity.reduce((s, p) => s + p.cents, 0);
  const aging = cur ? Object.entries(cur.receivables.aging) : [];
  const agingMax = Math.max(1, ...aging.map(([, v]) => v));
  const stockTotal = cur ? cur.inventory.jewelleryCents + cur.inventory.goldCents : 0;
  const jewelleryPct = stockTotal ? (cur!.inventory.jewelleryCents / stockTotal) * 100 : 0;
  const expenseCats = (cur?.expenses?.byCategory ?? []).filter((c) => c.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 6);
  const expenseMax = Math.max(1, ...expenseCats.map((c) => c.cents));

  if (!allowed && !me.isLoading) {
    return (
      <Page>
        <EmptyBlock title="Not permitted" description="Analytics needs branch management and accounts view." />
      </Page>
    );
  }

  const axis = { tick: { fontSize: 10, fill: C.tick }, tickLine: false, axisLine: false } as const;

  /** This month against last, line by line. */
  const compare: { k: string; cur: number | null; prev: number | null; fmt: (n: number) => string; invert?: boolean; strong?: boolean }[] = [
    { k: "Revenue", cur: cur?.profit.revenueCents ?? null, prev: prev?.profit.revenueCents ?? null, fmt: lkr, strong: true },
    { k: "Cost of goods", cur: cur?.profit.cogsCents ?? null, prev: prev?.profit.cogsCents ?? null, fmt: lkr, invert: true },
    { k: "Gross profit", cur: cur?.profit.grossProfitCents ?? null, prev: prev?.profit.grossProfitCents ?? null, fmt: lkrSigned },
    { k: "Operating expenses", cur: cur?.profit.operatingExpensesCents ?? null, prev: prev?.profit.operatingExpensesCents ?? null, fmt: lkr, invert: true },
    { k: "Net profit", cur: cur?.profit.netProfitCents ?? null, prev: prev?.profit.netProfitCents ?? null, fmt: lkrSigned, strong: true },
    { k: "Invoices", cur: cur?.sales.invoiceCount ?? null, prev: prev?.sales.invoiceCount ?? null, fmt: (n) => n.toLocaleString("en-US") },
    { k: "Average invoice", cur: avgInvoice, prev: prevAvgInvoice, fmt: lkr },
    { k: "Returns", cur: cur?.sales.returnsCents ?? null, prev: prev?.sales.returnsCents ?? null, fmt: lkr, invert: true },
    { k: "Cash in", cur: cur?.cashflow.inflowsCents ?? null, prev: prev?.cashflow.inflowsCents ?? null, fmt: lkr },
    { k: "Cash out", cur: cur?.cashflow.outflowsCents ?? null, prev: prev?.cashflow.outflowsCents ?? null, fmt: lkr, invert: true },
    { k: "Old gold bought", cur: cur?.purchases?.oldGoldCents ?? null, prev: prev?.purchases?.oldGoldCents ?? null, fmt: lkr },
    { k: "Payables", cur: cur?.payables?.totalCents ?? null, prev: prev?.payables?.totalCents ?? null, fmt: lkr, invert: true },
  ];

  return (
    <Page className="space-y-4">
      {/* ------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-[20px] bg-void text-paper shadow-5">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-40 size-80 rounded-full bg-gold/[0.18] blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 left-1/4 size-72 rounded-full bg-gold-deep/20 blur-[110px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="relative flex flex-col gap-3 px-4 pt-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_24px_-10px_rgba(205,168,83,0.7)]">
              <TrendingUpIcon size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="g-display text-[24px] leading-none">
                  Business <span className="home-gold-text">analytics</span>
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold-light">
                  <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                  Owner
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-paper/45">
                {months[0] ? monthYear(months[0].label) : ""} – {thisMonth ? monthYear(thisMonth) : ""} · {withData}/12 months with data · gaps are never filled in
              </p>
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <label htmlFor="analytics-branch" className="sr-only">
              Branch
            </label>
            <select
              id="analytics-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-8 rounded-lg bg-paper/[0.07] px-2.5 pr-8 text-[12.5px] text-paper shadow-[inset_0_0_0_1px_rgba(246,245,240,0.16)] transition hover:bg-paper/[0.1] focus:outline-none focus:shadow-[inset_0_0_0_1px_#E2C27A,0_0_0_3px_rgba(205,168,83,0.3)] [color-scheme:dark]"
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
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-paper/55 ring-1 ring-paper/10">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Ledger-posted
            </span>
            {missing > 0 ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-amber-200/80 ring-1 ring-amber-300/20">
                <AlertCircleIcon size={12} />
                {missing}/12 unavailable
              </span>
            ) : null}
          </div>
        </div>

        {/* KPI strip */}
        <div className="relative mx-4 mb-4 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:mx-5 sm:grid-cols-4 2xl:grid-cols-8">
          <Kpi
            accent
            label="Net profit"
            value={cur?.profit.netProfitCents}
            format={lkrSigned}
            unit="LKR"
            change={delta(cur?.profit.netProfitCents, prev?.profit.netProfitCents)}
            spark={pick((d) => d.profit.netProfitCents)}
            sub={`12 mo ${compact.format(net12)} LKR`}
            loading={loading}
          />
          <Kpi
            label="Revenue"
            value={cur?.profit.revenueCents}
            unit="LKR"
            change={delta(cur?.profit.revenueCents, prev?.profit.revenueCents)}
            spark={pick((d) => d.profit.revenueCents)}
            sub={`12 mo ${compact.format(revenue12)} LKR`}
            loading={loading}
          />
          <Kpi
            label="Net margin"
            value={margin}
            format={(n) => n.toFixed(1)}
            unit="%"
            change={margin !== null && prevMargin !== null ? margin - prevMargin : null}
            spark={pick(marginOf)}
            sub={prevMargin !== null ? `${prevMargin.toFixed(1)}% last month` : "pts vs last month"}
            loading={loading}
          />
          <Kpi
            label="Invoices"
            value={cur?.sales.invoiceCount}
            format={(n) => Math.round(n).toLocaleString("en-US")}
            change={delta(cur?.sales.invoiceCount, prev?.sales.invoiceCount)}
            spark={pick((d) => d.sales.invoiceCount)}
            sub={avgInvoice !== null ? `Avg ${lkr(avgInvoice)} LKR` : "No invoices"}
            loading={loading}
          />
          <Kpi
            label="Net cash flow"
            value={cur ? cur.cashflow.inflowsCents - cur.cashflow.outflowsCents : undefined}
            format={lkrSigned}
            unit="LKR"
            change={delta(cur ? cur.cashflow.inflowsCents - cur.cashflow.outflowsCents : null, prev ? prev.cashflow.inflowsCents - prev.cashflow.outflowsCents : null)}
            spark={pick((d) => d.cashflow.inflowsCents - d.cashflow.outflowsCents)}
            sub={cur ? `In ${compact.format(cur.cashflow.inflowsCents / 100)} · out ${compact.format(cur.cashflow.outflowsCents / 100)}` : undefined}
            loading={loading}
          />
          <Kpi
            label="Closing cash"
            value={cur?.cashflow.closingCents}
            format={lkrSigned}
            unit="LKR"
            change={delta(cur?.cashflow.closingCents, prev?.cashflow.closingCents)}
            spark={pick((d) => d.cashflow.closingCents)}
            sub="Drawer + bank"
            loading={loading}
          />
          <Kpi
            label="Gold closing"
            value={cur?.gold.closingFineMg}
            format={grams}
            unit="g fine"
            change={delta(cur?.gold.closingFineMg, prev?.gold.closingFineMg)}
            spark={pick((d) => d.gold.closingFineMg)}
            sub={cur ? `Net ${grams(cur.gold.inFineMg - cur.gold.outFineMg)} g this month` : undefined}
            loading={loading}
          />
          <Kpi
            label="Receivables"
            value={cur?.receivables.totalCents}
            format={lkrSigned}
            unit="LKR"
            invert
            change={delta(cur?.receivables.totalCents, prev?.receivables.totalCents)}
            spark={pick((d) => d.receivables.totalCents)}
            sub={cur?.payables ? `Payables ${lkr(cur.payables.totalCents)}` : undefined}
            loading={loading}
          />
        </div>
      </section>

      {noData ? (
        <EmptyBlock title="No data yet" description="Post sales or purchases and the trends will appear here." />
      ) : (
        <>
          {/* ---------------------------------------------------- performance */}
          <div className="grid gap-4 xl:grid-cols-12">
            <Card className="xl:col-span-8">
              <CardHead
                icon={TrendingUpIcon}
                title="Revenue & net profit"
                sub={`LKR · 12 months${best?.revenue ? ` · best ${shortMonth(best.month)} ${compact.format(best.revenue)}` : ""}`}
                action={
                  <LegendDots
                    items={[
                      { label: "Revenue", color: C.gold },
                      { label: "Net profit", color: C.emerald, dashed: true },
                    ]}
                  />
                }
              />
              <div className="grid grid-cols-2 border-b border-ink/20 sm:grid-cols-4">
                {[
                  ["12-month revenue", `${compact.format(revenue12)} LKR`],
                  ["12-month net", `${compact.format(net12)} LKR`],
                  ["Avg monthly revenue", withData ? `${compact.format(revenue12 / withData)} LKR` : "—"],
                  ["12-month margin", revenue12 ? `${((net12 / revenue12) * 100).toFixed(1)}%` : "—"],
                ].map(([k, v], i) => (
                  <div key={k} className={cn("px-4 py-2", i % 2 === 1 && "border-l border-ink/20", i >= 2 && "border-t border-ink/20 sm:border-t-0", i === 2 && "sm:border-l")}>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                    <div className="g-metric mt-0.5 truncate text-[13px] text-ink">{v}</div>
                  </div>
                ))}
              </div>
              <div className="flex-1 px-2 pb-3 pt-3">
                {loading ? (
                  <ChartSkeleton h={260} />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={series} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="an-rev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor={C.gold} stopOpacity={0.32} />
                          <stop offset="1" stopColor={C.gold} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={44} {...axis} />
                      <Tooltip content={<ChartTip unit="LKR" />} cursor={{ stroke: "rgba(168,138,62,0.35)", strokeDasharray: "3 3" }} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        name="Revenue"
                        stroke={C.gold}
                        strokeWidth={2}
                        fill="url(#an-rev)"
                        connectNulls={false}
                        activeDot={{ r: 4.5, fill: C.gold, stroke: "#fff", strokeWidth: 2 }}
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

            <Card className="xl:col-span-4">
              <CardHead
                icon={ScaleIcon}
                title="This month vs last"
                sub={`${thisMonth ? shortMonth(thisMonth) : ""} against ${prevMonth ? shortMonth(prevMonth) : "last month"} · LKR`}
              />
              <div className="flex-1 overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-bone/60 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                      <th className="py-1.5 pl-4 pr-2 text-left font-semibold">Line</th>
                      <th className="px-2 text-right font-semibold">{prevMonth ? shortMonth(prevMonth) : "Last"}</th>
                      <th className="px-2 text-right font-semibold">{thisMonth ? shortMonth(thisMonth) : "This"}</th>
                      <th className="py-1.5 pl-2 pr-4 text-right font-semibold">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map((r) => (
                      <tr key={r.k} className={cn("border-t border-ink/20", r.strong && "bg-gold-pale/30")}>
                        <td className={cn("py-1.5 pl-4 pr-2", r.strong ? "font-semibold text-ink" : "text-ink-3")}>{r.k}</td>
                        <td className="g-metric px-2 text-right text-ink-4">{loading ? "…" : r.prev === null ? "—" : r.fmt(r.prev)}</td>
                        <td className={cn("g-metric px-2 text-right", r.strong ? "font-semibold text-ink" : "text-ink-2")}>
                          {loading ? "…" : r.cur === null ? "—" : r.fmt(r.cur)}
                        </td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          <Delta value={delta(r.cur, r.prev)} invert={r.invert} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* --------------------------------------------------- cash & gold */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead
                icon={BanknoteIcon}
                title="Cash in vs out"
                sub={cur ? `${lkrSigned(cur.cashflow.inflowsCents - cur.cashflow.outflowsCents)} LKR net this month` : "LKR · 12 months"}
                action={
                  <LegendDots
                    items={[
                      { label: "In", color: C.gold },
                      { label: "Out", color: C.emerald },
                    ]}
                  />
                }
              />
              <div className="px-2 pb-3 pt-3">
                {loading ? (
                  <ChartSkeleton h={200} />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={series} barGap={2} barCategoryGap="28%" margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={44} {...axis} />
                      <Tooltip content={<ChartTip unit="LKR" />} cursor={{ fill: "rgba(205,168,83,0.08)" }} />
                      <Bar dataKey="cashIn" name="Cash in" fill={C.gold} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cashOut" name="Cash out" fill={C.emerald} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card>
              <CardHead
                icon={GemIcon}
                title="Fine gold in vs out"
                sub={cur ? `${grams(cur.gold.inFineMg - cur.gold.outFineMg)} g net this month · closing ${grams(cur.gold.closingFineMg)} g` : "grams · 12 months"}
                action={
                  <LegendDots
                    items={[
                      { label: "In", color: C.goldLight },
                      { label: "Out", color: C.emeraldSoft },
                    ]}
                  />
                }
              />
              <div className="px-2 pb-3 pt-3">
                {loading ? (
                  <ChartSkeleton h={200} />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={series} barGap={2} barCategoryGap="28%" margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.grid} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={shortMonth} {...axis} dy={6} />
                      <YAxis tickFormatter={(v: number) => compact.format(v)} width={44} {...axis} />
                      <Tooltip content={<ChartTip unit="g" />} cursor={{ fill: "rgba(205,168,83,0.08)" }} />
                      <Bar dataKey="goldIn" name="Gold in" fill={C.goldLight} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="goldOut" name="Gold out" fill={C.emeraldSoft} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          {/* --------------------------------------- stock, dues and spending */}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHead icon={PackageIcon} title="Inventory by purity" sub={stockTotal ? `${lkr(stockTotal)} LKR at book cost` : "Book cost"} />
              <div className="flex-1 p-4">
                {loading ? (
                  <ChartSkeleton h={150} />
                ) : purity.length === 0 ? (
                  <Empty icon={PackageIcon} title="No stock valued yet" desc="Costed pieces will be grouped by purity here." />
                ) : (
                  <div className="grid items-center gap-4 sm:grid-cols-[130px_minmax(0,1fr)]">
                    <div className="relative mx-auto size-[130px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={purity} dataKey="cents" nameKey="key" innerRadius={44} outerRadius={62} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270}>
                            {purity.map((p, i) => (
                              <Cell key={p.key} fill={PURITY_COLORS[i % PURITY_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="g-metric text-[15px] leading-none text-ink">{compact.format(purityTotal / 100)}</span>
                        <span className="mt-0.5 text-[9px] text-ink-5">LKR</span>
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {purity.map((p, i) => {
                        const pct = purityTotal ? (p.cents / purityTotal) * 100 : 0;
                        return (
                          <li key={p.key} className="flex items-center gap-2 text-[12px]">
                            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: PURITY_COLORS[i % PURITY_COLORS.length] }} />
                            <span className="min-w-0 flex-1 truncate font-medium text-ink">{p.key}</span>
                            <span className="g-metric text-[11px] text-ink-5">{pct.toFixed(0)}%</span>
                            <span className="g-metric w-20 text-right text-[11.5px] text-ink">{lkr(p.cents)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {cur && stockTotal > 0 ? (
                  <div className="mt-3 border-t border-ink/20 pt-2.5">
                    <div className="flex justify-between text-[10.5px] font-medium text-ink-4">
                      <span>Jewellery · {lkr(cur.inventory.jewelleryCents)}</span>
                      <span>Gold · {lkr(cur.inventory.goldCents)}</span>
                    </div>
                    <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                      <span className="h-full bg-gold" style={{ width: `${jewelleryPct}%` }} />
                      <span className="h-full flex-1 bg-void" />
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHead icon={UsersIcon} title="Receivables aging" sub={cur ? `${lkr(cur.receivables.totalCents)} LKR outstanding` : "LKR by age"} />
              <div className="flex-1 p-4">
                {loading ? (
                  <ChartSkeleton h={150} />
                ) : aging.length === 0 || aging.every(([, v]) => v === 0) ? (
                  <Empty icon={UsersIcon} title="Nothing outstanding" desc="Overdue amounts will be grouped by age here." />
                ) : (
                  <ul className="space-y-2.5">
                    {aging.map(([bucket, v], i) => {
                      const color = AGING_COLORS[Math.min(i, AGING_COLORS.length - 1)];
                      const share = cur?.receivables.totalCents ? (v / cur.receivables.totalCents) * 100 : 0;
                      return (
                        <li key={bucket}>
                          <div className="flex items-baseline justify-between gap-3 text-[12px]">
                            <span className="font-semibold text-ink">{bucket}</span>
                            <span className="flex items-baseline gap-2">
                              <span className="g-metric text-[10.5px] text-ink-5">{share.toFixed(0)}%</span>
                              <span className="g-metric text-ink">{lkr(v)}</span>
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                            <div className="h-full rounded-full transition-[width] duration-700 ease-brand" style={{ width: `${(v / agingMax) * 100}%`, background: color }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            <Card className="lg:col-span-2 xl:col-span-1">
              <CardHead
                icon={CreditCardIcon}
                title="Spending by category"
                sub={cur?.expenses ? `${lkr(cur.expenses.totalCents)} LKR this month${cur.expenses.pendingCents ? ` · ${lkr(cur.expenses.pendingCents)} pending` : ""}` : "This month"}
              />
              <div className="flex-1 p-4">
                {loading ? (
                  <ChartSkeleton h={150} />
                ) : expenseCats.length === 0 ? (
                  <Empty icon={CreditCardIcon} title="No spending posted" desc="Expense categories appear once expenses are posted." />
                ) : (
                  <ul className="space-y-2.5">
                    {expenseCats.map((c) => (
                      <li key={c.accountCode}>
                        <div className="flex items-baseline justify-between gap-3 text-[12px]">
                          <span className="min-w-0 truncate font-medium text-ink">
                            {c.name} <span className="g-metric text-[10px] text-ink-5">{c.accountCode}</span>
                          </span>
                          <span className="g-metric shrink-0 text-ink">{lkr(c.cents)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                          <div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light" style={{ width: `${(c.cents / expenseMax) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* ------------------------------------------------- 12-month ledger */}
          <Card>
            <CardHead
              icon={HistoryIcon}
              title="Twelve-month ledger"
              sub="Every month side by side · LKR unless marked"
              action={<span className="text-[10.5px] text-ink-5">Newest first</span>}
            />
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[900px] text-[12px]">
                <thead>
                  <tr className="bg-bone/60 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                    <th className="py-1.5 pl-4 pr-2 text-left font-semibold">Month</th>
                    <th className="px-2 text-right font-semibold">Revenue</th>
                    <th className="px-2 text-right font-semibold">Gross</th>
                    <th className="px-2 text-right font-semibold">Opex</th>
                    <th className="px-2 text-right font-semibold">Net profit</th>
                    <th className="px-2 text-right font-semibold">Margin</th>
                    <th className="px-2 text-right font-semibold">Invoices</th>
                    <th className="px-2 text-right font-semibold">Net cash</th>
                    <th className="px-2 text-right font-semibold">Closing cash</th>
                    <th className="py-1.5 pl-2 pr-4 text-right font-semibold">Gold net (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map((s, i) => {
                    const d = s.d;
                    const current = i === 0;
                    return (
                      <tr key={s.month} className={cn("border-t border-ink/20 transition-colors hover:bg-bone/60", current && "bg-gold-pale/30")}>
                        <td className="py-1.5 pl-4 pr-2">
                          <span className={cn("font-medium", current ? "text-ink" : "text-ink-2")}>{monthYear(s.month)}</span>
                          {current ? <span className="ml-1.5 rounded bg-void px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-gold-light">Now</span> : null}
                        </td>
                        {d ? (
                          <>
                            <td className="g-metric px-2 text-right text-ink">{lkr(d.profit.revenueCents)}</td>
                            <td className="g-metric px-2 text-right text-ink-3">{lkrSigned(d.profit.grossProfitCents)}</td>
                            <td className="g-metric px-2 text-right text-ink-3">{lkr(d.profit.operatingExpensesCents)}</td>
                            <td className={cn("g-metric px-2 text-right font-semibold", d.profit.netProfitCents < 0 ? "text-rose-700" : "text-ink")}>{lkrSigned(d.profit.netProfitCents)}</td>
                            <td className="g-metric px-2 text-right text-ink-4">{d.profit.revenueCents ? `${marginOf(d).toFixed(1)}%` : "—"}</td>
                            <td className="g-metric px-2 text-right text-ink-3">{d.sales.invoiceCount}</td>
                            <td className={cn("g-metric px-2 text-right", d.cashflow.inflowsCents - d.cashflow.outflowsCents < 0 ? "text-rose-700" : "text-emerald-700")}>
                              {lkrSigned(d.cashflow.inflowsCents - d.cashflow.outflowsCents)}
                            </td>
                            <td className="g-metric px-2 text-right text-ink-3">{lkrSigned(d.cashflow.closingCents)}</td>
                            <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-3">{grams(d.gold.inFineMg - d.gold.outFineMg)}</td>
                          </>
                        ) : (
                          <td colSpan={9} className="py-1.5 pl-2 pr-4 text-right text-[11px] italic text-ink-5">
                            {trends[trends.length - 1 - i]?.isLoading ? "Loading…" : "No data for this month"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink/20 bg-bone text-[12px] font-semibold text-ink">
                    <td className="py-2 pl-4 pr-2">12 months</td>
                    <td className="g-metric px-2 text-right">{lkr(revenue12 * 100)}</td>
                    <td className="g-metric px-2 text-right">{lkrSigned(series.reduce((a, s) => a + (s.d?.profit.grossProfitCents ?? 0), 0))}</td>
                    <td className="g-metric px-2 text-right">{lkr(series.reduce((a, s) => a + (s.d?.profit.operatingExpensesCents ?? 0), 0))}</td>
                    <td className={cn("g-metric px-2 text-right", net12 < 0 && "text-rose-700")}>{lkrSigned(net12 * 100)}</td>
                    <td className="g-metric px-2 text-right">{revenue12 ? `${((net12 / revenue12) * 100).toFixed(1)}%` : "—"}</td>
                    <td className="g-metric px-2 text-right">{series.reduce((a, s) => a + (s.d?.sales.invoiceCount ?? 0), 0)}</td>
                    <td className="g-metric px-2 text-right">{lkrSigned(series.reduce((a, s) => a + (s.d ? s.d.cashflow.inflowsCents - s.d.cashflow.outflowsCents : 0), 0))}</td>
                    <td className="g-metric px-2 text-right text-ink-4">—</td>
                    <td className="g-metric py-2 pl-2 pr-4 text-right">{grams(series.reduce((a, s) => a + (s.d ? s.d.gold.inFineMg - s.d.gold.outFineMg : 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {(cur?.estimates ?? []).length > 0 ? <EstimatesNote items={cur!.estimates} /> : null}
          {(cur?.warnings ?? []).length > 0 ? (
            <p className="flex items-start gap-2 px-1 text-[11px] text-ink-4">
              <AlertCircleIcon size={12} className="mt-px shrink-0 text-amber-600" />
              {cur!.warnings.join(" · ")}
            </p>
          ) : null}
        </>
      )}
    </Page>
  );
}

function EstimatesNote({ items }: { items: MonthlyReport["estimates"] }): ReactNode {
  return (
    <Card>
      <CardHead icon={AlertCircleIcon} title="Estimates" sub="Shown for context only and left out of profit" />
      <ul className="divide-y divide-ink/[0.05]">
        {items.map((e) => (
          <li key={e.label} className="flex items-start gap-3 px-4 py-2">
            <span className="mt-0.5 shrink-0 rounded-full bg-amber-600/[0.1] px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-amber-700">Estimate</span>
            <span className="text-[12.5px] text-ink-3">
              <span className="font-medium text-ink">{e.label}</span> · {e.note}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
