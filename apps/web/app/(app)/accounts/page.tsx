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
import { BarList, Page, Pill, SectionLabel, Skeleton, StatusPill } from "@/components/ui";
import { AskBooks } from "@/components/ask-books";
import { DailyBrief } from "@/components/daily-brief";
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

function Card({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <section
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl",
        dark
          ? "bg-void text-paper shadow-4"
          : "bg-paper shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_18px_40px_-30px_rgba(16,32,27,0.28)]",
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
    <div
      className={cn(
        "relative flex items-center justify-between gap-3 border-b px-4 py-2.5",
        dark ? "border-paper/[0.08]" : "border-ink/[0.06]"
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            dark
              ? "bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
              : "bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,138,62,0.2)]"
          )}
        >
          <Icon size={14} />
        </span>
        <div className="min-w-0 leading-tight">
          <h2 className={cn("truncate font-sans text-[13.5px] font-semibold tracking-normal", dark ? "text-paper" : "text-ink")}>{title}</h2>
          {sub ? <p className={cn("truncate text-[11px]", dark ? "text-paper/45" : "text-ink-4")}>{sub}</p> : null}
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
        "group inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
        dark ? "text-paper/50 hover:bg-paper/[0.06] hover:text-gold-light" : "text-ink-4 hover:bg-ink/[0.05] hover:text-ink"
      )}
    >
      {children}
      <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function Empty({ icon: Icon, title, desc, dark }: { icon: IconCmp; title: string; desc: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-dashed px-4 py-4",
        dark ? "border-paper/15 bg-paper/[0.02]" : "border-ink/[0.12] bg-bone/60"
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          dark ? "bg-paper/[0.06] text-gold-light" : "bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]"
        )}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className={cn("text-[13px] font-medium", dark ? "text-paper" : "text-ink")}>{title}</p>
        <p className={cn("text-[11px] leading-snug", dark ? "text-paper/50" : "text-ink-4")}>{desc}</p>
      </div>
    </div>
  );
}

/** One figure in the hero ledger strip; counts up and links to its desk. */
function HeroStat({
  label,
  cents,
  text,
  format = lkr,
  sub,
  tone,
  href,
  meter,
  loading,
}: {
  label: string;
  cents?: number;
  text?: string;
  format?: (n: number) => string;
  sub?: ReactNode;
  tone?: "good" | "bad";
  href?: string;
  meter?: number;
  loading?: boolean;
}) {
  const shown = useCountUp(cents);
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">{label}</span>
        {href ? (
          <ArrowRightIcon
            size={11}
            className="shrink-0 -translate-x-1 text-paper/30 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-gold-light group-hover:opacity-100"
          />
        ) : null}
      </span>
      {loading ? (
        <Skeleton className="mt-1.5 h-5 w-24 bg-paper/10" />
      ) : (
        <span className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
          {cents !== undefined ? <span className="text-[9.5px] font-semibold text-paper/35">LKR</span> : null}
          <span
            className={cn(
              "g-metric truncate text-[18px] leading-none",
              tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-paper"
            )}
          >
            {cents !== undefined ? format(shown) : text ?? "—"}
          </span>
        </span>
      )}
      {meter !== undefined ? (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-paper/10">
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-700 ease-brand",
              meter >= 100 ? "bg-emerald-400" : "bg-gradient-to-r from-gold-deep to-gold-light"
            )}
            style={{ width: `${meter}%` }}
          />
        </span>
      ) : sub ? (
        <span className="mt-1.5 block truncate text-[10.5px] text-paper/40">{sub}</span>
      ) : null}
    </>
  );
  const cls = "group block min-w-0 bg-void px-4 py-2.5 transition-colors hover:bg-[#0a3a2f]";
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A compact launcher cell for a desk or book. */
function DeskTile({
  href,
  icon: Icon,
  title,
  stat,
  statTone = "muted",
  book,
}: {
  href: string;
  icon: IconCmp;
  title: string;
  stat?: ReactNode;
  statTone?: "ok" | "warn" | "info" | "muted";
  book?: boolean;
}) {
  const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", info: "bg-gold", muted: "bg-ink/25" }[statTone];
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-w-0 items-center gap-2.5 px-3 py-2.5 transition-colors duration-200",
        book ? "bg-gradient-to-b from-paper to-gold-pale/40 hover:to-gold-pale" : "bg-paper hover:bg-gold-pale/50"
      )}
    >
      <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,138,62,0.22),inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-300 group-hover:from-void group-hover:to-ink-2 group-hover:text-gold-light">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] font-semibold text-ink transition-colors group-hover:text-gold-deep">{title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", dot, statTone === "warn" && "animate-pulse-soft")} />
          <span className="truncate text-[10.5px] text-ink-4">{stat}</span>
        </span>
      </span>
      <ArrowRightIcon
        size={12}
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
        "flex items-baseline justify-between gap-3",
        indent && "pl-3",
        strong
          ? "mt-1 rounded-lg bg-bone px-3 py-2 text-[13.5px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]"
          : "border-b border-dashed border-ink/[0.07] py-1.5 text-[12.5px] text-ink-3"
      )}
    >
      <span className="min-w-0 truncate" title={hint}>
        {label}
      </span>
      <Signed cents={cents} className={strong ? "text-[15px]" : "text-[12.5px]"} />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

const heroControl =
  "h-8 rounded-lg bg-paper/[0.07] px-2.5 text-[12.5px] text-paper shadow-[inset_0_0_0_1px_rgba(246,245,240,0.16)] transition-shadow duration-200 hover:bg-paper/[0.1] focus:outline-none focus:shadow-[inset_0_0_0_1px_#E2C27A,0_0_0_3px_rgba(205,168,83,0.3)] [color-scheme:dark] [&>option]:bg-paper [&>option]:text-ink";

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

  const branchName = visibleBranches.find((b) => b.id === branchId)?.name ?? "";
  const dayStatus = !branchId ? "Pick a branch" : closedToday ? "Today is closed" : "Today is open";

  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const attention = (pending.data?.rows.length ?? 0) > 0 || (r?.warnings.length ?? 0) > 0;
  const recentClosings = (closings.data?.rows ?? []).slice(0, 5);

  return (
    <Page className="space-y-4">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-[20px] bg-void text-paper shadow-5">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <div className="home-drift pointer-events-none absolute -right-24 -top-40 size-80 rounded-full bg-gold/[0.18] blur-[110px]" />
        <div className="pointer-events-none absolute -bottom-40 left-1/4 size-72 rounded-full bg-gold-deep/25 blur-[110px]" />
        <div className="home-noise pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        {/* title + controls */}
        <div className="relative flex flex-col gap-3 px-4 pt-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_24px_-10px_rgba(205,168,83,0.7)]">
              <ScaleIcon size={18} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="g-display text-[24px] leading-none">
                  Accounts <span className="home-gold-text">overview</span>
                </h1>
                <Link
                  href="/day-closing"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] transition-colors",
                    closedToday
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : branchId
                        ? "border-gold/25 bg-gold/[0.08] text-gold-light hover:bg-gold/15"
                        : "border-paper/15 bg-paper/5 text-paper/50"
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", closedToday ? "bg-emerald-400" : branchId ? "animate-pulse-soft bg-gold" : "bg-paper/30")} />
                  {dayStatus}
                </Link>
              </div>
              <div className="mt-1 truncate text-[11px] text-paper/45">
                {longDate(today)} · {branchName ? <span className="text-paper/70">{branchName}</span> : "All branches"} · reconciled from double entry
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={heroControl} aria-label="Branch">
              {canShop ? <option value="">All branches</option> : null}
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              type="month"
              value={month}
              max={today.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className={cn(heroControl, "g-metric w-[138px]")}
              aria-label="Month"
            />
            {!isCurrentMonth ? (
              <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="home-btn-ghost h-8 px-3 text-[12px]">
                This month
              </button>
            ) : null}
            <span className="mx-0.5 hidden h-5 w-px bg-paper/15 sm:block" aria-hidden />
            <Link href="/day-closing" className="home-btn-ghost h-8 px-3 text-[12.5px]">
              <ClipboardCheckIcon size={14} />
              Close day
            </Link>
            {canManage ? (
              <Link href="/accounts/receivables" className="home-btn-ghost h-8 px-3 text-[12.5px]">
                <UsersIcon size={14} />
                Collect dues
              </Link>
            ) : null}
            {canManage ? (
              <Link href="/expenses?new=1" className="home-btn-gold h-8 px-3.5 text-[12.5px]">
                <PlusIcon size={14} />
                Record expense
              </Link>
            ) : null}
          </div>
        </div>

        {/* ledger strip: today on top, the chosen month below */}
        <div className="relative mx-4 mt-4 overflow-hidden rounded-2xl bg-paper/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:mx-5">
          {[
            {
              group: "Today",
              hint: dayLabel(today),
              cells: [
                <HeroStat
                  key="spent"
                  label="Spent today"
                  cents={todays.data ? todayPosted : undefined}
                  loading={todays.isLoading}
                  sub={todayPending > 0 ? `+ ${lkr(todayPending)} awaiting` : `${todayRows.length} ${todayRows.length === 1 ? "entry" : "entries"}`}
                  href="/expenses?range=today"
                />,
                <HeroStat
                  key="sales"
                  label="Sales today"
                  cents={p?.money.salesCents}
                  loading={preview.isLoading && !!branchId}
                  sub={p ? `Purch ${lkr(p.money.purchasesCents)} · Old gold ${lkr(p.money.oldGoldCents)}` : "Pick a branch"}
                />,
                <HeroStat
                  key="drawer"
                  label="Cash in drawer"
                  cents={p?.closing.expectedCents}
                  loading={preview.isLoading && !!branchId}
                  sub={p ? `In ${lkr(p.cashIn.totalCents)} · out ${lkr(p.cashOut.totalCents)}` : "Expected cash"}
                  href="/day-closing"
                />,
                <HeroStat
                  key="close"
                  label="Closing checks"
                  text={!branchId ? "—" : closedToday ? "Closed" : p ? `${checksPass}/${checksTotal} pass` : "—"}
                  tone={closedToday || allClear ? "good" : undefined}
                  loading={preview.isLoading && !!branchId}
                  meter={branchId && p ? (closedToday ? 100 : checksPct) : undefined}
                  sub="Pick a branch"
                  href="/day-closing"
                />,
              ],
            },
            {
              group: "Month",
              hint: monthLabel,
              cells: [
                <HeroStat
                  key="msales"
                  label="Sales · net"
                  cents={r?.sales.netCents}
                  loading={report.isLoading}
                  sub={r ? `${r.sales.invoiceCount} invoices` : undefined}
                  href={monthReportHref}
                />,
                <HeroStat
                  key="mexp"
                  label="Expenses"
                  cents={summary.data ? monthPosted : undefined}
                  loading={summary.isLoading}
                  sub={monthPending > 0 ? `+ ${lkr(monthPending)} awaiting` : `≈ ${lkr(avgPerDay)} / day`}
                  href="/expenses?range=month"
                />,
                <HeroStat
                  key="mnet"
                  label="Net profit"
                  cents={r?.profit.netProfitCents}
                  format={lkrSigned}
                  tone={r ? (r.profit.netProfitCents < 0 ? "bad" : r.profit.netProfitCents > 0 ? "good" : undefined) : undefined}
                  loading={report.isLoading}
                  sub={r ? `Gross ${lkr(r.profit.grossProfitCents)} − opex ${lkr(r.profit.operatingExpensesCents)}` : undefined}
                  href={monthReportHref}
                />,
                <HeroStat
                  key="bank"
                  label="Bank balance"
                  cents={banks.data ? bankTotal : undefined}
                  loading={banks.isLoading}
                  sub={`${(banks.data ?? []).filter((b) => b.is_active).length} active accounts`}
                  href="/accounts/cash"
                />,
              ],
            },
          ].map((row, ri) => (
            <div
              key={row.group}
              className={cn(
                "grid grid-cols-2 gap-px sm:grid-cols-4 lg:grid-cols-[104px_repeat(4,minmax(0,1fr))]",
                ri > 0 && "mt-px"
              )}
            >
              <div className="col-span-2 flex items-center justify-between gap-2 bg-void/95 px-4 py-1.5 sm:col-span-4 lg:col-span-1 lg:flex-col lg:items-start lg:justify-center lg:py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-light">{row.group}</span>
                <span className="g-metric truncate text-[10px] text-paper/35">{row.hint}</span>
              </div>
              {row.cells}
            </div>
          ))}
        </div>

        {/* the assistant: ask the books in plain words */}
        <AskBooks branchId={branchId || undefined} className="mt-3" />
      </section>

      {/* ------------------------------------------------------ needs attention */}
      {attention ? (
        <section className="relative overflow-hidden rounded-2xl bg-paper shadow-[inset_0_0_0_1px_rgba(180,83,9,0.28),0_18px_40px_-30px_rgba(180,83,9,0.35)]">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-amber-400/15 blur-3xl" />
          <div className="relative grid md:grid-cols-[220px_1fr]">
            <div className="flex items-center gap-2.5 border-b border-amber-600/15 bg-amber-500/[0.06] px-4 py-3 md:border-b-0 md:border-r">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-600/10 text-amber-700 shadow-[inset_0_0_0_1px_rgba(180,83,9,0.25)]">
                <AlertCircleIcon size={14} />
              </span>
              <div className="leading-tight">
                <h2 className="text-[13.5px] font-semibold text-ink">Needs attention</h2>
                <p className="text-[11px] text-ink-4">Resolve before closing</p>
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-3 px-4 py-3 md:grid-cols-2">
              {(pending.data?.rows.length ?? 0) > 0 ? (
                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between">
                    <SectionLabel>Awaiting approval ({pending.data?.total})</SectionLabel>
                    <HeadLink href="/expenses">Review</HeadLink>
                  </div>
                  <ul className="divide-y divide-ink/[0.06]">
                    {pending.data?.rows.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]">
                        <Link href={`/expenses/${e.id}`} className="min-w-0 truncate text-ink-2 transition-colors hover:text-gold-dark">
                          {e.description} <span className="text-ink-4">· {dayLabel(e.incurred_on)}</span>
                        </Link>
                        <span className="g-metric shrink-0 text-ink">{lkr(e.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(r?.warnings.length ?? 0) > 0 ? (
                <div className="min-w-0">
                  <SectionLabel className="mb-1">Report warnings</SectionLabel>
                  <ul className="space-y-1">
                    {r?.warnings.map((w) => (
                      <li key={w} className="flex items-start gap-2 py-0.5 text-[12.5px] text-ink-2">
                        <AlertCircleIcon size={13} className="mt-0.5 shrink-0 text-amber-600" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------- desks */}
      <Card>
        {[
          {
            label: "Run the day",
            book: false,
            tiles: [
              {
                href: "/expenses",
                icon: BanknoteIcon,
                title: "Expenses",
                stat: pending.data?.total ? `${pending.data.total} awaiting approval` : "Nothing waiting",
                tone: pending.data?.total ? "warn" : "ok",
              },
              {
                href: "/accounts/cash",
                icon: CoinsIcon,
                title: "Cash & bank",
                stat: banks.data ? `Banks ${lkr(bankTotal)} LKR` : "Drawer & bank balances",
                tone: "info",
              },
              {
                href: "/accounts/receivables",
                icon: UsersIcon,
                title: "Customer dues",
                stat: dues.data ? (dues.data.totalCents > 0 ? `${lkr(dues.data.totalCents)} LKR owed` : "Nobody owes") : "Who owes the shop",
                tone: dues.data?.totalCents ? "warn" : "ok",
              },
              {
                href: "/accounts/payables",
                icon: FileTextIcon,
                title: "Supplier dues",
                stat: r ? (r.payables.totalCents > 0 ? `${lkr(r.payables.totalCents)} LKR owed` : "Nothing owed") : "Open purchase bills",
                tone: r?.payables.totalCents ? "warn" : "ok",
              },
              {
                href: "/day-closing",
                icon: ClipboardCheckIcon,
                title: "Day closing",
                stat: dayStatus,
                tone: branchId ? (closedToday ? "ok" : "warn") : "muted",
              },
            ],
          },
          {
            label: "Books & reports",
            book: true,
            tiles: [
              {
                href: monthReportHref,
                icon: TrendingUpIcon,
                title: "Monthly report",
                stat: r ? `Net ${lkrSigned(r.profit.netProfitCents)} LKR` : "Full month report",
                tone: "info",
              },
              { href: "/accounts/statements", icon: ScaleIcon, title: "Statements", stat: "P&L · balance sheet · TB", tone: "muted" },
              { href: "/accounts/chart", icon: BookOpenIcon, title: "Chart of accounts", stat: "Ledger balances", tone: "muted" },
              { href: "/accounts/tax", icon: TagsIcon, title: "Sales tax", stat: "VAT charged & paid", tone: "muted" },
              { href: "/accounts/year-end", icon: HistoryIcon, title: "Financial year", stat: "Close & lock the books", tone: "muted" },
            ],
          },
        ].map((g, gi) => (
          <nav
            key={g.label}
            aria-label={g.label}
            className={cn("grid lg:grid-cols-[132px_1fr]", gi > 0 && "border-t border-ink/[0.06]")}
          >
            <div className="flex items-center gap-2 border-b border-ink/[0.06] bg-bone/50 px-4 py-2 lg:border-b-0 lg:border-r">
              <span className="g-metric text-[10px] font-semibold tracking-[0.2em] text-gold-dark">{gi === 0 ? "A-01" : "A-02"}</span>
              <span className="text-[11.5px] font-semibold text-ink-2">{g.label}</span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-ink/[0.05] sm:grid-cols-2 lg:grid-cols-5">
              {g.tiles.map((t) => (
                <DeskTile
                  key={t.title}
                  href={t.href}
                  icon={t.icon}
                  title={t.title}
                  stat={t.stat}
                  statTone={t.tone as "ok" | "warn" | "info" | "muted"}
                  book={g.book}
                />
              ))}
            </div>
          </nav>
        ))}
      </Card>

      {/* ----------------------------------------------------- spend + closing */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHead
            icon={CreditCardIcon}
            title="Daily expenses"
            sub={`${monthLabel} · posted spending per day`}
            action={<HeadLink href="/expenses?range=month">Register</HeadLink>}
          />
          <div className="grid grid-cols-2 border-b border-ink/[0.06] sm:grid-cols-4">
            {[
              ["Month total", summary.data ? lkr(monthPosted) : "—"],
              ["Daily average", summary.data ? lkr(avgPerDay) : "—"],
              ["Busiest day", peak && peak.posted + peak.pending > 0 ? `${dayLabel(peak.date)} · ${compact(peak.posted + peak.pending)}` : "—"],
              ["Days with spend", `${activeDays} / ${chartData.length}`],
            ].map(([k, v], i) => (
              <div key={k} className={cn("px-4 py-2", i % 2 === 1 && "border-l border-ink/[0.06]", i >= 2 && "border-t border-ink/[0.06] sm:border-t-0", i === 2 && "sm:border-l")}>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</div>
                <div className="g-metric mt-0.5 truncate text-[13px] text-ink">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex-1 px-3 pb-3 pt-2">
            {daily.isLoading ? (
              <Skeleton className="h-52 rounded-xl" />
            ) : daily.isError ? (
              <Empty icon={CreditCardIcon} title="Could not load" desc="The daily expense report is unavailable." />
            ) : activeDays === 0 ? (
              <div className="flex h-52 items-center justify-center">
                <Empty icon={CreditCardIcon} title="No expenses this month" desc="Recorded expenses will chart here day by day." />
              </div>
            ) : (
              <>
                <div className="mb-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 px-1 text-[10.5px] text-ink-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-[#CDA853]" /> Posted
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-[#E2C27A]/45" /> Awaiting
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 border-t border-dashed border-[#7E6223]" /> Average
                  </span>
                </div>
                <div className="h-52" role="img" aria-label={`Daily expenses for the month, ${activeDays} days with spending`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
                      <CartesianGrid stroke="rgba(16,32,27,0.06)" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#5d6e68", fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tickLine={false} axisLine={false} width={40} tick={{ fill: "#93a29c", fontSize: 10 }} tickFormatter={(v: number) => compact(v)} />
                      <Tooltip
                        cursor={{ fill: "rgba(205,168,83,0.08)" }}
                        contentStyle={{
                          borderRadius: 10,
                          border: "none",
                          background: "#062a22",
                          color: "#fff",
                          fontSize: 12,
                          boxShadow: "0 20px 40px -16px rgba(0,0,0,0.5)",
                        }}
                        labelStyle={{ color: "#E2C27A", fontWeight: 600, marginBottom: 4 }}
                        itemStyle={{ color: "#f6f5f0" }}
                        labelFormatter={(_, pl) => (pl?.[0]?.payload?.date ? dayLabel(pl[0].payload.date) : "")}
                        formatter={(v) => `LKR ${Number(v ?? 0).toLocaleString("en-US")}`}
                      />
                      {avgPerDay > 0 ? (
                        <ReferenceLine y={avgPerDay / 100} stroke="#7E6223" strokeDasharray="4 4" strokeOpacity={0.6} ifOverflow="extendDomain" />
                      ) : null}
                      <Bar dataKey="posted" name="Posted" stackId="a" fill="#CDA853" />
                      <Bar dataKey="pending" name="Awaiting approval" stackId="a" fill="#E2C27A" fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-4">
          <CardHead
            icon={ClipboardCheckIcon}
            title="Day closing"
            sub={branchId ? "Drawer counted and locked?" : "Choose a branch above"}
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
          <div className="flex-1 p-4">
            {!branchId ? (
              <Empty icon={ClipboardCheckIcon} title="Pick a branch" desc="Day closing is per branch." />
            ) : preview.isLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : p ? (
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Expected cash</div>
                    <div className="mt-0.5 flex items-baseline gap-1">
                      <span className="text-[10px] font-semibold text-ink-5">LKR</span>
                      <span className="g-metric text-[24px] leading-none text-ink">{lkr(p.closing.expectedCents)}</span>
                    </div>
                  </div>
                  <span className={cn("g-metric text-[12px] font-semibold", allClear ? "text-emerald-700" : "text-amber-700")}>
                    {checksPass}/{checksTotal} checks
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
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-ink/[0.06] text-center">
                  {[
                    ["Opening", p.openingCents],
                    ["Cash in", p.cashIn.totalCents],
                    ["Cash out", p.cashOut.totalCents],
                  ].map(([k, v]) => (
                    <div key={k as string} className="bg-bone/70 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-5">{k}</div>
                      <div className="g-metric text-[12px] text-ink">{lkr(v as number)}</div>
                    </div>
                  ))}
                </div>
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]",
                    allClear ? "bg-emerald-700/[0.07] text-emerald-800" : "bg-amber-600/[0.1] text-amber-800"
                  )}
                >
                  {allClear ? (
                    <>
                      <CheckCircleIcon size={14} className="mt-px shrink-0" />
                      <span>All {p.checks.total} checks pass — ready to close.</span>
                    </>
                  ) : (
                    <>
                      <AlertCircleIcon size={14} className="mt-px shrink-0" />
                      <span>
                        {p.checks.passed
                          ? `${lkr(p.cashIn.unclassifiedCents)} LKR cash is unclassified.`
                          : `Fix: ${p.checks.failing.join(", ")}.`}
                      </span>
                    </>
                  )}
                </div>
                {recentClosings.length > 0 ? (
                  <div>
                    <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-5">Recent closings</div>
                    <ul className="divide-y divide-ink/[0.05]">
                      {recentClosings.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 py-1 text-[11.5px]">
                          <span className="text-ink-3">{dayLabel(c.close_date)}</span>
                          <span className="g-metric text-ink-4">{lkr(c.actual_cents)}</span>
                          <span className={cn("g-metric w-24 text-right", c.difference_cents === 0 ? "text-emerald-700" : "text-rose-700")}>
                            {c.difference_cents === 0 ? "Balanced" : `${c.difference_cents > 0 ? "+" : "−"}${lkr(Math.abs(c.difference_cents))}`}
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
          <div className="border-t border-ink/[0.06] px-4 py-2">
            <Link
              href="/day-closing"
              className="group flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-ink/[0.08] transition-colors hover:bg-void hover:text-gold-light hover:ring-void"
            >
              {closedToday ? "View closing" : "Count the drawer & close"}
              <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* --------------------------------------------- today's spend + categories */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHead
            icon={CreditCardIcon}
            title="Today's expenses"
            sub={`${todayRows.length} recorded · ${lkrFull(todayPosted)} LKR posted`}
            action={
              <div className="flex items-center gap-1">
                {canManage ? (
                  <Link
                    href="/expenses?new=1"
                    className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light transition hover:bg-void/90"
                  >
                    <PlusIcon size={11} />
                    New
                  </Link>
                ) : null}
                <HeadLink href="/expenses?range=today">Register</HeadLink>
              </div>
            }
          />
          <div className="flex-1">
            {todays.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
              </div>
            ) : todayRows.length === 0 ? (
              <div className="p-3">
                <Empty icon={CreditCardIcon} title="No expenses today" desc="Anything spent today shows up here the moment it is recorded." />
              </div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-bone/60 text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">
                    <th className="py-1.5 pl-4 pr-2 font-semibold">Description</th>
                    <th className="hidden px-2 font-semibold md:table-cell">Category</th>
                    <th className="px-2 font-semibold">Status</th>
                    <th className="py-1.5 pl-2 pr-4 text-right font-semibold">LKR</th>
                  </tr>
                </thead>
                <tbody>
                  {todayRows.slice(0, 10).map((e) => (
                    <tr key={e.id} className="group border-t border-ink/[0.05] transition-colors hover:bg-gold-pale/40">
                      <td className="max-w-0 py-1.5 pl-4 pr-2">
                        <Link href={`/expenses/${e.id}`} className="block truncate font-medium text-ink group-hover:text-gold-dark">
                          {e.description}
                        </Link>
                        <span className="block truncate text-[10.5px] text-ink-5">
                          <span className="font-mono">{e.number}</span>
                          {e.vendor ? ` · ${e.vendor}` : ""}
                        </span>
                      </td>
                      <td className="hidden truncate px-2 text-ink-3 md:table-cell">{e.category_name}</td>
                      <td className="px-2">
                        <StatusPill status={e.status} />
                      </td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{lkrFull(e.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {todayRows.length > 10 ? <p className="border-t border-ink/[0.05] px-4 py-1.5 text-[11px] text-ink-4">+ {todayRows.length - 10} more today</p> : null}
          </div>
        </Card>

        <Card dark className="xl:col-span-5">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" />
          <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]" />
          <CardHead
            dark
            icon={BookOpenIcon}
            title="Where the money went"
            sub={`${monthLabel} · by expense category`}
            action={<HeadLink dark href="/expenses?range=month">All</HeadLink>}
          />
          <div className="relative flex-1 p-4">
            {summary.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-9 rounded-lg bg-paper/10" />
                ))}
              </div>
            ) : categories.length === 0 ? (
              <Empty dark icon={BookOpenIcon} title="No spending yet" desc="Categories appear once expenses are recorded." />
            ) : (
              <BarList
                tone="dark"
                items={categories.slice(0, 6).map((c) => ({
                  key: c.id,
                  label: c.name,
                  value: c.posted_cents + c.pending_cents,
                  secondary:
                    monthPosted + monthPending > 0
                      ? `${Math.round(((c.posted_cents + c.pending_cents) / (monthPosted + monthPending)) * 100)}% · ${c.account_code}`
                      : c.account_code,
                }))}
                format={(n) => lkr(n)}
              />
            )}
          </div>
        </Card>
      </div>

      {/* ---------------------------------------------------------- statements */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHead icon={TrendingUpIcon} title="Profit & loss" sub={r ? r.profit.basis : "Ledger-posted"} action={<HeadLink href={monthReportHref}>Report</HeadLink>} />
          <div className="flex-1 px-4 py-2.5">
            {report.isLoading ? (
              <Skeleton className="h-36 rounded-lg" />
            ) : r ? (
              <div>
                <StatementRow label="Revenue" cents={r.profit.revenueCents} />
                <StatementRow label="Cost of goods sold" cents={-r.profit.cogsCents} indent />
                <StatementRow label="Gross profit" cents={r.profit.grossProfitCents} />
                {r.profit.otherIncomeCents ? <StatementRow label="Other income" cents={r.profit.otherIncomeCents} indent /> : null}
                <StatementRow label="Operating expenses" cents={-r.profit.operatingExpensesCents} indent />
                <StatementRow label="Net profit" cents={r.profit.netProfitCents} strong />
              </div>
            ) : (
              <Empty icon={TrendingUpIcon} title="No report" desc="Unavailable for this period." />
            )}
          </div>
        </Card>

        <Card>
          <CardHead icon={BanknoteIcon} title="Cash flow" sub="Drawer + bank movement" action={<HeadLink href={monthReportHref}>Detail</HeadLink>} />
          <div className="flex-1 px-4 py-2.5">
            {report.isLoading ? (
              <Skeleton className="h-36 rounded-lg" />
            ) : r ? (
              <div>
                <StatementRow label="Opening cash" cents={r.cashflow.openingCents} />
                <StatementRow label="Cash in" cents={r.cashflow.inflowsCents} indent />
                <StatementRow label="Cash out" cents={-r.cashflow.outflowsCents} indent />
                <StatementRow label="Net movement" cents={r.cashflow.inflowsCents - r.cashflow.outflowsCents} />
                <StatementRow label="Closing cash" cents={r.cashflow.closingCents} strong />
              </div>
            ) : (
              <Empty icon={BanknoteIcon} title="No report" desc="Unavailable for this period." />
            )}
          </div>
        </Card>

        <Card>
          <CardHead icon={ScaleIcon} title="Owed to & by the shop" sub="Outstanding right now" />
          <div className="flex-1 space-y-2 p-4">
            {report.isLoading ? (
              <Skeleton className="h-36 rounded-lg" />
            ) : r ? (
              <>
                {[
                  { k: "Customers owe you", v: r.receivables.totalCents, n: `${r.receivables.outstanding.length} open invoices`, href: "/accounts/receivables" },
                  { k: "You owe suppliers", v: r.payables.totalCents, n: `${r.payables.outstanding.length} open bills`, href: "/accounts/payables" },
                ].map((x) => (
                  <Link key={x.k} href={x.href} className="group block rounded-lg bg-bone/70 px-3 py-2 ring-1 ring-ink/[0.05] transition hover:bg-gold-pale/60 hover:ring-gold/30">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-ink-3">{x.k}</span>
                      <Signed cents={x.v} className="text-[15px]" />
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10.5px] text-ink-4">
                      {x.n}
                      <ArrowRightIcon size={11} className="opacity-0 transition group-hover:opacity-100" />
                    </div>
                  </Link>
                ))}
                <div className="flex items-baseline justify-between px-1 pt-1 text-[11.5px]">
                  <span className="text-ink-4">Net position</span>
                  <Signed cents={r.receivables.totalCents - r.payables.totalCents} className="text-[13px] font-semibold" />
                </div>
              </>
            ) : (
              <Empty icon={ScaleIcon} title="No report" desc="Unavailable for this period." />
            )}
          </div>
        </Card>

        <DailyBrief />
      </div>
    </Page>
  );
}
