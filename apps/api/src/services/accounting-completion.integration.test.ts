// End-to-end over real SQLite: VAT on sales and returns, tax remittance,
// opening stock, accounts payable and the financial-year close — each through
// the services the routes call, with the reconciliation run on top.
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, fiscalYearFor } from "@goldos/shared";
import { migratedDb, sqliteAvailable } from "./sqlite-test-db";

describe.skipIf(!sqliteAvailable)("accounting completion over real SQLite", () => {
  let db: D1Database;
  let today: string;
  let saleId = "";
  let itemB = "";
  let productB = "";

  const balance = async (code: string) => {
    const r = await db
      .prepare("SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS n FROM journal_lines WHERE account_code = ?")
      .bind(code)
      .first<{ n: number }>();
    return r?.n ?? 0;
  };

  beforeAll(async () => {
    const m = migratedDb();
    db = m.db;
    m.raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES
        ('u1','o@x','Owner','x',0,0), ('u2','a@x','Accountant','x',0,0);
      INSERT INTO user_roles (user_id, role_id) VALUES ('u2','owner');
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0);
      INSERT INTO suppliers (id, name, phone, branch_id, created_at) VALUES ('s1','Kandy Gold','0812222222','b1',0);
    `);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, Date.now());
  });

  it("taxes nothing while the rate is zero", async () => {
    const { getTaxConfig } = await import("./taxes");
    expect(await getTaxConfig(db)).toMatchObject({ rateBp: 0, label: "VAT" });
  });

  it("direct intake carries its cost on 1100 against opening balances", async () => {
    const { createProduct } = await import("./products");
    const base = { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", stoneG: 0, makingLkr: 0, wastageG: 0 };
    await createProduct(db, { ...base, name: "Ring A", grossG: 8, costLkr: 40000 }, "u1");
    const b = await createProduct(db, { ...base, name: "Ring B", grossG: 4, costLkr: 20000 }, "u1");
    productB = b.id;
    expect(await balance("1100")).toBe(6_000_000);
    expect(await balance("3100")).toBe(-6_000_000);
  });

  it("adds VAT on top: revenue net, tax to 2100, customer pays the gross", async () => {
    const { setTaxConfig } = await import("./taxes");
    const { receiveSale, getSale } = await import("./sales");
    await setTaxConfig(db, { rateBp: 1800, label: "VAT", registrationNo: "VAT-123" }, "u1");
    const ids = (await db.prepare("SELECT id FROM products ORDER BY name").all<{ id: string }>()).results.map((r) => r.id);
    const items = [
      { productId: ids[0]!, priceLkr: 100000, discountLkr: 0 },
      { productId: ids[1]!, priceLkr: 50000, discountLkr: 0 },
    ];
    await expect(
      receiveSale(db, { branchId: "b1", items, payments: [{ method: "cash", amountLkr: 150000 }] }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const sale = await receiveSale(db, { branchId: "b1", items, payments: [{ method: "cash", amountLkr: 177000 }] }, "u1");
    saleId = sale.invoiceId;
    const s = await getSale(db, saleId);
    const inv = s.invoice as { total_cents: number; tax_cents: number; tax_rate_bp: number };
    expect(inv).toMatchObject({ total_cents: 17_700_000, tax_cents: 2_700_000, tax_rate_bp: 1800 });
    itemB = (s.items as { id: string; product_id: string }[]).find((i) => i.product_id === productB)!.id;
    expect(await balance("4000")).toBe(-15_000_000);
    expect(await balance("2100")).toBe(-2_700_000);
  });

  it("a return refunds the line's own tax and takes it back off 2100", async () => {
    const { createReturn } = await import("./sales");
    await createReturn(db, { invoiceId: saleId, itemIds: [itemB], type: "PARTIAL", reason: "Wrong size", refundMethod: "original" }, "u1");
    const r = await db.prepare("SELECT refund_cents, tax_cents FROM sales_returns").first<{ refund_cents: number; tax_cents: number }>();
    expect(r).toEqual({ refund_cents: 5_900_000, tax_cents: 900_000 });
    expect(await balance("4000")).toBe(-10_000_000);
    expect(await balance("2100")).toBe(-1_800_000);
    expect(await balance("1000")).toBe(17_700_000 - 5_900_000);
  });

  it("every reconciliation check passes, including the new tax cross-foot", async () => {
    const { reconcile } = await import("./reconcile");
    const rep = await reconcile(db, { date: today, branchId: "b1" });
    expect(rep.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.expected} vs ${c.actual}`)).toEqual([]);
    expect(rep.checks.find((c) => c.id === "tax_crossfoot")).toMatchObject({ expected: 1_800_000, pass: true });
  });

  it("a cost correction on a returned direct-intake piece moves 1100 by the difference; a void takes it off", async () => {
    const { editProduct, createProduct, voidProduct } = await import("./products");
    // B is back on the shelf at 20,000.
    expect(await balance("1100")).toBe(2_000_000);
    await editProduct(db, productB, { costLkr: 25000 }, "u1");
    expect(await balance("1100")).toBe(2_500_000);
    const c = await createProduct(
      db,
      { categoryId: "cat-ring", metalTypeId: "metal-gold", purityId: "purity-22k", branchId: "b1", name: "Ring C", grossG: 2, stoneG: 0, makingLkr: 0, wastageG: 0, costLkr: 10000 },
      "u1"
    );
    expect(await balance("1100")).toBe(3_500_000);
    await voidProduct(db, c.id, "u1", "Damaged at intake");
    expect(await balance("1100")).toBe(2_500_000);
  });

  it("the VAT report reads 2100; a payment clears it and cannot overpay", async () => {
    const { taxReport, createTaxPayment } = await import("./taxes");
    const rep = await taxReport(db, { from: today, to: today });
    expect(rep).toMatchObject({
      outputTaxCents: 2_700_000,
      refundedTaxCents: 900_000,
      netOutputTaxCents: 1_800_000,
      closingCents: 1_800_000,
      taxableSalesCents: 15_000_000,
      taxableReturnsCents: 5_000_000,
    });
    await expect(
      createTaxPayment(db, { branchId: "b1", periodFrom: today, periodTo: today, amountCents: 1_800_001, method: "cash" }, "u1")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const p = await createTaxPayment(db, { branchId: "b1", periodFrom: today, periodTo: today, amountCents: 1_000_000, method: "cash", reference: "IRD-9" }, "u1");
    expect(p.number).toBe("TAXP-00001");
    const after = await taxReport(db, { from: today, to: today });
    expect(after).toMatchObject({ paidCents: 1_000_000, closingCents: 800_000 });
  });

  it("day close names the tax payment and the checks still pass", async () => {
    const { buildClosingReport } = await import("./dayclose");
    const rep = await buildClosingReport(db, { branchId: "b1", date: today });
    expect(rep.cashIn.unclassifiedCents).toBe(0);
    expect(rep.cashOut.lines.map((l) => l.label)).toContain("Tax paid");
    expect(rep.checks.failing).toEqual([]);
  });

  it("a repair collection on 4000 no longer fails the sales cross-foot", async () => {
    const { buildEntryStmts } = await import("./journal");
    const { reconcile } = await import("./reconcile");
    const built = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "1000", debitCents: 250_000, creditCents: 0 },
          { account: "4000", debitCents: 0, creditCents: 250_000 },
        ],
        refEntity: "repair", refId: "r1", branchId: "b1", actorId: "u1",
        auditAction: "repair.collect", auditEntity: "repair", auditEntityId: "r1", sourceModule: "sales",
      },
      { entryDate: today }
    );
    await db.batch(built.stmts);
    const rep = await reconcile(db, { date: today, branchId: "b1" });
    expect(rep.checks.find((c) => c.id === "sales_crossfoot")?.pass).toBe(true);
  });

  it("lists what the shop owes suppliers, aged by invoice", async () => {
    const { buildEntryStmts } = await import("./journal");
    const { listPayables, supplierOpenInvoices } = await import("./payables");
    const now = Date.now();
    const recv = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "1100", debitCents: 300_000, creditCents: 0, partyType: "supplier", partyId: "s1" },
          { account: "2000", debitCents: 0, creditCents: 300_000, partyType: "supplier", partyId: "s1" },
        ],
        refEntity: "purchase_invoice", refId: "pi1", branchId: "b1", actorId: "u1",
        auditAction: "t", auditEntity: "t", auditEntityId: "pi1", sourceModule: "purchases",
      },
      { entryDate: today }
    );
    const pay = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "2000", debitCents: 100_000, creditCents: 0, partyType: "supplier", partyId: "s1" },
          { account: "1000", debitCents: 0, creditCents: 100_000 },
        ],
        refEntity: "purchase_payment", refId: "pp1", branchId: "b1", actorId: "u1",
        auditAction: "t", auditEntity: "t", auditEntityId: "pp1", sourceModule: "purchases",
      },
      { entryDate: today }
    );
    await db.batch([
      ...recv.stmts,
      ...pay.stmts,
      db
        .prepare("INSERT INTO purchase_invoices (id, number, supplier_id, branch_id, subtotal_cents, total_cents, paid_cents, status, created_at, created_by, journal_entry_id) VALUES ('pi1','PINV-0001','s1','b1',300000,300000,100000,'PARTIAL',?,'u1',?)")
        .bind(now, recv.entryId),
    ]);
    const r = await listPayables(db, { asOf: today });
    expect(r.totalCents).toBe(200_000);
    expect(r.rows[0]).toMatchObject({ supplierId: "s1", name: "Kandy Gold", balanceCents: 200_000, openInvoices: 1 });
    expect(r.aging["0-30"]).toBe(200_000);
    const open = await supplierOpenInvoices(db, "s1");
    expect(open.invoices.map((i) => [i.number, i.outstandingCents])).toEqual([["PINV-0001", 200_000]]);
  });

  it("splits equity at the year boundary, closes the prior year and locks it", async () => {
    const { buildEntryStmts } = await import("./journal");
    const { balanceSheet } = await import("./statements");
    const { closeFiscalYear, reopenFiscalYear, listFiscalYears } = await import("./fiscal");
    const priorEnd = addDays(fiscalYearFor(today, 4).start, -1);
    const inPrior = addDays(priorEnd, -10);
    const post = (date: string) =>
      buildEntryStmts(
        db,
        {
          lines: [
            { account: "1000", debitCents: 100_000, creditCents: 0 },
            { account: "4900", debitCents: 0, creditCents: 100_000 },
          ],
          refEntity: "other_income", refId: crypto.randomUUID(), branchId: "b1", actorId: "u1",
          auditAction: "t", auditEntity: "t", auditEntityId: "x", sourceModule: "cash",
        },
        { entryDate: date }
      );
    await db.batch((await post(inPrior)).stmts);

    const bs = await balanceSheet(db, { date: today });
    expect(bs.balanced).toBe(true);
    expect(bs.retainedEarningsCents).toBe(100_000);
    expect(bs.equity.find((l) => l.code === "RE")).toMatchObject({ name: "Retained earnings", cents: 100_000 });
    expect(bs.currentYearProfitCents).toBe(bs.profitToDateCents - 100_000);

    await expect(closeFiscalYear(db, { yearEnd: addDays(priorEnd, -1) }, "u1")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(closeFiscalYear(db, { yearEnd: fiscalYearFor(today, 4).end }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    const closed = await closeFiscalYear(db, { yearEnd: priorEnd }, "u1");
    expect(closed.netProfitCents).toBe(100_000);
    await expect(closeFiscalYear(db, { yearEnd: priorEnd }, "u1")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(post(inPrior)).rejects.toMatchObject({ code: "TRANSITION_LOCKED" });
    await expect(post(today)).resolves.toBeTruthy();

    const years = await listFiscalYears(db);
    expect(years.years.find((y) => y.end === priorEnd)?.close?.status).toBe("CLOSED");

    await expect(reopenFiscalYear(db, priorEnd, { reason: "Late invoice", approvedBy: "u1" }, "u1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reopenFiscalYear(db, priorEnd, { reason: "Late invoice", approvedBy: "u2" }, "u1");
    await expect(post(inPrior)).resolves.toBeTruthy();
  });
});
