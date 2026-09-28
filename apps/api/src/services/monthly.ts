import { agingBuckets, cashflowClose, goldClose, KNOWN_CASH_REFS, monthBounds, monthlyPnl } from "@goldos/shared";

export type AgingBuckets = { "0-30": number; "31-60": number; "61-90": number; "90+": number };

export type PartyAging = {
  lines: { partyId: string; name: string; balanceCents: number }[];
  aging: AgingBuckets;
  outstanding: { id: string; number: string; date: string; totalCents: number; outstandingCents: number }[];
  totalCents: number;
  hasData: boolean;
};

export type MonthlyReport = {
  meta: { from: string; to: string; month: string; branchId: string | null };
  sales: { totalCents: number; invoiceCount: number; grossCents: number; returnsCents: number; netCents: number; hasData: boolean };
  purchases: { purchaseValueCents: number; oldGoldCents: number; goldFineMg: number; hasData: boolean };
  expenses: { totalCents: number; pendingCents: number; byCategory: { accountCode: string; name: string; cents: number }[]; hasData: boolean };
  profit: { revenueCents: number; cogsCents: number; grossProfitCents: number; operatingExpensesCents: number; netProfitCents: number; basis: "ledger-posted-only" };
  gold: { openingFineMg: number; inFineMg: number; outFineMg: number; closingFineMg: number; hasData: boolean };
  cashflow: { openingCents: number; inflowsCents: number; outflowsCents: number; closingCents: number; unclassifiedCents: number; hasData: boolean };
  receivables: PartyAging;
  payables: PartyAging;
  estimates: { kind: "estimate"; label: string; note: string }[];
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
  const expCat = await (async () => {
    const sql = `SELECT e2.category_id AS cat, c.account_code AS code, c.name AS name, COALESCE(SUM(e2.amount_cents),0) AS cents FROM expenses e2 JOIN expense_categories c ON c.id=e2.category_id WHERE e2.status='POSTED' AND e2.incurred_on>=? AND e2.incurred_on<=?${opts.branchId ? " AND e2.branch_id=?" : ""} GROUP BY e2.category_id`;
    const vals: unknown[] = opts.branchId ? [from, to, opts.branchId] : [from, to];
    const { results } = await db.prepare(sql).bind(...vals).all<{ cat: string; code: string; name: string; cents: number }>();
    return (results ?? []).map((r) => ({ accountCode: r.code, name: r.name, cents: r.cents }));
  })();
  const warnings: string[] = [];
  const slug = opts.branchId ? `branch:${opts.branchId}` : null;
  async function goldSum(dirCol: "source" | "destination", f: string, t: string, before: boolean): Promise<number> {
    const cmp = before ? `<?` : `>=? AND date(occurred_at/1000,'unixepoch','+330 minutes')<=?`;
    const like = slug
      ? (dirCol === "destination" ? `${dirCol}=?` : `${dirCol}=?`)
      : (dirCol === "destination" ? `${dirCol} LIKE 'branch:%'` : `${dirCol} LIKE 'branch:%'`);
    const vals: unknown[] = before ? (slug ? [f, slug] : [f]) : slug ? [f, t, slug] : [f, t];
    const row = await db.prepare(
      `SELECT COALESCE(SUM(fine_mg),0) AS n FROM gold_ledger WHERE ${like} AND date(occurred_at/1000,'unixepoch','+330 minutes')${cmp}`
    ).bind(...vals).first<{ n: number }>();
    return row?.n ?? 0;
  }
  const gIn = await goldSum("destination", from, to, false);
  const gOut = await goldSum("source", from, to, false);
  const gOpenIn = await goldSum("destination", from, to, true);
  const gOpenOut = await goldSum("source", from, to, true);
  const openingFineMg = gOpenIn - gOpenOut;
  const { closingMg: closingFineMg } = goldClose(openingFineMg, gIn, gOut);
  const goldFineMg = await (async () => {
    const row = await db.prepare(
      `SELECT COALESCE(SUM(fine_mg),0) AS n FROM gold_ledger WHERE type IN ('PURCHASE','OLD_GOLD_PURCHASE') AND date(occurred_at/1000,'unixepoch','+330 minutes')>=? AND date(occurred_at/1000,'unixepoch','+330 minutes')<=?${slug ? " AND destination=?" : ""}`
    ).bind(...(slug ? [from, to, slug] : [from, to])).first<{ n: number }>();
    return row?.n ?? 0;
  })();
  const bankRows = await db.prepare(`SELECT account_code AS code FROM bank_accounts WHERE is_active=1`).all<{ code: string }>();
  const bankCodes = (bankRows.results ?? []).map((r) => r.code).filter((c) => /^\d{4}$/.test(c));
  const cashAccts = ["'1000'", "'1020'", "'1030'", ...bankCodes.map((c) => `'${c}'`)].join(",");
  const cashBranch = opts.branchId ? " AND e.branch_id=?" : "";
  const cashBv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const openingCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date<? AND e.status='POSTED'${cashBranch}`, [from, ...cashBv]);
  const flowRow = await db.prepare(
    `SELECT COALESCE(SUM(l.debit_cents),0) AS dr, COALESCE(SUM(l.credit_cents),0) AS cr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${cashBranch}`
  ).bind(from, to, ...cashBv).first<{ dr: number; cr: number }>();
  const inflowsCents = flowRow?.dr ?? 0;
  const outflowsCents = flowRow?.cr ?? 0;
  const { closingCents } = cashflowClose(openingCents, inflowsCents, outflowsCents);
  const knownCash = [...KNOWN_CASH_REFS, "card_settlement"] as string[];
  const placeholders = knownCash.map(() => "?").join(",");
  const unRow = await db.prepare(
    `SELECT COALESCE(SUM(l.debit_cents+l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${cashBranch} AND (e.ref_entity IS NULL OR e.ref_entity NOT IN (${placeholders}))`
  ).bind(from, to, ...cashBv, ...knownCash).first<{ n: number }>();
  const unclassifiedCents = unRow?.n ?? 0;
  if (unclassifiedCents !== 0) warnings.push(`Unclassified cash ${unclassifiedCents}c blocks snapshot`);
  const bEq = opts.branchId ? " AND e.branch_id = ?" : "";
  const bEqv: unknown[] = opts.branchId ? [opts.branchId] : [];
  // Balances as of `to`: every 1200/2000 line on or before month-end, opening
  // entries included (they are journal lines too — never a separate column).
  const custBal = await db.prepare(
    `SELECT l.party_id AS partyId, COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code = '1200' AND l.party_type = 'customer' AND e.entry_date <= ? AND e.status = 'POSTED'${bEq} GROUP BY l.party_id`
  ).bind(to, ...bEqv).all<{ partyId: string; balance: number }>();
  const custNames = new Map<string, string>();
  for (const row of custBal.results ?? []) {
    const c = await db.prepare("SELECT name FROM customers WHERE id = ?").bind(row.partyId).first<{ name: string }>();
    custNames.set(row.partyId, c?.name ?? row.partyId);
  }
  // Outstanding as of `to`: invoice totals minus payments received on/before
  // `to` (payment created_at business day). Live status column ignored.
  const siB2 = opts.branchId ? " AND si.branch_id = ?" : "";
  const siB2v: unknown[] = opts.branchId ? [opts.branchId] : [];
  const { results: sinvs } = await db.prepare(
    `SELECT si.id, si.number, si.total_cents, date(si.created_at/1000,'unixepoch','+330 minutes') AS d,
            COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit' AND date(sp.created_at/1000,'unixepoch','+330 minutes') <= ?), 0) AS paid
     FROM sales_invoices si WHERE si.status <> 'VOID' AND date(si.created_at/1000,'unixepoch','+330 minutes') <= ?${siB2}`
  ).bind(to, to, ...siB2v).all<{ id: string; number: string; total_cents: number; d: string; paid: number }>();
  const receivablesOut = (sinvs ?? []).map((r) => ({ id: r.id, number: r.number, date: r.d, totalCents: r.total_cents, outstandingCents: r.total_cents - r.paid })).filter((r) => r.outstandingCents > 0);
  const receivablesAging = agingBuckets(to, receivablesOut.map((r) => ({ id: r.id, date: r.date, outstandingCents: r.outstandingCents })));
  // Suppliers mirror: credit-positive (we owe = credit on 2000).
  const supBal = await db.prepare(
    `SELECT l.party_id AS partyId, COALESCE(SUM(l.credit_cents - l.debit_cents),0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code = '2000' AND l.party_type = 'supplier' AND e.entry_date <= ? AND e.status = 'POSTED'${bEq} GROUP BY l.party_id`
  ).bind(to, ...bEqv).all<{ partyId: string; balance: number }>();
  const supNames = new Map<string, string>();
  for (const row of supBal.results ?? []) {
    const s = await db.prepare("SELECT name FROM suppliers WHERE id = ?").bind(row.partyId).first<{ name: string }>();
    supNames.set(row.partyId, s?.name ?? row.partyId);
  }
  const piB = opts.branchId ? " AND pi.branch_id = ?" : "";
  const piBv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const { results: pinvs } = await db.prepare(
    `SELECT pi.id, pi.number, pi.total_cents, date(pi.created_at/1000,'unixepoch','+330 minutes') AS d,
            COALESCE((SELECT SUM(pp.amount_cents) FROM purchase_payments pp WHERE pp.invoice_id = pi.id AND date(pp.created_at/1000,'unixepoch','+330 minutes') <= ?), 0) AS paid
     FROM purchase_invoices pi WHERE pi.status <> 'VOID' AND date(pi.created_at/1000,'unixepoch','+330 minutes') <= ?${piB}`
  ).bind(to, to, ...piBv).all<{ id: string; number: string; total_cents: number; d: string; paid: number }>();
  const payablesOut = (pinvs ?? []).map((r) => ({ id: r.id, number: r.number, date: r.d, totalCents: r.total_cents, outstandingCents: r.total_cents - r.paid })).filter((r) => r.outstandingCents > 0);
  const payablesAging = agingBuckets(to, payablesOut.map((r) => ({ id: r.id, date: r.date, outstandingCents: r.outstandingCents })));
  return {
    meta: { from, to, month: label, branchId: opts.branchId ?? null },
    sales: { totalCents: grossCents, invoiceCount: grossRow?.c ?? 0, grossCents, returnsCents, netCents: revenueCents, hasData: (grossRow?.c ?? 0) > 0 },
    purchases: { purchaseValueCents: purchCents, oldGoldCents: ogCents, goldFineMg, hasData: purchCents !== 0 || ogCents !== 0 || goldFineMg !== 0 },
    expenses: { totalCents: expRow?.p ?? 0, pendingCents: expRow?.pend ?? 0, byCategory: expCat, hasData: (expRow?.p ?? 0) !== 0 },
    profit: { revenueCents, cogsCents, grossProfitCents, operatingExpensesCents: opexCents, netProfitCents, basis: "ledger-posted-only" },
    gold: { openingFineMg, inFineMg: gIn, outFineMg: gOut, closingFineMg, hasData: gIn !== 0 || gOut !== 0 || openingFineMg !== 0 },
    cashflow: { openingCents, inflowsCents, outflowsCents, closingCents, unclassifiedCents, hasData: inflowsCents !== 0 || outflowsCents !== 0 || openingCents !== 0 },
    receivables: { lines: (custBal.results ?? []).map((r) => ({ partyId: r.partyId, name: custNames.get(r.partyId) ?? r.partyId, balanceCents: r.balance })), aging: receivablesAging, outstanding: receivablesOut, totalCents: (custBal.results ?? []).reduce((s, r) => s + r.balance, 0), hasData: receivablesOut.length > 0 },
    payables: { lines: (supBal.results ?? []).map((r) => ({ partyId: r.partyId, name: supNames.get(r.partyId) ?? r.partyId, balanceCents: r.balance })), aging: payablesAging, outstanding: payablesOut, totalCents: (supBal.results ?? []).reduce((s, r) => s + r.balance, 0), hasData: payablesOut.length > 0 },
    estimates: [{ kind: "estimate", label: "Board-rate memo", note: "Weight x current rate is a memo only — not in profit or stock value" }],
    warnings,
  };
}
