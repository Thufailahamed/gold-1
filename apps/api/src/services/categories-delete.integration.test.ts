// Deleting a category over real SQLite: a category nothing points at goes, and
// is audited; one that products or other records use stays, and the caller is
// told to deactivate it instead.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("deleting categories over real SQLite", () => {
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
    const { createProduct } = await import("./products");
    await createProduct(
      db,
      { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", name: "Ring A", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000, grossG: 2 },
      "u1"
    );
  });

  const exists = (id: string) => raw.prepare("SELECT COUNT(*) AS n FROM categories WHERE id = ?").get(id) as { n: number };

  it("deletes a category nothing uses, and records the deletion", async () => {
    const { createCategory } = await import("./catalog");
    const { deleteCategory } = await import("./catalog");
    const made = await createCategory(db, { name: "Scratch", code: "SCR" }, "u1");
    expect(exists(made.id).n).toBe(1);
    await deleteCategory(db, made.id, "u1");
    expect(exists(made.id).n).toBe(0);
    const audit = raw.prepare("SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'category.delete'").get(made.id);
    expect(audit).toBeTruthy();
  });

  it("keeps a category that products use and says to deactivate it", async () => {
    const { deleteCategory } = await import("./catalog");
    await expect(deleteCategory(db, "cat-ring", "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(exists("cat-ring").n).toBe(1);
  });

  it("reports an unknown category as not found", async () => {
    const { deleteCategory } = await import("./catalog");
    await expect(deleteCategory(db, "no-such-category", "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
