"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BarList, Page, Skeleton, StatusPill } from "@/components/ui";
import {
  Card,
  CardHead,
  Empty,
  HeadLink,
  ListSkeleton,
  ModuleCard,
  ModuleHero,
  SectionHead,
  ago,
  count,
  grams,
  lkr,
  type IconCmp,
} from "@/components/module-dashboard";
import {
  BanknoteIcon,
  CheckCircleIcon,
  CoinsIcon,
  CreditCardIcon,
  GemIcon,
  InboxIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  TagsIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ types */

type Summary = { invoices: number; value_cents: number; discount_cents: number; gold_mg: number };
type Breakdown = { key: string | null; invoices: number; value_cents: number; gold_mg: number };
type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  total_cents: number;
  paid_cents: number;
  status: string;
  created_at: number;
};
type Return = {
  id: string;
  number: string;
  invoice_id: string;
  type: string;
  reason: string;
  refund_cents: number;
  status: string;
  created_at: number;
};

/** Invoice settlement states, in the order a counter cares about them. */
const STATES = [
  { status: "PAID", label: "Paid", hint: "Settled in full", bar: "bg-emerald-500" },
  { status: "PARTIAL", label: "Part-paid", hint: "Balance on credit", bar: "bg-gold" },
  { status: "UNPAID", label: "Unpaid", hint: "Nothing received yet", bar: "bg-amber-400" },
  { status: "VOID", label: "Void", hint: "Cancelled", bar: "bg-ink-5" },
] as const;

const pretty = (k: string | null, fallback: string) =>
  k ? k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : fallback;

function MixCard({
  icon,
  title,
  sub,
  rows,
  loading,
  fallback,
}: {
  icon: IconCmp;
  title: string;
  sub: string;
  rows: Breakdown[] | undefined;
  loading: boolean;
  fallback: string;
}) {
  const items = (rows ?? [])
    .filter((r) => r.value_cents > 0)
    .slice(0, 5)
    .map((r) => ({
      key: r.key ?? fallback,
      label: pretty(r.key, fallback),
      value: r.value_cents,
      secondary: `${r.invoices} invoice${r.invoices === 1 ? "" : "s"}${r.gold_mg ? ` · ${grams(r.gold_mg)} g` : ""}`,
    }));
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={<HeadLink href="/sales/reports">Report</HeadLink>} />
      <div className="px-5 pb-5 sm:px-6">
        {loading ? (
          <ListSkeleton />
        ) : (
          <BarList
            tone="light"
            items={items}
            format={(n) => `${lkr(n)} LKR`}
            empty={<Empty icon={icon} title="No sales yet" desc="Invoices posted this month will be broken down here." />}
          />
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- page */

export default function SalesDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canSell = hasPermission(me.data?.permissions ?? [], "sales:create");

  const opt = { retry: false, staleTime: 30_000 } as const;
  const today = useQuery({ ...opt, queryKey: ["sales-summary", "today"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=today") });
  const month = useQuery({ ...opt, queryKey: ["sales-summary", "month"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=month") });
  const breakdown = (groupBy: string) => ({
    ...opt,
    queryKey: ["sales-breakdown", "month", groupBy],
    queryFn: () => api<Breakdown[]>(`/api/v1/sales/reports/breakdown?period=month&groupBy=${groupBy}`),
  });
  const byCategory = useQuery(breakdown("category"));
  const byPayment = useQuery(breakdown("payment"));
  const bySalesperson = useQuery(breakdown("salesperson"));
  const recent = useQuery({
    ...opt,
    queryKey: ["sales-dash", "recent"],
    queryFn: () => api<{ rows: Invoice[]; total: number }>("/api/v1/sales/invoices?limit=6"),
  });
  const returns = useQuery({
    ...opt,
    queryKey: ["sales-dash", "returns"],
    queryFn: () => api<{ rows: Return[]; total: number }>("/api/v1/sales/returns?limit=5"),
  });

  // Counts per settlement state; the credit states also fetch rows so the open
  // balance can be summed (up to the API's 100-row page).
  const stateQueries = useQueries({
    queries: STATES.map((s) => {
      const credit = s.status === "PARTIAL" || s.status === "UNPAID";
      return {
        ...opt,
        queryKey: ["sales-dash", "state", s.status],
        queryFn: () => api<{ rows: Invoice[]; total: number }>(`/api/v1/sales/invoices?status=${s.status}&limit=${credit ? 100 : 1}`),
      };
    }),
  });
  const counts = stateQueries.map((q) => q.data?.total);
  const statesLoading = stateQueries.some((q) => q.isLoading);
  const allInvoices = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const creditRows = stateQueries.slice(1, 3).flatMap((q) => q.data?.rows ?? []);
  const creditCount = (counts[1] ?? 0) + (counts[2] ?? 0);
  const owed = creditRows.reduce((s, r) => s + Math.max(0, r.total_cents - r.paid_cents), 0);
  const owedPartial = creditRows.length < creditCount;

  const t = today.data;
  const m = month.data;
  const avgTicket = t && t.invoices > 0 ? t.value_cents / t.invoices : undefined;

  return (
    <Page>
      <ModuleHero
        kicker="Sales"
        title={
          <>
            Every piece, <span className="home-gold-text">sold with proof.</span>
          </>
        }
        description="Ring up sales at the counter, keep an eye on credit, handle returns and see what is selling — the whole sales desk from one screen."
        actions={
          <>
            {canSell ? (
              <Link href="/pos" className="home-btn-gold h-10 px-4 text-sm">
                <ScanBarcodeIcon size={15} />
                Open POS
              </Link>
            ) : null}
            <Link href="/sales/invoices" className="home-btn-ghost h-10 px-4 text-sm">
              <CreditCardIcon size={15} />
              Invoices
            </Link>
            <Link href="/sales/returns" className="home-btn-ghost h-10 px-4 text-sm">
              <RotateCcwIcon size={15} />
              Returns
            </Link>
          </>
        }
        metrics={[
          { label: "Sales today", value: t?.value_cents, format: lkr, unit: "LKR", icon: BanknoteIcon, href: "/sales/reports" },
          { label: "Invoices today", value: t?.invoices, format: count, unit: "sales", icon: CreditCardIcon, href: "/sales/invoices" },
          { label: "Sales · month", value: m?.value_cents, format: lkr, unit: "LKR", icon: TrendingUpIcon, href: "/sales/reports" },
          { label: "Gold out · month", value: m?.gold_mg, format: grams, unit: "g", icon: GemIcon, href: "/sales/reports" },
        ]}
      />

      {/* ------------------------------------------------------- workspaces */}
      <SectionHead index="01" title="Workspaces" sub="Jump into any part of the sales desk" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canSell || !me.data ? (
          <ModuleCard
            href="/pos"
            index="01"
            icon={ScanBarcodeIcon}
            title="Point of sale"
            description="Scan pieces, apply discounts, split payments and print the invoice."
            metric={t ? t.invoices : "—"}
            metricLabel="Sales rung up today"
            cta="Start a sale"
            loading={today.isLoading}
            delay={0}
          />
        ) : null}
        <ModuleCard
          href="/sales/invoices"
          index="02"
          icon={CreditCardIcon}
          title="Invoices"
          description="Every completed sale, with payments, lines and the linked pieces."
          metric={recent.data ? count(recent.data.total) : "—"}
          metricLabel="Invoices on file"
          cta="Browse"
          loading={recent.isLoading}
          alert={creditCount > 0}
          delay={60}
        />
        <ModuleCard
          href="/sales/returns"
          index="03"
          icon={RotateCcwIcon}
          title="Returns"
          description="Refunds and exchanges, with the gold movement reversed."
          metric={returns.data ? count(returns.data.total) : "—"}
          metricLabel="Returns recorded"
          cta="Open register"
          loading={returns.isLoading}
          delay={120}
        />
        <ModuleCard
          href="/sales/reports"
          index="04"
          icon={TrendingUpIcon}
          title="Reports"
          description="Sales by category, purity, branch, salesperson, payment or product."
          metric={m ? lkr(m.value_cents) : "—"}
          metricLabel="LKR sold this month"
          cta="View reports"
          loading={month.isLoading}
          delay={180}
        />
      </div>

      {/* ------------------------------------------------------ collections */}
      <SectionHead index="02" title="Collections" sub="How invoices stand on payment — tap a state to see them" />
      <Card>
        <div className="grid gap-4 px-5 pt-5 sm:grid-cols-3 sm:px-6">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Owed on credit</span>
            <p className="g-metric mt-1 text-2xl leading-none text-ink">
              {statesLoading ? "—" : lkr(owed)}
              <span className="ml-1.5 text-xs font-medium text-ink-4">LKR{owedPartial ? "+" : ""}</span>
            </p>
            <p className="mt-1 text-[11px] text-ink-4">
              {creditCount > 0 ? `Across ${creditCount} open invoice${creditCount === 1 ? "" : "s"}` : "No open balances"}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Average sale today</span>
            <p className="g-metric mt-1 text-2xl leading-none text-ink">
              {avgTicket === undefined ? "—" : lkr(avgTicket)}
              {avgTicket !== undefined ? <span className="ml-1.5 text-xs font-medium text-ink-4">LKR</span> : null}
            </p>
            <p className="mt-1 text-[11px] text-ink-4">{t ? `${t.invoices} sale${t.invoices === 1 ? "" : "s"} so far` : "Per invoice"}</p>
          </div>
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-4">Discounts · month</span>
            <p className="g-metric mt-1 text-2xl leading-none text-ink">
              {m ? lkr(m.discount_cents) : "—"}
              {m ? <span className="ml-1.5 text-xs font-medium text-ink-4">LKR</span> : null}
            </p>
            <p className="mt-1 text-[11px] text-ink-4">
              {m && m.value_cents > 0 ? `${((m.discount_cents / (m.value_cents + m.discount_cents)) * 100).toFixed(1)}% of list price` : "Given at the counter"}
            </p>
          </div>
        </div>
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
            {allInvoices > 0
              ? STATES.map((s, i) => {
                  const c = counts[i] ?? 0;
                  return c > 0 ? (
                    <span
                      key={s.status}
                      className={cn("h-full border-r-2 border-paper last:border-r-0 transition-[width] duration-700 ease-brand", s.bar)}
                      style={{ width: `${(c / allInvoices) * 100}%` }}
                    />
                  ) : null;
                })
              : null}
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.06] lg:grid-cols-4">
          {STATES.map((s, i) => (
            <li key={s.status} className="bg-paper">
              <Link
                href={`/sales/invoices?status=${s.status}`}
                className="group flex h-full items-center gap-4 px-5 py-4 transition-colors hover:bg-gold-pale/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", s.bar)} />
                    <span className="text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-dark">{s.label}</span>
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-4">{s.hint}</span>
                </span>
                {stateQueries[i]?.isLoading ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  <span className="g-metric text-2xl leading-none text-ink">{counts[i] ?? "—"}</span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      {/* ---------------------------------------------------- what's selling */}
      <SectionHead index="03" title="What's selling" sub="This month, by value" />
      <div className="grid gap-4 lg:grid-cols-3">
        <MixCard icon={TagsIcon} title="By category" sub="Top categories" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" />
        <MixCard icon={CoinsIcon} title="By payment" sub="How customers pay" rows={byPayment.data} loading={byPayment.isLoading} fallback="Unrecorded" />
        <MixCard icon={UsersIcon} title="By salesperson" sub="Who is selling" rows={bySalesperson.data} loading={bySalesperson.isLoading} fallback="Unassigned" />
      </div>

      {/* ---------------------------------------------------------- activity */}
      <SectionHead index="04" title="Recent activity" sub="The latest sales and returns at the counter" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead icon={CreditCardIcon} title="Latest invoices" sub="Most recent sales, all branches you can see" action={<HeadLink href="/sales/invoices">All invoices</HeadLink>} />
          <div className="pb-2">
            {recent.isLoading ? (
              <div className="px-5 pb-4 sm:px-6">
                <ListSkeleton rows={4} className="h-11 rounded-lg" />
              </div>
            ) : (recent.data?.rows ?? []).length === 0 ? (
              <div className="px-5 pb-4 sm:px-6">
                <Empty icon={InboxIcon} title="No sales yet" desc="Ring up your first sale from the POS and it will show here." />
              </div>
            ) : (
              <ul className="divide-y divide-ink/[0.05] border-t border-ink/[0.05]">
                {(recent.data?.rows ?? []).map((r) => {
                  const due = Math.max(0, r.total_cents - r.paid_cents);
                  return (
                    <li key={r.id}>
                      <Link href={`/sales/invoices/${r.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gold-pale/40 sm:px-6">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="g-metric text-xs font-semibold text-ink group-hover:text-gold-dark">{r.number}</span>
                            <span className="text-[11px] text-ink-5">{ago(r.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-4">
                            {r.customer_name ?? "Walk-in"}
                            {due > 0 && r.status !== "VOID" ? ` · ${lkr(due)} LKR due` : ""}
                          </span>
                        </span>
                        <span className="g-metric shrink-0 text-sm text-ink">{lkr(r.total_cents)}</span>
                        <StatusPill status={r.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHead
            icon={RotateCcwIcon}
            title="Latest returns"
            sub={returns.data ? `${returns.data.total} on the register` : "Refunds and exchanges"}
            action={<HeadLink href="/sales/returns">Register</HeadLink>}
          />
          <div className="px-5 pb-5 sm:px-6">
            {returns.isLoading ? (
              <ListSkeleton />
            ) : (returns.data?.rows ?? []).length === 0 ? (
              <Empty icon={CheckCircleIcon} title="No returns" desc="Returns recorded against an invoice will appear here." />
            ) : (
              <ul className="space-y-2">
                {(returns.data?.rows ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/sales/invoices/${r.invoice_id}`}
                      className="group flex items-center gap-3 rounded-xl bg-bone/70 px-3.5 py-3 ring-1 ring-ink/[0.06] transition-colors hover:bg-gold-pale/60 hover:ring-gold-dark/20"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-200/70">
                        <RotateCcwIcon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="g-metric text-xs font-semibold text-ink">{r.number}</span>
                          <span className="text-[11px] text-ink-5">{ago(r.created_at)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-ink-4">
                          {pretty(r.type, "Return")} · {r.reason}
                        </span>
                      </span>
                      <span className="g-metric shrink-0 text-sm text-ink">{lkr(r.refund_cents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </Page>
  );
}
