import type {
  CreateBankAccountInput,
  OpeningBalanceInput,
  UpdateBankAccountInput,
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
