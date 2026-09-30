import {
  addDays,
  buildBalanceSheet,
  buildProfitAndLoss,
  fiscalYearFor,
  type LedgerAccountTotal,
} from "@goldos/shared";
import { getSetting } from "./settings";

/**
 * Account totals over a window. No status filter, on purpose: an entry and
 * its reversal are both real lines that net to zero — the same rule the
 * trial balance, account balances and day-close cash already follow.
 */
async function accountTotals(
  db: D1Database,
  opts: { from?: string; to: string; branchId?: string }
): Promise<LedgerAccountTotal[]> {
  const conds = ["e.entry_date <= ?"];
  const vals: unknown[] = [opts.to];
  if (opts.from) {
    conds.push("e.entry_date >= ?");
    vals.push(opts.from);
  }
  if (opts.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(l.debit_cents), 0) AS debitCents,
              COALESCE(SUM(l.credit_cents), 0) AS creditCents
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN chart_of_accounts a ON a.code = l.account_code
       WHERE ${conds.join(" AND ")}
       GROUP BY a.code, a.name, a.type
       ORDER BY a.code`
    )
    .bind(...vals)
    .all<LedgerAccountTotal>();
  return results ?? [];
}

export async function profitAndLoss(db: D1Database, opts: { from: string; to: string; branchId?: string }) {
  const rows = await accountTotals(db, opts);
  return { from: opts.from, to: opts.to, branchId: opts.branchId ?? null, ...buildProfitAndLoss(rows) };
}

/**
 * Balance sheet with equity split at the financial-year boundary: profit of
 * every entry before the year the date falls in is Retained earnings, the
 * rest is Current year profit. Derived, never posted — see fiscal.ts.
 */
export async function balanceSheet(db: D1Database, opts: { date: string; branchId?: string }) {
  const rows = await accountTotals(db, { to: opts.date, branchId: opts.branchId });
  const fy = fiscalYearFor(opts.date, await fiscalStartMonth(db));
  const prior = await accountTotals(db, { to: addDays(fy.start, -1), branchId: opts.branchId });
  const priorYearsProfitCents = buildProfitAndLoss(prior).netProfitCents;
  return {
    date: opts.date,
    branchId: opts.branchId ?? null,
    fiscalYear: fy,
    ...buildBalanceSheet(rows, { priorYearsProfitCents }),
  };
}

export async function fiscalStartMonth(db: D1Database): Promise<number> {
  const s = await getSetting(db, "fiscal_year_start_month");
  const m = typeof s?.value === "number" ? s.value : 4;
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 4;
}

/**
 * Money in and out per day for a window, across the drawer and every bank.
 * The owner's "how did cash move this week" view, one row per day.
 */
export async function dailyCashSummary(
  db: D1Database,
  opts: { from: string; to: string; branchId?: string }
): Promise<{ date: string; inCents: number; outCents: number }[]> {
  const bSql = opts.branchId ? " AND e.branch_id = ?" : "";
  const vals: unknown[] = [opts.from, opts.to, ...(opts.branchId ? [opts.branchId] : [])];
  const { results } = await db
    .prepare(
      `SELECT e.entry_date AS date, COALESCE(SUM(l.debit_cents), 0) AS inCents, COALESCE(SUM(l.credit_cents), 0) AS outCents
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE (l.account_code = '1000' OR l.account_code IN (SELECT account_code FROM bank_accounts))
         AND COALESCE(e.ref_entity, '') NOT IN ('cash_deposit','cash_withdrawal')
         AND e.entry_date >= ? AND e.entry_date <= ?${bSql}
       GROUP BY e.entry_date ORDER BY e.entry_date`
    )
    .bind(...vals)
    .all<{ date: string; inCents: number; outCents: number }>();
  return results ?? [];
}
