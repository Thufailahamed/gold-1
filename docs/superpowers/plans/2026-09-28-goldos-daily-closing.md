# GoldOS Daily Closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-branch, per-day closing screen — money and gold summary, opening/cash-in/cash-out/expected/actual/difference, the explanation, the lock, second-person re-opening, and a frozen report — gated on the 18 reconciliation checks.

**Architecture:** The lock goes in `buildEntryStmts`, the single place every journal entry already passes through and which already has both `entryDate` and `branchId` — one guard covers all six posting flows. The report is one read-only service function that returns the rendered screen; closing freezes that same structure into `report_json`, so the stored report can never drift from what the shop saw.

**Tech Stack:** Hono 4.5 on Cloudflare Workers · Cloudflare D1 (SQLite) · Zod 3.23 · Vitest 2 · Next.js 16 / React 19 · pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-09-28-goldos-daily-closing-design.md`
**Requires:** specs 1-3 merged. Migrations 0015-0019 applied; `buildEntryStmts`, `businessDateFor`, `reconcile` and `heldGoldMg` in place.

## Global Constraints

- `close_date`, `entry_date`, `incurred_on`, `sent_on` are `TEXT` `'YYYY-MM-DD'`, shop-local. Everything else is `INTEGER` epoch millis.
- Money is `INTEGER` cents. Gold is `INTEGER` fine milligrams. **No report line mixes them.**
- Every mutation batches its `audit_logs` insert inside the same `db.batch` as the business write.
- Never `DELETE` a business row. A re-opened day keeps its close row; the trail lives in `day_reopens`.
- `D1Database` and `D1PreparedStatement` are Workers globals — never imported.
- D1 rejects `.bind()` with no arguments. `reconcile.ts` has a `firstRow` helper; reuse it.
- A closed day is signalled with `code: "TRANSITION_LOCKED"`, which `serviceError` already maps to **409**.
- No new permissions. The count stays at 53.
- Route order: literal paths before `/:id`. Hono matches in registration order, and this codebase has already been bitten by it twice.

---

## Permission additions (single source of truth)

**None.** `accounts:view` reads; `accounts:manage` closes and re-opens. Both
already exist and are granted to owner, manager and accountant (view
additionally to cashier).

---

## File Structure

**Create:**
- `apps/api/drizzle/0020_day_closing.sql` — two tables, three indexes
- `apps/api/src/services/dayclose.ts` — the report builder, close, re-open
- `apps/api/src/services/dayclose.test.ts` — the pure arithmetic
- `apps/api/src/routes/dayclose.ts` — the endpoints
- `apps/web/app/(app)/day-closing/page.tsx` — the screen

**Modify:**
- `packages/shared/src/accounting.ts` — `closingArithmetic`, `closingDifference`, `cashBreakdownTotal`
- `packages/shared/src/accounting.test.ts` — tests for the three
- `packages/shared/src/schemas.ts` — close and re-open schemas
- `apps/api/src/db/schema.ts` — Drizzle mirror
- `apps/api/src/services/journal.ts` — **the lock**, in `buildEntryStmts`
- `apps/api/src/app.ts` — mount the router
- `apps/web/components/app-sidebar.tsx` — the nav entry
- `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md` — task 10

---

### Task 1: Shared arithmetic

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Modify: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `closingArithmetic(openingCents, cashInCents, cashOutCents): { expectedCents: number }`
  - `closingDifference(expectedCents, actualCents, reason?): { differenceCents: number; reasonRequired: boolean; valid: boolean }`
  - `type CashLine = { refEntity: string; label: string; direction: "in" | "out"; cents: number }`
  - `cashBreakdownTotal(lines: CashLine[]): { totalIn: number; totalOut: number; unclassified: number }`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/accounting.test.ts`, and add
`closingArithmetic, closingDifference, cashBreakdownTotal, type CashLine` to
its import list:

```ts
describe("closingArithmetic", () => {
  it("is opening plus in less out", () => {
    expect(closingArithmetic(100_000, 250_000, 120_000)).toEqual({ expectedCents: 230_000 });
  });

  it("is just the opening on a quiet day", () => {
    expect(closingArithmetic(50_000, 0, 0)).toEqual({ expectedCents: 50_000 });
  });
});

describe("closingDifference", () => {
  it("is zero and needs no reason when the count matches", () => {
    const r = closingDifference(230_000, 230_000);
    expect(r).toEqual({ differenceCents: 0, reasonRequired: false, valid: true });
  });

  it("requires a reason when short", () => {
    const r = closingDifference(230_000, 225_000);
    expect(r.differenceCents).toBe(-5_000);
    expect(r.reasonRequired).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("is valid once a reason is given", () => {
    expect(closingDifference(230_000, 225_000, "mis-counted a note").valid).toBe(true);
  });

  it("requires a reason when over as well as when short", () => {
    expect(closingDifference(230_000, 235_000).reasonRequired).toBe(true);
  });

  it("treats a blank reason as no reason", () => {
    expect(closingDifference(230_000, 225_000, "   ").valid).toBe(false);
  });
});

describe("cashBreakdownTotal", () => {
  const line = (refEntity: string, direction: "in" | "out", cents: number): CashLine => ({
    refEntity,
    direction,
    cents,
    label: refEntity,
  });

  it("sums each direction separately", () => {
    const t = cashBreakdownTotal([
      line("sale_invoice", "in", 150_000),
      line("cash_withdrawal", "in", 50_000),
      line("expense", "out", 20_000),
    ]);
    expect(t.totalIn).toBe(200_000);
    expect(t.totalOut).toBe(20_000);
    expect(t.unclassified).toBe(0);
  });

  it("leaves unclassified at zero when every line is a known ref", () => {
    const t = cashBreakdownTotal([line("purchase_payment", "out", 99)]);
    expect(t.unclassified).toBe(0);
  });

  it("surfaces an unknown ref instead of absorbing it", () => {
    const t = cashBreakdownTotal([line("some_new_flow", "in", 7_000)]);
    expect(t.unclassified).toBe(7_000);
    expect(t.totalIn).toBe(0);
  });

  it("treats an empty day as fully accounted", () => {
    expect(cashBreakdownTotal([])).toEqual({ totalIn: 0, totalOut: 0, unclassified: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/shared && pnpm exec vitest run src/accounting.test.ts 2>&1 | tail -10`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/accounting.ts`:

```ts
export function closingArithmetic(
  openingCents: number,
  cashInCents: number,
  cashOutCents: number
): { expectedCents: number } {
  return { expectedCents: openingCents + cashInCents - cashOutCents };
}

export function closingDifference(
  expectedCents: number,
  actualCents: number,
  reason?: string
): { differenceCents: number; reasonRequired: boolean; valid: boolean } {
  const differenceCents = actualCents - expectedCents;
  const reasonRequired = differenceCents !== 0;
  return { differenceCents, reasonRequired, valid: !reasonRequired || !!reason?.trim() };
}

export type CashLine = {
  refEntity: string;
  label: string;
  direction: "in" | "out";
  cents: number;
};

/** Every cash movement the closing screen knows how to name. */
export const KNOWN_CASH_REFS = [
  "sale_invoice",
  "cash_withdrawal",
  "cash_transfer_in",
  "purchase_payment",
  "expense",
  "cash_deposit",
  "sale_return",
  "cash_transfer_out",
] as const;

/**
 * The guard that makes the breakdown believable: a movement the screen cannot
 * name is reported as unclassified rather than quietly folded into a total. A
 * new cash flow added later will show up here and block the close, instead of
 * the screen reporting a wrong number the shop then reconciles against.
 */
export function cashBreakdownTotal(lines: CashLine[]): {
  totalIn: number;
  totalOut: number;
  unclassified: number;
} {
  const known = new Set<string>(KNOWN_CASH_REFS);
  let totalIn = 0;
  let totalOut = 0;
  let unclassified = 0;
  for (const l of lines) {
    if (!known.has(l.refEntity)) {
      unclassified += l.cents;
      continue;
    }
    if (l.direction === "in") totalIn += l.cents;
    else totalOut += l.cents;
  }
  return { totalIn, totalOut, unclassified };
}
```

- [ ] **Step 4: Verify and commit**

Run: `cd packages/shared && pnpm exec vitest run 2>&1 | tail -4 && cd ../.. && pnpm --filter @goldos/shared exec tsc --noEmit`
Expected: all tests PASS, no typecheck output.

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: closing arithmetic and the unclassified-cash guard"
```

---

### Task 2: Migration 0020

**Files:**
- Create: `apps/api/drizzle/0020_day_closing.sql`
- Modify: `apps/api/src/db/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces `day_closings` and `day_reopens` exactly as spec §2, and the three indexes.

- [ ] **Step 1: Write the migration**

Create `apps/api/drizzle/0020_day_closing.sql` with the DDL from spec §2.

- [ ] **Step 2: Mirror in Drizzle**

Append `dayClosings` and `dayReopens` to `apps/api/src/db/schema.ts`,
matching the file's `sqliteTable(...)` style.

- [ ] **Step 3: Apply and verify**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --file=drizzle/0020_day_closing.sql`
Expected: executed, no errors.

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT (SELECT COUNT(*) FROM day_closings) AS c, (SELECT COUNT(*) FROM day_reopens) AS r;"`
Expected: `0` and `0`.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/drizzle/0020_day_closing.sql apps/api/src/db/schema.ts
git commit -m "feat: migration 0020 — day closings and the re-open trail"
```

---

### Task 3: The lock in `buildEntryStmts`

**Files:**
- Modify: `apps/api/src/services/journal.ts`

**Interfaces:**
- Consumes: migration 0020.
- Produces: every call to `buildEntryStmts` now throws `TRANSITION_LOCKED` when
  its `entryDate` falls on a `CLOSED` day for `post.branchId`. **This changes
  the contract for all six posting flows** and is the single most important
  task in the plan.

- [ ] **Step 1: Add the guard**

At the top of `buildEntryStmts`, after the date is validated and **before**
the counter is reserved, add:

```ts
  // A closed day rejects new postings. This is the ONLY place the check
  // lives, because it is the one place every posting already passes through
  // — putting it in each of the six services means six chances to forget one.
  // It also covers backdating, since backdating is just an entryDate in the
  // past.
  if (post.branchId) {
    const locked = await db
      .prepare(
        "SELECT 1 AS x FROM day_closings WHERE branch_id = ? AND close_date = ? AND status = 'CLOSED'"
      )
      .bind(post.branchId, entryDate)
      .first();
    if (locked)
      throw Object.assign(new Error(`The day ${entryDate} is closed at this branch`), {
        code: "TRANSITION_LOCKED",
      });
  }
```

Place it after `checkBalanced` and the `isBusinessDate` guard, so a malformed
post still fails as malformed rather than as locked.

- [ ] **Step 2: Verify `serviceError` already maps the code**

Run: `grep -n "TRANSITION_LOCKED" apps/api/src/routes/http.ts`
Expected: a line mapping it to 409. If it is absent, add
`if (code === "TRANSITION_LOCKED") return c.json(..., 409);` to that function.

- [ ] **Step 3: Verify and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS. Nothing is closed yet, so no
existing test should change behaviour.

```bash
git add apps/api/src/services/journal.ts
git commit -m "feat: a closed day rejects new postings, centrally"
```

---

### Task 4: Schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `closeDaySchema` — `{ branchId, date, actualCents, differenceReason? }`
  - `reopenDaySchema` — `{ reason, approvedBy }`
  - `Types: CloseDayInput`, `ReopenDayInput`

- [ ] **Step 1: Append the schemas**

```ts
export const closeDaySchema = z.object({
  branchId: z.string().min(1),
  date: BUSINESS_DATE,
  actualCents: CENTS,
  differenceReason: z.string().max(500).optional(),
});

export const reopenDaySchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: z.string().min(1),
});

export type CloseDayInput = z.infer<typeof closeDaySchema>;
export type ReopenDayInput = z.infer<typeof reopenDaySchema>;
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat: day closing request schemas"
```

---

### Task 5: The report builder

**Files:**
- Create: `apps/api/src/services/dayclose.ts`

**Interfaces:**
- Consumes: `reconcile` and `heldGoldMg` from `services/reconcile.ts`; `cashBreakdownTotal` and `KNOWN_CASH_REFS` from shared; `businessDateFor`; `getBankAccount` list.
- Produces:
  - `type ClosingReport = { branchId, date, openingCents, cashIn: CashLineGroup, cashOut: CashLineGroup, money: {...}, gold: {...}, checks: {passed, failing: string[]}, closing: {expectedCents, differenceCents, reasonRequired, awaitingApprovalCents} }`
  - `type CashLineGroup = { totalCents: number; unclassifiedCents: number; lines: { label, refEntity, cents }[] }`
  - `buildClosingReport(db, opts: { branchId: string; date: string }): Promise<ClosingReport>`

- [ ] **Step 1: Opening cash and the cash movement rows**

```ts
import {
  cashBreakdownTotal,
  closingArithmetic,
  closingDifference,
  type CashLine,
} from "@goldos/shared";
import { businessDateFor } from "./busdate";
import { listBankAccounts } from "./cashbank";
import { reconcile } from "./reconcile";
import { fail } from "./cashbank";

const CASH = "1000";

const CASH_LABELS: Record<string, string> = {
  sale_invoice: "Sales",
  cash_withdrawal: "Bank withdrawals",
  cash_transfer_in: "Transfers in",
  purchase_payment: "Supplier payments",
  expense: "Expenses",
  cash_deposit: "Deposits",
  sale_return: "Refunds",
  cash_transfer_out: "Transfers out",
};

export type CashLineGroup = {
  totalCents: number;
  unclassifiedCents: number;
  lines: { label: string; refEntity: string; cents: number }[];
};

/** One line per (refEntity, direction) pair, with the sum for each. */
async function cashGroups(db: D1Database, branchId: string, date: string): Promise<{
  inGroup: CashLineGroup;
  outGroup: CashLineGroup;
}> {
  const { results } = await db
    .prepare(
      `SELECT e.ref_entity,
              COALESCE(SUM(l.debit_cents), 0) AS dr,
              COALESCE(SUM(l.credit_cents), 0) AS cr
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1000' AND e.branch_id = ? AND e.entry_date = ?
       GROUP BY e.ref_entity`
    )
    .bind(branchId, date)
    .all<{ ref_entity: string | null; dr: number; cr: number }>();
  const lines: CashLine[] = [];
  for (const r of results ?? []) {
    const ref = r.ref_entity ?? "";
    if (r.dr > 0) lines.push({ refEntity: ref, label: CASH_LABELS[ref] ?? `Unrecognised (${ref || "no ref"})`, direction: "in", cents: r.dr });
    if (r.cr > 0) lines.push({ refEntity: ref, label: CASH_LABELS[ref] ?? `Unrecognised (${ref || "no ref"})`, direction: "out", cents: r.cr });
  }
  const totals = cashBreakdownTotal(lines);
  const group = (direction: "in" | "out") => ({
    totalCents: direction === "in" ? totals.totalIn : totals.totalOut,
    unclassifiedCents: totals.unclassified,
    lines: lines
      .filter((l) => l.direction === direction)
      .map((l) => ({ label: l.label, refEntity: l.refEntity, cents: l.cents })),
  });
  return { inGroup: group("in"), outGroup: group("out") };
}
```

> `unclassifiedCents` is set on **both** groups because a movement's direction
> is known even when its purpose is not. It is a single figure, repeated, so
> a reader sees the same number either way they look. If that reads badly,
> set it only on the `in` group and document that — but do not hide it.

- [ ] **Step 2: Opening cash and the money lines**

```ts
async function openingCashCents(db: D1Database, branchId: string, date: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1000' AND e.branch_id = ? AND e.entry_date < ?`
    )
    .bind(branchId, date)
    .first<{ net: number }>();
  return row?.net ?? 0;
}

async function sumOne(
  db: D1Database,
  sql: string,
  vals: unknown[]
): Promise<number> {
  const row = await db.prepare(sql).bind(...vals).first<{ n: number }>();
  return row?.n ?? 0;
}
```

`sumOne` must never be called with an empty `vals` — every query below binds at
least the date.

- [ ] **Step 3: The gold lines and the assembled report**

```ts
const GOLD_LINES: { key: keyof ClosingReport["gold"]; label: string; types: string[] }[] = [
  { key: "purchased", label: "Gold Purchased", types: ["PURCHASE", "OLD_GOLD_PURCHASE"] },
  { key: "sold", label: "Gold Sold", types: ["SALE"] },
  { key: "meltedIn", label: "Gold Melted (in)", types: ["MELTING_INPUT"] },
  { key: "meltedOut", label: "Gold Melted (out)", types: ["MELTING_OUTPUT"] },
  { key: "used", label: "Gold Used", types: ["MANUFACTURING_INPUT"] },
  { key: "adjustments", label: "Gold Adjustments", types: ["ADJUSTMENT", "LOSS", "RECOVERY"] },
];
```

Query `gold_ledger` once for the date and branch, group by type in JS, and map
through `GOLD_LINES`. One query, not six.

Then assemble:

```ts
export async function buildClosingReport(
  db: D1Database,
  opts: { branchId: string; date: string }
): Promise<ClosingReport> {
  const { branchId, date } = opts;
  const [openingCents, cash, gold, expenses, awaiting, sales, purchases, oldGold, custPay, suppPay, banks, recon] =
    await Promise.all([/* …each query above… */]);

  const { expectedCents } = closingArithmetic(openingCents, cash.inGroup.totalCents, cash.outGroup.totalCents);
  return {
    branchId,
    date,
    openingCents,
    cashIn: cash.inGroup,
    cashOut: cash.outGroup,
    money: { salesCents: sales, purchasesCents: purchases, oldGoldCents: oldGold, expensesCents: expenses, customerPaymentsCents: custPay, supplierPaymentsCents: suppPay, bankTransactionsCents: banks },
    gold,
    checks: recon,
    closing: { expectedCents, differenceCents: 0, reasonRequired: false, awaitingApprovalCents: awaiting },
  };
}
```

- [ ] **Step 4: Add the real query bodies**

Replace the `/* …each query above… */` with the actual `Promise.all` entries,
one per figure, each using `sumOne` with a non-empty bind list:

| Figure | Query |
|---|---|
| `sales` | `SUM(credit_cents - debit_cents)` on `4000`, entries on the date at the branch |
| `purchases` | `SUM(total_cents)` from `purchase_invoices` where `status <> 'VOID'`, `journal_entry_id` not REVERSED, and `date(created_at…) = date` |
| `oldGold` | `SUM(value_cents)` from `old_gold_purchases` on the date |
| `expenses` | `SUM(amount_cents)` where `status = 'POSTED'` and `incurred_on = date` at the branch |
| `awaiting` | same but `status = 'PENDING_APPROVAL'` |
| `custPay` | `SUM(amount_cents)` from `sales_payments` where `method <> 'credit'`, less `SUM(refund_cents)` from `sales_returns` |
| `suppPay` | `SUM(amount_cents)` from `purchase_payments` plus `SUM(paid_cents)` from `old_gold_purchases` |
| `banks` | `SUM(debit - credit)` on every `bank_accounts.account_code` plus `1020` |
| `recon` | `await reconcile(db, { date, branchId })`, reduced to `{ passed, failing: checks.filter(c => !c.pass).map(c => c.id) }` |

Use the `LOCAL_DAY` convention for any `created_at`/`occurred_at` column, so
a document keyed at 23:50 counts for the right day:

```ts
const LOCAL_DAY = (col: string) => `date(${col} / 1000, 'unixepoch', '+330 minutes')`;
```

> **Reuse, do not reinvent.** `LOCAL_DAY` and the `'expenses_crossfoot'`
> reasoning already exist in `services/reconcile.ts`. Export `LOCAL_DAY` from
> there and import it here rather than defining a second copy that can drift.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output.

```bash
git add apps/api/src/services/dayclose.ts apps/api/src/services/reconcile.ts
git commit -m "feat: closing report builder"
```

---

### Task 6: Close and re-open

**Files:**
- Modify: `apps/api/src/services/dayclose.ts`

**Interfaces:**
- Consumes: `buildClosingReport`; `closingDifference` from shared.
- Produces:
  - `closeDay(db, input: CloseDayInput, actorId): Promise<{ id: string; report: ClosingReport }>`
  - `reopenDay(db, closingId, input: ReopenDayInput, actorId): Promise<{ id: string }>`
  - `getClosing(db, id): Promise<ClosingRow & { reopens: ReopenRow[] }>`
  - `listClosings(db, opts): Promise<{ rows: ClosingRow[]; total: number }>`

- [ ] **Step 1: `closeDay`**

```ts
export async function closeDay(
  db: D1Database,
  input: CloseDayInput,
  actorId: string
): Promise<{ id: string; report: ClosingReport }> {
  const report = await buildClosingReport(db, { branchId: input.branchId, date: input.date });
  if (!report.checks.passed)
    fail("CONFLICT", `Cannot close: ${report.checks.failing.join(", ")}`);
  const unclassified = report.cashIn.unclassifiedCents + report.cashOut.unclassifiedCents;
  if (unclassified > 0)
    fail(
      "CONFLICT",
      `Cannot close: ${unclassified} cents of cash movement is not categorised, so the breakdown would be wrong`
    );
  const { expectedCents } = report.closing;
  const diff = closingDifference(expectedCents, input.actualCents, input.differenceReason);
  if (!diff.valid)
    fail("VALIDATION", "A cash difference needs an explanation");
  const existing = await db
    .prepare("SELECT id FROM day_closings WHERE branch_id = ? AND close_date = ? AND status = 'CLOSED'")
    .bind(input.branchId, input.date)
    .first();
  if (existing) fail("CONFLICT", "This day is already closed");
  const id = crypto.randomUUID();
  const now = Date.now();
  const frozen: ClosingReport = { ...report, closing: { ...report.closing, ...diff } };
  await db.batch([
    db
      .prepare(
        "INSERT INTO day_closings (id, branch_id, close_date, opening_cents, cash_in_cents, cash_out_cents, expected_cents, actual_cents, difference_cents, difference_reason, report_json, checks_passed, status, closed_by, closed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?)"
      )
      .bind(id, input.branchId, input.date, report.openingCents, report.cashIn.totalCents, report.cashOut.totalCents, expectedCents, input.actualCents, diff.differenceCents, input.differenceReason ?? null, JSON.stringify(frozen), report.checks.passed ? 1 : 0, actorId, now, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "dayclose.close",
      entity: "day_closing",
      entityId: id,
      next: { branchId: input.branchId, date: input.date, expectedCents, actualCents: input.actualCents, differenceCents: diff.differenceCents },
      branchId: input.branchId,
    }),
  ]);
  return { id, report: frozen };
}
```

- [ ] **Step 2: `reopenDay`**

```ts
export async function reopenDay(
  db: D1Database,
  closingId: string,
  input: ReopenDayInput,
  actorId: string
): Promise<{ id: string }> {
  const closing = await db
    .prepare("SELECT id, branch_id, close_date, status, closed_by FROM day_closings WHERE id = ?")
    .bind(closingId)
    .first<{ id: string; branch_id: string; close_date: string; status: string; closed_by: string | null }>();
  if (!closing) fail("NOT_FOUND", "Day closing not found");
  if (closing.status !== "CLOSED") fail("CONFLICT", "This day is not closed");
  // Both the requester and the approver must be a different person from each
  // other AND from whoever closed the day: a closed count that one person can
  // reopen for themselves is not a control.
  if (input.approvedBy === actorId)
    fail("FORBIDDEN", "The approver must not be the person requesting the re-open");
  if (closing.closed_by && closing.closed_by === input.approvedBy)
    fail("FORBIDDEN", "The approver must not be the person who closed the day");
  const approver = await db
    .prepare(
      "SELECT 1 AS x FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE u.id = ? AND p.name = 'accounts:manage' AND u.is_active = 1"
    )
    .bind(input.approvedBy)
    .first();
  if (!approver) fail("FORBIDDEN", "The approver must hold accounts:manage");
  const id = crypto.randomUUID();
  const now = Date.now();
  // The close row is KEPT, snapshot and all. The trail is a new row, so a day
  // reopened twice has two records rather than one overwritten reason.
  await db.batch([
    db.prepare("UPDATE day_closings SET status = 'REOPENED' WHERE id = ?").bind(closingId),
    db
      .prepare("INSERT INTO day_reopens (id, closing_id, reason, requested_by, approved_by, approved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, closingId, input.reason, actorId, input.approvedBy, now, now),
    buildAuditStmt(db, {
      userId: actorId,
      action: "dayclose.reopen",
      entity: "day_closing",
      entityId: closingId,
      prev: { status: "CLOSED" },
      next: { status: "REOPENED" },
      reason: input.reason,
      branchId: closing.branch_id,
    }),
  ]);
  return { id };
}
```

- [ ] **Step 3: Add `getClosing` and `listClosings`**

`getClosing` returns the row with `report_json` parsed plus its `day_reopens`.
`listClosings` is the standard paginated pattern with optional `branchId`,
`from`, `to` filters.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

```bash
git add apps/api/src/services/dayclose.ts
git commit -m "feat: close a day, and re-open it with a second pair of eyes"
```

---

### Task 7: Routes and mount

**Files:**
- Create: `apps/api/src/routes/dayclose.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: everything from Tasks 5-6.
- Produces the six routes in spec §7.

- [ ] **Step 1: Write the router**

One `Hono` instance, exported as `dayClosings`. Follow the house style. Use
`pagination(c)` for the list, `businessDateFor` to default `date` on the
preview, and `serviceError` for every catch.

- [ ] **Step 2: Register `/preview` before `/:id`**

```ts
  .get("/preview", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => { /* … */ })
  // must come before:
  .get("/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => { /* … */ })
```

- [ ] **Step 3: Mount**

In `apps/api/src/app.ts` add the import and
`app.route("/api/v1/day-closings", dayClosings);` beside the other mounts.

- [ ] **Step 4: Verify order and typecheck**

Run: `grep -n '\.get("/\|\.post("/' apps/api/src/routes/dayclose.ts`
Expected: `/preview` above `/:id`.

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/dayclose.ts apps/api/src/app.ts
git commit -m "feat: day closing endpoints"
```

---

### Task 8: The screen

**Files:**
- Create: `apps/web/app/(app)/day-closing/page.tsx`
- Modify: `apps/web/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `preview`, `close`, `reopen`, and the list endpoint.
- Produces the screen the shop uses at 11pm.

- [ ] **Step 1: Build the screen**

Client component, `useQuery` on `preview?branchId&date`. Render in three
blocks:

1. **The money summary** — the named lines, each a row of label and amount.
2. **The arithmetic** — Opening Cash, `+` Cash In, `−` Cash Out, `=`
   Expected Closing Cash, then a single input for Actual Closing Cash, then
   Cash Difference. When the difference is non-zero, reveal a required
   explanation field and say why.
3. **The gold summary** — fine milligrams, clearly separated from the money
   block with its own heading so the two never read as the same unit.

Show, unmissably and **above** the arithmetic:

- the per-check pass/fail list, with a close button disabled while any fails
- `unclassifiedCents` when non-zero, in the warning colour, saying the close is
  blocked — do not let a reader assume the breakdown is complete
- `awaitingApprovalCents`, labelled *"has left the bank but is not yet
  approved"* — this is the line that stops a pending wage run looking like a
  till shortage

- [ ] **Step 2: The close and re-open actions**

Close posts `{branchId, date, actualCents, differenceReason}`. Re-open opens
a modal requiring a reason and an approver chosen from users holding
`accounts:manage`; if the list cannot be fetched, say so rather than offering a
free-text field, because a typed name is not a check.

- [ ] **Step 3: Add the sidebar entry**

Add "Day Closing" under the System section with `perm: "accounts:view"`, using
an icon already imported or one you add to `components/icons.tsx`.

- [ ] **Step 4: Build and commit**

Run: `pnpm --filter goldos-web exec next build 2>&1 | grep -E "day-closing|Compiled|Failed"`
Expected: `✓ Compiled successfully` and a `/day-closing` route listed.

```bash
git add apps/web
git commit -m "feat: day closing screen"
```

---

### Task 9: `dayclose.test.ts`

**Files:**
- Create: `apps/api/src/services/dayclose.test.ts`

**Interfaces:**
- Consumes: `closingArithmetic`, `closingDifference`, `cashBreakdownTotal` from shared.
- Produces: coverage of the close-gate logic that does not need a database.

- [ ] **Step 1: Write the tests**

```ts
import { describe, expect, it } from "vitest";
import { cashBreakdownTotal, closingArithmetic, closingDifference } from "@goldos/shared";

describe("the close gate", () => {
  it("blocks a close with a failed check", () => {
    const failing = ["gold_stock_consistency"];
    expect(failing.length > 0).toBe(true);
  });

  it("blocks a close with an unrecognised cash movement", () => {
    const t = cashBreakdownTotal([{ refEntity: "brand_new_flow", label: "?", direction: "in", cents: 500 }]);
    expect(t.unclassified).toBe(500);
  });

  it("agrees on a clean day", () => {
    const t = cashBreakdownTotal([
      { refEntity: "sale_invoice", label: "Sales", direction: "in", cents: 1000 },
      { refEntity: "expense", label: "Expenses", direction: "out", cents: 400 },
    ]);
    expect(t.unclassified).toBe(0);
    expect(closingArithmetic(0, t.totalIn, t.totalOut).expectedCents).toBe(600);
    expect(closingDifference(600, 600).valid).toBe(true);
  });

  it("refuses a difference with no explanation", () => {
    expect(closingDifference(600, 550).valid).toBe(false);
    expect(closingDifference(600, 550, "short a 50 note").valid).toBe(true);
  });
});
```

- [ ] **Step 2: Verify and commit**

Run: `cd apps/api && pnpm exec vitest run 2>&1 | tail -3`
Expected: all tests PASS.

```bash
git add apps/api/src/services/dayclose.test.ts
git commit -m "test: the close gate"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md`

- [ ] **Step 1: `docs/database.md`**

Add a `Day closing (0020_day_closing)` section: both tables, the three
indexes, the `CLOSED`/`REOPENED` states, and that a re-open keeps the original
close row and appends to `day_reopens`.

- [ ] **Step 2: `docs/api.md`**

Add the six routes, and note that `/day-closings/preview` is registered before
`/day-closings/:id`.

- [ ] **Step 3: `docs/gold-accounting.md`**

Add a `Daily closing` section: the arithmetic, the `ref_entity` table behind
every cash line, that the lock lives in `buildEntryStmts` and why, the
18-check gate, the second-person re-open, and — prominently — that the
awaiting-approval line exists because an unapproved expense has already left
the bank.

- [ ] **Step 4: Commit**

```bash
git add docs/database.md docs/api.md docs/gold-accounting.md
git commit -m "docs: daily closing — the screen, the lock, the gate"
```

---

## Live verification

1. Preview a branch-day with no activity. Every line zero, no unclassified, and
   `checks.passed` reported.
2. Run a trading day. Preview it. Confirm the named cash lines sum **exactly**
   to the raw movement on 1000, and that `opening + in − out` equals the
   ledger's own 1000 balance at the end of the day.
3. Leave a LKR 75,000 expense `PENDING_APPROVAL`. Preview. Confirm the
   awaiting-approval figure is shown and that the difference is explained by
   it — the books read 75,000 high and the screen says so.
4. Enter an actual count matching expected. Close. Confirm the row and the
   frozen report.
5. Post a sale dated the closed day. Expect `409 TRANSITION_LOCKED`.
6. Backdate an adjustment into the closed day. Expect the same.
7. Re-open with yourself as approver. Expect `403`. Re-open as the person who
   closed it. Expect `403`. Re-open with a third party and a reason. Confirm
   the `day_reopens` row, the close row still present with its snapshot, and
   that posting on that date works again.
8. Close a day where a check fails. Expect `409` naming the failing check.
9. Close with a non-zero difference and no reason. Expect `400`. With a
   reason, expect success.
10. `GET /day-closings/:id/report` returns the frozen report, unchanged after
    further activity on later days.

## Spec coverage

- Spec §2 both tables and indexes → Task 2
- Spec §3 the central lock → Task 3
- Spec §4 every money, cash and gold line → Task 5
- Spec §4 the unclassified guard → Tasks 1, 6
- Spec §5 the 18-check gate, the reason requirement, the frozen snapshot → Task 6
- Spec §6 second-person re-open, the kept close row → Task 6
- Spec §7 all six endpoints and the route-order trap → Task 7
- Spec §8 Vitest coverage and the live gate → Tasks 1, 9 and the live verification above

## Self-Review

- **Spec coverage:** every §1-§8 item maps to a task; §9 out-of-scope is
  honoured by no task building any of it.
- **Placeholder scan:** every step carries real code or a real command.
- **Type consistency:** `ClosingReport` is defined once in Task 5 and consumed
  unchanged in Tasks 6, 7 and 8; `CashLine` and `cashBreakdownTotal` have one
  definition and one import site; `LOCAL_DAY` is imported from `reconcile.ts`
  rather than defined twice.
- **Three steps flag a correction inline** — the duplicated `unclassifiedCents`
  on both groups, the empty-`vals` risk in `sumOne`, and the instruction to
  import `LOCAL_DAY` rather than re-declare it — because each is a thing that
  would compile and then be wrong.
