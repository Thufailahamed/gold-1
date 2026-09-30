import { addDays, fiscalYearFor } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { fail } from "./cashbank";
import { reconcile } from "./reconcile";
import { balanceSheet, fiscalStartMonth, profitAndLoss } from "./statements";

export type FiscalCloseRow = {
  id: string;
  year_start: string;
  year_end: string;
  status: "CLOSED" | "REOPENED";
  net_profit_cents: number;
  closed_at: number;
  closed_by: string | null;
  reopened_at: number | null;
  reopened_by: string | null;
  reopen_approved_by: string | null;
  reopen_reason: string | null;
};

/**
 * The shop's financial years: the current one, and every year that has any
 * posting, with its close state. A year with no row has never been closed.
 */
export async function listFiscalYears(db: D1Database): Promise<{
  startMonth: number;
  current: { start: string; end: string; label: string };
  years: { start: string; end: string; label: string; close: FiscalCloseRow | null }[];
}> {
  const startMonth = await fiscalStartMonth(db);
  const today = await businessDateFor(db, Date.now());
  const current = fiscalYearFor(today, startMonth);
  const first = await db.prepare("SELECT MIN(entry_date) AS d FROM journal_entries").first<{ d: string | null }>();
  const { results } = await db
    .prepare(
      `SELECT id, year_start, year_end, status, net_profit_cents, closed_at, closed_by, reopened_at, reopened_by, reopen_approved_by, reopen_reason
       FROM fiscal_closes ORDER BY year_end DESC`
    )
    .all<FiscalCloseRow>();
  const closes = new Map((results ?? []).map((r) => [r.year_end, r]));
  const years: { start: string; end: string; label: string; close: FiscalCloseRow | null }[] = [];
  let fy = current;
  const floor = first?.d && first.d < current.start ? first.d : current.start;
  // Walk back one year at a time to the first posting. Bounded: a shop has
  // decades at most, and the loop stops at the earliest entry.
  for (let i = 0; i < 100; i++) {
    years.push({ ...fy, close: closes.get(fy.end) ?? null });
    if (fy.start <= floor) break;
    fy = fiscalYearFor(addDays(fy.start, -1), startMonth);
  }
  return { startMonth, current, years };
}

/**
 * Close a financial year. Posts nothing — retained earnings are derived from
 * the year boundary — but locks every posting dated on or before the year
 * end (see buildEntryStmts) and freezes the year's P&L and closing balance
 * sheet. Refused while the books do not balance: a year closed on a broken
 * trial balance files a wrong number that can never again be corrected.
 */
export async function closeFiscalYear(
  db: D1Database,
  input: { yearEnd: string },
  actorId: string
): Promise<{ id: string; netProfitCents: number }> {
  const startMonth = await fiscalStartMonth(db);
  const fy = fiscalYearFor(input.yearEnd, startMonth);
  if (fy.end !== input.yearEnd)
    fail("VALIDATION", `A financial year ends on ${fy.end}, not ${input.yearEnd}`);
  const today = await businessDateFor(db, Date.now());
  if (input.yearEnd >= today) fail("CONFLICT", "A year can only be closed after it has ended");
  const existing = await db
    .prepare("SELECT id, status FROM fiscal_closes WHERE year_end = ?")
    .bind(input.yearEnd)
    .first<{ id: string; status: string }>();
  if (existing?.status === "CLOSED") fail("CONFLICT", `The year ending ${input.yearEnd} is already closed`);
  const later = await db
    .prepare("SELECT year_end FROM fiscal_closes WHERE status = 'CLOSED' AND year_end > ? LIMIT 1")
    .bind(input.yearEnd)
    .first<{ year_end: string }>();
  if (later) fail("CONFLICT", `A later year (ending ${later.year_end}) is closed; reopen it first`);

  const recon = await reconcile(db, { date: input.yearEnd });
  const broken = recon.checks.filter((c) => c.scope === "cumulative" && ["entry_balance", "trial_balance"].includes(c.id) && !c.pass);
  if (broken.length)
    fail("CONFLICT", `The books do not balance at ${input.yearEnd}: ${broken.map((c) => c.label).join("; ")}`);

  const pnl = await profitAndLoss(db, { from: fy.start, to: fy.end });
  const bs = await balanceSheet(db, { date: fy.end });
  if (!bs.balanced) fail("CONFLICT", "The balance sheet does not balance; correct the books before closing");
  const report = JSON.stringify({ fiscalYear: fy, profitAndLoss: pnl, balanceSheet: bs });
  const now = Date.now();
  const id = existing?.id ?? crypto.randomUUID();
  await db.batch([
    existing
      ? db
          .prepare(
            "UPDATE fiscal_closes SET status = 'CLOSED', net_profit_cents = ?, report_json = ?, closed_at = ?, closed_by = ? WHERE id = ?"
          )
          .bind(pnl.netProfitCents, report, now, actorId, id)
      : db
          .prepare(
            "INSERT INTO fiscal_closes (id, year_start, year_end, status, net_profit_cents, report_json, closed_at, closed_by) VALUES (?, ?, ?, 'CLOSED', ?, ?, ?, ?)"
          )
          .bind(id, fy.start, fy.end, pnl.netProfitCents, report, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "fiscal.close",
      entity: "fiscal_close",
      entityId: id,
      next: { yearStart: fy.start, yearEnd: fy.end, netProfitCents: pnl.netProfitCents },
    }),
  ]);
  return { id, netProfitCents: pnl.netProfitCents };
}

/**
 * Reopen a closed year so a correction can be posted into it. Needs a
 * written reason and a second person with accounts:manage who is neither the
 * requester nor whoever closed the year — the same four-eyes rule as
 * reopening a day. Only the latest closed year can be reopened.
 */
export async function reopenFiscalYear(
  db: D1Database,
  yearEnd: string,
  input: { reason: string; approvedBy: string },
  actorId: string
): Promise<void> {
  const row = await db
    .prepare("SELECT id, status, closed_by FROM fiscal_closes WHERE year_end = ?")
    .bind(yearEnd)
    .first<{ id: string; status: string; closed_by: string | null }>();
  if (!row || row.status !== "CLOSED") fail("NOT_FOUND", "That year is not closed");
  const later = await db
    .prepare("SELECT year_end FROM fiscal_closes WHERE status = 'CLOSED' AND year_end > ? LIMIT 1")
    .bind(yearEnd)
    .first<{ year_end: string }>();
  if (later) fail("CONFLICT", `Reopen the later year ending ${later.year_end} first`);
  if (!input.reason.trim()) fail("VALIDATION", "A reason is required");
  if (input.approvedBy === actorId) fail("FORBIDDEN", "The approver cannot be the person reopening");
  if (input.approvedBy === row.closed_by) fail("FORBIDDEN", "The approver cannot be the person who closed the year");
  const { results } = await db
    .prepare(
      `SELECT p.name AS name FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ? AND u.is_active = 1`
    )
    .bind(input.approvedBy)
    .all<{ name: string }>();
  if (!(results ?? []).some((r) => r.name === "accounts:manage"))
    fail("FORBIDDEN", "The approver needs accounts:manage");
  await db.batch([
    db
      .prepare(
        "UPDATE fiscal_closes SET status = 'REOPENED', reopened_at = ?, reopened_by = ?, reopen_approved_by = ?, reopen_reason = ? WHERE id = ?"
      )
      .bind(Date.now(), actorId, input.approvedBy, input.reason, row.id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "fiscal.reopen",
      entity: "fiscal_close",
      entityId: row.id,
      prev: { status: "CLOSED" },
      next: { status: "REOPENED", approvedBy: input.approvedBy },
      reason: input.reason,
    }),
  ]);
}

export async function getFiscalClose(db: D1Database, yearEnd: string): Promise<FiscalCloseRow & { report: unknown }> {
  const row = await db
    .prepare("SELECT * FROM fiscal_closes WHERE year_end = ?")
    .bind(yearEnd)
    .first<FiscalCloseRow & { report_json: string }>();
  if (!row) fail("NOT_FOUND", "No close recorded for that year");
  const { report_json, ...rest } = row;
  return { ...rest, report: JSON.parse(report_json) as unknown };
}
