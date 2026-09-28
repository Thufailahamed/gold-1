import { describe, expect, it } from "vitest";
import { compareCount } from "@goldos/shared";

describe("stock count compare", () => {
  it("never fabricates matches for an empty scan", async () => {
    const r = compareCount([{ productId: "p1", barcode: "JW-AAAAAA" }], []);
    expect(r.matchedCount).toBe(0);
    expect(r.missing).toEqual(["p1"]);
  });
  it("flags duplicates and unexpected scans", () => {
    const r = compareCount(
      [{ productId: "p1", barcode: "JW-AAAAAA" }],
      [{ barcode: "JW-AAAAAA", productId: "p1" }, { barcode: "JW-AAAAAA", productId: "p1" }, { barcode: "ZZ-000000", productId: null }]
    );
    expect(r.duplicates).toEqual(["p1"]);
    expect(r.unexpected).toEqual(["ZZ-000000"]);
  });
  it("refuses self-approval without touching the database", async () => {
    const { approveCount } = await import("./counts");
    await expect(approveCount({} as D1Database, "c1", { reason: "short", approvedBy: "u1" }, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("posts nothing for an unexpected-only count", async () => {
    const { approveCount } = await import("./counts");
    const db = {
      batch: async (..._args: unknown[]) => {},
      prepare: (sql: string) => ({
        bind: (..._v: unknown[]) => ({
          first: async () => {
            if (sql.includes("expected_json")) return { json: "[]" };
            if (sql.includes("FROM stock_counts")) return { id: "c1", branch_id: "b1", status: "OPEN" };
            return null;
          },
          all: async () => {
            if (sql.includes("user_roles")) return { results: [{ name: "gold:manage" }] };
            return { results: [] };
          },
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    } as unknown as D1Database;
    const r = await approveCount(db, "c1", { reason: "recount done", approvedBy: "u2" }, "u1");
    expect(r.posted).toBe(0);
  });
});
