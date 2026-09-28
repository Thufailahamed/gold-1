import { describe, expect, it } from "vitest";
import { monthBounds } from "@goldos/shared";
import { buildMonthlyReport } from "./monthly";

type FirstVal = Record<string, number> | null;

function fakeDb(handlers: { first?: (sql: string) => FirstVal; all?: (sql: string) => { results: unknown[] } }): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (..._vals: unknown[]) => ({
        first: async <T>() => (handlers.first?.(sql) ?? null) as T | null,
        all: async <T>() => ({ results: [] as T[] }),
      }),
      first: async <T>() => (handlers.first?.(sql) ?? null) as T | null,
      all: async <T>() => (handlers.all?.(sql) ?? { results: [] as T[] }) as { results: T[] },
    }),
  } as unknown as D1Database;
}

function emptyDb(): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._vals: unknown[]) => ({
        first: async <T>() => null as T | null,
        all: async <T>() => ({ results: [] as T[] }),
      }),
      first: async <T>() => null as T | null,
      all: async <T>() => ({ results: [] as T[] }),
    }),
  } as unknown as D1Database;
}

describe("monthly report", () => {
  it("empty month returns zeros with hasData false", async () => {
    const r = await buildMonthlyReport(emptyDb(), { month: 2, year: 2026 });
    expect(r.sales.hasData).toBe(false);
    expect(r.profit.basis).toBe("ledger-posted-only");
    expect(r.profit.netProfitCents).toBe(0);
    expect(r.cashflow.unclassifiedCents).toBe(0);
    expect(r.gold.closingFineMg).toBe(0);
    expect(r.estimates[0]?.kind).toBe("estimate");
  });

  it("monthBounds rejects month 13", () => {
    expect(() => monthBounds(2026, 13)).toThrow();
  });

  it("wires ledger revenue into profit and sales net", async () => {
    const db = fakeDb({
      first: (sql) => {
        if (sql.includes("account_code='4000'")) return { n: 100000 };
        if (sql.includes("account_code='5000'")) return { n: 60000 };
        if (sql.includes("GLOB '60")) return { n: 10000 };
        if (sql.includes("sales_invoices si WHERE")) return { g: 100000, c: 2 } as unknown as Record<string, number>;
        if (sql.includes("sales_returns sr")) return { r: 5000 } as unknown as Record<string, number>;
        if (sql.includes("FROM expenses WHERE")) return { p: 10000, pend: 2000 } as unknown as Record<string, number>;
        if (sql.includes("FROM gold_ledger")) return { n: 0 };
        if (sql.includes("FROM journal_lines l JOIN journal_entries")) return { n: 0 };
        return { n: 0, dr: 0, cr: 0, g: 0, c: 0, r: 0, p: 0, pend: 0 };
      },
    });
    const r = await buildMonthlyReport(db, { month: 9, year: 2026 });
    expect(r.profit.revenueCents).toBe(100000);
    expect(r.profit.cogsCents).toBe(60000);
    expect(r.profit.grossProfitCents).toBe(40000);
    expect(r.sales.invoiceCount).toBe(2);
    expect(r.sales.returnsCents).toBe(5000);
    expect(r.expenses.pendingCents).toBe(2000);
  });
});
