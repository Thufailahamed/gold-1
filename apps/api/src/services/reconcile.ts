import { inTransitTotal } from "@goldos/shared";

export type CheckScope = "day" | "cumulative";

export type CheckResult = {
  id: string;
  label: string;
  scope: CheckScope;
  expected: number;
  actual: number;
  difference: number;
  pass: boolean;
  detail: string[];
};

export type ReconcileReport = {
  date: string;
  passed: boolean;
  checks: CheckResult[];
};

/** Cents. A one-cent residue is a rounding artefact, not a discrepancy. */
export function compareMoney(
  id: string,
  label: string,
  expected: number,
  actual: number,
  scope: CheckScope,
  detail: string[] = []
): CheckResult {
  const difference = actual - expected;
  return { id, label, scope, expected, actual, difference, pass: Math.abs(difference) <= 1, detail };
}

/** Fine milligrams. Exact: a missing milligram is real gold, not rounding. */
export function compareWeight(
  id: string,
  label: string,
  ledgerMg: number,
  documentMg: number,
  detail: string[] = []
): CheckResult {
  const difference = ledgerMg - documentMg;
  return {
    id,
    label,
    scope: "day",
    expected: documentMg,
    actual: ledgerMg,
    difference,
    pass: difference === 0,
    detail,
  };
}

function n(v: number | null | undefined): number {
  return v ?? 0;
}

function branchSql(branchId: string | undefined, col: string): { sql: string; vals: unknown[] } {
  return branchId ? { sql: ` AND ${col} = ?`, vals: [branchId] } : { sql: "", vals: [] };
}

/**
 * D1 rejects `.bind()` with no arguments, and every query here is optional on
 * branch. Bind only when there is something to bind.
 */
async function firstRow<T>(db: D1Database, sql: string, vals: unknown[]): Promise<T | null> {
  const stmt = db.prepare(sql);
  return (vals.length ? await stmt.bind(...vals).first<T>() : await stmt.first<T>()) ?? null;
}

/**
 * Every fine milligram the shop physically holds: catalogue product on the
 * shelf, old gold that has been bought into inventory, melt lots not yet
 * consumed, and gold sitting in an unfinished manufacturing order.
 */
export async function heldGoldStages(db: D1Database, branchId?: string): Promise<{ products: number; oldGold: number; lots: number; wip: number; recovered: number; total: number }> {
  const bp = branchSql(branchId, "branch_id");
  const products = await firstRow<{ fine_mg: number }>(
    db,
    `SELECT COALESCE(SUM(fine_gold_mg), 0) AS fine_mg FROM products
     WHERE status NOT IN ('SOLD','RETURNED','VOID','LOST','MELTED')${bp.sql}`,
    bp.vals
  );
  const oldGold = await firstRow<{ fine_mg: number }>(
    db,
    `SELECT COALESCE(SUM(fine_mg), 0) AS fine_mg FROM old_gold_items
     WHERE status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${bp.sql}`,
    bp.vals
  );
  // The branch filter goes in the WHERE, on the BATCH. Putting it on the
  // LEFT JOIN's ON clause filters which allocation rows match, not which lots
  // are counted — so every branch counted every lot in the shop.
  const lots = await firstRow<{ total: number; allocated: number }>(
    db,
      `SELECT COALESCE(SUM(o.fine_mg), 0) AS total,
              COALESCE(SUM(COALESCE(a.fine_mg, 0)), 0) AS allocated
       FROM melting_outputs o
       JOIN melting_batches b ON b.id = o.batch_id AND b.status <> 'VOID'
       LEFT JOIN (
         SELECT m.lot_batch_id, m.lot_number, SUM(m.fine_mg) AS fine_mg
         FROM manufacturing_materials m
         JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID'
         GROUP BY m.lot_batch_id, m.lot_number
       ) a ON a.lot_batch_id = o.batch_id AND a.lot_number = o.lot_number
       WHERE 1 = 1${bp.sql}`,
    bp.vals
  );
  const wip = await firstRow<{ fine_mg: number }>(
    db,
    `SELECT COALESCE(SUM(m.fine_mg), 0) AS fine_mg FROM manufacturing_materials m
     JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID'${bp.sql}`,
    bp.vals
  );
  // Gold recovered during melting is real metal the shop now owns, but it is
  // not yet a lot, a product or a work-in-progress. It sits in the ledger and
  // it sits in the safe, so it has to sit on BOTH sides or the stock check
  // reports a shortage of metal the shop is holding.
  const recovered = await firstRow<{ fine_mg: number }>(
    db,
    `SELECT COALESCE(SUM(fine_mg), 0) AS fine_mg FROM gold_ledger
     WHERE type = 'RECOVERY' AND destination LIKE 'branch:%'${bp.sql}`,
    bp.vals
  );
  const lotsNet = n(lots?.total) - n(lots?.allocated);
  const total =
    n(products?.fine_mg) +
    n(oldGold?.fine_mg) +
    lotsNet +
    n(wip?.fine_mg) +
    n(recovered?.fine_mg);
  return {
    products: n(products?.fine_mg),
    oldGold: n(oldGold?.fine_mg),
    lots: lotsNet,
    wip: n(wip?.fine_mg),
    recovered: n(recovered?.fine_mg),
    total,
  };
}

export async function heldGoldMg(db: D1Database, branchId?: string): Promise<number> {
  return (await heldGoldStages(db, branchId)).total;
}

/** Local business date for an epoch-millis column, for day-scoped gold checks. */
export const LOCAL_DAY = (col: string) => `date(${col} / 1000, 'unixepoch', '+330 minutes')`;

export async function reconcile(
  db: D1Database,
  opts: { date: string; branchId?: string }
): Promise<ReconcileReport> {
  const checks: CheckResult[] = [];
  const day = opts.date;
  const b = branchSql(opts.branchId, "e.branch_id");
  const bp = branchSql(opts.branchId, "branch_id");

  // 1. Every entry balances on its own — catches a corrupt backfill.
  const { results: bad } = await db
    .prepare(
      `SELECT e.entry_no, SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.entry_date <= ?${b.sql}
       GROUP BY e.id, e.entry_no HAVING dr <> cr LIMIT 20`
    )
    .bind(day, ...b.vals)
    .all<{ entry_no: string; dr: number; cr: number }>();
  checks.push(
    compareMoney(
      "entry_balance",
      "Every journal entry balances",
      0,
      (bad ?? []).length,
      "cumulative",
      (bad ?? []).map((r) => `${r.entry_no}: DR ${r.dr} vs CR ${r.cr}`)
    )
  );

  // 2. Cumulative trial balance nets to zero.
  const tb = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents), 0) - COALESCE(SUM(l.credit_cents), 0) AS diff
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.entry_date <= ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ diff: number }>();
  checks.push(compareMoney("trial_balance", "Trial balance nets to zero", 0, n(tb?.diff), "cumulative"));

  // 3. Sales: net movement on 4000 equals invoice totals less return value.
  //    sales_returns has no total column — refund_cents and credit_cents are
  //    mutually exclusive (one is always zero), so the return's value is their
  //    sum. Two scalar sub-selects, not a JOIN: a second return against the
  //    same invoice would otherwise double the invoice total.
  const salesJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '4000' AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const siB = branchSql(opts.branchId, "si.branch_id");
  // The returns sub-select aliases its invoice si2, so it needs its OWN branch
  // filter. Reusing siB here asks for a column that does not exist and only
  // fails when a branch is supplied — an unfiltered run would pass.
  const si2B = branchSql(opts.branchId, "si2.branch_id");
  const si3B = branchSql(opts.branchId, "si3.branch_id");
  const s2B = branchSql(opts.branchId, "s2.branch_id");
  const moB = branchSql(opts.branchId, "mo.branch_id");
  const b2B = branchSql(opts.branchId, "b2.branch_id");
  // A document whose journal entry was reversed recognised no revenue, so it
  // must not count on the document side either — otherwise a reversal is a
  // permanent cross-foot failure. journal_entry_id is the link that makes
  // this knowable.
  const NOT_REVERSED = (alias: string, col: string) =>
    ` AND (${alias}.${col} IS NULL OR NOT EXISTS (
        SELECT 1 FROM journal_entries je WHERE je.id = ${alias}.${col} AND je.status = 'REVERSED'))`;
  const salesDocs = await db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(si.total_cents) FROM sales_invoices si
                   WHERE si.status <> 'VOID' AND ${LOCAL_DAY("si.created_at")} = ?${siB.sql}${NOT_REVERSED("si", "journal_entry_id")}), 0)
       - COALESCE((SELECT SUM(sr.refund_cents + sr.credit_cents) FROM sales_returns sr
                   JOIN sales_invoices si2 ON si2.id = sr.invoice_id
                   WHERE sr.status = 'COMPLETE' AND ${LOCAL_DAY("sr.created_at")} = ?${si2B.sql}), 0)
         AS net`
    )
    .bind(day, ...siB.vals, day, ...si2B.vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney(
      "sales_crossfoot",
      "Sales journal matches sales documents",
      n(salesDocs?.net),
      n(salesJournal?.net),
      "day"
    )
  );

  // 4. Purchases: 1100 debits from purchase documents equal invoice totals.
  const purchJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1100' AND e.source_module = 'purchases' AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const piB = branchSql(opts.branchId, "pi.branch_id");
  const purchDocs = await db
    .prepare(
      `SELECT COALESCE(SUM(pi.total_cents), 0) AS net FROM purchase_invoices pi
       WHERE pi.status <> 'VOID' AND ${LOCAL_DAY("pi.created_at")} = ?${piB.sql}${NOT_REVERSED("pi", "journal_entry_id")}`
    )
    .bind(day, ...piB.vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney(
      "purchases_crossfoot",
      "Purchases journal matches purchase documents",
      n(purchDocs?.net),
      n(purchJournal?.net),
      "day"
    )
  );

  // 5. Payment-driven cash movement equals the payment records.
  //
  //    Scoped by ref_entity on purpose. Specs 2-4 add their own cash sources
  //    (card settlements, expenses, bank payments, transfers), each with its
  //    own ref_entity, and this check must not start failing when they land.
  //    A sale's cash leg lives inside its 'sale_invoice' entry, so that ref is
  //    included; manufacturing and melting entries are excluded because their
  //    cash legs are cost, not payment.
  //
  //    A credit sale inserts a sales_payments row with method='credit' but
  //    debits 1200 and never a cash account, so it is excluded from both sides.
  const payJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE (l.account_code IN ('1000','1020')
              OR l.account_code IN (SELECT account_code FROM bank_accounts WHERE is_active = 1))
         AND e.ref_entity IN ('sale_invoice','sale_return','purchase_payment','old_gold_purchase')
         AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const salesPay = await db
    .prepare(
      `SELECT COALESCE(SUM(sp.amount_cents), 0) AS net FROM sales_payments sp
       JOIN sales_invoices si ON si.id = sp.invoice_id
       WHERE sp.method <> 'credit' AND ${LOCAL_DAY("sp.created_at")} = ?${siB.sql}`
    )
    .bind(day, ...siB.vals)
    .first<{ net: number }>();
  const refunds = await db
    .prepare(
      `SELECT COALESCE(SUM(sr.refund_cents), 0) AS net FROM sales_returns sr
       JOIN sales_invoices si3 ON si3.id = sr.invoice_id
       WHERE sr.status = 'COMPLETE' AND ${LOCAL_DAY("sr.created_at")} = ?${si3B.sql}`
    )
    .bind(day, ...si3B.vals)
    .first<{ net: number }>();
  const purchPay = await db
    .prepare(
      `SELECT COALESCE(SUM(pp.amount_cents), 0) AS net FROM purchase_payments pp
       JOIN purchase_invoices pi ON pi.id = pp.invoice_id
       WHERE ${LOCAL_DAY("pp.created_at")} = ?${piB.sql}`
    )
    .bind(day, ...piB.vals)
    .first<{ net: number }>();
  const oiB = branchSql(opts.branchId, "oi.branch_id");
  const ogB = branchSql(opts.branchId, "og.branch_id");
  const oldGoldPaid = await db
    .prepare(
      `SELECT COALESCE(SUM(og.paid_cents), 0) AS net FROM old_gold_purchases og
       JOIN old_gold_items oi ON oi.id = og.item_id
       WHERE ${LOCAL_DAY("og.created_at")} = ?${oiB.sql}`
    )
    .bind(day, ...oiB.vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney(
      "payments_crossfoot",
      "Payment-driven cash movement matches the payment records",
      // A supplier payment and an old-gold settlement are cash OUTFLOWS, so
      // they subtract. Adding them made every paid purchase a discrepancy.
      n(salesPay?.net) - n(refunds?.net) - n(purchPay?.net) - n(oldGoldPaid?.net),
      n(payJournal?.net),
      "day"
    )
  );

  // 6. Customer ledgers agree with the receivables control account.
  //
  // A net-credit customer balance is legitimate when the system itself
  // posted it: an old-gold remainder (shop owes the leftover) or a store
  // credit from a return. Those post under ref_entity old_gold_purchase and
  // sale_return respectively. Only credit UNEXPLAINED by those postings
  // fails — e.g. overpayments or mis-tagged lines — otherwise every
  // remainder purchase would permanently block day-close.
  const { results: customerRows } = await db
    .prepare(
      `SELECT l.party_id,
              COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS signed,
              COALESCE(SUM(l.debit_cents - l.credit_cents), 0)
                - COALESCE(SUM(CASE WHEN e.ref_entity IN ('old_gold_purchase', 'sale_return')
                  THEN l.debit_cents - l.credit_cents ELSE 0 END), 0) AS unexplained
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1200' AND l.party_type = 'customer' AND e.entry_date <= ?${b.sql}
       GROUP BY l.party_id HAVING signed < 0 AND unexplained < 0`
    )
    .bind(day, ...b.vals)
    .all<{ party_id: string; signed: number; unexplained: number }>();
  checks.push(
    compareMoney(
      "party_ledgers",
      "No unexplained customer credit on the receivables control account",
      0,
      (customerRows ?? []).length,
      "cumulative",
      (customerRows ?? []).map((r) => `${r.party_id}: control shows ${r.signed}, unexplained ${r.unexplained}`)
    )
  );

  // 7. Gold ledger weights match the documents that produced them, for the
  //    day. Scoped to documents *posted* that day: gold rows are written at
  //    approval and finish, not at allocation, so scoping to the creating row
  //    would fail every melt and every manufactured order.
  //
  //    Every net_mg x permille conversion here is ROUNDed and forced to a
  //    float divisor. SQLite's `/` on two integers truncates, while the ledger
  //    writes fineGoldMg's Math.round — so 10,800mg at 916 gives 9,892 on this
  //    side and 9,893 on the ledger, and a perfectly correct order reads as a
  //    1mg discrepancy.
  const glb = branchSql(opts.branchId, "l.branch_id");
  const { results: goldRows } = await db
    .prepare(
      `SELECT l.type, COALESCE(SUM(l.fine_mg), 0) AS fine_mg FROM gold_ledger l
       WHERE l.type IN ('PURCHASE','OLD_GOLD_PURCHASE','SALE','MELTING_INPUT','MELTING_OUTPUT',
                        'MANUFACTURING_INPUT','MANUFACTURING_OUTPUT','LOSS')
         AND ${LOCAL_DAY("l.occurred_at")} = ?${glb.sql}
         AND (l.type <> 'LOSS' OR l.ref_entity IN ('melting_batch','manufacturing_order'))
       GROUP BY l.type`
    )
    .bind(day, ...glb.vals)
    .all<{ type: string; fine_mg: number }>();
  const ledgerMg = new Map((goldRows ?? []).map((r) => [r.type, r.fine_mg]));
  const lb3 = branchSql(opts.branchId, "b3.branch_id");
  const lmo2 = branchSql(opts.branchId, "mo2.branch_id");

  const docQueries: [string, string, { sql: string; vals: unknown[] }][] = [
    [
      "PURCHASE",
      `SELECT COALESCE(SUM(ROUND(ii.net_mg * pu.permille / 1000.0)), 0) AS fine_mg
       FROM purchase_invoice_items ii
       JOIN purities pu ON pu.id = ii.purity_id
       JOIN purchase_invoices pi ON pi.id = ii.invoice_id
       WHERE pi.status <> 'VOID' AND ${LOCAL_DAY("pi.created_at")} = ?${piB.sql}`,
      piB,
    ],
    [
      // Purchase-event date, not current status: an item bought today and
      // melted tomorrow must still cross-foot against today's ledger row.
      "OLD_GOLD_PURCHASE",
      `SELECT COALESCE(SUM(og.fine_mg), 0) AS fine_mg FROM old_gold_items og
       JOIN old_gold_purchases op ON op.item_id = og.id
       WHERE ${LOCAL_DAY("op.created_at")} = ?${ogB.sql}`,
      ogB,
    ],
    [
      "SALE",
      `SELECT COALESCE(SUM(p.fine_gold_mg), 0) AS fine_mg FROM sales_items si
       JOIN products p ON p.id = si.product_id
       JOIN sales_invoices s2 ON s2.id = si.invoice_id
       WHERE s2.status <> 'VOID' AND ${LOCAL_DAY("s2.created_at")} = ?${s2B.sql}`,
      s2B,
    ],
    [
      "MELTING_INPUT",
      `SELECT COALESCE(SUM(i.fine_mg), 0) AS fine_mg FROM melting_inputs i
       JOIN melting_batches b2 ON b2.id = i.batch_id
       WHERE b2.status = 'APPROVED' AND ${LOCAL_DAY("b2.created_at")} = ?${b2B.sql}`,
      b2B,
    ],
    [
      "MELTING_OUTPUT",
      `SELECT COALESCE(SUM(o.fine_mg), 0) AS fine_mg FROM melting_outputs o
       JOIN melting_batches b2 ON b2.id = o.batch_id
       WHERE b2.status = 'APPROVED' AND ${LOCAL_DAY("b2.created_at")} = ?${b2B.sql}`,
      b2B,
    ],
    [
      "MANUFACTURING_INPUT",
      `SELECT COALESCE(SUM(m.fine_mg), 0) AS fine_mg FROM manufacturing_materials m
       JOIN manufacturing_orders mo ON mo.id = m.order_id
       WHERE mo.status = 'COMPLETE' AND ${LOCAL_DAY("mo.created_at")} = ?${moB.sql}`,
      moB,
    ],
    [
      "MANUFACTURING_OUTPUT",
      `SELECT COALESCE(SUM(ROUND(m2.net_mg * pu.permille / 1000.0)), 0) AS fine_mg FROM manufacturing_outputs m2
       JOIN manufacturing_orders mo ON mo.id = m2.order_id
       JOIN purities pu ON pu.id = m2.purity_id
       WHERE mo.status = 'COMPLETE' AND ${LOCAL_DAY("mo.created_at")} = ?${moB.sql}`,
      moB,
    ],
    // LOSS covers melting and manufacturing only. A manual stock-count
    // adjustment is recorded *only* in the gold ledger — there is no
    // independent document for it — so including it would compare the ledger
    // with itself and always pass, which is worse than not checking. Its
    // weight is carried by gold_stock_consistency instead, where a loss that
    // does not reduce stock on hand shows up.
    // LOSS needs the branch on BOTH sub-selects — melting_batches and
    // manufacturing_orders each carry their own — so it cannot share a single
    // branch fragment. Leaving it unfiltered compares a shop-wide figure
    // against a branch-scoped one, and every branch but the one that melted
    // something reports a loss it never had.
    [
      "LOSS",
      `SELECT
         COALESCE((SELECT SUM(loss_mg) FROM melting_batches b3
                   WHERE b3.status = 'APPROVED' AND ${LOCAL_DAY("b3.created_at")} = ?${lb3.sql}), 0)
       + COALESCE((SELECT SUM(loss_mg) FROM manufacturing_orders mo2
                   WHERE mo2.status = 'COMPLETE' AND mo2.loss_mg > 0
                     AND ${LOCAL_DAY("mo2.created_at")} = ?${lmo2.sql}), 0) AS fine_mg`,
      { sql: "", vals: [] },
    ],
  ];
  // Each query carries its OWN branch filter. Picking it by inspecting the SQL
  // for a known fragment looks tidy and is not: with no branch every filter is
  // the empty string, so a substring test matches the first entry and every
  // later query silently gets the wrong one.
  for (const [type, sql, br] of docQueries) {
    const vals =
      type === "LOSS"
        ? [day, ...lb3.vals, day, ...lmo2.vals]
        : [day, ...br.vals];
    const row = await firstRow<{ fine_mg: number }>(db, sql, vals);
    checks.push(
      compareWeight(
        `gold_${type.toLowerCase()}`,
        `Gold ledger ${type} matches its documents`,
        ledgerMg.get(type) ?? 0,
        n(row?.fine_mg)
      )
    );
  }

  // expenses_crossfoot: money that left a payment account for an expense equals
  // the POSTED expenses for the day. A pending expense is on NEITHER side — the
  // ledger has not seen it and neither does the document filter — so the check
  // stays true while the day's CASH reads high. That gap is what spec 4's
  // "awaiting approval" line exists to explain. Do not "fix" it here by
  // counting pending expenses: that would make the check pass and hide the
  // discrepancy the closing screen is supposed to show.
  //
  // Day-scoped and NOT branch-filtered, like trial_balance. The check is about
  // the payment account, and a head-office cost paid from the main bank belongs
  // to one branch while the money left another — filtering the two sides
  // differently would report a discrepancy for a correct posting.
  const expJournal = await firstRow<{ net: number }>(
    db,
    `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE (l.account_code IN ('1000','1020')
            OR l.account_code IN (SELECT account_code FROM bank_accounts WHERE is_active = 1))
       AND e.ref_entity = 'expense' AND e.entry_date = ?`,
    [day]
  );
  const expDocs = await firstRow<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
     WHERE status = 'POSTED' AND incurred_on = ?`,
    [day]
  );
  checks.push(
    compareMoney(
      "expenses_crossfoot",
      "Expense payments match the posted expenses",
      n(expDocs?.total),
      n(expJournal?.net),
      "day"
    )
  );

  // card_clearing: 1020's movement for the day is the settlements recorded for
  // that day. Scoped by ref_entity so it picks up the settlements spec 2 adds
  // without disturbing payments_crossfoot.
  const clearJournal = await firstRow<{ net: number }>(
    db,
    `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_code = '1020' AND e.ref_entity = 'card_settlement' AND e.entry_date = ?${b.sql}`,
    [day, ...b.vals]
  );
  // bank_account_id, NOT id: the sub-select yields bank-account ids and
  // card_settlements.id is the settlement's own. Comparing them silently
  // matches nothing, and only when a branch is supplied — so the shop-wide
  // run passed and the branch run reported zero settlements.
  const csCond = opts.branchId
    ? " AND bank_account_id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)"
    : "";
  const clearDocs = await firstRow<{ gross: number }>(
    db,
    `SELECT COALESCE(SUM(gross_cents), 0) AS gross FROM card_settlements
     WHERE ${LOCAL_DAY("created_at")} = ?${csCond}`,
    opts.branchId ? [day, opts.branchId] : [day]
  );
  checks.push(
    compareMoney(
      "card_clearing",
      "Card clearing matches the day's settlements",
      n(clearDocs?.gross),
      n(clearJournal?.net),
      "day"
    )
  );

  // cash_in_transit: what the transfers table says is still on the road must
  // equal what the two entry types say is still on the road. Cumulative, not
  // a single day's figure — a transfer dispatched yesterday and received today
  // nets correctly only against a running total.
  const transitDocs = await firstRow<{ outstanding: number }>(
    db,
    `SELECT COALESCE(SUM(CASE WHEN status = 'COMPLETE' THEN 0 ELSE amount_cents END), 0) AS outstanding
     FROM cash_transfers WHERE sent_on <= ?`,
    [day]
  );
  // 1030 is where dispatched branch cash rests until received, so its balance
  // IS the cash in transit. Comparing it to the transfers table needs no sign
  // gymnastics: a dispatch debits 1030, a receipt credits it.
  const transitLedger = await firstRow<{ net: number }>(
    db,
    `SELECT COALESCE(SUM(debit_cents - credit_cents), 0) AS net FROM journal_lines
     WHERE account_code = '1030'`,
    []
  );
  checks.push(
    compareMoney(
      "cash_in_transit",
      "Cash in transit agrees between the transfers and the ledger",
      inTransitTotal(n(transitDocs?.outstanding), 0),
      n(transitLedger?.net),
      "cumulative"
    )
  );

  // 8. Cumulative gold weight equals everything physically held. Only *booked*
  //    old gold counts: an item in RECEIVED, TESTED or VALUED is in the shop
  //    but has no journal and no ledger row, because the shop has not bought
  //    it yet. Counting it would make this check fail permanently.
  // Gold is held when a row's destination is the branch, and leaves when its
  // source is the branch. Both sides are tested rather than an either/or,
  // because a TRANSFER has a branch source AND a different branch destination:
  // shop-wide it must net to zero (nothing left the business), but for the
  // receiving branch it is a gain and for the sending branch a loss. Matching
  // only the destination over-counted every transfer by its full weight — the
  // branch-scoped run passed while the shop-wide run overstated by exactly the
  // amount that had moved.
  // Deliberately NOT filtered by branch_id. A TRANSFER row carries the
  // DESTINATION's branch_id, so a row filter drops it out of the sending
  // branch entirely and that branch never sees its own gold leave. The
  // direction CASE below already scopes by branch, and a transfer
  // legitimately belongs to both.
  const tgt = opts.branchId ?? null;
  const total = await firstRow<{ fine_mg: number }>(
    db,
    // Two independent expressions SUBTRACTED, not one CASE with two WHENs: a
    // CASE returns on its first match, so a transfer — which has a branch
    // destination AND a branch source — would count the arrival and never
    // reach the departure, and every transfer would add its weight twice.
    `SELECT COALESCE(SUM(
         (CASE WHEN destination LIKE 'branch:%' AND (? IS NULL OR destination = 'branch:' || ?) THEN fine_mg ELSE 0 END)
       - (CASE WHEN source      LIKE 'branch:%' AND (? IS NULL OR source      = 'branch:' || ?) THEN fine_mg ELSE 0 END)
     ), 0) AS fine_mg
     FROM gold_ledger WHERE 1 = 1`,
    [tgt, tgt, tgt, tgt]
  );
  checks.push(
    compareWeight(
      "gold_stock_consistency",
      "Gold ledger weight equals stock on hand",
      n(total?.fine_mg),
      await heldGoldMg(db, opts.branchId)
    )
  );

  return { date: day, passed: checks.every((c) => c.pass), checks };
}
