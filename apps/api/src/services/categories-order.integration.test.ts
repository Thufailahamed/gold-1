// The category list reads alphabetically by name, ignoring case, across pages.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("category list order over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);`);
  });

  it("lists categories by name, ignoring case, not by when they were added", async () => {
    const { createCategory, listCategories } = await import("./catalog");
    await createCategory(db, { name: "bracelet", code: "BRS" }, "u1");
    await createCategory(db, { name: "Anklet", code: "ANK" }, "u1");
    await createCategory(db, { name: "zircon", code: "ZIR" }, "u1");
    const { rows } = await listCategories(db, { page: 1, limit: 100, search: "" } as never);
    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(names.indexOf("Anklet")).toBeLessThan(names.indexOf("bracelet"));
    expect(names.indexOf("bracelet")).toBeLessThan(names.indexOf("zircon"));
  });
});
