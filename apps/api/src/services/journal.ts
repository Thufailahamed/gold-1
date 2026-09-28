import {
  checkBalanced,
  computePartyLedger,
  isBusinessDate,
  type PartyLedgerKind,
  type PartyLedgerLine,
  type PartyLedgerTotals,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";

export { checkBalanced };

export type JournalLine = {
  account: string;
  debitCents: number;
  creditCents: number;
  partyType?: "customer" | "supplier";
  partyId?: string;
  memo?: string;
};

export type JournalPost = {
  lines: JournalLine[];
  refEntity: string;
  refId: string;
  refNo?: string;
  memo?: string;
  branchId?: string;
  actorId: string;
  auditAction: string;
  auditEntity: string;
  auditEntityId: string;
  sourceModule: string;
  entryDate?: string;
};

export type BuiltEntry = { stmts: D1PreparedStatement[]; entryId: string; entryNo: string };

export type JournalEntryRow = {
  id: string;
  entryNo: string;
  entryDate: string;
  memo: string | null;
  refEntity: string | null;
  refId: string | null;
  refNo: string | null;
  sourceModule: string;
  status: string;
  reversesEntryId: string | null;
  branchId: string | null;
  createdAt: number;
  createdBy: string | null;
  lines: ({ id: string; lineNo: number } & JournalLine)[];
};

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

export type StatementRow = {
  entryId: string;
  entryNo: string;
  entryDate: string;
  memo: string | null;
  refEntity: string | null;
  refNo: string | null;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
};

export type ListJournalOpts = {
  page: number;
  limit: number;
  from?: string;
  to?: string;
  branchId?: string;
  accountCode?: string;
  sourceModule?: string;
  refEntity?: string;
};

export function nextEntryNo(n: number): string {
  return `JE-${String(n).padStart(6, "0")}`;
}

export function mirrorLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({
    account: l.account,
    debitCents: l.creditCents,
    creditCents: l.debitCents,
    ...(l.partyType ? { partyType: l.partyType } : {}),
    ...(l.partyId ? { partyId: l.partyId } : {}),
  }));
}

async function assertAccountsActive(db: D1Database, lines: JournalLine[]): Promise<void> {
  for (const l of lines) {
    const acc = await db
      .prepare("SELECT code FROM chart_of_accounts WHERE code = ? AND is_active = 1")
      .bind(l.account)
      .first();
    if (!acc)
      throw Object.assign(new Error(`Account not found: ${l.account}`), { code: "NOT_FOUND" });
  }
}

async function takeEntryNo(
  db: D1Database,
  stmts: D1PreparedStatement[],
  override?: string
): Promise<string> {
  if (override) return override;
  const row = await db
    .prepare("SELECT next FROM counters WHERE name = 'JE'")
    .bind()
    .first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter JE missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'JE'").bind(row.next + 1));
  return nextEntryNo(row.next);
}

export async function buildEntryStmts(
  db: D1Database,
  post: JournalPost,
  opts?: { entryNo?: string; entryDate?: string; reversesEntryId?: string }
): Promise<BuiltEntry> {
  checkBalanced(post.lines);
  const entryDate = opts?.entryDate ?? post.entryDate ?? "";
  if (!isBusinessDate(entryDate))
    throw Object.assign(new Error(`Invalid entry date: ${entryDate || "(none)"}`), {
      code: "VALIDATION",
    });
  await assertAccountsActive(db, post.lines);

  const stmts: D1PreparedStatement[] = [];
  const entryNo = await takeEntryNo(db, stmts, opts?.entryNo);
  const entryId = crypto.randomUUID();
  const now = Date.now();

  stmts.push(
    db
      .prepare(
        "INSERT INTO journal_entries (id, entry_no, entry_date, memo, ref_entity, ref_id, ref_no, source_module, status, reverses_entry_id, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?)"
      )
      .bind(
        entryId,
        entryNo,
        entryDate,
        post.memo ?? null,
        post.refEntity,
        post.refId,
        post.refNo ?? null,
        post.sourceModule,
        opts?.reversesEntryId ?? null,
        post.branchId ?? null,
        now,
        post.actorId
      )
  );
  post.lines.forEach((l, i) => {
    stmts.push(
      db
        .prepare(
          "INSERT INTO journal_lines (id, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          entryId,
          i + 1,
          l.account,
          l.debitCents,
          l.creditCents,
          l.partyType ?? null,
          l.partyId ?? null,
          l.memo ?? null
        )
    );
  });
  stmts.push(
    buildAuditStmt(db, {
      userId: post.actorId,
      action: post.auditAction,
      entity: post.auditEntity,
      entityId: post.auditEntityId,
      next: { entryNo, lines: post.lines, memo: post.memo },
      branchId: post.branchId,
    })
  );
  return { stmts, entryId, entryNo };
}

export async function reverseEntry(
  db: D1Database,
  entryId: string,
  input: { reason: string; entryDate?: string; actorId: string }
): Promise<BuiltEntry> {
  const original = await getJournalEntry(db, entryId);
  if (original.status !== "POSTED")
    throw Object.assign(new Error("Entry is already reversed"), { code: "CONFLICT" });
  const built = await buildEntryStmts(
    db,
    {
      lines: mirrorLines(original.lines),
      refEntity: original.refEntity ?? "reversal",
      refId: original.refId ?? entryId,
      refNo: original.refNo ?? undefined,
      memo: `Reversal of ${original.entryNo}: ${input.reason}`,
      branchId: original.branchId ?? undefined,
      actorId: input.actorId,
      auditAction: "accounts.reverse",
      auditEntity: "journal_entry",
      auditEntityId: entryId,
      sourceModule: "manual",
    },
    { entryDate: input.entryDate, reversesEntryId: entryId }
  );
  built.stmts.push(
    db.prepare("UPDATE journal_entries SET status = 'REVERSED' WHERE id = ?").bind(entryId),
    buildAuditStmt(db, {
      userId: input.actorId,
      action: "accounts.reverse.apply",
      entity: "journal_entry",
      entityId: entryId,
      prev: { status: "POSTED" },
      next: { reversalEntryId: built.entryId, entryNo: built.entryNo },
      reason: input.reason,
      branchId: original.branchId ?? undefined,
    })
  );
  return built;
}

export async function accountBalance(db: D1Database, code: string, branchId?: string): Promise<number> {
  const cond = branchId ? "AND e.branch_id = ?" : "";
  const vals = branchId ? [code, branchId] : [code];
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents), 0) AS dr, COALESCE(SUM(l.credit_cents), 0) AS cr
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = ? ${cond}`
    )
    .bind(...vals)
    .first<{ dr: number; cr: number }>();
  return (row?.dr ?? 0) - (row?.cr ?? 0);
}

export async function accountEntryCount(db: D1Database, code: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account_code = ?")
    .bind(code)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const ENTRY_COLS =
  "e.id, e.entry_no, e.entry_date, e.memo, e.ref_entity, e.ref_id, e.ref_no, e.source_module, e.status, e.reverses_entry_id, e.branch_id, e.created_at, e.created_by";

export async function getJournalEntry(db: D1Database, id: string): Promise<JournalEntryRow> {
  const head = await db
    .prepare(`SELECT ${ENTRY_COLS} FROM journal_entries e WHERE e.id = ?`)
    .bind(id)
    .first<Omit<JournalEntryRow, "lines">>();
  if (!head) throw Object.assign(new Error("Journal entry not found"), { code: "NOT_FOUND" });
  const { results } = await db
    .prepare(
      "SELECT id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo FROM journal_lines WHERE entry_id = ? ORDER BY line_no"
    )
    .bind(id)
    .all<{
      id: string;
      line_no: number;
      account_code: string;
      debit_cents: number;
      credit_cents: number;
      party_type: string | null;
      party_id: string | null;
      memo: string | null;
    }>();
  return {
    ...head,
    lines: (results ?? []).map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      account: l.account_code,
      debitCents: l.debit_cents,
      creditCents: l.credit_cents,
      ...(l.party_type ? { partyType: l.party_type as "customer" | "supplier" } : {}),
      ...(l.party_id ? { partyId: l.party_id } : {}),
      ...(l.memo ? { memo: l.memo } : {}),
    })),
  };
}

export async function listJournalEntries(
  db: D1Database,
  opts: ListJournalOpts
): Promise<{ rows: JournalEntryRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.from) {
    conds.push("e.entry_date >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("e.entry_date <= ?");
    vals.push(opts.to);
  }
  if (opts.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.sourceModule) {
    conds.push("e.source_module = ?");
    vals.push(opts.sourceModule);
  }
  if (opts.refEntity) {
    conds.push("e.ref_entity = ?");
    vals.push(opts.refEntity);
  }
  if (opts.accountCode) {
    conds.push("EXISTS (SELECT 1 FROM journal_lines x WHERE x.entry_id = e.id AND x.account_code = ?)");
    vals.push(opts.accountCode);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM journal_entries e ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT ${ENTRY_COLS} FROM journal_entries e ${where} ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all<Omit<JournalEntryRow, "lines">>();
  const rows: JournalEntryRow[] = [];
  for (const head of results ?? []) rows.push(await getJournalEntry(db, head.id));
  return { rows, total: count?.total ?? 0 };
}

export async function trialBalance(
  db: D1Database,
  opts: { date: string; branchId?: string }
): Promise<TrialBalanceRow[]> {
  const conds = ["e.entry_date <= ?"];
  const vals: unknown[] = [opts.date];
  if (opts.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(l.debit_cents), 0) AS debitCents,
              COALESCE(SUM(l.credit_cents), 0) AS creditCents
       FROM chart_of_accounts a
       LEFT JOIN journal_lines l ON l.account_code = a.code
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND ${conds.join(" AND ")}
       GROUP BY a.code, a.name, a.type
       ORDER BY a.code`
    )
    .bind(...vals)
    .all<TrialBalanceRow>();
  return (results ?? [])
    .filter((r) => r.debitCents !== 0 || r.creditCents !== 0)
    .map((r) => ({ ...r, balanceCents: r.debitCents - r.creditCents }));
}

export async function accountStatement(
  db: D1Database,
  opts: { code: string; from: string; to: string; branchId?: string }
): Promise<{ rows: StatementRow[]; opening: number; closing: number }> {
  const openConds = ["l.account_code = ?", "e.entry_date < ?"];
  const openVals: unknown[] = [opts.code, opts.from];
  const rangeConds = ["l.account_code = ?", "e.entry_date >= ?", "e.entry_date <= ?"];
  const rangeVals: unknown[] = [opts.code, opts.from, opts.to];
  if (opts.branchId) {
    openConds.push("e.branch_id = ?");
    openVals.push(opts.branchId);
    rangeConds.push("e.branch_id = ?");
    rangeVals.push(opts.branchId);
  }
  const openRow = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents), 0) AS dr, COALESCE(SUM(l.credit_cents), 0) AS cr
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE ${openConds.join(" AND ")}`
    )
    .bind(...openVals)
    .first<{ dr: number; cr: number }>();
  const opening = (openRow?.dr ?? 0) - (openRow?.cr ?? 0);
  const { results } = await db
    .prepare(
      `SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.memo, e.ref_entity, e.ref_no,
              l.debit_cents, l.credit_cents
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE ${rangeConds.join(" AND ")}
       ORDER BY e.entry_date, e.created_at, e.id, l.line_no`
    )
    .bind(...rangeVals)
    .all<{
      entry_id: string;
      entry_no: string;
      entry_date: string;
      memo: string | null;
      ref_entity: string | null;
      ref_no: string | null;
      debit_cents: number;
      credit_cents: number;
    }>();
  let running = opening;
  const rows: StatementRow[] = (results ?? []).map((r) => {
    running += r.debit_cents - r.credit_cents;
    return {
      entryId: r.entry_id,
      entryNo: r.entry_no,
      entryDate: r.entry_date,
      memo: r.memo,
      refEntity: r.ref_entity,
      refNo: r.ref_no,
      debitCents: r.debit_cents,
      creditCents: r.credit_cents,
      balanceCents: running,
    };
  });
  return { rows, opening, closing: running };
}

export async function partyLedger(
  db: D1Database,
  kind: PartyLedgerKind,
  partyId: string,
  opts?: { branchId?: string }
): Promise<{ totals: PartyLedgerTotals; lines: PartyLedgerLine[] }> {
  const account = kind === "customer" ? "1200" : "2000";
  const table = kind === "customer" ? "customers" : "suppliers";
  const party = await db
    .prepare(`SELECT id FROM ${table} WHERE id = ?`)
    .bind(partyId)
    .first<{ id: string }>();
  if (!party) throw Object.assign(new Error("Party not found"), { code: "NOT_FOUND" });
  const conds = ["l.account_code = ?", "l.party_type = ?", "l.party_id = ?"];
  const vals: unknown[] = [account, kind, partyId];
  if (opts?.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.ref_entity, e.ref_id, e.ref_no, e.memo,
              l.debit_cents, l.credit_cents
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE ${conds.join(" AND ")}
       ORDER BY e.entry_date, e.created_at, e.id, l.line_no`
    )
    .bind(...vals)
    .all<{
      entry_id: string;
      entry_no: string;
      entry_date: string;
      ref_entity: string | null;
      ref_id: string | null;
      ref_no: string | null;
      memo: string | null;
      debit_cents: number;
      credit_cents: number;
    }>();
  const lines: PartyLedgerLine[] = (results ?? []).map((r) => ({
    entryId: r.entry_id,
    entryNo: r.entry_no,
    entryDate: r.entry_date,
    refEntity: r.ref_entity ?? "",
    refId: r.ref_id ?? "",
    refNo: r.ref_no,
    memo: r.memo,
    debitCents: r.debit_cents,
    creditCents: r.credit_cents,
  }));
  return { totals: computePartyLedger(kind, lines), lines };
}

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type AccountRow = {
  code: string;
  name: string;
  type: string;
  is_active: number;
  is_system: number;
  description: string | null;
  balance_cents: number;
  entry_count: number;
  is_editable: boolean;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export async function listAccounts(db: D1Database, branchId?: string): Promise<AccountRow[]> {
  const { results } = await db
    .prepare(
      "SELECT code, name, type, is_active, is_system, description FROM chart_of_accounts ORDER BY code"
    )
    .all<Omit<AccountRow, "balance_cents" | "entry_count" | "is_editable">>();
  const rows: AccountRow[] = [];
  for (const a of results ?? []) {
    rows.push({
      ...a,
      balance_cents: await accountBalance(db, a.code, branchId),
      entry_count: await accountEntryCount(db, a.code),
      is_editable: a.is_system === 0,
    });
  }
  return rows;
}

export async function createAccount(
  db: D1Database,
  input: { code: string; name: string; type: AccountType; description?: string },
  actorId: string
): Promise<{ code: string }> {
  const dup = await db
    .prepare("SELECT code FROM chart_of_accounts WHERE code = ?")
    .bind(input.code)
    .first();
  if (dup) fail("CONFLICT", `Account ${input.code} already exists`);
  await db.batch([
    db
      .prepare(
        "INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, ?, 1, 0, ?)"
      )
      .bind(input.code, input.name, input.type, input.description ?? null),
    buildAuditStmt(db, {
      userId: actorId,
      action: "accounts.create",
      entity: "account",
      entityId: input.code,
      next: input,
    }),
  ]);
  return { code: input.code };
}

/**
 * A system account is one the ledger posts into; the shop configures
 * additional accounts, it does not repurpose these. An account with any
 * journal line is frozen: renaming it would rewrite the meaning of history.
 */
async function assertMutable(db: D1Database, code: string): Promise<void> {
  const acc = await db
    .prepare("SELECT is_system FROM chart_of_accounts WHERE code = ?")
    .bind(code)
    .first<{ is_system: number }>();
  if (!acc) fail("NOT_FOUND", `Account not found: ${code}`);
  if (acc.is_system === 1) fail("CONFLICT", `Account ${code} is a system account and cannot be changed`);
  const count = await accountEntryCount(db, code);
  if (count > 0) fail("CONFLICT", `Account ${code} has ${count} journal entries and cannot be changed`);
}

export async function updateAccount(
  db: D1Database,
  code: string,
  input: { name?: string; description?: string; reason: string },
  actorId: string
): Promise<void> {
  await assertMutable(db, code);
  const before = await db
    .prepare("SELECT name, description FROM chart_of_accounts WHERE code = ?")
    .bind(code)
    .first<{ name: string; description: string | null }>();
  const name = input.name ?? before?.name ?? code;
  const description = input.description ?? before?.description ?? null;
  await db.batch([
    db
      .prepare("UPDATE chart_of_accounts SET name = ?, description = ? WHERE code = ?")
      .bind(name, description, code),
    buildAuditStmt(db, {
      userId: actorId,
      action: "accounts.update",
      entity: "account",
      entityId: code,
      prev: before,
      next: { name, description },
      reason: input.reason,
    }),
  ]);
}

export async function setAccountActive(
  db: D1Database,
  code: string,
  isActive: 0 | 1,
  reason: string,
  actorId: string
): Promise<void> {
  await assertMutable(db, code);
  await db.batch([
    db.prepare("UPDATE chart_of_accounts SET is_active = ? WHERE code = ?").bind(isActive, code),
    buildAuditStmt(db, {
      userId: actorId,
      action: isActive === 1 ? "accounts.activate" : "accounts.deactivate",
      entity: "account",
      entityId: code,
      prev: { isActive: isActive === 1 ? 0 : 1 },
      next: { isActive },
      reason,
    }),
  ]);
}
