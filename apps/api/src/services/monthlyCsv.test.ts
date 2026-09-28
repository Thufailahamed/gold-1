import { describe, expect, it } from "vitest";
import { sectionRows } from "./monthly";

const base = {
  meta: { from: "2026-09-01", to: "2026-09-30", month: "2026-09", branchId: "b1" },
  sales: { totalCents: 100000, invoiceCount: 2, grossCents: 110000, returnsCents: 10000, netCents: 100000, hasData: true },
  profit: { revenueCents: 100000, cogsCents: 60000, grossProfitCents: 40000, operatingExpensesCents: 10000, netProfitCents: 30000, basis: "ledger-posted-only" as const },
} as never;

describe("sectionRows", () => {
  it("flattens profit legs", () => {
    const r = sectionRows("profit", base);
    expect(r.cols).toContain("netProfitCents");
    expect(r.rows[0]).toMatchObject({ netProfitCents: 30000 });
  });
  it("yields a no-data row for unknown sections", () => {
    expect(sectionRows("nope" as never, base).rows).toEqual([{ note: "no data" }]);
  });
});
