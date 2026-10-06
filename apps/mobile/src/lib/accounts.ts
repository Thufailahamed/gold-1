import { useEffect, useState } from "react";
import { useBranch, useSession } from "./session";

export { lkr, lkrSigned, toCents, longDate } from "./format";
export { getSavedBranchId as readBranchCookie } from "./session";
export type { Branch } from "./session";

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
 * Who is looking and which branches they may pick (web: useAccountsScope).
 * Defaults to the device's working branch; "all branches" ("") is only
 * offered to shop-wide roles. The selection is local to the screen.
 */
export function useAccountsScope() {
  const s = useSession();
  const b = useBranch();
  const canManage = s.can("accounts:manage");
  const canShop = s.can("branches:manage");
  const [branchId, setBranchId] = useState<string | null>(null);
  useEffect(() => {
    if (branchId !== null || b.branches.length === 0) return;
    setBranchId(b.branch?.id ?? b.branches[0]?.id ?? "");
  }, [branchId, b.branch, b.branches]);
  const me = { data: s.me ?? undefined };
  const current = branchId ?? "";
  const ready = !!s.me && (current !== "" || canShop);
  return {
    me,
    perms: s.perms,
    canManage,
    canShop,
    visibleBranches: b.branches,
    branchId: current,
    setBranchId: (id: string) => setBranchId(id),
    ready,
    branchName: b.branchName,
  };
}
