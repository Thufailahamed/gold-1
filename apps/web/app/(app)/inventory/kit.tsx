"use client";

// Inventory's vocabulary (counts, transfers, movements) on top of the shared
// console kit.
import { cn } from "@/lib/cn";

export * from "@/components/console-kit";

export const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

type Meta = { label: string; dot: string; chip: string };

function Chip({ m, className }: { m: Meta; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

const muted: Meta = { label: "", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/10" };

/** Transfers: requested, approved, dispatched, then received in part or full. */
export const TRANSFER_META: Record<string, Meta> = {
  REQUESTED: { label: "Awaiting approval", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  APPROVED: { label: "Approved", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  DISPATCHED: { label: "In transit", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  PARTIAL: { label: "Part received", dot: "bg-gold-dark", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  COMPLETE: { label: "Complete", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  CANCELLED: { ...muted, label: "Cancelled" },
};
export const TransferChip = ({ status, className }: { status: string; className?: string }) => (
  <Chip m={TRANSFER_META[status] ?? { ...muted, label: status }} className={className} />
);

/** Stock counts: open while scanning, then complete or cancelled. */
export const COUNT_META: Record<string, Meta> = {
  OPEN: { label: "Open", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  COMPLETE: { label: "Complete", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  CANCELLED: { ...muted, label: "Cancelled" },
};
export const CountChip = ({ status, className }: { status: string; className?: string }) => (
  <Chip m={COUNT_META[status] ?? { ...muted, label: status }} className={className} />
);

/** Piece statuses as they appear in movements and scans. */
export const PIECE_META: Record<string, Meta> = {
  IN_STOCK: { label: "In stock", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  SOLD: { label: "Sold", dot: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25" },
  RESERVED: { label: "Reserved", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  RETURNED: { label: "Returned", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  TRANSFER_PENDING: { label: "In transit", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  IN_REPAIR: { label: "In repair", dot: "bg-gold-dark", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  LOST: { label: "Lost", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25" },
  VOID: { ...muted, label: "Void" },
};
export const PieceChip = ({ status, className }: { status: string; className?: string }) => (
  <Chip
    m={PIECE_META[status] ?? { ...muted, label: status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }}
    className={className}
  />
);

/** Progress track used by counts and transfers. */
export function Progress({ value, tone = "gold", className }: { value: number; tone?: "gold" | "good" | "muted"; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-ink/[0.07]", className)}>
      <span
        className={cn(
          "block h-full rounded-full transition-[width] duration-700 ease-brand",
          tone === "good" ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : tone === "muted" ? "bg-ink/25" : "bg-gradient-to-r from-gold-dark to-gold-light"
        )}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-soft to-gold-pale text-[8.5px] font-semibold text-gold-deep ring-1 ring-gold-dark/15">
      {initials(name)}
    </span>
  );
}
