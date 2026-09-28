import { describe, expect, it } from "vitest";
import {
  addDays,
  allocateGoldValue,
  allocateProportional,
  businessDate,
  cashDifference,
  checkBalanced,
  closingCash,
  computePartyLedger,
  expensePosting,
  expenseThresholds,
  goldValueCents,
  inTransitTotal,
  isBusinessDate,
  meltingLossValue,
  pendingApprovalTotal,
  settlementAmounts,
  type PartyLedgerLine,
} from "./accounting";

function line(p: Partial<PartyLedgerLine>): PartyLedgerLine {
  return {
    entryId: "e1",
    entryNo: "JE-000001",
    entryDate: "2026-09-28",
    refEntity: "sale_invoice",
    refId: "r1",
    refNo: "SINV-0001",
    memo: null,
    debitCents: 0,
    creditCents: 0,
    ...p,
  };
}

describe("businessDate", () => {
  it("shifts UTC into the shop's local day", () => {
    // 2026-09-28T18:00:00Z is 23:30 on 2026-09-28 in Colombo (UTC+5:30)
    expect(businessDate(Date.parse("2026-09-28T18:00:00Z"), 330)).toBe("2026-09-28");
  });

  it("rolls over the local midnight that UTC has not reached", () => {
    // 2026-09-28T20:00:00Z is already 01:30 on 2026-09-29 in Colombo
    expect(businessDate(Date.parse("2026-09-28T20:00:00Z"), 330)).toBe("2026-09-29");
  });

  it("is UTC when the shop runs on UTC", () => {
    expect(businessDate(Date.parse("2026-09-28T20:00:00Z"), 0)).toBe("2026-09-28");
  });

  it("adds days across a month and a year boundary", () => {
    expect(addDays("2026-09-28", 1)).toBe("2026-09-29");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("validates the date format", () => {
    expect(isBusinessDate("2026-09-28")).toBe(true);
    expect(isBusinessDate("2026-9-28")).toBe(false);
    expect(isBusinessDate("")).toBe(false);
  });
});

describe("allocateProportional", () => {
  it("gives the rounding remainder to the first share", () => {
    expect(allocateProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("splits the spec's melt lot example exactly", () => {
    const shares = allocateProportional(39_603_960, [6000, 4000]);
    expect(shares).toEqual([23_762_376, 15_841_584]);
    expect(shares[0]! + shares[1]!).toBe(39_603_960);
  });

  it("handles a single weight", () => {
    expect(allocateProportional(500, [7])).toEqual([500]);
  });

  it("gives a zero weight a zero share, as a fully-consumed lot needs", () => {
    expect(allocateProportional(1000, [1000, 0])).toEqual([1000, 0]);
    expect(allocateProportional(100, [0, 5])).toEqual([0, 100]);
  });

  it("rejects a negative weight, which would mint a negative share", () => {
    expect(() => allocateProportional(100, [-1, 5])).toThrow(/negative/);
  });

  it("rejects weights that sum to zero or less", () => {
    expect(() => allocateProportional(100, [0, 0])).toThrow(/sum/);
    expect(() => allocateProportional(100, [-5, -5])).toThrow(/sum/);
  });
});

describe("allocateGoldValue", () => {
  it("does NOT normalise, so the shortfall is the manufacturing loss", () => {
    // 23,762,376 x 5,950 / 6,000 = 23,564,356.2. The 198,020 shortfall is
    // 50 fine mg of manufacturing loss, and 198,020 / 50 = 3,960.40 cents per
    // fine mg — the same rate the melt loss was valued at, which is the
    // cross-check that the whole cost chain is internally consistent.
    const values = allocateGoldValue(23_762_376, 6000, [5950]);
    expect(values).toEqual([23_564_356]);
    expect(23_762_376 - values.reduce((s, v) => s + v, 0)).toBe(198_020);
  });

  it("sums to vIn when there is no loss", () => {
    expect(allocateGoldValue(1000, 100, [40, 60])).toEqual([400, 600]);
  });

  it("returns zeros when nothing was consumed", () => {
    expect(allocateGoldValue(1000, 0, [100])).toEqual([0]);
  });
});

describe("checkBalanced", () => {
  it("accepts a balanced set", () => {
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 0 },
        { debitCents: 0, creditCents: 100 },
      ])
    ).not.toThrow();
  });

  it("rejects an unbalanced set", () => {
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 0 },
        { debitCents: 0, creditCents: 90 },
      ])
    ).toThrow(/balance/i);
  });

  it("rejects a single line", () => {
    expect(() => checkBalanced([{ debitCents: 100, creditCents: 100 }])).toThrow();
  });

  it("rejects a line that is both debit and credit", () => {
    // Balances on purpose, so the XOR guard is what fires rather than the
    // balance guard: 100 debit against 100 credit in total.
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 100 },
        { debitCents: 0, creditCents: 0 },
      ])
    ).toThrow(/XOR/);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      checkBalanced([
        { debitCents: -100, creditCents: 0 },
        { debitCents: 0, creditCents: -100 },
      ])
    ).toThrow();
  });

  it("rejects a zero total", () => {
    expect(() => checkBalanced([{ debitCents: 0, creditCents: 0 }])).toThrow();
  });
});

describe("computePartyLedger", () => {
  it("sums a customer ledger the way the shop reads it", () => {
    const t = computePartyLedger("customer", [
      line({ refEntity: "opening_balance", debitCents: 50_000 }),
      line({ refEntity: "sale_invoice", debitCents: 20_000 }),
      line({ refEntity: "sale_payment", creditCents: 15_000 }),
      line({ refEntity: "sale_return", creditCents: 2_000 }),
    ]);
    expect(t.opening).toBe(50_000);
    expect(t.debitSales).toBe(20_000);
    expect(t.creditPayments).toBe(15_000);
    expect(t.creditReturns).toBe(2_000);
    expect(t.closing).toBe(53_000);
  });

  it("flips the sign for a supplier ledger", () => {
    const t = computePartyLedger("supplier", [
      line({ refEntity: "opening_balance", creditCents: 30_000 }),
      line({ refEntity: "purchase_invoice", creditCents: 40_000 }),
      line({ refEntity: "purchase_payment", debitCents: 10_000 }),
    ]);
    expect(t.opening).toBe(30_000);
    expect(t.creditPurchases).toBe(40_000);
    expect(t.debitPayments).toBe(10_000);
    expect(t.closing).toBe(60_000);
  });

  it("treats an unknown ref as a sale for a customer", () => {
    expect(computePartyLedger("customer", [line({ debitCents: 7 })]).debitSales).toBe(7);
  });

  it("returns zeros for a party with no lines", () => {
    expect(computePartyLedger("customer", []).closing).toBe(0);
  });
});

describe("meltingLossValue", () => {
  it("matches the spec worked example", () => {
    // round(40,000,000 x 100 / (10,000 + 100)) = round(396,039.604) = 396,040
    expect(meltingLossValue(40_000_000, 10_000, 100)).toBe(396_040);
  });

  it("is zero when nothing was lost", () => {
    expect(meltingLossValue(40_000_000, 10_000, 0)).toBe(0);
  });

  it("is zero when there is no denominator, rather than dividing by zero", () => {
    expect(meltingLossValue(40_000_000, 0, 0)).toBe(0);
  });

  it("leaves the remainder with the lot", () => {
    expect(40_000_000 - meltingLossValue(40_000_000, 10_000, 100)).toBe(39_603_960);
  });

  it("charges the lot the full input cost when a batch recovers gold", () => {
    // recovery_mg > 0 forces loss_mg to 0, so the lot keeps everything.
    expect(meltingLossValue(40_000_000, 10_200, 0)).toBe(0);
  });
});

describe("goldValueCents", () => {
  it("converts fine mg at a per-gram rate", () => {
    expect(goldValueCents(10_000, 900_000)).toBe(9_000_000);
    expect(goldValueCents(1, 900_000)).toBe(900);
  });
});

describe("closingCash", () => {
  it("is opening plus in minus out", () => {
    expect(closingCash(10_000, 25_000, 12_000)).toBe(23_000);
  });

  it("is just the opening when nothing moved", () => {
    expect(closingCash(10_000, 0, 0)).toBe(10_000);
  });
});

describe("cashDifference", () => {
  it("is actual minus expected", () => {
    expect(cashDifference(23_000, 22_500)).toBe(-500);
  });

  it("is zero when the count matches", () => {
    expect(cashDifference(23_000, 23_000)).toBe(0);
  });
});

describe("settlementAmounts", () => {
  it("splits gross into net plus fee", () => {
    expect(settlementAmounts(250_000, 6_000)).toEqual({
      grossCents: 250_000,
      feeCents: 6_000,
      netCents: 244_000,
    });
  });

  it("allows a zero fee", () => {
    expect(settlementAmounts(100_000, 0).netCents).toBe(100_000);
  });

  it("rejects a fee larger than the settlement", () => {
    expect(() => settlementAmounts(100_000, 100_001)).toThrow(/fee/i);
  });

  it("rejects a negative or fractional fee", () => {
    expect(() => settlementAmounts(100_000, -1)).toThrow();
    expect(() => settlementAmounts(100_000, 1.5)).toThrow();
  });

  it("rejects a non-positive gross", () => {
    expect(() => settlementAmounts(0, 0)).toThrow(/gross/i);
    expect(() => settlementAmounts(-100, 0)).toThrow(/gross/i);
  });
});

describe("inTransitTotal", () => {
  it("is the sent amount until the receipt is recorded", () => {
    expect(inTransitTotal(100_000, 0)).toBe(100_000);
  });

  it("clears when the whole amount is received", () => {
    expect(inTransitTotal(100_000, 100_000)).toBe(0);
  });

  it("shows the remainder on a part-received transfer", () => {
    expect(inTransitTotal(100_000, 40_000)).toBe(60_000);
  });

  it("never reports negative when the books over-receive", () => {
    expect(inTransitTotal(100_000, 120_000)).toBe(0);
  });
});

describe("expenseThresholds", () => {
  it("keeps the pair in a named order", () => {
    expect(expenseThresholds(500_000, 1_000_000)).toEqual({
      approvalCents: 500_000,
      receiptCents: 1_000_000,
    });
  });

  it("clamps a negative threshold to zero", () => {
    expect(expenseThresholds(-1, 0)).toEqual({ approvalCents: 0, receiptCents: 0 });
  });
});

describe("expensePosting", () => {
  const t = { approvalCents: 500_000, receiptCents: 1_000_000 };

  it("gates nothing below both thresholds", () => {
    expect(expensePosting(499_999, t)).toEqual({
      requiresReceipt: false,
      requiresApproval: false,
    });
  });

  it("does not gate an expense exactly AT a threshold", () => {
    expect(expensePosting(500_000, t).requiresApproval).toBe(false);
    expect(expensePosting(1_000_000, t).requiresReceipt).toBe(false);
  });

  it("requires a receipt above the receipt threshold", () => {
    expect(expensePosting(1_000_001, t).requiresReceipt).toBe(true);
  });

  it("requires approval above the approval threshold", () => {
    expect(expensePosting(500_001, t).requiresApproval).toBe(true);
  });

  it("gates both above both", () => {
    expect(expensePosting(4_500_000, t)).toEqual({
      requiresReceipt: true,
      requiresApproval: true,
    });
  });

  it("gates everything when the thresholds are zero", () => {
    expect(expensePosting(1, { approvalCents: 0, receiptCents: 0 })).toEqual({
      requiresReceipt: true,
      requiresApproval: true,
    });
  });
});

describe("pendingApprovalTotal", () => {
  it("is the awaiting-approval figure the closing screen shows", () => {
    expect(pendingApprovalTotal(120_000, 45_000)).toBe(45_000);
  });

  it("is zero when nothing is pending", () => {
    expect(pendingApprovalTotal(120_000, 0)).toBe(0);
  });

  it("never reports negative for a bad figure", () => {
    expect(pendingApprovalTotal(0, -100)).toBe(0);
  });
});
