"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Page } from "@/components/ui";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardCheckIcon,
  InboxIcon,
  PlusIcon,
  SearchIcon,
  TruckIcon,
} from "@/components/icons";
import {
  Avatar,
  Card,
  CardHead,
  Empty,
  FilterPills,
  GoldHero,
  HeroBadge,
  Progress,
  RowsSkeleton,
  TransferChip,
  ago,
  heroGold,
  inputCls,
  stamp,
  th,
  thead,
  tr,
  type IconCmp,
} from "../kit";

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

const STATUS_FILTERS: ReadonlyArray<{ key: string; label: string; dot?: string; match: (s: TransferStatus) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "requested", label: "Awaiting approval", dot: "bg-amber-400", match: (s) => s === "REQUESTED" },
  { key: "approved", label: "Approved", dot: "bg-sky-500", match: (s) => s === "APPROVED" },
  { key: "transit", label: "In transit", dot: "bg-gold", match: (s) => s === "DISPATCHED" || s === "PARTIAL" },
  { key: "complete", label: "Complete", dot: "bg-emerald-500", match: (s) => s === "COMPLETE" },
  { key: "cancelled", label: "Cancelled", dot: "bg-ink/30", match: (s) => s === "CANCELLED" },
];

// The live stages, in order.
const PIPELINE: { key: string; label: string; hint: string; icon: IconCmp }[] = [
  { key: "requested", label: "Requested", hint: "Needs a decision", icon: InboxIcon },
  { key: "approved", label: "Approved", hint: "Ready to dispatch", icon: ClipboardCheckIcon },
  { key: "transit", label: "In transit", hint: "Scan in on arrival", icon: TruckIcon },
  { key: "complete", label: "Complete", hint: "Received in full", icon: CheckCircleIcon },
];

type Direction = "all" | "outgoing" | "incoming";

export default function TransfersPage() {
  const router = useRouter();
  const [statusKey, setStatusKey] = useState("all");
  const [direction, setDirection] = useState<Direction>("all");
  const [q, setQ] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const canCreate = hasPermission(me.data?.permissions ?? [], "products:edit");
  const myBranches = useMemo(() => new Set(me.data?.branchIds ?? []), [me.data]);

  const list = useQuery({
    queryKey: ["transfers"],
    queryFn: () => api<TransferListRow[]>("/api/v1/transfers"),
  });

  const all = list.data ?? [];
  const needle = q.trim().toLowerCase();
  const byDirection = all.filter(
    (r) =>
      (direction === "outgoing" ? myBranches.has(r.from_branch_id) : direction === "incoming" ? myBranches.has(r.to_branch_id) : true) &&
      (!needle ||
        [r.number, r.from_branch_name, r.to_branch_name, r.reason ?? "", r.requested_by_name ?? ""].some((x) => x.toLowerCase().includes(needle)))
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

  const live = (r: TransferListRow) => r.status === "DISPATCHED" || r.status === "PARTIAL";
  const awaiting = countAll("requested");
  const inTransitPieces = all.reduce((n, r) => n + (live(r) ? r.in_transit : 0), 0);
  const incomingOpen = all.filter((r) => live(r) && myBranches.has(r.to_branch_id)).length;
  const outgoingOpen = all.filter((r) => r.status !== "COMPLETE" && r.status !== "CANCELLED" && myBranches.has(r.from_branch_id)).length;
  const linesTotal = all.reduce((n, r) => n + (r.status === "CANCELLED" ? 0 : r.lines), 0);
  const linesReceived = all.reduce((n, r) => n + (r.status === "CANCELLED" ? 0 : r.received), 0);
  const completeRate = all.length ? (countAll("complete") / all.filter((r) => r.status !== "CANCELLED").length || 0) * 100 : 0;
  const filtered = statusKey !== "all" || direction !== "all" || !!needle;
  const loading = list.isLoading;

  return (
    <Page className="space-y-4">
      <GoldHero
        icon={ArrowLeftRightIcon}
        title="Branch transfers,"
        accent="scan to scan"
        back={{ href: "/inventory", label: "Inventory" }}
        badge={list.data ? awaiting ? <HeroBadge tone="warn">{awaiting} to approve</HeroBadge> : <HeroBadge tone="good">Nothing to approve</HeroBadge> : null}
        sub="Request, approve, dispatch and receive pieces between branches by scan. Only transfers touching your branches are shown."
        actions={
          canCreate ? (
            <Link href="/inventory/transfers/new" className={heroGold}>
              <PlusIcon size={13} /> New transfer
            </Link>
          ) : null
        }
        stats={[
          { label: "Transfers", value: list.data ? all.length : null, sub: "Touching your branches", loading },
          { label: "Awaiting approval", value: list.data ? awaiting : null, tone: awaiting ? "warn" : undefined, sub: awaiting ? "Needs a decision" : "Nothing pending", loading },
          { label: "Pieces in transit", value: list.data ? inTransitPieces : null, accent: true, sub: "Dispatched, not received", loading },
          { label: "Incoming", value: list.data ? incomingOpen : null, sub: incomingOpen ? "Scan them in on arrival" : "Nothing inbound", loading },
          { label: "Outgoing open", value: list.data ? outgoingOpen : null, sub: "Leaving your branches", loading },
          { label: "Lines received", value: list.data ? linesReceived : null, sub: `of ${linesTotal.toLocaleString("en-US")} sent`, loading },
          { label: "Completion", value: list.data ? completeRate : null, format: (n) => `${Math.round(n)}%`, tone: "good", sub: `${countAll("cancelled")} cancelled`, loading },
        ]}
      >
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all duration-200",
                    on ? "bg-gold/[0.14] ring-gold/50" : "bg-paper/[0.04] ring-paper/10 hover:bg-paper/[0.07] hover:ring-gold/30"
                  )}
                >
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", on ? "bg-gradient-to-b from-gold-light to-gold text-void" : "bg-paper/[0.07] text-gold-light")}>
                    <p.icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-paper/45">
                      {String(i + 1).padStart(2, "0")} · {p.label}
                    </span>
                    <span className="flex items-baseline gap-1.5">
                      <span className={cn("g-metric text-[16px] leading-tight", on ? "text-gold-light" : "text-paper")}>{loading ? "—" : n}</span>
                      <span className="truncate text-[10px] text-paper/35">{p.hint}</span>
                    </span>
                  </span>
                </button>
                {i < PIPELINE.length - 1 ? (
                  <span aria-hidden className="pointer-events-none absolute -right-[9px] top-1/2 z-10 hidden size-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-void text-gold/70 ring-1 ring-gold/25 sm:flex">
                    <ArrowRightIcon size={8} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </GoldHero>

      <Card>
        <CardHead
          icon={ArrowLeftRightIcon}
          title="Transfers"
          sub={list.data ? `${rows.length} shown of ${all.length}` : "Loading"}
          action={
            <>
              <label className="relative">
                <SearchIcon size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-5" />
                <span className="sr-only">Search transfers</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, branch, reason…" className={cn(inputCls, "w-52 pl-7")} />
              </label>
              <FilterPills<Direction>
                value={direction}
                onChange={setDirection}
                items={[
                  { key: "all", label: "Both" },
                  { key: "outgoing", label: "Outgoing" },
                  { key: "incoming", label: "Incoming" },
                ]}
              />
            </>
          }
        />
        <div className="-mx-px overflow-x-auto border-b border-ink/[0.06] px-4 py-2 scrollbar-thin">
          <FilterPills
            value={statusKey}
            onChange={setStatusKey}
            items={STATUS_FILTERS.map((f) => ({ key: f.key, label: f.label, dot: f.dot, count: list.data ? countFor(f.key) : undefined }))}
          />
        </div>

        {loading ? (
          <RowsSkeleton rows={6} />
        ) : list.isError ? (
          <Empty
            icon={AlertCircleIcon}
            title="Couldn't load transfers"
            desc={list.error instanceof Error ? list.error.message : "Check the API connection and retry."}
            action={
              <button type="button" onClick={() => void list.refetch()} className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]">
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <Empty
            icon={TruckIcon}
            title={all.length === 0 ? "No transfers yet" : "No transfers match"}
            desc={all.length === 0 ? "Request a transfer to move pieces to another branch." : "Try a different status, direction or search."}
            action={
              all.length === 0 ? (
                canCreate ? (
                  <Link href="/inventory/transfers/new" className="g-btn g-btn-primary h-8 rounded-lg px-3 text-[12px]">
                    <PlusIcon size={12} /> New transfer
                  </Link>
                ) : null
              ) : filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setStatusKey("all");
                    setDirection("all");
                    setQ("");
                  }}
                  className="g-btn g-btn-secondary h-8 rounded-lg px-3 text-[12px]"
                >
                  Clear filters
                </button>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead className={thead}>
                <tr>
                  <th className={cn(th, "pl-4")}>Transfer</th>
                  <th className={th}>Route</th>
                  <th className={th}>Status</th>
                  <th className={th}>Received</th>
                  <th className={cn(th, "text-right")}>In transit</th>
                  <th className={cn(th, "hidden lg:table-cell")}>Requested by</th>
                  <th className={cn(th, "text-right")}>Created</th>
                  <th className={cn(th, "w-10 pr-4")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const cancelled = r.status === "CANCELLED";
                  const share = r.lines > 0 ? Math.min(r.received / r.lines, 1) : 0;
                  const out = myBranches.has(r.from_branch_id);
                  const inc = myBranches.has(r.to_branch_id);
                  const href = `/inventory/transfers/${r.id}`;
                  return (
                    <tr key={r.id} className={cn(tr, "group cursor-pointer", cancelled && "opacity-60")} onClick={() => router.push(href)}>
                      <td className="py-1.5 pl-4 pr-2">
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className={cn("g-metric font-semibold text-ink group-hover:text-gold-deep", cancelled && "line-through")}
                        >
                          {r.number}
                        </Link>
                        {r.reason ? <span className="block max-w-[14rem] truncate text-[10.5px] text-ink-5">{r.reason}</span> : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px]">
                          <span className={cn("rounded-md px-1.5 py-px font-medium ring-1 ring-inset", out ? "bg-void text-paper ring-gold/25" : "bg-bone text-ink ring-ink/[0.06]")}>{r.from_branch_name}</span>
                          <ArrowRightIcon size={10} className="text-gold-dark" />
                          <span className={cn("rounded-md px-1.5 py-px font-medium ring-1 ring-inset", inc ? "bg-void text-paper ring-gold/25" : "bg-bone text-ink ring-ink/[0.06]")}>{r.to_branch_name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <TransferChip status={r.status} />
                      </td>
                      <td className="min-w-[8rem] px-2 py-1.5">
                        <span className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="g-metric text-ink">
                            {r.received}
                            <span className="text-ink-5">/{r.lines}</span>
                          </span>
                          <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
                        </span>
                        <Progress value={share} tone={share >= 1 ? "good" : cancelled ? "muted" : "gold"} className="mt-1 h-1" />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {r.in_transit > 0 ? (
                          <span className="g-metric inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-px text-[11px] font-semibold text-gold-deep ring-1 ring-inset ring-gold/35">
                            <TruckIcon size={10} />
                            {r.in_transit}
                          </span>
                        ) : (
                          <span className="g-metric text-ink-5">0</span>
                        )}
                      </td>
                      <td className="hidden px-2 py-1.5 lg:table-cell">
                        {r.requested_by_name ? (
                          <span className="flex items-center gap-1.5">
                            <Avatar name={r.requested_by_name} />
                            <span className="max-w-[9rem] truncate text-[11.5px] text-ink-3">{r.requested_by_name}</span>
                          </span>
                        ) : (
                          <span className="text-ink-5">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] text-ink-4" title={stamp(r.created_at)}>
                        {ago(r.created_at)}
                      </td>
                      <td className="py-1.5 pl-2 pr-4 text-right">
                        <ArrowRightIcon size={12} className="ml-auto text-ink-5 transition-all group-hover:translate-x-0.5 group-hover:text-gold-dark" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/[0.06] bg-bone/40 px-4 py-1.5 text-[10.5px] text-ink-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-void ring-1 ring-gold/25" />
              Your branch
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-5 rounded-full bg-gradient-to-r from-gold-dark to-gold-light" />
              Lines received
            </span>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}
