// Old gold is filed under one of the shop's OLD GOLD categories. The default is
// the OG one; a piece can be filed under another, and only an old gold category is accepted.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("old gold categories", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO categories (id, name, code, created_at) VALUES
        ('cat-og', 'OLD GOLD OG', 'OG', 0),
        ('cat-moose', 'OLD GOLD Moose', 'Moose', 0),
        ('cat-up', 'OLD GOLD UP', 'UP', 0);
    `);
  });

  const categoryOf = (id: string) =>
    raw.prepare("SELECT cat.code FROM old_gold_item_categories ogc JOIN categories cat ON cat.id = ogc.category_id WHERE ogc.item_id = ?").get(id) as { code: string } | undefined;

  it("lists the three old gold categories with OG as the default", async () => {
    const { oldGoldCategories } = await import("./oldgold");
    const rows = await oldGoldCategories(db);
    expect(rows.map((r) => r.code).sort()).toEqual(["Moose", "OG", "UP"]);
    expect(rows.find((r) => r.isDefault)?.code).toBe("OG");
  });

  it("files a piece under OG when no category is chosen", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Chain", grossG: 3, stoneG: 0 }, "u1");
    expect(categoryOf(id)?.code).toBe("OG");
    const detail = await og.getItem(db, id);
    expect(detail.category).toMatchObject({ code: "OG", name: "OLD GOLD OG" });
  });

  it("without testing, a piece is Tested at the karat chosen and can be valued straight away", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { customerId: "c1", branchId: "b1", grossG: 4, stoneG: 0, purityId: "purity-22k" }, "u1");
    const row = raw.prepare("SELECT status, tested_permille, karat FROM old_gold_items WHERE id = ?").get(id) as { status: string; tested_permille: number; karat: string };
    expect(row).toEqual({ status: "TESTED", tested_permille: 916, karat: "22K" });
    raw.exec("INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22', 'purity-22k', 2850000, 0, 0)");
    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    expect(v.valueCents).toBeGreaterThan(0);
  });

  it("without testing, a karat is required", async () => {
    const og = await import("./oldgold");
    await expect(og.intakeItem(db, { customerId: "c1", branchId: "b1", grossG: 4, stoneG: 0 }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("at intake, a purchase paid entirely as credit settles the customer's open bill", async () => {
    const og = await import("./oldgold");
    raw.exec(`INSERT INTO sales_invoices (id, number, customer_id, branch_id, subtotal_cents, discount_cents, tax_cents, tax_rate_bp, total_cents, paid_cents, status, store_credit_cents, created_at, created_by)
      VALUES ('inv-open', 'SINV-OPEN', 'c1', 'b1', 500000, 0, 0, 0, 500000, 0, 'UNPAID', 0, 0, 'u1')`);
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", grossG: 4, stoneG: 0 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    await og.purchaseItem(db, id, { paidLkr: 0, method: "cash" }, "u1");
    expect(raw.prepare("SELECT status, paid_cents FROM sales_invoices WHERE id = 'inv-open'").get()).toEqual({
      status: "PAID",
      paid_cents: 500000,
    });
  });

  it("records a piece with no description as Old gold, with its weight", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", grossG: 3, stoneG: 0 }, "u1");
    const row = raw.prepare("SELECT description FROM old_gold_items WHERE id = ?").get(id) as { description: string };
    expect(row.description).toBe("Old gold, 3 g");
  });

  it("files a piece under the category chosen", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Ring", grossG: 2, stoneG: 0, categoryId: "cat-up" }, "u1");
    expect(categoryOf(id)?.code).toBe("UP");
    const { results } = await db.prepare("SELECT category_name FROM (SELECT o.id, cat.name AS category_name FROM old_gold_items o LEFT JOIN old_gold_item_categories ogc ON ogc.item_id = o.id LEFT JOIN categories cat ON cat.id = ogc.category_id) WHERE id = ?").bind(id).all<{ category_name: string }>();
    expect(results?.[0]?.category_name).toBe("OLD GOLD UP");
  });

  it("refuses a category that is not an old gold category", async () => {
    const og = await import("./oldgold");
    await expect(
      og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", description: "Ring", grossG: 2, stoneG: 0, categoryId: "cat-ring" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
