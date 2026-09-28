export type PartyLedgerKind = "customer" | "supplier";

export type PartyLedgerLine = {
  entryId: string;
  entryNo: string;
  entryDate: string;
  refEntity: string;
  refId: string;
  refNo: string | null;
  memo: string | null;
  debitCents: number;
  creditCents: number;
};

export type PartyLedgerTotals = {
  opening: number;
  debitSales: number;
  creditPayments: number;
  creditReturns: number;
  creditPurchases: number;
  debitPayments: number;
  debitReturns: number;
  closing: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function businessDate(epochMs: number, tzOffsetMinutes: number): string {
  return new Date(epochMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Splits `total` across `weights`. The output always sums to `total`.
 *
 * A zero weight is legal and yields a zero share — a fully-consumed melt lot
 * is `allocateProportional(cost, [fineMg, 0])`. A *negative* weight is not:
 * it would produce a negative share, i.e. money appearing from nowhere.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error("weights must sum to more than zero");
  if (weights.some((w) => w < 0)) throw new Error("weights must not be negative");
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  shares[0] = (shares[0] ?? 0) + total - shares.reduce((s, x) => s + x, 0);
  return shares;
}

export function checkBalanced(lines: { debitCents: number; creditCents: number }[]): void {
  const dr = lines.reduce((s, l) => s + l.debitCents, 0);
  const cr = lines.reduce((s, l) => s + l.creditCents, 0);
  if (lines.length < 2 || dr !== cr || dr <= 0)
    throw Object.assign(new Error("Journal must balance with positive total"), {
      code: "VALIDATION",
    });
  for (const l of lines) {
    if (l.debitCents < 0 || l.creditCents < 0 || (l.debitCents > 0 && l.creditCents > 0))
      throw Object.assign(new Error("Line must be debit XOR credit"), { code: "VALIDATION" });
  }
}

const OPENING = "opening_balance";

/**
 * Customer: a debit to 1200 means the customer owes us more, so the ledger
 * runs debit-positive. Supplier: a credit to 2000 means we owe them more, so
 * the ledger runs credit-positive. Every bucket is normalised to "increases
 * the balance we owe" so `closing` is a single sum.
 */
export function computePartyLedger(
  kind: PartyLedgerKind,
  lines: PartyLedgerLine[]
): PartyLedgerTotals {
  const t: PartyLedgerTotals = {
    opening: 0,
    debitSales: 0,
    creditPayments: 0,
    creditReturns: 0,
    creditPurchases: 0,
    debitPayments: 0,
    debitReturns: 0,
    closing: 0,
  };
  for (const l of lines) {
    const dr = l.debitCents;
    const cr = l.creditCents;
    if (kind === "customer") {
      if (l.refEntity === OPENING) t.opening += dr - cr;
      else if (l.refEntity === "sale_payment") t.creditPayments += cr - dr;
      else if (l.refEntity === "sale_return") t.creditReturns += cr - dr;
      else t.debitSales += dr - cr;
    } else {
      if (l.refEntity === OPENING) t.opening += cr - dr;
      else if (l.refEntity === "purchase_payment") t.debitPayments += dr - cr;
      else t.creditPurchases += cr - dr;
    }
  }
  t.closing =
    t.opening + t.debitSales + t.creditPurchases - t.creditPayments - t.debitPayments - t.creditReturns;
  return t;
}

export function closingCash(openingCents: number, cashInCents: number, cashOutCents: number): number {
  return openingCents + cashInCents - cashOutCents;
}

export function cashDifference(expectedCents: number, actualCents: number): number {
  return actualCents - expectedCents;
}

export function meltingLossValue(
  inputCostCents: number,
  outputFineMg: number,
  lossMg: number
): number {
  const denom = outputFineMg + lossMg;
  if (denom <= 0) return 0;
  return Math.round((inputCostCents * lossMg) / denom);
}

/**
 * Deliberately NOT allocateProportional: the output must sum to *less* than
 * `vIn` when fine gold was lost in the process, and that shortfall is the
 * manufacturing loss value. Normalising here would silently discard it.
 */
export function allocateGoldValue(vIn: number, fineIn: number, outputsFineMg: number[]): number[] {
  if (fineIn <= 0) return outputsFineMg.map(() => 0);
  return outputsFineMg.map((f) => Math.round((vIn * f) / fineIn));
}

export function goldValueCents(fineMg: number, rateCentsPerG: number): number {
  return Math.round((fineMg * rateCentsPerG) / 1000);
}

/**
 * A card settlement splits the gross the shop took into the net the acquirer
 * actually pays and the fee they withhold. The fee is booked to 6060, not
 * absorbed — losing it is how a shop quietly under-makes on card turnover.
 */
export function settlementAmounts(
  grossCents: number,
  feeCents: number
): { grossCents: number; feeCents: number; netCents: number } {
  if (!Number.isInteger(grossCents) || grossCents <= 0)
    throw Object.assign(new Error("Settlement gross must be a positive whole amount"), {
      code: "VALIDATION",
    });
  if (!Number.isInteger(feeCents) || feeCents < 0)
    throw Object.assign(new Error("Settlement fee must be a whole amount of zero or more"), {
      code: "VALIDATION",
    });
  if (feeCents > grossCents)
    throw Object.assign(new Error("Settlement fee cannot exceed the gross"), {
      code: "VALIDATION",
    });
  return { grossCents, feeCents, netCents: grossCents - feeCents };
}

/**
 * Money that left the sending branch but has not yet arrived. Floored at zero
 * so an over-receipt in the books reads as nothing in transit rather than as
 * negative money, which would hide the error.
 */
export function inTransitTotal(dispatchedCents: number, receivedCents: number): number {
  return Math.max(dispatchedCents - receivedCents, 0);
}

export type ExpenseThresholds = { approvalCents: number; receiptCents: number };

export function expenseThresholds(
  approvalCents: number,
  receiptCents: number
): ExpenseThresholds {
  return {
    approvalCents: Math.max(0, approvalCents),
    receiptCents: Math.max(0, receiptCents),
  };
}

/**
 * Both gates are strictly-greater-than, so an expense sitting exactly at a
 * threshold is not gated. A threshold is a "watch anything above this" line,
 * not "this exact amount needs a second pair of eyes" — the shop sets it to
 * the largest routine spend and means it.
 */
export function expensePosting(
  amountCents: number,
  thresholds: ExpenseThresholds
): { requiresReceipt: boolean; requiresApproval: boolean } {
  return {
    requiresReceipt: amountCents > thresholds.receiptCents,
    requiresApproval: amountCents > thresholds.approvalCents,
  };
}

/**
 * What the daily closing must show alongside expected cash. An expense that
 * has left the bank but is not yet approved is on neither side of the ledger,
 * so without this figure the drawer reads short by exactly this much — which
 * looks identical to a counting error.
 *
 * `postedCents` is accepted so the caller can pass the pair it already holds
 * without unpacking it; only the pending figure is the answer.
 */
export function pendingApprovalTotal(postedCents: number, pendingCents: number): number {
  void postedCents;
  return Math.max(pendingCents, 0);
}

export function closingArithmetic(
  openingCents: number,
  cashInCents: number,
  cashOutCents: number
): { expectedCents: number } {
  return { expectedCents: openingCents + cashInCents - cashOutCents };
}

export function closingDifference(
  expectedCents: number,
  actualCents: number,
  reason?: string
): { differenceCents: number; reasonRequired: boolean; valid: boolean } {
  const differenceCents = actualCents - expectedCents;
  const reasonRequired = differenceCents !== 0;
  return { differenceCents, reasonRequired, valid: !reasonRequired || !!reason?.trim() };
}

export type CashLine = {
  refEntity: string;
  label: string;
  direction: "in" | "out";
  cents: number;
};

/** Every cash movement the closing screen knows how to name. */
export const KNOWN_CASH_REFS = [
  "sale_invoice",
  "cash_withdrawal",
  "cash_transfer_in",
  "purchase_payment",
  "expense",
  "cash_deposit",
  "sale_return",
  "cash_transfer_out",
  "old_gold_purchase",
  "repair",
] as const;

/**
 * The guard that makes the breakdown believable: a movement the screen cannot
 * name is reported as unclassified rather than quietly folded into a total. A
 * new cash flow added later will show up here and block the close, instead of
 * the screen reporting a wrong number the shop then reconciles against.
 */
export function cashBreakdownTotal(lines: CashLine[]): {
  totalIn: number;
  totalOut: number;
  unclassified: number;
} {
  const known = new Set<string>(KNOWN_CASH_REFS);
  let totalIn = 0;
  let totalOut = 0;
  let unclassified = 0;
  for (const l of lines) {
    if (!known.has(l.refEntity)) {
      unclassified += l.cents;
      continue;
    }
    if (l.direction === "in") totalIn += l.cents;
    else totalOut += l.cents;
  }
  return { totalIn, totalOut, unclassified };
}

export function monthBounds(year: number, month: number): { from: string; to: string; label: string } {
  if (!Number.isInteger(year) || year < 1970 || year > 2100) throw Object.assign(new Error("Invalid year"), { code: "VALIDATION" });
  if (!Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error("Invalid month"), { code: "VALIDATION" });
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const label = `${year}-${mm}`;
  const from = `${label}-01`;
  const to = `${label}-${String(last).padStart(2, "0")}`;
  if (!isBusinessDate(from) || !isBusinessDate(to)) throw Object.assign(new Error("Invalid month window"), { code: "VALIDATION" });
  return { from, to, label };
}

export function monthlyPnl(input: { revenueCents: number; cogsCents: number; opexCents: number; meltLossCents: number; mfgLossCents: number; adjNetCents: number }): { grossProfitCents: number; netProfitCents: number } {
  const grossProfitCents = input.revenueCents - input.cogsCents;
  const netProfitCents = grossProfitCents - input.opexCents - input.meltLossCents - input.mfgLossCents - input.adjNetCents;
  return { grossProfitCents, netProfitCents };
}

export function cashflowClose(openingCents: number, inflowsCents: number, outflowsCents: number): { closingCents: number } {
  return { closingCents: openingCents + inflowsCents - outflowsCents };
}

export function goldClose(openingMg: number, inMg: number, outMg: number): { closingMg: number } {
  return { closingMg: openingMg + inMg - outMg };
}

export function compareCount(
  expected: { productId: string; barcode: string }[],
  scans: { barcode: string; productId: string | null }[]
): { matched: string[]; missing: string[]; unexpected: string[]; duplicates: string[]; matchedCount: number } {
  const ids = new Set(expected.map((e) => e.productId));
  const byBarcode = new Map(expected.map((e) => [e.barcode.toUpperCase(), e.productId]));
  const seen = new Set<string>();
  const matched: string[] = [];
  const duplicates: string[] = [];
  const unexpected: string[] = [];
  for (const s of scans) {
    const code = s.barcode.toUpperCase();
    const pid = s.productId ?? byBarcode.get(code) ?? null;
    if (!pid || !ids.has(pid)) {
      if (!unexpected.includes(code)) unexpected.push(code);
      continue;
    }
    if (seen.has(pid)) {
      if (!duplicates.includes(pid)) duplicates.push(pid);
      continue;
    }
    seen.add(pid);
    matched.push(pid);
  }
  const missing = expected.map((e) => e.productId).filter((id) => !seen.has(id));
  return { matched, missing, unexpected, duplicates, matchedCount: matched.length };
}
