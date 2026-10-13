// The old-for-new exchange over real SQLite: valued old gold bought back and
// settled against a new sale in one atomic batch, with the difference paid
// by the customer or by the shop — and the books staying balanced either way.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("old-for-new exchange over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let today: string;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T;

  const checks = async () => {
    const { reconcile } = await import("./reconcile");
    const r = await reconcile(db, { date: today, branchId: "b1" });
    return Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
  };
  /** Intake → test → value one old-gold item; 22K board 28,500 LKR/g, 92% buy. */
  const valued = async (grossG = 5, stoneG = 0) => {
    const og = await import("./oldgold");
    const { id } = await og.intakeItem(db, { customerId: "c1", branchId: "b1", itemType: "chain", description: "Old chain", grossG, stoneG }, "u1");
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    return { id, ...v };
  };
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

  const balanceC1 = () =>
    one<{ n: number }>("SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS n FROM journal_lines WHERE account_code='1200' AND party_id='c1'").n;

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','East','EAST',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0), ('c2','Kamala','0772222222','b1',0);
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES ('r22','purity-22k',2850000,0,0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
  });

  it("pays the customer the surplus out of the drawer when the old gold wins", async () => {
    const { exchangeSale } = await import("./exchange");
    const v = await valued(5); // 129,100 LKR
    const ring = await product("Ring A");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [v.id],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [],
        payout: "cash",
      },
      "u1"
    );
    // 131,100 − 50,000 = 81,100 LKR handed back over the counter.
    expect(x).toMatchObject({ oldGoldValueCents: 13_110_000, saleTotalCents: 5_000_000, shopPaysCents: 8_110_000, customerPaysCents: 0 });

    // The bill is settled by the offset; the customer's ledger nets to zero.
    const inv = one<{ status: string; paid_cents: number; total_cents: number; store_credit_cents: number }>(
      "SELECT status, paid_cents, total_cents, store_credit_cents FROM sales_invoices WHERE id = ?",
      x.invoiceId
    );
    expect(inv).toMatchObject({ status: "PAID", paid_cents: 5_000_000, store_credit_cents: 5_000_000 });
    expect(one<{ n: number }>("SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS n FROM journal_lines WHERE account_code='1200' AND party_id='c1'", ).n).toBe(0);

    const purchase = one<{ paid_cents: number; method: string; sales_invoice_id: string; journal_entry_id: string }>(
      "SELECT paid_cents, method, sales_invoice_id, journal_entry_id FROM old_gold_purchases WHERE item_id = ?",
      v.id
    );
    expect(purchase).toMatchObject({ paid_cents: 8_110_000, method: "cash", sales_invoice_id: x.invoiceId });
    expect(purchase.journal_entry_id).toBeTruthy();
    expect(one<{ status: string; paid_cents: number }>("SELECT status, paid_cents FROM old_gold_items WHERE id = ?", v.id)).toEqual({
      status: "PURCHASED",
      paid_cents: 8_110_000,
    });

    const lines = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.ref_entity='old_gold_purchase' AND e.ref_id = (SELECT id FROM old_gold_purchases WHERE item_id = ?)",
      v.id
    );
    expect(lines.n).toBe(3);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE type='OLD_GOLD_PURCHASE' AND old_gold_id = ?", v.id).n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE type='SALE' AND ref_entity='sale_invoice' AND ref_id = ?", x.invoiceId).n).toBe(1);

    const c = await checks();
    expect(Object.entries(c).filter(([, pass]) => !pass)).toEqual([]);
  });

  it("takes the difference from the customer when the new items win", async () => {
    const { exchangeSale } = await import("./exchange");
    const v = await valued(1); // 26,220 LKR (1g × 28,500 × 92%)
    const ring = await product("Ring B");
    const wrong = exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [v.id],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 10000 }],
        payout: "cash",
      },
      "u1"
    );
    await expect(wrong).rejects.toMatchObject({ code: "VALIDATION" });

    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [v.id],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 23780 }],
        payout: "cash",
      },
      "u1"
    );
    // 50,000 − 26,220 = 23,780 LKR taken at the till.
    expect(x).toMatchObject({ customerPaysCents: 2_378_000, shopPaysCents: 0 });
    expect(one<{ status: string }>("SELECT status FROM sales_invoices WHERE id = ?", x.invoiceId)).toEqual({ status: "PAID" });
    expect(one<{ n: number }>("SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS n FROM journal_lines WHERE account_code='1200' AND party_id='c1'").n).toBe(0);
    // Nothing left the drawer for the old gold itself.
    expect(one<{ paid_cents: number }>("SELECT paid_cents FROM old_gold_purchases WHERE item_id = ?", v.id).paid_cents).toBe(0);

    const c = await checks();
    expect(Object.entries(c).filter(([, pass]) => !pass)).toEqual([]);
  });

  it("can leave the surplus as store credit instead of cash", async () => {
    const { exchangeSale } = await import("./exchange");
    const v = await valued(5);
    const ring = await product("Ring C");
    const before = balanceC1();
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [v.id],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [],
        payout: "store_credit",
      },
      "u1"
    );
    expect(x.shopPaysCents).toBe(0);
    // The shop owes the customer 81,100 LKR more than before — explained by the old_gold_purchase ref.
    expect(balanceC1() - before).toBe(-8_110_000);
    expect(one<{ status: string }>("SELECT status FROM sales_invoices WHERE id = ?", x.invoiceId)).toEqual({ status: "PAID" });

    const c = await checks();
    expect(Object.entries(c).filter(([, pass]) => !pass)).toEqual([]);
  });

  it("settles an exact-value exchange with no money moving", async () => {
    const { exchangeSale } = await import("./exchange");
    const v = await valued(5); // 129,100
    const p1 = await product("Ring D");
    const p2 = await product("Ring E");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [v.id],
        // Ring at shelf 50,000 plus one negotiated up to close the gap exactly:
        // 50,000 + 81,100 = 131,100 = the old gold's value.
        items: [{ productId: p1, discountLkr: 0 }, { productId: p2, priceLkr: 81100, listPriceLkr: 50000, discountLkr: 0 }],
        payments: [],
        payout: "cash",
      },
      "u1"
    );
    expect(x).toMatchObject({ customerPaysCents: 0, shopPaysCents: 0 });
    expect(one<{ status: string }>("SELECT status FROM sales_invoices WHERE id = ?", x.invoiceId)).toEqual({ status: "PAID" });
    expect(balanceC1()).toBe(-8_110_000); // unchanged: the exact exchange moved no money
  });

  it("refuses an exchange that is not the valued offer", async () => {
    const { exchangeSale } = await import("./exchange");
    const ring = await product("Ring F");
    const base = { branchId: "b1", items: [{ productId: ring, discountLkr: 0 }], payments: [] as { method: "cash"; amountLkr: number }[], payout: "cash" as const };

    // Another customer's item.
    const og = await import("./oldgold");
    const other = await og.intakeItem(db, { customerId: "c2", branchId: "b1", itemType: "chain", description: "Other chain", grossG: 3, stoneG: 0 }, "u1");
    await expect(exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [other.id] }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });

    // Another branch.
    const v = await valued(5);
    const atB2 = exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [v.id], branchId: "b2", items: [] }, "u1");
    await expect(atB2).rejects.toMatchObject({ code: "VALIDATION" });

    // Untouched intake (RECEIVED, not VALUED).
    const fresh = await og.intakeItem(db, { customerId: "c1", branchId: "b1", itemType: "chain", description: "Fresh chain", grossG: 3, stoneG: 0 }, "u1");
    await expect(exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [fresh.id] }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });

    // Same item twice in one exchange.
    await expect(exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [v.id, v.id] }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("buys an exchanged item once when two tills submit together", async () => {
    const { exchangeSale } = await import("./exchange");
    const v = await valued(5);
    const ring = await product("Ring G");
    const input = { customerId: "c1", branchId: "b1", oldGoldItemIds: [v.id], items: [{ productId: ring, discountLkr: 0 }], payments: [] as [], payout: "cash" as const };
    const results = await Promise.allSettled([
      exchangeSale(db, { ...input, items: [{ productId: ring, discountLkr: 0 }] }, "u1"),
      exchangeSale(db, { ...input, items: [{ productId: ring, discountLkr: 0 }] }, "u1"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    // Exactly one purchase row survived; the loser rolled back whole.
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_purchases WHERE item_id = ?", v.id).n).toBe(1);
  });

  it("shows the exchanged old gold on the invoice", async () => {
    const { getSale } = await import("./sales");
    const latest = one<{ id: string }>("SELECT id FROM sales_invoices ORDER BY created_at DESC LIMIT 1");
    const detail = await getSale(db, latest.id);
    expect(detail.oldGoldExchange).not.toBeNull();
    // The latest exchange is the race test's winner: 131,100 old gold against
    // a 50,000 bill, the surplus paid out of the drawer.
    expect(detail.oldGoldExchange!.items[0]).toMatchObject({ paid_cents: 8_110_000 });
    expect(detail.oldGoldExchange!.valueCents).toBe(13_110_000);
  });
});
