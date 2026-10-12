"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CoinsIcon,
  CreditCardIcon,
  GemIcon,
  HammerIcon,
  InboxIcon,
  PackageIcon,
  RotateCcwIcon,
  ScanBarcodeIcon,
  TagsIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";
import {
  Card,
  CardHead,
  Empty,
  GoldHero,
  HeadLink,
  HeroBadge,
  INVOICE_META,
  INVOICE_STATUSES,
  InvChip,
  ReturnChip,
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
type Paged<R> = { rows: R[]; total: number };

/** This month's sales broken down one way. */
function MixCard({
  icon,
  title,
  sub,
  rows,
  loading,
  fallback,
  by = "value",
}: {
  icon: IconCmp;
  title: string;
  sub: string;
  rows: Breakdown[] | undefined;
  loading: boolean;
  fallback: string;
  by?: "value" | "gold";
}) {
  const items = (rows ?? []).filter((r) => (by === "gold" ? r.gold_mg : r.value_cents) > 0).slice(0, 6);
  const total = items.reduce((n, r) => n + (by === "gold" ? r.gold_mg : r.value_cents), 0);
  return (
    <Card>
      <CardHead icon={icon} title={title} sub={sub} action={<HeadLink href="/sales/reports">Report</HeadLink>} />
      {loading ? (
        <RowsSkeleton />
      ) : items.length === 0 ? (
        <Empty icon={icon} title="No sales yet" desc="Invoices posted this month will be broken down here." />
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
                  {r.invoices} sale{r.invoices === 1 ? "" : "s"}
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

export default function SalesDashboardPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canSell = hasPermission(me.data?.permissions ?? [], "sales:create");
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  }, []);

  const opt = { retry: false, staleTime: 30_000 } as const;
  const day = useQuery({ ...opt, queryKey: ["sales-summary", "today"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=today") });
  const month = useQuery({ ...opt, queryKey: ["sales-summary", "month"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=month") });
  const allTime = useQuery({ ...opt, queryKey: ["sales-summary", "all"], queryFn: () => api<Summary>("/api/v1/sales/reports/summary?period=all") });
  const breakdown = (groupBy: string) => ({
    ...opt,
    queryKey: ["sales-breakdown", "month", groupBy],
    queryFn: () => api<Breakdown[]>(`/api/v1/sales/reports/breakdown?period=month&groupBy=${groupBy}`),
  });
  const byCategory = useQuery(breakdown("category"));
  const byPurity = useQuery(breakdown("purity"));
  const byPayment = useQuery(breakdown("payment"));
  const bySalesperson = useQuery(breakdown("salesperson"));
  const byProduct = useQuery(breakdown("product"));
  const recent = useQuery({ ...opt, queryKey: ["sales-dash", "recent", 8], queryFn: () => api<Paged<Invoice>>("/api/v1/sales/invoices?limit=8") });
  const returns = useQuery({ ...opt, queryKey: ["sales-dash", "returns", 8], queryFn: () => api<Paged<Return>>("/api/v1/sales/returns?limit=8") });

  // Counts per settlement state; the credit states also fetch rows so the open
  // balance can be summed (up to the API's 100-row page).
  const stateQueries = useQueries({
    queries: INVOICE_STATUSES.map((s) => {
      const credit = s === "PARTIAL" || s === "UNPAID";
      return {
        ...opt,
        queryKey: ["sales-dash", "state", s],
        queryFn: () => api<Paged<Invoice>>(`/api/v1/sales/invoices?status=${s}&limit=${credit ? 100 : 1}`),
      };
    }),
  });
  const counts = stateQueries.map((q) => q.data?.total);
  const statesLoading = stateQueries.some((q) => q.isLoading);
  const creditRows = stateQueries.slice(1, 3).flatMap((q) => q.data?.rows ?? []);
  const creditCount = (counts[1] ?? 0) + (counts[2] ?? 0);
  const owed = creditRows.reduce((s, r) => s + Math.max(0, r.total_cents - r.paid_cents), 0);
  const owedPartial = creditRows.length < creditCount;
  const settledPct = counts.every((c) => c !== undefined)
    ? ((counts[0] ?? 0) / Math.max(1, (counts[0] ?? 0) + creditCount)) * 100
    : undefined;
  const oldestCredit = creditRows.reduce((m, r) => Math.min(m, r.created_at), Infinity);
  const topCredit = [...creditRows].sort((a, b) => b.total_cents - b.paid_cents - (a.total_cents - a.paid_cents)).slice(0, 4);

  const t = day.data;
  const m = month.data;
  const a = allTime.data;
  const avgToday = t && t.invoices > 0 ? t.value_cents / t.invoices : undefined;
  const avgMonth = m && m.invoices > 0 ? m.value_cents / m.invoices : undefined;
  const todayShare = t && m && m.value_cents > 0 ? Math.min(100, (t.value_cents / m.value_cents) * 100) : 0;
  const discPct = m && m.value_cents > 0 ? (m.discount_cents / (m.value_cents + m.discount_cents)) * 100 : undefined;
  const refunded = (returns.data?.rows ?? []).reduce((s, r) => s + r.refund_cents, 0);

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={TrendingUpIcon}
        title="Every piece,"
        accent="sold with proof"
        badge={
          statesLoading ? null : creditCount > 0 ? (
            <HeroBadge tone="warn">
              {creditCount} on credit
            </HeroBadge>
          ) : (
            <HeroBadge tone="good">No open balances</HeroBadge>
          )
        }
        sub={<>{today ? `${today} · ` : ""}ring up sales, watch credit, handle returns and see what is selling</>}
        actions={
          <>
            {canSell ? (
              <Link href="/pos" className={heroGold}>
                <ScanBarcodeIcon size={13} /> Open POS
              </Link>
            ) : null}
            <Link href="/sales/invoices" className={heroGhost}>
              <CreditCardIcon size={13} /> Invoices
            </Link>
            <Link href="/sales/returns" className={heroGhost}>
              <RotateCcwIcon size={13} /> Returns
            </Link>
            <Link href="/repairs" className={heroGhost}>
              <HammerIcon size={13} /> Repairs
            </Link>
            <Link href="/sales/reports" className={heroGhost}>
              <TrendingUpIcon size={13} /> Reports
            </Link>
          </>
        }
        stats={[
          {
            label: "Today",
            value: t?.value_cents,
            format: lkr,
            unit: "LKR",
            accent: true,
            loading: day.isLoading,
            sub: !t || t.invoices === 0 ? "No sales rung up yet" : `${t.invoices} sale${t.invoices === 1 ? "" : "s"} · avg ${avgToday ? lkr(avgToday) : "—"}`,
          },
          { label: "Sales · month", value: m?.value_cents, format: lkr, unit: "LKR", href: "/sales/reports", loading: month.isLoading, sub: `Today is ${todayShare.toFixed(todayShare > 0 && todayShare < 10 ? 1 : 0)}%` },
          { label: "Invoices · month", value: m?.invoices, href: "/sales/invoices", loading: month.isLoading, sub: avgMonth ? `Avg ticket ${lkr(avgMonth)}` : "No sales yet" },
          { label: "Gold out · month", value: m?.gold_mg, format: grams, unit: "g", href: "/sales/reports", loading: month.isLoading, sub: "Weight sold" },
          {
            label: "Discounts · month",
            value: m?.discount_cents,
            format: lkr,
            unit: "LKR",
            loading: month.isLoading,
            sub: discPct !== undefined ? `${discPct.toFixed(1)}% of list` : "Given at the counter",
          },
          {
            label: "On credit",
            value: statesLoading ? undefined : owed,
            format: (n) => `${lkr(n)}${owedPartial ? "+" : ""}`,
            unit: "LKR",
            tone: owed > 0 ? "warn" : "good",
            href: "/sales/invoices?status=UNPAID",
            loading: statesLoading,
            sub: creditCount ? `${creditCount} open invoice${creditCount === 1 ? "" : "s"}` : "Every sale settled",
          },
          { label: "Returns", value: returns.data?.total, href: "/sales/returns", loading: returns.isLoading, sub: refunded ? `${lkr(refunded)} LKR latest refunds` : "On the register" },
          { label: "Sales · all time", value: a?.value_cents, format: lkr, unit: "LKR", loading: allTime.isLoading, sub: a ? `${count(a.invoices)} invoices · ${grams(a.gold_mg)} g` : undefined },
        ]}
      >
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-paper/40">Today vs month</span>
          <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper/10">
            <span className="block h-full rounded-full bg-gradient-to-r from-gold-deep via-gold to-gold-light transition-[width] duration-700 ease-brand" style={{ width: `${todayShare}%` }} />
          </span>
          <span className="g-metric shrink-0 text-[11px] text-paper/55">
            {lkr(t?.value_cents ?? 0)} / {lkr(m?.value_cents ?? 0)} LKR
          </span>
        </div>
      </GoldHero>

      {/* --------------------------------------------- activity */}
      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHead
            icon={CreditCardIcon}
            title="Latest invoices"
            sub={recent.data ? `${count(recent.data.total)} on file · most recent sales` : "Most recent sales"}
            action={
              <>
                {canSell ? (
                  <Link href="/pos" className="inline-flex items-center gap-1 rounded-md bg-void px-2 py-1 text-[11px] font-semibold text-gold-light hover:bg-void/90">
                    <ScanBarcodeIcon size={11} /> New sale
                  </Link>
                ) : null}
                <HeadLink href="/sales/invoices">All</HeadLink>
              </>
            }
          />
          {recent.isLoading ? (
            <RowsSkeleton rows={5} />
          ) : (recent.data?.rows ?? []).length === 0 ? (
            <Empty icon={InboxIcon} title="No sales yet" desc="Ring up your first sale from the POS and it will show here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-[12px]">
                <thead>
                  <tr className={thead}>
                    <th className={cn(th, "pl-4")}>Invoice</th>
                    <th className={th}>Customer</th>
                    <th className={cn(th, "text-right")}>Total LKR</th>
                    <th className={cn(th, "text-right")}>Due LKR</th>
                    <th className={cn(th, "pr-4 text-right")}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data?.rows ?? []).map((r) => {
                    const due = r.status === "VOID" ? 0 : Math.max(0, r.total_cents - r.paid_cents);
                    return (
                      <tr key={r.id} className={cn(tr, r.status === "VOID" && "opacity-60")}>
                        <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                          <Link href={`/sales/invoices/${r.id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                            {r.number}
                          </Link>
                          <span className="ml-1.5 text-[10px] text-ink-5">{ago(r.created_at)}</span>
                        </td>
                        <td className="max-w-[180px] truncate px-2 text-ink-3">{r.customer_name ?? "Walk-in"}</td>
                        <td className="g-metric px-2 text-right text-ink">{lkr(r.total_cents)}</td>
                        <td className={cn("g-metric px-2 text-right", due > 0 ? "font-semibold text-amber-700" : "text-ink-5")}>{due > 0 ? lkr(due) : "—"}</td>
                        <td className="py-1.5 pl-2 pr-4 text-right">
                          <InvChip status={r.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-5">
          <CardHead
            icon={RotateCcwIcon}
            title="Latest returns"
            sub={returns.data ? `${returns.data.total} on the register` : "Refunds and exchanges"}
            action={<HeadLink href="/sales/returns">Register</HeadLink>}
          />
          {returns.isLoading ? (
            <RowsSkeleton rows={5} />
          ) : (returns.data?.rows ?? []).length === 0 ? (
            <Empty icon={CheckCircleIcon} title="No returns" desc="Returns recorded against an invoice will appear here." />
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className={thead}>
                  <th className={cn(th, "pl-4")}>Return</th>
                  <th className={th}>Type · reason</th>
                  <th className={cn(th, "pr-4 text-right")}>Refund</th>
                </tr>
              </thead>
              <tbody>
                {(returns.data?.rows ?? []).map((r) => (
                  <tr key={r.id} className={tr}>
                    <td className="whitespace-nowrap py-1.5 pl-4 pr-2">
                      <Link href={`/sales/invoices/${r.invoice_id}`} className="g-metric font-semibold text-ink hover:text-gold-dark">
                        {r.number}
                      </Link>
                      <span className="ml-1.5 text-[10px] text-ink-5">{ago(r.created_at)}</span>
                    </td>
                    <td className="max-w-[160px] px-2">
                      <span className="flex items-center gap-1.5">
                        <ReturnChip status={r.type} />
                        <span className="truncate text-ink-4">{r.reason}</span>
                      </span>
                    </td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{lkr(r.refund_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* --------------------------------------------- collections */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHead
            icon={CoinsIcon}
            title="Invoice settlement"
            sub={statesLoading ? "Invoices by payment status" : `${settledPct !== undefined ? settledPct.toFixed(0) : "—"}% of live invoices settled`}
            action={<HeadLink href="/sales/invoices">All</HeadLink>}
          />
          <ul className="flex-1 divide-y divide-ink/[0.05]">
            {INVOICE_STATUSES.map((s, i) => {
              const c = counts[i];
              const mx = Math.max(1, ...counts.map((x) => x ?? 0));
              const meta = INVOICE_META[s]!;
              return (
                <li key={s}>
                  <Link href={`/sales/invoices?status=${s}`} className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gold-pale/40">
                    <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
                    <span className="w-24 shrink-0 leading-tight">
                      <span className="block text-[12px] font-semibold text-ink group-hover:text-gold-dark">{meta.label}</span>
                      <span className="block truncate text-[10px] text-ink-5">{meta.hint}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <ShareBar value={((c ?? 0) / mx) * 100} color={meta.dot} />
                    </span>
                    <span className="g-metric w-8 text-right text-[15px] text-ink">{statesLoading ? "…" : c ?? "—"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHead
            icon={CreditCardIcon}
            title="Credit book"
            sub={statesLoading ? "Balances still owed" : creditCount ? `${lkr(owed)}${owedPartial ? "+" : ""} LKR across ${creditCount} invoice${creditCount === 1 ? "" : "s"}` : "Nothing owed"}
            action={<HeadLink href="/sales/invoices?status=UNPAID">Collect</HeadLink>}
          />
          {statesLoading ? (
            <RowsSkeleton rows={3} />
          ) : topCredit.length === 0 ? (
            <Empty icon={CheckCircleIcon} title="No open balances" desc="Every sale has been paid in full." />
          ) : (
            <>
              <ul className="flex-1 divide-y divide-ink/[0.05]">
                {topCredit.map((r) => {
                  const due = r.total_cents - r.paid_cents;
                  return (
                    <li key={r.id}>
                      <Link href={`/sales/invoices/${r.id}`} className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-gold-pale/40">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-ink group-hover:text-gold-dark">{r.customer_name ?? "Walk-in"}</span>
                          <span className="g-metric block text-[10px] text-ink-5">
                            {r.number} · {ago(r.created_at)}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="g-metric block text-[13px] font-semibold text-amber-700">{lkr(due)}</span>
                          <span className="g-metric block text-[10px] text-ink-5">of {lkr(r.total_cents)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {Number.isFinite(oldestCredit) ? (
                <p className="border-t border-ink/[0.06] bg-bone/40 px-4 py-1.5 text-[10.5px] text-ink-4">Oldest open balance from {ago(oldestCredit)}</p>
              ) : null}
            </>
          )}
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHead icon={PackageIcon} title="Top pieces" sub="This month · by value, by barcode" action={<HeadLink href="/sales/reports">Report</HeadLink>} />
          {byProduct.isLoading ? (
            <RowsSkeleton rows={4} />
          ) : (byProduct.data ?? []).filter((r) => r.value_cents > 0).length === 0 ? (
            <Empty icon={PackageIcon} title="Nothing sold yet" desc="Pieces sold this month rank here." />
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {(byProduct.data ?? [])
                  .filter((r) => r.value_cents > 0)
                  .slice(0, 6)
                  .map((r, i) => (
                    <tr key={r.key ?? i} className={tr}>
                      <td className="g-metric w-6 py-1.5 pl-4 text-[10.5px] text-ink-5">{i + 1}</td>
                      <td className="max-w-[160px] truncate px-2 py-1.5 font-mono text-[11px] font-medium text-ink">{r.key ?? "Unknown"}</td>
                      <td className="g-metric px-2 text-right text-ink-4">{r.gold_mg ? `${grams(r.gold_mg)} g` : "—"}</td>
                      <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink">{lkr(r.value_cents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <Link href="/sales/reports" className="group mt-auto flex items-center justify-center gap-1 border-t border-ink/[0.06] py-1.5 text-[11.5px] font-medium text-ink-3 hover:bg-void hover:text-gold-light">
            Full sales report <ArrowRightIcon size={11} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Card>
      </div>

      {/* --------------------------------------------- what's selling */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MixCard icon={TagsIcon} title="By category" sub="This month · by value" rows={byCategory.data} loading={byCategory.isLoading} fallback="Uncategorised" />
        <MixCard icon={GemIcon} title="By purity" sub="This month · gold out" rows={byPurity.data} loading={byPurity.isLoading} fallback="Unspecified" by="gold" />
        <MixCard icon={CoinsIcon} title="By payment" sub="This month · how customers pay" rows={byPayment.data} loading={byPayment.isLoading} fallback="Unrecorded" />
        <MixCard icon={UsersIcon} title="By salesperson" sub="This month · who is selling" rows={bySalesperson.data} loading={bySalesperson.isLoading} fallback="Unassigned" />
      </div>

    </Page>
  );
}
