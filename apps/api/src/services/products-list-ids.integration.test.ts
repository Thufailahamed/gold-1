// Filtering pieces by an explicit id batch: the label station resolves a
// deep-linked batch in chunks, and must keep the same branch scope as the
// normal catalogue list.
import { beforeAll, describe, expect, it } from "vitest";
import { bulkCreateProductsSchema } from "@goldos/shared";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("products list by ids", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(() => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','i@x','Labels','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Kandy','KDY',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1');
    `);
  });

  it("returns only the requested pieces and keeps their details", async () => {
    const { createProductsBulk, listProducts } = await import("./products");
    const input = bulkCreateProductsSchema.parse({
      common: {
        categoryId: "cat-ring",
        metalTypeId: "metal-gold",
        purityId: "purity-22k",
        branchId: "b1",
        name: "Signet ring",
        makingLkr: 1500,
      },
      items: [{ grossG: 4.25 }, { grossG: 5.5 }, { grossG: 6.75 }],
    });
    const made = await createProductsBulk(db, input, "u1");
    const wanted = [made.products[0]!.id, made.products[2]!.id];

    const page = await listProducts(db, "u1", false, { page: 1, limit: 20, ids: wanted });

    expect(page.total).toBe(2);
    expect(page.rows.map((p) => p.id).sort()).toEqual([...wanted].sort());
    expect(page.rows.every((p) => p.barcode && p.category_name === "Ring")).toBe(true);
  });

  it("does not leak a piece outside the caller's branches", async () => {
    const { createProductsBulk, listProducts } = await import("./products");
    const input = bulkCreateProductsSchema.parse({
      common: {
        categoryId: "cat-chain",
        metalTypeId: "metal-gold",
        purityId: "purity-22k",
        branchId: "b2",
        name: "Kandy chain",
        makingLkr: 1000,
      },
      items: [{ grossG: 8 }],
    });
    const made = await createProductsBulk(db, input, "u1");
    const page = await listProducts(db, "u1", false, {
      page: 1,
      limit: 20,
      ids: [made.products[0]!.id],
    });
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
  });
});
