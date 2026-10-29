// A customer's piece bought straight into stock: no testing, paid for, and in stock at once.
import { beforeAll, describe, expect, it } from "vitest";
import { buyInOldGoldSchema, createProductSchema } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("buying old gold into stock over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T | undefined;

  // Gold held in stock (fine) must equal the gold ledger's net inflow, as gold_stock_consistency checks.
  async function expectGoldAgrees() {
    const { heldGoldMg } = await import("./reconcile");
    const ledger = one<{ n: number }>(
      "SELECT COALESCE(SUM(CASE WHEN destination LIKE 'branch:%' THEN fine_mg ELSE 0 END) - SUM(CASE WHEN source LIKE 'branch:%' THEN fine_mg ELSE 0 END), 0) AS n FROM gold_ledger"
    )!.n;
    expect(await heldGoldMg(db)).toBe(ledger);
  }

  beforeAll(() => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0);
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      -- 22K board 28,500 LKR/g.
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
  });

  it("takes a customer's piece into stock at once, with no testing record", async () => {
    const { buyInItem } = await import("./oldgold");
    const bought = await buyInItem(
      db,
      buyInOldGoldSchema.parse({ customerId: "c1", branchId: "b1", purityId: "purity-22k", grossG: 4, stoneG: 0, quotedRateLkr: 27000 }),
      "u1"
    );

    // 4 g at 27,000 LKR/g.
    expect(bought.valueCents).toBe(10_800_000);
    expect(one("SELECT status, karat, tested_permille, net_mg, purchase_value_cents FROM old_gold_items WHERE id = ?", bought.id)).toEqual({
      status: "AVAILABLE",
      karat: "22K",
      tested_permille: 916,
      net_mg: 4000,
      purchase_value_cents: 10_800_000,
    });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_tests WHERE item_id = ?", bought.id)?.n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_purchases WHERE item_id = ?", bought.id)?.n).toBe(1);
    await expectGoldAgrees();
  });

  it("makes a product from the piece once it is in stock", async () => {
    const { createProduct } = await import("./products");
    const product = await createProduct(
      db,
      createProductSchema.parse({ categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", grossG: 2, stoneG: 0 }),
      "u1",
      { fromOldGold: true }
    );
    expect(one("SELECT net_mg FROM old_gold_items WHERE customer_id = 'c1' AND status = 'AVAILABLE'")).toEqual({ net_mg: 2000 });
    expect(one("SELECT COUNT(*) AS n FROM old_gold_draws WHERE product_id = ?", product.id)).toEqual({ n: 1 });
    // The stock total shows what is left: 4 g bought, 2 g made into the product.
    const { stockOnHand } = await import("./oldgold");
    expect(await stockOnHand(db)).toMatchObject({ netMg: 2000, byKarat: [{ karat: "22K", netMg: 2000 }] });
    await expectGoldAgrees();
  });

  it("keeps nothing on record when the payment is more than the piece is worth", async () => {
    const { buyInItem } = await import("./oldgold");
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items WHERE status IN ('AVAILABLE', 'PURCHASED')")?.n;
    await expect(
      buyInItem(
        db,
        buyInOldGoldSchema.parse({ customerId: "c1", branchId: "b1", purityId: "purity-22k", grossG: 2, stoneG: 0, quotedRateLkr: 27000, paidLkr: 999_999 }),
        "u1"
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(one("SELECT status FROM old_gold_items WHERE customer_id = 'c1' ORDER BY created_at DESC LIMIT 1")).toEqual({ status: "VOID" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items WHERE status IN ('AVAILABLE', 'PURCHASED')")?.n).toBe(before);
    await expectGoldAgrees();
  });
});
