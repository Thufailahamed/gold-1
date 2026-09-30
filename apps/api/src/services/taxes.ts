import type { TaxConfigInput, TaxPaymentInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { fail } from "./cashbank";
import { buildEntryStmts } from "./journal";
import { moneyAccount } from "./receipts";
import { getSetting } from "./settings";

export const TAX_PAYABLE = "2100";

export type TaxConfig = { rateBp: number; label: string; registrationNo: string };

/**
 * The shop's output-tax setting. Rate 0 is "not registered": no tax line on
 * any document and nothing ever posts to 2100 from a sale.
 */
export async function getTaxConfig(db: D1Database): Promise<TaxConfig> {
  const [rate, label, reg] = await Promise.all([
    getSetting(db, "sales_tax_rate_bp"),
    getSetting(db, "sales_tax_label"),
    getSetting(db, "sales_tax_reg_no"),
  ]);
  const rateBp = typeof rate?.value === "number" && rate.value > 0 ? Math.round(rate.value) : 0;
  return {
    rateBp,
    label: typeof label?.value === "string" && label.value ? label.value : "VAT",
    registrationNo: typeof reg?.value === "string" ? reg.value : "",
  };
}

export async function setTaxConfig(db: D1Database, input: TaxConfigInput, actorId: string): Promise<TaxConfig> {
  const prev = await getTaxConfig(db);
  const upsert = (key: string, value: unknown, type: string) =>
    db
      .prepare(
        "INSERT INTO settings (key, value_json, type) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, type = excluded.type"
      )
      .bind(key, JSON.stringify(value), type);
  const next: TaxConfig = { rateBp: input.rateBp, label: input.label, registrationNo: input.registrationNo ?? prev.registrationNo };
  await db.batch([
    upsert("sales_tax_rate_bp", next.rateBp, "number"),
    upsert("sales_tax_label", next.label, "string"),
    upsert("sales_tax_reg_no", next.registrationNo, "string"),
    buildAuditStmt(db, { userId: actorId, action: "tax.config", entity: "setting", entityId: "sales_tax", prev, next }),
  ]);
  return next;
}

export type TaxReport = {
  from: string;
  to: string;
  branchId: string | null;
  config: TaxConfig;
  openingCents: number;
  outputTaxCents: number;
  refundedTaxCents: number;
  netOutputTaxCents: number;
  paidCents: number;
  otherCents: number;
  closingCents: number;
  taxableSalesCents: number;
  taxableReturnsCents: number;
  invoices: number;
  byDay: { date: string; outputCents: number; refundedCents: number }[];
  payments: TaxPaymentRow[];
};

export type TaxPaymentRow = {
  id: string;
  number: string;
  branch_id: string;
  paid_on: string;
  period_from: string;
  period_to: string;
  amount_cents: number;
  method: string;
  account_code: string;
  reference: string | null;
  note: string | null;
  journal_entry_id: string | null;
  created_at: number;
};

/**
 * The VAT return for a window, straight from 2100. Sale-side figures come
 * from the ledger, not from the documents, so what the report says was
 * collected is exactly what the books say is owed; the document totals are
 * alongside for the taxable-turnover box. Every status counts — a reversal
 * and its original net to zero, as everywhere else in the books.
 */
export async function taxReport(
  db: D1Database,
  opts: { from: string; to: string; branchId?: string }
): Promise<TaxReport> {
  const b = opts.branchId ? " AND e.branch_id = ?" : "";
  const bv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const opening = await db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${TAX_PAYABLE}' AND e.entry_date < ?${b}`
    )
    .bind(opts.from, ...bv)
    .first<{ n: number }>();
  const { results: moves } = await db
    .prepare(
      `SELECT COALESCE(e.ref_entity, '') AS ref, COALESCE(SUM(l.credit_cents), 0) AS cr, COALESCE(SUM(l.debit_cents), 0) AS dr
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${TAX_PAYABLE}' AND e.entry_date >= ? AND e.entry_date <= ?${b}
       GROUP BY COALESCE(e.ref_entity, '')`
    )
    .bind(opts.from, opts.to, ...bv)
    .all<{ ref: string; cr: number; dr: number }>();
  let outputTaxCents = 0;
  let refundedTaxCents = 0;
  let paidCents = 0;
  let otherCents = 0;
  for (const m of moves ?? []) {
    const net = m.cr - m.dr;
    if (m.ref === "sale_invoice") outputTaxCents += net;
    else if (m.ref === "sale_return") refundedTaxCents += -net;
    else if (m.ref === "tax_payment") paidCents += -net;
    else otherCents += net;
  }
  const { results: byDay } = await db
    .prepare(
      `SELECT e.entry_date AS date,
              COALESCE(SUM(CASE WHEN e.ref_entity = 'sale_invoice' THEN l.credit_cents - l.debit_cents ELSE 0 END), 0) AS outputCents,
              COALESCE(SUM(CASE WHEN e.ref_entity = 'sale_return' THEN l.debit_cents - l.credit_cents ELSE 0 END), 0) AS refundedCents
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${TAX_PAYABLE}' AND e.entry_date >= ? AND e.entry_date <= ?${b}
         AND e.ref_entity IN ('sale_invoice','sale_return')
       GROUP BY e.entry_date ORDER BY e.entry_date`
    )
    .bind(opts.from, opts.to, ...bv)
    .all<{ date: string; outputCents: number; refundedCents: number }>();
  const LOCAL = (col: string) => `date(${col}/1000,'unixepoch','+330 minutes')`;
  const sb = opts.branchId ? " AND si.branch_id = ?" : "";
  const sales = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(si.total_cents - si.tax_cents), 0) AS net FROM sales_invoices si
       WHERE si.status <> 'VOID' AND si.tax_cents > 0 AND ${LOCAL("si.created_at")} >= ? AND ${LOCAL("si.created_at")} <= ?${sb}`
    )
    .bind(opts.from, opts.to, ...bv)
    .first<{ n: number; net: number }>();
  const rets = await db
    .prepare(
      `SELECT COALESCE(SUM(sr.refund_cents + sr.credit_cents - sr.tax_cents), 0) AS net FROM sales_returns sr
       JOIN sales_invoices si ON si.id = sr.invoice_id
       WHERE sr.status = 'COMPLETE' AND sr.tax_cents > 0 AND ${LOCAL("sr.created_at")} >= ? AND ${LOCAL("sr.created_at")} <= ?${sb}`
    )
    .bind(opts.from, opts.to, ...bv)
    .first<{ net: number }>();
  const payments = await listTaxPayments(db, { from: opts.from, to: opts.to, branchId: opts.branchId });
  const openingCents = opening?.n ?? 0;
  const netOutputTaxCents = outputTaxCents - refundedTaxCents;
  return {
    from: opts.from,
    to: opts.to,
    branchId: opts.branchId ?? null,
    config: await getTaxConfig(db),
    openingCents,
    outputTaxCents,
    refundedTaxCents,
    netOutputTaxCents,
    paidCents,
    otherCents,
    closingCents: openingCents + netOutputTaxCents - paidCents + otherCents,
    taxableSalesCents: sales?.net ?? 0,
    taxableReturnsCents: rets?.net ?? 0,
    invoices: sales?.n ?? 0,
    byDay: byDay ?? [],
    payments,
  };
}

export async function listTaxPayments(
  db: D1Database,
  opts: { from?: string; to?: string; branchId?: string }
): Promise<TaxPaymentRow[]> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.from) {
    conds.push("paid_on >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("paid_on <= ?");
    vals.push(opts.to);
  }
  if (opts.branchId) {
    conds.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  const sql = `SELECT id, number, branch_id, paid_on, period_from, period_to, amount_cents, method, account_code, reference, note, journal_entry_id, created_at
               FROM tax_payments ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY paid_on DESC, created_at DESC`;
  const stmt = db.prepare(sql);
  const { results } = await (vals.length ? stmt.bind(...vals) : stmt).all<TaxPaymentRow>();
  return results ?? [];
}

async function nextTaxPaymentNo(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = 'TAXP' RETURNING next - 1 AS allocated")
      .bind()
      .first<{ allocated: number }>();
    if (!row) fail("INTERNAL", "Counter TAXP missing");
    const no = `TAXP-${String(row.allocated).padStart(5, "0")}`;
    const taken = await db.prepare("SELECT 1 AS x FROM tax_payments WHERE number = ?").bind(no).first();
    if (!taken) return no;
  }
  return fail("INTERNAL", "Counter TAXP is out of step; repair it");
}

/**
 * Paying the authority. DR 2100 / CR the drawer or a named bank account. The
 * payment may not exceed what 2100 holds shop-wide: overpaying would leave a
 * debit balance on a liability, which is a refund claim, not a payment, and
 * belongs in a manual adjustment with its own reason.
 */
export async function createTaxPayment(
  db: D1Database,
  input: TaxPaymentInput,
  actorId: string
): Promise<{ id: string; number: string; entryNo: string }> {
  if (input.periodFrom > input.periodTo) fail("VALIDATION", "Period start must be on or before its end");
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) fail("NOT_FOUND", "Branch not found");
  const owed = await db
    .prepare(`SELECT COALESCE(SUM(credit_cents - debit_cents), 0) AS n FROM journal_lines WHERE account_code = '${TAX_PAYABLE}'`)
    .first<{ n: number }>();
  if (input.amountCents > (owed?.n ?? 0))
    fail("CONFLICT", `Payment exceeds the tax owed (${owed?.n ?? 0}c on account ${TAX_PAYABLE})`);
  const money = await moneyAccount(db, input.method, input.bankAccountId);
  const id = crypto.randomUUID();
  const number = await nextTaxPaymentNo(db);
  const now = Date.now();
  const paidOn = input.paidOn ?? (await businessDateFor(db, now));
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: TAX_PAYABLE, debitCents: input.amountCents, creditCents: 0 },
        { account: money.accountCode, debitCents: 0, creditCents: input.amountCents },
      ],
      refEntity: "tax_payment",
      refId: id,
      refNo: number,
      memo: `Tax payment ${number} for ${input.periodFrom}..${input.periodTo}${input.reference ? ` (${input.reference})` : ""}`,
      branchId: input.branchId,
      actorId,
      auditAction: "tax.payment",
      auditEntity: "tax_payment",
      auditEntityId: id,
      sourceModule: "tax",
    },
    { entryDate: paidOn }
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO tax_payments (id, number, branch_id, paid_on, period_from, period_to, amount_cents, method, account_code, bank_account_id, reference, note, journal_entry_id, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(id, number, input.branchId, paidOn, input.periodFrom, input.periodTo, input.amountCents, input.method, money.accountCode, money.bankAccountId, input.reference ?? null, input.note ?? null, now, actorId),
    ...built.stmts,
    db.prepare("UPDATE tax_payments SET journal_entry_id = ? WHERE id = ?").bind(built.entryId, id),
  ]);
  return { id, number, entryNo: built.entryNo };
}
