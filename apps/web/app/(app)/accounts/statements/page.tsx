"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Callout,
  EmptyBlock,
  FilterChips,
  Hero,
  Page,
  Panel,
  Skeleton,
  TableCard,
  Tabs,
  Toolbar,
  controlSmClass,
  heroBtnGhost,
} from "@/components/ui";
import { BookOpenIcon, PrinterIcon, ScaleIcon, TrendingUpIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { businessToday } from "@/lib/monthly";
import { lkr, lkrSigned, longDate, useAccountsScope } from "@/lib/accounts";

type Line = { code: string; name: string; cents: number };
type Pnl = {
  from: string;
  to: string;
  revenue: Line[];
  costOfSales: Line[];
  operating: Line[];
  totalRevenueCents: number;
  totalCostOfSalesCents: number;
  grossProfitCents: number;
  totalOperatingCents: number;
  netProfitCents: number;
};
type BalanceSheet = {
  date: string;
  assets: Line[];
  liabilities: Line[];
  equity: Line[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  profitToDateCents: number;
  balanced: boolean;
};
type TrialRow = { code: string; name: string; type: string; debitCents: number; creditCents: number; balanceCents: number };

type Tab = "pnl" | "balance" | "trial";

function periodFor(key: string, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (key === "last-month") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    const mm = String(pm).padStart(2, "0");
    return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
  }
  if (key === "year") return { from: `${y}-01-01`, to: today };
  if (key === "today") return { from: today, to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

function StatementsView() {
  const params = useSearchParams();
  const today = businessToday();
  const { branchId, setBranchId, ready, canShop, visibleBranches, branchName } = useAccountsScope();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "balance" || initial === "trial" ? initial : "pnl");
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 8)}01`);
  const [customTo, setCustomTo] = useState(today);
  const [asOf, setAsOf] = useState(today);

  const { from, to } = period === "custom" ? { from: customFrom, to: customTo } : periodFor(period, today);
  const bq = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
  const scopeLabel = branchId ? branchName(branchId) : "Whole shop";

  const pnl = useQuery({
    enabled: ready && tab === "pnl" && from <= to,
    queryKey: ["statements", "pnl", from, to, branchId],
    queryFn: () => api<Pnl>(`/api/v1/accounts/statements/pnl?from=${from}&to=${to}${bq}`),
  });
  const bs = useQuery({
    enabled: ready && tab === "balance",
    queryKey: ["statements", "bs", asOf, branchId],
    queryFn: () => api<BalanceSheet>(`/api/v1/accounts/statements/balance-sheet?date=${asOf}${bq}`),
  });
  const tb = useQuery({
    enabled: ready && tab === "trial",
    queryKey: ["statements", "tb", asOf, branchId],
    queryFn: () => api<{ date: string; rows: TrialRow[] }>(`/api/v1/accounts/trial-balance?date=${asOf}${bq}`),
  });

  const heroStats =
    tab === "pnl"
      ? [
          { label: "Income", value: pnl.data ? lkr(pnl.data.totalRevenueCents) : "—" },
          { label: "Gross profit", value: pnl.data ? lkrSigned(pnl.data.grossProfitCents) : "—" },
          { label: "Running costs", value: pnl.data ? lkr(pnl.data.totalOperatingCents) : "—" },
          { label: "Net profit", value: pnl.data ? lkrSigned(pnl.data.netProfitCents) : "—" },
        ]
      : tab === "balance"
        ? [
            { label: "The shop owns", value: bs.data ? lkr(bs.data.totalAssetsCents) : "—" },
            { label: "The shop owes", value: bs.data ? lkr(bs.data.totalLiabilitiesCents) : "—" },
            { label: "Owner's worth", value: bs.data ? lkrSigned(bs.data.totalEquityCents) : "—" },
            { label: "Books balance", value: bs.data ? (bs.data.balanced ? "Yes" : "No") : "—" },
          ]
        : [
            { label: "Accounts with activity", value: tb.data ? String(tb.data.rows.length) : "—" },
            { label: "Total debits", value: tb.data ? lkr(tb.data.rows.reduce((s, r) => s + Math.max(r.balanceCents, 0), 0)) : "—" },
            { label: "Total credits", value: tb.data ? lkr(tb.data.rows.reduce((s, r) => s + Math.max(-r.balanceCents, 0), 0)) : "—" },
          ];

  return (
    <Page>
      <Hero
        compact
        kicker="Accounts"
        title="Financial statements"
        description="Profit & loss, balance sheet and trial balance — built live from the double-entry ledger, for any period."
        actions={
          <button type="button" onClick={() => window.print()} className={heroBtnGhost}>
            <PrinterIcon size={15} />
            Print
          </button>
        }
        stats={heroStats}
        note={`${scopeLabel} · ${tab === "pnl" ? `${longDate(from)} – ${longDate(to)}` : `as of ${longDate(asOf)}`}`}
      />

      <Toolbar
        actions={
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={controlSmClass} aria-label="Branch">
            {canShop ? <option value="">Whole shop</option> : null}
            {visibleBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
      >
        <Tabs
          ariaLabel="Statement"
          value={tab}
          onChange={setTab}
          items={[
            { key: "pnl", label: "Profit & loss", icon: <TrendingUpIcon size={14} /> },
            { key: "balance", label: "Balance sheet", icon: <ScaleIcon size={14} /> },
            { key: "trial", label: "Trial balance", icon: <BookOpenIcon size={14} /> },
          ]}
        />
      </Toolbar>

      <div className="flex flex-wrap items-center gap-3">
        {tab === "pnl" ? (
          <>
            <FilterChips
              ariaLabel="Period"
              value={period}
              onChange={setPeriod}
              options={[
                { key: "today", label: "Today" },
                { key: "month", label: "This month" },
                { key: "last-month", label: "Last month" },
                { key: "year", label: "This year" },
                { key: "custom", label: "Pick dates" },
              ]}
            />
            {period === "custom" ? (
              <span className="flex items-center gap-2 text-xs text-ink-4">
                <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={controlSmClass} />
                to
                <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} className={controlSmClass} />
              </span>
            ) : null}
          </>
        ) : (
          <label className="flex items-center gap-2 text-xs text-ink-4">
            As of
            <input type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} className={controlSmClass} />
          </label>
        )}
      </div>

      <div className="print-area w-full">
      {tab === "pnl" ? (
        pnl.isLoading || !ready ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : pnl.isError ? (
          <EmptyBlock title="Could not build the statement" description={(pnl.error as Error).message} />
        ) : pnl.data ? (
          <Panel title="Profit & loss" icon={<TrendingUpIcon size={17} />} description={`${scopeLabel} · ${longDate(from)} – ${longDate(to)}`}>
            <Section title="Income" lines={pnl.data.revenue} totalLabel="Total income" total={pnl.data.totalRevenueCents} />
            <Section title="Cost of goods sold & gold losses" lines={pnl.data.costOfSales} totalLabel="Total cost of sales" total={pnl.data.totalCostOfSalesCents} negative />
            <Total label="Gross profit" cents={pnl.data.grossProfitCents} />
            <Section title="Running costs (expenses)" lines={pnl.data.operating} totalLabel="Total running costs" total={pnl.data.totalOperatingCents} negative />
            <Total label="Net profit" cents={pnl.data.netProfitCents} strong />
            {pnl.data.totalRevenueCents > 0 ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {[
                  ["Gross margin", (pnl.data.grossProfitCents / pnl.data.totalRevenueCents) * 100],
                  ["Net margin", (pnl.data.netProfitCents / pnl.data.totalRevenueCents) * 100],
                ].map(([k, v]) => (
                  <span key={k} className="inline-flex items-baseline gap-2 rounded-full bg-bone px-3 py-1 text-xs text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]">
                    {k}
                    <span className={cn("g-metric font-semibold", Number(v) < 0 ? "text-rose-700" : "text-ink")}>{Number(v).toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            ) : null}
          </Panel>
        ) : null
      ) : tab === "balance" ? (
        bs.isLoading || !ready ? (
          <Skeleton className="h-96 rounded-xl" />
        ) : bs.isError ? (
          <EmptyBlock title="Could not build the balance sheet" description={(bs.error as Error).message} />
        ) : bs.data ? (
          <div className="space-y-4">
            {!bs.data.balanced ? (
              <Callout tone="danger" title="The books do not balance">
                What the shop owns differs from what it owes plus the owner&apos;s worth by{" "}
                {lkr(Math.abs(bs.data.totalAssetsCents - bs.data.totalLiabilitiesCents - bs.data.totalEquityCents))}. A one-sided entry needs fixing — check the trial balance.
              </Callout>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="What the shop owns" icon={<ScaleIcon size={17} />} description="Assets">
                <Section lines={bs.data.assets} totalLabel="Total assets" total={bs.data.totalAssetsCents} />
              </Panel>
              <Panel title="What the shop owes, and the owner's worth" icon={<ScaleIcon size={17} />} description="Liabilities + equity">
                <Section title="Owed to others" lines={bs.data.liabilities} totalLabel="Total liabilities" total={bs.data.totalLiabilitiesCents} />
                <Section title="Owner's worth" lines={bs.data.equity} totalLabel="Total equity" total={bs.data.totalEquityCents} />
                <Total label="Liabilities + equity" cents={bs.data.totalLiabilitiesCents + bs.data.totalEquityCents} strong />
              </Panel>
            </div>
          </div>
        ) : null
      ) : tb.isLoading || !ready ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : tb.isError ? (
        <EmptyBlock title="Could not build the trial balance" description={(tb.error as Error).message} />
      ) : (
        <TrialBalance rows={tb.data?.rows ?? []} />
      )}
      </div>
    </Page>
  );
}

function Section({
  title,
  lines,
  totalLabel,
  total,
  negative,
}: {
  title?: string;
  lines: Line[];
  totalLabel: string;
  total: number;
  negative?: boolean;
}) {
  return (
    <div className="mb-4">
      {title ? (
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-dark">
          <span className="size-1 rounded-full bg-gold" />
          {title}
        </div>
      ) : null}
      {lines.length === 0 ? (
        <div className="border-b border-ink/20 py-2 text-sm text-ink-5">Nothing in this period</div>
      ) : (
        lines.map((l) => (
          <div key={l.code} className="group flex items-baseline gap-3 rounded-lg py-2 pl-3 pr-1 text-sm transition-colors hover:bg-gold-pale/70">
            <span className="min-w-0 truncate text-ink-3">
              <span className="mr-2 font-mono text-[11px] text-ink-5 group-hover:text-gold-dark">{l.code}</span>
              {l.name}
            </span>
            <span className="min-w-6 flex-1 -translate-y-1 border-b border-dotted border-ink/20" aria-hidden />
            <span className={cn("g-metric shrink-0", l.cents < 0 ? "text-rose-700" : "text-ink-2")}>{negative ? `(${lkr(l.cents)})` : lkrSigned(l.cents)}</span>
          </div>
        ))
      )}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-ink/20 px-1 pt-2.5 text-sm font-semibold text-ink">
        <span>{totalLabel}</span>
        <span className="g-metric">{negative ? `(${lkr(total)})` : lkrSigned(total)}</span>
      </div>
    </div>
  );
}

function Total({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div
      className={cn(
        "relative mb-4 flex items-baseline justify-between gap-3 overflow-hidden rounded-xl px-4 py-3",
        strong
          ? "bg-void py-4 text-lg font-bold text-paper shadow-[0_18px_36px_-20px_rgba(6,42,34,0.7)] print:bg-transparent print:text-ink print:shadow-none"
          : "bg-gradient-to-r from-gold-pale to-bone text-[15px] font-semibold shadow-[inset_0_0_0_1px_rgba(168,138,62,0.18)]"
      )}
    >
      {strong ? <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" /> : null}
      <span className={strong ? "text-paper print:text-ink" : "text-ink"}>{label}</span>
      <span
        className={cn(
          "g-metric",
          cents < 0 ? (strong ? "text-rose-300 print:text-rose-700" : "text-rose-700") : strong ? "text-gold-light print:text-ink" : "text-ink"
        )}
      >
        <span className={cn("mr-1.5 text-[11px] font-medium", strong ? "text-paper/40" : "text-ink-4")}>LKR</span>
        {lkrSigned(cents)}
      </span>
    </div>
  );
}

function TrialBalance({ rows }: { rows: TrialRow[] }) {
  const dr = rows.reduce((s, r) => s + Math.max(r.balanceCents, 0), 0);
  const cr = rows.reduce((s, r) => s + Math.max(-r.balanceCents, 0), 0);
  return (
    <TableCard
      title="Trial balance"
      icon={<BookOpenIcon size={17} />}
      description="Every account's closing balance. Debits must equal credits."
      actions={
        rows.length ? (
          <span className={cn("text-xs font-semibold", dr === cr ? "text-emerald-700" : "text-rose-700")}>
            {dr === cr ? "Balanced" : `Out by ${lkr(Math.abs(dr - cr))}`}
          </span>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyBlock icon={<BookOpenIcon size={22} />} title="No entries yet" description="Nothing has been posted up to this date." />
      ) : (
        <table className="g-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th className="!text-right">Debit</th>
              <th className="!text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="g-metric text-xs">{r.code}</td>
                <td className="text-ink-2">{r.name}</td>
                <td className="text-xs text-ink-4">{r.type}</td>
                <td className="!text-right num-tabular">{r.balanceCents > 0 ? lkr(r.balanceCents) : ""}</td>
                <td className="!text-right num-tabular">{r.balanceCents < 0 ? lkr(-r.balanceCents) : ""}</td>
              </tr>
            ))}
            <tr className="bg-bone/60 font-semibold">
              <td colSpan={3}>Total</td>
              <td className="!text-right num-tabular">{lkr(dr)}</td>
              <td className="!text-right num-tabular">{lkr(cr)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

export default function StatementsPage() {
  return (
    <Suspense fallback={null}>
      <StatementsView />
    </Suspense>
  );
}
