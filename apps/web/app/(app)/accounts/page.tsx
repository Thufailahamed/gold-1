"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { businessToday, monthBounds, type MonthlyReport } from "@/lib/monthly";
import {
  BarList,
  EmptyBlock,
  Hero,
  Page,
  Panel,
  Pill,
  SectionLabel,
  Skeleton,
  StatusPill,
  controlClass,
  heroBtnGhost,
  heroBtnPrimary,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  CreditCardIcon,
  PlusIcon,
  ScaleIcon,
  TrendingUpIcon,
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

/* ---------------------------------------------------------------- helpers */

const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
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

/* ------------------------------------------------------------- components */

function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  loading,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: ReactNode;
  tone?: "neutral" | "good" | "bad";
  loading?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink-3">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-b from-gold-soft to-gold-pale text-gold-deep shadow-[inset_0_0_0_1px_rgba(168,134,27,0.2)]">
          {icon}
        </span>
      </div>
      <div className="mt-5">
        {loading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <div
            className={cn(
              "g-metric text-3xl leading-none",
              tone === "good" && "text-emerald-700",
              tone === "bad" && "text-rose-700",
              tone === "neutral" && "text-ink"
            )}
          >
            {value}
          </div>
        )}
        {sub ? <div className="mt-2 truncate text-xs text-ink-4">{sub}</div> : null}
      </div>
    </>
  );
  const cls = "g-surface block p-5";
  return href ? (
    <Link href={href} className={cn(cls, "transition-all duration-240 ease-brand hover:-translate-y-0.5 hover:shadow-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function NavTile({
  href,
  icon,
  title,
  description,
  stat,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  stat?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl bg-void p-5 text-paper transition-transform duration-240 ease-brand hover:-translate-y-0.5"
    >
      <div className="pointer-events-none absolute -right-8 -top-10 size-28 rounded-full bg-gold/15 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="relative flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-xl bg-paper/[0.07] text-gold shadow-[inset_0_0_0_1px_rgba(250,250,249,0.1)]">
          {icon}
        </span>
        <ArrowRightIcon size={16} className="text-paper/30 transition-all group-hover:translate-x-0.5 group-hover:text-gold" />
      </div>
      <div className="relative">
        <div className="text-[15px] font-semibold">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-paper/55">{description}</p>
      </div>
      {stat ? <div className="relative mt-auto border-t border-paper/[0.08] pt-3 text-[11px] text-paper/50">{stat}</div> : null}
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
        "flex items-baseline justify-between gap-3 py-2",
        strong ? "border-t border-ink/[0.1] pt-3 text-[15px] font-semibold" : "text-sm text-ink-3",
        indent && "pl-4"
      )}
    >
      <span className="min-w-0 truncate" title={hint}>
        {label}
      </span>
      <Signed cents={cents} className={strong ? "text-lg" : "text-sm"} />
    </div>
  );
}

function CardLinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-dark transition-colors hover:text-ink">
      {children}
      <ArrowRightIcon size={12} />
    </Link>
  );
}

/* ------------------------------------------------------------------- page */

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

  const monthQuery = `?month=${month}`;
  const monthReportHref = `/reports/monthly${monthQuery}${branchId ? `&branch=${encodeURIComponent(branchId)}` : ""}`;

  return (
    <Page>
      <Hero
        kicker="Accounts"
        title="Accounts dashboard"
        description="Today's spending, the drawer, and the month's books — everything the shop owner checks, in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={controlClass}
              aria-label="Branch"
            >
              {canShop ? <option value="">All branches</option> : null}
              {visibleBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {canManage ? (
              <Link href="/expenses?new=1" className={heroBtnPrimary}>
                <PlusIcon size={15} />
                Record expense
              </Link>
            ) : null}
            <Link href="/day-closing" className={heroBtnGhost}>
              <ClipboardCheckIcon size={15} />
              Close the day
            </Link>
          </div>
        }
        stats={[
          { label: "Spent today", value: todays.isLoading ? "—" : `${lkr(todayPosted)} LKR` },
          { label: "Cash expected in drawer", value: p ? `${lkr(p.closing.expectedCents)} LKR` : "—" },
          { label: "Spent this month", value: summary.data ? `${lkr(monthPosted)} LKR` : "—" },
          { label: "Net profit this month", value: r ? `${lkr(r.profit.netProfitCents)} LKR` : "—" },
        ]}
        note={`${longDate(today)} · figures come straight from the ledger`}
      />

      {/* ---- where to go ---- */}
      <section aria-label="Accounts pages" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NavTile
          href="/expenses"
          icon={<BanknoteIcon size={18} />}
          title="Expenses"
          description="Record and review every rupee the shop spends."
          stat={pending.data?.total ? `${pending.data.total} awaiting approval` : "Nothing waiting for approval"}
        />
        <NavTile
          href="/day-closing"
          icon={<ClipboardCheckIcon size={18} />}
          title="Day closing"
          description="Count the drawer, explain differences, lock the day."
          stat={branchId ? (closedToday ? "Today is closed" : "Today is still open") : "Pick a branch to see status"}
        />
        <NavTile
          href={monthReportHref}
          icon={<TrendingUpIcon size={18} />}
          title="Monthly report"
          description="Sales, profit, cash flow, receivables and stock for any month."
          stat={r ? `Net profit ${lkr(r.profit.netProfitCents)} LKR` : "Open the full report"}
        />
        <NavTile
          href="/accounts/chart"
          icon={<BookOpenIcon size={18} />}
          title="Chart of accounts"
          description="Every ledger balance, plus manual adjustments."
          stat="Double-entry books"
        />
      </section>

      {/* ---- today ---- */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div>
          <SectionLabel>Today</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-ink">{longDate(today)}</h2>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Spent today"
          icon={<CreditCardIcon size={16} />}
          value={lkr(todayPosted)}
          loading={todays.isLoading}
          sub={
            todayPending > 0
              ? `+ ${lkr(todayPending)} awaiting approval`
              : `${todayRows.length} ${todayRows.length === 1 ? "entry" : "entries"} today`
          }
          href={`/expenses?range=today`}
        />
        <KpiCard
          label="Sales today"
          icon={<TrendingUpIcon size={16} />}
          value={p ? lkr(p.money.salesCents) : "—"}
          loading={preview.isLoading}
          sub={p ? `Purchases ${lkr(p.money.purchasesCents)} · Old gold ${lkr(p.money.oldGoldCents)}` : "Select a branch"}
        />
        <KpiCard
          label="Cash in drawer (expected)"
          icon={<BanknoteIcon size={16} />}
          value={p ? lkr(p.closing.expectedCents) : "—"}
          loading={preview.isLoading}
          sub={p ? `Opening ${lkr(p.openingCents)} · in ${lkr(p.cashIn.totalCents)} · out ${lkr(p.cashOut.totalCents)}` : "Select a branch"}
          href="/day-closing"
        />
        <KpiCard
          label="Bank balance"
          icon={<ScaleIcon size={16} />}
          value={lkr(bankTotal)}
          loading={banks.isLoading}
          sub={`${(banks.data ?? []).filter((b) => b.is_active).length} active accounts`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Today's expenses"
          icon={<CreditCardIcon size={17} />}
          description={`${todayRows.length} recorded · ${lkrFull(todayPosted)} LKR posted`}
          actions={
            canManage ? (
              <Link href="/expenses?new=1" className="g-btn g-btn-secondary h-8 px-3 text-xs">
                <PlusIcon size={13} /> Add
              </Link>
            ) : null
          }
          bodyClassName="p-0"
          footer={<CardLinkRow href="/expenses?range=today">Open the expense register</CardLinkRow>}
        >
          {todays.isLoading ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : todayRows.length === 0 ? (
            <EmptyBlock title="No expenses today" description="Anything the shop spends today will show up here as soon as it is recorded." />
          ) : (
            <ul className="divide-y divide-ink/[0.06]">
              {todayRows.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{e.description}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-4">
                      {e.category_name}
                      {e.vendor ? ` · ${e.vendor}` : ""} · <span className="font-mono">{e.number}</span>
                    </div>
                  </div>
                  <StatusPill status={e.status} />
                  <span className="g-metric w-24 shrink-0 text-right text-sm text-ink">{lkrFull(e.amount_cents)}</span>
                </li>
              ))}
              {todayRows.length > 8 ? (
                <li className="px-5 py-3 text-xs text-ink-4 sm:px-6">+ {todayRows.length - 8} more today</li>
              ) : null}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Day closing"
          icon={<ClipboardCheckIcon size={17} />}
          description={branchId ? "Is the drawer counted and locked?" : "Choose a branch above"}
          actions={
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
            ) : null
          }
          footer={<CardLinkRow href="/day-closing">{closedToday ? "View closing" : "Count the drawer & close"}</CardLinkRow>}
        >
          {!branchId ? (
            <p className="text-sm text-ink-3">Day closing is per branch. Pick one from the selector to see today's status.</p>
          ) : preview.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : p ? (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Expected cash</div>
                <div className="g-metric mt-1 text-3xl text-ink">{lkr(p.closing.expectedCents)}</div>
              </div>
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-lg p-3 text-sm",
                  p.checks.passed && p.cashIn.unclassifiedCents === 0
                    ? "bg-emerald-700/[0.07] text-emerald-800"
                    : "bg-amber-600/[0.1] text-amber-800"
                )}
              >
                {p.checks.passed && p.cashIn.unclassifiedCents === 0 ? (
                  <>
                    <CheckCircleIcon size={16} className="mt-0.5 shrink-0" />
                    <span>All {p.checks.total} checks pass — ready to close.</span>
                  </>
                ) : (
                  <>
                    <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
                    <span>
                      {p.checks.passed ? "Some cash is unclassified." : `Fix before closing: ${p.checks.failing.join(", ")}.`}
                    </span>
                  </>
                )}
              </div>
              {p.closing.awaitingApprovalCents > 0 ? (
                <p className="text-xs text-ink-4">
                  {lkr(p.closing.awaitingApprovalCents)} LKR of expenses are awaiting approval — cash reads high by that until approved.
                </p>
              ) : null}
              {(closings.data?.rows ?? []).length > 0 ? (
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-4">Recent closings</div>
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
            <p className="text-sm text-ink-3">Could not load today's cash position.</p>
          )}
        </Panel>
      </div>

      {/* ---- month ---- */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <SectionLabel>Monthly accounts</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
          </h2>
        </div>
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Sales (net)" icon={<TrendingUpIcon size={16} />} value={r ? lkr(r.sales.netCents) : "—"} loading={report.isLoading} sub={r ? `${r.sales.invoiceCount} invoices` : undefined} />
        <KpiCard
          label="Expenses"
          icon={<CreditCardIcon size={16} />}
          value={summary.data ? lkr(monthPosted) : "—"}
          loading={summary.isLoading}
          sub={monthPending > 0 ? `+ ${lkr(monthPending)} awaiting approval` : `≈ ${lkr(avgPerDay)} per day`}
          href={`/expenses?range=month`}
        />
        <KpiCard
          label="Net profit"
          icon={<ScaleIcon size={16} />}
          value={r ? <Signed cents={r.profit.netProfitCents} className="text-3xl" /> : "—"}
          loading={report.isLoading}
          sub={r ? `Gross ${lkr(r.profit.grossProfitCents)} − opex ${lkr(r.profit.operatingExpensesCents)}` : undefined}
        />
        <KpiCard label="Closing cash" icon={<BanknoteIcon size={16} />} value={r ? lkr(r.cashflow.closingCents) : "—"} loading={report.isLoading} sub={r ? `In ${lkr(r.cashflow.inflowsCents)} · out ${lkr(r.cashflow.outflowsCents)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Daily expenses"
          icon={<CreditCardIcon size={17} />}
          description="Posted spending per day; lighter bars are still awaiting approval"
        >
          {daily.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : daily.isError ? (
            <EmptyBlock title="Could not load" description="The daily expense report is unavailable." />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                {[
                  ["Month total", `${lkr(monthPosted)}`],
                  ["Daily average", `${lkr(avgPerDay)}`],
                  ["Busiest day", peak && peak.posted + peak.pending > 0 ? `${dayLabel(peak.date)} · ${compact(peak.posted + peak.pending)}` : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-bone p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{k}</div>
                    <div className="g-metric mt-1 truncate text-sm text-ink">{v}</div>
                  </div>
                ))}
              </div>
              {activeDays === 0 ? (
                <EmptyBlock title="No expenses this month" description="Recorded expenses will chart here day by day." />
              ) : (
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
                      <Bar dataKey="posted" name="Posted" stackId="a" fill="#C9A227" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="pending" name="Awaiting approval" stackId="a" fill="#E7C65A" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Where the money went"
          icon={<BookOpenIcon size={17} />}
          description="This month, by expense category"
          footer={<CardLinkRow href="/expenses?range=month">See every expense</CardLinkRow>}
        >
          {summary.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : categories.length === 0 ? (
            <EmptyBlock title="No spending yet" description="Categories appear once expenses are recorded." />
          ) : (
            <BarList
              tone="light"
              items={categories.slice(0, 7).map((c) => ({
                key: c.id,
                label: c.name,
                value: c.posted_cents + c.pending_cents,
                secondary: monthPosted + monthPending > 0 ? `${Math.round(((c.posted_cents + c.pending_cents) / (monthPosted + monthPending)) * 100)}% of spend · ${c.account_code}` : c.account_code,
              }))}
              format={(n) => lkr(n)}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Profit & loss"
          icon={<TrendingUpIcon size={17} />}
          description={r ? r.profit.basis : "Ledger-posted"}
          footer={<CardLinkRow href={monthReportHref}>Open the full monthly report</CardLinkRow>}
        >
          {report.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : r ? (
            <div className="divide-y divide-ink/[0.05]">
              <StatementRow label="Revenue" cents={r.profit.revenueCents} />
              <StatementRow label="Cost of goods sold" cents={-r.profit.cogsCents} indent />
              <StatementRow label="Gross profit" cents={r.profit.grossProfitCents} />
              <StatementRow label="Operating expenses" cents={-r.profit.operatingExpensesCents} indent />
              <StatementRow label="Net profit" cents={r.profit.netProfitCents} strong />
            </div>
          ) : (
            <p className="text-sm text-ink-3">Report unavailable for this period.</p>
          )}
        </Panel>

        <Panel
          title="Cash flow"
          icon={<BanknoteIcon size={17} />}
          description="Drawer + bank movement"
          footer={<CardLinkRow href={monthReportHref}>See where cash moved</CardLinkRow>}
        >
          {report.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : r ? (
            <div className="divide-y divide-ink/[0.05]">
              <StatementRow label="Opening cash" cents={r.cashflow.openingCents} />
              <StatementRow label="Cash in" cents={r.cashflow.inflowsCents} indent />
              <StatementRow label="Cash out" cents={-r.cashflow.outflowsCents} indent />
              <StatementRow label="Closing cash" cents={r.cashflow.closingCents} strong />
            </div>
          ) : (
            <p className="text-sm text-ink-3">Report unavailable for this period.</p>
          )}
        </Panel>

        <Panel
          title="Owed to & by the shop"
          icon={<ScaleIcon size={17} />}
          description="Outstanding right now"
          footer={<CardLinkRow href={monthReportHref}>Receivables & payables detail</CardLinkRow>}
        >
          {report.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : r ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-ink-3">Customers owe you</span>
                  <Signed cents={r.receivables.totalCents} className="text-lg" />
                </div>
                <div className="mt-0.5 text-xs text-ink-4">{r.receivables.outstanding.length} open invoices</div>
              </div>
              <div className="border-t border-ink/[0.07] pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-ink-3">You owe suppliers</span>
                  <Signed cents={r.payables.totalCents} className="text-lg" />
                </div>
                <div className="mt-0.5 text-xs text-ink-4">{r.payables.outstanding.length} open bills</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Report unavailable for this period.</p>
          )}
        </Panel>
      </div>

      {/* ---- needs attention ---- */}
      {(pending.data?.rows.length ?? 0) > 0 || (r?.warnings.length ?? 0) > 0 ? (
        <Panel title="Needs your attention" icon={<AlertCircleIcon size={17} />} description="Resolve these before you close the day or the month">
          <div className="grid gap-6 md:grid-cols-2">
            {(pending.data?.rows.length ?? 0) > 0 ? (
              <div>
                <SectionLabel className="mb-2">Expenses awaiting approval ({pending.data?.total})</SectionLabel>
                <ul className="divide-y divide-ink/[0.06]">
                  {pending.data?.rows.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-ink-2">
                        {e.description} <span className="text-ink-4">· {dayLabel(e.incurred_on)}</span>
                      </span>
                      <span className="g-metric shrink-0 text-ink">{lkr(e.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <CardLinkRow href="/expenses">Review in the register</CardLinkRow>
                </div>
              </div>
            ) : null}
            {(r?.warnings.length ?? 0) > 0 ? (
              <div>
                <SectionLabel className="mb-2">Monthly report warnings</SectionLabel>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
                  {r?.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </Page>
  );
}
