import { describe, expect, it } from "vitest";
import { centsToLkr, fineGoldMg, gToMg, lkrToCents, mgToG, priceCents } from "./units";

describe("units", () => {
  it("converts grams to mg", () => {
    expect(gToMg(5.2)).toBe(5200);
    expect(mgToG(5200)).toBe(5.2);
  });
  it("converts LKR to cents", () => {
    expect(lkrToCents(15000)).toBe(1500000);
    expect(centsToLkr(1500000)).toBe(15000);
  });
  it("computes fine gold", () => {
    expect(fineGoldMg(5000, 916)).toBe(4580);
  });
  it("prices 5g at 28500 + 15000 making", () => {
    expect(priceCents(5000, 2850000, 1500000)).toBe(15750000);
  });
});
