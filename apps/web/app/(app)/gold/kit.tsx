"use client";

// The gold vault's vocabulary (batch statuses, ledger directions) on top of
// the shared console kit.
import { cn } from "@/lib/cn";

export * from "@/components/console-kit";

/* ------------------------------------------------------------ vocabulary */

export const BATCH_STATUSES = ["DRAFT", "LOCKED", "MELTED", "APPROVED", "VOID"] as const;
export const BATCH_META: Record<string, { label: string; hint: string; dot: string; chip: string }> = {
  DRAFT: { label: "Draft", hint: "Collecting old gold", dot: "bg-gold-light", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" },
  LOCKED: { label: "Locked", hint: "Ready for the furnace", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  MELTED: { label: "Melted", hint: "Awaiting assay approval", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  APPROVED: { label: "Approved", hint: "Output in the vault", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  VOID: { label: "Void", hint: "Cancelled", dot: "bg-rose-500", chip: "bg-rose-600/10 text-rose-700 ring-rose-600/20" },
};

export function StatusChip({ status, className }: { status: string; className?: string }) {
  const m = BATCH_META[status] ?? { label: status, dot: "bg-ink/30", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Movements that cross the vault boundary; everything else is an internal hand-off. */
const IN_TYPES = new Set(["PURCHASE", "OLD_GOLD_PURCHASE", "RETURN", "RECOVERY"]);
const OUT_TYPES = new Set(["SALE", "LOSS"]);
export const LEDGER_TYPES = ["PURCHASE", "OLD_GOLD_PURCHASE", "SALE", "MELTING_INPUT", "MELTING_OUTPUT", "MANUFACTURING_INPUT", "MANUFACTURING_OUTPUT", "TRANSFER", "RETURN", "ADJUSTMENT", "LOSS", "RECOVERY"];
export const direction = (type: string): "in" | "out" | "move" => (IN_TYPES.has(type) ? "in" : OUT_TYPES.has(type) ? "out" : "move");

export function DirectionGlyph({ type }: { type: string }) {
  const dir = direction(type);
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ring-1 ring-inset",
        dir === "in" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
        dir === "out" && "bg-rose-50 text-rose-700 ring-rose-200",
        dir === "move" && "bg-bone text-ink-4 ring-ink/20"
      )}
      aria-label={dir === "in" ? "In" : dir === "out" ? "Out" : "Internal"}
    >
      {dir === "in" ? "↓" : dir === "out" ? "↑" : "⇄"}
    </span>
  );
}

