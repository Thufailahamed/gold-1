"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCountUp } from "@/lib/count-up";
import { businessToday, monthBounds, type MonthlyReport } from "@/lib/monthly";
import { BarList, Page, Pill, SectionLabel, Skeleton, StatusPill, controlClass } from "@/components/ui";
import { SpotlightCard } from "@/components/home/motion";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  CoinsIcon,
  CreditCardIcon,
  FileTextIcon,
  HistoryIcon,
  PlusIcon,
  ScaleIcon,
  TagsIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ types */

type Branch = { id: string; name: string; code: string };
type Expense = {
  id: string;
  number: string;
  category_name: string;
  incurred_on: string;
  amount_cents: number;
  vendor: string | null;
  description: string;
  status: string;
};
type ExpenseSummary = {
  totalCents: number;
  pendingCents: number;
  rejectedCents: number;
  byCategory: { id: string; name: string; account_code: string; posted_cents: number; pending_cents: number }[];
};
type DailyExpenses = { days: { date: string; postedCents: number; pendingCents: number; count: number }[] };
type ClosingPreview = {
  openingCents: number;
  cashIn: { totalCents: number; unclassifiedCents: number };
  cashOut: { totalCents: number };
  money: { salesCents: number; purchasesCents: number; oldGoldCents: number; expensesCents: number };
  checks: { passed: boolean; failing: string[]; total: number };
  closing: { expectedCents: number; awaitingApprovalCents: number };
};
type Closing = { id: string; close_date: string; expected_cents: number; actual_cents: number; difference_cents: number; status: string };
type BankAccount = { id: string; name: string; bank_name: string | null; is_active: number; balance_cents: number };

type IconCmp = (props: { size?: number | string; className?: string }) => ReactNode;

/* ---------------------------------------------------------------- helpers */

const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
const lkrSigned = (c: number) => `${c < 0 ? "−" : ""}${lkr(Math.abs(c))}`;
const lkrFull = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (n: number) => Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function readBranchCookie(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

function Signed({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={cn("g-metric", cents < 0 ? "text-rose-700" : "text-ink", className)}>
      {cents < 0 ? "−" : ""}
      {lkr(Math.abs(cents))}
    </span>
  );
}

/* ------------------------------------------------------------- primitives */

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
  dark,
}: {
  icon: IconCmp;
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            dark
              ? "bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
              : "bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]"
          )}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <h2 className={cn("truncate font-sans text-[15px] font-semibold tracking-normal", dark ? "text-paper" : "text-ink")}>{title}</h2>
          {sub ? <p className={cn("truncate text-xs", dark ? "text-paper/45" : "text-ink-4")}>{sub}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function HeadLink({ href, children, dark }: { href: string; children: ReactNode; dark?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        dark ? "text-paper/50 hover:bg-paper/[0.06] hover:text-gold-light" : "text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
      )}
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

/** Section divider with a mono index, title and an optional right-side control. */
function SectionHead({ index, title, sub, aside }: { index: string; title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 pt-2 sm:gap-4">
      <span className="g-metric pb-0.5 text-[11px] font-semibold tracking-[0.22em] text-gold-dark">{index}</span>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-ink-4">{sub}</p> : null}
      </div>
      <div className="hidden h-px flex-1 translate-y-[-6px] bg-ink/[0.08] sm:block" />
      {aside}
    </div>
  );
}

/** Spotlight KPI tile with a count-up metric and a gold underline sweep on hover. */
function KpiTile({
  label,
  icon: Icon,
  cents,
  format = lkr,
  sub,
  href,
  tone = "neutral",
  loading,
  delay = 0,
}: {
  label: string;
  icon: IconCmp;
  cents?: number;
  format?: (n: number) => string;
  sub?: ReactNode;
  href?: string;
  tone?: "neutral" | "good" | "bad";
  loading?: boolean;
  delay?: number;
}) {
  const shown = useCountUp(cents);
  const body = (
    <SpotlightCard tone="light" className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-ink-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)] transition-all duration-320 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light">
            <Icon size={16} />
          </span>
          <span className="truncate">{label}</span>
        </span>
        {href ? (
          <ArrowRightIcon
            size={14}
            className="-translate-x-1 shrink-0 text-ink-5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-gold-dark group-hover:opacity-100"
          />
        ) : null}
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            {cents !== undefined ? <span className="text-xs font-medium text-ink-4">LKR</span> : null}
            <span
              className={cn(
                "g-metric truncate text-[26px] leading-none",
                tone === "good" && "text-emerald-700",
                tone === "bad" && "text-rose-700",
                tone === "neutral" && "text-ink"
              )}
            >
              {cents !== undefined ? format(shown) : "—"}
            </span>
          </div>
        )}
        {sub ? <p className="mt-2 truncate text-xs text-ink-4">{sub}</p> : null}
      </div>
      <span className="absolute inset-x-5 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-gradient-to-r from-gold-dark via-gold-light to-transparent transition-transform duration-500 ease-brand group-hover:scale-x-100" />
    </SpotlightCard>
  );
  const cls = "group block h-full animate-fade-in rounded-[22px]";
  const style = { animationDelay: `${delay}ms` };
  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/** Compact hub cell linking to an accounts sub-page; laid out inside a shared Card. */
function NavTile({
  href,
  index,
  icon: Icon,
  title,
  description,
  stat,
  statTone = "muted",
}: {
  href: string;
  index: string;
  icon: IconCmp;
  title: string;
  description: string;
  stat?: ReactNode;
  statTone?: "ok" | "warn" | "info" | "muted";
}) {
  const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", info: "bg-gold", muted: "bg-ink/25" }[statTone];
  return (
    <Link
      href={href}
      className="group relative flex min-w-0 items-center gap-3.5 bg-paper px-5 py-4 transition-colors hover:bg-gold-pale/50"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)] transition-all duration-320 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light">
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink transition-colors group-hover:text-gold-dark">{title}</span>
          <span className="g-metric text-[9px] tracking-[0.2em] text-ink-5">{index}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-4">{description}</span>
        {stat ? (
          <span className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
            <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
            <span className="truncate">{stat}</span>
          </span>
        ) : null}
      </span>
      <ArrowRightIcon
        size={14}
        className="shrink-0 -translate-x-1 text-ink-5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-gold-dark group-hover:opacity-100"
      />
    </Link>
  );
}

function StatementRow({
  label,
  cents,
  strong,
  indent,
  hint,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  indent?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-2.5",
        indent && "pl-4",
        strong
          ? "mt-1.5 rounded-xl bg-bone px-3.5 py-3 text-[15px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgba(28,25,23,0.07)]"
          : "border-b border-ink/[0.05] text-sm text-ink-3"
      )}
    >
      <span className="min-w-0 truncate" title={hint}>
        {label}
      </span>
      <Signed cents={cents} className={strong ? "text-lg" : "text-sm"} />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

const heroSelectClass =
  "h-10 rounded-full bg-paper/[0.07] px-4 pr-9 text-sm text-paper shadow-[inset_0_0_0_1px_rgba(250,250,249,0.18)] transition-shadow duration-200 hover:bg-paper/[0.1] focus:outline-none focus:shadow-[inset_0_0_0_1px_#E7C65A,0_0_0_3px_rgba(201,162,39,0.3)] [&>option]:bg-paper [&>option]:text-ink";

export default function AccountsDashboardPage() {
  const today = businessToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [branchId, setBranchId] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canManage = hasPermission(perms, "accounts:manage");
  const canShop = hasPermission(perms, "branches:manage");

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"),
  });
  const visibleBranches = useMemo(
    () => (branches.data?.rows ?? []).filter((b) => canShop || (me.data?.branchIds ?? []).includes(b.id)),
    [branches.data, canShop, me.data]
  );

  // Default to the branch chosen in the top bar, falling back to the first
  // one the user can see. Day closing is per-branch, so "all branches" is an
  // opt-in for shop-wide roles rather than the default.
  useEffect(() => {
    if (branchId || visibleBranches.length === 0) return;
    const saved = readBranchCookie();
    setBranchId(visibleBranches.find((b) => b.id === saved)?.id ?? visibleBranches[0]?.id ?? "");
  }, [branchId, visibleBranches]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && visibleBranches.some((b) => b.id === detail)) {
        setBranchId(detail);
      } else {
        const saved = readBranchCookie();
        if (saved && visibleBranches.some((b) => b.id === saved)) setBranchId(saved);
      }
    };
    window.addEventListener("goldos-branch-changed", handler);
    return () => window.removeEventListener("goldos-branch-changed", handler);
  }, [visibleBranches]);

  const ready = !!me.data && (branchId !== "" || canShop);
  const bq = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
  const { from, to } = monthBounds(month);
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const isCurrentMonth = month === today.slice(0, 7);
  const opt = { retry: false, staleTime: 30_000, enabled: ready } as const;

  const report = useQuery({
    ...opt,
    queryKey: ["acct", "monthly", month, branchId],
    queryFn: () => api<MonthlyReport>(`/api/v1/reports/monthly?month=${mon}&year=${year}${bq}`),
  });
  const summary = useQuery({
    ...opt,
    queryKey: ["acct", "summary", month, branchId],
    queryFn: () => api<ExpenseSummary>(`/api/v1/expenses/reports/summary?from=${from}&to=${to}${bq}`),
  });
  const daily = useQuery({
    ...opt,
    queryKey: ["acct", "daily", month, branchId],
    queryFn: () => api<DailyExpenses>(`/api/v1/expenses/reports/daily?from=${from}&to=${to}${bq}`),
  });
  const todays = useQuery({
    ...opt,
    queryKey: ["acct", "today", today, branchId],
    queryFn: () => api<{ rows: Expense[]; total: number }>(`/api/v1/expenses?from=${today}&to=${today}&limit=50${bq}`),
  });
  const pending = useQuery({
    ...opt,
    queryKey: ["acct", "pending", branchId],
    queryFn: () => api<{ rows: Expense[]; total: number }>(`/api/v1/expenses?status=PENDING_APPROVAL&limit=5${bq}`),
  });
  const preview = useQuery({
    ...opt,
    enabled: ready && branchId !== "",
    queryKey: ["acct", "preview", today, branchId],
    queryFn: () => api<ClosingPreview>(`/api/v1/day-closings/preview?branchId=${encodeURIComponent(branchId)}&date=${today}`),
  });
  const closings = useQuery({
    ...opt,
    enabled: ready && branchId !== "",
    queryKey: ["acct", "closings", branchId],
    queryFn: () => api<{ rows: Closing[]; total: number }>(`/api/v1/day-closings?limit=7${bq}`),
  });
  const banks = useQuery({
    ...opt,
    queryKey: ["acct", "banks", branchId],
    queryFn: () => api<BankAccount[]>(`/api/v1/bank-accounts${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
  });

  const dues = useQuery({
    ...opt,
    queryKey: ["acct", "dues", branchId],
    queryFn: () => api<{ totalCents: number; rows: unknown[] }>(`/api/v1/receipts/receivables${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
  });

  const r = report.data;
  const p = preview.data;

  // Fill the calendar so a quiet day reads as zero rather than being absent.
  const chartData = useMemo(() => {
    const byDate = new Map((daily.data?.days ?? []).map((d) => [d.date, d]));
    const last = isCurrentMonth ? Number(today.slice(8, 10)) : monthBounds(month).days;
    return Array.from({ length: last }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      const d = byDate.get(date);
      return {
        date,
        label: String(i + 1),
        posted: (d?.postedCents ?? 0) / 100,
        pending: (d?.pendingCents ?? 0) / 100,
        count: d?.count ?? 0,
      };
    });
  }, [daily.data, month, isCurrentMonth, today]);

  const monthPosted = summary.data?.totalCents ?? 0;
  const monthPending = summary.data?.pendingCents ?? 0;
  const activeDays = chartData.filter((d) => d.posted + d.pending > 0).length;
  const peak = chartData.reduce<(typeof chartData)[number] | undefined>(
    (a, b) => (!a || b.posted + b.pending > a.posted + a.pending ? b : a),
    undefined
  );
  const avgPerDay = chartData.length ? monthPosted / chartData.length : 0;

  const todayRows = todays.data?.rows ?? [];
  const todayPosted = todayRows.filter((e) => e.status === "POSTED").reduce((s, e) => s + e.amount_cents, 0);
  const todayPending = todayRows.filter((e) => e.status === "PENDING_APPROVAL").reduce((s, e) => s + e.amount_cents, 0);

  const closedToday = (closings.data?.rows ?? []).some((c) => c.close_date === today && c.status === "CLOSED");
  const categories = (summary.data?.byCategory ?? [])
    .filter((c) => c.posted_cents + c.pending_cents > 0)
    .sort((a, b) => b.posted_cents + b.pending_cents - (a.posted_cents + a.pending_cents));
  const bankTotal = (banks.data ?? []).filter((b) => b.is_active).reduce((s, b) => s + b.balance_cents, 0);

  const checksTotal = p?.checks.total ?? 0;
  const checksPass = p ? p.checks.total - p.checks.failing.length : 0;
  const checksPct = checksTotal > 0 ? (checksPass / checksTotal) * 100 : 0;
  const allClear = !!p && p.checks.passed && p.cashIn.unclassifiedCents === 0;

  const monthQuery = `?month=${month}`;
  const monthReportHref = `/reports/monthly${monthQuery}${branchId ? `&branch=${encodeURIComponent(branchId)}` : ""}`;

  const strip: { label: string; value: string; icon: IconCmp; href?: string; tone?: string; meter?: number }[] = [
    { label: "Spent today", value: todays.isLoading ? "—" : `${lkr(todayPosted)} LKR`, icon: CreditCardIcon, href: "/expenses?range=today" },
    {
      label: "Day closing",
      value: !branchId ? "Pick a branch" : closedToday ? "Closed" : p ? `${checksPass}/${checksTotal} checks pass` : "—",
      icon: ClipboardCheckIcon,
      href: "/day-closing",
      tone: closedToday ? "text-emerald-300" : undefined,
      meter: branchId && p ? (closedToday ? 100 : checksPct) : undefined,
    },
    { label: "Spent this month", value: summary.data ? `${lkr(monthPosted)} LKR` : "—", icon: TrendingUpIcon, href: "/expenses?range=month" },
    {
      label: "Net profit this month",
      value: r ? `${lkrSigned(r.profit.netProfitCents)} LKR` : "—",
      icon: ScaleIcon,
      href: monthReportHref,
      tone: r && r.profit.netProfitCents < 0 ? "text-rose-300" : undefined,
    },
  ];

  return (
    <Page>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-72 rounded-full bg-gold/20 blur-[100px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="relative flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Accounts
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-paper/40">{longDate(today)}</span>
            </div>
            <h1 className="g-display mt-2 text-2xl leading-tight text-paper sm:text-[28px]">
              Every rupee, <span className="home-gold-text">accounted for.</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={heroSelectClass} aria-label="Branch">
              {canShop ? <option value="">All branches</option> : null}
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {canManage ? (
              <Link href="/expenses?new=1" className="home-btn-gold h-10 px-4 text-sm">
                <PlusIcon size={15} />
                Record expense
              </Link>
            ) : null}
            {canManage ? (
              <Link href="/accounts/receivables" className="home-btn-ghost h-10 px-4 text-sm">
                <UsersIcon size={15} />
                Collect dues
              </Link>
            ) : null}
            <Link href="/day-closing" className="home-btn-ghost h-10 px-4 text-sm">
              <ClipboardCheckIcon size={15} />
              Close the day
            </Link>
          </div>
        </div>

        <div className="relative grid grid-cols-2 border-t border-paper/[0.08] lg:grid-cols-4">
          {strip.map((s, i) => {
            const body = (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper/[0.05] text-gold-light ring-1 ring-paper/[0.08] transition-colors group-hover:bg-gold group-hover:text-void">
                  <s.icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                  <span className={cn("g-metric mt-0.5 block truncate text-[15px]", s.tone ?? "text-paper")}>{s.value}</span>
                  {s.meter !== undefined ? (
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper/10">
                      <span
                        className={cn(
                          "block h-full rounded-full transition-[width] duration-700 ease-brand",
                          s.meter >= 100 ? "bg-emerald-400" : "bg-gradient-to-r from-gold-deep to-gold-light"
                        )}
                        style={{ width: `${s.meter}%` }}
                      />
                    </span>
                  ) : null}
                </span>
              </>
            );
            const cls = cn(
              "group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-paper/[0.04] sm:px-6",
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

      {/* ----------------------------------------------------------- jump to */}
      <Card>
        {/* 1px gaps over a tinted background draw the hairlines, so the grid
            stays ruled correctly at any column count and any tile count. */}
        <nav aria-label="Accounts pages" className="grid gap-px bg-ink/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          <NavTile
            href="/expenses"
            index="01"
            icon={BanknoteIcon}
            title="Expenses"
            description="Record and review spending"
            stat={pending.data?.total ? `${pending.data.total} awaiting approval` : "Nothing waiting"}
            statTone={pending.data?.total ? "warn" : "ok"}
          />
          <NavTile
            href="/accounts/cash"
            index="02"
            icon={CoinsIcon}
            title="Cash & bank"
            description="Balances, cash book, owner in/out"
            stat={banks.data ? `Banks ${lkr(bankTotal)} LKR` : "Drawer & bank balances"}
            statTone="info"
          />
          <NavTile
            href="/accounts/receivables"
            index="03"
            icon={UsersIcon}
            title="Customer dues"
            description="Collect credit-sale payments"
            stat={dues.data ? (dues.data.totalCents > 0 ? `${lkr(dues.data.totalCents)} LKR owed` : "Nobody owes the shop") : "Who owes the shop"}
            statTone={dues.data?.totalCents ? "warn" : "ok"}
          />
          <NavTile
            href="/day-closing"
            index="04"
            icon={ClipboardCheckIcon}
            title="Day closing"
            description="Count, explain, lock the day"
            stat={branchId ? (closedToday ? "Today is closed" : "Today is open") : "Pick a branch"}
            statTone={branchId ? (closedToday ? "ok" : "warn") : "muted"}
          />
          <NavTile
            href="/accounts/payables"
            index="05"
            icon={FileTextIcon}
            title="Supplier dues"
            description="What the shop owes, aged by bill"
            stat={r ? (r.payables.totalCents > 0 ? `${lkr(r.payables.totalCents)} LKR owed` : "Nothing owed") : "Open purchase bills"}
            statTone={r?.payables.totalCents ? "warn" : "ok"}
          />
          <NavTile
            href={monthReportHref}
            index="06"
            icon={TrendingUpIcon}
            title="Monthly report"
            description="Sales, profit, cash, stock"
            stat={r ? `Net ${lkrSigned(r.profit.netProfitCents)} LKR` : "Open the full report"}
            statTone="info"
          />
          <NavTile
            href="/accounts/statements"
            index="07"
            icon={ScaleIcon}
            title="Financial statements"
            description="P&L, balance sheet, trial balance"
            stat="Any period, live from the ledger"
          />
          <NavTile
            href="/accounts/chart"
            index="08"
            icon={BookOpenIcon}
            title="Chart of accounts"
            description="Ledger balances & adjustments"
            stat="Double-entry books"
          />
          <NavTile
            href="/accounts/tax"
            index="09"
            icon={TagsIcon}
            title="Sales tax"
            description="VAT charged, refunded and paid"
            stat="Tax return for any period"
          />
          <NavTile
            href="/accounts/year-end"
            index="10"
            icon={HistoryIcon}
            title="Financial year"
            description="Close the year, lock the books"
            stat="Retained earnings carried forward"
          />
        </nav>
      </Card>

      {/* -------------------------------------------------------------- today */}
      <SectionHead index="T-01" title="Today" sub={longDate(today)} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Spent today"
          icon={CreditCardIcon}
          cents={todays.data ? todayPosted : undefined}
          loading={todays.isLoading}
          sub={
            todayPending > 0
              ? `+ ${lkr(todayPending)} awaiting approval`
              : `${todayRows.length} ${todayRows.length === 1 ? "entry" : "entries"} today`
          }
          href="/expenses?range=today"
        />
        <KpiTile
          label="Sales today"
          icon={TrendingUpIcon}
          cents={p?.money.salesCents}
          loading={preview.isLoading && !!branchId}
          sub={p ? `Purchases ${lkr(p.money.purchasesCents)} · Old gold ${lkr(p.money.oldGoldCents)}` : "Select a branch"}
          delay={60}
        />
        <KpiTile
          label="Cash in drawer"
          icon={BanknoteIcon}
          cents={p?.closing.expectedCents}
          loading={preview.isLoading && !!branchId}
          sub={p ? `Opening ${lkr(p.openingCents)} · in ${lkr(p.cashIn.totalCents)} · out ${lkr(p.cashOut.totalCents)}` : "Expected — select a branch"}
          href="/day-closing"
          delay={120}
        />
        <KpiTile
          label="Bank balance"
          icon={CoinsIcon}
          cents={banks.data ? bankTotal : undefined}
          loading={banks.isLoading}
          sub={`${(banks.data ?? []).filter((b) => b.is_active).length} active accounts`}
          delay={180}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead
            icon={CreditCardIcon}
            title="Today's expenses"
            sub={`${todayRows.length} recorded · ${lkrFull(todayPosted)} LKR posted`}
            action={<HeadLink href="/expenses?range=today">Open register</HeadLink>}
          />
          <div className="px-3 pb-3 sm:px-4">
            {todays.isLoading ? (
              <div className="space-y-2.5 px-2 pb-2">
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
              </div>
            ) : todayRows.length === 0 ? (
              <div className="px-2 pb-2">
                <Empty icon={CreditCardIcon} title="No expenses today" desc="Anything the shop spends today shows up here the moment it is recorded." />
              </div>
            ) : (
              <ul>
                {todayRows.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/expenses/${e.id}`}
                      className="group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-gold-pale/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink transition-colors group-hover:text-gold-dark">
                          {e.description}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-4">
                          {e.category_name}
                          {e.vendor ? ` · ${e.vendor}` : ""} · <span className="font-mono">{e.number}</span>
                        </div>
                      </div>
                      <StatusPill status={e.status} />
                      <span className="g-metric w-24 shrink-0 text-right text-sm text-ink">{lkrFull(e.amount_cents)}</span>
                    </Link>
                  </li>
                ))}
                {todayRows.length > 8 ? (
                  <li className="px-3 py-2 text-xs text-ink-4">+ {todayRows.length - 8} more today</li>
                ) : null}
              </ul>
            )}
            {canManage ? (
              <Link
                href="/expenses?new=1"
                className="group mt-2 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium text-ink-4 ring-1 ring-ink/[0.08] transition-colors hover:bg-ink hover:text-paper hover:ring-ink"
              >
                <PlusIcon size={12} />
                Record an expense
              </Link>
            ) : null}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead
            icon={ClipboardCheckIcon}
            title="Day closing"
            sub={branchId ? "Is the drawer counted and locked?" : "Choose a branch above"}
            action={
              branchId ? (
                closedToday ? (
                  <Pill tone="success" dot>
                    Closed
                  </Pill>
                ) : (
                  <Pill tone="warning" dot>
                    Open
                  </Pill>
                )
              ) : undefined
            }
          />
          <div className="px-5 pb-5 sm:px-6">
            {!branchId ? (
              <Empty icon={ClipboardCheckIcon} title="Pick a branch" desc="Day closing is per branch — choose one to see today's status." />
            ) : preview.isLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : p ? (
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Expected cash</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xs text-ink-4">LKR</span>
                    <span className="g-metric text-3xl text-ink">{lkr(p.closing.expectedCents)}</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
                    <span className="uppercase tracking-[0.14em] text-ink-4">Closing checks</span>
                    <span className={cn("g-metric", allClear ? "text-emerald-700" : "text-amber-700")}>
                      {checksPass}/{checksTotal} pass
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-700 ease-brand",
                        allClear ? "bg-gradient-to-r from-emerald-700 to-emerald-500" : "bg-gradient-to-r from-gold-deep via-gold to-gold-light"
                      )}
                      style={{ width: `${checksPct}%` }}
                    />
                  </div>
                </div>
                <div
                  className={cn(
                    "flex items-start gap-2.5 rounded-xl p-3 text-sm",
                    allClear ? "bg-emerald-700/[0.07] text-emerald-800" : "bg-amber-600/[0.1] text-amber-800"
                  )}
                >
                  {allClear ? (
                    <>
                      <CheckCircleIcon size={16} className="mt-0.5 shrink-0" />
                      <span>All {p.checks.total} checks pass — ready to close.</span>
                    </>
                  ) : (
                    <>
                      <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
                      <span>{p.checks.passed ? "Some cash is unclassified." : `Fix before closing: ${p.checks.failing.join(", ")}.`}</span>
                    </>
                  )}
                </div>
                {p.closing.awaitingApprovalCents > 0 ? (
                  <p className="text-xs text-ink-4">
                    {lkr(p.closing.awaitingApprovalCents)} LKR of expenses are awaiting approval — cash reads high by that until approved.
                  </p>
                ) : null}
                {(closings.data?.rows ?? []).length > 0 ? (
                  <div className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.05]">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Recent closings</div>
                    <ul className="space-y-1.5">
                      {(closings.data?.rows ?? []).slice(0, 4).map((c) => (
                        <li key={c.id} className="flex items-center justify-between text-xs">
                          <span className="text-ink-3">{dayLabel(c.close_date)}</span>
                          <span className={cn("g-metric", c.difference_cents === 0 ? "text-emerald-700" : "text-rose-700")}>
                            {c.difference_cents === 0 ? "Balanced" : `${c.difference_cents > 0 ? "+" : "−"}${lkr(Math.abs(c.difference_cents))} diff`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <Empty icon={ClipboardCheckIcon} title="Unavailable" desc="Could not load today's cash position." />
            )}
          </div>
          <div className="border-t border-ink/[0.06] px-5 py-3 sm:px-6">
            <Link
              href="/day-closing"
              className="group flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium text-ink-4 ring-1 ring-ink/[0.08] transition-colors hover:bg-ink hover:text-paper hover:ring-ink"
            >
              {closedToday ? "View closing" : "Count the drawer & close"}
              <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* -------------------------------------------------------------- month */}
      <SectionHead
        index="M-01"
        title="Monthly accounts"
        sub={new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
        aside={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              max={today.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className={controlClass}
              aria-label="Month"
            />
            {!isCurrentMonth ? (
              <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="g-btn g-btn-secondary h-10 px-4 text-sm">
                This month
              </button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Sales (net)"
          icon={TrendingUpIcon}
          cents={r?.sales.netCents}
          loading={report.isLoading}
          sub={r ? `${r.sales.invoiceCount} invoices` : undefined}
        />
        <KpiTile
          label="Expenses"
          icon={CreditCardIcon}
          cents={summary.data ? monthPosted : undefined}
          loading={summary.isLoading}
          sub={monthPending > 0 ? `+ ${lkr(monthPending)} awaiting approval` : `≈ ${lkr(avgPerDay)} per day`}
          href="/expenses?range=month"
          delay={60}
        />
        <KpiTile
          label="Net profit"
          icon={ScaleIcon}
          cents={r?.profit.netProfitCents}
          format={lkrSigned}
          tone={r && r.profit.netProfitCents < 0 ? "bad" : "neutral"}
          loading={report.isLoading}
          sub={r ? `Gross ${lkr(r.profit.grossProfitCents)} − opex ${lkr(r.profit.operatingExpensesCents)}` : undefined}
          href={monthReportHref}
          delay={120}
        />
        <KpiTile
          label="Closing cash"
          icon={BanknoteIcon}
          cents={r?.cashflow.closingCents}
          loading={report.isLoading}
          sub={r ? `In ${lkr(r.cashflow.inflowsCents)} · out ${lkr(r.cashflow.outflowsCents)}` : undefined}
          delay={180}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead
            icon={CreditCardIcon}
            title="Daily expenses"
            sub="Posted spending per day"
            action={<HeadLink href="/expenses?range=month">This month</HeadLink>}
          />
          <div className="px-5 pb-5 sm:px-6">
            {daily.isLoading ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : daily.isError ? (
              <Empty icon={CreditCardIcon} title="Could not load" desc="The daily expense report is unavailable." />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-3 gap-3">
                  {[
                    ["Month total", `${lkr(monthPosted)}`],
                    ["Daily average", `${lkr(avgPerDay)}`],
                    ["Busiest day", peak && peak.posted + peak.pending > 0 ? `${dayLabel(peak.date)} · ${compact(peak.posted + peak.pending)}` : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-bone/70 p-3 ring-1 ring-ink/[0.05]">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{k}</div>
                      <div className="g-metric mt-1 truncate text-sm text-ink">{v}</div>
                    </div>
                  ))}
                </div>
                {activeDays === 0 ? (
                  <Empty icon={CreditCardIcon} title="No expenses this month" desc="Recorded expenses will chart here day by day." />
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-4">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-sm bg-[#C9A227]" /> Posted
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2 rounded-sm bg-[#E7C65A]/45" /> Awaiting approval
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 border-t border-dashed border-[#8C6D1F]" /> Daily average
                      </span>
                    </div>
                    <div className="h-60" role="img" aria-label={`Daily expenses for the month, ${activeDays} days with spending`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
                          <CartesianGrid stroke="rgba(28,25,23,0.06)" strokeDasharray="3 5" vertical={false} />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#78716c", fontSize: 11 }} interval="preserveStartEnd" />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            tick={{ fill: "#a8a29e", fontSize: 11 }}
                            tickFormatter={(v: number) => compact(v)}
                          />
                          <Tooltip
                            cursor={{ fill: "rgba(201,162,39,0.08)" }}
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
                            labelFormatter={(_, pl) => (pl?.[0]?.payload?.date ? dayLabel(pl[0].payload.date) : "")}
                            formatter={(v) => `LKR ${Number(v ?? 0).toLocaleString("en-US")}`}
                          />
                          {avgPerDay > 0 ? (
                            <ReferenceLine y={avgPerDay / 100} stroke="#8C6D1F" strokeDasharray="4 4" strokeOpacity={0.6} ifOverflow="extendDomain" />
                          ) : null}
                          <Bar dataKey="posted" name="Posted" stackId="a" fill="#C9A227" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="pending" name="Awaiting approval" stackId="a" fill="#E7C65A" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </Card>

        <section className="relative overflow-hidden rounded-2xl bg-void text-paper shadow-4 lg:col-span-2">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
          <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]" />
          <CardHead
            dark
            icon={BookOpenIcon}
            title="Where the money went"
            sub="This month, by expense category"
          />
          <div className="relative px-5 pb-5 sm:px-6">
            {summary.isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-xl bg-paper/10" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <Empty dark icon={BookOpenIcon} title="No spending yet" desc="Categories appear once expenses are recorded." />
            ) : (
              <BarList
                tone="dark"
                items={categories.slice(0, 7).map((c) => ({
                  key: c.id,
                  label: c.name,
                  value: c.posted_cents + c.pending_cents,
                  secondary:
                    monthPosted + monthPending > 0
                      ? `${Math.round(((c.posted_cents + c.pending_cents) / (monthPosted + monthPending)) * 100)}% of spend · ${c.account_code}`
                      : c.account_code,
                }))}
                format={(n) => lkr(n)}
              />
            )}
            <Link
              href="/expenses?range=month"
              className="group mt-4 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium text-paper/60 ring-1 ring-paper/10 transition-colors hover:bg-gold hover:text-void hover:ring-gold"
            >
              See every expense
              <ArrowRightIcon size={12} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHead icon={TrendingUpIcon} title="Profit & loss" sub={r ? r.profit.basis : "Ledger-posted"} />
          <div className="px-5 pb-5 sm:px-6">
            {report.isLoading ? (
              <Skeleton className="h-44 rounded-xl" />
            ) : r ? (
              <div>
                <StatementRow label="Revenue" cents={r.profit.revenueCents} />
                <StatementRow label="Cost of goods sold" cents={-r.profit.cogsCents} indent />
                <StatementRow label="Gross profit" cents={r.profit.grossProfitCents} />
                {r.profit.otherIncomeCents ? (
                  <StatementRow label="Other income" cents={r.profit.otherIncomeCents} indent />
                ) : null}
                <StatementRow label="Operating expenses" cents={-r.profit.operatingExpensesCents} indent />
                <StatementRow label="Net profit" cents={r.profit.netProfitCents} strong />
              </div>
            ) : (
              <Empty icon={TrendingUpIcon} title="No report" desc="Report unavailable for this period." />
            )}
          </div>
          <div className="border-t border-ink/[0.06] px-5 py-3 sm:px-6">
            <HeadLink href={monthReportHref}>Open the full monthly report</HeadLink>
          </div>
        </Card>

        <Card>
          <CardHead icon={BanknoteIcon} title="Cash flow" sub="Drawer + bank movement" />
          <div className="px-5 pb-5 sm:px-6">
            {report.isLoading ? (
              <Skeleton className="h-44 rounded-xl" />
            ) : r ? (
              <div>
                <StatementRow label="Opening cash" cents={r.cashflow.openingCents} />
                <StatementRow label="Cash in" cents={r.cashflow.inflowsCents} indent />
                <StatementRow label="Cash out" cents={-r.cashflow.outflowsCents} indent />
                <StatementRow label="Closing cash" cents={r.cashflow.closingCents} strong />
              </div>
            ) : (
              <Empty icon={BanknoteIcon} title="No report" desc="Report unavailable for this period." />
            )}
          </div>
          <div className="border-t border-ink/[0.06] px-5 py-3 sm:px-6">
            <HeadLink href={monthReportHref}>See where cash moved</HeadLink>
          </div>
        </Card>

        <Card>
          <CardHead icon={ScaleIcon} title="Owed to & by the shop" sub="Outstanding right now" />
          <div className="px-5 pb-5 sm:px-6">
            {report.isLoading ? (
              <Skeleton className="h-44 rounded-xl" />
            ) : r ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.05]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-3">Customers owe you</span>
                    <Signed cents={r.receivables.totalCents} className="text-lg" />
                  </div>
                  <div className="mt-1 text-xs text-ink-4">{r.receivables.outstanding.length} open invoices</div>
                </div>
                <div className="rounded-xl bg-bone/70 p-4 ring-1 ring-ink/[0.05]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-3">You owe suppliers</span>
                    <Signed cents={r.payables.totalCents} className="text-lg" />
                  </div>
                  <div className="mt-1 text-xs text-ink-4">{r.payables.outstanding.length} open bills</div>
                </div>
              </div>
            ) : (
              <Empty icon={ScaleIcon} title="No report" desc="Report unavailable for this period." />
            )}
          </div>
          <div className="border-t border-ink/[0.06] px-5 py-3 sm:px-6">
            <HeadLink href={monthReportHref}>Receivables & payables detail</HeadLink>
          </div>
        </Card>
      </div>

      {/* ------------------------------------------------------ needs attention */}
      {(pending.data?.rows.length ?? 0) > 0 || (r?.warnings.length ?? 0) > 0 ? (
        <section className="relative overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(180,83,9,0.28),0_18px_40px_-28px_rgba(180,83,9,0.35)]">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-amber-400/15 blur-3xl" />
          <div className="relative flex items-center gap-3 px-5 pb-4 pt-5 sm:px-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-600/10 text-amber-700 shadow-[inset_0_0_0_1px_rgba(180,83,9,0.25)]">
              <AlertCircleIcon size={16} />
            </span>
            <div>
              <h2 className="font-sans text-[15px] font-semibold tracking-normal text-ink">Needs your attention</h2>
              <p className="text-xs text-ink-4">Resolve these before you close the day or the month</p>
            </div>
          </div>
          <div className="relative grid gap-6 px-5 pb-5 sm:px-6 md:grid-cols-2">
            {(pending.data?.rows.length ?? 0) > 0 ? (
              <div>
                <SectionLabel className="mb-2">Expenses awaiting approval ({pending.data?.total})</SectionLabel>
                <ul className="divide-y divide-ink/[0.06]">
                  {pending.data?.rows.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <Link href={`/expenses/${e.id}`} className="min-w-0 truncate text-ink-2 transition-colors hover:text-gold-dark">
                        {e.description} <span className="text-ink-4">· {dayLabel(e.incurred_on)}</span>
                      </Link>
                      <span className="g-metric shrink-0 text-ink">{lkr(e.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <HeadLink href="/expenses">Review in the register</HeadLink>
                </div>
              </div>
            ) : null}
            {(r?.warnings.length ?? 0) > 0 ? (
              <div>
                <SectionLabel className="mb-2">Monthly report warnings</SectionLabel>
                <ul className="space-y-2">
                  {r?.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2.5 text-sm text-ink-2">
                      <AlertCircleIcon size={14} className="mt-0.5 shrink-0 text-amber-600" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </Page>
  );
}
