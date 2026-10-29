"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Skeleton } from "@/components/ui";
import { GoldHero, HeroBadge, heroGhost } from "../kit";
import { cn } from "@/lib/cn";
import {
  Building2Icon,
  CoinsIcon,
  CreditCardIcon,
  FileDownIcon,
  GemIcon,
  LayoutGridIcon,
  MenuIcon,
  PackageIcon,
  TagsIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";

type Summary = { invoices: number; value_cents: number; discount_cents: number; gold_mg: number };
type Row = { key: string; invoices: number; value_cents: number; gold_mg: number };

const GROUPS = ["category", "purity", "branch", "salesperson", "payment", "product"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_META: Record<Group, { label: string; icon: ReactNode }> = {
  category: { label: "Category", icon: <TagsIcon size={14} /> },
  purity: { label: "Purity", icon: <GemIcon size={14} /> },
  branch: { label: "Branch", icon: <Building2Icon size={14} /> },
  salesperson: { label: "Salesperson", icon: <UsersIcon size={14} /> },
  payment: { label: "Payment", icon: <CreditCardIcon size={14} /> },
  product: { label: "Product", icon: <PackageIcon size={14} /> },
};

type Period = "today" | "month" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const g = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

export default function SalesReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Group>("category");
  const [view, setView] = useState<"chart" | "table">("chart");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canExport = hasPermission(me.data?.permissions ?? [], "sales:export");

  const summary = useQuery({
    queryKey: ["sales-summary", period],
    queryFn: () => api<Summary>(`/api/v1/sales/reports/summary?period=${period}`),
  });
  const breakdown = useQuery({
    queryKey: ["sales-breakdown", period, groupBy],
    queryFn: () => api<Row[]>(`/api/v1/sales/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });
  const payments = useQuery({
    queryKey: ["sales-breakdown", period, "payment"],
    queryFn: () => api<Row[]>(`/api/v1/sales/reports/breakdown?period=${period}&groupBy=payment`),
  });

  const s = summary.data;
  const rows = breakdown.data ?? [];

  function exportCsv() {
    const csv = ["key,invoices,value_lkr,gold_g", ...rows.map((r) => `"${r.key}",${r.invoices},${r.value_cents / 100},${r.gold_mg / 1000}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${period}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalValue = rows.reduce((n, r) => n + r.value_cents, 0);
  const maxValue = Math.max(1, ...rows.map((r) => r.value_cents));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";
  const groupLabel = GROUP_META[groupBy].label;
  const avgTicket = s && s.invoices > 0 ? Math.round(s.value_cents / s.invoices) : null;
  const list = s ? s.value_cents + s.discount_cents : 0;
  const discShare = s && list > 0 ? s.discount_cents / list : null;
  const perGram = s && s.gold_mg > 0 ? Math.round((s.value_cents / s.gold_mg) * 1000) : null;
  const pay = (payments.data ?? []).filter((r) => r.value_cents > 0);
  const payTotal = pay.reduce((n, r) => n + r.value_cents, 0);
  const top = rows[0];
  const topShare = top && totalValue ? (top.value_cents / totalValue) * 100 : 0;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={TrendingUpIcon}
        title="Sales"
        accent="reports"
        back={{ href: "/sales", label: "Sales" }}
        badge={<HeroBadge>{periodLabel}</HeroBadge>}
        sub="What sold, and how, for the period you pick. Returned items are excluded from counts and refunds from value."
        actions={
          <>
            <div role="tablist" aria-label="Period" className="inline-flex rounded-lg bg-paper/[0.06] p-0.5 ring-1 ring-inset ring-paper/15">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={p.key === period}
                  onClick={() => setPeriod(p.key)}
                  className={cn(
                    "h-7 rounded-md px-3 text-[12px] font-medium transition-all",
                    p.key === period ? "bg-gold text-void shadow-[0_6px_16px_-8px_rgba(205,168,83,0.8)]" : "text-paper/60 hover:text-paper"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {canExport ? (
              <button type="button" onClick={exportCsv} disabled={rows.length === 0} className={cn(heroGhost, "disabled:cursor-not-allowed disabled:opacity-50")}>
                <FileDownIcon size={13} /> Export CSV
              </button>
            ) : null}
          </>
        }
        stats={[
          { label: "Sales value", value: s?.value_cents, format: (n) => fmt(Math.round(n)), unit: "LKR", accent: true, loading: summary.isLoading, sub: "Net of refunds" },
          { label: "Invoices", value: s?.invoices, loading: summary.isLoading, sub: avgTicket !== null ? `Avg ticket ${fmt(avgTicket)} LKR` : "No sales yet" },
          { label: "Gold out", value: s?.gold_mg, format: g, unit: "g", loading: summary.isLoading, sub: perGram !== null ? `${fmt(perGram)} LKR / g blended` : "Net weight sold" },
          {
            label: "Discounts",
            value: s?.discount_cents,
            format: (n) => fmt(Math.round(n)),
            unit: "LKR",
            tone: s && s.discount_cents > 0 ? "warn" : undefined,
            loading: summary.isLoading,
            sub: discShare !== null ? `${(discShare * 100).toFixed(1)}% of list price` : "None given",
          },
          {
            label: "Top payment",
            value: null,
            text: pay[0] ? pay[0].key || "Unrecorded" : "—",
            loading: payments.isLoading,
            sub: pay[0] && payTotal ? `${((pay[0].value_cents / payTotal) * 100).toFixed(0)}% of takings` : "No payments",
          },
          {
            label: `Top ${groupLabel.toLowerCase()}`,
            value: null,
            text: top ? top.key || "Unspecified" : "—",
            loading: breakdown.isLoading,
            sub: top ? `${topShare.toFixed(0)}% · ${fmt(top.value_cents)} LKR` : "No sales",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Breakdown */}
        <section className={cn("relative overflow-hidden rounded-2xl bg-paper", cardShadow)}>
          <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

          <div className="space-y-2.5 border-b border-ink/20 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">
                  <TrendingUpIcon size={14} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">Sales by {groupLabel.toLowerCase()}</h2>
                  <p className="truncate text-[11px] text-ink-4">
                    {breakdown.isLoading ? periodLabel : `${periodLabel} · ${rows.length} group${rows.length === 1 ? "" : "s"} · LKR ${fmt(totalValue)}`}
                  </p>
                </div>
              </div>
              <div className="relative flex h-8 shrink-0 items-center rounded-lg bg-bone p-0.5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)]" role="group" aria-label="View">
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0.5 left-0.5 w-8 rounded-md bg-void shadow-[0_6px_14px_-6px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand",
                    view === "table" && "translate-x-8"
                  )}
                />
                {(
                  [
                    { v: "chart", icon: LayoutGridIcon, label: "Chart view" },
                    { v: "table", icon: MenuIcon, label: "Table view" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={view === o.v}
                    onClick={() => setView(o.v)}
                    className={cn("relative flex h-full w-8 items-center justify-center rounded-lg transition-colors duration-200", view === o.v ? "text-gold-light" : "text-ink-4 hover:text-ink")}
                  >
                    <o.icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5 sm:inline">Group by</span>
              <div role="tablist" aria-label="Group by" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
                {GROUPS.map((x) => {
                  const on = x === groupBy;
                  return (
                    <button
                      key={x}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setGroupBy(x)}
                      className={cn(
                        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[11.5px] font-medium transition-all duration-200 ease-brand",
                        on
                          ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
                          : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
                      )}
                    >
                      <span className={on ? "text-gold-light" : "text-ink-5"}>{GROUP_META[x].icon}</span>
                      {GROUP_META[x].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {!breakdown.isLoading && top && rows.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2.5 border-b border-ink/20 bg-gradient-to-r from-gold-pale/70 via-gold-pale/30 to-paper px-4 py-2">
              <span className="g-metric flex size-7 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[11px] font-bold text-void">1</span>
              <p className="min-w-0 text-[12px] text-ink-3">
                <span className="font-semibold text-ink">{top.key || "Unspecified"}</span> leads with{" "}
                <span className="g-metric font-medium text-ink">{topShare.toFixed(topShare < 10 ? 1 : 0)}%</span> of sales ·{" "}
                <span className="g-metric">LKR {fmt(top.value_cents)}</span> across {top.invoices.toLocaleString("en-US")} invoice
                {top.invoices === 1 ? "" : "s"}
              </p>
            </div>
          ) : null}

          {breakdown.isLoading ? (
            <div className="space-y-3 p-5 sm:p-6">
              {["w-full", "w-[86%]", "w-[72%]", "w-[58%]"].map((w) => (
                <Skeleton key={w} className={cn("h-12 rounded-xl", w)} />
              ))}
            </div>
          ) : breakdown.isError ? (
            <Empty
              title="Couldn't load the breakdown"
              body="Check the API connection, then retry."
              action={
                <button type="button" onClick={() => void breakdown.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              title="No sales in this period"
              body="Try widening the period or a different grouping."
              action={
                period !== "all" ? (
                  <button type="button" onClick={() => setPeriod("all")} className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                    Show all time
                  </button>
                ) : null
              }
            />
          ) : view === "chart" ? (
            <ol className="space-y-0.5 p-2 sm:p-3" aria-label={`Sales by ${groupLabel.toLowerCase()}`}>
              {rows.map((r, i) => {
                const share = totalValue ? (r.value_cents / totalValue) * 100 : 0;
                const width = (r.value_cents / maxValue) * 100;
                return (
                  <li
                    key={r.key || `__${i}`}
                    className="group relative grid animate-fade-in grid-cols-[1.75rem_minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-bone/70 sm:grid-cols-[1.75rem_minmax(0,11rem)_minmax(0,1fr)_auto] sm:px-3"
                    style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                  >
                    <span
                      className={cn(
                        "g-metric flex size-7 items-center justify-center rounded-full text-[10px] font-semibold",
                        i === 0 ? "bg-gradient-to-b from-gold-light to-gold text-void" : i < 3 ? "bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15" : "text-ink-5 ring-1 ring-ink/20"
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-ink">{r.key || "Unspecified"}</span>
                      <span className="block truncate text-[11px] text-ink-4">
                        {r.invoices.toLocaleString("en-US")} inv · {g(r.gold_mg)} g
                      </span>
                    </span>

                    {/* One series, one hue; the share label sits outside the bar. */}
                    <span className="relative flex min-w-0 items-center gap-2.5">
                      <span className="relative h-2 flex-1 rounded-full bg-ink/[0.05]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-dark to-gold transition-[width] duration-700 ease-brand group-hover:from-gold-deep group-hover:to-gold-dark"
                          style={{ width: `${Math.max(width, 1.5)}%` }}
                        />
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute bottom-[calc(100%+10px)] z-10 hidden w-max min-w-[11rem] rounded-xl bg-void px-3 py-2.5 text-left text-paper shadow-5 ring-1 ring-gold/20 group-hover:block"
                          style={{ left: `min(${width}%, calc(100% - 11rem))` }}
                        >
                          <span className="block text-[11px] font-semibold text-gold-light">{r.key || "Unspecified"}</span>
                          <span className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[11px]">
                            <span className="text-paper/55">Value</span>
                            <span className="g-metric text-right">LKR {fmt(r.value_cents)}</span>
                            <span className="text-paper/55">Share</span>
                            <span className="g-metric text-right">{share.toFixed(1)}%</span>
                            <span className="text-paper/55">Invoices</span>
                            <span className="g-metric text-right">{r.invoices.toLocaleString("en-US")}</span>
                            <span className="text-paper/55">Gold</span>
                            <span className="g-metric text-right">{g(r.gold_mg)} g</span>
                          </span>
                        </span>
                      </span>
                      <span className="g-metric w-11 shrink-0 text-right text-[11px] text-ink-4">{share.toFixed(share < 10 ? 1 : 0)}%</span>
                    </span>

                    <span className="col-span-3 -mt-1 pl-10 text-right sm:col-span-1 sm:mt-0 sm:min-w-[7.5rem] sm:pl-0">
                      <span className="g-metric text-[12.5px] text-ink">
                        <span className="mr-1 text-[10px] text-ink-4">LKR</span>
                        {fmt(r.value_cents)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="g-table text-[12.5px]">
                <caption className="sr-only">Sales by {groupLabel.toLowerCase()}</caption>
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>{groupLabel}</th>
                    <th className="!text-right">Share</th>
                    <th className="!text-right">Invoices</th>
                    <th className="!text-right">Value LKR</th>
                    <th className="!text-right">Gold g</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const share = totalValue ? (r.value_cents / totalValue) * 100 : 0;
                    return (
                      <tr key={r.key || `__${i}`}>
                        <td className="g-metric text-xs text-ink-5">{i + 1}</td>
                        <td className="font-medium text-ink">{r.key || "Unspecified"}</td>
                        <td className="num text-ink-4">{share.toFixed(1)}%</td>
                        <td className="num">{r.invoices.toLocaleString("en-US")}</td>
                        <td className="num font-medium text-ink">{fmt(r.value_cents)}</td>
                        <td className="num">{g(r.gold_mg)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-bone/60 text-xs font-semibold text-ink-3">
                    <td />
                    <td className="py-3 uppercase tracking-[0.12em]">Total</td>
                    <td className="num">100%</td>
                    <td className="num">{rows.reduce((n, r) => n + r.invoices, 0).toLocaleString("en-US")}</td>
                    <td className="num text-ink">{fmt(totalValue)}</td>
                    <td className="num">{g(rows.reduce((n, r) => n + r.gold_mg, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!breakdown.isLoading && rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/20 bg-bone/40 px-4 py-2 text-[10.5px] text-ink-4">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-5 rounded-full bg-gradient-to-r from-gold-dark to-gold" aria-hidden />
                Sales value, LKR · bars scaled to the top {groupLabel.toLowerCase()}
              </span>
              <span>Hover a bar for details</span>
            </div>
          ) : null}
        </section>

        <div className="min-w-0 space-y-4 self-start">
          <section className={cn("relative overflow-hidden rounded-2xl bg-paper", cardShadow)}>
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
            <PanelHead icon={<CoinsIcon size={14} />} title="Ticket economics" sub={`${periodLabel} · price, discount and weight`} />
            <div className="space-y-3 p-4">
              {summary.isLoading ? (
                <Skeleton className="h-28 rounded-xl" />
              ) : s ? (
                <>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Kept of list price</span>
                      <span className="g-metric text-xs text-ink-4">{discShare !== null ? `${(100 - discShare * 100).toFixed(1)}%` : "—"}</span>
                    </div>
                    <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.05]">
                      {discShare !== null ? (
                        <>
                          <span className="h-full rounded-full bg-gradient-to-r from-gold-dark to-gold-light transition-[width] duration-700 ease-brand" style={{ width: `${(1 - discShare) * 100}%` }} />
                          {discShare > 0 ? <span className="h-full flex-1 rounded-full bg-amber-400/80" /> : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2.5">
                    <Figure label="List price" value={`LKR ${fmt(list)}`} dot="bg-gold" />
                    <Figure label="Discounts" value={`LKR ${fmt(s.discount_cents)}`} dot="bg-amber-400" />
                    <Figure label="Avg ticket" value={avgTicket !== null ? `LKR ${fmt(avgTicket)}` : "—"} />
                    <Figure label="Gold / sale" value={s.invoices ? `${g(s.gold_mg / s.invoices)} g` : "—"} />
                  </dl>
                </>
              ) : (
                <p className="text-sm text-ink-4">Summary unavailable.</p>
              )}
            </div>
          </section>

          <section className={cn("relative overflow-hidden rounded-2xl bg-paper", cardShadow)}>
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
            <PanelHead icon={<CreditCardIcon size={14} />} title="How customers paid" sub={`${periodLabel} · ${payTotal ? `LKR ${fmt(payTotal)} taken` : "no payments"}`} />
            {payments.isLoading ? (
              <div className="p-4">
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : pay.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-ink-4">No payments in this period.</p>
            ) : (
              <ul className="space-y-2 p-4">
                {pay.slice(0, 6).map((r) => {
                  const share = payTotal ? (r.value_cents / payTotal) * 100 : 0;
                  return (
                    <li key={r.key || "none"}>
                      <div className="flex items-baseline justify-between gap-2 text-[12px]">
                        <span className="truncate font-medium text-ink">{r.key ? r.key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "Unrecorded"}</span>
                        <span className="g-metric shrink-0 text-ink">
                          {fmt(r.value_cents)} <span className="text-[10px] text-ink-5">{share.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                        <div className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light" style={{ width: `${share}%` }} />
                      </div>
                      <div className="mt-0.5 text-[10px] text-ink-5">{r.invoices} payment{r.invoices === 1 ? "" : "s"}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Page>
  );
}

function PanelHead({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-ink/20 px-4 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)]">{icon}</span>
      <div className="min-w-0">
        <h2 className="truncate font-sans text-[13.5px] font-semibold tracking-normal text-ink">{title}</h2>
        <p className="truncate text-[11px] text-ink-4">{sub}</p>
      </div>
    </div>
  );
}

function Figure({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="rounded-lg bg-bone/60 px-2.5 py-2 ring-1 ring-ink/20">
      <dt className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">
        {dot ? <span className={cn("size-1.5 rounded-full", dot)} /> : null}
        {label}
      </dt>
      <dd className="g-metric mt-0.5 truncate text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="p-3">
      <div className="relative flex flex-col items-center overflow-hidden rounded-xl border border-dashed border-ink/20 bg-gradient-to-b from-bone/70 to-paper px-6 py-8 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
        <span className="relative mb-3 flex size-11 items-center justify-center rounded-xl bg-void text-gold-light shadow-4">
          <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
          <TrendingUpIcon size={18} />
        </span>
        <h3 className="relative font-sans text-[14px] font-semibold tracking-normal text-ink">{title}</h3>
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">{body}</p>
        {action ? <div className="relative mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
