"use client";

import type { ReactNode } from "react";
import { centsToLkr, mgToG } from "@goldos/shared";
import { cn } from "@/lib/cn";
import { StatusPill, type DataColumn } from "@/components/ui";
import {
  ArrowLeftRightIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  CircleSlashIcon,
  PackagePlusIcon,
  TruckIcon,
} from "@/components/icons";

export type StockRow = {
  key: string;
  pieces: number;
  net_mg: number;
  fine_mg: number;
  /** Missing on older API responses; treat absent the same as unpriced. */
  value_cents?: number | null;
  /** Product name, branch name or karat, by grouping. */
  name?: string | null;
  barcode?: string | null;
};

export type Movement = {
  id: string;
  product_id: string;
  barcode: string | null;
  type: string;
  from_status: string | null;
  to_status: string;
  from_branch: string | null;
  to_branch: string | null;
  weight_mg: number;
  reason: string | null;
  created_at: number;
};

export type Insights = {
  totals: { pieces: number; net_mg: number; fine_mg: number; value_cents: number };
  byKarat: Array<{
    purity_id: string;
    karat: string;
    permille: number;
    pieces: number;
    net_mg: number;
    fine_mg: number;
    value_cents: number;
  }>;
  byBranch: Array<{
    branch_id: string;
    name: string;
    pieces: number;
    net_mg: number;
    fine_mg: number;
    value_cents: number;
  }>;
  attention: {
    transfer_pending: number;
    in_repair: number;
    reserved: number;
    last_movement_at: number | null;
    movements_24h: number;
  };
};

export type Piece = {
  product: {
    id: string;
    barcode: string;
    name: string;
    status: string;
    branch_id: string;
    net_mg: number;
    fine_gold_mg: number;
    cost_cents: number;
    karat: string;
    permille: number;
  };
};

export const MOVEMENT_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "INTAKE", label: "Intake" },
  { key: "TRANSFER_OUT", label: "Transfer out" },
  { key: "TRANSFER_IN", label: "Transfer in" },
  { key: "RETURN", label: "Return" },
  { key: "RESTOCK", label: "Restock" },
  { key: "SALE_OUT", label: "Sale" },
  { key: "RESERVE", label: "Reserve" },
  { key: "RELEASE", label: "Release" },
  { key: "LOSS", label: "Loss" },
  { key: "VOID", label: "Void" },
];

const TYPE_TONE: Record<string, string> = {
  INTAKE: "bg-emerald-700/10 text-emerald-700",
  TRANSFER_OUT: "bg-gold/15 text-gold-dark",
  TRANSFER_IN: "bg-gold/15 text-gold-dark",
  RETURN: "bg-sky-700/10 text-sky-700",
  LOSS: "bg-rose-700/10 text-rose-700",
  VOID: "bg-ink/[0.08] text-ink-3",
  SALE_OUT: "bg-indigo-700/10 text-indigo-700",
  RESTOCK: "bg-emerald-700/10 text-emerald-700",
  RESERVE: "bg-amber-700/10 text-amber-700",
  RELEASE: "bg-emerald-700/10 text-emerald-700",
};

const TYPE_ICON: Record<string, ReactNode> = {
  INTAKE: <PackagePlusIcon size={13} />,
  TRANSFER_OUT: <TruckIcon size={13} />,
  TRANSFER_IN: <TruckIcon size={13} />,
  RETURN: <ArrowUturnLeftIcon size={13} />,
  LOSS: <CircleSlashIcon size={13} />,
  VOID: <ArrowLeftRightIcon size={13} />,
  SALE_OUT: <CheckCircleIcon size={13} />,
  RESTOCK: <PackagePlusIcon size={13} />,
  RESERVE: <ArrowLeftRightIcon size={13} />,
  RELEASE: <ArrowUturnLeftIcon size={13} />,
};

/** "TRANSFER_OUT" -> "Transfer out". */
export function humanize(code: string): string {
  const s = code.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function movementTypeMeta(type: string): { label: string; icon: ReactNode } {
  return {
    label: humanize(type),
    icon: TYPE_ICON[type] ?? <ArrowLeftRightIcon size={13} />,
  };
}

export function MovementTypeIcon({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        TYPE_TONE[type] ?? "bg-ink/[0.06] text-ink-3"
      )}
    >
      {TYPE_ICON[type] ?? <ArrowLeftRightIcon size={13} />}
    </span>
  );
}

const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });

const rupees = (cents: number) =>
  `LKR ${centsToLkr(cents).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** 1px track with a gold fill, used inline in table cells. */
export function fineShareBar(ratio: number) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <span className="hidden h-1 w-14 overflow-hidden rounded-full bg-ink/10 sm:block" title={`${Math.round(pct)}% fine`}>
      <span
        className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-light"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function stockColumns(
  groupBy: "branch" | "purity" | "product",
  labelFor?: (row: StockRow) => ReactNode
): ReadonlyArray<DataColumn<StockRow>> {
  const firstLabel = groupBy === "branch" ? "Branch" : groupBy === "purity" ? "Purity" : "Product";

  return [
    {
      key: "key",
      label: firstLabel,
      sortable: true,
      value: (r) => r.name ?? r.key,
      render: (r) => (labelFor ? labelFor(r) : <span className="font-mono text-xs text-ink">{r.key}</span>),
    },
    {
      key: "pieces",
      label: "Pieces",
      align: "right",
      sortable: true,
      value: (r) => r.pieces,
      render: (r) => <span className="g-metric">{r.pieces.toLocaleString("en-US")}</span>,
    },
    {
      key: "net_mg",
      label: "Net g",
      align: "right",
      sortable: true,
      value: (r) => r.net_mg,
      render: (r) => <span className="g-metric">{grams(r.net_mg)}</span>,
    },
    {
      key: "fine_mg",
      label: "Fine g",
      align: "right",
      sortable: true,
      value: (r) => r.fine_mg,
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          {fineShareBar(r.net_mg > 0 ? r.fine_mg / r.net_mg : 0)}
          <span className="g-metric">{grams(r.fine_mg)}</span>
        </span>
      ),
    },
    {
      key: "value_cents",
      label: "Value",
      align: "right",
      sortable: true,
      value: (r) => r.value_cents ?? -1,
      render: (r) =>
        r.value_cents == null || r.value_cents === 0 ? (
          <span className="text-ink-5" title="No board rate for this purity">—</span>
        ) : (
          <span className="g-metric">{rupees(r.value_cents)}</span>
        ),
    },
  ];
}

export function movementColumns(
  branchName: (id: string | null) => string
): ReadonlyArray<DataColumn<Movement>> {
  return [
    {
      key: "type",
      label: "Type",
      width: "12rem",
      sortable: true,
      value: (m) => m.type,
      render: (m) => (
        <span className="flex items-center gap-2.5">
          <MovementTypeIcon type={m.type} />
          <span className="text-xs font-medium text-ink">{movementTypeMeta(m.type).label}</span>
        </span>
      ),
    },
    {
      key: "barcode",
      label: "Barcode",
      sortable: true,
      value: (m) => m.barcode ?? m.product_id,
      render: (m) => (
        <span className="rounded-md bg-bone px-1.5 py-0.5 font-mono text-[11px] text-ink-2 ring-1 ring-ink/[0.06]">
          {m.barcode ?? m.product_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "transition",
      label: "From → To",
      render: (m) => (
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <span className="whitespace-nowrap">{m.from_status ? humanize(m.from_status) : "New"}</span>
          <span className="text-ink-5" aria-hidden>→</span>
          <StatusPill status={m.to_status} label={humanize(m.to_status)} />
        </span>
      ),
    },
    {
      key: "branch",
      label: "Branch",
      render: (m) => (
        <span className="text-xs text-ink-4">{branchName(m.to_branch ?? m.from_branch)}</span>
      ),
    },
    {
      key: "weight_mg",
      label: "Weight g",
      align: "right",
      sortable: true,
      value: (m) => m.weight_mg,
      render: (m) => <span className="g-metric">{grams(m.weight_mg)}</span>,
    },
    {
      key: "reason",
      label: "Reason",
      render: (m) =>
        m.reason ? (
          <span className="line-clamp-1 max-w-[16rem] text-xs text-ink-3" title={m.reason}>
            {m.reason}
          </span>
        ) : (
          <span className="text-ink-5">—</span>
        ),
    },
    {
      key: "created_at",
      label: "Time",
      align: "right",
      sortable: true,
      value: (m) => m.created_at,
      render: (m) => {
        const d = new Date(m.created_at);
        return (
          <span className="whitespace-nowrap text-right" title={d.toLocaleString()}>
            <span className="block text-xs text-ink-2">
              {d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <span className="block text-[11px] text-ink-4">
              {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
        );
      },
    },
  ];
}
