import { describe, expect, it } from "vitest";
import { denominationTotalCents, explainingAmounts } from "./accounting";

describe("denominationTotalCents", () => {
  it("adds the sheet up in cents", () => {
    expect(denominationTotalCents({ "5000": 3, "1000": 2, "20": 1, "1": 4 })).toBe(1_702_400);
    expect(denominationTotalCents({})).toBe(0);
  });
  it("refuses a face value that does not exist", () => {
    expect(() => denominationTotalCents({ "3000": 1 })).toThrow(/Unknown denomination/);
  });
  it("refuses a negative or fractional count", () => {
    expect(() => denominationTotalCents({ "100": -1 })).toThrow();
    expect(() => denominationTotalCents({ "100": 1.5 })).toThrow();
  });
});

describe("explainingAmounts", () => {
  it("finds single movements the size of the difference, either sign", () => {
    expect(explainingAmounts(-500, [100, 500, -500, 700]).singles).toEqual([1, 2]);
  });
  it("finds pairs that sum to it", () => {
    expect(explainingAmounts(900, [200, 700, 400, 500]).pairs).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
  it("finds nothing for a zero difference", () => {
    expect(explainingAmounts(0, [0, 100])).toEqual({ singles: [], pairs: [] });
  });
  it("caps the pairs", () => {
    expect(explainingAmounts(2, [1, 1, 1, 1, 1, 1], 3).pairs).toHaveLength(3);
  });
});
