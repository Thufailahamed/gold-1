import { describe, expect, it } from "vitest";
import {
  allocateReceipt,
  buildBalanceSheet,
  buildProfitAndLoss,
  cashBreakdownTotal,
  cashEntryLines,
  checkBalanced,
  computePartyLedger,
  monthlyPnl,
  type LedgerAccountTotal,
} from "./index";
import { cashEntrySchema, customerReceiptSchema } from "./schemas";

describe("allocateReceipt", () => {
  const open = [
    { invoiceId: "b", date: "2026-09-10", outstandingCents: 30000 },
    { invoiceId: "a", date: "2026-08-01", outstandingCents: 20000 },
    { invoiceId: "c", date: "2026-09-20", outstandingCents: 50000 },
  ];

  it("clears the oldest invoice first", () => {
    expect(allocateReceipt(35000, open, 100000)).toEqual([
      { invoiceId: "a", amountCents: 20000 },
      { invoiceId: "b", amountCents: 15000 },
    ]);
  });

  it("pays everything off exactly", () => {
    const out = allocateReceipt(100000, open, 100000);
    expect(out.reduce((s, a) => s + a.amountCents, 0)).toBe(100000);
    expect(out.map((a) => a.invoiceId)).toEqual(["a", "b", "c"]);
  });

  it("refuses more than the customer owes, so no unexplained credit is created", () => {
    expect(() => allocateReceipt(100001, open, 100000)).toThrow(/exceeds/);
  });

  it("refuses a receipt from a customer who owes nothing here", () => {
    expect(() => allocateReceipt(100, [], 0)).toThrow(/owes nothing/);
  });

  it("accepts a receipt against an opening balance with no invoice behind it", () => {
    expect(allocateReceipt(5000, [], 8000)).toEqual([]);
  });

  it("refuses zero and fractional cents", () => {
    expect(() => allocateReceipt(0, open, 100000)).toThrow();
    expect(() => allocateReceipt(10.5, open, 100000)).toThrow();
  });
});

describe("cashEntryLines", () => {
  it("owner capital debits the drawer and credits equity", () => {
    expect(cashEntryLines("OWNER_CAPITAL", "1000", 50000)).toEqual([
      { account: "1000", debitCents: 50000, creditCents: 0 },
      { account: "3000", debitCents: 0, creditCents: 50000 },
    ]);
  });

  it("drawings credit the money account and debit drawings", () => {
    expect(cashEntryLines("OWNER_DRAWING", "1010", 2500)).toEqual([
      { account: "3200", debitCents: 2500, creditCents: 0 },
      { account: "1010", debitCents: 0, creditCents: 2500 },
    ]);
  });

  it("every kind produces a balanced entry", () => {
    for (const kind of ["OWNER_CAPITAL", "OWNER_DRAWING", "OTHER_INCOME", "CASH_OVER", "CASH_SHORT"] as const) {
      expect(() => checkBalanced(cashEntryLines(kind, "1000", 777))).not.toThrow();
    }
  });

  it("cash short and over hit the same correction account in opposite directions", () => {
    const short = cashEntryLines("CASH_SHORT", "1000", 100);
    const over = cashEntryLines("CASH_OVER", "1000", 100);
    expect(short.find((l) => l.account === "6090")?.debitCents).toBe(100);
    expect(over.find((l) => l.account === "6090")?.creditCents).toBe(100);
  });
});

describe("new cash refs are named on the day-close breakdown", () => {
  it("does not treat receipts or owner movements as unclassified", () => {
    const t = cashBreakdownTotal([
      { refEntity: "customer_receipt", label: "", direction: "in", cents: 1000 },
      { refEntity: "owner_capital", label: "", direction: "in", cents: 500 },
      { refEntity: "owner_drawing", label: "", direction: "out", cents: 200 },
      { refEntity: "other_income", label: "", direction: "in", cents: 50 },
      { refEntity: "cash_correction", label: "", direction: "out", cents: 10 },
    ]);
    expect(t.unclassified).toBe(0);
    expect(t.totalIn).toBe(1550);
    expect(t.totalOut).toBe(210);
  });

  it("a cancelled custom order's cash advance refund no longer blocks the close", () => {
    const t = cashBreakdownTotal([{ refEntity: "custom_advance_refund", label: "", direction: "out", cents: 5000 }]);
    expect(t.unclassifiedNet).toBe(0);
    expect(t.totalOut).toBe(5000);
  });
});

describe("customer ledger counts receipts as payments", () => {
  it("reduces the closing balance", () => {
    const base = { entryId: "e", entryNo: "JE", entryDate: "2026-09-01", refId: "r", refNo: null, memo: null };
    const t = computePartyLedger("customer", [
      { ...base, refEntity: "sale_invoice", debitCents: 10000, creditCents: 0 },
      { ...base, refEntity: "customer_receipt", debitCents: 0, creditCents: 4000 },
    ]);
    expect(t.creditPayments).toBe(4000);
    expect(t.closing).toBe(6000);
  });
});

describe("monthlyPnl other income", () => {
  it("adds other income below gross profit", () => {
    const r = monthlyPnl({ revenueCents: 1000, cogsCents: 600, opexCents: 100, meltLossCents: 0, mfgLossCents: 0, adjNetCents: 0, otherIncomeCents: 50 });
    expect(r.grossProfitCents).toBe(400);
    expect(r.netProfitCents).toBe(350);
  });

  it("is unchanged when other income is omitted", () => {
    expect(monthlyPnl({ revenueCents: 1000, cogsCents: 600, opexCents: 100, meltLossCents: 0, mfgLossCents: 0, adjNetCents: 0 }).netProfitCents).toBe(300);
  });
});

const rows: LedgerAccountTotal[] = [
  { code: "1000", name: "Cash", type: "ASSET", debitCents: 90000, creditCents: 20000 },
  { code: "1100", name: "Gold", type: "ASSET", debitCents: 50000, creditCents: 30000 },
  { code: "2000", name: "Payables", type: "LIABILITY", debitCents: 0, creditCents: 35000 },
  { code: "3000", name: "Equity", type: "EQUITY", debitCents: 0, creditCents: 40000 },
  { code: "3200", name: "Drawings", type: "EQUITY", debitCents: 5000, creditCents: 0 },
  { code: "4000", name: "Sales", type: "REVENUE", debitCents: 0, creditCents: 60000 },
  { code: "4900", name: "Other", type: "REVENUE", debitCents: 0, creditCents: 2000 },
  { code: "5000", name: "COGS", type: "EXPENSE", debitCents: 30000, creditCents: 0 },
  { code: "6010", name: "Utilities", type: "EXPENSE", debitCents: 12000, creditCents: 0 },
];

describe("buildProfitAndLoss", () => {
  it("splits cost of sales from operating costs", () => {
    const p = buildProfitAndLoss(rows);
    expect(p.totalRevenueCents).toBe(62000);
    expect(p.totalCostOfSalesCents).toBe(30000);
    expect(p.grossProfitCents).toBe(32000);
    expect(p.totalOperatingCents).toBe(12000);
    expect(p.netProfitCents).toBe(20000);
  });
});

describe("buildBalanceSheet", () => {
  it("balances once profit to date is carried into equity", () => {
    const b = buildBalanceSheet(rows);
    expect(b.totalAssetsCents).toBe(90000);
    expect(b.totalLiabilitiesCents).toBe(35000);
    expect(b.profitToDateCents).toBe(20000);
    // Equity 40000 - drawings 5000 + profit 20000
    expect(b.totalEquityCents).toBe(55000);
    expect(b.balanced).toBe(true);
  });

  it("flags a one-sided posting", () => {
    const b = buildBalanceSheet([...rows, { code: "1010", name: "Bank", type: "ASSET", debitCents: 1, creditCents: 0 }]);
    expect(b.balanced).toBe(false);
  });
});

describe("schemas", () => {
  it("requires a note on cash entries so every movement has a reason", () => {
    expect(cashEntrySchema.safeParse({ branchId: "b", kind: "OWNER_CAPITAL", amountCents: 100, method: "cash" }).success).toBe(false);
  });

  it("rejects negative receipts", () => {
    expect(customerReceiptSchema.safeParse({ customerId: "c", branchId: "b", amountCents: -1, method: "cash" }).success).toBe(false);
  });
});
