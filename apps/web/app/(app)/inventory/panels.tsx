"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { centsToLkr, mgToG } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useCountUp } from "@/lib/count-up";
import { SpotlightCard } from "@/components/home/motion";
import { Select } from "@/components/select";
import {
  Callout,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import {
  AlertCircleIcon,
  ArchiveIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  GemIcon,
  HammerIcon,
  HistoryIcon,
  PackageIcon,
  RefreshCwIcon,
  ScaleIcon,
  ScanBarcodeIcon,
  SearchIcon,
  TruckIcon,
  UserCheckIcon,
  XIcon,
} from "@/components/icons";
import { MOVEMENT_TYPES, type Insights, type Piece } from "./columns";

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

const rupees = (cents: number) =>
  `LKR ${centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const compactLkr = (lkr: number) =>
  `LKR ${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(lkr)}`;

/* ---------------------------------------------------------------- Hero */

export function InventoryHero({
  insights,
  loading,
  error,
  onRecord,
}: {
  insights?: Insights;
  loading: boolean;
  error?: string;
  onRecord: () => void;
}) {
  const t = insights?.totals;
  const value = t?.value_cents ?? 0;
  const hasValue = value > 0;
  const shown = useCountUp(hasValue ? centsToLkr(value) : 0);
  const [today, setToday] = useState("");
  // Render the date after mount so server and client timezones cannot disagree.
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }, []);

  // An error must not render as "0 pieces" — that reads as a real, wrong
  // number to whoever is looking for their gold.
  const dash = loading || !!error;
  const avgPurity = t && t.net_mg > 0 ? (t.fine_mg / t.net_mg) * 100 : 0;
  const strip: Array<{ label: string; value: string; sub?: ReactNode; icon: ReactNode }> = [
    {
      label: "Pieces on hand",
      value: dash ? "—" : (t?.pieces ?? 0).toLocaleString("en-US"),
      sub: dash ? undefined : `${insights?.byBranch.length ?? 0} branches`,
      icon: <PackageIcon size={16} />,
    },
    {
      label: "Net weight",
      value: dash ? "—" : `${grams(t?.net_mg ?? 0)} g`,
      sub: dash ? undefined : `${insights?.byKarat.length ?? 0} purities`,
      icon: <ScaleIcon size={16} />,
    },
    {
      label: "Fine gold",
      value: dash ? "—" : `${grams(t?.fine_mg ?? 0)} g`,
      sub: dash || avgPurity === 0 ? undefined : `${avgPurity.toFixed(1)}% average purity`,
      icon: <GemIcon size={16} />,
    },
    {
      label: "Stock value",
      value: dash ? "—" : hasValue ? `LKR ${Math.round(shown).toLocaleString("en-US")}` : "Not priced",
      sub: dash ? undefined : hasValue ? (
        "At today's board rates"
      ) : (
        <Link href="/gold-rates" className="inline-flex items-center gap-1 text-gold-light hover:text-paper">
          Set board rates <ArrowRightIcon size={11} />
        </Link>
      ),
      icon: <ArchiveIcon size={16} />,
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-void text-paper shadow-5 ring-1 ring-gold/10">
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="home-drift pointer-events-none absolute -right-24 -top-32 size-[22rem] rounded-full bg-gold/20 blur-[120px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-40 -left-24 size-80 rounded-full bg-emerald-400/10 blur-[110px]"
        aria-hidden
      />
      <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent"
        aria-hidden
      />

      <div className="relative flex flex-col gap-5 px-5 py-6 sm:px-7 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-8 lg:py-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
                error ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-gold/25 bg-gold/[0.08] text-gold-light"
              )}
            >
              <span className={cn("size-1.5 rounded-full", error ? "bg-rose-400" : "animate-pulse-soft bg-gold")} />
              {error ? "Data unavailable" : "Inventory"}
            </span>
            {today ? (
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-paper/40">{today}</span>
            ) : null}
          </div>
          <h1 className="g-display mt-3 text-3xl leading-tight text-paper sm:text-[2.4rem]">
            Every gram, <span className="home-gold-text">accounted for.</span>
          </h1>
          {!error ? (
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-paper/55">
              Live weights, fine gold and value across every branch — scan a piece to move it.
            </p>
          ) : null}
          {error ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-paper/60">
              {error}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 font-medium text-gold-light transition-colors hover:text-paper"
              >
                <RefreshCwIcon size={12} />
                Reload
              </button>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/scan" className="home-btn-gold h-11 px-5 text-sm">
            <ScanBarcodeIcon size={15} />
            Scan to move stock
          </Link>
          <button type="button" onClick={onRecord} className="home-btn-ghost group h-11 px-5 text-sm">
            Record movement
            <ArrowRightIcon size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
        {strip.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
              i === 2 && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
            )}
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                i === 2
                  ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                  : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
              )}
            >
              {s.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">
                {s.label}
              </span>
              {loading ? (
                <Skeleton className="mt-1 h-6 w-24 bg-paper/10" />
              ) : (
                <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", i === 2 ? "text-gold-light" : "text-paper")}>
                  {s.value}
                </span>
              )}
              {s.sub ? <span className="mt-0.5 block truncate text-[11px] text-paper/45">{s.sub}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Panels */

/**
 * Error state for a panel. A failed insights query must not read as "no
 * stock" — it reads as "we could not load this", with a way to retry just
 * that one query.
 */
export function QueryError({
  message,
  onRetry,
  dark,
}: {
  message: string;
  onRetry: () => void;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl px-6 py-8 text-center",
        dark
          ? "border border-dashed border-paper/15 bg-paper/[0.02]"
          : "border border-dashed border-ink/[0.12] bg-bone/60"
      )}
      role="alert"
    >
      <span
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-xl",
          dark
            ? "bg-paper/[0.06] text-gold-light"
            : "bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]"
        )}
      >
        <AlertCircleIcon size={18} />
      </span>
      <p className={cn("text-sm font-medium", dark ? "text-paper" : "text-ink")}>
        Could not load this
      </p>
      <p className={cn("mt-1 max-w-[18rem] text-xs", dark ? "text-paper/50" : "text-ink-4")}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          "g-btn mt-4 h-9 px-3.5 text-xs",
          dark
            ? "bg-paper/10 text-paper ring-1 ring-paper/15 hover:bg-paper/[0.16]"
            : "g-btn-secondary"
        )}
      >
        <RefreshCwIcon size={13} />
        Retry
      </button>
    </div>
  );
}

function DarkEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-paper/15 bg-paper/[0.02] px-6 py-9 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper/[0.06] text-gold-light">
        <GemIcon size={18} />
      </span>
      <p className="text-sm font-medium text-paper">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-paper/50">{desc}</p>
    </div>
  );
}

function LightEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink/[0.12] bg-bone/60 px-6 py-9 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)]">
        <GemIcon size={18} />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-4">{desc}</p>
    </div>
  );
}

function RowsSkeleton({ dark }: { dark?: boolean }) {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={cn("h-12 rounded-xl", dark && "bg-paper/10")} />
      ))}
    </div>
  );
}

/**
 * Alternating gold shades so neighbouring composition segments stay
 * distinguishable even when two karats hold similar shares.
 */
const KARAT_SEG = [
  "bg-gradient-to-r from-gold-light to-gold",
  "bg-gold-deep",
  "bg-gold-soft",
  "bg-gold-dark",
  "bg-gold",
];

export function StockByKarat({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const rows = data?.byKarat ?? [];
  const totalFine = rows.reduce((s, r) => s + r.fine_mg, 0);
  const totalPieces = rows.reduce((s, r) => s + r.pieces, 0);
  const empty =
    !error && !loading && rows.length === 0 ? (
      <DarkEmpty
        title="No stock on hand"
        desc="Intake a purchase or run a count to build up stock."
      />
    ) : null;
  return (
    <section className="relative flex flex-col overflow-hidden rounded-[22px] bg-void p-5 text-paper shadow-5 ring-1 ring-gold/10 sm:p-6" aria-label="Stock by karat">
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
      <div className="home-noise pointer-events-none absolute inset-0" aria-hidden />
      <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div
        className="home-drift pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-gold/20 blur-[90px]"
        aria-hidden
      />

      <div className="relative flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold-deep text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.6)]">
          <GemIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="font-sans text-[15px] font-semibold tracking-normal text-paper">
            Stock by karat
          </h2>
          <p className="truncate text-xs text-paper/45">
            {error ? "Unavailable" : loading ? "Loading" : `${grams(totalFine)} g fine gold`}
          </p>
        </div>
      </div>

      <div className="relative mt-5 flex-1">
        {error ? (
          <QueryError dark message={error} onRetry={onRetry} />
        ) : loading ? (
          <RowsSkeleton dark />
        ) : empty ? (
          empty
        ) : (
          <>
            <div
              className="flex h-2.5 gap-[3px] overflow-hidden rounded-full bg-paper/[0.06] p-px ring-1 ring-paper/[0.06]"
              role="img"
              aria-label={`Fine gold split across ${rows.length} ${
                rows.length === 1 ? "purity" : "purities"
              }`}
            >
              {rows.map((r, i) => {
                const share = totalFine > 0 ? (r.fine_mg / totalFine) * 100 : 0;
                return (
                  <div
                    key={r.purity_id}
                    className={cn(
                      "h-full rounded-full motion-reduce:transition-none",
                      KARAT_SEG[i % KARAT_SEG.length]
                    )}
                    style={{
                      width: `${Math.max(share, 2)}%`,
                      transition: `width 900ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 80}ms`,
                    }}
                    title={`${r.karat} · ${Math.round(share)}%`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-paper/40">
              <span>
                {rows.length} {rows.length === 1 ? "purity" : "purities"}
              </span>
              <span>
                {totalPieces.toLocaleString("en-US")}{" "}
                {totalPieces === 1 ? "piece" : "pieces"}
              </span>
            </div>

            <ul className="mt-4 space-y-2">
              {rows.map((r) => {
                const share = totalFine > 0 ? r.fine_mg / totalFine : 0;
                return (
                  <li
                    key={r.purity_id}
                    className="rounded-2xl bg-gradient-to-b from-paper/[0.06] to-paper/[0.02] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-paper/[0.08] transition-all duration-200 hover:-translate-y-px hover:ring-gold/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="g-metric flex h-8 min-w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-gold-light to-gold px-2 text-[13px] font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
                          {r.karat}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-paper">
                            {r.pieces} {r.pieces === 1 ? "piece" : "pieces"}
                          </div>
                          <div className="truncate text-[11px] text-paper/40">
                            {grams(r.net_mg)} g net · {rupees(r.value_cents)}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="g-metric text-sm text-paper">{grams(r.fine_mg)} g</div>
                        <div className="text-[11px] font-medium text-gold-light/90">
                          {Math.round(share * 100)}% of fine
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

export function StockByBranch({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const all = data?.byBranch ?? [];
  const rows = all.slice(0, 10);
  const hidden = all.length - rows.length;
  const totalNet = all.reduce((s, r) => s + r.net_mg, 0);
  return (
    <section className="flex flex-col">
      <SpotlightCard tone="light" className="flex flex-1 flex-col rounded-[22px] p-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_10px_20px_-12px_rgba(6,42,34,0.8)]">
            <Building2Icon size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="font-sans text-[15px] font-semibold tracking-normal text-ink">
              Stock by branch
            </h2>
            <p className="truncate text-xs text-ink-4">
              {error
                ? "Unavailable"
                : loading
                  ? "Loading"
                  : all.length === 0
                    ? "Where the metal is sitting right now"
                    : `${grams(totalNet)} g across ${all.length} ${
                        all.length === 1 ? "branch" : "branches"
                      }`}
            </p>
          </div>
        </div>

        <div className="mt-5 flex-1">
          {error ? (
            <QueryError message={error} onRetry={onRetry} />
          ) : loading ? (
            <RowsSkeleton />
          ) : rows.length === 0 ? (
            <LightEmpty title="No stock on hand" desc="Nothing is in stock at any branch." />
          ) : (
            <ul className="space-y-2">
              {rows.map((r, i) => {
                const share = totalNet > 0 ? (r.net_mg / totalNet) * 100 : 0;
                return (
                  <li key={r.branch_id}>
                    <div className="group block rounded-2xl bg-bone/60 p-3.5 ring-1 ring-ink/[0.06] transition-all duration-200 hover:-translate-y-px hover:bg-gold-pale/60 hover:shadow-[0_12px_24px_-16px_rgba(126,98,35,0.45)] hover:ring-gold-dark/25">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-paper text-ink-4 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-colors group-hover:bg-gold group-hover:text-void">
                            <Building2Icon size={14} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                            <div className="truncate text-[11px] text-ink-4">
                              {r.pieces} {r.pieces === 1 ? "piece" : "pieces"} ·{" "}
                              {rupees(r.value_cents)}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="g-metric text-sm text-ink">{grams(r.net_mg)} g</div>
                          <div className="text-[11px] text-ink-4">
                            {Math.round(share)}% of stock
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-void via-gold-dark to-gold-light motion-reduce:transition-none"
                          style={{
                            width: `${Math.max(share, 2)}%`,
                            transition: `width 900ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms`,
                          }}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hidden > 0 && !loading && !error ? (
          <p className="mt-3 text-center text-xs text-ink-4">+ {hidden} more {hidden === 1 ? "branch" : "branches"}</p>
        ) : null}
      </SpotlightCard>
    </section>
  );
}

/* ---------------------------------------------------------------- Attention */

type AlertRow = {
  key: string;
  icon: ReactNode;
  count: number;
  label: string;
  desc: string;
  tone: "warning" | "info" | "neutral";
  /** Statuses are catalog filters; movement types scroll to history. */
  href?: string;
  onClick?: () => void;
};

const ALERT_ICON_TONE = {
  warning: "bg-amber-100/80 text-amber-700 ring-amber-600/15",
  info: "bg-gold-pale text-gold-deep ring-gold-dark/15",
  neutral: "bg-ink/[0.06] text-ink-3 ring-ink/[0.08]",
} as const;

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function AttentionCard({
  data,
  loading,
  error,
  onRetry,
  onFilter,
}: {
  data?: Insights;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onFilter: (type: string) => void;
}) {
  const a = data?.attention;
  const last = a?.last_movement_at ?? null;
  const quiet = last === null || Date.now() - last > STALE_AFTER_MS;
  const openCount = (a?.transfer_pending ?? 0) + (a?.in_repair ?? 0) + (a?.reserved ?? 0);

  const rows: AlertRow[] = [];
  if (a?.transfer_pending)
    rows.push({
      key: "pending",
      icon: <TruckIcon size={15} />,
      count: a.transfer_pending,
      label: "pieces in transit",
      desc: "Awaiting receipt at destination",
      tone: "warning",
      onClick: () => onFilter("TRANSFER_OUT"),
    });
  if (a?.in_repair)
    rows.push({
      key: "repair",
      icon: <HammerIcon size={15} />,
      count: a.in_repair,
      label: "pieces in repair",
      desc: "Off the shelf at the workshop",
      tone: "info",
      href: "/products?status=IN_REPAIR",
    });
  if (a?.reserved)
    rows.push({
      key: "reserved",
      icon: <UserCheckIcon size={15} />,
      count: a.reserved,
      label: "pieces reserved",
      desc: "Held for customers, not on the shelf",
      tone: "neutral",
      href: "/products?status=RESERVED",
    });
  if (quiet)
    rows.push({
      key: "quiet",
      icon: <HistoryIcon size={15} />,
      count: 0,
      label:
        last === null ? "no movements logged yet" : "no movement in over a week",
      desc:
        last === null
          ? "Scan a piece to start the ledger"
          : `Last activity ${new Date(last).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}`,
      tone: "warning",
      onClick: () => onFilter(""),
    });

  return (
    <section className="flex flex-col">
      <SpotlightCard tone="light" className="flex flex-1 flex-col rounded-[22px] p-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_10px_20px_-12px_rgba(6,42,34,0.8)]">
            <AlertCircleIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-sans text-[15px] font-semibold tracking-normal text-ink">
              Needs attention
            </h2>
            <p className="truncate text-xs text-ink-4">
              {error ? "Unavailable" : a ? `${a.movements_24h} movements in 24h` : "Loading"}
            </p>
          </div>
          {!loading && !error && a ? (
            <span
              className={cn(
                "g-metric flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ring-1",
                openCount > 0
                  ? "bg-amber-100/80 text-amber-700 ring-amber-600/15"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
              )}
              title={`${openCount} open ${openCount === 1 ? "item" : "items"}`}
            >
              {openCount}
            </span>
          ) : null}
        </div>

        <div className="mt-5 flex-1">
          {error ? (
            <QueryError message={error} onRetry={onRetry} />
          ) : loading ? (
            <RowsSkeleton />
          ) : rows.length === 0 ? (
            <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-50 via-emerald-50/40 to-paper px-6 py-10 text-center ring-1 ring-emerald-600/10">
              <div className="pointer-events-none absolute -top-16 left-1/2 size-40 -translate-x-1/2 rounded-full bg-emerald-300/30 blur-3xl" aria-hidden />
              <span className="relative mb-4 flex size-14 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_12px_24px_-10px_rgba(5,150,105,0.7)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30" />
                <CheckCircleIcon size={24} />
              </span>
              <p className="relative text-base font-semibold text-ink">All clear</p>
              <p className="relative mt-1 max-w-[15rem] text-xs leading-relaxed text-ink-4">
                Nothing is in transit, repair or waiting on a decision.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const inner = (
                  <>
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1",
                        ALERT_ICON_TONE[r.tone]
                      )}
                    >
                      {r.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {r.count > 0 ? (
                          <>
                            <span className="g-metric mr-1 font-semibold">{r.count.toLocaleString("en-US")}</span>
                            {r.label}
                          </>
                        ) : (
                          r.label.charAt(0).toUpperCase() + r.label.slice(1)
                        )}
                      </span>
                      <span className="block truncate text-xs text-ink-4">{r.desc}</span>
                    </span>
                    <ArrowRightIcon
                      size={14}
                      className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark"
                    />
                  </>
                );
                const cls =
                  "group flex w-full items-center gap-3 rounded-2xl bg-paper p-3.5 text-left ring-1 ring-ink/[0.07] shadow-[0_1px_2px_rgba(16,32,27,0.05)] transition-all duration-200 hover:-translate-y-px hover:bg-gold-pale/40 hover:shadow-[0_12px_24px_-16px_rgba(126,98,35,0.45)] hover:ring-gold-dark/25";
                return (
                  <li key={r.key}>
                    {r.href ? (
                      <Link href={r.href} className={cls}>
                        {inner}
                      </Link>
                    ) : (
                      <button type="button" onClick={r.onClick} className={cls}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SpotlightCard>
    </section>
  );
}

/* ---------------------------------------------------------------- Scan preview */

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "found"; piece: Piece };

export function PiecePreview({ code, branchName }: { code: string; branchName?: (id: string) => string }) {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const trimmed = code.trim();

  useEffect(() => {
    if (!trimmed) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const t = setTimeout(async () => {
      try {
        const data = await api<Piece>(`/api/v1/products/barcode/${encodeURIComponent(trimmed)}`);
        if (!cancelled) setState({ kind: "found", piece: data });
      } catch (e) {
        if (!cancelled)
          setState({ kind: "error", message: e instanceof Error ? e.message : "Piece not found" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed]);

  if (state.kind === "idle")
    return (
      <div className="rounded-xl border border-dashed border-ink/15 bg-bone/40 px-4 py-8 text-center">
        <ScanBarcodeIcon size={20} className="mx-auto text-ink-5" />
        <p className="mt-2 text-xs text-ink-4">Scan or type a barcode to preview the piece</p>
      </div>
    );

  if (state.kind === "loading") return <Skeleton className="h-32 rounded-xl" />;

  if (state.kind === "error")
    return (
      <Callout tone="danger" title="No piece with that barcode">
        {state.message} Check the label and scan again.
      </Callout>
    );

  const p = state.piece.product;
  return (
    <div className="animate-fade-in rounded-xl bg-bone/60 p-4 ring-1 ring-ink/[0.06]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{p.name}</div>
          <div className="mt-0.5 font-mono text-xs text-ink-4">{p.barcode}</div>
        </div>
        <StatusPill status={p.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {[
          ["Purity", p.karat],
          ["Branch", branchName ? branchName(p.branch_id) : p.branch_id.slice(0, 8)],
          ["Net weight", `${grams(p.net_mg)} g`],
          ["Fine gold", `${grams(p.fine_gold_mg)} g`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-ink-4">{k}</dt>
            <dd className="mt-0.5 truncate font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- Filters */

export function MovementFilters({
  type,
  branch,
  search,
  onType,
  onBranch,
  onSearch,
  onClear,
  branches,
}: {
  onClear: () => void;
  type: string;
  branch: string;
  search: string;
  onType: (t: string) => void;
  onBranch: (b: string) => void;
  onSearch: (s: string) => void;
  branches: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="group relative w-full sm:w-72">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-5 transition-colors group-focus-within:text-gold-dark"
          />
          <span className="sr-only">Search movements</span>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search barcode or reason"
            className="h-11 w-full rounded-xl bg-bone/60 pl-10 pr-9 text-sm text-ink shadow-[inset_0_0_0_1px_rgba(16,32,27,0.08)] transition-all duration-200 placeholder:text-ink-5 hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.2)] focus:bg-paper focus:outline-none focus:shadow-[inset_0_0_0_1px_#10201b,0_0_0_4px_rgba(205,168,83,0.24)]"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-ink-4 hover:bg-ink/5 hover:text-ink"
            >
              <XIcon size={13} />
            </button>
          ) : null}
        </label>
        <Select
          className="w-full sm:w-56"
          ariaLabel="Filter by branch"
          value={branch}
          onChange={onBranch}
          icon={<Building2Icon size={13} />}
          options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
        />
        {type || branch || search ? (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-medium text-ink-3 transition-colors hover:bg-bone hover:text-ink"
          >
            <RefreshCwIcon size={12} />
            Reset
          </button>
        ) : null}
      </div>
      <div role="tablist" aria-label="Movement type" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
        {MOVEMENT_TYPES.map((o) => {
          const active = o.key === type;
          return (
            <button
              key={o.key || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onType(o.key)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-xs font-medium transition-all duration-200 ease-brand",
                active
                  ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
                  : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Detail modal */

export function PieceDetail({
  piece,
  onClose,
  onMove,
  branchName,
}: {
  piece: Piece;
  onClose: () => void;
  onMove: (barcode: string) => void;
  branchName?: (id: string) => string;
}) {
  const p = piece.product;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const purity = p.net_mg > 0 ? (p.fine_gold_mg / p.net_mg) * 100 : 0;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-void/60 p-4 backdrop-blur-md sm:items-center"
      onClick={onClose}
    >
      <div
        className="g-floating w-full max-w-md animate-pop-in overflow-hidden rounded-[24px] shadow-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="piece-detail-title"
      >
        <div className="relative overflow-hidden bg-void px-6 pb-6 pt-6 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-50" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={16} />
          </button>
          <div className="relative flex items-center gap-3">
            <span className="g-metric flex h-12 min-w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold px-2.5 text-base font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_22px_-10px_rgba(205,168,83,0.7)]">
              {p.karat}
            </span>
            <div className="min-w-0 pr-8">
              <h2 id="piece-detail-title" className="truncate font-display text-lg font-bold tracking-tight text-paper">
                {p.name}
              </h2>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-paper/[0.06] px-1.5 py-0.5 font-mono text-xs text-paper/70 ring-1 ring-paper/10">
                <ScanBarcodeIcon size={11} className="text-gold-light" />
                {p.barcode}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-4">Status</span>
            <StatusPill status={p.status} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Branch", branchName ? branchName(p.branch_id) : p.branch_id.slice(0, 8)],
              ["Cost", rupees(p.cost_cents)],
              ["Net weight", `${grams(p.net_mg)} g`],
              ["Fine gold", `${grams(p.fine_gold_mg)} g · ${purity.toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-2xl bg-bone/70 p-3.5 ring-1 ring-ink/[0.05]">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">{k}</dt>
                <dd className="g-metric mt-1 truncate text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Link href={`/products/${p.id}`} className="g-btn g-btn-secondary h-11 rounded-xl px-4 text-sm">
              View product
            </Link>
            <button
              type="button"
              className="g-btn g-btn-primary h-11 rounded-xl px-5 text-sm"
              onClick={() => onMove(p.barcode)}
            >
              Record movement
              <ArrowRightIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
