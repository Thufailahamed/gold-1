import { monthBounds, monthlyPnl } from "@goldos/shared";

export type MonthlyReport = {
  meta: { from: string; to: string; month: string; branchId: string | null };
  sales: { totalCents: number; invoiceCount: number; grossCents: number; returnsCents: number; netCents: number; hasData: boolean };
  purchases: { purchaseValueCents: number; oldGoldCents: number; goldFineMg: number; hasData: boolean };
  expenses: { totalCents: number; pendingCents: number; byCategory: { accountCode: string; name: string; cents: number }[]; hasData: boolean };
  profit: { revenueCents: number; cogsCents: number; grossProfitCents: number; operatingExpensesCents: number; netProfitCents: number; basis: "ledger-posted-only" };
  warnings: string[];
};

async function sumCents(db: D1Database, sql: string, vals: unknown[]): Promise<number> {
  const stmt = vals.length ? db.prepare(sql).bind(...vals) : db.prepare(sql);
  const row = await stmt.first<{ n: number }>();
  return row?.n ?? 0;
}

export async function buildMonthlyReport(db: D1Database, opts: { month: number; year: number; branchId?: string; categoryId?: string; purityId?: string; staffId?: string }): Promise<MonthlyReport> {
  const { from, to, label } = monthBounds(opts.year, opts.month);
  const b = opts.branchId ? " AND e.branch_id = ?" : "";
  const bv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const revenueCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='4000' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const cogsCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5000' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const opexCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code GLOB '60[0-9][0-9]' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const meltLossCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5100' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const mfgLossCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5200' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const adjNetCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5300' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const { grossProfitCents, netProfitCents } = monthlyPnl({ revenueCents, cogsCents, opexCents, meltLossCents, mfgLossCents, adjNetCents });
  const sib = opts.branchId ? " AND si.branch_id=?" : "";
  const sibv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const staff = opts.staffId ? " AND si.salesperson_id=?" : "";
  const staffv: unknown[] = opts.staffId ? [opts.staffId] : [];
  const grossRow = await db.prepare(
    `SELECT COALESCE(SUM(si.total_cents),0) AS g, COUNT(*) AS c FROM sales_invoices si WHERE si.status<>'VOID' AND date(si.created_at/1000,'unixepoch','+330 minutes')>=? AND date(si.created_at/1000,'unixepoch','+330 minutes')<=?${sib}${staff}`
  ).bind(from, to, ...sibv, ...staffv).first<{ g: number; c: number }>();
  const retRow = await db.prepare(
    `SELECT COALESCE(SUM(sr.refund_cents+sr.credit_cents),0) AS r FROM sales_returns sr JOIN sales_invoices si2 ON si2.id=sr.invoice_id WHERE sr.status='COMPLETE' AND date(sr.created_at/1000,'unixepoch','+330 minutes')>=? AND date(sr.created_at/1000,'unixepoch','+330 minutes')<=?`
  ).bind(from, to).first<{ r: number }>();
  const grossCents = grossRow?.g ?? 0;
  const returnsCents = retRow?.r ?? 0;
  const purchCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='1100' AND e.source_module='purchases' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const ogCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='1100' AND e.source_module='oldgold' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const expRow = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status='POSTED' THEN amount_cents ELSE 0 END),0) AS p, COALESCE(SUM(CASE WHEN status='PENDING_APPROVAL' THEN amount_cents ELSE 0 END),0) AS pend FROM expenses WHERE incurred_on>=? AND incurred_on<=?${opts.branchId ? " AND branch_id=?" : ""}`
  ).bind(from, to, ...(opts.branchId ? [opts.branchId] : [])).first<{ p: number; pend: number }>();
  return {
    meta: { from, to, month: label, branchId: opts.branchId ?? null },
    sales: { totalCents: grossCents, invoiceCount: grossRow?.c ?? 0, grossCents, returnsCents, netCents: revenueCents, hasData: (grossRow?.c ?? 0) > 0 },
    purchases: { purchaseValueCents: purchCents, oldGoldCents: ogCents, goldFineMg: 0, hasData: purchCents !== 0 || ogCents !== 0 },
    expenses: { totalCents: expRow?.p ?? 0, pendingCents: expRow?.pend ?? 0, byCategory: [], hasData: (expRow?.p ?? 0) !== 0 },
    profit: { revenueCents, cogsCents, grossProfitCents, operatingExpensesCents: opexCents, netProfitCents, basis: "ledger-posted-only" },
    warnings: [],
  };
}
