"use client";

// The workshop's vocabulary (order statuses and types) on top of the shared
// console kit.
import { cn } from "@/lib/cn";

export * from "@/components/console-kit";

/** A workshop order's life, from brief to finished piece. QC_FAILED is a detour back to the bench. */
export const ORDER_FLOW = ["DRAFT", "ALLOCATED", "IN_PRODUCTION", "QC_FAILED", "QC_PASSED", "COMPLETE"] as const;
export const ORDER_STATUSES = [...ORDER_FLOW, "VOID"] as const;
export const OPEN_STATUSES = ["DRAFT", "ALLOCATED", "IN_PRODUCTION", "QC_FAILED", "QC_PASSED"];

export const ORDER_META: Record<string, { label: string; hint: string; dot: string; chip: string }> = {
  DRAFT: { label: "Draft", hint: "Design briefed", dot: "bg-gold-light", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" },
  ALLOCATED: { label: "Allocated", hint: "Gold issued", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35" },
  IN_PRODUCTION: { label: "On the bench", hint: "Being made", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25" },
  QC_FAILED: { label: "QC failed", hint: "Needs rework", dot: "bg-rose-500", chip: "bg-rose-600/10 text-rose-700 ring-rose-600/25" },
  QC_PASSED: { label: "QC passed", hint: "Ready to finish", dot: "bg-gold-deep", chip: "bg-sky-600/10 text-sky-800 ring-sky-600/20" },
  COMPLETE: { label: "Complete", hint: "In stock / delivered", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25" },
  VOID: { label: "Void", hint: "Cancelled", dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-5 ring-ink/20" },
};

export function OrderChip({ status, className }: { status: string; className?: string }) {
  const m = ORDER_META[status] ?? { label: status, dot: "bg-ink/30", chip: "bg-ink/[0.05] text-ink-3 ring-ink/20" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot, status === "QC_FAILED" && "animate-pulse-soft")} />
      {m.label}
    </span>
  );
}

export function TypeChip({ type }: { type: string }) {
  const customer = type === "CUSTOMER";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset",
        customer ? "bg-void text-gold-light ring-void" : "bg-bone text-ink-4 ring-ink/20"
      )}
    >
      {customer ? "Customer" : "Stock"}
    </span>
  );
}

export const lkrFromCents = (c: number) => Math.round(c / 100).toLocaleString("en-US");
