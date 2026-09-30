import { describe, expect, it } from "vitest";
import { buildBalanceSheet, fiscalYearFor, salesTaxCents, KNOWN_CASH_REFS } from "./accounting";

describe("salesTaxCents", () => {
  it("is zero when the rate is off", () => {
    expect(salesTaxCents(100_000, 0)).toBe(0);
  });
  it("taxes the net at basis points, rounded half away from zero", () => {
    expect(salesTaxCents(10_000_000, 1800)).toBe(1_800_000);
    expect(salesTaxCents(1_003, 1800)).toBe(181); // 180.54
    expect(salesTaxCents(25, 1800)).toBe(5); // 4.5 → 5
    expect(salesTaxCents(-25, 1800)).toBe(-5);
  });
});

describe("fiscalYearFor", () => {
  it("April start: labels the year that begins in April", () => {
    expect(fiscalYearFor("2026-09-29", 4)).toEqual({ start: "2026-04-01", end: "2027-03-31", label: "2026/27" });
    expect(fiscalYearFor("2026-03-31", 4)).toEqual({ start: "2025-04-01", end: "2026-03-31", label: "2025/26" });
    expect(fiscalYearFor("2026-04-01", 4).start).toBe("2026-04-01");
  });
  it("January start is the calendar year", () => {
    expect(fiscalYearFor("2026-09-29", 1)).toEqual({ start: "2026-01-01", end: "2026-12-31", label: "2026" });
  });
  it("handles a leap-year February end", () => {
    expect(fiscalYearFor("2027-06-01", 3).end).toBe("2028-02-29");
  });
  it("falls back to January for a nonsense month", () => {
    expect(fiscalYearFor("2026-09-29", 13).start).toBe("2026-01-01");
  });
});

describe("buildBalanceSheet with a year split", () => {
  const rows = [
    { code: "1000", name: "Cash", type: "ASSET", debitCents: 500, creditCents: 0 },
    { code: "4000", name: "Sales", type: "REVENUE", debitCents: 0, creditCents: 500 },
  ];
  it("splits profit into retained earnings and current year without changing the total", () => {
    const b = buildBalanceSheet(rows, { priorYearsProfitCents: 200 });
    expect(b.equity).toEqual([
      { code: "RE", name: "Retained earnings", cents: 200 },
      { code: "P&L", name: "Current year profit", cents: 300 },
    ]);
    expect(b.totalEquityCents).toBe(500);
    expect(b.balanced).toBe(true);
  });
  it("keeps the single line without a split", () => {
    expect(buildBalanceSheet(rows).equity).toEqual([{ code: "P&L", name: "Profit to date", cents: 500 }]);
  });
});

describe("KNOWN_CASH_REFS", () => {
  it("names a tax payment so it never blocks a close", () => {
    expect(KNOWN_CASH_REFS).toContain("tax_payment");
  });
});
