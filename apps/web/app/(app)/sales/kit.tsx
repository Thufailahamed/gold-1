"use client";

// Sales vocabulary (invoice settlement, returns) on top of the shared console
// kit. Repairs and the POS share it too.
import { cn } from "@/lib/cn";

export * from "@/components/console-kit";

export const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");
export const lkr2 = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

type Meta = { label: string; hint: string; dot: string; chip: string };

/** Invoice settlement states, in the order a counter cares about them. */
export const INVOICE_STATUSES = ["PAID", "PARTIAL", "UNPAID", "VOID"] as const;
export const INVOICE_META: Record<string, Meta> = {
  PAID: { label: "Paid", hint: "Settled in full", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  PARTIAL: { label: "Part-paid", hint: "Balance on credit", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  UNPAID: { label: "Unpaid", hint: "Nothing received yet", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  VOID: { label: "Void", hint: "Cancelled", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/20" },
};

/** Returns are refunds or exchanges; status follows the approval flow. */
export const RETURN_META: Record<string, Meta> = {
  FULL: { label: "Full", hint: "Whole sale returned", dot: "bg-gold-dark", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  PARTIAL: { label: "Partial", hint: "Some pieces back", dot: "bg-ink/40", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" },
  REFUND: { label: "Refund", hint: "Money back", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  EXCHANGE: { label: "Exchange", hint: "Swapped for another piece", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  COMPLETED: { label: "Completed", hint: "", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  COMPLETE: { label: "Complete", hint: "", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  PENDING: { label: "Pending", hint: "", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  APPROVED: { label: "Approved", hint: "", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  REJECTED: { label: "Rejected", hint: "", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25" },
  VOID: { label: "Void", hint: "", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/20" },
};

function Chip({ meta, status, className }: { meta: Record<string, Meta>; status: string; className?: string }) {
  const m = meta[status] ?? {
    label: status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    dot: "bg-ink/30",
    chip: "bg-ink/[0.05] text-ink-3 ring-ink/20",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export const InvChip = (p: { status: string; className?: string }) => <Chip meta={INVOICE_META} {...p} />;
export const ReturnChip = (p: { status: string; className?: string }) => <Chip meta={RETURN_META} {...p} />;

/** Paid-of-total bar with the balance due, for invoice rows. */
export function Settlement({ total, balance, isVoid }: { total: number; balance: number; isVoid?: boolean }) {
  if (isVoid) return <span className="text-ink-5">—</span>;
  const due = Math.max(0, balance);
  const share = total > 0 ? Math.min(1, Math.max(0, (total - due) / total)) : 1;
  return (
    <span className="block min-w-[7.5rem]">
      <span className="flex items-baseline justify-between gap-2 text-[10.5px]">
        {due > 0 ? (
          <span className="font-medium text-amber-800">
            Due <span className="g-metric">{lkr(due)}</span>
          </span>
        ) : (
          <span className="font-medium text-emerald-700">Settled</span>
        )}
        <span className="g-metric text-ink-5">{Math.round(share * 100)}%</span>
      </span>
      <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-ink/[0.07]">
        <span
          className={cn("block h-full rounded-full", due > 0 ? "bg-gradient-to-r from-gold-dark to-gold-light" : "bg-gradient-to-r from-emerald-600 to-emerald-400")}
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}
