// A tray of like pieces taken in at once, over real SQLite: every piece is a
// whole product with its own codes, movement, gold row and opening value, and
// a bad row or a closed day leaves nothing behind.
import { beforeAll, describe, expect, it } from "vitest";
import { bulkCreateProductsSchema } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("bulk product intake over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const n = (sql: string, ...args: unknown[]) => (raw.prepare(sql).get(...args) as { n: number }).n;
  const common = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1" };
  const parse = (body: unknown) => bulkCreateProductsSchema.parse(body);

  beforeAll(() => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','i@x','Inventory','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
    `);
  });

  it("takes in 25 rings that differ only by weight, each a full product", async () => {
    const { createProductsBulk } = await import("./products");
    const weights = Array.from({ length: 25 }, (_, i) => 3 + i * 0.125);
    const r = await createProductsBulk(
      db,
      parse({ common: { ...common, name: "Plain band", makingLkr: 1500, location: "Tray A" }, items: weights.map((grossG) => ({ grossG })) }),
      "u1"
    );
    expect(r.products).toHaveLength(25);
    expect(new Set(r.products.map((p) => p.barcode)).size).toBe(25);
    expect(new Set(r.products.map((p) => p.sku)).size).toBe(25);
    expect(r.totals.gross_mg).toBe(weights.reduce((a, g) => a + Math.round(g * 1000), 0));

    const ids = r.products.map((p) => p.id);
    const marks = ids.map(() => "?").join(",");
    const rows = raw.prepare(`SELECT name, gross_mg, making_cents, location, status, branch_id FROM products WHERE id IN (${marks})`).all(...ids) as {
      name: string; gross_mg: number; making_cents: number; location: string; status: string; branch_id: string;
    }[];
    expect(rows.every((p) => p.name === "Plain band" && p.making_cents === 150000 && p.location === "Tray A" && p.status === "IN_STOCK" && p.branch_id === "b1")).toBe(true);
    expect(n(`SELECT COUNT(*) AS n FROM stock_movements WHERE type = 'INTAKE' AND product_id IN (${marks})`, ...ids)).toBe(25);
    expect(n(`SELECT COUNT(*) AS n FROM gold_ledger WHERE type = 'OPENING' AND ref_entity = 'product_intake' AND ref_id IN (${marks})`, ...ids)).toBe(25);
    // Uncosted pieces carry no opening value.
    expect(n(`SELECT COUNT(*) AS n FROM journal_entries WHERE ref_entity = 'opening_stock' AND ref_id IN (${marks})`, ...ids)).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'product.bulk_create' AND entity_id = ?", r.batchId)).toBe(1);
  });

  it("lets a row override the shared fields and costs each piece on its own entry", async () => {
    const { createProductsBulk } = await import("./products");
    const r = await createProductsBulk(
      db,
      parse({
        common: { ...common, costLkr: 1000, sellingPriceLkr: 50000 },
        items: [
          { grossG: 4 },
          { grossG: 6, stoneG: 0.5, name: "Stone ring", costLkr: 2500, sellingPriceLkr: 90000, location: "Showcase 2" },
        ],
      }),
      "u1"
    );
    const [a, b] = r.products;
    // Blank name falls back to the category's.
    expect(a!.name).toBe((raw.prepare("SELECT name FROM categories WHERE id = 'cat-ring'").get() as { name: string }).name);
    expect(b).toMatchObject({ name: "Stone ring", net_mg: 5500, stone_mg: 500 });
    const pb = raw.prepare("SELECT cost_cents, selling_price_cents, location FROM products WHERE id = ?").get(b!.id);
    expect(pb).toEqual({ cost_cents: 250000, selling_price_cents: 9000000, location: "Showcase 2" });
    const { carriedOpeningValue } = await import("./openingstock");
    expect(await carriedOpeningValue(db, a!.id)).toBe(100000);
    expect(await carriedOpeningValue(db, b!.id)).toBe(250000);
    expect(r.totals.cost_cents).toBe(350000);
  });

  it("creates a typed subcategory once for the whole tray", async () => {
    const { createProductsBulk } = await import("./products");
    await createProductsBulk(
      db,
      parse({ common: { ...common, subcategoryName: "Kids rings" }, items: [{ grossG: 1 }, { grossG: 1.2 }, { grossG: 1.4 }] }),
      "u1"
    );
    expect(n("SELECT COUNT(*) AS n FROM subcategories WHERE lower(name) = 'kids rings'")).toBe(1);
    const names = (raw.prepare("SELECT DISTINCT p.name FROM products p JOIN subcategories s ON s.id = p.subcategory_id WHERE s.name = 'Kids rings'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(["Kids rings"]);
  });

  it("saves nothing when one row is bad, and names the row", async () => {
    const { createProductsBulk } = await import("./products");
    const before = n("SELECT COUNT(*) AS n FROM products");
    await expect(
      createProductsBulk(db, parse({ common, items: [{ grossG: 2 }, { grossG: 2 }, { grossG: 1, stoneG: 1 }] }), "u1")
    ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("Row 3") });
    expect(n("SELECT COUNT(*) AS n FROM products")).toBe(before);
  });

  it("refuses an inactive reference or unknown branch before writing anything", async () => {
    const { createProductsBulk } = await import("./products");
    const before = n("SELECT COUNT(*) AS n FROM products");
    await expect(createProductsBulk(db, parse({ common: { ...common, branchId: "nope" }, items: [{ grossG: 2 }] }), "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(n("SELECT COUNT(*) AS n FROM products")).toBe(before);
  });

  it("saves nothing into a closed day", async () => {
    const { createProductsBulk } = await import("./products");
    const { businessDateFor } = await import("./busdate");
    const today = await businessDateFor(db, Date.now());
    raw
      .prepare(
        `INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, report_json, checks_passed, status, closed_by, closed_at, created_at)
         VALUES ('dc1', 'b2', ?, 0, 0, 0, 0, 0, 0, '{}', 1, 'CLOSED', 'u1', 0, 0)`
      )
      .run(today);
    const before = n("SELECT COUNT(*) AS n FROM products");
    await expect(
      createProductsBulk(db, parse({ common: { ...common, branchId: "b2", costLkr: 100 }, items: [{ grossG: 2 }, { grossG: 3 }] }), "u1")
    ).rejects.toBeTruthy();
    expect(n("SELECT COUNT(*) AS n FROM products")).toBe(before);
  });

  it("caps a request at the bulk maximum and requires at least one piece", () => {
    expect(bulkCreateProductsSchema.safeParse({ common, items: [] }).success).toBe(false);
    expect(bulkCreateProductsSchema.safeParse({ common, items: Array.from({ length: 101 }, () => ({ grossG: 1 })) }).success).toBe(false);
    expect(bulkCreateProductsSchema.safeParse({ common, items: [{ grossG: 0 }] }).success).toBe(false);
  });
});
