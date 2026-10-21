// Part-credit sale, later receipt and old-for-new exchange, then what day
// close and the receivables ledger make of them.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("sale flows in day close and accounts", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let today: string;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T;

  const product = async (name: string) => {
    const { createProduct } = await import("./products");
    const p = await createProduct(
      db,
      { name, categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", grossG: 2, stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 },
      "u1"
    );
    raw.exec(`UPDATE products SET selling_price_cents = 5000000 WHERE id = '${p.id}'`);
    return p.id;
  };

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec("INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0)");
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
  });

  it("books cash now, credit for the rest, a later receipt and an exchange payout", async () => {
    const { receiveSale } = await import("./sales");
    const { createReceipt, listReceivables } = await import("./receipts");
    const { exchangeSale } = await import("./exchange");
    const { buildClosingReport } = await import("./dayclose");

    // 50,000 sale: 20,000 cash now, 30,000 on credit.
    const a = await product("Ring A");
    const sale = await receiveSale(
      db,
      { customerId: "c1", branchId: "b1", items: [{ productId: a, discountLkr: 0 }], payments: [{ method: "cash", amountLkr: 20000 }, { method: "credit", amountLkr: 30000 }] },
      "u1",
      { enforceShelfPrice: true }
    );
    expect(one<{ status: string; paid_cents: number }>("SELECT status, paid_cents FROM sales_invoices WHERE id = ?", sale.invoiceId)).toEqual({ status: "PARTIAL", paid_cents: 2_000_000 });

    // 10,000 collected later.
    await createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 1_000_000, method: "cash" }, "u1");
    expect(one<{ status: string; paid_cents: number }>("SELECT status, paid_cents FROM sales_invoices WHERE id = ?", sale.invoiceId)).toEqual({ status: "PARTIAL", paid_cents: 3_000_000 });
    const rec = await listReceivables(db, { branchId: "b1", asOf: today });
    expect(rec.totalCents).toBe(2_000_000);

    // Exchange: old gold worth 131,100 against a 50,000 piece, 81,100 paid out in cash.
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", itemType: "chain", description: "Old chain", grossG: 5, stoneG: 0 }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    const b = await product("Ring B");
    const x = await exchangeSale(db, { customerId: "c1", branchId: "b1", oldGoldItemIds: [id], items: [{ productId: b, discountLkr: 0 }], payments: [], payout: "cash" }, "u1");
    expect(x.shopPaysCents).toBe(8_110_000);

    // The open bill is untouched: the old gold went to the new bill and the surplus was paid out.
    expect((await listReceivables(db, { branchId: "b1", asOf: today })).totalCents).toBe(2_000_000);

    // Day close: 20,000 + 10,000 in, 81,100 out; nothing unclassified; checks pass.
    const r = await buildClosingReport(db, { branchId: "b1", date: today });
    expect(r.cashIn.totalCents).toBe(3_000_000);
    expect(r.cashOut.totalCents).toBe(8_110_000);
    expect(r.cashIn.unclassifiedNetCents).toBe(0);
    expect(r.closing.expectedCents).toBe(3_000_000 - 8_110_000);
    expect(r.checks.failing).toEqual([]);
  });

  it("balances the drawer after an employee and the owner take cash", async () => {
    const { createCashEntry } = await import("./cashentries");
    const { buildClosingReport, closeDay } = await import("./dayclose");
    await expect(
      createCashEntry(db, { branchId: "b1", kind: "STAFF_TAKE", amountCents: 100_000, method: "cash", note: "advance" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" }); // an employee must be named
    await createCashEntry(db, { branchId: "b1", kind: "STAFF_TAKE", amountCents: 100_000, method: "cash", person: "Kamal", note: "salary advance" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "OWNER_DRAWING", amountCents: 50_000, method: "cash", note: "personal" }, "u1");

    // Top the drawer up for the cash the employee and owner take.
    await createCashEntry(db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 20_000_000, method: "cash", note: "float" }, "u1");
    const before = 3_000_000 - 8_110_000 + 20_000_000;
    const r = await buildClosingReport(db, { branchId: "b1", date: today });
    expect(r.cashOut.totalCents).toBe(8_110_000 + 150_000);
    expect(r.cashIn.totalCents).toBe(3_000_000 + 20_000_000);
    expect(r.cashOut.lines.map((l) => l.label)).toEqual(expect.arrayContaining(["Staff took money", "Owner took money out"]));
    expect(r.cashIn.unclassifiedNetCents).toBe(0);
    expect(r.closing.expectedCents).toBe(before - 150_000);
    expect(r.checks.failing).toEqual([]);

    // Counting exactly the expected cash closes with no difference.
    const closed = await closeDay(db, { branchId: "b1", date: today, actualCents: before - 150_000 }, "u1");
    expect(closed.report.closing.differenceCents).toBe(0);
  });
});
