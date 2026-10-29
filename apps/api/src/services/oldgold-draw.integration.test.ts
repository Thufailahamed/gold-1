// Products come from old gold on hand: a piece draws its metal from its branch's
// old gold, and a piece or tray that needs more than is on hand is refused.
import { beforeAll, describe, expect, it } from "vitest";
import { bulkCreateProductsSchema, createProductSchema } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("products made from old gold over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T | undefined;
  const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0 };

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
    `);
  });

  it("draws a piece's metal from the old gold of its karat, with its fine and cost", async () => {
    const og = await import("./oldgold");
    const { createProduct } = await import("./products");
    const shop = await og.intakeItem(db, { shopOwned: true, branchId: "b1", grossG: 2000, stoneG: 0, purityId: "purity-22k", costLkr: 4500000 }, "u1");
    const product = await createProduct(db, createProductSchema.parse({ ...base, grossG: 2 }), "u1", { fromOldGold: true });

    expect(one("SELECT net_mg, gross_mg, status, purchase_value_cents FROM old_gold_items WHERE id = ?", shop.id)).toEqual({
      net_mg: 1998000,
      gross_mg: 1998000,
      status: "AVAILABLE",
      purchase_value_cents: 450000000 - 450000,
    });
    expect(one("SELECT fine_gold_mg, cost_cents FROM products WHERE id = ?", product.id)).toEqual({ fine_gold_mg: 1832, cost_cents: 450000 });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_draws WHERE product_id = ? AND net_mg = 2000", product.id)?.n).toBe(1);
    // Same karat, so nothing enters the ledger for the piece: its gold was already held.
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE ref_entity = 'product_intake' AND ref_id = ?", product.id)?.n).toBe(0);
    await expectGoldAgrees();
  });

  it("refuses a piece that needs more old gold than the branch has, and writes nothing", async () => {
    const { createProduct } = await import("./products");
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM products")?.n;
    await expect(createProduct(db, createProductSchema.parse({ ...base, grossG: 5000 }), "u1", { fromOldGold: true })).rejects.toThrow(
      "Not enough old gold on hand"
    );
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products")?.n).toBe(before);
  });

  it("takes the rest from old gold with no karat yet, and books that part at the piece's karat", async () => {
    const og = await import("./oldgold");
    const { createProduct } = await import("./products");
    const weight = await og.intakeItem(db, { shopOwned: true, branchId: "b1", grossG: 10, stoneG: 0 }, "u1");
    // 1998 g of 22K is left, so the piece takes all of it and 2 g from the weight with no karat.
    const product = await createProduct(db, createProductSchema.parse({ ...base, grossG: 2000 }), "u1", { fromOldGold: true });

    expect(one("SELECT net_mg, status FROM old_gold_items WHERE id = ?", weight.id)).toEqual({ net_mg: 8000, status: "AVAILABLE" });
    expect(one<{ status: string }>("SELECT status FROM old_gold_items WHERE customer_id = 'shop-stock' AND net_mg = 0 AND karat = '22K' LIMIT 1")?.status).toBe("DRAWN");
    expect(one("SELECT weight_mg, permille FROM gold_ledger WHERE ref_entity = 'product_intake' AND ref_id = ?", product.id)).toEqual({
      weight_mg: 2000,
      permille: 916,
    });
    await expectGoldAgrees();
  });

  it("puts a voided piece's old gold back on hand", async () => {
    const { createProduct, voidProduct } = await import("./products");
    const weight = one<{ id: string }>("SELECT id FROM old_gold_items WHERE net_mg = 8000 AND status = 'AVAILABLE'")!;
    const product = await createProduct(db, createProductSchema.parse({ ...base, grossG: 8 }), "u1", { fromOldGold: true });
    expect(one("SELECT net_mg, status FROM old_gold_items WHERE id = ?", weight.id)).toEqual({ net_mg: 0, status: "DRAWN" });

    await voidProduct(db, product.id, "u1", "entered wrongly");

    expect(one("SELECT net_mg, status FROM old_gold_items WHERE id = ?", weight.id)).toEqual({ net_mg: 8000, status: "AVAILABLE" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_draws WHERE product_id = ? AND reversed_at IS NOT NULL", product.id)?.n).toBe(1);
    await expectGoldAgrees();
  });

  it("refuses a tray that needs more old gold than is on hand, and writes none of its pieces", async () => {
    const { createProductsBulk } = await import("./products");
    const tray = (grossG: number) =>
      bulkCreateProductsSchema.parse({
        common: { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1" },
        items: [{ grossG }, { grossG }, { grossG }],
      });
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM products")?.n;
    await expect(createProductsBulk(db, tray(5), "u1", { fromOldGold: true })).rejects.toThrow("Not enough old gold on hand");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products")?.n).toBe(before);

    // 3 × 1 g fits the 8 g on hand: every piece is made, and the batch takes 3 g out of old gold.
    const made = await createProductsBulk(db, tray(1), "u1", { fromOldGold: true });
    expect(made.products).toHaveLength(3);
    expect(one("SELECT net_mg FROM old_gold_items WHERE customer_id = 'shop-stock' AND status = 'AVAILABLE' AND net_mg > 0 AND karat IS NULL")).toEqual({
      net_mg: 5000,
    });
    await expectGoldAgrees();
  });
});
