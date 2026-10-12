"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowRightIcon,
  BanknoteIcon,
  Building2Icon,
  CheckCircleIcon,
  CoinsIcon,
  GemIcon,
  InboxIcon,
  LayoutGridIcon,
  MenuIcon,
  ScaleIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";

type Summary = { items: number; gross_mg: number; bought: number; fine_mg: number; value_cents: number; paid_cents: number; outstanding_cents: number };
type Row = { key: string | null; group_id: string | null; items: number; value_cents: number; fine_mg: number };
type Pending = { id: string; number: string; description: string; fine_mg: number; purchase_value_cents: number | null; status: string; customer_name: string | null };

const GROUPS = ["purity", "customer", "branch"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_META: Record<Group, { label: string; icon: ReactNode; none: string }> = {
  purity: { label: "Purity", icon: <GemIcon size={14} />, none: "Untested" },
  customer: { label: "Customer", icon: <UsersIcon size={14} />, none: "Unspecified" },
  branch: { label: "Branch", icon: <Building2Icon size={14} />, none: "Unspecified" },
};

type Period = "today" | "month" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

const PENDING_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  PURCHASED: { label: "Purchased", chip: "bg-gold-pale text-gold-deep ring-gold-dark/25", dot: "bg-gold" },
  AVAILABLE: { label: "Available", chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
};

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const fmt = (c: number) => (c / 100).toLocaleString("en-US");
const g = (mg: number) => (mg / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

export default function OldGoldReportsPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [groupBy, setGroupBy] = useState<Group>("purity");
  const [view, setView] = useState<"chart" | "table">("chart");

  const summary = useQuery({
    queryKey: ["og-summary", period],
    queryFn: () => api<Summary>(`/api/v1/oldgold/reports/summary?period=${period}`),
  });
  const breakdown = useQuery({
    queryKey: ["og-breakdown", period, groupBy],
    queryFn: () => api<Row[]>(`/api/v1/oldgold/reports/breakdown?period=${period}&groupBy=${groupBy}`),
  });
  const pending = useQuery({
    queryKey: ["og-pending"],
    queryFn: () => api<Pending[]>(`/api/v1/oldgold/reports/pending`),
  });

  const s = summary.data;
  const rows = breakdown.data ?? [];
  const pend = pending.data ?? [];
  const totalValue = rows.reduce((n, r) => n + r.value_cents, 0);
  const maxValue = Math.max(1, ...rows.map((r) => r.value_cents));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";
  const meta = GROUP_META[groupBy];
  const name = (r: Row) => r.key ?? meta.none;
  const top = rows[0];
  const topShare = top && totalValue ? (top.value_cents / totalValue) * 100 : 0;
  const paidShare = s && s.value_cents > 0 ? Math.min(Math.max(s.paid_cents / s.value_cents, 0), 1) : null;
  const pendFine = pend.reduce((n, p) => n + (p.fine_mg ?? 0), 0);

  const stats: { label: string; value: string; sub: string; icon: ReactNode; gold?: boolean; warn?: boolean }[] = [
    {
      label: "Taken in",
      value: s ? s.items.toLocaleString("en-US") : "—",
      sub: s ? `${g(s.gross_mg)} g gross` : "Items received",
      icon: <InboxIcon size={16} />,
    },
    {
      label: "Bought",
      value: s?.bought != null ? s.bought.toLocaleString("en-US") : "—",
      sub: "Purchases in period",
      icon: <CheckCircleIcon size={16} />,
    },
    {
      label: "Fine gold",
      value: s ? `${g(s.fine_mg)} g` : "—",
      sub: "Recovered from purchases",
      icon: <ScaleIcon size={16} />,
      gold: true,
    },
    {
      label: "Value",
      value: s ? `LKR ${fmt(s.value_cents)}` : "—",
      sub: s ? `LKR ${fmt(s.paid_cents)} paid` : "Purchase value",
      icon: <BanknoteIcon size={16} />,
    },
    {
      label: "Outstanding",
      value: s ? `LKR ${fmt(s.outstanding_cents)}` : "—",
      sub: s && s.outstanding_cents > 0 ? "Still owed to customers" : "Nothing owed",
      icon: <AlertCircleIcon size={16} />,
      warn: Boolean(s && s.outstanding_cents > 0),
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
              Old gold · Reports
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Old gold reports, <span className="home-gold-text">weighed in fine.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Buy-ins, fine gold recovered, and outstanding payables — void items excluded.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Period"
            className="relative inline-grid shrink-0 grid-cols-3 self-start rounded-2xl bg-paper/[0.06] p-1 ring-1 ring-paper/10 lg:self-auto"
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
                    "relative h-10 whitespace-nowrap rounded-xl px-5 text-[13px] font-semibold transition-colors duration-200",
                    active ? "text-void" : "text-paper/60 hover:text-paper"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-5">
          {stats.map((st, i) => (
            <div
              key={st.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6 lg:px-5",
                st.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95",
                i === stats.length - 1 && "col-span-2 lg:col-span-1"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  st.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : st.warn
                      ? "bg-amber-400/15 text-amber-200 ring-amber-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {st.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{st.label}</span>
                {summary.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-20 bg-paper/10" />
                ) : (
                  <span
                    className={cn(
                      "g-metric mt-0.5 block truncate text-xl leading-tight",
                      st.gold ? "text-gold-light" : st.warn ? "text-amber-200" : "text-paper"
                    )}
                  >
                    {st.value}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{st.sub}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 border-t border-paper/[0.08] px-5 py-3 text-xs text-paper/50 sm:px-7 lg:px-8">
          <span className="size-1.5 shrink-0 rounded-full bg-gold" />
          Taken in counts intake in the period; bought, fine gold and value count purchases made in it.
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
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
                  <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Purchases by {meta.label.toLowerCase()}</h2>
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

          {!breakdown.isLoading && top && rows.length > 1 ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-ink/[0.06] bg-gradient-to-r from-gold-pale/70 via-gold-pale/30 to-paper px-5 py-3 sm:px-6">
              <span className="g-metric flex size-7 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-[11px] font-bold text-void">1</span>
              <p className="min-w-0 text-[13px] text-ink-3">
                <span className="font-semibold text-ink">{name(top)}</span> leads with{" "}
                <span className="g-metric font-medium text-ink">{topShare.toFixed(topShare < 10 ? 1 : 0)}%</span> of value ·{" "}
                <span className="g-metric">LKR {fmt(top.value_cents)}</span> across {top.items.toLocaleString("en-US")} item
                {top.items === 1 ? "" : "s"}
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
              icon={<AlertCircleIcon size={24} />}
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
              icon={<TrendingUpIcon size={24} />}
              title="Nothing bought in this period"
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
            <ol className="space-y-1 p-3 sm:p-4" aria-label={`Purchase value by ${meta.label.toLowerCase()}`}>
              {rows.map((r, i) => {
                const share = totalValue ? (r.value_cents / totalValue) * 100 : 0;
                const width = (r.value_cents / maxValue) * 100;
                return (
                  <li
                    key={r.group_id ?? `__${i}`}
                    className="group relative grid animate-fade-in grid-cols-[1.75rem_minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-bone/70 sm:grid-cols-[1.75rem_minmax(0,11rem)_minmax(0,1fr)_auto] sm:px-3"
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
                      <span className={cn("block truncate text-sm font-medium", r.key ? "text-ink" : "italic text-ink-4")}>{name(r)}</span>
                      <span className="block truncate text-[11px] text-ink-4">
                        {r.items.toLocaleString("en-US")} item{r.items === 1 ? "" : "s"} · {g(r.fine_mg)} g fine
                      </span>
                    </span>

                    {/* One series, one hue; the share label sits outside the bar. */}
                    <span className="relative flex min-w-0 items-center gap-2.5">
                      <span className="relative h-3 flex-1 rounded-full bg-ink/[0.05]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-dark to-gold transition-[width] duration-700 ease-brand group-hover:from-gold-deep group-hover:to-gold-dark"
                          style={{ width: `${Math.max(width, 1.5)}%` }}
                        />
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute bottom-[calc(100%+10px)] z-10 hidden w-max min-w-[11rem] rounded-xl bg-void px-3 py-2.5 text-left text-paper shadow-5 ring-1 ring-gold/20 group-hover:block"
                          style={{ left: `min(${width}%, calc(100% - 11rem))` }}
                        >
                          <span className="block text-[11px] font-semibold text-gold-light">{name(r)}</span>
                          <span className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[11px]">
                            <span className="text-paper/55">Value</span>
                            <span className="g-metric text-right">LKR {fmt(r.value_cents)}</span>
                            <span className="text-paper/55">Share</span>
                            <span className="g-metric text-right">{share.toFixed(1)}%</span>
                            <span className="text-paper/55">Items</span>
                            <span className="g-metric text-right">{r.items.toLocaleString("en-US")}</span>
                            <span className="text-paper/55">Fine gold</span>
                            <span className="g-metric text-right">{g(r.fine_mg)} g</span>
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
                <caption className="sr-only">Purchases by {meta.label.toLowerCase()}</caption>
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>{meta.label}</th>
                    <th className="!text-right">Share</th>
                    <th className="!text-right">Items</th>
                    <th className="!text-right">Fine g</th>
                    <th className="!text-right">Value LKR</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const share = totalValue ? (r.value_cents / totalValue) * 100 : 0;
                    return (
                      <tr key={r.group_id ?? `__${i}`}>
                        <td className="g-metric text-xs text-ink-5">{i + 1}</td>
                        <td className={cn("font-medium", r.key ? "text-ink" : "italic text-ink-4")}>{name(r)}</td>
                        <td className="num text-ink-4">{share.toFixed(1)}%</td>
                        <td className="num">{r.items.toLocaleString("en-US")}</td>
                        <td className="num">{g(r.fine_mg)}</td>
                        <td className="num font-medium text-ink">{fmt(r.value_cents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-bone/60 text-xs font-semibold text-ink-3">
                    <td />
                    <td className="py-3 uppercase tracking-[0.12em]">Total</td>
                    <td className="num">100%</td>
                    <td className="num">{rows.reduce((n, r) => n + r.items, 0).toLocaleString("en-US")}</td>
                    <td className="num">{g(rows.reduce((n, r) => n + r.fine_mg, 0))}</td>
                    <td className="num text-ink">{fmt(totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!breakdown.isLoading && rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] bg-bone/40 px-5 py-3 text-[11px] text-ink-4 sm:px-6">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-5 rounded-full bg-gradient-to-r from-gold-dark to-gold" aria-hidden />
                Purchase value, LKR · bars scaled to the top {meta.label.toLowerCase()}
              </span>
              <span>Hover a bar for details</span>
            </div>
          ) : null}
        </section>

        <div className="space-y-6">
          {/* Settlement */}
          <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
            <div className="flex items-center gap-3.5 border-b border-ink/[0.06] px-5 py-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <CoinsIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Settlement</h2>
                <p className="truncate text-xs text-ink-4">{periodLabel} · paid against purchase value</p>
              </div>
            </div>
            <div className="space-y-4 p-5">
              {summary.isLoading ? (
                <Skeleton className="h-24 rounded-xl" />
              ) : s ? (
                <>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-5">Paid</span>
                      <span className="g-metric text-xs text-ink-4">{paidShare !== null ? `${Math.round(paidShare * 100)}%` : "—"}</span>
                    </div>
                    <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.05]">
                      {paidShare !== null ? (
                        <>
                          <span
                            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-700 ease-brand"
                            style={{ width: `${paidShare * 100}%` }}
                          />
                          {paidShare < 1 ? <span className="h-full flex-1 rounded-full bg-amber-400/80" /> : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2.5">
                    <Figure label="Paid" value={`LKR ${fmt(s.paid_cents)}`} dot="bg-emerald-500" />
                    <Figure label="Outstanding" value={`LKR ${fmt(s.outstanding_cents)}`} dot="bg-amber-400" />
                    <Figure label="Purchase value" value={`LKR ${fmt(s.value_cents)}`} />
                    <Figure label="Gross taken in" value={`${g(s.gross_mg)} g`} />
                  </dl>
                </>
              ) : (
                <p className="text-sm text-ink-4">Summary unavailable.</p>
              )}
            </div>
          </section>

          {/* Pending */}
          <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
            <div className="flex items-center justify-between gap-3 border-b border-ink/[0.06] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                  <ArchiveIcon size={17} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Pending processing</h2>
                  <p className="truncate text-xs text-ink-4">Awaiting settlement or melt · all periods</p>
                </div>
              </div>
              {pend.length ? (
                <span className="g-metric shrink-0 rounded-full bg-bone px-2.5 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06]">
                  <span className="font-semibold text-ink">{pend.length}</span> · {g(pendFine)} g
                </span>
              ) : null}
            </div>

            {pending.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : pending.isError ? (
              <p className="p-5 text-sm text-ink-4">Couldn&apos;t load pending items.</p>
            ) : pend.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15">
                  <CheckCircleIcon size={20} />
                </span>
                <p className="text-sm font-semibold text-ink">All clear</p>
                <p className="mt-1 text-xs text-ink-4">No old-gold items pending processing.</p>
              </div>
            ) : (
              <ul className="max-h-[28rem] divide-y divide-ink/[0.05] overflow-y-auto scrollbar-thin">
                {pend.map((p) => {
                  const st = PENDING_STYLE[p.status] ?? { label: p.status.replace(/_/g, " "), chip: "bg-bone text-ink-3 ring-ink/10", dot: "bg-ink-5" };
                  return (
                    <li key={p.id}>
                      <Link href={`/old-gold/items/${p.id}`} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-bone/60">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="g-metric text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-deep">{p.number}</span>
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", st.chip)}>
                              <span className={cn("size-1.5 rounded-full", st.dot)} />
                              {st.label}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-ink-4">
                            {p.description || "—"}
                            {p.customer_name ? ` · ${p.customer_name}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="g-metric block text-[13px] text-ink">{g(p.fine_mg)} g</span>
                          {p.purchase_value_cents != null ? (
                            <span className="g-metric block text-[10px] text-ink-5">LKR {fmt(p.purchase_value_cents)}</span>
                          ) : null}
                        </span>
                        <ArrowRightIcon size={13} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                      </Link>
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

function Figure({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="rounded-xl bg-bone/60 px-3 py-2.5 ring-1 ring-ink/[0.05]">
      <dt className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-5">
        {dot ? <span className={cn("size-1.5 rounded-full", dot)} /> : null}
        {label}
      </dt>
      <dd className="g-metric mt-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}

function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="relative flex flex-col items-center overflow-hidden rounded-[22px] border border-dashed border-ink/15 bg-gradient-to-b from-bone/70 to-paper px-6 py-14 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-gold/10 blur-[80px]" aria-hidden />
        <span className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-void text-gold-light shadow-4">
          <span className="absolute inset-0 animate-pulse-soft rounded-2xl ring-4 ring-gold/20" aria-hidden />
          {icon}
        </span>
        <h3 className="relative font-sans text-lg font-semibold tracking-normal text-ink">{title}</h3>
        <p className="relative mt-1.5 max-w-sm text-sm text-ink-4">{body}</p>
        {action ? <div className="relative mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
