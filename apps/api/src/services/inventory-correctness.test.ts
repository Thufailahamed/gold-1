import { describe, expect, it } from "vitest";

function baseDb(overrides: Record<string, unknown> = {}) {
  return {
    prepare: (sql: string) => ({
      bind: (...v: unknown[]) => ({
        first: async () => {
          if (overrides[sql]) return overrides[sql];
          if (sql.includes("FROM products")) {
            return { id: "p1", status: "IN_STOCK", branch_id: "b1", net_mg: 5000, fine_gold_mg: 4580, cost_cents: 10000, purity_id: "pu1", permille: 916 };
          }
          if (sql.includes("FROM purities")) return { permille: 916 };
          if (sql.includes("FROM branches")) return { id: "b1" };
          if (sql.includes("FROM stock_counts")) return null;
          if (sql.includes("SELECT next FROM counters")) return { next: 1 };
          return null;
        },
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
    batch: async (..._a: unknown[]) => {},
  } as unknown as D1Database;
}

describe("inventory correctness RED", () => {
  it("rejects direct LOST via /inventory/movements (must go via counts)", async () => {
    const { recordMovement } = await import("./inventory");
    await expect(
      recordMovement(baseDb(), { productId: "p1", toStatus: "LOST", reason: "lost" }, "u1")
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects direct SOLD via /inventory/movements (must go via sales)", async () => {
    const { recordMovement } = await import("./inventory");
    await expect(
      recordMovement(baseDb(), { productId: "p1", toStatus: "SOLD" }, "u1")
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("heldGold includes RETURNED stock (matches monthly valuation)", async () => {
    const { heldGoldStages } = await import("./reconcile");
    let productsSql = "";
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM products")) {
              productsSql = sql;
              return { fine_mg: 0 };
            }
            if (sql.includes("SUM(o.fine_mg)")) return { total: 0, allocated: 0 };
            return { fine_mg: 0, total: 0, allocated: 0 };
          },
        }),
        first: async () => null,
      }),
    } as unknown as D1Database;
    await heldGoldStages(db, "b1");
    expect(productsSql).not.toContain("RETURNED");
  });

  it("sales return posts gold_ledger RETURN", async () => {
    const { createReturn } = await import("./sales");
    const seen: string[] = [];
    const boundVals: unknown[][] = [];
    const db = {
      prepare: (sql: string) => {
        seen.push(sql);
        return {
          bind: (...v: unknown[]) => {
            boundVals.push(v);
            return {
            first: async () => {
              if (sql.includes("FROM sales_invoices")) return { id: "inv1", customer_id: null, branch_id: "b1", total_cents: 1000 };
              if (sql.includes("FROM products")) return { id: "p1", status: "SOLD", branch_id: "b1", net_mg: 5000, fine_gold_mg: 4580, cost_cents: 10000, purity_id: "pu1" };
              if (sql.includes("JOIN purities") || sql.includes("FROM products JOIN")) return { fine_gold_mg: 4580, purity_permille: 916, net_mg: 5000, permille: 916 };
              if (sql.includes("FROM purities")) return { permille: 916 };
              if (sql.includes("SELECT next FROM counters")) return { next: 1 };
              if (sql.includes("FROM stock_counts")) return null;
              if (sql.includes("FROM chart_of_accounts")) return { code: "4000" };
              if (sql.includes("UPDATE counters SET next = next + 1 WHERE name = 'JE'")) return { allocated: 1 };
              if (sql.includes("FROM journal_entries")) return null;
              if (sql.includes("FROM day_closings")) return null;
              return null;
            },
            all: async () => {
              if (sql.includes("FROM sales_items") && sql.includes("invoice_id")) return { results: [{ id: "si1", product_id: "p1", price_cents: 1000, discount_cents: 0, cost_cents: 500 }] };
              if (sql.includes("FROM sales_return_items")) return { results: [] };
              if (sql.includes("FROM sales_payments")) return { results: [{ method: "cash", amount_cents: 1000 }] };
              if (sql.includes("FROM user_roles")) return { results: [] };
              return { results: [] };
            },
          };
          },
          first: async () => null,
          all: async () => ({ results: [] }),
        };
      },
      batch: async (..._a: unknown[]) => {},
    } as unknown as D1Database;
    await createReturn(db, { invoiceId: "inv1", type: "FULL", reason: "test return", refundMethod: "original" }, "u1");
    const joined = seen.join("\n") + "\n" + JSON.stringify(boundVals);
    expect(joined).toContain("RETURN");
    expect(seen.some((s) => s.includes("gold_ledger"))).toBe(true);
  });

  it("count approve rejects opener as approver", async () => {
    const { approveCount } = await import("./counts");
    const db = {
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("expected_json")) return { json: "[]" };
            if (sql.includes("FROM stock_counts")) return { id: "c1", branch_id: "b1", status: "OPEN", opened_by: "u2" };
            return null;
          },
          all: async () => {
            if (sql.includes("user_roles")) return { results: [{ name: "gold:manage" }] };
            if (sql.includes("FROM count_scans")) return { results: [] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
      batch: async (..._a: unknown[]) => {},
    } as unknown as D1Database;
    await expect(approveCount(db, "c1", { reason: "recount", approvedBy: "u2" }, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
