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
      else if (l.refEntity === "sale_payment" || l.refEntity === "customer_receipt") t.creditPayments += cr - dr;
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

/** Sri Lankan notes and coins in circulation, largest first, in rupees. */
export const LKR_DENOMINATIONS = [5000, 2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

/**
 * A cash count sheet's total in cents. Unknown face values are refused, not
 * ignored: a typo on the sheet must not silently drop money from the count.
 */
export function denominationTotalCents(counts: Record<string, number>): number {
  let total = 0;
  for (const [face, pieces] of Object.entries(counts)) {
    const value = Number(face);
    if (!(LKR_DENOMINATIONS as readonly number[]).includes(value))
      throw Object.assign(new Error(`Unknown denomination: ${face}`), { code: "VALIDATION" });
    if (!Number.isInteger(pieces) || pieces < 0)
      throw Object.assign(new Error(`Invalid count for ${face}`), { code: "VALIDATION" });
    total += value * 100 * pieces;
  }
  return total;
}

/**
 * Which recorded amounts could explain a cash difference by themselves: any
 * single movement whose size equals the difference (a double-keyed or
 * missing entry), and any pair that sums to it. Amounts are cents; returns
 * indexes into `amounts`. Capped so a busy day stays readable.
 */
export function explainingAmounts(differenceCents: number, amounts: number[], maxPairs = 10): { singles: number[]; pairs: [number, number][] } {
  const target = Math.abs(differenceCents);
  if (target === 0) return { singles: [], pairs: [] };
  const singles: number[] = [];
  amounts.forEach((a, i) => {
    if (Math.abs(a) === target) singles.push(i);
  });
  const pairs: [number, number][] = [];
  const seen = new Map<number, number[]>();
  for (let j = 0; j < amounts.length && pairs.length < maxPairs; j++) {
    const need = target - Math.abs(amounts[j]!);
    for (const i of seen.get(need) ?? []) {
      pairs.push([i, j]);
      if (pairs.length >= maxPairs) break;
    }
    const list = seen.get(Math.abs(amounts[j]!)) ?? [];
    list.push(j);
    seen.set(Math.abs(amounts[j]!), list);
  }
  return { singles, pairs };
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
  "custom_advance",
  // A cancelled custom order hands the cash advance back out of the drawer.
  // Missing from this list, every such refund blocked that day's close.
  "custom_advance_refund",
  "opening_balance",
  "customer_receipt",
  "owner_capital",
  "owner_drawing",
  "other_income",
  "cash_correction",
  // VAT paid to the revenue authority from the drawer.
  "tax_payment",
] as const;

/**
 * Cash the shop takes in or pays out that is not a sale, purchase or expense.
 * Each kind posts against exactly one counter account, so the drawer always
 * has a named reason for moving — the day-close unclassified guard never has
 * to see a manual journal for an owner topping up the till.
 *
 * `direction` is from the drawer's point of view: "in" debits cash/bank.
 */
export const CASH_ENTRY_KINDS = {
  OWNER_CAPITAL: { direction: "in", counterAccount: "3000", refEntity: "owner_capital", label: "Owner put money in" },
  OWNER_DRAWING: { direction: "out", counterAccount: "3200", refEntity: "owner_drawing", label: "Owner took money out" },
  OTHER_INCOME: { direction: "in", counterAccount: "4900", refEntity: "other_income", label: "Other income" },
  CASH_OVER: { direction: "in", counterAccount: "6090", refEntity: "cash_correction", label: "Cash over (found extra)" },
  CASH_SHORT: { direction: "out", counterAccount: "6090", refEntity: "cash_correction", label: "Cash short (missing)" },
} as const;

export type CashEntryKind = keyof typeof CASH_ENTRY_KINDS;

export function cashEntryLines(
  kind: CashEntryKind,
  moneyAccount: string,
  amountCents: number
): { account: string; debitCents: number; creditCents: number }[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw Object.assign(new Error("Amount must be a positive whole amount"), { code: "VALIDATION" });
  const k = CASH_ENTRY_KINDS[kind];
  if (!k) throw Object.assign(new Error(`Unknown cash entry kind: ${kind}`), { code: "VALIDATION" });
  return k.direction === "in"
    ? [
        { account: moneyAccount, debitCents: amountCents, creditCents: 0 },
        { account: k.counterAccount, debitCents: 0, creditCents: amountCents },
      ]
    : [
        { account: k.counterAccount, debitCents: amountCents, creditCents: 0 },
        { account: moneyAccount, debitCents: 0, creditCents: amountCents },
      ];
}

export type OpenInvoice = { invoiceId: string; date: string; outstandingCents: number };

/**
 * Applies a customer receipt to their open invoices, oldest first — the order
 * a shop owner expects ("clear the old bill before the new one") and the one
 * that shrinks the 90+ aging bucket fastest.
 *
 * Money beyond the listed invoices is refused rather than left floating: an
 * unallocated overpayment is exactly the unexplained customer credit that
 * blocks day-close, so the cap lives here, before anything is posted.
 */
export function allocateReceipt(
  amountCents: number,
  invoices: OpenInvoice[],
  capCents: number
): { invoiceId: string; amountCents: number }[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw Object.assign(new Error("Receipt amount must be a positive whole amount"), { code: "VALIDATION" });
  if (amountCents > capCents)
    throw Object.assign(
      new Error(
        capCents <= 0
          ? "This customer owes nothing at this branch"
          : `Receipt exceeds what the customer owes at this branch (${(capCents / 100).toFixed(2)})`
      ),
      { code: "VALIDATION" }
    );
  const sorted = [...invoices]
    .filter((i) => i.outstandingCents > 0)
    .sort((a, b) => (a.date === b.date ? a.invoiceId.localeCompare(b.invoiceId) : a.date < b.date ? -1 : 1));
  const out: { invoiceId: string; amountCents: number }[] = [];
  let left = amountCents;
  for (const inv of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, inv.outstandingCents);
    out.push({ invoiceId: inv.invoiceId, amountCents: take });
    left -= take;
  }
  // Anything left is owed on the ledger without an invoice behind it (an
  // opening balance). It is still a valid receipt; it just has no invoice.
  return out;
}

export type LedgerAccountTotal = { code: string; name: string; type: string; debitCents: number; creditCents: number };

export type StatementLine = { code: string; name: string; cents: number };

/**
 * Profit & loss straight from account totals. Revenue is credit-positive,
 * expenses debit-positive. Cost of sales (5xxx) sits above the gross line;
 * everything else in EXPENSE is operating.
 */
export function buildProfitAndLoss(rows: LedgerAccountTotal[]): {
  revenue: StatementLine[];
  costOfSales: StatementLine[];
  operating: StatementLine[];
  totalRevenueCents: number;
  totalCostOfSalesCents: number;
  grossProfitCents: number;
  totalOperatingCents: number;
  netProfitCents: number;
} {
  const revenue: StatementLine[] = [];
  const costOfSales: StatementLine[] = [];
  const operating: StatementLine[] = [];
  for (const r of rows) {
    if (r.type === "REVENUE") {
      const cents = r.creditCents - r.debitCents;
      if (cents !== 0) revenue.push({ code: r.code, name: r.name, cents });
    } else if (r.type === "EXPENSE") {
      const cents = r.debitCents - r.creditCents;
      if (cents === 0) continue;
      (r.code.startsWith("5") ? costOfSales : operating).push({ code: r.code, name: r.name, cents });
    }
  }
  const sum = (xs: StatementLine[]) => xs.reduce((s, x) => s + x.cents, 0);
  const totalRevenueCents = sum(revenue);
  const totalCostOfSalesCents = sum(costOfSales);
  const totalOperatingCents = sum(operating);
  const grossProfitCents = totalRevenueCents - totalCostOfSalesCents;
  return {
    revenue,
    costOfSales,
    operating,
    totalRevenueCents,
    totalCostOfSalesCents,
    grossProfitCents,
    totalOperatingCents,
    netProfitCents: grossProfitCents - totalOperatingCents,
  };
}

/**
 * Balance sheet as of a date. Profit not yet closed into equity is shown as
 * its own equity line ("Profit to date"), which is what makes the two sides
 * agree without a year-end closing entry. `balanced` is the proof: if it is
 * false, some posting is one-sided and the books need attention.
 *
 * With `priorYearsProfitCents` (profit of every entry dated before the
 * current financial year) the single line splits into Retained earnings and
 * Current year profit. The split is derived, never posted, so the total is
 * identical either way and no P&L reader has to skip a closing entry.
 */
export function buildBalanceSheet(
  rows: LedgerAccountTotal[],
  opts?: { priorYearsProfitCents?: number }
): {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  profitToDateCents: number;
  retainedEarningsCents: number;
  currentYearProfitCents: number;
  balanced: boolean;
} {
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let profitToDateCents = 0;
  for (const r of rows) {
    const dr = r.debitCents - r.creditCents;
    if (r.type === "ASSET") {
      if (dr !== 0) assets.push({ code: r.code, name: r.name, cents: dr });
    } else if (r.type === "LIABILITY") {
      if (dr !== 0) liabilities.push({ code: r.code, name: r.name, cents: -dr });
    } else if (r.type === "EQUITY") {
      if (dr !== 0) equity.push({ code: r.code, name: r.name, cents: -dr });
    } else if (r.type === "REVENUE" || r.type === "EXPENSE") {
      profitToDateCents -= dr;
    }
  }
  const split = opts?.priorYearsProfitCents !== undefined;
  const retainedEarningsCents = split ? opts!.priorYearsProfitCents! : 0;
  const currentYearProfitCents = profitToDateCents - retainedEarningsCents;
  if (split) {
    if (retainedEarningsCents !== 0)
      equity.push({ code: "RE", name: "Retained earnings", cents: retainedEarningsCents });
    if (currentYearProfitCents !== 0)
      equity.push({ code: "P&L", name: "Current year profit", cents: currentYearProfitCents });
  } else if (profitToDateCents !== 0) {
    equity.push({ code: "P&L", name: "Profit to date", cents: profitToDateCents });
  }
  const sum = (xs: StatementLine[]) => xs.reduce((s, x) => s + x.cents, 0);
  const totalAssetsCents = sum(assets);
  const totalLiabilitiesCents = sum(liabilities);
  const totalEquityCents = sum(equity);
  return {
    assets,
    liabilities,
    equity,
    totalAssetsCents,
    totalLiabilitiesCents,
    totalEquityCents,
    profitToDateCents,
    retainedEarningsCents,
    currentYearProfitCents,
    balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents,
  };
}

/**
 * Output tax on a net (after-discount) amount, in basis points (1800 = 18%).
 * Rounded per line, half away from zero, so a return refunds exactly the tax
 * its line carried and the invoice total is the sum of its lines.
 */
export function salesTaxCents(netCents: number, rateBp: number): number {
  if (!(rateBp > 0) || netCents === 0) return 0;
  const raw = (Math.abs(netCents) * rateBp) / 10000;
  return Math.sign(netCents) * Math.round(raw);
}

/**
 * The financial year a business date falls in. `startMonth` is 1-12; with 4
 * (April) the year 2026-04-01..2027-03-31 is labelled "2026/27". A January
 * start is a calendar year, labelled "2026".
 */
export function fiscalYearFor(date: string, startMonth: number): { start: string; end: string; label: string } {
  const m = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 1;
  const y = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= m ? y : y - 1;
  const start = `${startYear}-${String(m).padStart(2, "0")}-01`;
  const end = addDays(`${startYear + 1}-${String(m).padStart(2, "0")}-01`, -1);
  const label = m === 1 ? String(startYear) : `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { start, end, label };
}

/**
 * The guard that makes the breakdown believable: a movement the screen cannot
 * name is reported as unclassified rather than quietly folded into a total. A
 * new cash flow added later will show up here and block the close, instead of
 * the screen reporting a wrong number the shop then reconciles against.
 *
 * Two figures: gross `unclassified` (every unnamed cent, for display) and
 * `unclassifiedNet` (per-ref net outflow minus inflow, for gating). Netting
 * is per ref_entity, never across refs. A manual error and its reversal net
 * to zero and must not block the close forever — the economics are null and
 * both lines stay visible — while any real unnamed movement still blocks.
 */
export function cashBreakdownTotal(lines: CashLine[]): {
  totalIn: number;
  totalOut: number;
  unclassified: number;
  unclassifiedNet: number;
} {
  const known = new Set<string>(KNOWN_CASH_REFS);
  let totalIn = 0;
  let totalOut = 0;
  let unclassified = 0;
  const netByRef = new Map<string, number>();
  for (const l of lines) {
    if (!known.has(l.refEntity)) {
      unclassified += l.cents;
      netByRef.set(l.refEntity, (netByRef.get(l.refEntity) ?? 0) + (l.direction === "out" ? l.cents : -l.cents));
      continue;
    }
    if (l.direction === "in") totalIn += l.cents;
    else totalOut += l.cents;
  }
  let unclassifiedNet = 0;
  for (const net of netByRef.values()) unclassifiedNet += Math.abs(net);
  return { totalIn, totalOut, unclassified, unclassifiedNet };
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

export function monthlyPnl(input: { revenueCents: number; cogsCents: number; opexCents: number; meltLossCents: number; mfgLossCents: number; adjNetCents: number; otherIncomeCents?: number }): { grossProfitCents: number; netProfitCents: number } {
  const grossProfitCents = input.revenueCents - input.cogsCents;
  const netProfitCents = grossProfitCents + (input.otherIncomeCents ?? 0) - input.opexCents - input.meltLossCents - input.mfgLossCents - input.adjNetCents;
  return { grossProfitCents, netProfitCents };
}

export function cashflowClose(openingCents: number, inflowsCents: number, outflowsCents: number): { closingCents: number } {
  return { closingCents: openingCents + inflowsCents - outflowsCents };
}

export function goldClose(openingMg: number, inMg: number, outMg: number): { closingMg: number } {
  return { closingMg: openingMg + inMg - outMg };
}

export function agingBuckets(asOf: string, docs: { id: string; date: string; outstandingCents: number }[]): { "0-30": number; "31-60": number; "61-90": number; "90+": number } {
  if (!isBusinessDate(asOf)) throw Object.assign(new Error("Invalid as-of date"), { code: "VALIDATION" });
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const end = Date.parse(`${asOf}T00:00:00Z`);
  for (const d of docs) {
    if (d.outstandingCents <= 0) continue;
    const age = isBusinessDate(d.date) ? Math.max(0, Math.floor((end - Date.parse(`${d.date}T00:00:00Z`)) / 86_400_000)) : 0;
    if (age <= 30) buckets["0-30"] += d.outstandingCents;
    else if (age <= 60) buckets["31-60"] += d.outstandingCents;
    else if (age <= 90) buckets["61-90"] += d.outstandingCents;
    else buckets["90+"] += d.outstandingCents;
  }
  return buckets;
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
