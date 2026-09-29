"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { last12Months, type MonthlySummary } from "@/lib/monthly";
import { Page, Skeleton, StatusPill } from "@/components/ui";
import { SpotlightCard } from "@/components/home/motion";
import {
  ArrowRightIcon,
  BanknoteIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  GemIcon,
  HistoryIcon,
  InboxIcon,
  PackageIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  ShieldIcon,
  TrendingUpIcon,
  TruckIcon,
} from "@/components/icons";

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;
type Rate = { id: string; karat: string; rate_per_gram: number; effective_from: number };
type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  status: string;
  created_at: number;
};
type Approval = { id: string; action: string; entity: string; reason: string; createdAt: number };
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
  const approvalsScope = can("branches:manage")
    ? ""
    : me?.branchIds[0]
      ? `&branchId=${encodeURIComponent(me.branchIds[0])}`
      : null;

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

/* ------------------------------------------------------------------ building blocks */

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07),0_18px_40px_-28px_rgba(28,25,23,0.25)]",
        className
      )}
    >
      {children}
    </section>
  );
}

function CardHead({
  icon: Icon,
  title,
  sub,
  action,
}: {
  icon: IconCmp;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">{title}</h2>
          {sub ? <p className="truncate text-xs text-ink-4">{sub}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function HeadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-ink-4 transition-colors hover:bg-ink/[0.05] hover:text-ink"
    >
      {children}
      <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Empty({ icon: Icon, title, desc, dark }: { icon: IconCmp; title: string; desc: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center",
        dark ? "border-paper/15 bg-paper/[0.02]" : "border-ink/[0.12] bg-bone/60"
      )}
    >
      <span
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-xl",
          dark ? "bg-paper/[0.06] text-gold-light" : "bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(28,25,23,0.08)]"
        )}
      >
        <Icon size={18} />
      </span>
      <p className={cn("text-sm font-medium", dark ? "text-paper" : "text-ink")}>{title}</p>
      <p className={cn("mt-1 max-w-[16rem] text-xs leading-relaxed", dark ? "text-paper/50" : "text-ink-4")}>{desc}</p>
    </div>
  );
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-xl" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

function TodayGauge({ pct }: { pct: number | undefined }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(pct ?? 0), 120);
    return () => clearTimeout(t);
  }, [pct]);
  const r = 70;
  const len = 2 * Math.PI * r;
  const ticks = Array.from({ length: 60 }, (_, i) => i * 6);
  return (
    <svg viewBox="0 0 200 200" className="size-full" aria-hidden>
      <defs>
        <linearGradient id="dg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF4C7" />
          <stop offset="0.45" stopColor="#E7C65A" />
          <stop offset="1" stopColor="#A8861B" />
        </linearGradient>
        <radialGradient id="dg-glow">
          <stop offset="0" stopColor="#E7C65A" stopOpacity="0.28" />
          <stop offset="1" stopColor="#E7C65A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="url(#dg-glow)" />
      <g className="home-spin" style={{ transformOrigin: "100px 100px" }}>
        <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(231,198,90,0.3)" strokeDasharray="1.5 6" />
        <circle cx="100" cy="6" r="2.5" fill="#E7C65A" />
      </g>
      <g className="home-spin-rev" style={{ transformOrigin: "100px 100px" }}>
        {ticks.map((d) => {
          const a = ((d - 90) * Math.PI) / 180;
          const long = d % 30 === 0;
          const r1 = 86;
          const r2 = long ? 79 : 82;
          return (
            <line
              key={d}
              x1={100 + r1 * Math.cos(a)}
              y1={100 + r1 * Math.sin(a)}
              x2={100 + r2 * Math.cos(a)}
              y2={100 + r2 * Math.sin(a)}
              stroke={long ? "#E7C65A" : "rgba(255,255,255,0.2)"}
              strokeWidth={long ? 1.4 : 0.8}
            />
          );
        })}
      </g>
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
      <circle
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke="url(#dg-gold)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={len * (1 - Math.min(1, shown / 100))}
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "100px 100px",
          transition: "stroke-dashoffset 1400ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </svg>
  );
}

function Hero({ me, d }: { me: MeData | undefined; d: ReturnType<typeof useDashboard> }) {
  const firstName = me?.user.name?.split(" ")[0] ?? "there";
  const today = d.salesToday.data;
  const month = d.salesMonth.data;
  const pct = today && month ? (month.value_cents > 0 ? (today.value_cents / month.value_cents) * 100 : 0) : undefined;
  const todayValue = useCountUp(today ? today.value_cents / 100 : undefined);
  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);

  const strip: { label: string; value: string; icon: IconCmp; href?: string }[] = [
    { label: "Month to date", value: month ? `LKR ${lkr(month.value_cents)}` : "—", icon: TrendingUpIcon, href: "/sales/reports" },
    { label: "Invoices this month", value: month ? month.invoices.toLocaleString("en-US") : "—", icon: InboxIcon, href: "/sales/invoices" },
    { label: "Gold in workshop", value: wipMg !== undefined ? `${grams(wipMg)} g` : "—", icon: FlaskConicalIcon, href: "/manufacturing/orders" },
    { label: "Pending approvals", value: d.approvals.data ? String(d.approvals.data.total) : "—", icon: ShieldIcon, href: "/approvals" },
  ];

  return (
    <section className="relative overflow-hidden rounded-3xl bg-void text-paper shadow-5">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-70" />
      <div className="home-drift pointer-events-none absolute -right-32 -top-40 size-[30rem] rounded-full bg-gold/20 blur-[120px]" />
      <div
        className="home-drift pointer-events-none absolute -bottom-48 left-10 size-[26rem] rounded-full bg-gold-deep/25 blur-[120px]"
        style={{ animationDelay: "-8s" }}
      />
      <div className="home-noise pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

      <div className="relative grid grid-cols-1 items-center gap-8 p-5 sm:p-8 lg:grid-cols-[1.35fr_1fr] lg:p-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Branch overview
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-paper/40">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>

          <h1 className="g-display mt-5 text-4xl text-paper text-balance sm:text-5xl">
            {greeting()}, <span className="home-gold-text">{firstName}.</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper/60 sm:text-[15px]">
            Here&apos;s how the counter, the vault and the workshop are moving today.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            {d.can("sales:create") ? (
              <Link href="/pos" className="home-btn-gold h-11 px-5 text-sm">
                <CreditCardIcon size={15} />
                New sale
              </Link>
            ) : null}
            <Link href="/scan" className="home-btn-ghost h-11 px-5 text-sm">
              <ScanBarcodeIcon size={15} />
              Scan a piece
            </Link>
            <Link href="/products" className="home-btn-ghost h-11 px-5 text-sm">
              Catalog
              <ArrowRightIcon size={14} />
            </Link>
          </div>
        </div>

        <div className="home-glass relative flex min-w-0 items-center gap-4 p-4 sm:gap-5 sm:p-6">
          <div className="relative size-24 shrink-0 sm:size-36">
            <TodayGauge pct={pct} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="g-metric text-lg text-paper sm:text-2xl">{pct !== undefined ? `${Math.round(pct)}%` : "—"}</span>
              <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-paper/40 sm:text-[9px]">of month</span>
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light/80">Today&apos;s sales</div>
            {d.salesToday.isLoading ? (
              <Skeleton className="mt-2 h-9 w-36 bg-paper/10" />
            ) : (
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-xs text-paper/50">LKR</span>
                <span className="g-metric truncate text-2xl text-paper sm:text-4xl">
                  {today ? Math.round(todayValue).toLocaleString("en-US") : "—"}
                </span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-paper/55">
              <span>
                <span className="g-metric text-paper/85">{today ? today.invoices : "—"}</span> invoices
              </span>
              <span>
                <span className="g-metric text-paper/85">{today ? grams(today.gold_mg) : "—"}</span> g sold
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
        {strip.map((s, i) => {
          const body = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper/[0.05] text-gold-light ring-1 ring-paper/[0.08] transition-colors group-hover:bg-gold group-hover:text-void">
                <s.icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                <span className="g-metric mt-0.5 block truncate text-base text-paper">{s.value}</span>
              </span>
            </>
          );
          const cls = cn(
            "group flex min-w-0 items-center gap-3 px-4 py-4 transition-colors hover:bg-paper/[0.03] sm:px-6 lg:px-8",
            i % 2 === 1 && "border-l border-paper/[0.08]",
            i >= 2 && "border-t border-paper/[0.08] lg:border-t-0",
            i === 2 && "lg:border-l"
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className={cls}>
              {body}
            </Link>
          ) : (
            <div key={s.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ KPI cards */

function Kpi({
  label,
  icon: Icon,
  value,
  format,
  unit,
  prefix,
  sub,
  href,
  loading,
  denied,
  delay = 0,
}: {
  label: string;
  icon: IconCmp;
  value: number | undefined;
  format: (n: number) => string;
  unit?: string;
  prefix?: string;
  sub: string;
  href: string;
  loading: boolean;
  denied: boolean;
  delay?: number;
}) {
  const n = useCountUp(value);
  return (
    <Link href={href} className="group block animate-fade-in rounded-[22px]" style={{ animationDelay: `${delay}ms` }}>
      <SpotlightCard tone="light" className="flex flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-sm font-medium text-ink-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)] transition-all duration-320 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light">
              <Icon size={16} />
            </span>
            {label}
          </span>
          <ArrowRightIcon
            size={14}
            className="-translate-x-1 text-ink-5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-gold-dark group-hover:opacity-100"
          />
        </div>
        <div className="mt-6">
          {loading ? (
            <Skeleton className="h-9 w-32" />
          ) : denied ? (
            <span className="text-sm text-ink-5">Not available for your role</span>
          ) : (
            <div className="flex items-baseline gap-1.5">
              {prefix ? <span className="text-xs font-medium text-ink-4">{prefix}</span> : null}
              <span className="g-metric truncate text-3xl leading-none text-ink">{value !== undefined ? format(n) : "—"}</span>
              {unit ? <span className="text-sm font-medium text-ink-4">{unit}</span> : null}
            </div>
          )}
          <p className="mt-2 truncate text-xs text-ink-4">{sub}</p>
        </div>
        <span className="absolute inset-x-5 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
      </SpotlightCard>
    </Link>
  );
}

/* ------------------------------------------------------------------ panels */

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

  return (
    <Card className="lg:col-span-2">
      <CardHead
        icon={TrendingUpIcon}
        title="Revenue trend"
        sub="Last six months · revenue and net profit"
        action={<HeadLink href="/analytics">Analytics</HeadLink>}
      />
      <div className="px-5 pb-5 sm:px-6">
        {denied ? (
          <Empty icon={TrendingUpIcon} title="Accounts access needed" desc="Revenue trends are visible to roles with accounts view." />
        ) : loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !hasData ? (
          <Empty icon={TrendingUpIcon} title="No trend data yet" desc="Monthly figures appear once sales are posted." />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">6-month revenue</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xs text-ink-4">LKR</span>
                  <span className="g-metric text-2xl text-ink">{Math.round(total).toLocaleString("en-US")}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-ink-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full bg-gradient-to-r from-gold-light to-gold-dark" />
                  Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-ink" />
                  Net profit
                </span>
              </div>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#C9A227" stopOpacity={0.35} />
                      <stop offset="1" stopColor="#C9A227" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="rev-stroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#E7C65A" />
                      <stop offset="1" stopColor="#A8861B" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(28,25,23,0.06)" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#78716c", fontSize: 11 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tick={{ fill: "#a8a29e", fontSize: 11 }}
                    tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(168,134,27,0.35)", strokeDasharray: "3 3" }}
                    contentStyle={{
                      borderRadius: 12,
                      border: "none",
                      background: "#0c0a09",
                      color: "#fff",
                      fontSize: 12,
                      boxShadow: "0 20px 40px -16px rgba(0,0,0,0.5)",
                    }}
                    labelStyle={{ color: "#E7C65A", fontWeight: 600, marginBottom: 4 }}
                    itemStyle={{ color: "#fafaf9" }}
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
                    activeDot={{ r: 5, fill: "#E7C65A", stroke: "#fff", strokeWidth: 2 }}
                  />
                  <Line type="monotone" dataKey="net" name="Net profit" stroke="#1c1917" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function RatesPanel({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = [...(d.rates.data ?? [])].sort((a, b) => b.rate_per_gram - a.rate_per_gram);
  const max = rows[0]?.rate_per_gram ?? 1;
  const updated = rows.reduce((m, r) => Math.max(m, r.effective_from), 0);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]" />
      <div className="relative flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <CoinsIcon size={16} />
          </span>
          <div>
            <h2 className="font-sans text-[15px] font-semibold tracking-normal text-paper">Board rates</h2>
            <p className="text-xs text-paper/45">{updated ? `Updated ${ago(updated)}` : "Per gram, by karat"}</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-emerald-400" />
          Live
        </span>
      </div>

      <div className="relative px-5 pb-5 sm:px-6">
        {!d.can("masters:view") ? (
          <Empty dark icon={CoinsIcon} title="Rates hidden" desc="Board rates need masters view." />
        ) : d.rates.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-xl bg-paper/10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty dark icon={CoinsIcon} title="No rates published" desc="Publish today's board rates to price every piece." />
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r, i) => (
              <li
                key={r.id}
                className="animate-fade-in rounded-xl bg-paper/[0.03] p-3 ring-1 ring-paper/[0.06] transition-colors hover:bg-paper/[0.06]"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="g-metric rounded-md bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold-light ring-1 ring-gold/25">
                    {r.karat}
                  </span>
                  <span className="flex items-baseline gap-1">
                    <span className="text-[10px] text-paper/40">LKR</span>
                    <span className="g-metric text-base text-paper">{r.rate_per_gram.toLocaleString("en-US")}</span>
                    <span className="text-[10px] text-paper/40">/g</span>
                  </span>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-paper/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-gold-deep via-gold to-gold-light"
                    style={{ width: `${(r.rate_per_gram / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/gold-rates"
          className="group mt-4 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium text-paper/60 ring-1 ring-paper/10 transition-colors hover:bg-gold hover:text-void hover:ring-gold"
        >
          Manage rates
          <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </section>
  );
}

function RecentSales({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = d.invoices.data?.rows ?? [];
  return (
    <Card className="lg:col-span-2">
      <CardHead
        icon={BanknoteIcon}
        title="Recent sales"
        sub={d.invoices.data ? `${d.invoices.data.total.toLocaleString("en-US")} invoices on record` : "Latest invoices"}
        action={<HeadLink href="/sales/invoices">All invoices</HeadLink>}
      />
      <div className="px-3 pb-3 sm:px-4">
        {!d.can("sales:view") ? (
          <div className="px-2 pb-2">
            <Empty icon={BanknoteIcon} title="Sales hidden" desc="Recent invoices need sales view." />
          </div>
        ) : d.invoices.isLoading ? (
          <div className="px-2 pb-2">
            <RowsSkeleton />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-2 pb-2">
            <Empty icon={BanknoteIcon} title="No sales yet" desc="Invoices from the POS will show up here." />
          </div>
        ) : (
          <ul>
            {rows.map((inv, i) => (
              <li key={inv.id} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                <Link
                  href={`/sales/invoices/${inv.id}`}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gold/[0.06]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-gold-light">
                    {(inv.customer_name ?? "W").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{inv.customer_name ?? "Walk-in customer"}</span>
                    <span className="g-metric block truncate text-[11px] text-ink-5">
                      {inv.number} · {ago(inv.created_at)}
                    </span>
                  </span>
                  <StatusPill status={inv.status} className="hidden sm:inline-flex" />
                  <span className="w-28 shrink-0 text-right">
                    <span className="g-metric text-sm text-ink">{lkr(inv.total_cents)}</span>
                    <span className="ml-1 text-[10px] text-ink-5">LKR</span>
                  </span>
                  <ArrowRightIcon size={13} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Attention({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = d.approvals.data?.rows ?? [];
  const total = d.approvals.data?.total ?? 0;
  return (
    <Card>
      <CardHead
        icon={ShieldIcon}
        title="Needs attention"
        sub="Approvals waiting on a decision"
        action={
          total > 0 ? (
            <span className="g-metric rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{total}</span>
          ) : undefined
        }
      />
      <div className="px-5 pb-5 sm:px-6">
        {d.approvals.isLoading ? (
          <RowsSkeleton rows={3} />
        ) : d.approvals.isError || !d.approvals.data ? (
          <Empty icon={ShieldIcon} title="Approvals unavailable" desc="Your role can't view the approval queue." />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl bg-gradient-to-b from-emerald-50 to-paper px-6 py-9 text-center ring-1 ring-emerald-600/10">
            <span className="relative mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-600 text-paper">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30" />
              <CheckCircleIcon size={20} />
            </span>
            <p className="text-sm font-semibold text-ink">All clear</p>
            <p className="mt-1 text-xs text-ink-4">No approvals are waiting on you.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => (
              <li key={a.id}>
                <Link
                  href="/approvals"
                  className="group flex items-start gap-3 rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-600/10 transition-colors hover:bg-amber-50"
                >
                  <span className="mt-1.5 size-2 shrink-0 animate-pulse-soft rounded-full bg-amber-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{humanize(a.action)}</span>
                    <span className="block truncate text-xs text-ink-4">
                      {humanize(a.entity)} · {ago(a.createdAt)}
                    </span>
                  </span>
                  <ArrowRightIcon size={13} className="mt-1 shrink-0 text-ink-5 group-hover:text-amber-700" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

const ACTIONS: { label: string; desc: string; href: string; icon: IconCmp; perm: string }[] = [
  { label: "New sale", desc: "Open the POS", href: "/pos", icon: CreditCardIcon, perm: "sales:create" },
  { label: "Scan", desc: "Look up a piece", href: "/scan", icon: ScanBarcodeIcon, perm: "products:view" },
  { label: "Old gold", desc: "Weigh an intake", href: "/old-gold/intake", icon: ScaleIcon, perm: "oldgold:create" },
  { label: "Purchase", desc: "Supplier invoice", href: "/purchases/invoices", icon: TruckIcon, perm: "purchases:view" },
  { label: "Melting", desc: "Batch old gold", href: "/gold/melting", icon: FlaskConicalIcon, perm: "gold:view" },
  { label: "Day closing", desc: "Reconcile & lock", href: "/day-closing", icon: ClipboardCheckIcon, perm: "accounts:view" },
  { label: "Catalog", desc: "Pieces & labels", href: "/products", icon: PackageIcon, perm: "products:view" },
  { label: "Gold rates", desc: "Publish board", href: "/gold-rates", icon: CoinsIcon, perm: "masters:view" },
];

function QuickActions({ d }: { d: ReturnType<typeof useDashboard> }) {
  const items = ACTIONS.filter((a) => d.can(a.perm));
  return (
    <Card className="lg:col-span-2">
      <CardHead icon={GemIcon} title="Quick actions" sub="Jump straight into the day's work" />
      <div className="grid grid-cols-2 gap-2.5 px-5 pb-5 sm:grid-cols-4 sm:px-6">
        {items.map((a, i) => (
          <Link
            key={a.href}
            href={a.href}
            className="group relative animate-fade-in overflow-hidden rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.06] transition-all duration-240 ease-brand hover:-translate-y-0.5 hover:bg-void hover:ring-void hover:shadow-3"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="pointer-events-none absolute -right-8 -top-8 size-20 rounded-full bg-gold/0 blur-2xl transition-colors duration-320 group-hover:bg-gold/30" />
            <span className="relative flex size-9 items-center justify-center rounded-lg bg-paper text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.18)] transition-colors group-hover:bg-gold group-hover:text-void">
              <a.icon size={16} />
            </span>
            <span className="relative mt-4 block text-sm font-semibold text-ink transition-colors group-hover:text-paper">{a.label}</span>
            <span className="relative block text-xs text-ink-4 transition-colors group-hover:text-paper/55">{a.desc}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Activity({ d }: { d: ReturnType<typeof useDashboard> }) {
  const rows = d.audit.data?.rows ?? [];
  return (
    <Card>
      <CardHead icon={HistoryIcon} title="Activity" sub="Latest audited changes" action={<HeadLink href="/audit">Audit</HeadLink>} />
      <div className="px-5 pb-5 sm:px-6">
        {!d.can("audit:view") ? (
          <Empty icon={HistoryIcon} title="Audit hidden" desc="The activity feed needs audit view." />
        ) : d.audit.isLoading ? (
          <RowsSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <Empty icon={HistoryIcon} title="Quiet so far" desc="Changes across the branch will stream in here." />
        ) : (
          <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-gradient-to-b before:from-gold/60 before:to-ink/5">
            {rows.map((r, i) => (
              <li key={r.id} className="relative flex animate-fade-in gap-3 pl-6" style={{ animationDelay: `${i * 50}ms` }}>
                <span
                  className={cn(
                    "absolute left-0 top-1.5 size-[11px] rounded-full ring-4 ring-paper",
                    i === 0 ? "bg-gold" : "bg-ink/15"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    <span className="font-medium">{humanize(r.action)}</span>
                    <span className="text-ink-4"> · {humanize(r.entity)}</span>
                  </span>
                  <span className="g-metric block truncate text-[11px] text-ink-5">
                    {r.entity_id.slice(0, 14)} · {ago(r.created_at)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function DashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const d = useDashboard(me.data?.permissions ?? [], me.data);
  const wipMg = d.wip.data?.reduce((s, w) => s + w.allocatedMg, 0);

  return (
    <Page className="space-y-5">
      <Hero me={me.data} d={d} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Today's sales"
          icon={BanknoteIcon}
          prefix="LKR"
          value={d.salesToday.data ? d.salesToday.data.value_cents / 100 : undefined}
          format={(n) => Math.round(n).toLocaleString("en-US")}
          sub={d.salesToday.data ? `${d.salesToday.data.invoices} invoices today` : "From sales invoices"}
          href="/sales/invoices"
          loading={d.salesToday.isLoading}
          denied={!d.can("sales:view") || d.salesToday.isError}
        />
        <Kpi
          label="Gold sold"
          icon={GemIcon}
          unit="g"
          value={d.salesToday.data ? d.salesToday.data.gold_mg / 1000 : undefined}
          format={(n) => n.toFixed(3)}
          sub="Net weight across today's pieces"
          href="/sales/reports"
          loading={d.salesToday.isLoading}
          denied={!d.can("sales:view") || d.salesToday.isError}
          delay={60}
        />
        <Kpi
          label="Old gold bought"
          icon={ScaleIcon}
          unit="g"
          value={d.oldGoldToday.data ? d.oldGoldToday.data.fine_mg / 1000 : undefined}
          format={(n) => n.toFixed(3)}
          sub="Fine gold taken in today"
          href="/old-gold/items"
          loading={d.oldGoldToday.isLoading}
          denied={!d.can("oldgold:view") || d.oldGoldToday.isError}
          delay={120}
        />
        <Kpi
          label="Purchases"
          icon={TruckIcon}
          prefix="LKR"
          value={d.purchasesToday.data ? d.purchasesToday.data.value_cents / 100 : undefined}
          format={(n) => Math.round(n).toLocaleString("en-US")}
          sub={wipMg !== undefined ? `${grams(wipMg)} g in the workshop` : "Supplier invoices today"}
          href="/purchases/invoices"
          loading={d.purchasesToday.isLoading}
          denied={!d.can("purchases:view") || d.purchasesToday.isError}
          delay={180}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <RevenuePanel d={d} />
        <RatesPanel d={d} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <RecentSales d={d} />
        <Attention d={d} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <QuickActions d={d} />
        <Activity d={d} />
      </div>
    </Page>
  );
}
