// Money paid out of the drawer as other expenses: it debits 6080 and credits
// the drawer, and it shows on the day close under its own label.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("other expenses paid from the drawer", () => {
  let db: D1Database;
  let raw: SqliteDb;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
    `);
  });

  it("posts to Other Expenses and credits the drawer", async () => {
    const { createCashEntry } = await import("./cashentries");
    const r = await createCashEntry(db, { branchId: "b1", kind: "OTHER_EXPENSE", amountCents: 45_000, method: "cash", note: "Tea and transport" }, "u1");

    const lines = raw
      .prepare(
        `SELECT l.account_code AS account, l.debit_cents AS debit, l.credit_cents AS credit
         FROM cash_entries c JOIN journal_lines l ON l.entry_id = c.journal_entry_id
         WHERE c.number = ? ORDER BY l.line_no`
      )
      .all(r.number) as { account: string; debit: number; credit: number }[];
    expect(lines).toEqual([
      { account: "6080", debit: 45_000, credit: 0 },
      { account: "1000", debit: 0, credit: 45_000 },
    ]);
  });

  it("is a money-out kind, so the bank can be the source too", async () => {
    const { createCashEntry } = await import("./cashentries");
    raw.exec(`INSERT INTO bank_accounts (id, name, account_code, branch_id, created_at) VALUES ('bk1','Main bank','1010','b1',0)`);
    await expect(
      createCashEntry(db, { branchId: "b1", kind: "OTHER_EXPENSE", amountCents: 1_000, method: "bank", bankAccountId: "bk1", note: "Bank fee" }, "u1")
    ).resolves.toMatchObject({ number: expect.any(String) });
  });
});
