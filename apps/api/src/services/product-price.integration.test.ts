// A piece is created with no selling price: the price is set at the POS when it
// is sold. Until then a piece with no price falls back to the live rate.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("product price at the till", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
  });

  const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000, grossG: 5, name: "Bracelet" };

  it("creates a piece with no selling price", async () => {
    const { createProduct } = await import("./products");
    const p = await createProduct(db, base, "u1");
    const row = raw.prepare("SELECT selling_price_cents FROM products WHERE id = ?").get(p.id) as { selling_price_cents: number | null };
    expect(row.selling_price_cents).toBeNull();
  });

  it("sells a piece with no book cost, and its COGS posts as zero", async () => {
    const { createProduct } = await import("./products");
    const { receiveSale } = await import("./sales");
    const { costLkr: _unused, ...noCost } = base;
    const p = await createProduct(db, noCost, "u1");
    const sale = await receiveSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        items: [{ productId: p.id, priceLkr: 100_000, listPriceLkr: 142_500, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 100_000 }],
      },
      "u1",
      { enforceShelfPrice: true }
    );
    const item = raw.prepare("SELECT cost_cents FROM sales_items WHERE invoice_id = ?").get(sale.invoiceId) as { cost_cents: number };
    expect(item.cost_cents).toBe(0);
  });

  it("the till charges the price typed at the counter, not the live rate", async () => {
    const { createProduct } = await import("./products");
    const { receiveSale } = await import("./sales");
    const p = await createProduct(db, base, "u1");
    // The live rate for 5 g at 2,850,000 cents/g is 142,500 LKR; the cashier sells at 123,456.
    const sale = await receiveSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        items: [{ productId: p.id, priceLkr: 123_456, listPriceLkr: 142_500, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 123_456 }],
      },
      "u1",
      { enforceShelfPrice: true }
    );
    const inv = raw.prepare("SELECT total_cents FROM sales_invoices WHERE id = ?").get(sale.invoiceId) as { total_cents: number };
    expect(inv.total_cents).toBe(12_345_600);
  });
});
