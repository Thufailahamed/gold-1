// Old gold the shop already holds, recorded without a seller: it goes straight
// to the shelf at cost, the gold ledger and the books carry it, and it cannot
// be bought from anyone.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("shop-owned old gold over real SQLite", () => {
  let raw: SqliteDb;
  let db: D1Database;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T | undefined;

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

  it("records the shelf stock with no customer, AVAILABLE, at its cost", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { shopOwned: true, branchId: "b1", purityId: "purity-22k", grossG: 10, stoneG: 1, costLkr: 80000 }, "u1");
    const item = one<{ customer_id: string; status: string; net_mg: number; fine_mg: number; purchase_value_cents: number }>(
      "SELECT customer_id, status, net_mg, fine_mg, purchase_value_cents FROM old_gold_items WHERE id = ?",
      id
    );
    expect(item).toMatchObject({ customer_id: "shop-stock", status: "AVAILABLE", net_mg: 9000, fine_mg: 8244, purchase_value_cents: 8000000 });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE old_gold_id = ? AND type = 'OPENING'", id)?.n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_movements WHERE old_gold_id = ? AND direction = 'IN'", id)?.n).toBe(1);
    // Booked at cost: 1100 Dr and 3100 Cr for the same amount, in one balanced entry.
    const books = one<{ dr: number; cr: number }>(
      "SELECT SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.ref_entity = 'old_gold_shop' AND e.ref_id = ?",
      id
    );
    expect(books).toMatchObject({ dr: 8000000, cr: 8000000 });
  });

  it("takes a shop-owned piece with no cost or karat, and refuses a testing request", async () => {
    const og = await import("./oldgold");
    await expect(
      og.intakeItem(db, { shopOwned: true, branchId: "b1", grossG: 2, stoneG: 0 }, "u1")
    ).resolves.toMatchObject({ number: expect.any(String) });
    await expect(
      og.intakeItem(db, { shopOwned: true, needsTesting: true, branchId: "b1", grossG: 2, stoneG: 0, costLkr: 1000 }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a customer-less intake that is not marked as shop-owned", async () => {
    const og = await import("./oldgold");
    await expect(
      og.intakeItem(db, { branchId: "b1", purityId: "purity-22k", grossG: 2, stoneG: 0 }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cannot be bought from a seller", async () => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { shopOwned: true, branchId: "b1", purityId: "purity-22k", grossG: 4, stoneG: 0, costLkr: 30000 }, "u1");
    await expect(og.purchaseItem(db, id, { paidLkr: 1000, method: "cash" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
