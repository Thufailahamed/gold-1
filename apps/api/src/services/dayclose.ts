import {
  cashBreakdownTotal,
  closingArithmetic,
  denominationTotalCents,
  type CashLine,
} from "@goldos/shared";
import { buildEntryStmts } from "./journal";
import type { CloseDayInput, ReopenDayInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { fail } from "./cashbank";
import { LOCAL_DAY, reconcile } from "./reconcile";

const CASH = "1000";
const CARD_CLEARING = "1020";

/** Every cash movement the screen names, and the line it appears under. */
const CASH_LABELS: Record<string, string> = {
  sale_invoice: "Sales",
  cash_withdrawal: "Bank withdrawals",
  cash_transfer_in: "Transfers in",
  purchase_payment: "Supplier payments",
  expense: "Expenses",
  cash_deposit: "Deposits",
  sale_return: "Refunds",
  cash_transfer_out: "Transfers out",
  // Old gold bought for cash leaves the drawer the same way a supplier
  // payment does. Found by the unclassified guard, which is the only reason
  // that guard exists.
  old_gold_purchase: "Old gold purchases",
  repair: "Repair collections",
  custom_advance: "Customer advances",
  custom_advance_refund: "Advance refunds",
  opening_balance: "Opening balances",
  customer_receipt: "Customer payments on account",
  owner_capital: "Owner put money in",
  owner_drawing: "Owner took money out",
  other_income: "Other income",
  cash_correction: "Cash corrections",
  tax_payment: "Tax paid",
};

const GOLD_LINES: { key: GoldKey; label: string; types: string[] }[] = [
  { key: "purchased", label: "Gold Purchased", types: ["PURCHASE", "OLD_GOLD_PURCHASE"] },
  { key: "sold", label: "Gold Sold", types: ["SALE"] },
  { key: "meltedIn", label: "Gold Melted (in)", types: ["MELTING_INPUT"] },
  { key: "meltedOut", label: "Gold Melted (out)", types: ["MELTING_OUTPUT"] },
  { key: "used", label: "Gold Used", types: ["MANUFACTURING_INPUT"] },
  { key: "adjustments", label: "Gold Adjustments", types: ["ADJUSTMENT", "LOSS", "RECOVERY"] },
];

export type GoldKey =
  | "purchased"
  | "sold"
  | "meltedIn"
  | "meltedOut"
  | "used"
  | "adjustments";

export type GoldSummary = Record<GoldKey, { label: string; mg: number }>;

export type CashLineGroup = {
  totalCents: number;
  unclassifiedCents: number;
  unclassifiedNetCents: number;
  lines: { label: string; refEntity: string; cents: number }[];
};

export type ClosingReport = {
  branchId: string;
  date: string;
  openingCents: number;
  cashIn: CashLineGroup;
  cashOut: CashLineGroup;
  money: {
    salesCents: number;
    purchasesCents: number;
    oldGoldCents: number;
    expensesCents: number;
    customerPaymentsCents: number;
    supplierPaymentsCents: number;
    bankTransactionsCents: number;
  };
  gold: GoldSummary;
  /** Fine milligrams held at the branch: before the day, moved, and after. */
  goldBalance: { openingMg: number; inMg: number; outMg: number; closingMg: number };
  /** Card takings for the day as the ledger has them (1020 from sales, less card refunds). */
  card: { salesCents: number; refundsCents: number; netCents: number };
  checks: { passed: boolean; failing: string[]; total: number };
  closing: {
    expectedCents: number;
    differenceCents: number;
    reasonRequired: boolean;
    awaitingApprovalCents: number;
  };
};

async function sumOne(db: D1Database, sql: string, vals: unknown[]): Promise<number> {
  if (vals.length === 0)
    throw Object.assign(new Error("sumOne called with nothing to bind"), { code: "INTERNAL" });
  const row = await db.prepare(sql).bind(...vals).first<{ n: number }>();
  return row?.n ?? 0;
}

async function cashGroups(
  db: D1Database,
  branchId: string,
  date: string
): Promise<{ inGroup: CashLineGroup; outGroup: CashLineGroup }> {
  const { results } = await db
    .prepare(
      `SELECT e.ref_entity,
              COALESCE(SUM(l.debit_cents), 0) AS dr,
              COALESCE(SUM(l.credit_cents), 0) AS cr
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1000' AND e.branch_id = ? AND e.entry_date = ?
       GROUP BY e.ref_entity`
    )
    .bind(branchId, date)
    .all<{ ref_entity: string | null; dr: number; cr: number }>();
  const lines: CashLine[] = [];
  for (const r of results ?? []) {
    const ref = r.ref_entity ?? "";
    const label = CASH_LABELS[ref] ?? `Unrecognised (${ref || "no ref"})`;
    if (r.dr > 0) lines.push({ refEntity: ref, label, direction: "in", cents: r.dr });
    if (r.cr > 0) lines.push({ refEntity: ref, label, direction: "out", cents: r.cr });
  }
  const totals = cashBreakdownTotal(lines);
  // unclassifiedCents is a single figure repeated on both groups, because a
  // movement's direction is known even when its purpose is not. Repeating it
  // means a reader sees the same number whichever side they look at.
  const group = (direction: "in" | "out") => ({
    totalCents: direction === "in" ? totals.totalIn : totals.totalOut,
    unclassifiedCents: totals.unclassified,
    unclassifiedNetCents: totals.unclassifiedNet,
    lines: lines
      .filter((l) => l.direction === direction)
      .map((l) => ({ label: l.label, refEntity: l.refEntity, cents: l.cents })),
  });
  return { inGroup: group("in"), outGroup: group("out") };
}

/**
 * The branch's fine gold, by the same direction rule as gold_stock_consistency:
 * a row arrives when its destination is the branch and leaves when its source
 * is. Not filtered by branch_id, so a transfer counts at both ends.
 */
async function goldBalance(db: D1Database, branchId: string, date: string): Promise<ClosingReport["goldBalance"]> {
  const tgt = `branch:${branchId}`;
  const d = LOCAL_DAY("occurred_at");
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN ${d} < ? AND destination = ? THEN fine_mg ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN ${d} < ? AND source = ? THEN fine_mg ELSE 0 END), 0) AS opening,
         COALESCE(SUM(CASE WHEN ${d} = ? AND destination = ? THEN fine_mg ELSE 0 END), 0) AS inMg,
         COALESCE(SUM(CASE WHEN ${d} = ? AND source = ? THEN fine_mg ELSE 0 END), 0) AS outMg
       FROM gold_ledger WHERE destination = ? OR source = ?`
    )
    .bind(date, tgt, date, tgt, date, tgt, date, tgt, tgt, tgt)
    .first<{ opening: number; inMg: number; outMg: number }>();
  const openingMg = row?.opening ?? 0;
  const inMg = row?.inMg ?? 0;
  const outMg = row?.outMg ?? 0;
  return { openingMg, inMg, outMg, closingMg: openingMg + inMg - outMg };
}

async function goldSummary(db: D1Database, branchId: string, date: string): Promise<GoldSummary> {
  const { results } = await db
    .prepare(
      `SELECT type, COALESCE(SUM(fine_mg), 0) AS fine_mg FROM gold_ledger
       WHERE branch_id = ? AND ${LOCAL_DAY("occurred_at")} = ?
       GROUP BY type`
    )
    .bind(branchId, date)
    .all<{ type: string; fine_mg: number }>();
  const byType = new Map((results ?? []).map((r) => [r.type, r.fine_mg]));
  const out = {} as GoldSummary;
  for (const line of GOLD_LINES) {
    out[line.key] = {
      label: line.label,
      mg: line.types.reduce((s, t) => s + (byType.get(t) ?? 0), 0),
    };
  }
  return out;
}

export async function buildClosingReport(
  db: D1Database,
  opts: { branchId: string; date: string }
): Promise<ClosingReport> {
  const { branchId, date } = opts;

  const [openingRow, cash, gold, sales, purchases, oldGold, expenses, awaiting, custPay, refunds, purchPay, oldGoldPaid, bankResult, recon] =
    await Promise.all([
      db
        .prepare(
          `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
           WHERE l.account_code = '1000' AND e.branch_id = ? AND e.entry_date < ?`
        )
        .bind(branchId, date)
        .first<{ n: number }>(),
      cashGroups(db, branchId, date),
      goldSummary(db, branchId, date),
      sumOne(
        db,
        `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS n
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_code = '4000' AND e.branch_id = ? AND e.entry_date = ?`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(pi.total_cents), 0) AS n FROM purchase_invoices pi
         WHERE pi.branch_id = ? AND ${LOCAL_DAY("pi.created_at")} = ?
           AND pi.status <> 'VOID'
           AND (pi.journal_entry_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM journal_entries je WHERE je.id = pi.journal_entry_id AND je.status = 'REVERSED'))`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(og.value_cents), 0) AS n FROM old_gold_purchases og
         JOIN old_gold_items oi ON oi.id = og.item_id
         WHERE oi.branch_id = ? AND ${LOCAL_DAY("og.created_at")} = ?`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM expenses
         WHERE branch_id = ? AND incurred_on = ? AND status = 'POSTED'`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM expenses
         WHERE branch_id = ? AND incurred_on = ? AND status = 'PENDING_APPROVAL'`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(sp.amount_cents), 0) AS n FROM sales_payments sp
         JOIN sales_invoices si ON si.id = sp.invoice_id
         WHERE sp.method <> 'credit' AND si.branch_id = ? AND ${LOCAL_DAY("sp.created_at")} = ?`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(sr.refund_cents), 0) AS n FROM sales_returns sr
         JOIN sales_invoices si ON si.id = sr.invoice_id
         WHERE sr.status = 'COMPLETE' AND si.branch_id = ? AND ${LOCAL_DAY("sr.created_at")} = ?`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(pp.amount_cents), 0) AS n FROM purchase_payments pp
         JOIN purchase_invoices pi ON pi.id = pp.invoice_id
         WHERE pi.branch_id = ? AND ${LOCAL_DAY("pp.created_at")} = ?`,
        [branchId, date]
      ),
      sumOne(
        db,
        `SELECT COALESCE(SUM(og.paid_cents), 0) AS n FROM old_gold_purchases og
         JOIN old_gold_items oi ON oi.id = og.item_id
         WHERE oi.branch_id = ? AND ${LOCAL_DAY("og.created_at")} = ?`,
        [branchId, date]
      ),
      (async () => {
        const { results } = await db
          .prepare(
            // Only lines whose entry matched the day count: the window is in the
            // entry join, so unmatched lines still arrive with a NULL entry.
            `SELECT b.account_code, COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN l.debit_cents - l.credit_cents END), 0) AS net
             FROM bank_accounts b
             LEFT JOIN journal_lines l ON l.account_code = b.account_code
             LEFT JOIN journal_entries e ON e.id = l.entry_id
               AND e.branch_id = ? AND e.entry_date = ?
             WHERE b.is_active = 1 AND b.branch_id IS ?
             GROUP BY b.account_code`
          )
          .bind(branchId, date, branchId)
          .all<{ account_code: string; net: number }>();
        return results ?? [];
      })(),
      reconcile(db, { date, branchId }),
    ]);

  const bankTotal = bankResult.reduce((s: number, r: { net: number }) => s + (r.net ?? 0), 0);
  const cardRow = await sumOne(
    db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_code = ? AND e.branch_id = ? AND e.entry_date = ?`,
    [CARD_CLEARING, branchId, date]
  );

  const [cardSales, cardRefunds, goldBal] = await Promise.all([
    sumOne(
      db,
      `SELECT COALESCE(SUM(l.debit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${CARD_CLEARING}' AND e.ref_entity = 'sale_invoice' AND e.branch_id = ? AND e.entry_date = ?`,
      [branchId, date]
    ),
    sumOne(
      db,
      `SELECT COALESCE(SUM(l.credit_cents), 0) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '${CARD_CLEARING}' AND e.ref_entity = 'sale_return' AND e.branch_id = ? AND e.entry_date = ?`,
      [branchId, date]
    ),
    goldBalance(db, branchId, date),
  ]);

  // Dues collected on account are customer payments too, just not at a sale.
  const receipts = await sumOne(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM customer_receipts
     WHERE branch_id = ? AND receipt_date = ? AND status = 'POSTED'`,
    [branchId, date]
  );

  const openingCents = openingRow?.n ?? 0;
  const { expectedCents } = closingArithmetic(
    openingCents,
    cash.inGroup.totalCents,
    cash.outGroup.totalCents
  );

  return {
    branchId,
    date,
    openingCents,
    cashIn: cash.inGroup,
    cashOut: cash.outGroup,
    money: {
      salesCents: sales,
      purchasesCents: purchases,
      oldGoldCents: oldGold,
      expensesCents: expenses,
      customerPaymentsCents: custPay + receipts - refunds,
      supplierPaymentsCents: purchPay + oldGoldPaid,
      bankTransactionsCents: bankTotal + cardRow,
    },
    gold,
    goldBalance: goldBal,
    card: { salesCents: cardSales, refundsCents: cardRefunds, netCents: cardSales - cardRefunds },
    checks: {
      passed: recon.passed,
      failing: recon.checks.filter((c) => !c.pass).map((c) => c.id),
      total: recon.checks.length,
    },
    closing: {
      expectedCents,
      differenceCents: 0,
      reasonRequired: false,
      awaitingApprovalCents: awaiting,
    },
  };
}

/* ------------------------------------------------------------- close/reopen */

export type ClosingRow = {
  id: string;
  branch_id: string;
  close_date: string;
  opening_cents: number;
  cash_in_cents: number;
  cash_out_cents: number;
  expected_cents: number;
  actual_cents: number;
  difference_cents: number;
  difference_reason: string | null;
  report_json: string;
  checks_passed: number;
  status: string;
  closed_by: string | null;
  closed_at: number;
  created_at: number;
  denominations_json: string | null;
  card_expected_cents: number | null;
  card_actual_cents: number | null;
  correction_cents: number;
};

export async function closeDay(
  db: D1Database,
  input: CloseDayInput,
  actorId: string
): Promise<{ id: string; report: ClosingReport }> {
  const report = await buildClosingReport(db, {
    branchId: input.branchId,
    date: input.date,
  });
  if (!report.checks.passed)
    fail("CONFLICT", `Cannot close: ${report.checks.failing.join(", ")}`);

  // Gate on the NET unnamed movement per ref, not the gross: a manual error
  // and its reversal net to zero economics and must not block the close
  // forever (reversing reuses the original ref, so gross only ever grows).
  // Any real unnamed movement still blocks; gross lines stay visible above.
  const unclassified = report.cashIn.unclassifiedNetCents;
  if (unclassified > 0)
    fail(
      "CONFLICT",
      `Cannot close: ${unclassified} net cents of cash movement is not categorised, so the breakdown would be wrong`
    );

  if (input.denominations) {
    const counted = denominationTotalCents(input.denominations);
    if (counted !== input.actualCents)
      fail("VALIDATION", `The note count adds up to ${counted}c, not the ${input.actualCents}c entered`);
  }
  const { expectedCents } = report.closing;
  const differenceCents = input.actualCents - expectedCents;
  if (differenceCents !== 0 && !input.differenceReason?.trim())
    fail("VALIDATION", "A cash difference needs an explanation");
  const cardDifference = input.cardTerminalCents !== undefined ? input.cardTerminalCents - report.card.netCents : 0;
  if (cardDifference !== 0 && !input.differenceReason?.trim())
    fail("VALIDATION", "A card terminal difference needs an explanation");

  const existing = await db
    .prepare(
      "SELECT id, status, actual_cents, difference_cents FROM day_closings WHERE branch_id = ? AND close_date = ?"
    )
    .bind(input.branchId, input.date)
    .first<{ id: string; status: string; actual_cents: number; difference_cents: number }>();
  if (existing?.status === "CLOSED") fail("CONFLICT", "This day is already closed");

  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  // Posting the difference makes the ledger drawer equal the counted drawer,
  // so tomorrow's opening (read from the ledger) is what is really there. On
  // a re-close the earlier correction is already inside expectedCents — it is
  // a cash movement of the day — so the new difference is only the change.
  const correction =
    input.postDifference && differenceCents !== 0
      ? await buildEntryStmts(
          db,
          {
            lines:
              differenceCents > 0
                ? [
                    { account: CASH, debitCents: differenceCents, creditCents: 0 },
                    { account: "6090", debitCents: 0, creditCents: differenceCents },
                  ]
                : [
                    { account: "6090", debitCents: -differenceCents, creditCents: 0 },
                    { account: CASH, debitCents: 0, creditCents: -differenceCents },
                  ],
            refEntity: "cash_correction",
            refId: id,
            memo: `Day close ${input.date}: cash ${differenceCents > 0 ? "over" : "short"} — ${input.differenceReason ?? ""}`,
            branchId: input.branchId,
            actorId,
            auditAction: "dayclose.correction",
            auditEntity: "day_closing",
            auditEntityId: id,
            sourceModule: "cash",
          },
          { entryDate: input.date }
        )
      : null;
  const correctionCents = (existing ? await priorCorrection(db, id) : 0) + (correction ? differenceCents : 0);
  const denominationsJson = input.denominations ? JSON.stringify(input.denominations) : null;
  const cardExpected = input.cardTerminalCents !== undefined ? report.card.netCents : null;
  const cardActual = input.cardTerminalCents ?? null;
  const frozen: ClosingReport = {
    ...report,
    closing: { ...report.closing, differenceCents, reasonRequired: differenceCents !== 0 },
  };
  // A reopened day closes by UPDATING its row, never by inserting a second
  // one (the unique index would 500). The prior snapshot survives in the
  // audit trail's prev_json, and the reopen trail in day_reopens is untouched.
  const write = existing
    ? db
        .prepare(
          "UPDATE day_closings SET opening_cents = ?, cash_in_cents = ?, cash_out_cents = ?, expected_cents = ?, actual_cents = ?, difference_cents = ?, difference_reason = ?, report_json = ?, checks_passed = ?, status = 'CLOSED', closed_by = ?, closed_at = ?, denominations_json = ?, card_expected_cents = ?, card_actual_cents = ?, correction_cents = ? WHERE id = ? AND status = 'REOPENED'"
        )
        .bind(
          report.openingCents,
          report.cashIn.totalCents,
          report.cashOut.totalCents,
          expectedCents,
          input.actualCents,
          differenceCents,
          input.differenceReason ?? null,
          JSON.stringify(frozen),
          report.checks.passed ? 1 : 0,
          actorId,
          now,
          denominationsJson,
          cardExpected,
          cardActual,
          correctionCents,
          id
        )
    : db
        .prepare(
          "INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, difference_reason, report_json, checks_passed, status, closed_by, closed_at, created_at, denominations_json, card_expected_cents, card_actual_cents, correction_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          id,
          input.branchId,
          input.date,
          report.openingCents,
          report.cashIn.totalCents,
          report.cashOut.totalCents,
          expectedCents,
          input.actualCents,
          differenceCents,
          input.differenceReason ?? null,
          JSON.stringify(frozen),
          report.checks.passed ? 1 : 0,
          actorId,
          now,
          now,
          denominationsJson,
          cardExpected,
          cardActual,
          correctionCents
        );
  // The correction goes first: it is dated the day being closed, and the
  // day lock only bites once the close row says CLOSED.
  await db.batch([
    ...(correction?.stmts ?? []),
    write,
    buildAuditStmt(db, {
      userId: actorId,
      action: existing ? "dayclose.reclose" : "dayclose.close",
      entity: "day_closing",
      entityId: id,
      prev: existing ? { status: "REOPENED", actualCents: existing.actual_cents, differenceCents: existing.difference_cents } : undefined,
      next: {
        branchId: input.branchId,
        date: input.date,
        expectedCents,
        actualCents: input.actualCents,
        differenceCents,
        awaitingApprovalCents: report.closing.awaitingApprovalCents,
        cardDifferenceCents: cardDifference,
        correctionEntryNo: correction?.entryNo ?? null,
      },
      branchId: input.branchId,
    }),
  ]);
  return { id, report: frozen };
}

async function priorCorrection(db: D1Database, closingId: string): Promise<number> {
  const row = await db
    .prepare("SELECT correction_cents AS n FROM day_closings WHERE id = ?")
    .bind(closingId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function reopenDay(
  db: D1Database,
  closingId: string,
  input: ReopenDayInput,
  actorId: string
): Promise<{ id: string }> {
  const closing = await db
    .prepare("SELECT id, branch_id, close_date, status, closed_by FROM day_closings WHERE id = ?")
    .bind(closingId)
    .first<{
      id: string;
      branch_id: string;
      close_date: string;
      status: string;
      closed_by: string | null;
    }>();
  if (!closing) fail("NOT_FOUND", "Day closing not found");
  if (closing.status !== "CLOSED") fail("CONFLICT", "This day is not closed");
  // Both the requester and the approver must be a different person from each
  // other AND from whoever closed the day. A closed count one person can
  // reopen for themselves is not a control.
  if (input.approvedBy === actorId)
    fail("FORBIDDEN", "The approver must not be the person requesting the re-open");
  if (closing.closed_by && closing.closed_by === input.approvedBy)
    fail("FORBIDDEN", "The approver must not be the person who closed the day");
  const approver = await db
    .prepare(
      `SELECT 1 AS x FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = ? AND p.name = 'accounts:manage' AND u.is_active = 1`
    )
    .bind(input.approvedBy)
    .first();
  if (!approver) fail("FORBIDDEN", "The approver must hold accounts:manage");
  const id = crypto.randomUUID();
  const now = Date.now();
  // The close row is KEPT, snapshot and all. The trail is a new row, so a day
  // reopened twice has two records rather than one overwritten reason.
  await db.batch([
    db.prepare("UPDATE day_closings SET status = 'REOPENED' WHERE id = ?").bind(closingId),
    db
      .prepare(
        "INSERT INTO day_reopens (id, closing_id, reason, requested_by, approved_by, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(id, closingId, input.reason, actorId, input.approvedBy, now, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "dayclose.reopen",
      entity: "day_closing",
      entityId: closingId,
      prev: { status: "CLOSED" },
      next: { status: "REOPENED" },
      reason: input.reason,
      branchId: closing.branch_id,
    }),
  ]);
  return { id };
}

export async function getClosing(
  db: D1Database,
  id: string
): Promise<{ closing: ClosingRow; report: ClosingReport; reopens: Record<string, unknown>[] }> {
  const closing = await db
    .prepare("SELECT * FROM day_closings WHERE id = ?")
    .bind(id)
    .first<ClosingRow>();
  if (!closing) fail("NOT_FOUND", "Day closing not found");
  const { results } = await db
    .prepare("SELECT * FROM day_reopens WHERE closing_id = ? ORDER BY created_at")
    .bind(id)
    .all<Record<string, unknown>>();
  return {
    closing,
    report: JSON.parse(closing.report_json) as ClosingReport,
    reopens: results ?? [],
  };
}

export async function listClosings(
  db: D1Database,
  opts: { page: number; limit: number; branchId?: string; from?: string; to?: string }
): Promise<{ rows: ClosingRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchId) {
    conds.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.from) {
    conds.push("close_date >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("close_date <= ?");
    vals.push(opts.to);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM day_closings ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT * FROM day_closings ${where} ORDER BY close_date DESC, closed_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all<ClosingRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}
