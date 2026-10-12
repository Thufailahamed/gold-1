"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page, Skeleton } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  InboxIcon,
  PackageIcon,
  PlusIcon,
  TruckIcon,
} from "@/components/icons";

type TransferStatus = "REQUESTED" | "APPROVED" | "DISPATCHED" | "PARTIAL" | "COMPLETE" | "CANCELLED";

type TransferListRow = {
  id: string;
  number: string;
  from_branch_id: string;
  from_branch_name: string;
  to_branch_id: string;
  to_branch_name: string;
  status: TransferStatus;
  reason: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: number;
  lines: number;
  in_transit: number;
  received: number;
};

const STATUS_LABEL: Record<TransferStatus, string> = {
  REQUESTED: "Awaiting approval",
  APPROVED: "Approved",
  DISPATCHED: "In transit",
  PARTIAL: "Partially received",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

const STATUS_STYLE: Record<TransferStatus, { chip: string; dot: string }> = {
  REQUESTED: { chip: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  APPROVED: { chip: "bg-sky-50 text-sky-800 ring-sky-600/20", dot: "bg-sky-500" },
  DISPATCHED: { chip: "bg-gold-pale text-gold-deep ring-gold-dark/25", dot: "bg-gold" },
  PARTIAL: { chip: "bg-gold-pale text-gold-deep ring-gold-dark/25", dot: "bg-gold-dark" },
  COMPLETE: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  CANCELLED: { chip: "bg-bone text-ink-4 ring-ink/10", dot: "bg-ink-5" },
};

const STATUS_FILTERS: ReadonlyArray<{ key: string; label: string; dot?: string; match: (s: TransferStatus) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "requested", label: "Awaiting approval", dot: "bg-amber-500", match: (s) => s === "REQUESTED" },
  { key: "approved", label: "Approved", dot: "bg-sky-500", match: (s) => s === "APPROVED" },
  { key: "transit", label: "In transit", dot: "bg-gold", match: (s) => s === "DISPATCHED" || s === "PARTIAL" },
  { key: "complete", label: "Complete", dot: "bg-emerald-500", match: (s) => s === "COMPLETE" },
  { key: "cancelled", label: "Cancelled", dot: "bg-ink-5", match: (s) => s === "CANCELLED" },
];

// The hero pipeline: the four live stages, in order.
const PIPELINE: { key: string; label: string; icon: ReactNode }[] = [
  { key: "requested", label: "Requested", icon: <InboxIcon size={15} /> },
  { key: "approved", label: "Approved", icon: <ClipboardCheckIcon size={15} /> },
  { key: "transit", label: "In transit", icon: <TruckIcon size={15} /> },
  { key: "complete", label: "Complete", icon: <CheckCircleIcon size={15} /> },
];

type Direction = "all" | "outgoing" | "incoming";
const DIRECTIONS: { key: Direction; label: string }[] = [
  { key: "all", label: "Both" },
  { key: "outgoing", label: "Outgoing" },
  { key: "incoming", label: "Incoming" },
];

const cardShadow =
  "shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07),0_1px_2px_rgba(16,32,27,0.04),0_22px_44px_-32px_rgba(16,32,27,0.35)]";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export default function TransfersPage() {
  const [statusKey, setStatusKey] = useState("all");
  const [direction, setDirection] = useState<Direction>("all");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "products:edit");
  const myBranches = useMemo(() => new Set(me.data?.branchIds ?? []), [me.data]);

  const list = useQuery({
    queryKey: ["transfers"],
    queryFn: () => api<TransferListRow[]>("/api/v1/transfers"),
  });

  const all = list.data ?? [];
  const byDirection = all.filter((r) =>
    direction === "outgoing"
      ? myBranches.has(r.from_branch_id)
      : direction === "incoming"
        ? myBranches.has(r.to_branch_id)
        : true
  );
  const activeFilter = STATUS_FILTERS.find((f) => f.key === statusKey) ?? STATUS_FILTERS[0]!;
  const rows = byDirection.filter((r) => activeFilter.match(r.status));
  const countFor = (key: string) => {
    const f = STATUS_FILTERS.find((x) => x.key === key);
    return f ? byDirection.filter((r) => f.match(r.status)).length : 0;
  };
  const countAll = (key: string) => {
    const f = STATUS_FILTERS.find((x) => x.key === key);
    return f ? all.filter((r) => f.match(r.status)).length : 0;
  };

  const awaiting = all.filter((r) => r.status === "REQUESTED").length;
  const inTransitPieces = all.reduce(
    (n, r) => n + (r.status === "DISPATCHED" || r.status === "PARTIAL" ? r.in_transit : 0),
    0
  );
  const incomingOpen = all.filter(
    (r) => (r.status === "DISPATCHED" || r.status === "PARTIAL") && myBranches.has(r.to_branch_id)
  ).length;

  const stats: { label: string; value: number; sub: string; icon: ReactNode; gold?: boolean; warn?: boolean }[] = [
    { label: "Transfers", value: all.length, sub: "Touching your branches", icon: <ArrowLeftRightIcon size={16} /> },
    { label: "Awaiting approval", value: awaiting, sub: awaiting ? "Needs a decision" : "Nothing to approve", icon: <InboxIcon size={16} />, warn: awaiting > 0 },
    { label: "Pieces in transit", value: inTransitPieces, sub: "Dispatched, not yet received", icon: <TruckIcon size={16} />, gold: true },
    { label: "Incoming to receive", value: incomingOpen, sub: incomingOpen ? "Scan them in on arrival" : "Nothing inbound", icon: <PackageIcon size={16} /> },
  ];

  const dirIdx = DIRECTIONS.findIndex((d) => d.key === direction);
  const filtered = statusKey !== "all" || direction !== "all";

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
            <Link
              href="/inventory"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-paper/50 transition-colors hover:text-gold-light"
            >
              <ArrowLeftIcon size={13} />
              Inventory
            </Link>
            <span className="mt-3 flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-light">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-gold" />
                Inventory · Transfers
              </span>
            </span>
            <h1 className="g-display mt-3.5 text-3xl text-paper sm:text-[2.6rem]">
              Branch transfers, <span className="home-gold-text">scan to scan.</span>
            </h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper/60">
              Move pieces between branches: request, approve, dispatch, and receive by scan.
            </p>
          </div>
          {canCreate ? (
            <Link href="/inventory/transfers/new" className="home-btn-gold h-11 shrink-0 self-start px-5 text-sm lg:self-auto">
              <PlusIcon size={15} />
              New transfer
            </Link>
          ) : null}
        </div>

        {/* Pipeline */}
        <div className="relative px-5 pb-6 sm:px-7 lg:px-8">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PIPELINE.map((p, i) => {
              const n = countAll(p.key);
              const on = statusKey === p.key;
              return (
                <li key={p.key} className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusKey(on ? "all" : p.key)}
                    aria-pressed={on}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left ring-1 transition-all duration-200",
                      on
                        ? "bg-gold/[0.14] ring-gold/50 shadow-[0_10px_24px_-14px_rgba(205,168,83,0.7)]"
                        : "bg-paper/[0.04] ring-paper/10 hover:bg-paper/[0.07] hover:ring-gold/30"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors",
                        on ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40" : "bg-paper/[0.06] text-gold-light ring-paper/10"
                      )}
                    >
                      {p.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/45">
                        {String(i + 1).padStart(2, "0")} · {p.label}
                      </span>
                      {list.isLoading ? (
                        <Skeleton className="mt-1 h-5 w-8 bg-paper/10" />
                      ) : (
                        <span className={cn("g-metric block text-lg leading-tight", on ? "text-gold-light" : "text-paper")}>{n}</span>
                      )}
                    </span>
                  </button>
                  {i < PIPELINE.length - 1 ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-void text-gold/70 ring-1 ring-gold/25 sm:flex"
                    >
                      <ArrowRightIcon size={8} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative grid grid-cols-2 gap-px border-t border-paper/[0.08] bg-paper/[0.06] lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(
                "group flex min-w-0 items-center gap-3.5 bg-void/95 px-4 py-4 transition-colors hover:bg-void/80 sm:px-6",
                s.gold && "bg-gradient-to-br from-void/95 to-[#0d3a2c]/95"
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 transition-colors",
                  s.gold
                    ? "bg-gradient-to-b from-gold-light to-gold text-void ring-gold/40"
                    : s.warn
                      ? "bg-amber-400/15 text-amber-200 ring-amber-300/25"
                      : "bg-gradient-to-b from-paper/[0.09] to-paper/[0.03] text-gold-light ring-paper/[0.09] group-hover:text-gold"
                )}
              >
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-paper/40">{s.label}</span>
                {list.isLoading ? (
                  <Skeleton className="mt-1 h-6 w-10 bg-paper/10" />
                ) : (
                  <span className={cn("g-metric mt-0.5 block truncate text-xl leading-tight", s.gold ? "text-gold-light" : s.warn ? "text-amber-200" : "text-paper")}>
                    {s.value.toLocaleString("en-US")}
                  </span>
                )}
                <span className="mt-1 block truncate text-[10px] text-paper/35">{s.sub}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Transfers */}
      <section className={cn("relative overflow-hidden rounded-[22px] bg-paper", cardShadow)}>
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-ink/[0.06] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25),0_8px_18px_-10px_rgba(6,42,34,0.7)]">
                <ArrowLeftRightIcon size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-sans text-[15px] font-semibold tracking-normal text-ink">Transfers</h2>
                <p className="truncate text-xs text-ink-4">Only transfers touching your branches are shown.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="g-metric hidden items-center gap-1.5 rounded-full bg-bone px-3 py-1 text-[11px] text-ink-3 ring-1 ring-ink/[0.06] sm:inline-flex">
                <span className="font-semibold text-ink">{rows.length}</span> shown
                {list.isFetching && !list.isLoading ? (
                  <span className="ml-0.5 size-3 animate-spin rounded-full border-2 border-gold/30 border-t-gold" aria-label="Refreshing" />
                ) : null}
              </span>
              <div
                role="tablist"
                aria-label="Direction"
                className="relative grid grid-cols-3 rounded-xl bg-bone p-1 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.07)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-void shadow-[inset_0_0_0_1px_rgba(205,168,83,0.3),0_8px_18px_-10px_rgba(6,42,34,0.8)] transition-transform duration-320 ease-brand"
                  style={{ transform: `translateX(${dirIdx * 100}%)` }}
                />
                {DIRECTIONS.map((d) => {
                  const on = d.key === direction;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setDirection(d.key)}
                      className={cn(
                        "relative h-9 whitespace-nowrap rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-200",
                        on ? "text-paper" : "text-ink-4 hover:text-ink"
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div role="tablist" aria-label="Filter by status" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
            {STATUS_FILTERS.map((f) => {
              const on = f.key === statusKey;
              const n = list.data ? countFor(f.key) : null;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setStatusKey(f.key)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-3.5 pr-2 text-xs font-medium transition-all duration-200 ease-brand",
                    on
                      ? "bg-void text-paper shadow-[inset_0_0_0_1px_rgba(205,168,83,0.35),0_8px_18px_-10px_rgba(6,42,34,0.8)]"
                      : "bg-paper text-ink-3 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] hover:-translate-y-px hover:text-ink hover:shadow-[inset_0_0_0_1px_rgba(16,32,27,0.24)]"
                  )}
                >
                  {f.dot ? <span className={cn("size-1.5 rounded-full", f.dot)} /> : null}
                  {f.label}
                  <span
                    className={cn(
                      "g-metric min-w-[1.4rem] rounded-full px-1.5 py-0.5 text-center text-[10px]",
                      on ? "bg-gold/20 text-gold-light" : "bg-bone text-ink-4"
                    )}
                  >
                    {n ?? "·"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          {list.isLoading ? (
            <div className="space-y-2.5 p-5 sm:p-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 rounded-2xl" />
              ))}
            </div>
          ) : list.isError ? (
            <Empty
              icon={<AlertCircleIcon size={24} />}
              title="Couldn't load transfers"
              body={list.error instanceof Error ? list.error.message : "Check the API connection and retry."}
              action={
                <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm">
                  Retry
                </button>
              }
            />
          ) : rows.length === 0 ? (
            <Empty
              icon={<TruckIcon size={24} />}
              title={all.length === 0 ? "No transfers yet" : "No transfers match"}
              body={all.length === 0 ? "Request a transfer to move pieces to another branch." : "Try a different status or direction filter."}
              action={
                all.length === 0 ? (
                  canCreate ? (
                    <Link href="/inventory/transfers/new" className="g-btn g-btn-primary h-10 rounded-xl px-4 text-sm">
                      <PlusIcon size={14} /> New transfer
                    </Link>
                  ) : null
                ) : filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStatusKey("all");
                      setDirection("all");
                    }}
                    className="g-btn g-btn-secondary h-10 rounded-xl px-4 text-sm"
                  >
                    Clear filters
                  </button>
                ) : null
              }
            />
          ) : (
            <table className="g-table">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th>Received</th>
                  <th className="!text-right">In transit</th>
                  <th>Requested by</th>
                  <th className="w-14">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.CANCELLED;
                  const cancelled = r.status === "CANCELLED";
                  const share = r.lines > 0 ? Math.min(r.received / r.lines, 1) : 0;
                  const out = myBranches.has(r.from_branch_id);
                  const inc = myBranches.has(r.to_branch_id);
                  return (
                    <tr key={r.id} className={cn("group", cancelled && "opacity-60")}>
                      <td>
                        <Link href={`/inventory/transfers/${r.id}`} className="flex items-center gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-void text-gold-light shadow-[inset_0_0_0_1px_rgba(205,168,83,0.25)] transition-transform duration-320 group-hover:scale-105">
                            <ArrowLeftRightIcon size={15} />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("g-metric block text-[13px] font-semibold text-ink transition-colors group-hover:text-gold-deep", cancelled && "line-through")}>
                              {r.number}
                            </span>
                            <span className="mt-0.5 block whitespace-nowrap text-[11px] text-ink-5">
                              {day(r.created_at)} · {time(r.created_at)}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className={cn("rounded-lg px-2 py-1 text-[12px] font-medium ring-1", out ? "bg-void text-paper ring-gold/25" : "bg-bone text-ink ring-ink/[0.06]")}>
                            {r.from_branch_name}
                          </span>
                          <span className="flex items-center text-gold-dark" aria-label="to">
                            <span className="h-px w-3 bg-gradient-to-r from-gold/20 to-gold" />
                            <ArrowRightIcon size={11} />
                          </span>
                          <span className={cn("rounded-lg px-2 py-1 text-[12px] font-medium ring-1", inc ? "bg-void text-paper ring-gold/25" : "bg-bone text-ink ring-ink/[0.06]")}>
                            {r.to_branch_name}
                          </span>
                        </span>
                        {r.reason ? <span className="mt-1 block max-w-[16rem] truncate text-[11px] text-ink-5">{r.reason}</span> : null}
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1", st.chip)}>
                          <span className={cn("size-1.5 rounded-full", st.dot)} />
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      <td className="min-w-[8.5rem]">
                        <span className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="g-metric font-medium text-ink">
                            {r.received}
                            <span className="text-ink-5">/{r.lines}</span>
                          </span>
                          <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                          <span
                            className={cn(
                              "block h-full rounded-full transition-[width] duration-700 ease-brand",
                              share >= 1 ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : "bg-gradient-to-r from-gold-dark to-gold-light"
                            )}
                            style={{ width: `${share * 100}%` }}
                          />
                        </span>
                      </td>
                      <td className="!text-right">
                        {r.in_transit > 0 ? (
                          <span className="g-metric inline-flex items-center gap-1 rounded-full bg-gold-pale px-2.5 py-1 text-[11px] font-semibold text-gold-deep ring-1 ring-gold-dark/20">
                            <TruckIcon size={11} />
                            {r.in_transit}
                          </span>
                        ) : (
                          <span className="g-metric text-xs text-ink-5">0</span>
                        )}
                      </td>
                      <td>
                        {r.requested_by_name ? (
                          <span className="flex items-center gap-2">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[10px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
                              {initials(r.requested_by_name)}
                            </span>
                            <span className="max-w-[10rem] truncate text-[13px] text-ink-2">{r.requested_by_name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-ink-5">—</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/inventory/transfers/${r.id}`}
                          aria-label={`Open transfer ${r.number}`}
                          className="ml-auto flex size-8 items-center justify-center rounded-full text-ink-5 shadow-[inset_0_0_0_1px_rgba(16,32,27,0.1)] transition-all group-hover:bg-void group-hover:text-gold-light group-hover:shadow-none"
                        >
                          <ArrowRightIcon size={13} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!list.isLoading && rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink/[0.06] bg-bone/40 px-5 py-3 text-[11px] text-ink-4 sm:px-6">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-void ring-1 ring-gold/25" />
              Your branch
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-5 rounded-full bg-gradient-to-r from-gold-dark to-gold-light" />
              Lines received
            </span>
          </div>
        ) : null}
      </section>
    </Page>
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
