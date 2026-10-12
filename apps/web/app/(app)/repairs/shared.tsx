"use client";

import { useQuery } from "@tanstack/react-query";
import { mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import type { Branch } from "@/lib/accounts";
import { cn } from "@/lib/cn";
import { CheckCircleIcon, ClipboardCheckIcon, HammerIcon, InboxIcon, PackageIcon, XIcon } from "@/components/icons";
import type { IconCmp } from "@/components/console-kit";

export type RepairStatus = "RECEIVED" | "IN_PROGRESS" | "QC" | "READY" | "COLLECTED" | "CANCELLED";

export const STATUS_LABEL: Record<RepairStatus, string> = {
  RECEIVED: "Received",
  IN_PROGRESS: "In progress",
  QC: "Awaiting QC",
  READY: "Ready to collect",
  COLLECTED: "Collected",
  CANCELLED: "Cancelled",
};

export const statusLabel = (s: string) => STATUS_LABEL[s as RepairStatus] ?? s;

export const META: Record<RepairStatus, { dot: string; chip: string; hint: string; icon: IconCmp }> = {
  RECEIVED: { dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/25", hint: "Awaiting technician", icon: InboxIcon },
  IN_PROGRESS: { dot: "bg-violet-500", chip: "bg-violet-500/10 text-violet-800 ring-violet-500/25", hint: "On the bench", icon: HammerIcon },
  QC: { dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25", hint: "Awaiting sign-off", icon: ClipboardCheckIcon },
  READY: { dot: "bg-emerald-500", chip: "bg-emerald-600/10 text-emerald-800 ring-emerald-600/25", hint: "To collect & pay", icon: CheckCircleIcon },
  COLLECTED: { dot: "bg-ink/30", chip: "bg-ink/[0.04] text-ink-4 ring-ink/10", hint: "Handed back", icon: PackageIcon },
  CANCELLED: { dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/25", hint: "Withdrawn", icon: XIcon },
};

export function RepairChip({ status }: { status: string }) {
  const m = META[status as RepairStatus] ?? META.COLLECTED;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold ring-1 ring-inset", m.chip)}>
      <span className={cn("size-1.5 rounded-full", m.dot)} />
      {statusLabel(status)}
    </span>
  );
}


export type Customer = { id: string; code: string; name: string; phone: string | null };

export const grams = (mg: number) => mgToG(mg).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
export const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function branchDefault(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

/** Shares the ["branches"] cache with the rest of the app. */
export function useBranches() {
  return useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"),
  });
}

/**
 * Repair rows carry only customer_id; resolve the name per id. React Query
 * dedupes by key, so a page of jobs for one customer costs a single request.
 */
export function useCustomer(id: string | null | undefined) {
  return useQuery({
    queryKey: ["repair-customer", id],
    queryFn: () => api<Customer>(`/api/v1/customers/${id}`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

export function CustomerName({ id }: { id: string }) {
  const c = useCustomer(id);
  if (c.isLoading) return <span className="text-ink-4">…</span>;
  if (!c.data) return <span className="text-ink-4">-</span>;
  return <>{c.data.name}</>;
}
