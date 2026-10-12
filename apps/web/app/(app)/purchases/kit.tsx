"use client";

// Purchasing's vocabulary (order and bill statuses) on top of the shared
// console kit.
import { cn } from "@/lib/cn";

export * from "@/components/console-kit";

export const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
export const lkr2 = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Meta = { label: string; hint: string; dot: string; chip: string };

/** A purchase order's life: drafted, sent to the supplier, then received into stock. */
export const ORDER_STATUSES = ["DRAFT", "SENT", "RECEIVED", "CANCELLED"] as const;
export const ORDER_META: Record<string, Meta> = {
  DRAFT: { label: "Draft", hint: "Being prepared", dot: "bg-gold-light", chip: "bg-ink/[0.05] text-ink-3 ring-ink/10" },
  SENT: { label: "Sent", hint: "Waiting on supplier", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  RECEIVED: { label: "Received", hint: "Stock posted", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  CANCELLED: { label: "Cancelled", hint: "Withdrawn", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/10" },
};

/** Supplier bills by settlement, most urgent first. */
export const BILL_STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"] as const;
export const BILL_META: Record<string, Meta> = {
  UNPAID: { label: "Unpaid", hint: "Nothing paid yet", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  PARTIAL: { label: "Part-paid", hint: "Balance still owed", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  PAID: { label: "Paid", hint: "Settled in full", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  VOID: { label: "Void", hint: "Cancelled", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/10" },
};

function Chip({ meta, status, className }: { meta: Record<string, Meta>; status: string; className?: string }) {
  const m = meta[status] ?? { label: status, dot: "bg-ink/30", chip: "bg-ink/[0.05] text-ink-3 ring-ink/10" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export const PoChip = (p: { status: string; className?: string }) => <Chip meta={ORDER_META} {...p} />;
export const BillChip = (p: { status: string; className?: string }) => <Chip meta={BILL_META} {...p} />;
