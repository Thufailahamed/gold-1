// Billing kept in step with the books, over real SQLite: an invoice's status
// and balance due follow the money actually received (till, receipts, voids,
// returns, store credit); a bank payment lands in the bank account it names
// and a refund leaves from it; a credit return reduces the receivable rather
// than paying out of the bank; and the till can find a piece by name.
import { beforeAll, describe, expect, it } from "vitest";
import { extractScanCode } from "@goldos/shared";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("billing â†” accounts sync over real SQLite", () => {
  let db: D1Database;
  let raw: ReturnType<typeof migratedDb>["raw"];
  const pieces: { id: string; barcode: string }[] = [];
  let bank2 = { id: "", code: "" };
  const item = (i: number) => ({ productId: pieces[i]!.id, priceLkr: 50000, discountLkr: 0 });

  const inv = (id: string) =>
    db.prepare("SELECT status, paid_cents, total_cents FROM sales_invoices WHERE id = ?").bind(id)
      .first<{ status: string; paid_cents: number; total_cents: number }>();
  const balance = async (account: string, partyId?: string) =>
    (await db
      .prepare(
        `SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM journal_lines WHERE account_code = ?${partyId ? " AND party_id = ?" : ""}`
      )
      .bind(...(partyId ? [account, partyId] : [account]))
      .first<{ n: number }>())?.n ?? 0;

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    raw = m.raw;
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u1','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771111111','b1',0);
      INSERT INTO customers (id, name, phone, branch_id, credit_limit_cents, created_at) VALUES ('c2','Kamala','0772222222','b1',6000000,0);
    `);
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 };
    for (const name of ["Rose Bangle", "Plain Ring", "Chain Link", "Stud Earring", "Leaf Pendant", "Twist Ring", "Anklet"]) {
      const p = await createProduct(db, { ...base, name, grossG: 2 }, "u1");
      pieces.push({ id: p.id, barcode: p.barcode });
    }
    raw.exec(`UPDATE products SET selling_price_cents = 5000000`);
    const { createBankAccount } = await import("./cashbank");
    await createBankAccount(db, { name: "BOC Current" }, "u1"); // adopts 1010
    const second = await createBankAccount(db, { name: "HNB Savings" }, "u1");
    bank2 = { id: second.id, code: second.accountCode };
  });

  it("a credit sale is UNPAID with the whole bill due, not PAID", async () => {
    const { receiveSale, getSale } = await import("./sales");
    const s = await receiveSale(
      db,
      { branchId: "b1", customerId: "c1", items: [item(0)], payments: [{ method: "credit", amountLkr: 50000 }] },
      "u1"
    );
    expect(await inv(s.invoiceId)).toMatchObject({ status: "UNPAID", paid_cents: 0, total_cents: 5_000_000 });
    const d = await getSale(db, s.invoiceId);
    expect((d.invoice as { balance_cents: number }).balance_cents).toBe(5_000_000);
    expect(await balance("1200", "c1")).toBe(5_000_000);
  });

  it("part cash, part credit is PARTIAL; a receipt settles it and a void re-opens it", async () => {
    const { receiveSale } = await import("./sales");
    const { createReceipt, voidReceipt } = await import("./receipts");
    const s = await receiveSale(
      db,
      {
        branchId: "b1",
        customerId: "c1",
        items: [item(1)],
        payments: [{ method: "cash", amountLkr: 20000 }, { method: "credit", amountLkr: 30000 }],
        tenderedLkr: 25000,
      },
      "u1"
    );
    expect(await inv(s.invoiceId)).toMatchObject({ status: "PARTIAL", paid_cents: 2_000_000 });
    const t = await db.prepare("SELECT tendered_cents FROM sales_invoices WHERE id = ?").bind(s.invoiceId).first<{ tendered_cents: number }>();
    expect(t?.tendered_cents).toBe(2_500_000);

    // c1 owes 50,000 (first sale) + 30,000. Pay 80,000 into the second bank.
    const cashBefore = await balance(bank2.code);
    const r = await createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 8_000_000, method: "bank", bankAccountId: bank2.id }, "u1");
    expect(await inv(s.invoiceId)).toMatchObject({ status: "PAID", paid_cents: 5_000_000 });
    expect(await balance(bank2.code)).toBe(cashBefore + 8_000_000);
    expect(await balance("1200", "c1")).toBe(0);

    await voidReceipt(db, r.id, "Cheque bounced", "u1");
    expect(await inv(s.invoiceId)).toMatchObject({ status: "PARTIAL", paid_cents: 2_000_000 });
    expect(await balance("1200", "c1")).toBe(8_000_000);
    // Settle again so later cases start clean.
    await createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 8_000_000, method: "cash" }, "u1");
  });

  it("refuses cash tendered below the cash due", async () => {
    const { receiveSale } = await import("./sales");
    await expect(
      receiveSale(db, { branchId: "b1", items: [item(2)], payments: [{ method: "cash", amountLkr: 50000 }], tenderedLkr: 100 }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a bank payment posts to the bank account it names, and its refund leaves from there", async () => {
    const { receiveSale, getSale, createReturn } = await import("./sales");
    const before1010 = await balance("1010");
    const before2 = await balance(bank2.code);
    const s = await receiveSale(
      db,
      { branchId: "b1", items: [item(2)], payments: [{ method: "bank", amountLkr: 50000, bankAccountId: bank2.id }] },
      "u1"
    );
    expect(await balance(bank2.code)).toBe(before2 + 5_000_000);
    expect(await balance("1010")).toBe(before1010);
    const d = await getSale(db, s.invoiceId);
    expect(d.payments[0]).toMatchObject({ account_code: bank2.code, bank_account_name: "HNB Savings" });
    // The invoice shows the ledger lines it posted, and they balance.
    const lines = d.journal as { account_code: string; debit_cents: number; credit_cents: number }[];
    expect(lines.find((l) => l.account_code === bank2.code)?.debit_cents).toBe(5_000_000);
    expect(lines.reduce((s, l) => s + l.debit_cents - l.credit_cents, 0)).toBe(0);

    const itemId = (d.items as { id: string }[])[0]!.id;
    await createReturn(db, { invoiceId: s.invoiceId, itemIds: [itemId], type: "PARTIAL", reason: "Changed mind", refundMethod: "original" }, "u1");
    expect(await balance(bank2.code)).toBe(before2);
    expect(await balance("1010")).toBe(before1010);
  });

  it("names a bank account only on a bank payment", async () => {
    const { receiveSale } = await import("./sales");
    await expect(
      receiveSale(db, { branchId: "b1", items: [item(3)], payments: [{ method: "cash", amountLkr: 50000, bankAccountId: bank2.id }] }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("returning a credit sale takes it off the receivable, not out of the bank", async () => {
    const { receiveSale, getSale, createReturn } = await import("./sales");
    const s = await receiveSale(
      db,
      { branchId: "b1", customerId: "c1", items: [item(3)], payments: [{ method: "credit", amountLkr: 50000 }] },
      "u1"
    );
    const bankBefore = await balance("1010");
    const arBefore = await balance("1200", "c1");
    const itemId = ((await getSale(db, s.invoiceId)).items as { id: string }[])[0]!.id;
    await createReturn(db, { invoiceId: s.invoiceId, itemIds: [itemId], type: "PARTIAL", reason: "Defect", refundMethod: "original" }, "u1");
    expect(await balance("1010")).toBe(bankBefore);
    expect(await balance("1200", "c1")).toBe(arBefore - 5_000_000);
    // Nothing is owed on the bill any more.
    expect(await inv(s.invoiceId)).toMatchObject({ status: "PAID" });
  });

  it("store credit from an exchange settles the replacement bill", async () => {
    const { receiveSale, getSale, createReturn } = await import("./sales");
    const first = await receiveSale(db, { branchId: "b1", customerId: "c1", items: [item(4)], payments: [{ method: "cash", amountLkr: 50000 }] }, "u1");
    const itemId = ((await getSale(db, first.invoiceId)).items as { id: string }[])[0]!.id;
    const ret = await createReturn(db, { invoiceId: first.invoiceId, itemIds: [itemId], type: "EXCHANGE", reason: "Size", refundMethod: "credit" }, "u1");
    const repl = await receiveSale(
      db,
      { branchId: "b1", customerId: "c1", items: [item(5)], payments: [{ method: "credit", amountLkr: 50000 }], exchangeReturnId: ret.returnId },
      "u1"
    );
    expect(await inv(repl.invoiceId)).toMatchObject({ status: "PAID", paid_cents: 5_000_000 });
    expect(await balance("1200", "c1")).toBe(0);
  });

  it("enforces a customer's credit limit at the till", async () => {
    const { receiveSale, customerCredit } = await import("./sales");
    // Kamala's limit is 60,000; a 50,000 bill fits, a second would not.
    await expect(
      receiveSale(
        db,
        { branchId: "b1", customerId: "c2", items: [item(6)], payments: [{ method: "credit", amountLkr: 50000 }] },
        "u1",
        { enforceCreditLimit: true }
      )
    ).resolves.toBeTruthy();
    const c = await customerCredit(db, "c2", "b1");
    expect(c).toMatchObject({ balanceCents: 5_000_000, creditLimitCents: 6_000_000, openInvoices: 1, openDueCents: 5_000_000 });
  });

  it("finds pieces by name, category or tag, priced like a scan, and only what is for sale", async () => {
    const { posCatalog } = await import("./sales");
    const { createProduct } = await import("./products");
    const fresh = await createProduct(
      db,
      { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000, name: "Diamond Solitaire", grossG: 3, sellingPriceLkr: 75000 },
      "u1"
    );
    const hits = await posCatalog(db, { q: "solit", branchId: "b1" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: fresh.id, price_cents: 7_500_000, status: "IN_STOCK" });
    // Sold pieces are never offered.
    const rings = await posCatalog(db, { q: "ring", branchId: "b1" });
    expect(rings.every((r) => r.status === "IN_STOCK")).toBe(true);
    expect(rings.map((r) => r.name)).not.toContain("Plain Ring");
    const byTag = await posCatalog(db, { q: pieces[2]!.barcode.toLowerCase(), branchId: "b1" });
    // Returned pieces are RETURNED, not IN_STOCK, until put back to stock.
    expect(byTag.length).toBe(0);
    expect(await posCatalog(db, { q: "anything", branchId: "b-other" })).toEqual([]);
  });

  it("reports a breakdown by purity", async () => {
    const { salesBreakdown } = await import("./sales");
    const rows = await salesBreakdown(db, { from: 0, to: Date.now() + 1000, groupBy: "purity" });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("reads a code out of any QR payload", () => {
    expect(extractScanCode(" jw-abc234\r\n")).toBe("JW-ABC234");
    expect(extractScanCode("https://shop.example/products/barcode/JW-ABC234")).toBe("JW-ABC234");
    expect(extractScanCode("https://shop.example/pos?add=jw-abc234&x=1")).toBe("JW-ABC234");
    expect(extractScanCode('{"barcode":"JW-ABC234"}')).toBe("JW-ABC234");
  });
});
