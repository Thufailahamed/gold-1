// Stock narrowed by category over real SQLite: the per-category piece counts
// only count what is on hand, respect branch scope, and leave out categories
// with nothing in stock; the stock summary filters to one category.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("stock by category over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Annex','ANNEX',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r1','purity-22k', 2500000, 1, 1);
    `);
    const { createProduct } = await import("./products");
    const base = { metalTypeId: "metal-gold", purityId: "purity-22k", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000, grossG: 2 };
    await createProduct(db, { ...base, categoryId: "cat-ring", branchId: "b1", name: "Ring A" }, "u1");
    await createProduct(db, { ...base, categoryId: "cat-ring", branchId: "b1", name: "Ring B" }, "u1");
    await createProduct(db, { ...base, categoryId: "cat-chain", branchId: "b1", name: "Chain A" }, "u1");
    await createProduct(db, { ...base, categoryId: "cat-ring", branchId: "b2", name: "Ring C" }, "u1");
    // A sold piece is no longer on hand, so it must not be counted.
    raw.exec(`UPDATE products SET status = 'SOLD' WHERE name = 'Ring B'`);
  });

  it("counts pieces on hand per category, largest first, leaving out sold pieces", async () => {
    const { categoryCounts } = await import("./inventory");
    const rows = await categoryCounts(db);
    expect(rows).toEqual([
      { id: "cat-ring", name: "Ring", pieces: 2 },
      { id: "cat-chain", name: "Chain", pieces: 1 },
    ]);
  });

  it("only counts the branches in scope and a chosen branch", async () => {
    const { categoryCounts } = await import("./inventory");
    expect(await categoryCounts(db, ["b1"])).toEqual([
      { id: "cat-chain", name: "Chain", pieces: 1 },
      { id: "cat-ring", name: "Ring", pieces: 1 },
    ]);
    expect(await categoryCounts(db, ["b2"])).toEqual([{ id: "cat-ring", name: "Ring", pieces: 1 }]);
    expect(await categoryCounts(db, ["b1"], "b2")).toEqual([]);
    expect(await categoryCounts(db, [])).toEqual([]);
  });

  it("narrows the stock summary to one category and keeps the count per branch", async () => {
    const { stockSummary } = await import("./inventory");
    const chains = await stockSummary(db, "product", null, undefined, "cat-chain");
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ name: "Chain A", pieces: 1 });

    const rings = await stockSummary(db, "branch", null, undefined, "cat-ring");
    expect(rings.map((r) => [r.key, r.pieces])).toEqual([
      ["b1", 1],
      ["b2", 1],
    ]);
  });

  it("groups stock by category with its pieces, weight and name", async () => {
    const { stockSummary } = await import("./inventory");
    const rows = await stockSummary(db, "category");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "cat-ring", name: "Ring", pieces: 2 });
    expect(rows[1]).toMatchObject({ key: "cat-chain", name: "Chain", pieces: 1 });
    // Net weight is summed across the category's pieces on hand (Ring A and Ring C, 2 g each).
    expect(rows[0]!.net_mg).toBe(4000);
    expect(rows[0]!.value_cents).toBeGreaterThan(0);
  });

  it("without a category, the stock summary still covers every category", async () => {
    const { stockSummary } = await import("./inventory");
    const all = await stockSummary(db, "branch");
    const total = all.reduce((s, r) => s + (r.pieces as number), 0);
    expect(total).toBe(3);
  });
});
