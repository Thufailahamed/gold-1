"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { centsToLkr, mgToG } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { Select } from "@/components/select";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckCircleIcon,
  GemIcon,
  HammerIcon,
  HistoryIcon,
  RefreshCwIcon,
  ScanBarcodeIcon,
  SearchIcon,
  TruckIcon,
  UserCheckIcon,
  XIcon,
} from "@/components/icons";
import { MOVEMENT_TYPES, type Insights, type Piece } from "./columns";
import { Card, CardHead, Empty, FilterPills, PieceChip, RowsSkeleton, ShareBar, ago, inputCls, th, thead, tr } from "./kit";

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
const rupees = (cents: number) => `LKR ${centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/* ---------------------------------------------------------------- errors */

/**
 * A failed insights query must not read as "no stock": it reads as "we could
 * not load this", with a way to retry just that query.
 */
export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="m-3 flex items-center gap-3 rounded-xl border border-dashed border-rose-500/25 bg-rose-500/[0.04] px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-700">
        <AlertCircleIcon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">Could not load this</p>
        <p className="truncate text-[11px] text-ink-4">{message}</p>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-inset ring-ink/20 hover:bg-bone hover:text-ink">
        <RefreshCwIcon size={11} /> Retry
      </button>
    </div>
  );
}

type PanelProps = { data?: Insights; loading: boolean; error?: string; onRetry: () => void };

/* ---------------------------------------------------------------- karat */

/** Alternating gold shades so neighbouring segments stay distinguishable. */
const KARAT_SEG = ["bg-gradient-to-r from-gold-light to-gold", "bg-gold-deep", "bg-gold-soft", "bg-gold-dark", "bg-gold"];

export function StockByKarat({ data, loading, error, onRetry }: PanelProps) {
  const rows = data?.byKarat ?? [];
  const totalFine = rows.reduce((s, r) => s + r.fine_mg, 0);
  return (
    <Card>
      <CardHead
        icon={GemIcon}
        title="Stock by karat"
        sub={error ? "Unavailable" : loading ? "Loading" : `${grams(totalFine)} g fine across ${rows.length} ${rows.length === 1 ? "purity" : "purities"}`}
      />
      {error ? (
        <QueryError message={error} onRetry={onRetry} />
      ) : loading ? (
        <RowsSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <Empty icon={GemIcon} title="No stock on hand" desc="Intake a purchase or run a count to build up stock." />
      ) : (
        <>
          <div className="px-4 pt-3">
            <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-ink/[0.05]" role="img" aria-label="Fine gold split by purity">
              {rows.map((r, i) => (
                <div
                  key={r.purity_id}
                  className={cn("h-full rounded-full", KARAT_SEG[i % KARAT_SEG.length])}
                  style={{ width: `${Math.max(totalFine > 0 ? (r.fine_mg / totalFine) * 100 : 0, 2)}%` }}
                  title={`${r.karat}`}
                />
              ))}
            </div>
          </div>
          <table className="mt-2 w-full text-[12px]">
            <thead className={thead}>
              <tr>
                <th className={cn(th, "pl-4")}>Karat</th>
                <th className={cn(th, "text-right")}>Pcs</th>
                <th className={cn(th, "text-right")}>Fine g</th>
                <th className={cn(th, "pr-4 text-right")}>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = totalFine > 0 ? (r.fine_mg / totalFine) * 100 : 0;
                return (
                  <tr key={r.purity_id} className={tr}>
                    <td className="py-1.5 pl-4 pr-2">
                      <span className="flex items-center gap-2">
                        <span className="g-metric rounded-md bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10.5px] font-bold text-void">{r.karat}</span>
                        <span className="text-[10.5px] text-ink-5">{Math.round(share)}%</span>
                      </span>
                    </td>
                    <td className="g-metric px-2 py-1.5 text-right text-ink-3">{r.pieces}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className="g-metric text-ink">{grams(r.fine_mg)}</span>
                      <span className="block text-[10px] text-ink-5">{grams(r.net_mg)} net</span>
                    </td>
                    <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-3">{r.value_cents ? rupees(r.value_cents) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- branch */

export function StockByBranch({ data, loading, error, onRetry }: PanelProps) {
  const all = data?.byBranch ?? [];
  const rows = all.slice(0, 8);
  const hidden = all.length - rows.length;
  const totalNet = all.reduce((s, r) => s + r.net_mg, 0);
  return (
    <Card>
      <CardHead
        icon={Building2Icon}
        title="Stock by branch"
        sub={error ? "Unavailable" : loading ? "Loading" : `${grams(totalNet)} g across ${all.length} ${all.length === 1 ? "branch" : "branches"}`}
      />
      {error ? (
        <QueryError message={error} onRetry={onRetry} />
      ) : loading ? (
        <RowsSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <Empty icon={Building2Icon} title="No stock on hand" desc="Nothing is in stock at any branch." />
      ) : (
        <table className="w-full text-[12px]">
          <thead className={thead}>
            <tr>
              <th className={cn(th, "pl-4")}>Branch</th>
              <th className={cn(th, "text-right")}>Pcs</th>
              <th className={cn(th, "text-right")}>Net g</th>
              <th className={cn(th, "pr-4 text-right")}>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = totalNet > 0 ? (r.net_mg / totalNet) * 100 : 0;
              return (
                <tr key={r.branch_id} className={tr}>
                  <td className="py-1.5 pl-4 pr-2">
                    <span className="block truncate font-medium text-ink">{r.name}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <ShareBar value={share} className="h-1 w-16" />
                      <span className="text-[10px] text-ink-5">{Math.round(share)}%</span>
                    </span>
                  </td>
                  <td className="g-metric px-2 py-1.5 text-right text-ink-3">{r.pieces}</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className="g-metric text-ink">{grams(r.net_mg)}</span>
                    <span className="block text-[10px] text-ink-5">{grams(r.fine_mg)} fine</span>
                  </td>
                  <td className="g-metric py-1.5 pl-2 pr-4 text-right text-ink-3">{r.value_cents ? rupees(r.value_cents) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hidden > 0 && !loading && !error ? (
        <p className="border-t border-ink/20 px-4 py-1.5 text-center text-[11px] text-ink-4">+ {hidden} more {hidden === 1 ? "branch" : "branches"}</p>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- attention */

type AlertRow = {
  key: string;
  icon: ReactNode;
  count: number;
  label: string;
  desc: string;
  tone: "warning" | "info" | "neutral";
  href?: string;
  onClick?: () => void;
};

const ALERT_TONE = {
  warning: "bg-amber-500/10 text-amber-700",
  info: "bg-gold/15 text-gold-deep",
  neutral: "bg-ink/[0.06] text-ink-3",
} as const;

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function AttentionCard({ data, loading, error, onRetry, onFilter }: PanelProps & { onFilter: (type: string) => void }) {
  const a = data?.attention;
  const last = a?.last_movement_at ?? null;
  const quiet = last === null || Date.now() - last > STALE_AFTER_MS;
  const openCount = (a?.transfer_pending ?? 0) + (a?.in_repair ?? 0) + (a?.reserved ?? 0);

  const rows: AlertRow[] = [];
  if (a?.transfer_pending)
    rows.push({ key: "pending", icon: <TruckIcon size={13} />, count: a.transfer_pending, label: "in transit", desc: "Awaiting receipt at destination", tone: "warning", onClick: () => onFilter("TRANSFER_OUT") });
  if (a?.in_repair)
    rows.push({ key: "repair", icon: <HammerIcon size={13} />, count: a.in_repair, label: "in repair", desc: "Off the shelf at the workshop", tone: "info", href: "/products?status=IN_REPAIR" });
  if (a?.reserved)
    rows.push({ key: "reserved", icon: <UserCheckIcon size={13} />, count: a.reserved, label: "reserved", desc: "Held for customers", tone: "neutral", href: "/products?status=RESERVED" });
  if (quiet)
    rows.push({
      key: "quiet",
      icon: <HistoryIcon size={13} />,
      count: 0,
      label: last === null ? "No movements logged yet" : "No movement in over a week",
      desc: last === null ? "Scan a piece to start the ledger" : `Last activity ${ago(last)}`,
      tone: "warning",
      onClick: () => onFilter(""),
    });

  return (
    <Card>
      <CardHead
        icon={AlertCircleIcon}
        title="Needs attention"
        sub={error ? "Unavailable" : a ? `${a.movements_24h} movements in 24h${last ? ` · last ${ago(last)}` : ""}` : "Loading"}
        action={
          !loading && !error && a ? (
            <span
              className={cn(
                "g-metric inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ring-1 ring-inset",
                openCount > 0 ? "bg-amber-500/10 text-amber-800 ring-amber-500/25" : "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25"
              )}
            >
              {openCount}
            </span>
          ) : null
        }
      />
      {error ? (
        <QueryError message={error} onRetry={onRetry} />
      ) : loading ? (
        <RowsSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <div className="m-3 flex flex-1 items-center gap-3 rounded-xl bg-gradient-to-br from-emerald-50 to-paper px-4 py-4 ring-1 ring-emerald-600/10">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-emerald-500 to-emerald-700 text-paper shadow-[0_8px_18px_-8px_rgba(5,150,105,0.7)]">
            <CheckCircleIcon size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">All clear</p>
            <p className="text-[11px] leading-snug text-ink-4">Nothing is in transit, repair or waiting on a decision.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-ink/[0.05]">
          {rows.map((r) => {
            const inner = (
              <>
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", ALERT_TONE[r.tone])}>{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {r.count > 0 ? (
                      <>
                        <span className="g-metric mr-1 font-semibold">{r.count.toLocaleString("en-US")}</span>
                        {r.count === 1 ? "piece" : "pieces"} {r.label}
                      </>
                    ) : (
                      r.label
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-ink-4">{r.desc}</span>
                </span>
                <ArrowRightIcon size={12} className="shrink-0 text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
              </>
            );
            const cls = "group flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-gold-pale/30";
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
    </Card>
  );
}

/* ---------------------------------------------------------------- filters */

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
    <div className="flex flex-col gap-2 border-b border-ink/20 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-60">
          <SearchIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
          <span className="sr-only">Search movements</span>
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search barcode or reason" className={cn(inputCls, "w-full pl-8 pr-8")} />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-4 hover:bg-ink/5 hover:text-ink"
            >
              <XIcon size={11} />
            </button>
          ) : null}
        </label>
        <Select
          size="sm"
          className="w-full sm:w-48"
          ariaLabel="Filter by branch"
          value={branch}
          onChange={onBranch}
          icon={<Building2Icon size={12} />}
          options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
        />
        {type || branch || search ? (
          <button type="button" onClick={onClear} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-ink-3 hover:bg-bone hover:text-ink">
            <RefreshCwIcon size={11} /> Reset
          </button>
        ) : null}
      </div>
      <div className="-mx-1 overflow-x-auto px-1 scrollbar-thin">
        <FilterPills items={MOVEMENT_TYPES.map((o) => ({ key: o.key, label: o.label }))} value={type} onChange={onType} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- detail */

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
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-void/60 p-4 backdrop-blur-md sm:items-center" onClick={onClose}>
      <div
        className="g-floating w-full max-w-md animate-pop-in overflow-hidden rounded-[20px] shadow-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="piece-detail-title"
      >
        <div className="relative overflow-hidden bg-void px-5 py-4 text-paper">
          <div className="home-grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-[80px]" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
          >
            <XIcon size={15} />
          </button>
          <div className="relative flex items-center gap-3">
            <span className="g-metric flex h-10 min-w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-gold-light to-gold px-2 text-sm font-bold text-void shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
              {p.karat}
            </span>
            <div className="min-w-0 pr-8">
              <h2 id="piece-detail-title" className="truncate font-sans text-[15px] font-semibold tracking-normal text-paper">
                {p.name}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-paper/[0.06] px-1.5 py-px font-mono text-[11px] text-paper/70 ring-1 ring-paper/10">
                  <ScanBarcodeIcon size={10} className="text-gold-light" />
                  {p.barcode}
                </span>
                <PieceChip status={p.status} className="bg-paper" />
              </div>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px bg-ink/[0.06]">
          {[
            ["Branch", branchName ? branchName(p.branch_id) : p.branch_id.slice(0, 8)],
            ["Cost", rupees(p.cost_cents)],
            ["Net weight", `${grams(p.net_mg)} g`],
            ["Fine gold", `${grams(p.fine_gold_mg)} g · ${purity.toFixed(1)}%`],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 bg-paper px-5 py-2.5">
              <dt className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-5">{k}</dt>
              <dd className="g-metric mt-0.5 truncate text-[13px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap justify-end gap-2 border-t border-ink/20 bg-bone/50 px-5 py-3">
          <Link href={`/products/${p.id}`} className="g-btn g-btn-secondary h-9 rounded-lg px-3.5 text-[13px]">
            View product
          </Link>
          <button type="button" className="g-btn g-btn-primary h-9 rounded-lg px-4 text-[13px]" onClick={() => onMove(p.barcode)}>
            Record movement
            <ArrowRightIcon size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
