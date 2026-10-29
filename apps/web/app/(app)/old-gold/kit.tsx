"use client";

// Old-gold vocabulary (the life of a bought-in item) on top of the shared
// console kit.
import { cn } from "@/lib/cn";
import { ArchiveIcon, BanknoteIcon, CheckCircleIcon, FlaskConicalIcon, GemIcon, InboxIcon, ScaleIcon } from "@/components/icons";
import type { IconCmp } from "@/components/console-kit";

export * from "@/components/console-kit";

export const lkr = (c: number) => Math.round(c / 100).toLocaleString("en-US");

/** Permille as shown on a test: "916‰"; anything non-numeric passes through. */
export const permille = (k: string | null | undefined) => (k ? (/^\d+$/.test(k) ? `${k}‰` : k) : "Untested");

type Stage = { status: string; label: string; hint: string; dot: string; chip: string; icon: IconCmp };

/**
 * The life of a bought-in item, in order. Stages read light to dark along one
 * gold ramp; "In stock" is the one state change worth its own hue.
 */
export const STAGES: readonly Stage[] = [
  { status: "RECEIVED", label: "Received", hint: "Awaiting test", dot: "bg-gold-soft", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25", icon: InboxIcon },
  { status: "TESTED", label: "Tested", hint: "Needs valuation", dot: "bg-gold-light", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25", icon: FlaskConicalIcon },
  { status: "VALUED", label: "Valued", hint: "Offer to customer", dot: "bg-gold", chip: "bg-gold/15 text-gold-deep ring-gold/35", icon: GemIcon },
  { status: "PURCHASED", label: "Purchased", hint: "Bought in", dot: "bg-gold-dark", chip: "bg-gold/20 text-gold-deep ring-gold-dark/35", icon: BanknoteIcon },
  { status: "AVAILABLE", label: "In stock", hint: "Ready to melt / resell", dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25", icon: ArchiveIcon },
  { status: "RESERVED_FOR_MELTING", label: "For melting", hint: "Reserved in a batch", dot: "bg-gold-deep", chip: "bg-gold-deep/15 text-gold-deep ring-gold-deep/30", icon: ScaleIcon },
  { status: "MELTED", label: "Melted", hint: "Recovered as fine", dot: "bg-ink-3", chip: "bg-ink/[0.07] text-ink-2 ring-ink/15", icon: CheckCircleIcon },
];

const OTHER: Record<string, Omit<Stage, "icon" | "status">> = {
  RESOLD: { label: "Resold", hint: "", dot: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25" },
  DRAWN: { label: "Made into products", hint: "", dot: "bg-indigo-500", chip: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/25" },
  TRANSFERRED: { label: "Transferred", hint: "", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25" },
  VOID: { label: "Void", hint: "", dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25" },
};

export const stageOf = (s: string) => STAGES.find((x) => x.status === s) ?? OTHER[s];
export const statusText = (s: string) => stageOf(s)?.label ?? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function OgChip({ status, className }: { status: string; className?: string }) {
  const m = stageOf(status) ?? { dot: "bg-ink/30", chip: "bg-ink/[0.05] text-ink-3 ring-ink/10" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip, className)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {statusText(status)}
    </span>
  );
}

export function KaratTag({ k }: { k: string | null | undefined }) {
  return k ? (
    <span className="g-metric rounded bg-gradient-to-b from-gold-light to-gold px-1.5 py-px text-[10px] font-bold text-void">{k}</span>
  ) : (
    <span className="text-ink-5">—</span>
  );
}
