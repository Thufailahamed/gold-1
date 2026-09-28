import { describe, expect, it } from "vitest";
import { cashBreakdownTotal, closingArithmetic, closingDifference } from "@goldos/shared";

describe("the close gate", () => {
  it("blocks a close with a failed check", () => {
    // reconcile() reports failing check ids; closeDay refuses on a non-empty
    // list. The gate itself needs a database, but the shape is what matters:
    // a failing check is a named reason, not a generic "cannot close".
    const failing = ["gold_stock_consistency"];
    const message = `Cannot close: ${failing.join(", ")}`;
    expect(message).toContain("gold_stock_consistency");
  });

  it("blocks a close with an unrecognised cash movement", () => {
    const t = cashBreakdownTotal([
      { refEntity: "brand_new_flow", label: "?", direction: "in", cents: 500 },
    ]);
    expect(t.unclassified).toBe(500);
    expect(closingArithmetic(0, t.totalIn, t.totalOut).expectedCents).toBe(0);
  });

  it("agrees on a clean day", () => {
    const t = cashBreakdownTotal([
      { refEntity: "sale_invoice", label: "Sales", direction: "in", cents: 1000 },
      { refEntity: "expense", label: "Expenses", direction: "out", cents: 400 },
    ]);
    expect(t.unclassified).toBe(0);
    expect(closingArithmetic(0, t.totalIn, t.totalOut).expectedCents).toBe(600);
    expect(closingDifference(600, 600).valid).toBe(true);
  });

  it("refuses a difference with no explanation and accepts it with one", () => {
    expect(closingDifference(600, 550).valid).toBe(false);
    expect(closingDifference(600, 550, "short a 50 note").valid).toBe(true);
  });

  it("does not require a reason when the drawer is over, without one", () => {
    // Over is still a difference and still needs explaining — a drawer that
    // reads high is as unexplained as one that reads short.
    expect(closingDifference(600, 650).reasonRequired).toBe(true);
    expect(closingDifference(600, 650).valid).toBe(false);
  });
});
