"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";
import {
  Page,
  Hero,
  TableCard,
  TableSkeleton,
  EmptyBlock,
  Callout,
  StatusPill,
  Pill,
  FilterChips,
  heroBtnPrimary,
} from "@/components/ui";
import { ArrowLeftRightIcon, ArrowRightIcon, PlusIcon, TruckIcon } from "@/components/icons";

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

const STATUS_FILTERS: ReadonlyArray<{ key: string; label: string; match: (s: TransferStatus) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "requested", label: "Awaiting approval", match: (s) => s === "REQUESTED" },
  { key: "approved", label: "Approved", match: (s) => s === "APPROVED" },
  { key: "transit", label: "In transit", match: (s) => s === "DISPATCHED" || s === "PARTIAL" },
  { key: "complete", label: "Complete", match: (s) => s === "COMPLETE" },
  { key: "cancelled", label: "Cancelled", match: (s) => s === "CANCELLED" },
];

type Direction = "all" | "outgoing" | "incoming";

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

  const awaiting = all.filter((r) => r.status === "REQUESTED").length;
  const inTransitPieces = all.reduce(
    (n, r) => n + (r.status === "DISPATCHED" || r.status === "PARTIAL" ? r.in_transit : 0),
    0
  );
  const incomingOpen = all.filter(
    (r) => (r.status === "DISPATCHED" || r.status === "PARTIAL") && myBranches.has(r.to_branch_id)
  ).length;

  return (
    <Page>
      <Hero
        back={{ href: "/inventory", label: "Inventory" }}
        kicker="Inventory"
        title="Branch transfers"
        description="Move pieces between branches: request, approve, dispatch, and receive by scan."
        stats={[
          { label: "Transfers", value: all.length },
          { label: "Awaiting approval", value: awaiting },
          { label: "Pieces in transit", value: inTransitPieces },
          { label: "Incoming to receive", value: incomingOpen },
        ]}
        actions={
          canCreate ? (
            <Link href="/inventory/transfers/new" className={heroBtnPrimary}>
              <PlusIcon size={15} /> New transfer
            </Link>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          ariaLabel="Filter by status"
          value={statusKey}
          onChange={setStatusKey}
          options={STATUS_FILTERS.map((f) => ({
            key: f.key,
            label: f.label,
            count: list.data ? byDirection.filter((r) => f.match(r.status)).length : undefined,
          }))}
        />
        <FilterChips
          ariaLabel="Filter by direction"
          value={direction}
          onChange={(k) => setDirection(k as Direction)}
          options={[
            { key: "all", label: "Both directions" },
            { key: "outgoing", label: "Outgoing" },
            { key: "incoming", label: "Incoming" },
          ]}
        />
      </div>

      <TableCard
        title="Transfers"
        icon={<ArrowLeftRightIcon size={17} />}
        description="Only transfers touching your branches are shown."
        actions={
          <span className="g-metric text-[11px] font-medium uppercase tracking-[0.14em] text-ink-4">
            {String(rows.length).padStart(2, "0")} shown
          </span>
        }
      >
        {list.isLoading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : list.isError ? (
          <div className="p-5">
            <Callout tone="danger" title="Could not load transfers">
              {list.error instanceof Error ? list.error.message : "Check the API connection and retry."}
            </Callout>
          </div>
        ) : rows.length === 0 ? (
          <EmptyBlock
            icon={<TruckIcon size={22} />}
            title={all.length === 0 ? "No transfers yet" : "No transfers match"}
            description={
              all.length === 0
                ? "Request a transfer to move pieces to another branch."
                : "Try a different status or direction filter."
            }
            action={
              canCreate && all.length === 0 ? (
                <Link href="/inventory/transfers/new" className="g-btn g-btn-primary h-10 px-4 text-sm">
                  <PlusIcon size={15} /> New transfer
                </Link>
              ) : null
            }
          />
        ) : (
          <table className="g-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Route</th>
                <th>Status</th>
                <th className="!text-right">Received / lines</th>
                <th className="!text-right">In transit</th>
                <th>Requested by</th>
                <th>Date</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/inventory/transfers/${r.id}`}
                      className="g-metric font-medium text-ink hover:text-gold-700"
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-medium text-ink">{r.from_branch_name}</span>
                      <ArrowRightIcon size={12} className="text-ink-4" aria-label="to" />
                      <span className="font-medium text-ink">{r.to_branch_name}</span>
                    </span>
                  </td>
                  <td>
                    <StatusPill status={r.status} label={STATUS_LABEL[r.status] ?? r.status} />
                  </td>
                  <td className="!text-right num-tabular">
                    {r.received}/{r.lines}
                  </td>
                  <td className="!text-right">
                    {r.in_transit > 0 ? (
                      <Pill tone="info">{r.in_transit}</Pill>
                    ) : (
                      <span className="num-tabular text-ink-4">0</span>
                    )}
                  </td>
                  <td className="text-ink-3">{r.requested_by_name ?? "-"}</td>
                  <td className="whitespace-nowrap text-ink-3">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="!text-right">
                    <Link
                      href={`/inventory/transfers/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gold-dark hover:text-ink"
                      aria-label={`Open transfer ${r.number}`}
                    >
                      Open <ArrowRightIcon size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Page>
  );
}
