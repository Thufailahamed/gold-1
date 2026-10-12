// The old-gold desk end to end, over real SQLite: intake → test → value →
// purchase → release → melt (or convert), with the books and the gold ledger
// checked at every step that posts.
import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb, sqliteAvailable, type SqliteDb } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("old gold lifecycle over real SQLite", () => {
  let db: D1Database;
  let raw: SqliteDb;
  let today: string;
  const one = <T>(sql: string, ...v: unknown[]) => raw.prepare(sql).get(...v) as T;

  const checks = async () => {
    const { reconcile } = await import("./reconcile");
    const r = await reconcile(db, { date: today, branchId: "b1" });
    return Object.fromEntries(r.checks.map((c) => [c.id, c.pass]));
  };
  const intake = async (grossG = 5, stoneG = 0) => {
    const og = await import("./oldgold");
    return og.intakeItem(db, { customerId: "c1", branchId: "b1", itemType: "chain", description: "Old chain", grossG, stoneG }, "u1");
  };
  const bought = async (paidLkr: number) => {
    const og = await import("./oldgold");
    const { id } = await intake();
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    await og.purchaseItem(db, id, { paidLkr, method: "cash" }, "u1");
    return { id, ...v };
  };

  beforeAll(async () => {
    ({ db, raw } = migratedDb());
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0), ('u2','m@x','Manager','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner'), ('u2','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO branch_members (user_id, branch_id) VALUES ('u1','b1'), ('u2','b1');
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      -- 22K board 28,500 LKR/g; 24K 31,000 LKR/g. No 18K/21K rate posted.
      INSERT INTO gold_rates (id, purity_id, rate_cents_per_g, effective_from, created_at) VALUES
        ('r22','purity-22k',2850000,0,0), ('r24','purity-24k',3100000,0,0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
  });

  it("values at the board rate of the item's own purity (no double purity discount)", async () => {
    const og = await import("./oldgold");
    // Spec example: 5g 22K, board 28,500, buy 92%, 2,000 processing.
    const v = og.valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, ratePermille: 916, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 200000 });
    expect(v.fineMg).toBe(4580);
    // 5g × 28,500 × 92% − 2,000 = 129,100 LKR — what the shop sells 5g of 22K for, at 92%.
    expect(v.valueCents).toBe(12910000);
  });

  it("walks one item from intake to purchase with balanced books and gold", async () => {
    const og = await import("./oldgold");
    const { id, number } = await intake(5.2, 0.2);
    expect(number).toMatch(/^OG-\d{6}$/);

    // A failed reading is kept, but the item cannot be valued on it.
    await og.recordTest(db, id, { method: "touchstone", permille: 916, result: "fail" }, "u1");
    expect(one<{ status: string; tested_permille: number | null }>("SELECT status, tested_permille FROM old_gold_items WHERE id = ?", id)).toEqual({ status: "RECEIVED", tested_permille: null });
    await expect(og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass", approvedBy: "nobody" }, "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass", approvedBy: "u1" }, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass", approvedBy: "u2" }, "u1");

    const v = await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 2000 }, "u1");
    expect(v).toEqual({ fineMg: 4580, valueCents: 12910000 });

    await og.purchaseItem(db, id, { paidLkr: 100000, method: "cash" }, "u1");
    const item = one<{ status: string; paid_cents: number }>("SELECT status, paid_cents FROM old_gold_items WHERE id = ?", id);
    expect(item).toEqual({ status: "PURCHASED", paid_cents: 10000000 });

    const detail = await og.getItem(db, id);
    const lines = detail.journal as { account_code: string; debit_cents: number; credit_cents: number }[];
    expect(lines.map((l) => [l.account_code, l.debit_cents, l.credit_cents])).toEqual([
      ["1100", 12910000, 0],
      ["1000", 0, 10000000],
      ["1200", 0, 2910000],
    ]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE type = 'OLD_GOLD_PURCHASE' AND old_gold_id = ? AND fine_mg = 4580", id).n).toBe(1);

    const c = await checks();
    expect([c.entry_balance, c.trial_balance, c.gold_stock_consistency]).toEqual([true, true, true]);
  });

  it("buys an item once when two tills submit together", async () => {
    const og = await import("./oldgold");
    const { id } = await intake();
    await og.recordTest(db, id, { method: "xrf", permille: 916, result: "pass" }, "u1");
    await og.valuateItem(db, id, { stoneDeductionLkr: 0, processingDeductionLkr: 0 }, "u1");
    const results = await Promise.allSettled([
      og.purchaseItem(db, id, { paidLkr: 1000, method: "cash" }, "u1"),
      og.purchaseItem(db, id, { paidLkr: 1000, method: "cash" }, "u1"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM journal_entries WHERE ref_entity = 'old_gold_purchase' AND ref_id IN (SELECT id FROM old_gold_purchases WHERE item_id = ?)", id).n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM gold_ledger WHERE type = 'OLD_GOLD_PURCHASE' AND old_gold_id = ?", id).n).toBe(1);
  });

  it("buys entirely on credit (paid 0) — the whole value is owed to the customer", async () => {
    const og = await import("./oldgold");
    const { id, valueCents } = await bought(0);
    const lines = (await og.getItem(db, id)).journal as { account_code: string; credit_cents: number }[];
    expect(lines.map((l) => l.account_code)).toEqual(["1100", "1200"]);
    expect(lines[1]!.credit_cents).toBe(valueCents);
  });

  it("falls back to the closest purity that has a rate", async () => {
    const og = await import("./oldgold");
    const { id } = await intake(10);
    // 18K has no rate; 22K (916) is closer to 750 than 24K (1000).
    await og.recordTest(db, id, { method: "xrf", permille: 750, result: "pass" }, "u1");
    const v = await og.valuateItem(db, id, { buyPct: 100, stoneDeductionLkr: 0, processingDeductionLkr: 0, reason: "test" }, "u1");
    // 7.5g fine is 8.188g of 22K metal × 28,500.
    expect(v.valueCents).toBe(Math.round((10000 * 750 * 2850000) / (916 * 1000)));
  });

  it("releases, melts and keeps gold and books consistent", async () => {
    const og = await import("./oldgold");
    const melt = await import("./melting");
    const { id } = await bought(50000);
    await og.releaseItem(db, id, "u1");
    await expect(og.releaseItem(db, id, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    const batch = await melt.createBatch(db, "b1", undefined, "u1");
    await melt.addItems(db, batch.id, [id], "u1");
    await expect(og.convertItem(db, id, { categoryId: "cat-ring", metalTypeId: "metal-gold", name: "x" }, "u1")).rejects.toMatchObject({ code: "TRANSITION_LOCKED" });
    await melt.lockBatch(db, batch.id, "u1");
    await melt.recordMelt(db, batch.id, { outputWeightG: 4.6, assayPermille: 995, wasteG: 0, outputType: "grain" }, "u1");
    await melt.approveBatch(db, batch.id, { reason: "normal loss" }, "u1");
    expect(one<{ status: string }>("SELECT status FROM old_gold_items WHERE id = ?", id).status).toBe("MELTED");
    const c = await checks();
    expect([c.entry_balance, c.trial_balance, c.gold_stock_consistency]).toEqual([true, true, true]);
  });

  it("converts an available item into a sellable product, once", async () => {
    const og = await import("./oldgold");
    const { id } = await bought(1000);
    await og.releaseItem(db, id, "u1");
    const input = { categoryId: "cat-ring", metalTypeId: "metal-gold", name: "Resale chain" };
    const results = await Promise.allSettled([og.convertItem(db, id, input, "u1"), og.convertItem(db, id, input, "u1")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE notes LIKE 'Converted from %' AND id = (SELECT converted_product_id FROM old_gold_items WHERE id = ?)", id).n).toBe(1);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE name = 'Resale chain'").n).toBe(1);
    const c = await checks();
    expect(c.gold_stock_consistency).toBe(true);
  });

  it("refuses to convert gold earmarked for a live custom order", async () => {
    const og = await import("./oldgold");
    const co = await import("./customOrders");
    const { id } = await bought(1000);
    await og.releaseItem(db, id, "u1");
    const order = await co.createCustomOrder(db, { customerId: "c1", branchId: "b1", design: "Ring", goldReqG: 4, goldSource: "CUSTOMER", quoteLkr: 50000 }, "u1");
    await co.sourceGold(db, order.id, "CUSTOMER_OLDGOLD", id, "u1");
    await expect(og.convertItem(db, id, { categoryId: "cat-ring", metalTypeId: "metal-gold", name: "x" }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports buy-ins by purchase, so melted items still count", async () => {
    const og = await import("./oldgold");
    const s = await og.oldgoldSummary(db, { from: 0, to: Date.now() });
    const p = one<{ n: number; v: number; paid: number }>("SELECT COUNT(*) AS n, SUM(value_cents) AS v, SUM(paid_cents) AS paid FROM old_gold_purchases");
    expect([s.bought, s.value_cents, s.paid_cents]).toEqual([p.n, p.v, p.paid]);
    const byBranch = (await og.oldgoldBreakdown(db, { from: 0, to: Date.now(), groupBy: "branch" })) as { key: string; items: number }[];
    expect(byBranch).toEqual([expect.objectContaining({ key: "Main", items: p.n })]);
    const hist = await og.customerOldgold(db, "c1");
    expect(hist.totals.value_cents).toBe(p.v);
  });
});
