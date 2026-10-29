// Piece barcodes over real SQLite: each one is the category's code, "AA", then
// a number that counts up within that category, in order, whether the piece is
// entered one at a time or as a tray.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("piece barcodes over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r1','purity-22k', 2500000, 1, 1);
    `);
  });

  const base = { metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 };

  it("gives one piece the category code, AA and the next number", async () => {
    const { createProduct } = await import("./products");
    const p = await createProduct(db, { ...base, categoryId: "cat-ring", name: "Ring A", grossG: 2 }, "u1");
    expect(p.barcode).toBe("RING-AA-0001");
    const q = await createProduct(db, { ...base, categoryId: "cat-ring", name: "Ring B", grossG: 2 }, "u1");
    expect(q.barcode).toBe("RING-AA-0002");
  });

  it("numbers each category on its own counter", async () => {
    const { createProduct } = await import("./products");
    const c = await createProduct(db, { ...base, categoryId: "cat-chain", name: "Chain A", grossG: 3 }, "u1");
    expect(c.barcode).toBe("CHAIN-AA-0001");
  });

  it("continues the same order for a tray entered at once", async () => {
    const { createProductsBulk } = await import("./products");
    const tray = await createProductsBulk(
      db,
      { common: { ...base, categoryId: "cat-ring" }, items: [{ grossG: 2 }, { grossG: 2 }, { grossG: 2 }] },
      "u1"
    );
    expect(tray.products.map((p) => p.barcode)).toEqual(["RING-AA-0003", "RING-AA-0004", "RING-AA-0005"]);
  });

  it("previews the barcode the next piece will get, without taking it", async () => {
    const { nextCategoryBarcode, createProduct } = await import("./products");
    expect(await nextCategoryBarcode(db, "cat-ring")).toBe("RING-AA-0006");
    expect(await nextCategoryBarcode(db, "cat-ring")).toBe("RING-AA-0006");
    const { nextCategoryBarcodes } = await import("./products");
    const preview = await nextCategoryBarcodes(db, "cat-ring", 3);
    expect(preview).toEqual(["RING-AA-0006", "RING-AA-0007", "RING-AA-0008"]);
    const p = await createProduct(db, { ...base, categoryId: "cat-ring", name: "Ring C", grossG: 2 }, "u1");
    expect(p.barcode).toBe("RING-AA-0006");
  });

  it("moves to the next letter pair after 9999, and the preview follows", async () => {
    const { createProduct, nextCategoryBarcode } = await import("./products");
    raw.exec("UPDATE counters SET next = 9999 WHERE name = 'BARCODE:cat-chain'");
    expect(await nextCategoryBarcode(db, "cat-chain")).toBe("CHAIN-AA-9999");
    const last = await createProduct(db, { ...base, categoryId: "cat-chain", name: "Chain 9999", grossG: 3 }, "u1");
    expect(last.barcode).toBe("CHAIN-AA-9999");
    expect(await nextCategoryBarcode(db, "cat-chain")).toBe("CHAIN-AB-0001");
    const next = await createProduct(db, { ...base, categoryId: "cat-chain", name: "Chain next", grossG: 3 }, "u1");
    expect(next.barcode).toBe("CHAIN-AB-0001");
  });

  it("keeps every barcode unique, and the scan lookup finds the piece by it", async () => {
    const { findByBarcode } = await import("./products");
    const found = await findByBarcode(db, "RING-AA-0002");
    expect(found.product).toMatchObject({ barcode: "RING-AA-0002", name: "Ring B" });
    const dupes = raw.prepare("SELECT COUNT(*) AS n FROM (SELECT barcode FROM products GROUP BY barcode HAVING COUNT(*) > 1)").get() as { n: number };
    expect(dupes.n).toBe(0);
  });
});
