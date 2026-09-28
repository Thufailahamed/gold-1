import { agingBuckets, cashflowClose, goldClose, KNOWN_CASH_REFS, monthBounds, monthlyPnl } from "@goldos/shared";

export type AgingBuckets = { "0-30": number; "31-60": number; "61-90": number; "90+": number };

export type PartyAging = {
  lines: { partyId: string; name: string; balanceCents: number }[];
  aging: AgingBuckets;
  outstanding: { id: string; number: string; date: string; totalCents: number; outstandingCents: number }[];
  totalCents: number;
  hasData: boolean;
};

export type InventoryValuation = {
  jewelleryCents: number;
  goldCents: number;
  byBranch: { key: string; cents: number }[];
  byCategory: { key: string; cents: number }[];
  byPurity: { key: string; cents: number }[];
  uncostedPieces: number;
  method: string;
  basis: "book-cost";
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
  inventory: InventoryValuation;
  estimates: { kind: "estimate"; label: string; note: string }[];
  warnings: string[];
};

async function firstOrNull<T>(db: D1Database, sql: string, vals: unknown[]): Promise<T | null> {
  const stmt = db.prepare(sql);
  return (vals.length ? await stmt.bind(...vals).first<T>() : await stmt.first<T>()) ?? null;
}

async function allRows<T>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql);
  const res = vals.length ? await stmt.bind(...vals).all<T>() : await stmt.all<T>();
  return (res.results ?? []) as T[];
}

export const MONTHLY_SECTIONS = ["sales", "purchases", "gold", "expenses", "profit", "cashflow", "receivables", "payables", "inventory"] as const;
export type MonthlySection = (typeof MONTHLY_SECTIONS)[number];

export function sectionRows(section: MonthlySection, report: MonthlyReport): { cols: string[]; rows: Record<string, unknown>[] } {
  const flat = (o: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v as Record<string, unknown>));
      else if (!Array.isArray(v)) out[k] = v;
    }
    return out;
  };
  const pick = (o: unknown): Record<string, unknown>[] => {
    if (Array.isArray(o)) return o as Record<string, unknown>[];
    if (o !== null && typeof o === "object") return [flat(o as Record<string, unknown>)];
    return [];
  };
  const r = (report as unknown as Record<string, unknown>)[section as string];
  if (section === "receivables" || section === "payables") {
    const p = r as { lines: Record<string, unknown>[]; aging: Record<string, number> };
    return { cols: ["partyId", "name", "balanceCents"], rows: [...(p.lines ?? []), { partyId: "AGING", name: JSON.stringify(p.aging ?? {}), balanceCents: "" }] };
  }
  if (section === "inventory") {
    const inv = (r ?? {}) as { byBranch?: Record<string, unknown>[]; byCategory?: Record<string, unknown>[]; byPurity?: Record<string, unknown>[] } & Record<string, unknown>;
    const { byBranch, byCategory, byPurity, ...rest } = inv;
    return {
      cols: ["scope", "key", "cents"],
      rows: [
        ...Object.entries(rest).filter(([, v]) => typeof v !== "object").map(([key, cents]) => ({ scope: "total", key, cents })),
        ...(byBranch ?? []).map((b) => ({ scope: "branch", ...b })),
        ...(byCategory ?? []).map((b) => ({ scope: "category", ...b })),
        ...(byPurity ?? []).map((b) => ({ scope: "purity", ...b })),
      ],
    };
  }
  if (section === "expenses") {
    const e = (r ?? {}) as { byCategory?: Record<string, unknown>[]; totalCents?: number; pendingCents?: number };
    return { cols: ["accountCode", "name", "cents"], rows: [...(e.byCategory ?? []), { accountCode: "TOTAL", name: "", cents: e.totalCents ?? 0 }, { accountCode: "PENDING", name: "", cents: e.pendingCents ?? 0 }] };
  }
  const rows = pick(r);
  return { cols: Object.keys(rows[0] ?? { note: "empty" }), rows: rows.length ? rows : [{ note: "no data" }] };
}

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
    // Placeholder order is the slug first (when present), then the dates —
    // the bind array must follow the same order.
    const like = slug
      ? (dirCol === "destination" ? `${dirCol}=?` : `${dirCol}=?`)
      : (dirCol === "destination" ? `${dirCol} LIKE 'branch:%'` : `${dirCol} LIKE 'branch:%'`);
    const vals: unknown[] = before ? (slug ? [slug, f] : [f]) : slug ? [slug, f, t] : [f, t];
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
  // Cash truth counts every entry including reversals (an entry and its
  // mirror net to zero — counting one side only would phantom-inflate the
  // drawer). This matches accountBalance and the day-close cash query, which
  // carry no status filter either.
  const openingCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date<?${cashBranch}`, [from, ...cashBv]);
  const flowRow = await db.prepare(
    `SELECT COALESCE(SUM(l.debit_cents),0) AS dr, COALESCE(SUM(l.credit_cents),0) AS cr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date>=? AND e.entry_date<=?${cashBranch}`
  ).bind(from, to, ...cashBv).first<{ dr: number; cr: number }>();
  const inflowsCents = flowRow?.dr ?? 0;
  const outflowsCents = flowRow?.cr ?? 0;
  const { closingCents } = cashflowClose(openingCents, inflowsCents, outflowsCents);
  const knownCash = [...KNOWN_CASH_REFS, "card_settlement"] as string[];
  const placeholders = knownCash.map(() => "?").join(",");
  // Net per unknown ref (never across refs): an error and its reversal net to
  // zero and must not block the snapshot forever — same rule as the day-close
  // gate. Any real unnamed movement still blocks.
  const { results: unRows } = await db.prepare(
    `SELECT e.ref_entity AS ref, COALESCE(SUM(l.debit_cents),0) AS dr, COALESCE(SUM(l.credit_cents),0) AS cr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code IN (${cashAccts}) AND e.entry_date>=? AND e.entry_date<=?${cashBranch} AND (e.ref_entity IS NULL OR e.ref_entity NOT IN (${placeholders})) GROUP BY e.ref_entity`
  ).bind(from, to, ...cashBv, ...knownCash).all<{ ref: string | null; dr: number; cr: number }>();
  const byRef = new Map<string, { dr: number; cr: number }>();
  for (const r of unRows ?? []) {
    const key = r.ref ?? "";
    // Cash inflows are debits, outflows are credits; net unnamed movement per ref.
    byRef.set(key, { dr: (byRef.get(key)?.dr ?? 0) + r.dr, cr: (byRef.get(key)?.cr ?? 0) + r.cr });
  }
  let unclassifiedCents = 0;
  for (const v of byRef.values()) unclassifiedCents += Math.abs(v.cr - v.dr);
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
  // Book-cost valuation as of `to`. Jewellery: IN_STOCK-ish statuses (same set
  // the gold consistency check counts). Lots: remaining-fine share of lot
  // cost. Old gold: purchase value of bought-but-unmelted items. No rates.
  const inStock = "'IN_STOCK','TRANSFER_PENDING','RESERVED','IN_REPAIR','IN_MANUFACTURING','RETURNED'";
  const jB = opts.branchId ? " AND p.branch_id = ?" : "";
  const jBv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const jewTot = await firstOrNull<{ cents: number; pieces: number; uncosted: number }>(db, `SELECT COALESCE(SUM(p.cost_cents),0) AS cents, COUNT(*) AS pieces, SUM(CASE WHEN p.cost_cents IS NULL THEN 1 ELSE 0 END) AS uncosted FROM products p WHERE p.status IN (${inStock})${jB}`, jBv);
  const jewCat = await allRows<{ key: string; cents: number }>(db, `SELECT c.name AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p JOIN categories c ON c.id = p.category_id WHERE p.status IN (${inStock})${jB} GROUP BY c.name`, jBv);
  const jewPur = await allRows<{ key: string; cents: number }>(db, `SELECT pu.karat AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.status IN (${inStock})${jB} GROUP BY pu.karat`, jBv);
  const brOnly = opts.branchId ? " AND p.branch_id = ?" : "";
  const brOnlyv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const jewBr = await allRows<{ key: string; cents: number }>(db, `SELECT p.branch_id AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p WHERE p.status IN (${inStock})${brOnly} GROUP BY p.branch_id`, brOnlyv);
  const ogB = opts.branchId ? " AND branch_id = ?" : "";
  const ogBv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const ogTot = await firstOrNull<{ cents: number }>(db, `SELECT COALESCE(SUM(purchase_value_cents),0) AS cents FROM old_gold_items WHERE status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${ogB}`, ogBv);
  const ogPur = await allRows<{ key: string; cents: number }>(db,
    `SELECT COALESCE(pu.karat, 'UNRESOLVED') AS key, COALESCE(SUM(og.purchase_value_cents),0) AS cents
     FROM old_gold_items og LEFT JOIN purities pu ON pu.id = og.purity_id OR pu.permille = og.tested_permille
     WHERE og.status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${ogB} GROUP BY key`, ogBv);
  const ogBr = await allRows<{ key: string; cents: number }>(db, `SELECT branch_id AS key, COALESCE(SUM(purchase_value_cents),0) AS cents FROM old_gold_items WHERE status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${ogB} GROUP BY branch_id`, ogBv);
  const lotB = opts.branchId ? " AND b.branch_id = ?" : "";
  const lotBv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const lots = await allRows<{ id: string; batchId: string; lotNumber: string; fineMg: number; costCents: number; permille: number; branchId: string }>(db,
    `SELECT o.id, o.batch_id AS batchId, o.lot_number AS lotNumber, o.fine_mg AS fineMg, o.cost_cents AS costCents, o.permille, b.branch_id AS branchId FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id AND b.status <> 'VOID'${lotB}`, lotBv);
  const allocs = await allRows<{ batchId: string; lotNo: string; used: number }>(db,
    `SELECT m.lot_batch_id AS batchId, m.lot_number AS lotNo, COALESCE(SUM(m.fine_mg),0) AS used FROM manufacturing_materials m JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID' GROUP BY m.lot_batch_id, m.lot_number`, []);
  const usedByLot = new Map(allocs.map((a) => [`${a.batchId}::${a.lotNo}`, a.used]));
  const karats = new Map((await allRows<{ karat: string; permille: number }>(db, `SELECT karat, permille FROM purities`, [])).map((r) => [r.permille, r.karat]));
  let lotsCents = 0;
  const lotBr = new Map<string, number>();
  const lotPur = new Map<string, number>();
  for (const lot of lots) {
    const remaining = lot.fineMg - (usedByLot.get(`${lot.batchId}::${lot.lotNumber}`) ?? 0);
    if (remaining <= 0 || lot.fineMg <= 0) continue;
    const value = Math.round((lot.costCents * remaining) / lot.fineMg);
    lotsCents += value;
    lotBr.set(lot.branchId, (lotBr.get(lot.branchId) ?? 0) + value);
    const key = karats.get(lot.permille) ?? `${lot.permille}`;
    lotPur.set(key, (lotPur.get(key) ?? 0) + value);
  }
  const mergeSum = (rows: { key: string; cents: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.key, (m.get(r.key) ?? 0) + r.cents);
    return m;
  };
  const byBranch = mergeSum([...jewBr, ...ogBr.map((r) => ({ key: r.key, cents: r.cents })), ...[...lotBr].map(([key, cents]) => ({ key, cents }))]);
  const byPurity = mergeSum([...jewPur, ...ogPur, ...[...lotPur].map(([key, cents]) => ({ key, cents }))]);
  const jewelleryCents = jewTot?.cents ?? 0;
  const goldCents = (ogTot?.cents ?? 0) + lotsCents;
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
    inventory: {
      jewelleryCents,
      goldCents,
      byBranch: [...byBranch].map(([key, cents]) => ({ key, cents })),
      byCategory: jewCat,
      byPurity: [...byPurity].map(([key, cents]) => ({ key, cents })),
      uncostedPieces: jewTot?.uncosted ?? 0,
      method: "book cost; lots pro-rata by remaining fine weight; byCategory jewellery-only",
      basis: "book-cost",
      hasData: jewelleryCents !== 0 || goldCents !== 0,
    },
    estimates: [{ kind: "estimate", label: "Board-rate memo", note: "Weight x current rate is a memo only — not in profit or stock value" }],
    warnings,
  };
}
