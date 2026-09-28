import { describe, expect, it } from "vitest";

describe("custom order guards", () => {
  function orderDb(order: Record<string, unknown>) {
    return {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM custom_orders WHERE id")) return order;
            return null;
          },
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
  }
  it("refuses advances past production", async () => {
    const { advanceOrder } = await import("./customOrders");
    const db = orderDb({ id: "o1", status: "IN_PRODUCTION", customer_id: "c1", branch_id: "b1", quote_cents: 100000, advance_cents: 0 });
    await expect(advanceOrder(db, "o1", { amountLkr: 100, method: "cash" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses advances over quote", async () => {
    const { advanceOrder } = await import("./customOrders");
    const db = orderDb({ id: "o1", status: "QUOTE", customer_id: "c1", branch_id: "b1", quote_cents: 100000, advance_cents: 90000 });
    await expect(advanceOrder(db, "o1", { amountLkr: 200, method: "cash" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses delivery before READY", async () => {
    const { deliverOrder } = await import("./customOrders");
    const db = orderDb({ id: "o1", status: "IN_PRODUCTION", customer_id: "c1", branch_id: "b1", quote_cents: 100000, advance_cents: 0, manufacturing_order_id: "m1" });
    await expect(deliverOrder(db, "o1", { payments: [{ method: "cash", amountLkr: 1000 }] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses balance that does not match the unpaid remainder", async () => {
    const { deliverOrder } = await import("./customOrders");
    const db = {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM custom_orders WHERE id")) return { id: "o1", status: "READY", customer_id: "c1", branch_id: "b1", quote_cents: 100000, advance_cents: 20000, manufacturing_order_id: "m1" };
            return null;
          },
          all: async () => {
            if (sql.includes("FROM manufacturing_outputs")) return { results: [{ product_id: "p1" }] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
    await expect(deliverOrder(db, "o1", { payments: [{ method: "cash", amountLkr: 100 }] }, "u1")).rejects.toMatchObject({ message: expect.stringContaining("unpaid") });
  });
});
