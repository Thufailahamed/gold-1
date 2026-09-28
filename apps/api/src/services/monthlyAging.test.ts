import { describe, expect, it } from "vitest";
import { buildMonthlyReport } from "./monthly";

function fakeDb(first: (sql: string) => unknown, all: (sql: string) => unknown[] = () => []) {
  return {
    prepare: (sql: string) => ({
      bind: (..._v: unknown[]) => ({
        first: async () => first(sql),
        all: async () => ({ results: all(sql) }),
      }),
      first: async () => first(sql),
      all: async () => ({ results: all(sql) }),
    }),
  } as unknown as D1Database;
}

describe("monthly aging", () => {
  it("ages outstanding invoices while paid ones disappear", async () => {
    const db = fakeDb(
      (sql) => {
        if (sql.includes("account_code='4000'")) return { n: 0 };
        return { n: 0, dr: 0, cr: 0 };
      },
      (sql) => {
        if (sql.includes("FROM sales_invoices")) return [
          { id: "s1", number: "SINV-1", total_cents: 10000, d: "2026-09-01", paid: 10000 },
          { id: "s2", number: "SINV-2", total_cents: 5000, d: "2026-09-20", paid: 0 },
        ];
        return [];
      }
    );
    const r = await buildMonthlyReport(db, { month: 9, year: 2026 });
    expect(r.receivables.outstanding.map((o) => o.id)).toEqual(["s2"]);
    expect(r.receivables.aging["0-30"]).toBe(5000);
    expect(r.receivables.hasData).toBe(true);
  });
  it("values inventory at book cost, never board rate", async () => {
    const db = fakeDb(() => ({ n: 0, cents: 0, pieces: 0, uncosted: 0 }));
    const r = await buildMonthlyReport(db, { month: 9, year: 2026 });
    expect(r.inventory.basis).toBe("book-cost");
    expect(r.inventory.hasData).toBe(false);
    expect(r.estimates.every((e) => e.kind === "estimate")).toBe(true);
  });
});
