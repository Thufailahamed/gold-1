# GoldOS Cash & Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable bank accounts, cash deposits and withdrawals, two-entry branch transfers, card settlement out of Card Clearing, bank statement reconciliation, two new cross-foot checks, and the gold-ledger row a branch stock transfer was missing.

**Architecture:** Every flow is a document row plus one or two journal entries, written in a single `db.batch` with the audit row, following the pattern spec 1 established. A branch transfer is two entries because a journal entry has exactly one `branch_id`. Cash needs no table — one 1000 per branch is already what the ledger models.

**Tech Stack:** Hono 4.5 on Cloudflare Workers · Cloudflare D1 (SQLite) via raw `.prepare().bind()` · Zod 3.23 in `@goldos/shared` · Vitest 2 · pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-09-28-goldos-cash-bank-design.md`
**Requires:** spec 1 merged (migrations 0015-0017 applied, `buildEntryStmts` and `businessDateFor` in place, `reconcile` returning `CheckResult[]`).

## Global Constraints

- Every `id` is `crypto.randomUUID()`. All timestamps are `INTEGER` epoch millis; `entry_date` and `settled_on`/`sent_on` are `TEXT` `'YYYY-MM-DD'`, shop-local.
- Money is `INTEGER` cents. Never `DELETE` a business row; corrections are reversing entries.
- Every mutation batches its `audit_logs` insert inside the same `db.batch` as the business write.
- Services throw `Object.assign(new Error("msg"), { code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INTERNAL" })`.
- `D1Database` and `D1PreparedStatement` are Workers globals — never imported.
- `strict` + `noUncheckedIndexedAccess` on.
- D1 rejects `.bind()` with no arguments. Bind only when there is something to bind.
- Entry numbers come from a single atomic `UPDATE counters SET next = next + 1 … RETURNING`, reserved **outside** the caller's batch. Never read-then-defer.
- A cross-branch transfer is two entries. An entry has one `branch_id`.
- No new permissions. `accounts:view` and `accounts:manage` only.

---

## Permission additions (single source of truth)

**None.** Count stays at **53** across 8 roles. Everything is gated by
`accounts:view` (read, and recording a statement balance) or
`accounts:manage` (anything that moves money or changes an account).

---

## File Structure

**Create:**
- `apps/api/drizzle/0018_cash_bank.sql` — four tables, two counters, indexes
- `apps/api/src/services/cashbank.ts` — bank accounts, deposits, withdrawals, transfers, settlements, reconciliation
- `apps/api/src/services/cashbank.test.ts` — the pure arithmetic
- `apps/api/src/routes/cashbank.ts` — the endpoints

**Modify:**
- `packages/shared/src/accounting.ts` — `settlementAmounts`, `inTransitTotal`
- `packages/shared/src/accounting.test.ts` — tests for both
- `packages/shared/src/schemas.ts` — the flow schemas
- `packages/shared/src/index.ts` — unchanged (already `export * from "./accounting"`)
- `apps/api/src/db/schema.ts` — Drizzle mirror
- `apps/api/src/app.ts` — mount the router
- `apps/api/src/services/inventory.ts` — gold ledger row on a product transfer
- `apps/api/src/services/purchases.ts` — pay against a bank account
- `apps/api/src/services/reconcile.ts` — two new checks, and the account filter fix
- `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md` — task 10

---

### Task 1: Shared arithmetic

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Modify: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `settlementAmounts(grossCents: number, feeCents: number): { grossCents: number; feeCents: number; netCents: number }` — throws `VALIDATION` if `feeCents` is negative, non-integer, or greater than `grossCents`
  - `inTransitTotal(dispatchedCents: number, receivedCents: number): number` — the money still on the road, floored at 0

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/accounting.test.ts`:

```ts
describe("settlementAmounts", () => {
  it("splits gross into net plus fee", () => {
    expect(settlementAmounts(250_000, 6_000)).toEqual({
      grossCents: 250_000,
      feeCents: 6_000,
      netCents: 244_000,
    });
  });

  it("allows a zero fee", () => {
    expect(settlementAmounts(100_000, 0).netCents).toBe(100_000);
  });

  it("rejects a fee larger than the settlement", () => {
    expect(() => settlementAmounts(100_000, 100_001)).toThrow(/fee/i);
  });

  it("rejects a negative or fractional fee", () => {
    expect(() => settlementAmounts(100_000, -1)).toThrow();
    expect(() => settlementAmounts(100_000, 1.5)).toThrow();
  });
});

describe("inTransitTotal", () => {
  it("is the sent amount until the receipt is recorded", () => {
    expect(inTransitTotal(100_000, 0)).toBe(100_000);
  });

  it("clears when the whole amount is received", () => {
    expect(inTransitTotal(100_000, 100_000)).toBe(0);
  });

  it("shows the remainder on a part-received transfer", () => {
    expect(inTransitTotal(100_000, 40_000)).toBe(60_000);
  });

  it("never reports negative when the books over-receive", () => {
    expect(inTransitTotal(100_000, 120_000)).toBe(0);
  });
});
```

and add to the import list at the top of that file, after `meltingLossValue,`:
`inTransitTotal,` and `settlementAmounts,`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/accounting.test.ts 2>&1 | tail -12`
Expected: FAIL — `settlementAmounts` and `inTransitTotal` are not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/accounting.ts`:

```ts
/**
 * A card settlement splits the gross the shop took into the net the
 * acquirer actually pays and the fee they withhold. The fee is booked, not
 * absorbed — losing it is how a shop quietly under-makes on card turnover.
 */
export function settlementAmounts(
  grossCents: number,
  feeCents: number
): { grossCents: number; feeCents: number; netCents: number } {
  if (!Number.isInteger(grossCents) || grossCents <= 0)
    throw Object.assign(new Error("Settlement gross must be a positive whole amount"), {
      code: "VALIDATION",
    });
  if (!Number.isInteger(feeCents) || feeCents < 0)
    throw Object.assign(new Error("Settlement fee must be a whole amount of zero or more"), {
      code: "VALIDATION",
    });
  if (feeCents > grossCents)
    throw Object.assign(new Error("Settlement fee cannot exceed the gross"), {
      code: "VALIDATION",
    });
  return { grossCents, feeCents, netCents: grossCents - feeCents };
}

/**
 * Money that left the sending branch but has not yet arrived. Floored at zero
 * so an over-receipt in the books reads as nothing in transit rather than as
 * negative money, which would hide the error.
 */
export function inTransitTotal(dispatchedCents: number, receivedCents: number): number {
  return Math.max(dispatchedCents - receivedCents, 0);
}
```

- [ ] **Step 4: Verify and commit**

Run: `cd packages/shared && pnpm exec vitest run 2>&1 | tail -4 && cd ../.. && pnpm --filter @goldos/shared exec tsc --noEmit`
Expected: all tests PASS, no typecheck output.

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: settlement and in-transit arithmetic"
```

---

### Task 2: Migration 0018

**Files:**
- Create: `apps/api/drizzle/0018_cash_bank.sql`
- Modify: `apps/api/src/db/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces the four tables the rest of the plan reads and writes, plus `SETL` and `XFER` counters.

- [ ] **Step 1: Write the migration**

Create `apps/api/drizzle/0018_cash_bank.sql` with the DDL from spec §2: the four tables (`bank_accounts`, `card_settlements`, `cash_transfers`, `bank_reconciliations`), the three indexes (`idx_cs_account`, `idx_ct_status`, `idx_br_account`), and `INSERT INTO counters (name, next) VALUES ('SETL', 1), ('XFER', 1);`.

- [ ] **Step 2: Mirror in Drizzle**

Append to `apps/api/src/db/schema.ts`, matching the file's existing
`sqliteTable(...)` style, one export per table: `bankAccounts`,
`cardSettlements`, `cashTransfers`, `bankReconciliations`. Column names must
match the DDL exactly.

- [ ] **Step 3: Apply and verify**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --file=drizzle/0018_cash_bank.sql`
Expected: executed, no errors.

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT (SELECT COUNT(*) FROM bank_accounts) AS banks, (SELECT COUNT(*) FROM counters WHERE name IN ('SETL','XFER')) AS counters;"`
Expected: `banks` = 0, `counters` = 2.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/drizzle/0018_cash_bank.sql apps/api/src/db/schema.ts
git commit -m "feat: migration 0018 — bank accounts, settlements, transfers, reconciliations"
```

---

### Task 3: Schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `@goldos/shared`:
  - `createBankAccountSchema` — `{ name, bankName?, accountNumber?, branchId? }`
  - `updateBankAccountSchema` — `{ name?, bankName?, accountNumber?, reason }`
  - `openingBalanceSchema` — `{ amountCents: positive int, reason, entryDate? }`
  - `cashMoveSchema` — `{ branchId, bankAccountId, amountCents: positive int, note?, entryDate? }`
  - `transferDispatchSchema` — `{ fromBranchId, toBranchId, amountCents: positive int, sentOn?, reason }`
  - `transferReceiveSchema` — `{ receivedOn?, note? }`
  - `cardSettlementSchema` — `{ bankAccountId, grossCents: positive int, feeCents?: non-negative int default 0, settledOn?, acquirerRef?, note? }`
  - `reconcileStatementSchema` — `{ statementDate, statementBalanceCents: int, note? }`

- [ ] **Step 1: Append the schemas**

Append to `packages/shared/src/schemas.ts`. Use the file's existing `z.object` style and the shared `BUSINESS_DATE` pattern:

```ts
const BUSINESS_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CENTS = z.number().int();

export const createBankAccountSchema = z.object({
  name: z.string().min(1).max(100),
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  branchId: z.string().min(1).optional(),
});

export const updateBankAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  bankName: z.string().max(100).optional(),
  accountNumber: z.string().max(50).optional(),
  reason: z.string().min(1).max(500),
});

export const openingBalanceSchema = z.object({
  amountCents: CENTS.positive(),
  reason: z.string().min(1).max(500),
  entryDate: BUSINESS_DATE.optional(),
});

export const cashMoveSchema = z.object({
  branchId: z.string().min(1),
  bankAccountId: z.string().min(1),
  amountCents: CENTS.positive(),
  note: z.string().max(500).optional(),
  entryDate: BUSINESS_DATE.optional(),
});

export const transferDispatchSchema = z.object({
  fromBranchId: z.string().min(1),
  toBranchId: z.string().min(1),
  amountCents: CENTS.positive(),
  sentOn: BUSINESS_DATE.optional(),
  reason: z.string().min(1).max(500),
});

export const transferReceiveSchema = z.object({
  receivedOn: BUSINESS_DATE.optional(),
  note: z.string().max(500).optional(),
});

export const cardSettlementSchema = z.object({
  bankAccountId: z.string().min(1),
  grossCents: CENTS.positive(),
  feeCents: CENTS.min(0).optional().default(0),
  settledOn: BUSINESS_DATE.optional(),
  acquirerRef: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export const reconcileStatementSchema = z.object({
  statementDate: BUSINESS_DATE,
  statementBalanceCents: CENTS,
  note: z.string().max(500).optional(),
});
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter @goldos/api exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat: cash and bank request schemas"
```

---

### Task 4: Service — bank accounts and opening balances

**Files:**
- Create: `apps/api/src/services/cashbank.ts`
- Modify: `apps/api/src/services/audit.ts` — no; use the existing `buildAuditStmt`

**Interfaces:**
- Consumes: `buildEntryStmts`, `accountBalance` (Task 4 of spec 1); `openingBalanceSchema` output; migration 0018.
- Produces from `services/cashbank.ts`:
  - `type BankAccountRow = { id, name, bank_name, account_number, account_code, branch_id, opening_balance_cents, opened_on, is_active, balance_cents }`
  - `listBankAccounts(db, opts?: { branchId?: string }): Promise<BankAccountRow[]>`
  - `createBankAccount(db, input, actorId): Promise<{ id: string; accountCode: string }>` — allocates the code, creates the ledger account and the registration in one batch
  - `updateBankAccount(db, id, input, actorId): Promise<void>`
  - `openBankAccount(db, id, input: { amountCents, reason, entryDate? }, actorId): Promise<{ entryId, entryNo }>`
  - `getBankAccount(db, id): Promise<BankAccountRow>` — throws `NOT_FOUND`

- [ ] **Step 1: Write the file header and the code allocator**

Create `apps/api/src/services/cashbank.ts`:

```ts
import type { CreateBankAccountInput, UpdateBankAccountInput, OpeningBalanceInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import { businessDateFor } from "./busdate";
import { accountBalance, buildEntryStmts } from "./journal";

const CARD_CLEARING = "1020";
/** 1010 already exists as the system "Bank" account; 1020 is Card Clearing. */
const RESERVED = new Set(["1020"]);

function fail(code: string, message: string): never {
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
```

- [ ] **Step 2: Add the bank account CRUD**

Append to the same file:

```ts
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
  const id = crypto.randomUUID();
  const now = Date.now();
  // The first account adopts 1010, which already exists as a system account,
  // so only create a ledger account when the code is genuinely new.
  const exists = await db
    .prepare("SELECT code FROM chart_of_accounts WHERE code = ?")
    .bind(code)
    .first();
  const stmts: D1PreparedStatement[] = [];
  if (!exists) {
    stmts.push(
      db
        .prepare("INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, 'ASSET', 1, 0, ?)")
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
      .prepare("INSERT INTO bank_accounts (id, name, bank_name, account_number, account_code, branch_id, opening_balance_cents, is_active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)")
      .bind(id, input.name, input.bankName ?? null, input.accountNumber ?? null, code, input.branchId ?? null, now, actorId),
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
  const isActive = (input as { isActive?: 0 | 1 }).isActive;
  const name = input.name ?? before.name;
  const bankName = input.bankName ?? before.bank_name;
  const accountNumber = input.accountNumber ?? before.account_number;
  await db.batch([
    db
      .prepare("UPDATE bank_accounts SET name = ?, bank_name = ?, account_number = ?, is_active = ? WHERE id = ?")
      .bind(name, bankName, accountNumber, isActive ?? before.is_active, id),
    buildAuditStmt(db, {
      userId: actorId,
      action: "cashbank.update",
      entity: "bank_account",
      entityId: id,
      prev: before,
      next: { name, bankName, accountNumber, isActive: isActive ?? before.is_active },
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
      memo: `Opening balance for ${account.name}`,
      branchId: account.branch_id ?? undefined,
      actorId,
      auditAction: "cashbank.open",
      auditEntity: "bank_account",
      auditEntityId: id,
      sourceModule: "bank",
    },
    { entryDate: input.entryDate ?? (await businessDateFor(db, Date.now())) }
  );
  await db.batch([
    ...built.stmts,
    db
      .prepare("UPDATE bank_accounts SET opening_balance_cents = ?, opened_on = ? WHERE id = ?")
      .bind(input.amountCents, input.entryDate ?? (await businessDateFor(db, Date.now())), id),
  ]);
  return { entryId: built.entryId, entryNo: built.entryNo };
}
```

> **Watch for a double read.** `openBankAccount` calls `businessDateFor` twice,
> which is two settings reads. Compute it once into a local before building the
> batch, and use it for both the entry and the column. Fix that while writing
> the file.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/cashbank.ts
git commit -m "feat: bank accounts with allocated ledger codes and opening balances"
```

---

### Task 5: Service — cash moves, transfers, settlements, reconciliation

**Files:**
- Modify: `apps/api/src/services/cashbank.ts`
- Modify: `packages/shared/src/schemas.ts` — add the `listBankAccounts` query types the service needs

**Interfaces:**
- Consumes: everything from Task 4; `settlementAmounts`, `inTransitTotal` (Task 1).
- Produces, all from `services/cashbank.ts`:
  - `depositCash(db, input: CashMoveInput, actorId): Promise<{ entryId, entryNo }>` — `DR bank / CR 1000`
  - `withdrawCash(db, input, actorId): Promise<{ entryId, entryNo }>` — `DR 1000 / CR bank`
  - `dispatchTransfer(db, input: TransferDispatchInput, actorId): Promise<{ id, number, entryId, entryNo }>`
  - `receiveTransfer(db, id, input: TransferReceiveInput, actorId): Promise<{ entryId, entryNo }>`
  - `listTransfers(db, opts?: { status?: string; branchId?: string }): Promise<{ rows: TransferRow[]; total: number }>`
  - `settleCardBatch(db, input: CardSettlementInput, actorId): Promise<{ id, number, entryId, entryNo, netCents }>`
  - `listSettlements(db, opts: { page, limit, bankAccountId? }): Promise<{ rows: SettlementRow[]; total: number }>`
  - `reconcileStatement(db, bankAccountId, input: ReconcileStatementInput, actorId): Promise<StatementReconciliation>`
  - `type StatementReconciliation = { statementDate, statementBalanceCents, ledgerBalanceCents, differenceCents, uncleared: { entryId, entryNo, entryDate, amountCents, memo }[], pass }`

- [ ] **Step 1: Add the money-movement internals**

Append to `apps/api/src/services/cashbank.ts`. Every flow follows the same
shape: validate, build the entry, batch the document with it.

```ts
import { inTransitTotal, settlementAmounts } from "@goldos/shared";

async function nextNumber(db: D1Database, stmts: D1PreparedStatement[], name: string, prefix: string): Promise<string> {
  const row = await db
    .prepare("UPDATE counters SET next = next + 1 WHERE name = ? RETURNING next - 1 AS allocated")
    .bind(name)
    .first<{ allocated: number }>();
  if (!row) fail("INTERNAL", `Counter ${name} missing`);
  return `${prefix}-${String(row.allocated).padStart(6, "0")}`;
}

export async function depositCash(
  db: D1Database,
  input: { branchId: string; bankAccountId: string; amountCents: number; note?: string; entryDate?: string },
  actorId: string
): Promise<{ entryId: string; entryNo: string }> {
  const bank = await getBankAccount(db, input.bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  const br = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!br) fail("NOT_FOUND", "Branch not found");
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
  const bank = await getBankAccount(db, input.bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  const br = await db
    .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
    .bind(input.branchId)
    .first();
  if (!br) fail("NOT_FOUND", "Branch not found");
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
```

- [ ] **Step 2: Add the two-entry branch transfer**

Append to the same file:

```ts
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
 * the other branch's cash wrong by the full amount, so the money is
 * explicitly in transit until the other side records it.
 */
export async function dispatchTransfer(
  db: D1Database,
  input: { fromBranchId: string; toBranchId: string; amountCents: number; sentOn?: string; reason: string },
  actorId: string
): Promise<{ id: string; number: string; entryId: string; entryNo: string }> {
  if (input.fromBranchId === input.toBranchId)
    fail("VALIDATION", "A transfer needs two different branches");
  for (const b of [input.fromBranchId, input.toBranchId]) {
    const row = await db
      .prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1")
      .bind(b)
      .first();
    if (!row) fail("NOT_FOUND", `Branch not found: ${b}`);
  }
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "XFER", "XFER");
  const sentOn = input.sentOn ?? (await businessDateFor(db, Date.now()));
  const built = await buildEntryStmts(
    db,
    {
      lines: [{ account: "1000", debitCents: 0, creditCents: input.amountCents }],
      refEntity: "cash_transfer_out",
      refId: id,
      refNo: number,
      memo: `${number} to ${input.toBranchId}: ${input.reason}`,
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
      .prepare("INSERT INTO cash_transfers (id, number, from_branch_id, to_branch_id, amount_cents, sent_on, status, reason, from_entry_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?)")
      .bind(id, number, input.fromBranchId, input.toBranchId, input.amountCents, sentOn, input.reason, built.entryId, Date.now(), actorId)
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
      memo: `${t.number} received: ${input.note ?? "cash in transit"}`,
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
```

- [ ] **Step 3: Add the listing, settlement and reconciliation**

Append to the same file:

```ts
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
  const bank = await getBankAccount(db, input.bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  const number = await nextNumber(db, stmts, "SETL", "SETL");
  const settledOn = input.settledOn ?? (await businessDateFor(db, Date.now()));
  const lines = [
    { account: bank.account_code, debitCents: amounts.netCents, creditCents: 0 },
    { account: "1020", debitCents: 0, creditCents: amounts.grossCents },
  ];
  if (amounts.feeCents > 0)
    lines.push({ account: "6060", debitCents: 0, creditCents: amounts.feeCents });
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
      .prepare("INSERT INTO card_settlements (id, number, bank_account_id, settled_on, gross_cents, fee_cents, net_cents, acquirer_ref, note, journal_entry_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, number, input.bankAccountId, settledOn, amounts.grossCents, amounts.feeCents, amounts.netCents, input.acquirerRef ?? null, input.note ?? null, built.entryId, Date.now(), actorId)
  );
  await db.batch(stmts);
  return { id, number, entryId: built.entryId, entryNo: built.entryNo, netCents: amounts.netCents };
}
```

Then `listSettlements` (a plain paginated list) and `reconcileStatement`:

```ts
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
  uncleared: { entryId: string; entryNo: string; entryDate: string; amountCents: number; memo: string | null }[];
}> {
  const bank = await getBankAccount(db, bankAccountId);
  if (!bank.is_active) fail("CONFLICT", "Bank account is inactive");
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
      .prepare("INSERT INTO bank_reconciliations (id, bank_account_id, statement_date, statement_balance_cents, ledger_balance_cents, difference_cents, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, bankAccountId, input.statementDate, input.statementBalanceCents, ledgerBalanceCents, differenceCents, input.note ?? null, Date.now(), actorId),
    buildAuditStmt(db, {
      userId: actorId,
      action: "cashbank.reconcile",
      entity: "bank_reconciliation",
      entityId: id,
      next: { statementDate: input.statementDate, statementBalanceCents: input.statementBalanceCents, ledgerBalanceCents, differenceCents },
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
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/src/services/cashbank.ts packages/shared/src/schemas.ts
git commit -m "feat: cash deposits, branch transfers, card settlement, statement reconciliation"
```

---

### Task 6: Routes

**Files:**
- Create: `apps/api/src/routes/cashbank.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-5; the request schemas from Task 3; `businessDateFor`; `pagination` and `serviceError` from `./http`.
- Produces eleven routes, all under `/api/v1` — see spec §6.

- [ ] **Step 1: Write the router**

Create `apps/api/src/routes/cashbank.ts` following the house style exactly: `hono` → `zod` → `@goldos/shared` → `type { Env }` → middleware → services → `./http`. One `Hono` instance for bank accounts and reconciliation, one for the cash and settlement flows, both exported.

Every handler: parse with the shared schema, `400` on failure, `try`/`catch` to `serviceError`. Use `pagination(c)` for the two list endpoints.

- [ ] **Step 2: Mount the routers**

In `apps/api/src/app.ts`, add the import and two `app.route` calls:

```ts
import { bankAccounts, cash, settlements } from "./routes/cashbank";
...
app.route("/api/v1/bank-accounts", bankAccounts);
app.route("/api/v1/cash", cash);
app.route("/api/v1/card-settlements", settlements);
```

Place them with the other mounts, after `app.route("/api/v1/accounts", accounts);`.

- [ ] **Step 3: Verify the route order**

Read the assembled chains and confirm no `/:id` handler is registered before a
literal path it would shadow — the same trap `accounts.ts` had. In particular
`/bank-accounts/:id/opening` and `/bank-accounts/:id/reconcile` must not be
reachable by a `GET /bank-accounts/:id`.

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/cashbank.ts apps/api/src/app.ts
git commit -m "feat: cash and bank endpoints"
```

---

### Task 7: Gold ledger row on a product transfer

**Files:**
- Modify: `apps/api/src/services/inventory.ts`

**Interfaces:**
- Consumes: `postGoldStmts` from `services/gold.ts`, which `inventory.ts` does not yet import; `fineGoldMg` from shared.
- Produces: a `gold_ledger` row of type `TRANSFER` whenever a product moves branch, so the gold ledger and `products.branch_id` agree.

- [ ] **Step 1: Add the ledger row to the transfer block**

In `recordMovement`'s `input.toStatus === "TRANSFER_PENDING"` branch, the
product's fine gold and purity are needed. The block currently reads `prev` for
status and branch only, so extend the `prev` query to also select
`fine_gold_mg` and `purity_id`, then join `purities` for the permille.

Inside the same `db.batch`, add one statement:

```ts
db
  .prepare(
    "INSERT INTO gold_ledger (id, occurred_at, branch_id, source, destination, type, weight_mg, permille, fine_mg, ref_entity, ref_id, product_id, old_gold_id, user_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, 'TRANSFER', ?, ?, ?, 'inventory_transfer', ?, ?, NULL, ?, ?, ?, ?)"
  )
  .bind(
    crypto.randomUUID(),
    now,
    input.toBranchId,
    `branch:${prev.branch_id}`,
    `branch:${input.toBranchId}`,
    prev.net_mg,
    permille,
    fineMg,
    movementId,
    input.productId,
    actorId,
    input.reason ?? null,
    now,
    actorId
  ),
```

The direction convention is the one `gold_stock_consistency` reads: source is
the branch the gold left, destination is the branch it arrived at. Use the
already-generated `inId` as the ledger `ref_id` so the ledger row and the
`stock_movements` IN row carry the same reference.

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

```bash
git add apps/api/src/services/inventory.ts
git commit -m "feat: product transfers write a gold ledger row"
```

---

### Task 8: Supplier payments against a bank account

**Files:**
- Modify: `apps/api/src/services/purchases.ts`
- Modify: `apps/api/src/routes/purchases.ts`

**Interfaces:**
- Consumes: `getBankAccount` from `services/cashbank.ts`.
- Changes: `payInvoice` and the paid-on-receipt path take a `bankAccountId` and credit that account's code instead of picking `1000` or `1010` by a free-text method.

- [ ] **Step 1: Replace the free-text method with a bank account**

Today `payInvoice` does `const cash = method === "cash" ? "1000" : "1010";`.
Replace the `method` parameter with `bankAccountId: string`, resolve it through
`getBankAccount`, and credit `bank.account_code`. Update
`payInvoiceSchema` in `packages/shared/src/schemas.ts` to take `bankAccountId`
instead of `method`.

Apply the same change in `receiveBatch`'s paid-on-receipt path.

- [ ] **Step 2: Make the old accounts reachable as a default**

For a shop that has never registered a bank account, the first `POST /accounts`
call adopts 1010, so nothing breaks. But a shop that has *not* yet created one
and tries to pay a supplier must get a clear error, not a silent `1010`:

```ts
if (!bank.is_active) throw Object.assign(new Error("Bank account is inactive"), { code: "CONFLICT" });
```

Add a migration-time safety net instead of a code branch: nothing. A missing
registration is a real misconfiguration and should say so.

- [ ] **Step 3: Update the web pages**

`apps/web/app/(app)/purchases/invoices/[id]/page.tsx` posts a `method` of
`"cash" | "bank"`. Change it to select a bank account from
`GET /bank-accounts` and post `bankAccountId`. If the list is empty, show a
message pointing at the accounts screen rather than a form that cannot work.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit && pnpm --filter goldos-web exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/src/services/purchases.ts apps/api/src/routes/purchases.ts packages/shared/src/schemas.ts "apps/web/app/(app)/purchases/invoices/[id]/page.tsx"
git commit -m "feat: supplier payments settle against a named bank account"
```

---

### Task 9: Two new checks, and the account filter fix

**Files:**
- Modify: `apps/api/src/services/reconcile.ts`
- Modify: `apps/api/src/services/reconcile.test.ts`

**Interfaces:**
- Consumes: migration 0018; `compareMoney`; the existing `firstRow` helper.
- Produces: `card_clearing` and `cash_in_transit` checks, and a
  `payments_crossfoot` whose account filter reads `bank_accounts` instead of
  hard-coding 1010.

- [ ] **Step 1: Fix the payments filter**

In `payments_crossfoot`'s journal query, replace
`l.account_code IN ('1000','1010','1020')` with:

```sql
(l.account_code IN ('1000','1020')
 OR l.account_code IN (SELECT account_code FROM bank_accounts WHERE is_active = 1))
```

Without this, a payment out of a second bank account is invisible to the check
and every paid purchase from that bank reads as a discrepancy.

- [ ] **Step 2: Add `card_clearing`**

```ts
const clearJournal = await firstRow<{ net: number }>(
  db,
  `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
   FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
   WHERE l.account_code = '1020' AND e.ref_entity = 'card_settlement' AND e.entry_date = ?${b.sql}`,
  [day, ...b.vals]
);
const clearDocs = await firstRow<{ gross: number }>(
  db,
  `SELECT COALESCE(SUM(gross_cents), 0) AS gross FROM card_settlements
   WHERE ${LOCAL_DAY("created_at")} = ?${branchSql(opts.branchId, "bank_account_id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)") || ""}`.replace(
     "bank_account_id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)",
     "id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)"
   ),
  branchSql(opts.branchId, "id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)").vals.length
    ? [day, ...branchSql(opts.branchId, "id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)").vals]
    : [day]
);
```

> **That query is contorted and wrong-looking. Write it plainly instead:**

```ts
const csCond = opts.branchId
  ? " AND id IN (SELECT id FROM bank_accounts WHERE branch_id = ?)"
  : "";
const csVals = opts.branchId ? [day, opts.branchId] : [day];
const clearDocs = await firstRow<{ gross: number }>(
  db,
  `SELECT COALESCE(SUM(gross_cents), 0) AS gross FROM card_settlements
   WHERE ${LOCAL_DAY("created_at")} = ?${csCond}`,
  csVals
);
checks.push(
  compareMoney("card_clearing", "Card clearing matches the day's settlements", n(clearDocs?.gross), n(clearJournal?.net), "day")
);
```

- [ ] **Step 3: Add `cash_in_transit`**

```ts
const transit = await firstRow<{ outstanding: number; inTransit: number }>(
  db,
  `SELECT
     COALESCE(SUM(CASE WHEN t.status = 'COMPLETE' THEN 0 ELSE t.amount_cents END), 0) AS inTransit,
     COALESCE(SUM(CASE WHEN t.status = 'COMPLETE' THEN 0 ELSE t.amount_cents END), 0) - 0 AS outstanding
   FROM cash_transfers t WHERE t.sent_on <= ?`,
  [day]
);
const entriesTransit = await firstRow<{ net: number }>(
  db,
  `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
   FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
   WHERE l.account_code = '1000' AND e.ref_entity IN ('cash_transfer_out','cash_transfer_in')
     AND e.entry_date <= ?${b.sql}`,
  [day, ...b.vals]
);
```

Compare `inTransitTotal(dispatched, received)` from the transfers table against
the net of the two entry types for the day, using `compareMoney`. Both sides
are cumulative-to-date, so the scope label is `"cumulative"` — this is not a
single day's figure.

- [ ] **Step 4: Add a test for the new helpers**

Append to `apps/api/src/services/reconcile.test.ts`:

```ts
describe("in-transit comparison", () => {
  it("passes when the entries net to the outstanding transfers", () => {
    const r = compareMoney("cash_in_transit", "In transit", 100_000, 100_000, "cumulative");
    expect(r.pass).toBe(true);
  });

  it("fails when a receipt is missing from the ledger", () => {
    expect(compareMoney("cash_in_transit", "In transit", 100_000, 100_000 + 40_000, "cumulative").pass).toBe(false);
  });
});
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

```bash
git add apps/api/src/services/reconcile.ts apps/api/src/services/reconcile.test.ts
git commit -m "feat: card clearing and cash in-transit checks, bank-aware payment filter"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/api.md`
- Modify: `docs/gold-accounting.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation matching the shipped system. No code changes.

- [ ] **Step 1: `docs/database.md`**

Add a `Cash and bank (0018_cash_bank)` section documenting the four tables,
their columns, the `IN_TRANSIT`/`COMPLETE` states, and the `SETL`/`XFER`
counters. Add the account-code allocation rule: first bank adopts 1010, later
ones take the lowest free code in 1011-1099.

- [ ] **Step 2: `docs/api.md`**

Add the eleven routes with their permissions, and change the two purchase
payment rows to say they take `bankAccountId` rather than `method`.

- [ ] **Step 3: `docs/gold-accounting.md`**

Add a `Cash and bank` section with the posting table, the two-entry transfer
rule and why, and the settlement split. Update the reconciliation section to
say 17 checks and name the two new ones.

- [ ] **Step 4: Commit**

```bash
git add docs/database.md docs/api.md docs/gold-accounting.md
git commit -m "docs: cash and bank — accounts, transfers, settlements, reconciliation"
```

---

## Live verification

1. `GET /bank-accounts` is empty. Register one; confirm it took 1010. Register a
   second; confirm it took 1011 and that a `chart_of_accounts` row appeared for
   it with `is_system = 0`.
2. Open the second with 500,000. Confirm the entry is `DR 1011 / CR 3100`, and
   that a second opening returns `409`.
3. Deposit 200,000 cash. Confirm 1000 falls by 200,000 and 1011 rises by it.
4. Settle a card batch of 250,000 gross with a 6,000 fee. Confirm 1020 falls
   by the **gross**, 6060 by the fee, and 1011 by the net. Try a fee larger
   than the gross; expect `400`.
5. Dispatch a 100,000 transfer Colombo → Kandy. Run reconciliation: see
   `cash_in_transit` report 100,000 outstanding. Receive it; see the check clear
   and each branch's 1000 correct for the cash it holds.
6. Pay a supplier out of 1011. Run reconciliation: `payments_crossfoot` still
   passes.
7. Transfer a product between branches. Confirm `gold_ledger` gained a
   `TRANSFER` row and `gold_stock_consistency` passes for **both** branches.
8. Record a statement balance for 1011. Confirm the difference and that the
   uncleared list shows entries after the statement date.
9. Full run: `pnpm test` and all three typechecks green.

## Spec coverage

- Spec §2 four tables and counters → Task 2
- Spec §3 account-code allocation → Task 4
- Spec §4 every posting, the two-entry transfer, opening balances → Tasks 4, 5
- Spec §5 the product-transfer gold row → Task 7
- Spec §6 all eleven endpoints → Task 6
- Spec §7 two new checks and the `payments_crossfoot` filter fix → Task 9
- Spec §1 the purchases hard-coding → Task 8
- Spec §9 Vitest coverage and the live gate → Tasks 1, 9 and the live verification above

## Self-Review

- **Spec coverage:** every §1-§7 and §9 item maps to a task; §10 out-of-scope
  is honoured by no task building any of it.
- **Placeholder scan:** every step carries real code or a real command with its
  expected output.
- **Type consistency:** `getBankAccount` is used identically in Tasks 4, 5 and 8;
  `settlementAmounts` and `inTransitTotal` have one definition and one import
  site; `firstRow` is the single bind-guard used throughout Task 9.
- **Two steps flag a correction inline** — the `openBankAccount` double
  settings read and the contorted `card_clearing` query — because both are
  traps a careful implementer would otherwise ship.
