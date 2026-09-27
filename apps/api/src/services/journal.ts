import { buildAuditStmt } from "../middleware/audit";

export type JournalLine = {
  account: string;
  debitCents: number;
  creditCents: number;
  partyType?: "customer" | "supplier";
  partyId?: string;
};

export type JournalPost = {
  lines: JournalLine[];
  refEntity: string;
  refId: string;
  memo?: string;
  branchId?: string;
  actorId: string;
  auditAction: string;
  auditEntity: string;
  auditEntityId: string;
};

export function checkBalanced(lines: JournalLine[]): void {
  const dr = lines.reduce((s, l) => s + l.debitCents, 0);
  const cr = lines.reduce((s, l) => s + l.creditCents, 0);
  if (lines.length < 2 || dr !== cr || dr <= 0)
    throw Object.assign(new Error("Journal must balance with positive total"), {
      code: "VALIDATION",
    });
  for (const l of lines) {
    if (l.debitCents < 0 || l.creditCents < 0 || (l.debitCents > 0 && l.creditCents > 0))
      throw Object.assign(new Error("Line must be debit XOR credit"), { code: "VALIDATION" });
  }
}

export async function postJournalStmts(
  db: D1Database,
  post: JournalPost
): Promise<D1PreparedStatement[]> {
  checkBalanced(post.lines);
  for (const l of post.lines) {
    const acc = await db
      .prepare("SELECT code FROM chart_of_accounts WHERE code = ? AND is_active = 1")
      .bind(l.account)
      .first();
    if (!acc)
      throw Object.assign(new Error(`Account not found: ${l.account}`), { code: "NOT_FOUND" });
  }
  const now = Date.now();
  const stmts = post.lines.map((l) =>
    db
      .prepare(
        "INSERT INTO journal_entries (id, account_code, debit_cents, credit_cents, party_type, party_id, ref_entity, ref_id, memo, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        crypto.randomUUID(),
        l.account,
        l.debitCents,
        l.creditCents,
        l.partyType ?? null,
        l.partyId ?? null,
        post.refEntity,
        post.refId,
        post.memo ?? null,
        post.branchId ?? null,
        now,
        post.actorId
      )
  );
  stmts.push(
    buildAuditStmt(db, {
      userId: post.actorId,
      action: post.auditAction,
      entity: post.auditEntity,
      entityId: post.auditEntityId,
      next: { lines: post.lines, memo: post.memo },
      branchId: post.branchId,
    })
  );
  return stmts;
}

export async function accountBalance(
  db: D1Database,
  code: string,
  branchId?: string
): Promise<number> {
  const cond = branchId ? "AND branch_id = ?" : "";
  const vals = branchId ? [code, branchId] : [code];
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(debit_cents), 0) AS dr, COALESCE(SUM(credit_cents), 0) AS cr FROM journal_entries WHERE account_code = ? ${cond}`
    )
    .bind(...vals)
    .first<{ dr: number; cr: number }>();
  return (row?.dr ?? 0) - (row?.cr ?? 0);
}

export async function partyLedger(
  db: D1Database,
  account: "1200" | "2000",
  partyType: "customer" | "supplier",
  partyId: string
): Promise<{
  opening: number;
  debits: number;
  credits: number;
  balance: number;
  lines: Record<string, unknown>[];
}> {
  const table = partyType === "customer" ? "customers" : "suppliers";
  const party = await db
    .prepare(`SELECT id, opening_balance_cents FROM ${table} WHERE id = ?`)
    .bind(partyId)
    .first<{ id: string; opening_balance_cents: number }>();
  if (!party) throw Object.assign(new Error("Party not found"), { code: "NOT_FOUND" });
  const sums = await db
    .prepare(
      `SELECT COALESCE(SUM(debit_cents), 0) AS dr, COALESCE(SUM(credit_cents), 0) AS cr FROM journal_entries WHERE account_code = ? AND party_type = ? AND party_id = ?`
    )
    .bind(account, partyType, partyId)
    .first<{ dr: number; cr: number }>();
  const dr = sums?.dr ?? 0;
  const cr = sums?.cr ?? 0;
  const balance =
    account === "1200"
      ? party.opening_balance_cents + dr - cr
      : party.opening_balance_cents + cr - dr;
  const { results } = await db
    .prepare(
      `SELECT id, account_code, debit_cents, credit_cents, ref_entity, ref_id, memo, created_at FROM journal_entries WHERE account_code = ? AND party_type = ? AND party_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .bind(account, partyType, partyId)
    .all();
  return {
    opening: party.opening_balance_cents,
    debits: dr,
    credits: cr,
    balance,
    lines: results ?? [],
  };
}
