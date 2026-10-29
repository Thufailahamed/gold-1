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
    const { id } = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", itemType: "chain", description: "Old chain", grossG, stoneG }, "u1");
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
    raw.exec("INSERT INTO categories (id, name, code, created_at) VALUES ('cat-og', 'OLD GOLD OG', 'OG', 0)");
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
    const other = await og.intakeItem(db, { needsTesting: true, customerId: "c2", branchId: "b1", itemType: "chain", description: "Other chain", grossG: 3, stoneG: 0 }, "u1");
    await expect(exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [other.id] }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });

    // Another branch.
    const v = await valued(5);
    const atB2 = exchangeSale(db, { ...base, customerId: "c1", oldGoldItemIds: [v.id], branchId: "b2", items: [] }, "u1");
    await expect(atB2).rejects.toMatchObject({ code: "VALIDATION" });

    // Untouched intake (RECEIVED, not VALUED).
    const fresh = await og.intakeItem(db, { needsTesting: true, customerId: "c1", branchId: "b1", itemType: "chain", description: "Fresh chain", grossG: 3, stoneG: 0 }, "u1");
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

  it("leaves the old-gold credit leg out of the invoice's payments, so it reads as old gold, not credit", async () => {
    const { exchangeSale } = await import("./exchange");
    const { getSale } = await import("./sales");
    const v = await valued(5);
    const ring = await product("Ring Y");
    const x = await exchangeSale(
      db,
      { customerId: "c1", branchId: "b1", oldGoldItemIds: [v.id], items: [{ productId: ring, discountLkr: 0 }], payments: [], payout: "cash" },
      "u1"
    );
    // The stored bill still carries the offset as a credit leg, so the ledger and
    // the paid total stay right; the invoice view just does not list it as credit.
    const stored = one<{ n: number }>("SELECT COUNT(*) AS n FROM sales_payments WHERE invoice_id = ? AND method = 'credit' AND account_code = '1200'", x.invoiceId);
    expect(stored.n).toBe(1);
    const detail = await getSale(db, x.invoiceId);
    expect(detail.payments).toEqual([]);
    expect(detail.oldGoldExchange).toMatchObject({ valueCents: x.oldGoldValueCents, paidOutCents: x.shopPaysCents });
  });

  it("records old gold taken in with the sale, in the same batch as the sale", async () => {
    const { exchangeSale } = await import("./exchange");
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n;
    const ring = await product("Ring X");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [{ grossG: 4, valueLkr: 20_000 }],
        items: [{ productId: ring, discountLkr: 0 }],
        // 50,000 bill less 20,000 old gold: the customer pays the 30,000 balance.
        payments: [{ method: "cash", amountLkr: 30_000 }],
        payout: "cash",
      },
      "u1"
    );
    expect(x).toMatchObject({ oldGoldValueCents: 2_000_000, customerPaysCents: 3_000_000, shopPaysCents: 0 });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n).toBe(before + 1);
    // The new piece is bought on this invoice, at the amount typed, with a passing test on record.
    const item = one<{ number: string; status: string; purchase_value_cents: number; tested_permille: number }>(
      "SELECT oi.number, oi.status, oi.purchase_value_cents, oi.tested_permille FROM old_gold_items oi JOIN old_gold_purchases og ON og.item_id = oi.id WHERE og.sales_invoice_id = ?",
      x.invoiceId
    );
    expect(item).toMatchObject({ status: "PURCHASED", purchase_value_cents: 2_000_000, tested_permille: 916 });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_tests WHERE item_id = (SELECT id FROM old_gold_items WHERE number = ?) AND result = 'pass'", item.number).n).toBe(1);
  });

  it("records every piece taken in with the sale, each at its own amount", async () => {
    const { exchangeSale } = await import("./exchange");
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n;
    const ring = await product("Ring Multi");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [
          { grossG: 4, valueLkr: 20_000 },
          { grossG: 2.5, valueLkr: 9_500 },
          { grossG: 1, valueLkr: 3_000 },
        ],
        items: [{ productId: ring, discountLkr: 0 }],
        // 50,000 bill less 32,500 of old gold: the customer pays the 17,500 balance.
        payments: [{ method: "cash", amountLkr: 17_500 }],
        payout: "cash",
      },
      "u1"
    );
    expect(x).toMatchObject({ oldGoldValueCents: 3_250_000, customerPaysCents: 1_750_000, shopPaysCents: 0 });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n).toBe(before + 3);
    const bought = raw
      .prepare("SELECT oi.net_mg, oi.purchase_value_cents FROM old_gold_items oi JOIN old_gold_purchases og ON og.item_id = oi.id WHERE og.sales_invoice_id = ? ORDER BY oi.net_mg DESC")
      .all(x.invoiceId) as { net_mg: number; purchase_value_cents: number }[];
    expect(bought).toEqual([
      { net_mg: 4000, purchase_value_cents: 2_000_000 },
      { net_mg: 2500, purchase_value_cents: 950_000 },
      { net_mg: 1000, purchase_value_cents: 300_000 },
    ]);
  });

  it("files a piece taken in at the till under the category chosen", async () => {
    const { exchangeSale } = await import("./exchange");
    raw.exec("INSERT INTO categories (id, name, code, created_at) VALUES ('cat-up', 'OLD GOLD UP', 'UP', 0)");
    const ring = await product("Ring Z");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [{ grossG: 2, valueLkr: 10_000, categoryId: "cat-up" }],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 40_000 }],
        payout: "cash",
      },
      "u1"
    );
    const cat = one<{ code: string }>(
      "SELECT cat.code FROM old_gold_purchases og JOIN old_gold_item_categories ogc ON ogc.item_id = og.item_id JOIN categories cat ON cat.id = ogc.category_id WHERE og.sales_invoice_id = ?",
      x.invoiceId
    );
    expect(cat?.code).toBe("UP");
  });

  it("the old gold goes to the bill first, and the credit left over settles the customer's open bills", async () => {
    const { exchangeSale } = await import("./exchange");
    const { receiveSale } = await import("./sales");
    raw.exec("INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c9','Open Bills','0779999999','b1',0)");
    // An open credit bill of 50,000 for c9.
    const old = await product("Old bill item");
    const bill = await receiveSale(
      db,
      { customerId: "c9", branchId: "b1", items: [{ productId: old, discountLkr: 0 }], payments: [{ method: "credit", amountLkr: 50_000 }] },
      "u1",
      { enforceShelfPrice: true }
    );
    // 60,000 of old gold: 50,000 pays the new bill, and the 10,000 left over is credit that settles the open bill.
    const fresh = await product("New bill item");
    const x = await exchangeSale(
      db,
      {
        customerId: "c9",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [{ grossG: 3, valueLkr: 60_000 }],
        items: [{ productId: fresh, discountLkr: 0 }],
        payments: [],
        payout: "store_credit",
      },
      "u1"
    );
    expect(x).toMatchObject({ oldGoldValueCents: 6_000_000, creditedOpenCents: 1_000_000, shopPaysCents: 0, customerPaysCents: 0 });
    expect(one<{ status: string; paid_cents: number }>("SELECT status, paid_cents FROM sales_invoices WHERE id = ?", bill.invoiceId)).toEqual({
      status: "PARTIAL",
      paid_cents: 1_000_000,
    });
  });

  it("records a piece taken in at the till the way the intake desk does, with its description", async () => {
    const { exchangeSale } = await import("./exchange");
    const ring = await product("Ring Y");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [{ grossG: 2, valueLkr: 10_000, description: "Rope chain, broken clasp" }],
        items: [{ productId: ring, discountLkr: 0 }],
        payments: [{ method: "cash", amountLkr: 40_000 }],
        payout: "cash",
      },
      "u1"
    );
    const item = one<{ id: string; description: string; item_type: string; status: string }>(
      "SELECT oi.id, oi.description, oi.item_type, oi.status FROM old_gold_items oi JOIN old_gold_purchases og ON og.item_id = oi.id WHERE og.sales_invoice_id = ?",
      x.invoiceId
    );
    expect(item).toMatchObject({ description: "Rope chain, broken clasp", item_type: "Old gold", status: "PURCHASED" });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'oldgold.intake' AND entity_id = ?", item.id).n).toBe(1);
  });

  it("leaves no old-gold piece behind when the sale it belongs to is refused", async () => {
    const { exchangeSale } = await import("./exchange");
    const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n;
    await expect(
      exchangeSale(
        db,
        {
          customerId: "c1",
          branchId: "b1",
          oldGoldItemIds: [],
          newOldGold: [{ grossG: 3, valueLkr: 15_000 }],
          items: [{ productId: "no-such-piece", discountLkr: 0 }],
          payments: [{ method: "cash", amountLkr: 35_000 }],
          payout: "cash",
        },
        "u1"
      )
    ).rejects.toThrow();
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM old_gold_items").n).toBe(before);
  });

  it("refuses an exchange with neither old gold ticked nor taken in", async () => {
    const { exchangeSale } = await import("./exchange");
    const ring = await product("Ring Empty");
    await expect(
      exchangeSale(db, { customerId: "c1", branchId: "b1", oldGoldItemIds: [], newOldGold: [], items: [{ productId: ring, discountLkr: 0 }], payments: [], payout: "cash" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("puts the part of the balance not paid now on the customer's credit, and the invoice stays open", async () => {
    const { exchangeSale } = await import("./exchange");
    const before = balanceC1();
    const ring = await product("Ring Credit");
    const x = await exchangeSale(
      db,
      {
        customerId: "c1",
        branchId: "b1",
        oldGoldItemIds: [],
        newOldGold: [{ grossG: 4, valueLkr: 20_000 }],
        items: [{ productId: ring, discountLkr: 0 }],
        // 50,000 bill less 20,000 old gold: 10,000 paid now, 20,000 on credit.
        payments: [
          { method: "cash", amountLkr: 10_000 },
          { method: "credit", amountLkr: 20_000 },
        ],
        payout: "cash",
      },
      "u1"
    );
    expect(x).toMatchObject({ customerPaysCents: 3_000_000 });
    // The customer now owes the credit part on their account.
    expect(balanceC1() - before).toBe(2_000_000);
    const inv = one<{ status: string; paid_cents: number; total_cents: number }>(
      "SELECT status, paid_cents, total_cents FROM sales_invoices WHERE id = ?",
      x.invoiceId
    );
    expect(inv.status).toBe("PARTIAL");
    // Cash plus the old gold are what has settled the bill; the credit part is still owed.
    expect(inv.paid_cents).toBe(3_000_000);
    expect(inv.total_cents).toBe(5_000_000);
    expect(Object.values(await checks()).every(Boolean)).toBe(true);
  });
});
