// Old gold bought in counts as stock: it is in the category and branch views, the
// category counts, and the totals, and it leaves stock once melted or sold.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("old gold on hand in inventory", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
  });

  it("a bought-in piece shows in the category view, the counts and the totals", async () => {
    const og = await import("./oldgold");
    const inv = await import("./inventory");
    const { id } = await og.intakeItem(db, { customerId: "c1", branchId: "b1", grossG: 4, stoneG: 0, purityId: "purity-22k" }, "u1");
    await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    await og.purchaseItem(db, id, { paidLkr: 0, method: "cash" }, "u1");

    const byCat = await inv.stockSummary(db, "category");
    expect(byCat).toContainEqual(expect.objectContaining({ key: "cat-og", name: "OLD GOLD OG", pieces: 1, net_mg: 4000 }));
    const counts = await inv.categoryCounts(db, null);
    expect(counts).toContainEqual({ id: "cat-og", name: "OLD GOLD OG", pieces: 1 });
    const insights = await inv.inventoryInsights(db, null);
    expect(insights.totals.pieces).toBeGreaterThanOrEqual(1);
    expect(insights.totals.fine_mg).toBeGreaterThanOrEqual(3664); // 4 g at 916 permille
  });

  it("leaves stock once the piece is melted", async () => {
    const inv = await import("./inventory");
    const before = (await inv.stockSummary(db, "category")).find((r) => r.key === "cat-og");
    raw.exec("UPDATE old_gold_items SET status = 'MELTED' WHERE number LIKE 'OG-%'");
    const after = (await inv.stockSummary(db, "category")).find((r) => r.key === "cat-og");
    expect(before?.pieces).toBe(1);
    expect(after).toBeUndefined();
  });
});
