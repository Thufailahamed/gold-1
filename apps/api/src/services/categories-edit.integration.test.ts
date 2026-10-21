// Editing categories over real SQLite: a rename keeps the same record (and the
// products under it), a name or code another category uses is refused, and a
// deactivated category can be turned back on.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("editing categories over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);`);
  });

  const row = (id: string) =>
    raw.prepare("SELECT name, code, is_active FROM categories WHERE id = ?").get(id) as { name: string; code: string; is_active: number };

  it("renames a category and changes its code, keeping the record", async () => {
    const { updateCategory } = await import("./catalog");
    await updateCategory(db, "cat-ring", { name: "Ladies Ring", code: "RIN" }, "u1");
    expect(row("cat-ring")).toMatchObject({ name: "Ladies Ring", code: "RIN" });
    const audit = raw.prepare("SELECT action FROM audit_logs WHERE entity_id = 'cat-ring' AND action = 'category.update'").get();
    expect(audit).toBeTruthy();
  });

  it("refuses a name or code another category already uses", async () => {
    const { updateCategory } = await import("./catalog");
    await expect(updateCategory(db, "cat-ring", { name: "Chain", code: "RIN" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateCategory(db, "cat-ring", { name: "Ladies Ring", code: "CHAIN" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(row("cat-ring")).toMatchObject({ name: "Ladies Ring", code: "RIN" });
  });

  it("turns a deactivated category back on", async () => {
    const { deactivateCategory, reactivateCategory } = await import("./catalog");
    await deactivateCategory(db, "cat-bangle", "u1", "testing");
    expect(row("cat-bangle").is_active).toBe(0);
    await reactivateCategory(db, "cat-bangle", "u1");
    expect(row("cat-bangle").is_active).toBe(1);
  });

  it("reports an unknown category as not found", async () => {
    const { updateCategory, reactivateCategory } = await import("./catalog");
    await expect(updateCategory(db, "no-such", { name: "X", code: "X" }, "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reactivateCategory(db, "no-such", "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
