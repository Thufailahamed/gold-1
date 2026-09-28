export const APPROVAL_ACTIONS = [
  "SALES_DISCOUNT",
  "PRICE_OVERRIDE",
  "GOLD_RATE_CHANGE",
  "GOLD_STOCK_ADJUST",
  "INVENTORY_ADJUST",
  "OLDGOLD_VALUATION",
  "MELT_DIFFERENCE",
  "MFG_DIFFERENCE",
  "SALES_CANCEL",
  "PURCHASE_CANCEL",
  "SALES_RETURN",
  "FIN_ADJUST",
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export const DEFAULT_PERM: Record<ApprovalAction, string> = {
  SALES_DISCOUNT: "sales:approve",
  PRICE_OVERRIDE: "sales:approve",
  GOLD_RATE_CHANGE: "gold:manage",
  GOLD_STOCK_ADJUST: "gold:manage",
  INVENTORY_ADJUST: "products:cancel",
  OLDGOLD_VALUATION: "oldgold:approve",
  MELT_DIFFERENCE: "gold:manage",
  MFG_DIFFERENCE: "mfg:approve",
  SALES_CANCEL: "sales:cancel",
  PURCHASE_CANCEL: "purchases:cancel",
  SALES_RETURN: "sales:approve",
  FIN_ADJUST: "accounts:manage",
};

export function thresholdBreached(value: number, threshold: number | null): boolean {
  if (threshold === null || threshold < 0) return false;
  return value > threshold;
}

export function approvalExpiresAt(nowMs: number, ttlHours: number): number {
  return nowMs + Math.max(1, Math.floor(ttlHours)) * 3_600_000;
}

export function isExpiredAsOf(row: { status: string; expires_at: number }, nowMs: number): boolean {
  return row.status === "PENDING" && nowMs > row.expires_at;
}
