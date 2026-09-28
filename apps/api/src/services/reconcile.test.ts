import { describe, expect, it } from "vitest";
import { compareMoney, compareWeight } from "./reconcile";

describe("compareMoney", () => {
  it("passes when the numbers agree", () => {
    const r = compareMoney("trial_balance", "Trial balance", 0, 0, "cumulative");
    expect(r.pass).toBe(true);
    expect(r.difference).toBe(0);
  });

  it("fails and reports the signed difference when they do not", () => {
    const r = compareMoney("sales_crossfoot", "Sales", 1000, 500, "day");
    expect(r.pass).toBe(false);
    expect(r.difference).toBe(-500);
  });

  it("tolerates a one-cent residue", () => {
    expect(compareMoney("x", "x", 1000, 999, "day").pass).toBe(true);
    expect(compareMoney("x", "x", 1000, 997, "day").pass).toBe(false);
  });

  it("passes detail lines through", () => {
    expect(compareMoney("x", "x", 0, 5, "day", ["JE-000007 off by 5"]).detail).toEqual([
      "JE-000007 off by 5",
    ]);
  });
});

describe("compareWeight", () => {
  it("passes on an exact match", () => {
    expect(compareWeight("gold_sale", "Gold SALE", 1000, 1000).pass).toBe(true);
  });

  it("fails on a one-milligram difference, with no tolerance", () => {
    const r = compareWeight("gold_sale", "Gold SALE", 1000, 999);
    expect(r.pass).toBe(false);
    expect(r.difference).toBe(1);
  });
});

describe("in-transit comparison", () => {
  it("passes when the entries net to the outstanding transfers", () => {
    const r = compareMoney("cash_in_transit", "In transit", 100_000, 100_000, "cumulative");
    expect(r.pass).toBe(true);
  });

  it("fails when a receipt is missing from the ledger", () => {
    expect(
      compareMoney("cash_in_transit", "In transit", 100_000, 100_000 + 40_000, "cumulative").pass
    ).toBe(false);
  });
});
