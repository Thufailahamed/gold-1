"use client";

import { useQuery } from "@tanstack/react-query";
import { mgToG } from "@goldos/shared";
import { api } from "@/lib/api";
import type { Branch } from "@/lib/accounts";

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
