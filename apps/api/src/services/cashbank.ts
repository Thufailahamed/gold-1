import {
  settlementAmounts,
  type CreateBankAccountInput,
  type OpeningBalanceInput,
  type UpdateBankAccountInput,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { accountBalance, buildEntryStmts } from "./journal";

const CARD_CLEARING = "1020";
/** 1010 is the system "Bank" account; 1020 is Card Clearing. */
const RESERVED = new Set([CARD_CLEARING]);

export function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/**
 * The first bank account adopts the existing 1010 system account, so a shop
 * that has only ever had one bank does not get a second account it never
 * asked for. Later accounts take the lowest free code in 1011-1099 and are
 * created as ordinary configurable accounts, not system ones.
 */
async function allocateAccountCode(db: D1Database): Promise<string> {
  const none = await db
    .prepare("SELECT COUNT(*) AS n FROM bank_accounts")
    .bind()
    .first<{ n: number }>();
  if ((none?.n ?? 0) === 0) {
    const has = await db
      .prepare("SELECT code FROM chart_of_accounts WHERE code = '1010'")
      .bind()
      .first();
    if (has) return "1010";
  }
  const { results } = await db
    .prepare("SELECT code FROM chart_of_accounts WHERE code >= '1011' AND code <= '1099'")
    .bind()
    .all<{ code: string }>();
  const taken = new Set((results ?? []).map((r) => r.code));
  for (let n = 1011; n <= 1099; n++) {
    const code = String(n);
    if (!taken.has(code) && !RESERVED.has(code)) return code;
  }
  return fail("VALIDATION", "No free bank account code between 1011 and 1099");
}

export type BankAccountRow = {
  id: string;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  account_code: string;
  branch_id: string | null;
  opening_balance_cents: number;
  opened_on: string | null;
  is_active: number;
  balance_cents: number;
};

export async function listBankAccounts(
  db: D1Database,
  opts?: { branchId?: string }
): Promise<BankAccountRow[]> {
  const cond = opts?.branchId ? " AND b.branch_id = ?" : "";
  const vals = opts?.branchId ? [opts.branchId] : [];
  const { results } = await db
    .prepare(
      `SELECT b.id, b.name, b.bank_name, b.account_number, b.account_code, b.branch_id,
              b.opening_balance_cents, b.opened_on, b.is_active
       FROM bank_accounts b WHERE 1 = 1${cond} ORDER BY b.account_code`
    )
    .bind(...vals)
    .all<Omit<BankAccountRow, "balance_cents">>();
  const rows: BankAccountRow[] = [];
  for (const a of results ?? []) {
    rows.push({ ...a, balance_cents: await accountBalance(db, a.account_code) });
  }
  return rows;
}

export async function getBankAccount(db: D1Database, id: string): Promise<BankAccountRow> {
  const row = await db
    .prepare(
      "SELECT id, name, bank_name, account_number, account_code, branch_id, opening_balance_cents, opened_on, is_active FROM bank_accounts WHERE id = ?"
    )
    .bind(id)
    .first<Omit<BankAccountRow, "balance_cents">>();
  if (!row) fail("NOT_FOUND", "Bank account not found");
  return { ...row, balance_cents: await accountBalance(db, row.account_code) };
}

export async function createBankAccount(
  db: D1Database,
  input: CreateBankAccountInput,
  actorId: string
): Promise<{ id: string; accountCode: string }> {
  if (input.branchId) {
    const br = await db
      .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
      .bind(input.branchId)
      .first();
    if (!br) fail("NOT_FOUND", "Branch not found");
  }
  const code = await allocateAccountCode(db);
  const exists = await db
    .prepare("SELECT code FROM chart_of_accounts WHERE code = ?")
    .bind(code)
    .first();
  const id = crypto.randomUUID();
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  // The first account adopts 1010, which already exists as a system account,
  // so only create a ledger account when the code is genuinely new.
  if (!exists) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, 'ASSET', 1, 0, ?)"
        )
        .bind(code, input.name, `Bank account ${input.name}`),
      buildAuditStmt(db, {
        userId: actorId,
        action: "accounts.create",
        entity: "account",
        entityId: code,
        next: { code, name: input.name, type: "ASSET" },
      })
    );
  }
  stmts.push(
    db
      .prepare(
        "INSERT INTO bank_accounts (id, name, bank_name, account_number, account_code, branch_id, opening_balance_cents, is_active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)"
      )
      .bind(
        id,
        input.name,
        input.bankName ?? null,
        input.accountNumber ?? null,
        code,
        input.branchId ?? null,
        now,
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "cashbank.create",
      entity: "bank_account",
      entityId: id,
      next: { ...input, accountCode: code },
      branchId: input.branchId ?? undefined,
    })
  );
  await db.batch(stmts);
  return { id, accountCode: code };
}

export async function updateBankAccount(
  db: D1Database,
  id: string,
  input: UpdateBankAccountInput,
  actorId: string
): Promise<void> {
  const before = await db
    .prepare("SELECT name, bank_name, account_number, is_active FROM bank_accounts WHERE id = ?")
    .bind(id)
    .first<{ name: string; bank_name: string | null; account_number: string | null; is_active: number }>();
  if (!before) fail("NOT_FOUND", "Bank account not found");
  const name = input.name ?? before.name;
  const bankName = input.bankName ?? before.bank_name;
  const accountNumber = input.accountNumber ?? before.account_number;
  const isActive = input.isActive ?? before.is_active;
  await db.batch([
    db
      .prepare("UPDATE bank_accounts SET name = ?, bank_name = ?, account_number = ?, is_active = ? WHERE id = ?")
      .bind(name, bankName, accountNumber, isActive, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "cashbank.update",
      entity: "bank_account",
      entityId: id,
      prev: before,
      next: { name, bankName, accountNumber, isActive },
      reason: input.reason,
    }),
  ]);
}

export async function openBankAccount(
  db: D1Database,
  id: string,
  input: OpeningBalanceInput,
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const account = await getBankAccount(db, id);
  if (account.opened_on)
    fail("CONFLICT", `Bank account already opened on ${account.opened_on}`);
  // One settings read, used for both the entry and the column. Reading it
  // twice is two round trips for a value that must not differ between them.
  const entryDate = input.entryDate ?? (await businessDateFor(db, Date.now()));
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: account.account_code, debitCents: input.amountCents, creditCents: 0 },
        { account: "3100", debitCents: 0, creditCents: input.amountCents },
      ],
      refEntity: "opening_balance",
      refId: id,
      refNo: account.account_number ?? account.account_code,
      memo: `Opening balance for ${account.name}: ${input.reason}`,
      branchId: account.branch_id ?? undefined,
      actorId,
      auditAction: "cashbank.open",
      auditEntity: "bank_account",
      auditEntityId: id,
      sourceModule: "bank",
    },
    { entryDate }
  );
  await db.batch([
    ...built.stmts,
    db
      .prepare("UPDATE bank_accounts SET opening_balance_cents = ?, opened_on = ? WHERE id = ?")
      .bind(input.amountCents, entryDate, id),
  ]);
  return { entryId: built.entryId, entryNo: built.entryNo };
}

/**
 * Allocate a document number atomically, outside the caller's batch, and skip
 * one that is already taken. The skip is belt and braces for a counter that
 * has drifted behind the data; without it a drifted counter makes every
 * subsequent document fail on the unique index.
 */
async function nextNumber(
  db: D1Database,
  stmts: D1PreparedStatement[],
  name: string,
  prefix: string,
  table: "card_settlements" | "cash_transfers"
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await db
      .prepare("UPDATE counters SET next = next + 1 WHERE name = ? RETURNING next - 1 AS allocated")
      .bind(name)
      .first<{ allocated: number }>();
    if (!row) fail("INTERNAL", `Counter ${name} missing`);
    const no = `${prefix}-${String(row.allocated).padStart(6, "0")}`;
    const taken = await db
      .prepare(`SELECT 1 AS x FROM ${table} WHERE number = ?`)
      .bind(no)
      .first();
    if (!taken) return no;
  }
  return fail("INTERNAL", `Counter ${name} is out of step; repair it`);
}

async function requireBranch(db: D1Database, id: string, label = "Branch"): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(id)
    .first();
  if (!row) fail("NOT_FOUND", `${label} not found: ${id}`);
}

async function requireActiveBank(db: D1Database, id: string): Promise<BankAccountRow> {
  const bank = await getBankAccount(db, id);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  return bank;
}

export async function depositCash(
  db: D1Database,
  input: { branchId: string; bankAccountId: string; amountCents: number; note?: string; entryDate?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const bank = await requireActiveBank(db, input.bankAccountId);
  await requireBranch(db, input.branchId);
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: bank.account_code, debitCents: input.amountCents, creditCents: 0 },
        { account: "1000", debitCents: 0, creditCents: input.amountCents },
      ],
      refEntity: "cash_deposit",
      refId: crypto.randomUUID(),
      refNo: bank.account_code,
      memo: input.note ?? `Cash deposit to ${bank.name}`,
      branchId: input.branchId,
      actorId,
      auditAction: "cashbank.deposit",
      auditEntity: "cash_movement",
      auditEntityId: bank.id,
      sourceModule: "cash",
    },
    { entryDate: input.entryDate ?? (await businessDateFor(db, Date.now())) }
  );
  await db.batch(built.stmts);
  return { entryId: built.entryId, entryNo: built.entryNo };
}

export async function withdrawCash(
  db: D1Database,
  input: { branchId: string; bankAccountId: string; amountCents: number; note?: string; entryDate?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const bank = await requireActiveBank(db, input.bankAccountId);
  await requireBranch(db, input.branchId);
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: "1000", debitCents: input.amountCents, creditCents: 0 },
        { account: bank.account_code, debitCents: 0, creditCents: input.amountCents },
      ],
      refEntity: "cash_withdrawal",
      refId: crypto.randomUUID(),
      refNo: bank.account_code,
      memo: input.note ?? `Cash withdrawal from ${bank.name}`,
      branchId: input.branchId,
      actorId,
      auditAction: "cashbank.withdraw",
      auditEntity: "cash_movement",
      auditEntityId: bank.id,
      sourceModule: "cash",
    },
    { entryDate: input.entryDate ?? (await businessDateFor(db, Date.now())) }
  );
  await db.batch(built.stmts);
  return { entryId: built.entryId, entryNo: built.entryNo };
}

export type TransferRow = {
  id: string;
  number: string;
  from_branch_id: string;
  to_branch_id: string;
  amount_cents: number;
  sent_on: string;
  received_on: string | null;
  status: string;
  reason: string;
  from_entry_id: string | null;
  to_entry_id: string | null;
};

/**
 * Dispatch and receipt are separate entries because a journal entry has one
 * branch_id. Attributing a cross-branch movement to either branch would make
 * the other branch's cash wrong by the full amount, so the money is explicitly
 * in transit until the other side records it.
 */
export async function dispatchTransfer(
  db: D1Database,
  input: {
    fromBranchId: string;
    toBranchId: string;
    amountCents: number;
    sentOn?: string;
    reason: string;
  },
  actorId: string
): Promise<{ id: string; number: string; entryId: string; entryNo: string }> {
  if (input.fromBranchId === input.toBranchId)
    fail("VALIDATION", "A transfer needs two different branches");
  await requireBranch(db, input.fromBranchId, "From branch");
  await requireBranch(db, input.toBranchId, "To branch");
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "XFER", "XFER", "cash_transfers");
  const sentOn = input.sentOn ?? (await businessDateFor(db, Date.now()));
  const built = await buildEntryStmts(
    db,
    {
      lines: [{ account: "1000", debitCents: 0, creditCents: input.amountCents }],
      refEntity: "cash_transfer_out",
      refId: id,
      refNo: number,
      memo: `${number} to branch ${input.toBranchId}: ${input.reason}`,
      branchId: input.fromBranchId,
      actorId,
      auditAction: "cashbank.transfer.dispatch",
      auditEntity: "cash_transfer",
      auditEntityId: id,
      sourceModule: "cash",
    },
    { entryDate: sentOn }
  );
  stmts.push(...built.stmts);
  stmts.push(
    db
      .prepare(
        "INSERT INTO cash_transfers (id, number, from_branch_id, to_branch_id, amount_cents, sent_on, status, reason, from_entry_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?)"
      )
      .bind(
        id,
        number,
        input.fromBranchId,
        input.toBranchId,
        input.amountCents,
        sentOn,
        input.reason,
        built.entryId,
        Date.now(),
        actorId
      )
  );
  await db.batch(stmts);
  return { id, number, entryId: built.entryId, entryNo: built.entryNo };
}

export async function receiveTransfer(
  db: D1Database,
  id: string,
  input: { receivedOn?: string; note?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const t = await db
    .prepare("SELECT id, number, to_branch_id, amount_cents, status FROM cash_transfers WHERE id = ?")
    .bind(id)
    .first<{ id: string; number: string; to_branch_id: string; amount_cents: number; status: string }>();
  if (!t) fail("NOT_FOUND", "Transfer not found");
  if (t.status === "COMPLETE") fail("CONFLICT", "Transfer already received");
  const receivedOn = input.receivedOn ?? (await businessDateFor(db, Date.now()));
  const built = await buildEntryStmts(
    db,
    {
      lines: [{ account: "1000", debitCents: t.amount_cents, creditCents: 0 }],
      refEntity: "cash_transfer_in",
      refId: t.id,
      refNo: t.number,
      memo: `${t.number} received${input.note ? `: ${input.note}` : ""}`,
      branchId: t.to_branch_id,
      actorId,
      auditAction: "cashbank.transfer.receive",
      auditEntity: "cash_transfer",
      auditEntityId: t.id,
      sourceModule: "cash",
    },
    { entryDate: receivedOn }
  );
  await db.batch([
    ...built.stmts,
    db
      .prepare("UPDATE cash_transfers SET status = 'COMPLETE', received_on = ?, to_entry_id = ? WHERE id = ?")
      .bind(receivedOn, built.entryId, t.id),
  ]);
  return { entryId: built.entryId, entryNo: built.entryNo };
}

export async function listTransfers(
  db: D1Database,
  opts?: { status?: string; branchId?: string }
): Promise<{ rows: TransferRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts?.status) {
    conds.push("status = ?");
    vals.push(opts.status);
  }
  if (opts?.branchId) {
    conds.push("(from_branch_id = ? OR to_branch_id = ?)");
    vals.push(opts.branchId, opts.branchId);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM cash_transfers ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM cash_transfers ${where} ORDER BY sent_on DESC, created_at DESC LIMIT 200`)
    .bind(...vals)
    .all<TransferRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export type SettlementRow = {
  id: string;
  number: string;
  bank_account_id: string;
  settled_on: string;
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
  acquirer_ref: string | null;
  note: string | null;
};

export async function settleCardBatch(
  db: D1Database,
  input: {
    bankAccountId: string;
    grossCents: number;
    feeCents?: number;
    settledOn?: string;
    acquirerRef?: string;
    note?: string;
  },
  actorId: string
): Promise<{ id: string; number: string; entryId: string; entryNo: string; netCents: number }> {
  const amounts = settlementAmounts(input.grossCents, input.feeCents ?? 0);
  const bank = await requireActiveBank(db, input.bankAccountId);
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "SETL", "SETL", "card_settlements");
  const settledOn = input.settledOn ?? (await businessDateFor(db, Date.now()));
  // 1020 falls by the FULL gross because that is the whole receivable the
  // acquirer took off the shop. The bank rises by only the net, and the fee
  // they withheld is a CHARGE — a debit to the 6060 expense — which is what
  // makes the entry balance:
  //   DR bank net + DR 6060 fee = CR 1020 gross
  const lines = [
    { account: bank.account_code, debitCents: amounts.netCents, creditCents: 0 },
    { account: "1020", debitCents: 0, creditCents: amounts.grossCents },
  ];
  if (amounts.feeCents > 0)
    lines.push({ account: "6060", debitCents: amounts.feeCents, creditCents: 0 });
  const built = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: "card_settlement",
      refId: id,
      refNo: number,
      memo: input.note ?? `Card settlement ${number}${input.acquirerRef ? ` (${input.acquirerRef})` : ""}`,
      branchId: bank.branch_id ?? undefined,
      actorId,
      auditAction: "cashbank.settle",
      auditEntity: "card_settlement",
      auditEntityId: id,
      sourceModule: "bank",
    },
    { entryDate: settledOn }
  );
  stmts.push(...built.stmts);
  stmts.push(
    db
      .prepare(
        "INSERT INTO card_settlements (id, number, bank_account_id, settled_on, gross_cents, fee_cents, net_cents, acquirer_ref, note, journal_entry_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        number,
        input.bankAccountId,
        settledOn,
        amounts.grossCents,
        amounts.feeCents,
        amounts.netCents,
        input.acquirerRef ?? null,
        input.note ?? null,
        built.entryId,
        Date.now(),
        actorId
      )
  );
  await db.batch(stmts);
  return {
    id,
    number,
    entryId: built.entryId,
    entryNo: built.entryNo,
    netCents: amounts.netCents,
  };
}

export async function listSettlements(
  db: D1Database,
  opts: { page: number; limit: number; bankAccountId?: string }
): Promise<{ rows: SettlementRow[]; total: number }> {
  const cond = opts.bankAccountId ? " WHERE bank_account_id = ?" : "";
  const vals = opts.bankAccountId ? [opts.bankAccountId] : [];
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM card_settlements${cond}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `SELECT * FROM card_settlements${cond} ORDER BY settled_on DESC, created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all<SettlementRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

/**
 * Records what the statement said and shows what the ledger says. It does not
 * try to fix the difference: a correcting entry is a manual adjustment under
 * accounts:manage, which is the rule that already applies to corrections.
 */
export async function reconcileStatement(
  db: D1Database,
  bankAccountId: string,
  input: { statementDate: string; statementBalanceCents: number; note?: string },
  actorId: string
): Promise<{
  statementDate: string;
  statementBalanceCents: number;
  ledgerBalanceCents: number;
  differenceCents: number;
  pass: boolean;
  uncleared: {
    entryId: string;
    entryNo: string;
    entryDate: string;
    amountCents: number;
    memo: string | null;
  }[];
}> {
  const bank = await requireActiveBank(db, bankAccountId);
  const ledgerBalanceCents = await accountBalance(db, bank.account_code);
  const differenceCents = input.statementBalanceCents - ledgerBalanceCents;
  const { results } = await db
    .prepare(
      `SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.memo,
              COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS amount_cents
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       WHERE l.account_code = ? AND e.entry_date > ?
       GROUP BY e.id, e.entry_no, e.entry_date, e.memo
       ORDER BY e.entry_date DESC LIMIT 50`
    )
    .bind(bank.account_code, input.statementDate)
    .all<{
      entry_id: string;
      entry_no: string;
      entry_date: string;
      memo: string | null;
      amount_cents: number;
    }>();
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO bank_reconciliations (id, bank_account_id, statement_date, statement_balance_cents, ledger_balance_cents, difference_cents, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        bankAccountId,
        input.statementDate,
        input.statementBalanceCents,
        ledgerBalanceCents,
        differenceCents,
        input.note ?? null,
        Date.now(),
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "cashbank.reconcile",
      entity: "bank_reconciliation",
      entityId: id,
      next: {
        statementDate: input.statementDate,
        statementBalanceCents: input.statementBalanceCents,
        ledgerBalanceCents,
        differenceCents,
      },
    }),
  ]);
  return {
    statementDate: input.statementDate,
    statementBalanceCents: input.statementBalanceCents,
    ledgerBalanceCents,
    differenceCents,
    pass: differenceCents === 0,
    uncleared: (results ?? []).map((r) => ({
      entryId: r.entry_id,
      entryNo: r.entry_no,
      entryDate: r.entry_date,
      amountCents: r.amount_cents,
      memo: r.memo,
    })),
  };
}

