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
