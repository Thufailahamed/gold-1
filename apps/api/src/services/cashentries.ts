import { CASH_ENTRY_KINDS, cashEntryLines, type CashEntryInput } from "@goldos/shared";
import { businessDateFor } from "./busdate";
import { fail } from "./cashbank";
import { buildEntryStmts } from "./journal";
import { moneyAccount } from "./receipts";

export type CashEntryRow = {
  id: string;
  number: string;
  branch_id: string;
  entry_date: string;
  kind: string;
  amount_cents: number;
  account_code: string;
  note: string;
  journal_entry_id: string | null;
  created_at: number;
};

async function nextCashNo(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = 'CSH' RETURNING next - 1 AS allocated")
      .bind()
      .first<{ allocated: number }>();
    if (!row) fail("INTERNAL", "Counter CSH missing");
    const no = `CSH-${String(row.allocated).padStart(6, "0")}`;
    const taken = await db.prepare("SELECT 1 AS x FROM cash_entries WHERE number = ?").bind(no).first();
    if (!taken) return no;
  }
  return fail("INTERNAL", "Counter CSH is out of step; repair it");
}

/**
 * Owner top-ups, drawings, other income and till corrections. A till
 * correction is only meaningful against the drawer, so it refuses a bank.
 */
export async function createCashEntry(
  db: D1Database,
  input: CashEntryInput,
  actorId: string
): Promise<{ id: string; number: string; entryNo: string }> {
  if ((input.kind === "CASH_OVER" || input.kind === "CASH_SHORT") && input.method !== "cash")
    fail("VALIDATION", "A cash correction applies to the drawer, not a bank account");
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) fail("NOT_FOUND", "Branch not found");
  const money = await moneyAccount(db, input.method, input.bankAccountId);
  const kind = CASH_ENTRY_KINDS[input.kind];
  const lines = cashEntryLines(input.kind, money.accountCode, input.amountCents);
  const id = crypto.randomUUID();
  const number = await nextCashNo(db);
  const now = Date.now();
  const entryDate = input.entryDate ?? (await businessDateFor(db, now));
  const built = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: kind.refEntity,
      refId: id,
      refNo: number,
      memo: `${kind.label}: ${input.note}`,
      branchId: input.branchId,
      actorId,
      auditAction: "cash.entry",
      auditEntity: "cash_entry",
      auditEntityId: id,
      sourceModule: "cash",
    },
    { entryDate }
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO cash_entries (id, number, branch_id, entry_date, kind, amount_cents, account_code, bank_account_id, note, journal_entry_id, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(id, number, input.branchId, entryDate, input.kind, input.amountCents, money.accountCode, money.bankAccountId, input.note, now, actorId),
    ...built.stmts,
    db.prepare("UPDATE cash_entries SET journal_entry_id = ? WHERE id = ?").bind(built.entryId, id),
  ]);
  return { id, number, entryNo: built.entryNo };
}

export async function listCashEntries(
  db: D1Database,
  opts: { page: number; limit: number; branchId?: string; from?: string; to?: string }
): Promise<{ rows: CashEntryRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.branchId) {
    conds.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.from) {
    conds.push("entry_date >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("entry_date <= ?");
    vals.push(opts.to);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM cash_entries ${where}`);
  const count = await (vals.length ? countStmt.bind(...vals) : countStmt).first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT id, number, branch_id, entry_date, kind, amount_cents, account_code, note, journal_entry_id, created_at
       FROM cash_entries ${where} ORDER BY entry_date DESC, created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all<CashEntryRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}
