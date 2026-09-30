import { addDays, explainingAmounts } from "@goldos/shared";
import { buildClosingReport, type ClosingReport, type ClosingRow } from "./dayclose";
import { LOCAL_DAY, reconcile } from "./reconcile";

/* ------------------------------------------------------------ investigate */

export type CashMovement = {
  entryId: string;
  entryNo: string;
  refEntity: string | null;
  refNo: string | null;
  memo: string | null;
  /** Signed from the drawer's side: positive in, negative out. */
  cents: number;
  createdAt: number;
  createdBy: string | null;
  /** Keyed on a different day than it is dated — it moved another day's figures. */
  backdated: boolean;
  reversal: boolean;
};

export type DocumentIssue = {
  kind: string;
  documentId: string;
  number: string;
  problem: string;
  documentCents: number;
  ledgerCents: number | null;
};

export type Suspect = { explanation: string; cents: number; items: string[] };

export type DayInvestigation = {
  branchId: string;
  date: string;
  expectedCents: number;
  actualCents: number | null;
  differenceCents: number | null;
  failingChecks: { id: string; label: string; expected: number; actual: number; difference: number; detail: string[] }[];
  documentIssues: DocumentIssue[];
  cashMovements: CashMovement[];
  suspects: Suspect[];
  pending: {
    expenses: { id: string; number: string; amountCents: number; description: string }[];
    transfersIn: { id: string; number: string; amountCents: number; sentOn: string; fromBranchId: string }[];
    approvals: { id: string; action: string; reason: string; createdAt: number }[];
  };
  lateEntries: { entryNo: string; entryDate: string; refEntity: string | null; cashCents: number; memo: string | null }[];
  outstanding: { cardClearingCents: number; oldestUnsettledCardDate: string | null; cashInTransitOutCents: number };
};

type Row = Record<string, unknown>;
const all = async <T = Row>(db: D1Database, sql: string, vals: unknown[]): Promise<T[]> =>
  ((await db.prepare(sql).bind(...vals).all<T>()).results ?? []) as T[];

/**
 * Everything the shop needs to find a missing amount on one day at one
 * branch: which reconciliation checks fail and by how much, which documents
 * are not posted the way they say, every drawer movement with who keyed it
 * and when, what is waiting (expenses, transfers, approvals) and which single
 * movement or pair of movements is exactly the size of the cash difference.
 *
 * Read-only. It never corrects anything — a finding is fixed through the flow
 * that owns it, or through a manual adjustment with its reason.
 */
export async function investigateDay(
  db: D1Database,
  opts: { branchId: string; date: string; actualCents?: number }
): Promise<DayInvestigation> {
  const { branchId, date } = opts;
  const [report, recon] = await Promise.all([
    buildClosingReport(db, { branchId, date }),
    reconcile(db, { date, branchId }),
  ]);
  const expectedCents = report.closing.expectedCents;
  const differenceCents = opts.actualCents === undefined ? null : opts.actualCents - expectedCents;

  const documentIssues = await findDocumentIssues(db, branchId, date);

  const movements = await all<{
    entry_id: string; entry_no: string; ref_entity: string | null; ref_no: string | null; memo: string | null;
    cents: number; created_at: number; created_by: string | null; created_day: string; reverses_entry_id: string | null;
  }>(
    db,
    `SELECT e.id AS entry_id, e.entry_no, e.ref_entity, e.ref_no, e.memo,
            SUM(l.debit_cents - l.credit_cents) AS cents, e.created_at, u.name AS created_by,
            ${LOCAL_DAY("e.created_at")} AS created_day, e.reverses_entry_id
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     LEFT JOIN users u ON u.id = e.created_by
     WHERE l.account_code = '1000' AND e.branch_id = ? AND e.entry_date = ?
     GROUP BY e.id ORDER BY e.created_at`,
    [branchId, date]
  );
  const cashMovements: CashMovement[] = movements
    .filter((m) => m.cents !== 0)
    .map((m) => ({
      entryId: m.entry_id,
      entryNo: m.entry_no,
      refEntity: m.ref_entity,
      refNo: m.ref_no,
      memo: m.memo,
      cents: m.cents,
      createdAt: m.created_at,
      createdBy: m.created_by,
      backdated: m.created_day !== date,
      reversal: m.reverses_entry_id !== null,
    }));

  const pendingExpenses = await all<{ id: string; number: string; amount_cents: number; description: string }>(
    db,
    `SELECT id, number, amount_cents, description FROM expenses
     WHERE branch_id = ? AND incurred_on = ? AND status = 'PENDING_APPROVAL' ORDER BY created_at`,
    [branchId, date]
  );
  const transfersIn = await all<{ id: string; number: string; amount_cents: number; sent_on: string; from_branch_id: string }>(
    db,
    `SELECT id, number, amount_cents, sent_on, from_branch_id FROM cash_transfers
     WHERE to_branch_id = ? AND status <> 'COMPLETE' AND sent_on <= ? ORDER BY sent_on`,
    [branchId, date]
  );
  const approvals = await all<{ id: string; action: string; reason: string; created_at: number }>(
    db,
    `SELECT id, action, reason, created_at FROM approvals
     WHERE branch_id = ? AND status = 'PENDING' AND ${LOCAL_DAY("created_at")} <= ? ORDER BY created_at DESC LIMIT 50`,
    [branchId, date]
  );

  // Keyed today, dated earlier: these changed an earlier day's closing cash,
  // and so today's opening. The usual reason an opening "does not match".
  const late = await all<{ entry_no: string; entry_date: string; ref_entity: string | null; memo: string | null; cash: number }>(
    db,
    `SELECT e.entry_no, e.entry_date, e.ref_entity, e.memo,
            COALESCE(SUM(CASE WHEN l.account_code = '1000' THEN l.debit_cents - l.credit_cents ELSE 0 END), 0) AS cash
     FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     WHERE e.branch_id = ? AND ${LOCAL_DAY("e.created_at")} = ? AND e.entry_date < ?
     GROUP BY e.id ORDER BY e.created_at`,
    [branchId, date, date]
  );

  const suspects: Suspect[] = [];
  if (differenceCents) {
    const fmt = (m: CashMovement) => `${m.entryNo} ${m.refNo ?? m.refEntity ?? ""} (${m.cents > 0 ? "in" : "out"} ${Math.abs(m.cents)}c)`.trim();
    const amounts = cashMovements.map((m) => m.cents);
    const { singles, pairs } = explainingAmounts(differenceCents, amounts);
    for (const i of singles) {
      const m = cashMovements[i]!;
      // Short and the movement is an inflow: it may never have been taken, or
      // was keyed twice. Over and it is an outflow: it may never have been paid.
      const why =
        differenceCents < 0
          ? m.cents > 0
            ? "An inflow the size of the shortage — keyed twice, or recorded but never taken"
            : "An outflow the size of the shortage — paid out twice, or paid more than recorded"
          : m.cents < 0
            ? "An outflow the size of the overage — recorded but never actually paid out"
            : "An inflow the size of the overage — taken in twice, or taken but keyed short";
      suspects.push({ explanation: why, cents: Math.abs(m.cents), items: [fmt(m)] });
    }
    for (const [i, j] of pairs)
      suspects.push({ explanation: "Two movements that together equal the difference", cents: Math.abs(differenceCents), items: [fmt(cashMovements[i]!), fmt(cashMovements[j]!)] });
    if (differenceCents < 0) {
      for (const e of pendingExpenses)
        if (e.amount_cents === -differenceCents)
          suspects.push({ explanation: "An expense paid from the drawer but still awaiting approval, so the ledger has not seen it", cents: e.amount_cents, items: [`${e.number} ${e.description}`] });
      const pendingTotal = pendingExpenses.reduce((s, e) => s + e.amount_cents, 0);
      if (pendingExpenses.length > 1 && pendingTotal === -differenceCents)
        suspects.push({ explanation: "All expenses awaiting approval together equal the shortage", cents: pendingTotal, items: pendingExpenses.map((e) => e.number) });
    } else {
      for (const t of transfersIn)
        if (t.amount_cents === differenceCents)
          suspects.push({ explanation: "A cash transfer to this branch that has arrived in the drawer but was not received in the system", cents: t.amount_cents, items: [t.number] });
    }
    if (report.card.netCents > 0 && Math.abs(differenceCents) <= report.card.netCents && differenceCents > 0)
      suspects.push({
        explanation: "Cash over while card sales exist — check for a cash sale keyed as card",
        cents: differenceCents,
        items: [`card takings ${report.card.netCents}c`],
      });
    for (const m of cashMovements.filter((x) => x.backdated))
      suspects.push({ explanation: "Keyed on a different day than it is dated — check it really belongs to this drawer count", cents: Math.abs(m.cents), items: [fmt(m)] });
  }

  const card = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1020' AND e.branch_id = ? AND e.entry_date <= ?`
    )
    .bind(branchId, date)
    .first<{ n: number }>();
  const lastSettled = await db
    .prepare(
      `SELECT MAX(e.entry_date) AS d FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1020' AND e.ref_entity = 'card_settlement' AND e.entry_date <= ?`
    )
    .bind(date)
    .first<{ d: string | null }>();
  const oldestUnsettled = (card?.n ?? 0) > 0
    ? await db
        .prepare(
          `SELECT MIN(e.entry_date) AS d FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_code = '1020' AND l.debit_cents > 0 AND e.branch_id = ? AND e.entry_date <= ? AND e.entry_date > ?`
        )
        .bind(branchId, date, lastSettled?.d ?? "0000-00-00")
        .first<{ d: string | null }>()
    : null;
  const transitOut = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM cash_transfers WHERE from_branch_id = ? AND status <> 'COMPLETE' AND sent_on <= ?`
    )
    .bind(branchId, date)
    .first<{ n: number }>();

  return {
    branchId,
    date,
    expectedCents,
    actualCents: opts.actualCents ?? null,
    differenceCents,
    failingChecks: recon.checks
      .filter((c) => !c.pass)
      .map((c) => ({ id: c.id, label: c.label, expected: c.expected, actual: c.actual, difference: c.difference, detail: c.detail })),
    documentIssues,
    cashMovements,
    suspects,
    pending: {
      expenses: pendingExpenses.map((e) => ({ id: e.id, number: e.number, amountCents: e.amount_cents, description: e.description })),
      transfersIn: transfersIn.map((t) => ({ id: t.id, number: t.number, amountCents: t.amount_cents, sentOn: t.sent_on, fromBranchId: t.from_branch_id })),
      approvals: approvals.map((a) => ({ id: a.id, action: a.action, reason: a.reason, createdAt: a.created_at })),
    },
    lateEntries: late.map((l) => ({ entryNo: l.entry_no, entryDate: l.entry_date, refEntity: l.ref_entity, cashCents: l.cash, memo: l.memo })),
    outstanding: {
      cardClearingCents: card?.n ?? 0,
      oldestUnsettledCardDate: oldestUnsettled?.d ?? null,
      cashInTransitOutCents: transitOut?.n ?? 0,
    },
  };
}

/**
 * Document-by-document: every document of the day that should have posted,
 * compared with what its own journal entry says. These are what a failing
 * cross-foot is made of — the check reports the total, this names the bill.
 */
async function findDocumentIssues(db: D1Database, branchId: string, date: string): Promise<DocumentIssue[]> {
  const issues: DocumentIssue[] = [];
  const LIVE = (col: string) => `(${col} IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.id = ${col} AND r.status = 'REVERSED'))`;

  const sales = await all<{ id: string; number: string; total: number; tax: number; paid: number; entry: string | null; rev: number | null; money: number | null }>(
    db,
    `SELECT si.id, si.number, si.total_cents AS total, si.tax_cents AS tax, si.journal_entry_id AS entry,
            COALESCE((SELECT SUM(amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id), 0) AS paid,
            (SELECT SUM(l.credit_cents - l.debit_cents) FROM journal_lines l WHERE l.entry_id = si.journal_entry_id AND l.account_code = '4000') AS rev,
            (SELECT SUM(l.debit_cents) FROM journal_lines l WHERE l.entry_id = si.journal_entry_id AND l.account_code NOT IN ('5000','1100')) AS money
     FROM sales_invoices si
     WHERE si.branch_id = ? AND si.status <> 'VOID' AND ${LOCAL_DAY("si.created_at")} = ? AND ${LIVE("si.journal_entry_id")}`,
    [branchId, date]
  );
  for (const s of sales) {
    if (!s.entry) issues.push({ kind: "sale", documentId: s.id, number: s.number, problem: "Sale has no journal entry", documentCents: s.total, ledgerCents: null });
    else {
      if ((s.rev ?? 0) !== s.total - s.tax)
        issues.push({ kind: "sale", documentId: s.id, number: s.number, problem: "Revenue posted differs from the invoice (net of tax)", documentCents: s.total - s.tax, ledgerCents: s.rev ?? 0 });
      if ((s.money ?? 0) !== s.total)
        issues.push({ kind: "sale", documentId: s.id, number: s.number, problem: "Money legs posted differ from the invoice total", documentCents: s.total, ledgerCents: s.money ?? 0 });
    }
    if (s.paid !== s.total)
      issues.push({ kind: "sale", documentId: s.id, number: s.number, problem: "Payments recorded differ from the invoice total", documentCents: s.total, ledgerCents: s.paid });
  }

  const returns = await all<{ id: string; number: string; value: number; tax: number; entry: string | null; rev: number | null }>(
    db,
    `SELECT sr.id, sr.number, sr.refund_cents + sr.credit_cents AS value, sr.tax_cents AS tax, sr.journal_entry_id AS entry,
            (SELECT SUM(l.debit_cents - l.credit_cents) FROM journal_lines l WHERE l.entry_id = sr.journal_entry_id AND l.account_code = '4000') AS rev
     FROM sales_returns sr JOIN sales_invoices si ON si.id = sr.invoice_id
     WHERE si.branch_id = ? AND sr.status = 'COMPLETE' AND ${LOCAL_DAY("sr.created_at")} = ?`,
    [branchId, date]
  );
  for (const r of returns) {
    if (!r.entry) issues.push({ kind: "return", documentId: r.id, number: r.number, problem: "Return has no journal entry", documentCents: r.value, ledgerCents: null });
    else if ((r.rev ?? 0) !== r.value - r.tax)
      issues.push({ kind: "return", documentId: r.id, number: r.number, problem: "Revenue reversed differs from the return (net of tax)", documentCents: r.value - r.tax, ledgerCents: r.rev ?? 0 });
  }

  const purchases = await all<{ id: string; number: string; total: number; entry: string | null; inv: number | null }>(
    db,
    `SELECT pi.id, pi.number, pi.total_cents AS total, pi.journal_entry_id AS entry,
            (SELECT SUM(l.debit_cents - l.credit_cents) FROM journal_lines l WHERE l.entry_id = pi.journal_entry_id AND l.account_code = '1100') AS inv
     FROM purchase_invoices pi
     WHERE pi.branch_id = ? AND pi.status <> 'VOID' AND ${LOCAL_DAY("pi.created_at")} = ? AND ${LIVE("pi.journal_entry_id")}`,
    [branchId, date]
  );
  for (const p of purchases) {
    if (!p.entry) issues.push({ kind: "purchase", documentId: p.id, number: p.number, problem: "Purchase has no journal entry", documentCents: p.total, ledgerCents: null });
    else if ((p.inv ?? 0) !== p.total)
      issues.push({ kind: "purchase", documentId: p.id, number: p.number, problem: "Inventory posted differs from the invoice total", documentCents: p.total, ledgerCents: p.inv ?? 0 });
  }

  const pays = await all<{ id: string; number: string; amount: number; ledger: number | null }>(
    db,
    `SELECT pp.id, pi.number, pp.amount_cents AS amount,
            (SELECT SUM(l.debit_cents) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
             WHERE e.ref_entity = 'purchase_payment' AND e.ref_id = pp.id AND l.account_code = '2000') AS ledger
     FROM purchase_payments pp JOIN purchase_invoices pi ON pi.id = pp.invoice_id
     WHERE pi.branch_id = ? AND ${LOCAL_DAY("pp.created_at")} = ?`,
    [branchId, date]
  );
  for (const p of pays)
    if ((p.ledger ?? 0) !== p.amount)
      issues.push({ kind: "supplier_payment", documentId: p.id, number: p.number, problem: p.ledger === null ? "Supplier payment has no journal entry" : "Supplier payment posted differs from the payment", documentCents: p.amount, ledgerCents: p.ledger });

  const expenses = await all<{ id: string; number: string; amount: number; entry: string | null; ledger: number | null }>(
    db,
    `SELECT x.id, x.number, x.amount_cents AS amount, x.journal_entry_id AS entry,
            (SELECT SUM(l.credit_cents) FROM journal_lines l WHERE l.entry_id = x.journal_entry_id) AS ledger
     FROM expenses x WHERE x.branch_id = ? AND x.incurred_on = ? AND x.status = 'POSTED'`,
    [branchId, date]
  );
  for (const x of expenses)
    if (!x.entry || (x.ledger ?? 0) !== x.amount)
      issues.push({ kind: "expense", documentId: x.id, number: x.number, problem: x.entry ? "Expense posted differs from the expense" : "Posted expense has no journal entry", documentCents: x.amount, ledgerCents: x.entry ? x.ledger : null });

  const receipts = await all<{ id: string; number: string; amount: number; entry: string | null }>(
    db,
    `SELECT id, number, amount_cents AS amount, journal_entry_id AS entry FROM customer_receipts
     WHERE branch_id = ? AND receipt_date = ? AND status = 'POSTED'`,
    [branchId, date]
  );
  for (const r of receipts)
    if (!r.entry) issues.push({ kind: "receipt", documentId: r.id, number: r.number, problem: "Receipt has no journal entry", documentCents: r.amount, ledgerCents: null });

  return issues;
}

/* ---------------------------------------------------------- unclosed days */

/**
 * Days with activity at the branch that were never closed, or were reopened
 * and not closed again. Opening cash comes from the ledger so a skipped close
 * does not corrupt the next one — but nobody counted that drawer, and a
 * shortage on a skipped day is only found when someone looks for it here.
 */
export async function listUnclosedDays(
  db: D1Database,
  opts: { branchId: string; from: string; to: string }
): Promise<{ date: string; status: "NOT_CLOSED" | "REOPENED"; entries: number; cashMovementCents: number }[]> {
  const rows = await all<{ d: string; entries: number; cash: number }>(
    db,
    `SELECT e.entry_date AS d, COUNT(DISTINCT e.id) AS entries,
            COALESCE(SUM(CASE WHEN l.account_code = '1000' THEN l.debit_cents + l.credit_cents ELSE 0 END), 0) AS cash
     FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
     WHERE e.branch_id = ? AND e.entry_date >= ? AND e.entry_date <= ?
     GROUP BY e.entry_date`,
    [opts.branchId, opts.from, opts.to]
  );
  const closings = await all<{ close_date: string; status: string }>(
    db,
    "SELECT close_date, status FROM day_closings WHERE branch_id = ? AND close_date >= ? AND close_date <= ?",
    [opts.branchId, opts.from, opts.to]
  );
  const state = new Map(closings.map((c) => [c.close_date, c.status]));
  return rows
    .filter((r) => state.get(r.d) !== "CLOSED")
    .map((r) => ({ date: r.d, status: state.get(r.d) === "REOPENED" ? ("REOPENED" as const) : ("NOT_CLOSED" as const), entries: r.entries, cashMovementCents: r.cash }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* --------------------------------------------------------------- variance */

export type VarianceReport = {
  from: string;
  to: string;
  days: number;
  daysShort: number;
  daysOver: number;
  shortCents: number;
  overCents: number;
  netCents: number;
  correctedCents: number;
  cardDifferenceCents: number;
  rows: { id: string; branchId: string; date: string; expectedCents: number; actualCents: number; differenceCents: number; reason: string | null; closedBy: string | null; cardDifferenceCents: number | null }[];
  byBranch: { branchId: string; days: number; shortCents: number; overCents: number; netCents: number }[];
  byCloser: { closedBy: string; days: number; shortCents: number; overCents: number }[];
};

/**
 * Shortages and overages across closed days. One short day is a counting
 * mistake; the same closer short every Friday is a pattern, and this is the
 * report that shows it.
 */
export async function varianceReport(db: D1Database, opts: { from: string; to: string; branchId?: string }): Promise<VarianceReport> {
  const b = opts.branchId ? " AND d.branch_id = ?" : "";
  const rows = await all<{
    id: string; branch_id: string; close_date: string; expected_cents: number; actual_cents: number; difference_cents: number;
    difference_reason: string | null; closer: string | null; card_expected_cents: number | null; card_actual_cents: number | null; correction_cents: number;
  }>(
    db,
    `SELECT d.id, d.branch_id, d.close_date, d.expected_cents, d.actual_cents, d.difference_cents, d.difference_reason,
            COALESCE(u.name, d.closed_by) AS closer, d.card_expected_cents, d.card_actual_cents, d.correction_cents
     FROM day_closings d LEFT JOIN users u ON u.id = d.closed_by
     WHERE d.status = 'CLOSED' AND d.close_date >= ? AND d.close_date <= ?${b}
     ORDER BY d.close_date DESC`,
    [opts.from, opts.to, ...(opts.branchId ? [opts.branchId] : [])]
  );
  const out: VarianceReport = {
    from: opts.from, to: opts.to, days: rows.length, daysShort: 0, daysOver: 0, shortCents: 0, overCents: 0, netCents: 0, correctedCents: 0, cardDifferenceCents: 0,
    rows: [], byBranch: [], byCloser: [],
  };
  const branches = new Map<string, VarianceReport["byBranch"][number]>();
  const closers = new Map<string, VarianceReport["byCloser"][number]>();
  for (const r of rows) {
    const diff = r.difference_cents;
    const card = r.card_actual_cents !== null && r.card_expected_cents !== null ? r.card_actual_cents - r.card_expected_cents : null;
    if (diff < 0) { out.daysShort++; out.shortCents += -diff; }
    if (diff > 0) { out.daysOver++; out.overCents += diff; }
    out.netCents += diff;
    out.correctedCents += r.correction_cents;
    out.cardDifferenceCents += card ?? 0;
    out.rows.push({ id: r.id, branchId: r.branch_id, date: r.close_date, expectedCents: r.expected_cents, actualCents: r.actual_cents, differenceCents: diff, reason: r.difference_reason, closedBy: r.closer, cardDifferenceCents: card });
    const br = branches.get(r.branch_id) ?? { branchId: r.branch_id, days: 0, shortCents: 0, overCents: 0, netCents: 0 };
    br.days++; br.netCents += diff; if (diff < 0) br.shortCents += -diff; if (diff > 0) br.overCents += diff;
    branches.set(r.branch_id, br);
    const key = r.closer ?? "unknown";
    const cl = closers.get(key) ?? { closedBy: key, days: 0, shortCents: 0, overCents: 0 };
    cl.days++; if (diff < 0) cl.shortCents += -diff; if (diff > 0) cl.overCents += diff;
    closers.set(key, cl);
  }
  out.byBranch = [...branches.values()].sort((a, b2) => b2.shortCents - a.shortCents);
  out.byCloser = [...closers.values()].sort((a, b2) => b2.shortCents - a.shortCents);
  return out;
}

/* ---------------------------------------------------------- daily summary */

export type BranchDaySummary = {
  branchId: string;
  branchName: string;
  status: "CLOSED" | "REOPENED" | "OPEN";
  closingId: string | null;
  openingCents: number;
  cashInCents: number;
  cashOutCents: number;
  expectedCents: number;
  actualCents: number | null;
  differenceCents: number | null;
  salesCents: number;
  expensesCents: number;
  cardCents: number;
  checksPassed: boolean;
  failing: string[];
  goldClosingMg: number;
};

/**
 * One line per branch for a date: closed branches from their frozen report,
 * open ones from a live preview. The owner's end-of-day view of the shop.
 */
export async function dailySummary(db: D1Database, date: string): Promise<{ date: string; branches: BranchDaySummary[]; totals: { salesCents: number; expensesCents: number; differenceCents: number; closed: number; open: number } }> {
  const branches = await all<{ id: string; name: string }>(db, "SELECT id, name FROM branches WHERE is_active = 1 AND 1 = ? ORDER BY name", [1]);
  const closings = await all<ClosingRow>(db, "SELECT * FROM day_closings WHERE close_date = ?", [date]);
  const byBranch = new Map(closings.map((c) => [c.branch_id, c]));
  const out: BranchDaySummary[] = [];
  for (const br of branches) {
    const c = byBranch.get(br.id);
    const closed = c?.status === "CLOSED";
    const report: ClosingReport = closed ? (JSON.parse(c!.report_json) as ClosingReport) : await buildClosingReport(db, { branchId: br.id, date });
    out.push({
      branchId: br.id,
      branchName: br.name,
      status: closed ? "CLOSED" : c?.status === "REOPENED" ? "REOPENED" : "OPEN",
      closingId: c?.id ?? null,
      openingCents: report.openingCents,
      cashInCents: report.cashIn.totalCents,
      cashOutCents: report.cashOut.totalCents,
      expectedCents: report.closing.expectedCents,
      actualCents: closed ? c!.actual_cents : null,
      differenceCents: closed ? c!.difference_cents : null,
      salesCents: report.money.salesCents,
      expensesCents: report.money.expensesCents,
      cardCents: report.card?.netCents ?? 0,
      checksPassed: report.checks.passed,
      failing: report.checks.failing,
      goldClosingMg: report.goldBalance?.closingMg ?? 0,
    });
  }
  return {
    date,
    branches: out,
    totals: {
      salesCents: out.reduce((s, b) => s + b.salesCents, 0),
      expensesCents: out.reduce((s, b) => s + b.expensesCents, 0),
      differenceCents: out.reduce((s, b) => s + (b.differenceCents ?? 0), 0),
      closed: out.filter((b) => b.status === "CLOSED").length,
      open: out.filter((b) => b.status !== "CLOSED").length,
    },
  };
}

/* -------------------------------------------------------------------- CSV */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));

/** The daily closing report as a spreadsheet: section, line, amount (LKR). */
export function closingReportCsv(
  report: ClosingReport,
  meta: { branchName: string; status: string; actualCents: number | null; differenceCents: number | null; reason: string | null; closedBy?: string | null; denominations?: Record<string, number> | null }
): string {
  const rows: unknown[][] = [
    ["GoldOS daily closing report"],
    ["Branch", meta.branchName],
    ["Date", report.date],
    ["Status", meta.status],
    [],
    ["Section", "Line", "Amount (LKR)"],
    ["Cash", "Opening cash (from the ledger)", money(report.openingCents)],
    ...report.cashIn.lines.map((l) => ["Cash in", l.label, money(l.cents)]),
    ["Cash in", "Total in", money(report.cashIn.totalCents)],
    ...report.cashOut.lines.map((l) => ["Cash out", l.label, money(l.cents)]),
    ["Cash out", "Total out", money(report.cashOut.totalCents)],
    ["Closing", "Expected closing cash", money(report.closing.expectedCents)],
    ["Closing", "Counted cash", money(meta.actualCents)],
    ["Closing", "Difference", money(meta.differenceCents)],
    ["Closing", "Explanation", meta.reason ?? ""],
    ["Closing", "Expenses awaiting approval", money(report.closing.awaitingApprovalCents)],
    ["Business", "Sales", money(report.money.salesCents)],
    ["Business", "Purchases", money(report.money.purchasesCents)],
    ["Business", "Old gold bought", money(report.money.oldGoldCents)],
    ["Business", "Expenses", money(report.money.expensesCents)],
    ["Business", "Customer payments", money(report.money.customerPaymentsCents)],
    ["Business", "Supplier payments", money(report.money.supplierPaymentsCents)],
    ["Business", "Bank and card movement", money(report.money.bankTransactionsCents)],
    ...(report.card ? [["Card", "Card takings (net)", money(report.card.netCents)]] : []),
    ...Object.values(report.gold).map((g) => ["Gold (fine g)", g.label, (g.mg / 1000).toFixed(3)]),
    ...(report.goldBalance
      ? [
          ["Gold balance (fine g)", "Opening", (report.goldBalance.openingMg / 1000).toFixed(3)],
          ["Gold balance (fine g)", "In", (report.goldBalance.inMg / 1000).toFixed(3)],
          ["Gold balance (fine g)", "Out", (report.goldBalance.outMg / 1000).toFixed(3)],
          ["Gold balance (fine g)", "Closing", (report.goldBalance.closingMg / 1000).toFixed(3)],
        ]
      : []),
    ["Checks", `${report.checks.total - report.checks.failing.length} of ${report.checks.total} pass`, report.checks.failing.join(" ")],
    ...Object.entries(meta.denominations ?? {}).map(([face, n]) => ["Cash count", `${face} x ${n}`, money(Number(face) * 100 * n)]),
    ...(meta.closedBy ? [["Closed by", meta.closedBy, ""]] : []),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const defaultWindow = (to: string) => ({ from: addDays(to, -30), to });
