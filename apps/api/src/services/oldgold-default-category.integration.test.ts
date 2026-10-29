// A shop with no old gold category gets the default one, OLD GOLD OG, on its first intake.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("default old gold category over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T | undefined;

  beforeAll(() => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
    `);
  });

  it("creates OLD GOLD OG and files the first piece under it", async () => {
    const og = await import("./oldgold");
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE name LIKE 'OLD GOLD%'")?.n).toBe(0);

    const first = await og.intakeItem(db, { shopOwned: true, branchId: "b1", grossG: 5, stoneG: 0 }, "u1");

    expect(one("SELECT name, code, is_active FROM categories WHERE name LIKE 'OLD GOLD%'")).toEqual({ name: "OLD GOLD OG", code: "OG", is_active: 1 });
    expect(one("SELECT c.code FROM old_gold_item_categories ic JOIN categories c ON c.id = ic.category_id WHERE ic.item_id = ?", first.id)).toEqual({
      code: "OG",
    });
  });

  it("files later pieces under the same category, without creating another", async () => {
    const og = await import("./oldgold");
    const second = await og.intakeItem(db, { shopOwned: true, branchId: "b1", grossG: 3, stoneG: 0 }, "u1");

    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE name LIKE 'OLD GOLD%'")?.n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_item_categories WHERE item_id = ?", second.id)?.n).toBe(1);
  });
});
