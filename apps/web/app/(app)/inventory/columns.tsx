"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
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

/** A category and how many of its pieces are on hand. */
export type CategoryCount = { id: string; name: string; pieces: number };

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
