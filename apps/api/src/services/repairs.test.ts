// Success-path coverage needs journal/counter/chart tables; the unit tests pin
// the guards, and collection success is verified against dev D1 manually.
import { describe, expect, it } from "vitest";

describe("repair collection", () => {
  function spyDb(opts?: { status?: string }) {
    const seen: string[] = [];
    const db = {
      batch: async (..._a: unknown[]) => {},
      prepare: (sql: string) => {
        seen.push(sql);
        return {
          bind: (..._v: unknown[]) => ({
            first: async () => {
              if (sql.includes("FROM repairs WHERE id")) return { id: "r1", status: opts?.status ?? "READY", customer_id: "c1", branch_id: "b1", estimate_cents: 50000 };
              return null;
            },
            all: async () => ({ results: [] }),
          }),
          first: async () => null,
          all: async () => ({ results: [] }),
        };
      },
    } as unknown as D1Database;
    return { db, seen };
  }
  it("refuses collection before READY", async () => {
    const { collectRepair } = await import("./repairs");
    const { db } = spyDb({ status: "IN_PROGRESS" });
    await expect(collectRepair(db, "r1", { payments: [{ method: "cash", amountLkr: 500 }], conditionOut: "polished" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses underpayment", async () => {
    const { collectRepair } = await import("./repairs");
    const { db } = spyDb();
    await expect(collectRepair(db, "r1", { payments: [{ method: "cash", amountLkr: 100 }], conditionOut: "polished" }, "u1")).rejects.toMatchObject({ message: expect.stringContaining("sum") });
  });
  it("never touches products or gold tables", async () => {
    const { collectRepair } = await import("./repairs");
    const { db, seen } = spyDb();
    await collectRepair(db, "r1", { payments: [{ method: "cash", amountLkr: 500 }], conditionOut: "polished" }, "u1").catch(() => null);
    expect(seen.join("\n")).not.toContain("products");
    expect(seen.join("\n")).not.toContain("gold_ledger");
  });
});
