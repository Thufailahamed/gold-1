import {
  expensePosting,
  expenseThresholds,
  lkrToCents,
  type CreateExpenseCategoryInput,
  type CreateExpenseInput,
  type ExpenseThresholds,
} from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { fail, getBankAccount } from "./cashbank";
import { buildEntryStmts, accountBalance } from "./journal";
import { getSetting } from "./settings";

/** 6000-6080 are seeded; a new category takes the next free code from here. */
const FIRST_FREE = 6090;
const LAST_FREE = 6199;

const DEFAULT_APPROVAL_CENTS = 500_000;
const DEFAULT_RECEIPT_CENTS = 1_000_000;

export async function nextNumber(
  db: D1Database,
  stmts: D1PreparedStatement[],
  name: string,
  prefix: string,
  table: "expenses"
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

async function allocateExpenseAccountCode(db: D1Database): Promise<string> {
  const { results } = await db
    .prepare("SELECT code FROM chart_of_accounts WHERE code >= '6090' AND code <= '6199'")
    .bind()
    .all<{ code: string }>();
  const taken = new Set((results ?? []).map((r) => r.code));
  for (let n = FIRST_FREE; n <= LAST_FREE; n++) {
    const code = String(n);
    if (!taken.has(code)) return code;
  }
  return fail(
    "VALIDATION",
    `No free expense account code between ${FIRST_FREE} and ${LAST_FREE}`
  );
}

/* ------------------------------------------------------------ categories */

export type ExpenseCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  account_code: string;
  is_active: number;
  lifetime_cents: number;
};

export async function listExpenseCategories(db: D1Database): Promise<ExpenseCategoryRow[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, description, account_code, is_active FROM expense_categories ORDER BY account_code"
    )
    .bind()
    .all<Omit<ExpenseCategoryRow, "lifetime_cents">>();
  const rows: ExpenseCategoryRow[] = [];
  for (const c of results ?? []) {
    rows.push({ ...c, lifetime_cents: await accountBalance(db, c.account_code) });
  }
  return rows;
}

export async function getExpenseCategory(
  db: D1Database,
  id: string
): Promise<{ id: string; name: string; account_code: string }> {
  const row = await db
    .prepare("SELECT id, name, account_code FROM expense_categories WHERE id = ? AND is_active = 1")
    .bind(id)
    .first<{ id: string; name: string; account_code: string }>();
  if (!row) fail("NOT_FOUND", "Expense category not found");
  return row;
}

export async function createExpenseCategory(
  db: D1Database,
  input: CreateExpenseCategoryInput,
  actorId: string
): Promise<{ id: string; accountCode: string }> {
  const dup = await db
    .prepare("SELECT id FROM expense_categories WHERE name = ?")
    .bind(input.name)
    .first();
  if (dup) fail("CONFLICT", `A category named "${input.name}" already exists`);
  const code = await allocateExpenseAccountCode(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, 'EXPENSE', 1, 0, ?)"
      )
      .bind(code, input.name, input.description ?? null),
    db
      .prepare(
        "INSERT INTO expense_categories (id, name, description, account_code, is_active, created_at, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)"
      )
      .bind(id, input.name, input.description ?? null, code, now, actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "expenses.category.create",
      entity: "expense_category",
      entityId: id,
      next: { ...input, accountCode: code },
    }),
  ]);
  return { id, accountCode: code };
}

export async function setExpenseCategoryActive(
  db: D1Database,
  id: string,
  isActive: 0 | 1,
  reason: string,
  actorId: string
): Promise<void> {
  const before = await db
    .prepare("SELECT id, name, is_active, account_code FROM expense_categories WHERE id = ?")
    .bind(id)
    .first<{ id: string; name: string; is_active: number; account_code: string }>();
  if (!before) fail("NOT_FOUND", "Expense category not found");
  // A category with history cannot be deactivated: its account would stop
  // adding up against the expenses already booked to it.
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM expenses WHERE category_id = ?")
    .bind(id)
    .first<{ n: number }>();
  if (isActive === 0 && (used?.n ?? 0) > 0)
    fail("CONFLICT", `Category has ${used?.n} expenses and cannot be deactivated`);
  await db.batch([
    db.prepare("UPDATE expense_categories SET is_active = ? WHERE id = ?").bind(isActive, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: isActive === 1 ? "expenses.category.activate" : "expenses.category.deactivate",
      entity: "expense_category",
      entityId: id,
      prev: before,
      next: { isActive },
      reason,
    }),
  ]);
}

/* --------------------------------------------------------------- entries */

export async function expenseThresholdsFor(db: D1Database): Promise<ExpenseThresholds> {
  const [approval, receipt] = await Promise.all([
    getSetting(db, "expense_approval_threshold_cents"),
    getSetting(db, "expense_receipt_required_cents"),
  ]);
  return expenseThresholds(
    typeof approval?.value === "number" ? approval.value : DEFAULT_APPROVAL_CENTS,
    typeof receipt?.value === "number" ? receipt.value : DEFAULT_RECEIPT_CENTS
  );
}

/**
 * Cash is 1000 at the spending branch. A bank payment resolves to that
 * account's own code and is NOT 1000 of the branch: a head-office invoice
 * paid from the main bank is a cost of the branch that spent it, not a
 * movement of that branch's cash.
 */
async function resolvePaymentAccount(
  db: D1Database,
  input: { paidFrom: "cash" | "bank"; bankAccountId?: string }
): Promise<{ code: string; bankAccountId: string | null }> {
  if (input.paidFrom === "cash") return { code: "1000", bankAccountId: null };
  if (!input.bankAccountId) fail("VALIDATION", "A bank payment needs a bank account");
  const bank = await getBankAccount(db, input.bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  return { code: bank.account_code, bankAccountId: bank.id };
}

export async function createExpense(
  db: D1Database,
  input: CreateExpenseInput,
  actorId: string
): Promise<{ id: string; number: string; status: string; requiresReceipt: boolean }> {
  const category = await getExpenseCategory(db, input.categoryId);
  const branch = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!branch) fail("NOT_FOUND", "Branch not found");
  const amountCents = lkrToCents(input.amountLkr);
  if (amountCents <= 0) fail("VALIDATION", "Expense amount must be positive");
  const pay = await resolvePaymentAccount(db, input);
  const gates = expensePosting(amountCents, await expenseThresholdsFor(db));
  const incurredOn = input.incurredOn ?? (await businessDateFor(db, Date.now()));
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "EXP", "EXP", "expenses");
  const id = crypto.randomUUID();
  const status = gates.requiresApproval ? "PENDING_APPROVAL" : "POSTED";
  let entryId: string | null = null;

  if (status === "POSTED") {
    const built = await buildEntryStmts(
      db,
      {
        lines: [
          { account: category.account_code, debitCents: amountCents, creditCents: 0 },
          { account: pay.code, debitCents: 0, creditCents: amountCents },
        ],
        refEntity: "expense",
        refId: id,
        refNo: number,
        memo: `${number} ${input.description}${input.vendor ? ` — ${input.vendor}` : ""}`,
        branchId: input.branchId,
        actorId,
        auditAction: "expenses.record",
        auditEntity: "expense",
        auditEntityId: id,
        sourceModule: "expenses",
      },
      { entryDate: incurredOn }
    );
    stmts.push(...built.stmts);
    entryId = built.entryId;
  }

  stmts.push(
    db
      .prepare(
        "INSERT INTO expenses (id, number, category_id, branch_id, incurred_on, amount_cents, vendor, description, payment_account_code, bank_account_id, status, journal_entry_id, requested_by, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id,
        number,
        input.categoryId,
        input.branchId,
        incurredOn,
        amountCents,
        input.vendor ?? null,
        input.description,
        pay.code,
        pay.bankAccountId,
        status,
        entryId,
        actorId,
        Date.now(),
        actorId
      ),
    buildAuditStmt(db, {
      userId: actorId,
      action: "expenses.create",
      entity: "expense",
      entityId: id,
      next: { number, amountCents, status, categoryId: input.categoryId, paidFrom: input.paidFrom },
      branchId: input.branchId,
    })
  );
  await db.batch(stmts);
  return { id, number, status, requiresReceipt: gates.requiresReceipt };
}

export type ExpenseDbRow = {
  id: string;
  number: string;
  category_id: string;
  category_name: string;
  account_code: string;
  branch_id: string;
  incurred_on: string;
  amount_cents: number;
  vendor: string | null;
  description: string;
  payment_account_code: string;
  bank_account_id: string | null;
  status: string;
  receipt_key: string | null;
  journal_entry_id: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: number | null;
  rejection_reason: string | null;
  created_at: number;
};

const EXPENSE_SELECT = `SELECT e.*, c.account_code, c.name AS category_name
  FROM expenses e JOIN expense_categories c ON c.id = e.category_id`;

async function loadExpense(db: D1Database, id: string): Promise<ExpenseDbRow> {
  const row = await db
    .prepare(`${EXPENSE_SELECT} WHERE e.id = ?`)
    .bind(id)
    .first<ExpenseDbRow>();
  if (!row) fail("NOT_FOUND", "Expense not found");
  return row;
}

export async function getExpense(db: D1Database, id: string): Promise<ExpenseDbRow> {
  return loadExpense(db, id);
}

export async function listExpenses(
  db: D1Database,
  opts: {
    page: number;
    limit: number;
    from?: string;
    to?: string;
    branchId?: string;
    categoryId?: string;
    status?: string;
  }
): Promise<{ rows: ExpenseDbRow[]; total: number }> {
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (opts.from) {
    conds.push("e.incurred_on >= ?");
    vals.push(opts.from);
  }
  if (opts.to) {
    conds.push("e.incurred_on <= ?");
    vals.push(opts.to);
  }
  if (opts.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  if (opts.categoryId) {
    conds.push("e.category_id = ?");
    vals.push(opts.categoryId);
  }
  if (opts.status) {
    conds.push("e.status = ?");
    vals.push(opts.status);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM expenses e ${where}`)
    .bind(...vals)
    .first<{ total: number }>();
  const { results } = await db
    .prepare(
      `${EXPENSE_SELECT} ${where} ORDER BY e.incurred_on DESC, e.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...vals, opts.limit, (opts.page - 1) * opts.limit)
    .all<ExpenseDbRow>();
  return { rows: results ?? [], total: count?.total ?? 0 };
}

export async function approveExpense(
  db: D1Database,
  id: string,
  input: { reason?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const exp = await loadExpense(db, id);
  if (exp.status !== "PENDING_APPROVAL")
    fail("CONFLICT", `Expense is ${exp.status}, not awaiting approval`);
  // Self-approval is the entire point of requiring a second person.
  if (exp.requested_by === actorId)
    fail("FORBIDDEN", "An expense cannot be approved by the person who recorded it");
  const thresholds = await expenseThresholdsFor(db);
  if (expensePosting(exp.amount_cents, thresholds).requiresReceipt && !exp.receipt_key)
    fail("VALIDATION", "This expense needs a receipt attached before it can be approved");
  const built = await buildEntryStmts(
    db,
    {
      lines: [
        { account: exp.account_code, debitCents: exp.amount_cents, creditCents: 0 },
        { account: exp.payment_account_code, debitCents: 0, creditCents: exp.amount_cents },
      ],
      refEntity: "expense",
      refId: exp.id,
      refNo: exp.number,
      memo: `${exp.number} ${exp.description}${input.reason ? ` (${input.reason})` : ""}`,
      branchId: exp.branch_id,
      actorId,
      auditAction: "expenses.approve",
      auditEntity: "expense",
      auditEntityId: exp.id,
      sourceModule: "expenses",
    },
    { entryDate: exp.incurred_on }
  );
  await db.batch([
    ...built.stmts,
    db
      .prepare(
        "UPDATE expenses SET status = 'POSTED', approved_by = ?, approved_at = ?, journal_entry_id = ? WHERE id = ?"
      )
      .bind(actorId, Date.now(), built.entryId, exp.id),
  ]);
  return { entryId: built.entryId, entryNo: built.entryNo };
}

export async function rejectExpense(
  db: D1Database,
  id: string,
  reason: string,
  actorId: string
): Promise<void> {
  const exp = await loadExpense(db, id);
  if (exp.status !== "PENDING_APPROVAL")
    fail("CONFLICT", `Expense is ${exp.status}, not awaiting approval`);
  if (exp.requested_by === actorId)
    fail("FORBIDDEN", "An expense cannot be rejected by the person who recorded it");
  // Never deleted: the row stays with its reason so the refusal is auditable.
  await db.batch([
    db
      .prepare(
        "UPDATE expenses SET status = 'REJECTED', rejection_reason = ?, approved_by = ?, approved_at = ? WHERE id = ?"
      )
      .bind(reason, actorId, Date.now(), exp.id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "expenses.reject",
      entity: "expense",
      entityId: exp.id,
      prev: { status: exp.status },
      next: { status: "REJECTED" },
      reason,
      branchId: exp.branch_id,
    }),
  ]);
}

/* -------------------------------------------------------------- receipts */

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function attachReceipt(
  db: D1Database,
  r2: R2Bucket,
  id: string,
  file: File,
  actorId: string
): Promise<{ key: string }> {
  const exp = await loadExpense(db, id);
  if (!RECEIPT_TYPES.includes(file.type))
    fail("VALIDATION", "Receipt must be jpeg, png or webp");
  if (file.size > 5 * 1024 * 1024) fail("VALIDATION", "Receipt must be under 5MB");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `expenses/${exp.id}/${crypto.randomUUID()}.${ext}`;
  await r2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await db.batch([
    db.prepare("UPDATE expenses SET receipt_key = ? WHERE id = ?").bind(key, exp.id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "expenses.receipt",
      entity: "expense",
      entityId: exp.id,
      next: { key },
      branchId: exp.branch_id,
    }),
  ]);
  return { key };
}

export async function getReceipt(
  db: D1Database,
  r2: R2Bucket,
  id: string
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const exp = await loadExpense(db, id);
  if (!exp.receipt_key) fail("NOT_FOUND", "This expense has no receipt");
  const obj = await r2.get(exp.receipt_key);
  if (!obj) fail("NOT_FOUND", "Receipt file not found");
  return {
    body: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

/* --------------------------------------------------------------- summary */

export type ExpenseSummary = {
  from: string;
  to: string;
  totalCents: number;
  /** Awaiting approval in the period — what spec 4 renders beside cash. */
  pendingCents: number;
  rejectedCents: number;
  byCategory: {
    id: string;
    name: string;
    account_code: string;
    posted_cents: number;
    pending_cents: number;
  }[];
};

export async function expenseSummary(
  db: D1Database,
  opts: { from: string; to: string; branchId?: string }
): Promise<ExpenseSummary> {
  const conds = ["e.incurred_on >= ?", "e.incurred_on <= ?"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    conds.push("e.branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name, c.account_code,
              COALESCE(SUM(CASE WHEN e.status = 'POSTED' THEN e.amount_cents ELSE 0 END), 0) AS posted_cents,
              COALESCE(SUM(CASE WHEN e.status = 'PENDING_APPROVAL' THEN e.amount_cents ELSE 0 END), 0) AS pending_cents
       FROM expense_categories c
       LEFT JOIN expenses e ON e.category_id = c.id AND ${conds.join(" AND ")}
       GROUP BY c.id, c.name, c.account_code
       ORDER BY c.account_code`
    )
    .bind(...vals)
    .all<{
      id: string;
      name: string;
      account_code: string;
      posted_cents: number;
      pending_cents: number;
    }>();
  const rejected = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS rejected_cents FROM expenses e
       WHERE e.status = 'REJECTED' AND ${conds.join(" AND ")}`
    )
    .bind(...vals)
    .first<{ rejected_cents: number }>();
  const byCategory = (results ?? []).filter(
    (r) => r.posted_cents !== 0 || r.pending_cents !== 0
  );
  return {
    from: opts.from,
    to: opts.to,
    totalCents: byCategory.reduce((s, r) => s + r.posted_cents, 0),
    pendingCents: byCategory.reduce((s, r) => s + r.pending_cents, 0),
    rejectedCents: rejected?.rejected_cents ?? 0,
    byCategory,
  };
}

/* ----------------------------------------------------------------- daily */

export type ExpenseDay = {
  date: string;
  postedCents: number;
  pendingCents: number;
  count: number;
};

/**
 * Per-day expense totals for a date range. Days with no expenses are absent;
 * the caller fills the calendar so a quiet day reads as zero, not as missing.
 */
export async function expenseDaily(
  db: D1Database,
  opts: { from: string; to: string; branchId?: string }
): Promise<ExpenseDay[]> {
  const conds = ["incurred_on >= ?", "incurred_on <= ?", "status != 'REJECTED'"];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.branchId) {
    conds.push("branch_id = ?");
    vals.push(opts.branchId);
  }
  const { results } = await db
    .prepare(
      `SELECT incurred_on AS date,
              COALESCE(SUM(CASE WHEN status = 'POSTED' THEN amount_cents ELSE 0 END), 0) AS postedCents,
              COALESCE(SUM(CASE WHEN status = 'PENDING_APPROVAL' THEN amount_cents ELSE 0 END), 0) AS pendingCents,
              COUNT(*) AS count
       FROM expenses WHERE ${conds.join(" AND ")}
       GROUP BY incurred_on ORDER BY incurred_on`
    )
    .bind(...vals)
    .all<ExpenseDay>();
  return results ?? [];
}
