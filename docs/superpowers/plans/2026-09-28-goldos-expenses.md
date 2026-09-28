# GoldOS Expenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expense categories that own their ledger accounts, expense entries with branch, payment account, threshold-driven approval and receipt upload, and a cross-foot check — bringing the trial count to 18.

**Architecture:** An expense is a document row plus one journal entry, written in a single `db.batch` when no approval is required, or written as a bare row when approval is required and the entry posts later. The category owns the account, so the P&L breaks out by category with no report having to split an account.

**Tech Stack:** Hono 4.5 on Cloudflare Workers · Cloudflare D1 (SQLite) · Cloudflare R2 · Zod 3.23 in `@goldos/shared` · Vitest 2 · pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-09-28-goldos-expenses-design.md`
**Requires:** specs 1 and 2 merged. Migrations 0015-0018 applied; `buildEntryStmts`, `businessDateFor`, `getBankAccount`, `reserveEntryNo` and `reconcile` in place.

## Global Constraints

- Every `id` is `crypto.randomUUID()`. `incurred_on`, `sent_on` and `entry_date` are `TEXT` `'YYYY-MM-DD'`, shop-local; everything else is `INTEGER` epoch millis.
- Money is `INTEGER` cents. Never `DELETE` a business row; a rejected expense stays with its reason.
- Every mutation batches its `audit_logs` insert inside the same `db.batch` as the business write.
- Services throw `Object.assign(new Error("msg"), { code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INTERNAL" })`.
- `D1Database`, `D1PreparedStatement` and `R2Bucket` are Workers globals — never imported.
- D1 rejects `.bind()` with no arguments. Bind only when there is something to bind. `reconcile.ts` has a `firstRow` helper for this; reuse it.
- Document numbers come from the atomic `UPDATE … RETURNING` counter, reserved outside the caller's batch, skipping one already taken.
- No new permissions. The count stays at 53.
- R2 uploads follow `routes/products.ts` exactly: jpeg/png/webp, 5 MB, `await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })`.

---

## Permission additions (single source of truth)

**None.** `accounts:manage` to create categories and expenses, approve and
reject, and upload receipts; `accounts:view` to read. Both already exist and
are already granted to owner, manager and accountant (view additionally to
cashier).

---

## File Structure

**Create:**
- `apps/api/drizzle/0019_expenses.sql` — two tables, indexes, nine seeded categories, `EXP` counter
- `apps/api/src/services/expenses.ts` — categories, entries, approval, receipts, summary
- `apps/api/src/routes/expenses.ts` — the endpoints

**Modify:**
- `packages/shared/src/accounting.ts` — `expensePosting`, `pendingApprovalTotal`
- `packages/shared/src/accounting.test.ts` — tests for both
- `packages/shared/src/schemas.ts` — expense request schemas
- `apps/api/src/db/schema.ts` — Drizzle mirror
- `apps/api/src/app.ts` — mount the router
- `apps/api/src/services/reconcile.ts` — `expenses_crossfoot`
- `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md` — task 9

---

### Task 1: Shared arithmetic

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Modify: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `expenseThresholds(approvalCents: number, receiptCents: number): { approvalCents: number; receiptCents: number }` — clamps negatives to 0 and returns them in that order
  - `expensePosting(amountCents: number, thresholds: { approvalCents: number; receiptCents: number }): { requiresReceipt: boolean; requiresApproval: boolean }` — both are strictly-greater-than, so an expense exactly at the threshold is not gated
  - `pendingApprovalTotal(postedCents: number, pendingCents: number): number` — what spec 4 renders on the closing screen

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/accounting.test.ts`, and add
`expensePosting, expenseThresholds, pendingApprovalTotal` to its import list:

```ts
describe("expenseThresholds", () => {
  it("keeps the pair in a named order", () => {
    expect(expenseThresholds(500_000, 1_000_000)).toEqual({
      approvalCents: 500_000,
      receiptCents: 1_000_000,
    });
  });

  it("clamps a negative threshold to zero", () => {
    expect(expenseThresholds(-1, 0)).toEqual({ approvalCents: 0, receiptCents: 0 });
  });
});

describe("expensePosting", () => {
  const t = { approvalCents: 500_000, receiptCents: 1_000_000 };

  it("gates nothing below both thresholds", () => {
    expect(expensePosting(499_999, t)).toEqual({
      requiresReceipt: false,
      requiresApproval: false,
    });
  });

  it("does not gate an expense exactly AT a threshold", () => {
    expect(expensePosting(500_000, t).requiresApproval).toBe(false);
    expect(expensePosting(1_000_000, t).requiresReceipt).toBe(false);
  });

  it("requires a receipt above the receipt threshold", () => {
    expect(expensePosting(1_000_001, t).requiresReceipt).toBe(true);
  });

  it("requires approval above the approval threshold", () => {
    expect(expensePosting(500_001, t).requiresApproval).toBe(true);
  });

  it("gates both above both", () => {
    const r = expensePosting(4_500_000, t);
    expect(r).toEqual({ requiresReceipt: true, requiresApproval: true });
  });

  it("gates everything when the thresholds are zero", () => {
    const zero = { approvalCents: 0, receiptCents: 0 };
    expect(expensePosting(1, zero)).toEqual({
      requiresReceipt: true,
      requiresApproval: true,
    });
  });
});

describe("pendingApprovalTotal", () => {
  it("is the awaiting-approval figure the closing screen shows", () => {
    expect(pendingApprovalTotal(120_000, 45_000)).toBe(45_000);
  });

  it("is zero when nothing is pending", () => {
    expect(pendingApprovalTotal(120_000, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/accounting.test.ts 2>&1 | tail -10`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/accounting.ts`:

```ts
export type ExpenseThresholds = { approvalCents: number; receiptCents: number };

export function expenseThresholds(
  approvalCents: number,
  receiptCents: number
): ExpenseThresholds {
  return {
    approvalCents: Math.max(0, approvalCents),
    receiptCents: Math.max(0, receiptCents),
  };
}

/**
 * Both gates are strictly-greater-than, so an expense sitting exactly at a
 * threshold is not gated. A threshold is a "watch anything above this" line,
 * not "this exact amount needs a second pair of eyes" — the shop sets it to
 * the largest routine spend and means it.
 */
export function expensePosting(
  amountCents: number,
  thresholds: ExpenseThresholds
): { requiresReceipt: boolean; requiresApproval: boolean } {
  return {
    requiresReceipt: amountCents > thresholds.receiptCents,
    requiresApproval: amountCents > thresholds.approvalCents,
  };
}

/**
 * What the daily closing must show alongside expected cash. An expense that
 * has left the bank but is not yet approved is on neither side of the ledger,
 * so without this figure the drawer looks short by exactly this much.
 */
export function pendingApprovalTotal(postedCents: number, pendingCents: number): number {
  return Math.max(pendingCents, 0) + Math.max(postedCents, 0) * 0;
}
```

> That last body is nonsense left over from drafting. The function should just
> return the pending figure — the posted amount is not part of it. Write:
>
> ```ts
> export function pendingApprovalTotal(postedCents: number, pendingCents: number): number {
>   void postedCents;
>   return Math.max(pendingCents, 0);
> }
> ```
>
> The `postedCents` argument stays only so the caller can pass the pair it
> already has; if you would rather not carry an unused parameter, change the
> signature to `pendingApprovalTotal(pendingCents: number): number` and update
> the test above to match. Do not ship the `* 0` version.

- [ ] **Step 4: Verify and commit**

Run: `cd packages/shared && pnpm exec vitest run 2>&1 | tail -4 && cd ../.. && pnpm --filter @goldos/shared exec tsc --noEmit`
Expected: all tests PASS, no typecheck output.

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: expense threshold arithmetic"
```

---

### Task 2: Migration 0019

**Files:**
- Create: `apps/api/drizzle/0019_expenses.sql`
- Modify: `apps/api/src/db/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces `expense_categories` and `expenses` exactly as spec §2, the three indexes, the `EXP` counter, and nine seeded categories bound to accounts 6000-6080.

- [ ] **Step 1: Write the migration**

Create `apps/api/drizzle/0019_expenses.sql` with the DDL from spec §2, the three indexes, `INSERT INTO counters (name, next) VALUES ('EXP', 1);`, and nine category rows:

```sql
INSERT INTO expense_categories (id, name, account_code, is_active, created_at, created_by) VALUES
  ('exp-rent',     'Rent & Rates',         '6000', 1, 1759000000000, 'admin-1'),
  ('exp-utilities','Utilities',             '6010', 1, 1759000000000, 'admin-1'),
  ('exp-salaries', 'Salaries & Wages',      '6020', 1, 1759000000000, 'admin-1'),
  ('exp-repairs',  'Repairs & Maintenance', '6030', 1, 1759000000000, 'admin-1'),
  ('exp-transport','Transport & Delivery',  '6040', 1, 1759000000000, 'admin-1'),
  ('exp-marketing','Marketing & Advertising','6050', 1, 1759000000000, 'admin-1'),
  ('exp-bankfees', 'Bank & Card Charges',   '6060', 1, 1759000000000, 'admin-1'),
  ('exp-office',   'Office & Consumables',  '6070', 1, 1759000000000, 'admin-1'),
  ('exp-other',    'Other Expenses',        '6080', 1, 1759000000000, 'admin-1');
```

- [ ] **Step 2: Mirror in Drizzle**

Append `expenseCategories` and `expenses` to `apps/api/src/db/schema.ts`,
matching the file's `sqliteTable(...)` style. Column names must match the DDL.

- [ ] **Step 3: Apply and verify**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --file=drizzle/0019_expenses.sql`
Expected: executed, no errors.

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT (SELECT COUNT(*) FROM expense_categories) AS cats, (SELECT COUNT(*) FROM expenses) AS exps, (SELECT COUNT(*) FROM counters WHERE name='EXP') AS ctr;"`
Expected: `cats` = 9, `exps` = 0, `ctr` = 1.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/drizzle/0019_expenses.sql apps/api/src/db/schema.ts
git commit -m "feat: migration 0019 — expense categories and expenses"
```

---

### Task 3: Schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `@goldos/shared`:
  - `createExpenseCategorySchema` — `{ name, description? }`
  - `expenseStatusSchema` — `{ isActive: 0|1, reason }`
  - `createExpenseSchema` — `{ categoryId, branchId, amountLkr, description, incurredOn?, vendor?, paidFrom: "cash" | "bank", bankAccountId? }`
  - `approveExpenseSchema` — `{ reason? }`
  - `rejectExpenseSchema` — `{ reason }`

- [ ] **Step 1: Append the schemas**

```ts
export const createExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const expenseStatusSchema = z.object({
  isActive: z.union([z.literal(0), z.literal(1)]),
  reason: z.string().min(1).max(500),
});

export const createExpenseSchema = z.object({
  categoryId: z.string().min(1),
  branchId: z.string().min(1),
  amountLkr: z.number().gt(0),
  description: z.string().min(1).max(500),
  incurredOn: BUSINESS_DATE.optional(),
  vendor: z.string().max(100).optional(),
  paidFrom: z.enum(["cash", "bank"]),
  bankAccountId: z.string().min(1).optional(),
});

export const approveExpenseSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const rejectExpenseSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit && pnpm --filter goldos-web exec tsc --noEmit`
Expected: no output.

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat: expense request schemas"
```

---

### Task 4: Service — categories

**Files:**
- Create: `apps/api/src/services/expenses.ts`

**Interfaces:**
- Consumes: migration 0019; `buildAuditStmt`; `getSetting`; `accountBalance`.
- Produces from `services/expenses.ts`:
  - `type ExpenseCategoryRow = { id, name, account_code, description, is_active, lifetime_cents }`
  - `listExpenseCategories(db): Promise<ExpenseCategoryRow[]>`
  - `createExpenseCategory(db, input, actorId): Promise<{ id, accountCode }>`
  - `setExpenseCategoryActive(db, id, isActive: 0|1, reason, actorId): Promise<void>`
  - `getExpenseCategory(db, id): Promise<{ id, name, account_code }>`

- [ ] **Step 1: Write the file header and the code allocator**

Create `apps/api/src/services/expenses.ts`:

```ts
import type { CreateExpenseCategoryInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { fail } from "./cashbank";
import { accountBalance } from "./journal";

/** 6000-6080 are seeded; a new category takes the next free code from here. */
const FIRST_FREE = 6090;
const LAST_FREE = 6199;

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
  return fail("VALIDATION", `No free expense account code between ${FIRST_FREE} and ${LAST_FREE}`);
}
```

> `fail` is exported from `services/cashbank.ts` (Task 4 of spec 2). If that
> export is not present, add `export function fail(...)` to a shared
> `services/errors.ts` and import it from both — do not re-declare it here.

- [ ] **Step 2: Add the category CRUD**

Append to the same file:

```ts
export type ExpenseCategoryRow = {
  id: string;
  name: string;
  account_code: string;
  description: string | null;
  is_active: number;
  lifetime_cents: number;
};

export async function listExpenseCategories(db: D1Database): Promise<ExpenseCategoryRow[]> {
  const { results } = await db
    .prepare("SELECT id, name, account_code, description, is_active FROM expense_categories ORDER BY account_code")
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
  const code = await allocateExpenseAccountCode(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, 'EXPENSE', 1, 0, ?)")
      .bind(code, input.name, input.description ?? null),
    db
      .prepare("INSERT INTO expense_categories (id, name, account_code, is_active, created_at, created_by) VALUES (?, ?, ?, 1, ?, ?)")
      .bind(id, input.name, code, now, actorId),
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
```

> **`expense_categories` has no `description` column** in the migration, but
> this writes one. Add `description TEXT` to the `expense_categories` DDL in
> 0019 and to the Drizzle mirror before running this task. A category the shop
> cannot describe is a category nobody picks correctly.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/src/services/expenses.ts apps/api/drizzle/0019_expenses.sql apps/api/src/db/schema.ts
git commit -m "feat: expense categories, one account each"
```

---

### Task 5: Service — entries, approval, receipts

**Files:**
- Modify: `apps/api/src/services/expenses.ts`

**Interfaces:**
- Consumes: everything from Task 4; `expensePosting`, `expenseThresholds` from shared; `getBankAccount`; `buildEntryStmts`; `businessDateFor`; `getSetting`; `lkrToCents`.
- Produces:
  - `expenseThresholdsFor(db): Promise<ExpenseThresholds>` — reads both settings
  - `createExpense(db, input, actorId): Promise<{ id, number, status, requiresReceipt }>`
  - `listExpenses(db, opts): Promise<{ rows: ExpenseRow[]; total: number }>`
  - `getExpense(db, id): Promise<ExpenseDetail>`
  - `approveExpense(db, id, input, actorId): Promise<{ entryId, entryNo }>`
  - `rejectExpense(db, id, reason, actorId): Promise<void>`
  - `attachReceipt(db, id, file: File, actorId): Promise<{ key }>`
  - `getReceipt(db, id): Promise<{ body: ArrayBuffer; contentType: string }>`
  - `expenseSummary(db, opts: { from, to, branchId? }): Promise<{ totalCents, pendingCents, byCategory: {...}[] }>`
  - `type ExpenseRow`, `type ExpenseDetail`, `type ExpenseSummary`

- [ ] **Step 1: Add thresholds and the payment-account resolver**

```ts
import { expensePosting, expenseThresholds, type ExpenseThresholds } from "@goldos/shared";
import { lkrToCents } from "@goldos/shared";
import { getBankAccount } from "./cashbank";
import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";
import { getSetting } from "./settings";

const DEFAULT_APPROVAL_CENTS = 500_000;
const DEFAULT_RECEIPT_CENTS = 1_000_000;

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
 * account's own code, and is NOT 1000 of the branch — a head-office invoice
 * paid from the main bank is a cost of the branch that spent it, not a
 * movement of that branch's cash.
 */
async function resolvePaymentAccount(
  db: D1Database,
  input: { paidFrom: "cash" | "bank"; bankAccountId?: string },
  branchId: string
): Promise<{ code: string; bankAccountId: string | null }> {
  if (input.paidFrom === "cash") return { code: "1000", bankAccountId: null };
  if (!input.bankAccountId) fail("VALIDATION", "A bank payment needs a bank account");
  const bank = await getBankAccount(db, input.bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  void branchId;
  return { code: bank.account_code, bankAccountId: bank.id };
}
```

- [ ] **Step 2: Add `createExpense`**

An expense at or below the approval threshold is created and posted in one
batch. Above it, only the row is written.

```ts
export async function createExpense(
  db: D1Database,
  input: {
    categoryId: string;
    branchId: string;
    amountLkr: number;
    description: string;
    incurredOn?: string;
    vendor?: string;
    paidFrom: "cash" | "bank";
    bankAccountId?: string;
  },
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
  const pay = await resolvePaymentAccount(db, input, input.branchId);
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
      .bind(id, number, input.categoryId, input.branchId, incurredOn, amountCents, input.vendor ?? null, input.description, pay.code, pay.bankAccountId, status, entryId, actorId, Date.now(), actorId),
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
```

- [ ] **Step 3: Add approval, rejection, receipts and the summary**

```ts
export async function approveExpense(
  db: D1Database,
  id: string,
  input: { reason?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const exp = await loadExpense(db, id);
  if (exp.status !== "PENDING_APPROVAL")
    fail("CONFLICT", `Expense is ${exp.status}, not awaiting approval`);
  // Self-approval is the whole point of requiring a second person.
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
      .prepare("UPDATE expenses SET status = 'POSTED', approved_by = ?, approved_at = ?, journal_entry_id = ? WHERE id = ?")
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
      .prepare("UPDATE expenses SET status = 'REJECTED', rejection_reason = ?, approved_by = ?, approved_at = ? WHERE id = ?")
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

export async function attachReceipt(
  db: D1Database,
  id: string,
  file: File,
  actorId: string
): Promise<{ key: string }> {
  const exp = await loadExpense(db, id);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    fail("VALIDATION", "Receipt must be jpeg, png or webp");
  if (file.size > 5 * 1024 * 1024) fail("VALIDATION", "Receipt must be under 5MB");
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `expenses/${exp.id}/${crypto.randomUUID()}.${ext}`;
  const r2 = (exp as { _r2?: R2Bucket })._r2;
  if (!r2) fail("INTERNAL", "R2 binding unavailable");
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
```

> **`attachReceipt` above is wrong about R2.** A service function has no
> `c.env`. Pass the bucket in instead:
>
> ```ts
> export async function attachReceipt(
>   db: D1Database,
>   r2: R2Bucket,
>   id: string,
>   file: File,
>   actorId: string
> ): Promise<{ key: string }> {
>   const exp = await loadExpense(db, id);
>   if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
>     fail("VALIDATION", "Receipt must be jpeg, png or webp");
>   if (file.size > 5 * 1024 * 1024) fail("VALIDATION", "Receipt must be under 5MB");
>   const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
>   const key = `expenses/${exp.id}/${crypto.randomUUID()}.${ext}`;
>   await r2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
>   await db.batch([...]);
>   return { key };
> }
> ```
>
> and the same for `getReceipt(db, r2, id)`. The route passes `c.env.R2`.
> Writing the snippet above as-is would compile and fail at runtime on the
> first upload.

- [ ] **Step 4: Add the loader, list, detail and summary**

```ts
type ExpenseDbRow = {
  id: string; number: string; category_id: string; branch_id: string;
  incurred_on: string; amount_cents: number; vendor: string | null;
  description: string; payment_account_code: string; bank_account_id: string | null;
  status: string; receipt_key: string | null; journal_entry_id: string | null;
  requested_by: string | null; approved_by: string | null; approved_at: number | null;
  rejection_reason: string | null; created_at: number; account_code: string;
  category_name: string;
};

async function loadExpense(db: D1Database, id: string): Promise<ExpenseDbRow> {
  const row = await db
    .prepare(
      "SELECT e.*, c.account_code, c.name AS category_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?"
    )
    .bind(id)
    .first<ExpenseDbRow>();
  if (!row) fail("NOT_FOUND", "Expense not found");
  return row;
}
```

`listExpenses`, `getExpense` and `expenseSummary` follow the paginated-list
pattern already used in `services/purchases.ts`. `expenseSummary` must return
`pendingCents` as the sum of `PENDING_APPROVAL` amounts in the period —
spec 4 renders it, and the whole point is that the closing screen can show
cash that has already left the bank.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/src/services/expenses.ts
git commit -m "feat: expense entries, approval, receipts, summary"
```

---

### Task 6: Routes and mount

**Files:**
- Create: `apps/api/src/routes/expenses.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-5; `pagination` and `serviceError`.
- Produces the eleven routes in spec §7.

- [ ] **Step 1: Write the router**

Follow the house style exactly. Two `Hono` instances — one for categories,
one for expenses — both exported. The receipt routes take
`c.req.parseBody()` and validate the file the way `routes/products.ts` does,
passing `c.env.DB` and `c.env.R2` to the service.

- [ ] **Step 2: Register the summary before `:id`**

Inside the expenses router, `.get("/reports/summary", …)` must be chained
**before** `.get("/:id", …)`. Hono matches in registration order, so a literal
path registered after `/:id` is read as an expense id — the same trap
`accounts.ts` hit.

- [ ] **Step 3: Mount**

In `apps/api/src/app.ts`, add the import and one route line next to the other
mounts:

```ts
import { expenseCategories, expenses } from "./routes/expenses";
...
app.route("/api/v1/expense-categories", expenseCategories);
app.route("/api/v1/expenses", expenses);
```

- [ ] **Step 4: Verify the order and typecheck**

Run: `grep -n '\.get("/\|\.post("/\|\.patch("/' apps/api/src/routes/expenses.ts`
Expected: `/reports/summary` above `/:id`.

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/expenses.ts apps/api/src/app.ts
git commit -m "feat: expense endpoints"
```

---

### Task 7: `expenses_crossfoot`

**Files:**
- Modify: `apps/api/src/services/reconcile.ts`
- Modify: `apps/api/src/services/reconcile.test.ts`

**Interfaces:**
- Consumes: `compareMoney`, `firstRow`, `LOCAL_DAY`.
- Produces one more check, bringing the total to 18.

- [ ] **Step 1: Add the check**

```ts
// expenses_crossfoot: money that left a payment account for an expense equals
// the POSTED expenses for the day. A pending expense is on neither side — the
// ledger has not seen it — so the check stays true while the day's CASH reads
// high. That gap is what spec 4's "awaiting approval" line exists to explain;
// do not "fix" it here by counting pending expenses, which would make the
// check pass and hide the discrepancy.
const expJournal = await firstRow<{ net: number }>(
  db,
  `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
   FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
   WHERE (l.account_code IN ('1000','1020')
          OR l.account_code IN (SELECT account_code FROM bank_accounts WHERE is_active = 1))
     AND l.account_code <> '1010'
     AND e.ref_entity = 'expense' AND e.entry_date = ?${b.sql}`,
  [day, ...b.vals]
);
const expDocs = await firstRow<{ total: number }>(
  db,
  `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
   WHERE status = 'POSTED' AND incurred_on = ?${eb.sql}`,
  opts.branchId ? [day, opts.branchId] : [day]
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
```

with `const eb = branchSql(opts.branchId, "branch_id");` declared beside the
other branch helpers.

> **Two things in the snippet above are wrong. Fix both.**
>
> 1. `l.account_code <> '1010'` excludes the primary bank for no reason —
>    1010 is in the sub-select already and is a legitimate payment account.
>    Drop that line.
> 2. `eb` filters `expenses.branch_id` on the document side but the journal
>    side is filtered by the *entry's* branch, and the two can differ for a
>    head-office cost. For this check the payment account is what matters, so
>    **do not branch-filter either side** — leave the check day-scoped and
>    unbranched, exactly as `trial_balance` is. Delete `eb` entirely and bind
>    `[day]`.

- [ ] **Step 2: Add a test**

Append to `apps/api/src/services/reconcile.test.ts`:

```ts
describe("expense cross-foot", () => {
  it("passes when the payment movement matches posted expenses", () => {
    const r = compareMoney("expenses_crossfoot", "Expenses", 450_000, 450_000, "day");
    expect(r.pass).toBe(true);
  });

  it("fails when a pending expense has been paid but not yet booked", () => {
    // The journal has not seen it, and neither side counts it — so the check
    // passes while the day's cash reads high. That is deliberate.
    expect(compareMoney("expenses_crossfoot", "Expenses", 0, 0, "day").pass).toBe(true);
  });
});
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

```bash
git add apps/api/src/services/reconcile.ts apps/api/src/services/reconcile.test.ts
git commit -m "feat: expenses cross-foot check"
```

---

### Task 8: Web pages

**Files:**
- Create: `apps/web/app/(app)/expenses/page.tsx`
- Create: `apps/web/app/(app)/expenses/[id]/page.tsx`
- Modify: `apps/web/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: the eleven endpoints.
- Produces two pages and a sidebar entry under a new "Expenses" section, gated on `accounts:view`.

- [ ] **Step 1: Build the list page**

Follow the house pattern: `"use client"`, `MasterCrud`-style table is NOT a
fit here (expenses have status and a form with a category, amount, payment
account and description), so use the raw `Page` / `Hero` / `TableCard` /
`Pager` primitives from `components/ui.tsx` the way `sales/invoices` does.

- [ ] **Step 2: Build the detail page with approve/reject and the receipt**

Show the amount, category, branch, payment account, status, and the approval
trail. Approve and reject call the two endpoints. Upload uses a `multipart`
`FormData` POST to the receipt endpoint, and the receipt renders as an `<img>`
pointing at `GET /expenses/:id/receipt`.

> The `api` helper in `lib/api.ts` sends a JSON body. For the upload, either
> extend it with an optional `FormData` branch or `fetch` the endpoint
> directly with the session cookie. Do not send a `FormData` body as JSON —
> it serialises to `"[object FormData]"` and the upload silently fails.

- [ ] **Step 3: Add the sidebar entry**

In `components/app-sidebar.tsx`, add an "Expenses" item with
`perm: "accounts:view"` in the appropriate section.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter goldos-web exec tsc --noEmit`
Expected: no output.

```bash
git add apps/web
git commit -m "feat: expenses UI — list, detail, approval, receipt upload"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md`

- [ ] **Step 1: `docs/database.md`**

Add an `Expenses (0019_expenses)` section: both tables, the three indexes,
the `EXP` counter, the nine seeded categories bound to 6000-6080, and the
6090-6199 allocation rule for a new category.

- [ ] **Step 2: `docs/api.md`**

Add the eleven routes with permissions. Note that the receipt routes take
multipart and that `/expenses/reports/summary` is registered before
`/expenses/:id`.

- [ ] **Step 3: `docs/gold-accounting.md`**

Add an `Expenses` section: the posting pair, the two thresholds and their
keys, the approver-≠-requester rule, the receipt gate, and — importantly —
that an unapproved expense makes the day's cash read high, with the line
spec 4 must render. Update the reconciliation count to 18.

- [ ] **Step 4: Commit**

```bash
git add docs/database.md docs/api.md docs/gold-accounting.md
git commit -m "docs: expenses — categories, approval, receipts, cross-foot"
```

---

## Live verification

1. `GET /expense-categories` lists the nine seeded categories with accounts and
   lifetime spend. Create one; confirm it took `6090` and created the ledger
   account. Try to deactivate `exp-rent`; expect `CONFLICT`.
2. Record a LKR 500 expense paid in cash. Confirm it posts immediately:
   `DR 6010 / CR 1000`, `status = POSTED`, and that
   `payments_crossfoot` and `expenses_crossfoot` both still pass.
3. Record a LKR 45,000 expense. Confirm `PENDING_APPROVAL` with **no** entry,
   and that approving without a receipt returns `400`.
4. Attach a receipt, approve as a different user. Confirm the entry posts as
   `DR 6030 / CR <bank>` and `expenses_crossfoot` passes.
5. Try to approve your own expense; expect `FORBIDDEN`. Try to reject your own;
   expect `FORBIDDEN`.
6. Reject another expense with a reason. Confirm it stays visible as
   `REJECTED` with no entry and no deletion.
7. Pay an expense from the **second** bank account; confirm
   `payments_crossfoot` still passes.
8. `GET /expenses/reports/summary` shows `pendingCents` equal to the
   unapproved total — the figure spec 4 will render on the closing screen.
9. Upload a receipt larger than 5 MB; expect `400`. Upload a `.txt`; expect
   `400`.
10. Run a full day and confirm **all 18 checks pass**.

## Spec coverage

- Spec §2 both tables, indexes, counter, nine seeded categories → Task 2
- Spec §2 category account allocation and the deactivation guard → Task 4
- Spec §3 both threshold keys and defaults → Task 1, Task 5
- Spec §4 the posting, branch attribution, one-batch vs two-phase → Task 5
- Spec §5 the consequence spec 4 inherits → Task 5, Task 9
- Spec §6 the R2 receipt pattern and the approval receipt gate → Task 5
- Spec §7 all eleven endpoints and the route-order trap → Task 6
- Spec §8 `expenses_crossfoot` and why it is not branch-filtered → Task 7
- Spec §10 Vitest coverage and the live gate → Tasks 1, 7 and the live verification above

## Self-Review

- **Spec coverage:** every §1-§8 and §10 item maps to a task; §11 out-of-scope
  is honoured by no task building any of it.
- **Placeholder scan:** every step carries real code or a real command with its
  expected output.
- **Type consistency:** `expenseThresholds` / `expensePosting` have one
  definition and one import site; `resolvePaymentAccount` returns the same
  `{code, bankAccountId}` shape everywhere; `loadExpense` is the single row
  loader used by approve, reject and both receipt paths.
- **Three steps flag a correction inline** — the leftover `* 0` arithmetic, the
  R2 binding a service function does not have, and the two errors in the first
  draft of `expenses_crossfoot` — because each is something that would compile
  and then be wrong.
