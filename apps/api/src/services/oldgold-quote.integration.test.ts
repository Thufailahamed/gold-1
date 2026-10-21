// A price per gram typed at intake: the item is priced at net × rate when it is
// valued, deductions come off that price, and an explicit buy % still uses the
// board rate instead.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("old gold price per gram at intake", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec("INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0)");
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
  });

  it("stores the typed price per gram with the item", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Chain", grossG: 5, stoneG: 0, quotedRateLkr: 25_000 }, "u1");
    const item = raw.prepare("SELECT item_type FROM old_gold_items WHERE id = ?").get(id) as { item_type: string };
    const quote = raw.prepare("SELECT rate_cents_per_g FROM old_gold_quotes WHERE item_id = ?").get(id) as { rate_cents_per_g: number };
    expect(item.item_type).toBe("Old gold");
    expect(quote.rate_cents_per_g).toBe(2_500_000);
  });

  it("values the item at net × the typed rate", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Bangle", grossG: 10, stoneG: 1, quotedRateLkr: 25_000 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    expect(v.valueCents).toBe(22_500_000); // 9 g × LKR 25,000
  });

  it("takes the deductions off the typed price", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Ring", grossG: 4, stoneG: 0, quotedRateLkr: 20_000 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 500, processingDeductionLkr: 1_000 }, "u1");
    expect(v.valueCents).toBe(7_850_000); // 4 g × 20,000 − 1,500
  });

  it("an explicit buy % still values at the board rate", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Pendant", grossG: 5, stoneG: 0, quotedRateLkr: 25_000 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { buyPct: 92, reason: "Customer asked", stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    expect(v.valueCents).toBe(13_110_000); // 5 g × 28,500 × 92%, as before
  });
});
