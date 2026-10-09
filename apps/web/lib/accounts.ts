"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasPermission } from "@goldos/shared";
import { api, type MeData } from "@/lib/api";

/** Exact LKR with cents — the books must match to the cent. */
export const lkr = (c: number) =>
  (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const lkrSigned = (c: number) => `${c < 0 ? "−" : ""}${lkr(Math.abs(c))}`;

/**
 * "1,250.50" → 125050. Rounds through a string so 0.1 + 0.2 style float
 * error never becomes a missing cent. Returns NaN for anything unparseable.
 */
export function toCents(input: string): number {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return Number.NaN;
  const [whole = "0", frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function readBranchCookie(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith("goldos_branch="))?.split("=")[1] ?? "";
}

/** What a journal entry was, in words a shop owner uses. */
export const REF_LABELS: Record<string, string> = {
  sale_invoice: "Sale",
  sale_return: "Refund / return",
  sale_payment: "Sale payment",
  purchase_invoice: "Purchase",
  purchase_payment: "Supplier payment",
  expense: "Expense",
  cash_deposit: "Deposit to bank",
  cash_withdrawal: "Withdrawal from bank",
  cash_transfer_out: "Sent to branch",
  cash_transfer_in: "Received from branch",
  card_settlement: "Card settlement",
  old_gold_purchase: "Old gold bought",
  repair: "Repair collection",
  custom_advance: "Customer advance",
  custom_advance_refund: "Advance refunded",
  custom_advance_apply: "Advance applied to sale",
  adjustment: "Manual adjustment",
  stock_count: "Stock count adjustment",
  gold_adjustment: "Gold adjustment",
  melt_batch: "Melting",
  mfg_order: "Manufacturing",
  product_intake: "Stock intake",
  transfer_line: "Stock transfer",
  opening_balance: "Opening balance",
  customer_receipt: "Customer paid dues",
  owner_capital: "Owner put money in",
  owner_drawing: "Owner took money out",
  other_income: "Other income",
  cash_correction: "Cash correction",
  tax_payment: "Tax paid",
  opening_stock: "Opening stock",
};

export const refLabel = (ref: string | null) => (ref ? REF_LABELS[ref] ?? ref.replace(/_/g, " ") : "Journal entry");

export type Branch = { id: string; name: string; code?: string };
export type BankAccount = {
  id: string;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  account_code: string;
  branch_id: string | null;
  opening_balance_cents: number;
  opened_on: string | null;
  is_active: number;
  balance_cents: number;
};

/**
 * Who is looking and which branches they may pick. Defaults to the branch in
 * the top-bar cookie, then the first visible branch; "all branches" is only
 * offered to shop-wide roles.
 */
export function useAccountsScope() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeData>("/api/v1/auth/me") });
  const perms = me.data?.permissions ?? [];
  const canManage = hasPermission(perms, "accounts:manage");
  const canShop = hasPermission(perms, "branches:manage");
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => api<{ rows: Branch[] }>("/api/v1/branches?limit=100"),
  });
  const visibleBranches = useMemo(
    () => (branches.data?.rows ?? []).filter((b) => canShop || (me.data?.branchIds ?? []).includes(b.id)),
    [branches.data, canShop, me.data]
  );
  const [branchId, setBranchId] = useState("");
  useEffect(() => {
    if (branchId || visibleBranches.length === 0) return;
    const saved = readBranchCookie();
    setBranchId(visibleBranches.find((b) => b.id === saved)?.id ?? visibleBranches[0]?.id ?? "");
  }, [branchId, visibleBranches]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && visibleBranches.some((b) => b.id === detail)) {
        setBranchId(detail);
      } else {
        const saved = readBranchCookie();
        if (saved && visibleBranches.some((b) => b.id === saved)) setBranchId(saved);
      }
    };
    window.addEventListener("goldos-branch-changed", handler);
    return () => window.removeEventListener("goldos-branch-changed", handler);
  }, [visibleBranches]);

  const ready = !!me.data && (branchId !== "" || canShop);
  const branchName = (id: string | null) => visibleBranches.find((b) => b.id === id)?.name ?? branches.data?.rows.find((b) => b.id === id)?.name ?? "—";
  return { me, perms, canManage, canShop, visibleBranches, branchId, setBranchId, ready, branchName };
}
