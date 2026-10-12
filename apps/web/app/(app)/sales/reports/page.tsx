"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { Page, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  BanknoteIcon,
  Building2Icon,
  CreditCardIcon,
  FileDownIcon,
  FileTextIcon,
  GemIcon,
  LayoutGridIcon,
  MenuIcon,
  PackageIcon,
  PercentIcon,
  ScaleIcon,
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
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

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

  const s = summary.data;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US");
  const g = (mg: number) => (mg / 1000).toLocaleString("en-US");

  function exportCsv() {
    const rows = breakdown.data ?? [];
    const csv = ["key,invoices,value_lkr,gold_g", ...rows.map((r) => `"${r.key}",${r.invoices},${r.value_cents / 100},${r.gold_mg / 1000}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${period}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rows = breakdown.data ?? [];
  const totalValue = rows.reduce((n, r) => n + r.value_cents, 0);
  const maxValue = Math.max(1, ...rows.map((r) => r.value_cents));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";
  const groupLabel = GROUP_META[groupBy].label;
  const avgTicket = s && s.invoices > 0 ? Math.round(s.value_cents / s.invoices) : null;
  const top = rows[0];
  const topShare = top && totalValue ? (top.value_cents / totalValue) * 100 : 0;

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean }[] = [
    {
      label: "Value",
      value: s ? `LKR ${fmt(s.value_cents)}` : "—",
      sub: "Net of refunds",
      icon: <BanknoteIcon size={16} />,
      gold: true,
    },
    {
      label: "Invoices",
      value: s ? s.invoices.toLocaleString("en-US") : "—",
      sub: avgTicket !== null ? `Avg ticket LKR ${fmt(avgTicket)}` : "No sales yet",
      icon: <FileTextIcon size={16} />,
    },
    {
      label: "Gold out",
      value: s ? `${g(s.gold_mg)} g` : "—",
      sub: "Net weight sold",
      icon: <ScaleIcon size={16} />,
    },
    {
      label: "Discounts",
      value: s ? `LKR ${fmt(s.discount_cents)}` : "—",
      sub: s && s.discount_cents > 0 ? "Given at the counter" : "None given",
      icon: <PercentIcon size={16} />,
    },
  ];

  return (
    <Page className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
        <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]" aria-hidden />
        <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />

        <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-7">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
              Sales · Reports
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Sales reports, <span className="home-gold-text">at a glance.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              What sold, and how, for the period you pick. Returned items are excluded from counts and refunds from value.
            </p>

            <div
              role="tablist"
              aria-label="Period"
              className="relative mt-6 inline-grid grid-cols-3 rounded-2xl bg-paper/[0.06] p-1 ring-1 ring-paper/10"
            >
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-gradient-to-b from-gold-light to-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_20px_-10px_rgba(205,168,83,0.8)] transition-transform duration-320 ease-brand"
                style={{ transform: `translateX(${PERIODS.findIndex((p) => p.key === period) * 100}%)` }}
              />
              {PERIODS.map((p) => {
                const active = p.key === period;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPeriod(p.key)}
                    className={cn(
                      "relative h-10 rounded-xl px-5 text-[13px] font-semibold transition-colors duration-200",
                      active ? "text-void" : "text-paper/60 hover:text-paper"
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          {canExport ? (
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="home-btn-ghost h-11 shrink-0 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileDownIcon size={15} /> Export CSV
            </button>
          ) : null}
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {stats.map((st) => (
            <div
              key={st.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
                st.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  st.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {st.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{st.label}</span>
                {summary.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-24 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", st.gold ? "text-gold-light" : "text-paper")}>
                    {st.value}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{st.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Breakdown */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="space-y-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <TrendingUpIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Sales by {groupLabel.toLowerCase()}</h2>
                <p className="truncate text-xs text-ink-4">
                  {breakdown.isLoading
                    ? periodLabel
                    : `${periodLabel} · ${rows.length} group${rows.length === 1 ? "" : "s"} · LKR ${fmt(totalValue)}`}
                </p>
              </div>
            </div>
            <div className="relative flex h-10 shrink-0 items-center rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]" role="group" aria-label="View">
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-1 left-1 w-9 rounded-lg bg-void shadow-[0_6px_14px_-6px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand",
                  view === "table" && "translate-x-9"
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
                  className={cn(
                    "relative flex h-full w-9 items-center justify-center rounded-lg transition-colors duration-200",
                    view === o.v ? "text-gold-light" : "text-ink-4 hover:text-ink"
                  )}
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
                      "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all duration-200 ease-brand",
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

        {/* Leader callout */}
        {!breakdown.isLoading && top && rows.length > 1 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-ink/[0.06] bg-gradient-to-r from-gold-pale/70 via-gold-pale/30 to-paper px-5 py-3 sm:px-6">
            <span className="g-metric flex size-7 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[11px] font-bold text-void">1</span>
            <p className="min-w-0 text-[13px] text-ink-3">
              <span className="font-semibold text-ink">{top.key || "Unspecified"}</span> leads with{" "}
              <span className="g-metric font-medium text-ink">{topShare.toFixed(topShare < 10 ? 1 : 0)}%</span> of value ·{" "}
              <span className="g-metric">LKR {fmt(top.value_cents)}</span> across {top.invoices.toLocaleString("en-US")} invoice
              {top.invoices === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}

        {breakdown.isLoading ? (
          <div className="space-y-3 p-5 sm:p-6">
            {["w-full", "w-[86%]", "w-[72%]", "w-[58%]", "w-[44%]"].map((w) => (
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
            title="Nothing sold in this period"
            body="Pick a longer period or a different grouping."
            action={
              period !== "all" ? (
                <button type="button" onClick={() => setPeriod("all")} className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                  Show all time
                </button>
              ) : null
            }
          />
        ) : view === "chart" ? (
          <ol className="space-y-1 p-3 sm:p-4" aria-label={`Sales value by ${groupLabel.toLowerCase()}`}>
            {rows.map((r, i) => {
              const share = totalValue ? (r.value_cents / totalValue) * 100 : 0;
              const width = (r.value_cents / maxValue) * 100;
              return (
                <li
                  key={r.key || `__${i}`}
                  className="group relative grid animate-fade-in grid-cols-[1.75rem_minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-bone/70 sm:grid-cols-[1.75rem_minmax(0,12rem)_minmax(0,1fr)_auto] sm:px-3"
                  style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                >
                  <span
                    className={cn(
                      "g-metric flex size-7 items-center justify-center rounded-full text-[10px] font-semibold",
                      i === 0
                        ? "bg-gradient-to-b from-gold-light to-gold text-void"
                        : i < 3
                          ? "bg-gold-pale text-gold-deep ring-1 ring-gold-dark/15"
                          : "text-ink-5 ring-1 ring-ink/[0.08]"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{r.key || "Unspecified"}</span>
                    <span className="block truncate text-[11px] text-ink-4">
                      {r.invoices.toLocaleString("en-US")} inv · {g(r.gold_mg)} g
                    </span>
                  </span>

                  {/* Bar: one series, one hue; the label sits outside so it never depends on the fill. */}
                  <span className="relative flex min-w-0 items-center gap-2.5">
                    <span className="relative h-3 flex-1 rounded-full bg-ink/[0.05]">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-dark to-gold transition-[width] duration-700 ease-brand group-hover:from-gold-deep group-hover:to-gold-dark"
                        style={{ width: `${Math.max(width, 1.5)}%` }}
                      />
                      {/* Hover tooltip */}
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
                    <span className="g-metric text-sm text-ink">
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
            <table className="g-table">
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] bg-bone/40 px-5 py-3 text-[11px] text-ink-4 sm:px-6">
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-5 rounded-full bg-gradient-to-r from-gold-dark to-gold" aria-hidden />
              Sales value, LKR · bars scaled to the top {groupLabel.toLowerCase()}
            </span>
            <span>Hover a bar for details · switch to the table for exact figures</span>
          </div>
        ) : null}
      </section>
    </Page>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
        <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
          <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
          <TrendingUpIcon size={26} />
        </span>
        <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">{title}</h3>
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">{body}</p>
        {action ? <div className="relative mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
