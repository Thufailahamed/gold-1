// End-to-end over real SQLite: every migration applied, services called as
// the routes call them. Needs node:sqlite (Node 22.5+); skipped on older Node
// so the suite stays green on the .nvmrc version.
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...v: unknown[]): unknown;
    all(...v: unknown[]): unknown[];
    run(...v: unknown[]): unknown;
  };
};

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync;
} catch {
  DatabaseSync = null;
}

const norm = (v: unknown[]) => v.map((x) => (x === undefined ? null : typeof x === "boolean" ? (x ? 1 : 0) : x));

/** Just enough of the D1 surface the services use. */
function d1(raw: SqliteDb): D1Database {
  const stmt = (sql: string, vals: unknown[] = []) => ({
    sql,
    vals,
    bind: (...v: unknown[]) => stmt(sql, norm(v)),
    first: async <T>(col?: string) => {
      const row = (raw.prepare(sql).get(...vals) ?? null) as Record<string, unknown> | null;
      return (col && row ? row[col] : row) as T;
    },
    all: async <T>() => ({ results: raw.prepare(sql).all(...vals) as T[] }),
    run: async () => {
      raw.prepare(sql).run(...vals);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string; vals: unknown[] }[]) => {
      raw.exec("BEGIN");
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...s.vals);
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  } as unknown as D1Database;
}

describe.skipIf(!DatabaseSync)("accounts suite over real SQLite", () => {
  let db: D1Database;
  let today: string;
  const now = Date.now();

  beforeAll(async () => {
    const raw = new DatabaseSync!(":memory:");
    // node:sqlite enforces FKs by default; the migration runner does not.
    raw.exec("PRAGMA foreign_keys = OFF");
    const dir = join(__dirname, "..", "..", "drizzle");
    for (const f of readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
      try {
        raw.exec(readFileSync(join(dir, f), "utf8"));
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    }
    // On after the migrations: 0015 renames tables with live references,
    // which D1's migration runner tolerates. Business writes must obey FKs.
    raw.exec("PRAGMA foreign_keys = ON");
    db = d1(raw);
    const { businessDateFor } = await import("./busdate");
    today = await businessDateFor(db, now);
    raw.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ('u1','o@x','Owner','x',0,0);
      INSERT INTO branches (id, name, code, created_at) VALUES ('b1','Main','MAIN',0), ('b2','Second','SEC',0);
      INSERT INTO customers (id, name, phone, branch_id, created_at) VALUES ('c1','Nimal','0771234567','b1',0);
    `);
    // Two sales to c1 at b1: one fully on credit, one part cash / part credit.
    const { buildEntryStmts } = await import("./journal");
    const sale = async (id: string, number: string, total: number, cash: number, createdAt: number) => {
      const credit = total - cash;
      const built = await buildEntryStmts(
        db,
        {
          lines: [
            ...(cash ? [{ account: "1000", debitCents: cash, creditCents: 0 }] : []),
            { account: "1200", debitCents: credit, creditCents: 0, partyType: "customer" as const, partyId: "c1" },
            { account: "4000", debitCents: 0, creditCents: total },
          ],
          refEntity: "sale_invoice",
          refId: id,
          refNo: number,
          branchId: "b1",
          actorId: "u1",
          auditAction: "sale.complete",
          auditEntity: "sale_invoice",
          auditEntityId: id,
          sourceModule: "sales",
        },
        { entryDate: today }
      );
      await db.batch([
        db
          .prepare("INSERT INTO sales_invoices (id, number, customer_id, branch_id, subtotal_cents, discount_cents, total_cents, paid_cents, status, created_at, created_by) VALUES (?, ?, 'c1', 'b1', ?, 0, ?, ?, 'PAID', ?, 'u1')")
          .bind(id, number, total, total, total, createdAt),
        ...built.stmts,
        ...(cash
          ? [db.prepare("INSERT INTO sales_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, 'cash', 'sale_payment', ?, ?, 'u1')").bind(`${id}-p1`, id, cash, `${id}-p1`, createdAt)]
          : []),
        db.prepare("INSERT INTO sales_payments (id, invoice_id, amount_cents, method, ref_entity, ref_id, created_at, created_by) VALUES (?, ?, ?, 'credit', 'sale_payment', ?, ?, 'u1')").bind(`${id}-p2`, id, credit, `${id}-p2`, createdAt),
      ]);
    };
    await sale("inv1", "SINV-0001", 100000, 0, now - 2000);
    await sale("inv2", "SINV-0002", 50000, 20000, now - 1000);
  });

  it("lists what the customer owes at the branch", async () => {
    const { listReceivables } = await import("./receipts");
    const r = await listReceivables(db, { branchId: "b1", asOf: today });
    expect(r.totalCents).toBe(130000);
    expect(r.rows[0]).toMatchObject({ customerId: "c1", name: "Nimal", balanceCents: 130000, openInvoices: 2 });
    expect((await listReceivables(db, { branchId: "b2", asOf: today })).rows).toHaveLength(0);
  });

  it("refuses a receipt at a branch where the customer owes nothing", async () => {
    const { createReceipt } = await import("./receipts");
    await expect(
      createReceipt(db, { customerId: "c1", branchId: "b2", amountCents: 1000, method: "cash" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses an overpayment", async () => {
    const { createReceipt } = await import("./receipts");
    await expect(
      createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 130001, method: "cash" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  let receiptId = "";
  it("collects dues oldest invoice first and posts DR cash / CR receivables", async () => {
    const { createReceipt, customerBalance, customerOpenInvoices } = await import("./receipts");
    const r = await createReceipt(db, { customerId: "c1", branchId: "b1", amountCents: 110000, method: "cash", note: "Paid at counter" }, "u1");
    receiptId = r.id;
    expect(r.number).toBe("RCPT-000001");
    expect(r.allocations).toEqual([
      { invoiceId: "inv1", amountCents: 100000 },
      { invoiceId: "inv2", amountCents: 10000 },
    ]);
    expect(await customerBalance(db, "c1", "b1")).toBe(20000);
    const open = await customerOpenInvoices(db, "c1", "b1");
    expect(open.invoices.map((i) => [i.number, i.outstandingCents])).toEqual([["SINV-0002", 20000]]);
  });

  it("records owner, income and correction movements; refuses a bank till correction", async () => {
    const { createCashEntry } = await import("./cashentries");
    await createCashEntry(db, { branchId: "b1", kind: "OWNER_CAPITAL", amountCents: 50000, method: "cash", note: "Float for the week" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "OTHER_INCOME", amountCents: 2000, method: "cash", note: "Polishing fee" }, "u1");
    await createCashEntry(db, { branchId: "b1", kind: "CASH_SHORT", amountCents: 500, method: "cash", note: "Count short" }, "u1");
    await expect(
      createCashEntry(db, { branchId: "b1", kind: "CASH_SHORT", amountCents: 500, method: "bank", bankAccountId: "x", note: "no" }, "u1")
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("day close names every new movement, expects the right cash and passes the ledger checks", async () => {
    const { buildClosingReport } = await import("./dayclose");
    const rep = await buildClosingReport(db, { branchId: "b1", date: today });
    expect(rep.cashIn.unclassifiedCents).toBe(0);
    const labels = [...rep.cashIn.lines, ...rep.cashOut.lines].map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(["Customer payments on account", "Owner put money in", "Other income", "Cash corrections"]));
    // 20000 cash sale + 110000 receipt + 50000 owner + 2000 income - 500 short
    expect(rep.closing.expectedCents).toBe(181500);
    expect(rep.money.customerPaymentsCents).toBe(130000);
    expect(rep.checks.failing).not.toContain("party_ledgers");
    expect(rep.checks.failing).not.toContain("payments_crossfoot");
  });

  it("P&L and balance sheet come straight from the ledger and balance", async () => {
    const { balanceSheet, profitAndLoss } = await import("./statements");
    const p = await profitAndLoss(db, { from: today, to: today, branchId: "b1" });
    expect(p.totalRevenueCents).toBe(152000);
    expect(p.operating).toEqual([{ code: "6090", name: "Cash Short & Over", cents: 500 }]);
    expect(p.netProfitCents).toBe(151500);
    const b = await balanceSheet(db, { date: today });
    expect(b.balanced).toBe(true);
    expect(b.totalAssetsCents).toBe(181500 + 20000);
  });

  it("trial balance honours its branch and date filters", async () => {
    const { trialBalance } = await import("./journal");
    const { addDays } = await import("@goldos/shared");
    expect(await trialBalance(db, { date: today, branchId: "b2" })).toEqual([]);
    expect(await trialBalance(db, { date: addDays(today, -1) })).toEqual([]);
    const tb = await trialBalance(db, { date: today, branchId: "b1" });
    expect(tb.reduce((s, r) => s + r.balanceCents, 0)).toBe(0);
  });

  it("monthly report includes other income and the receipt in receivables", async () => {
    const { buildMonthlyReport } = await import("./monthly");
    const r = await buildMonthlyReport(db, { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), branchId: "b1" });
    expect(r.profit.otherIncomeCents).toBe(2000);
    expect(r.receivables.totalCents).toBe(20000);
    expect(r.receivables.outstanding.map((o) => o.outstandingCents)).toEqual([20000]);
  });

  it("voiding a receipt reverses it and the debt returns everywhere", async () => {
    const { voidReceipt, customerBalance, listReceivables } = await import("./receipts");
    const { buildMonthlyReport } = await import("./monthly");
    await voidReceipt(db, receiptId, "Cheque bounced", "u1");
    expect(await customerBalance(db, "c1", "b1")).toBe(130000);
    expect((await listReceivables(db, { branchId: "b1", asOf: today })).totalCents).toBe(130000);
    const r = await buildMonthlyReport(db, { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), branchId: "b1" });
    expect(r.receivables.totalCents).toBe(130000);
    expect(r.receivables.outstanding.reduce((s, o) => s + o.outstandingCents, 0)).toBe(130000);
    await expect(voidReceipt(db, receiptId, "again", "u1")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
