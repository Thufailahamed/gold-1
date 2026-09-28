# GoldOS Ledger Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `journal_entries` table with a real header + lines ledger carrying a shop-local transaction date, migrate all six posting call sites onto it, make the chart of accounts configurable, and expose the journal, trial-balance, and account-statement endpoints.

**Architecture:** `buildEntryStmts` replaces `postJournalStmts`: it emits one `journal_entries` header plus N `journal_lines` rows, still *returning* statements so the caller `db.batch`es them and the posting stays atomic with its source document. The existing flat table is renamed to `journal_lines` in place and backfilled into headers. All pure arithmetic lives in `packages/shared/src/accounting.ts` so it is testable without a D1 binding. Nothing in `apps/web` gains a page.

**Tech Stack:** Hono 4.5 on Cloudflare Workers · Cloudflare D1 (SQLite) via raw `.prepare().bind()` · Zod 3.23 in `@goldos/shared` · Vitest 2 · Next.js 16 / React 19 (one form field removed) · pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-09-28-goldos-ledger-core-design.md`
**Follow-on:** `docs/superpowers/plans/2026-09-28-goldos-ledger-postings-reconciliation.md` — melting, manufacturing, gold adjustments, reconciliation, docs. Requires this plan merged first.

## Global Constraints

- Every `id` is `crypto.randomUUID()`, except seeded masters which use stable slugs.
- All timestamps are `INTEGER` epoch millis. `entry_date` is the one exception: `TEXT` `'YYYY-MM-DD'`, shop-local, per spec §2.2.
- Money is `INTEGER` cents. Weight is `INTEGER` mg. Purity is `INTEGER` permille.
- Never `DELETE` a business row. Corrections are reversing entries. Master data deactivates via `is_active`.
- Every mutation batches its `audit_logs` insert via `buildAuditStmt` **inside the same `db.batch`** as the business write, so an audit failure rolls the write back.
- Services throw `Object.assign(new Error("message"), { code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "TRANSITION_LOCKED" | "INTERNAL" })`. Routes return them through `serviceError`.
- Service signatures are `(db: D1Database, input, actorId: string)`. `D1Database` and `D1PreparedStatement` are Workers globals — **never imported**.
- Raw SQL only. `apps/api/src/db/schema.ts` is a Drizzle *mirror* that is never queried at runtime; it must match the migration but does not drive behaviour.
- Migrations are hand-written SQL in `apps/api/drizzle/NNNN_name.sql`, applied in sorted order. Existing files run 0001-0014, so this plan adds 0015, 0016, 0017.
- `strict` + `noUncheckedIndexedAccess` are on. Array indexing yields `T | undefined`; use `!` only where the preceding code proves the invariant.
- Module import order in the API: `hono` → `zod` → `@goldos/shared` → local `type { Env }` → `../middleware/*` → `../services/*` → `./http`.

---

## Permission additions (single source of truth)

**None.** `PERMISSIONS.ACCOUNTS_VIEW` (`accounts:view`) and
`PERMISSIONS.ACCOUNTS_MANAGE` (`accounts:manage`) already exist in
`packages/shared/src/permissions.ts`, are mirrored in `apps/api/src/seed.ts`
as `SEED_PERMISSIONS`, and were granted by `0008_ledger.sql`. The count stays
at 53. Every new endpoint in this plan is gated by one of the two.

---

## File Structure

**Create:**
- `packages/shared/src/accounting.ts` — all pure ledger arithmetic
- `packages/shared/src/accounting.test.ts` — its unit tests
- `apps/api/drizzle/0015_ledger_core.sql` — rename, header table, indexes, chart, counters, document links
- `apps/api/drizzle/0016_ledger_backfill.sql` — data migration into the new shape
- `apps/api/drizzle/0017_drop_opening_balance.sql` — retire the magic columns
- `apps/api/src/services/busdate.ts` — reads the tz setting, wraps `businessDate`
- `apps/api/src/services/journal.test.ts` — reversal arithmetic

**Modify:**
- `packages/shared/src/index.ts` — export `./accounting`
- `packages/shared/src/schemas.ts` — account schemas; remove `openingBalance`
- `packages/shared/src/ledgers.test.ts` — the opening-balance assertion
- `apps/api/src/db/schema.ts` — Drizzle mirror
- `apps/api/src/services/journal.ts` — `buildEntryStmts`, `reverseEntry`, readers, chart CRUD
- `apps/api/src/services/purchases.ts` — `allocateCharges` re-export, postings, `voidInvoice` reversal
- `apps/api/src/services/sales.ts` — card → 1020, sale/return postings
- `apps/api/src/services/oldgold.ts` — purchase posting + entry link
- `apps/api/src/services/parties.ts` — drop `opening_balance_cents`
- `apps/api/src/routes/accounts.ts` — chart CRUD, adjustment, reversal, journal, reports
- `apps/api/src/routes/parties.ts` — ledger route returns the new shape
- `apps/web/app/(app)/customers/page.tsx`, `suppliers/page.tsx` — remove the opening-balance field

---

### Task 1: Shared accounting math

**Files:**
- Create: `packages/shared/src/accounting.ts`
- Create: `packages/shared/src/accounting.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/services/purchases.ts:1-13`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `@goldos/shared`:
  - `type PartyLedgerKind = "customer" | "supplier"`
  - `type PartyLedgerLine = { entryId, entryNo, entryDate, refEntity, refId, refNo, memo, debitCents, creditCents }` — all strings except `debitCents`/`creditCents` numbers and `refNo`/`memo` nullable strings
  - `type PartyLedgerTotals = { opening, debitSales, creditPayments, creditReturns, creditPurchases, debitPayments, debitReturns, closing }` — all numbers
  - `businessDate(epochMs: number, tzOffsetMinutes: number): string`
  - `addDays(date: string, days: number): string`
  - `isBusinessDate(value: string): boolean`
  - `allocateProportional(total: number, weights: number[]): number[]`
  - `checkBalanced(lines: { debitCents: number; creditCents: number }[]): void`
  - `computePartyLedger(kind: PartyLedgerKind, lines: PartyLedgerLine[]): PartyLedgerTotals`
  - `closingCash(openingCents: number, cashInCents: number, cashOutCents: number): number`
  - `cashDifference(expectedCents: number, actualCents: number): number`
  - `meltingLossValue(inputCostCents: number, outputFineMg: number, lossMg: number): number`
  - `allocateGoldValue(vIn: number, fineIn: number, outputsFineMg: number[]): number[]`
  - `goldValueCents(fineMg: number, rateCentsPerG: number): number`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/accounting.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  allocateGoldValue,
  allocateProportional,
  businessDate,
  cashDifference,
  checkBalanced,
  closingCash,
  computePartyLedger,
  goldValueCents,
  isBusinessDate,
  meltingLossValue,
  type PartyLedgerLine,
} from "./accounting";

function line(p: Partial<PartyLedgerLine>): PartyLedgerLine {
  return {
    entryId: "e1",
    entryNo: "JE-000001",
    entryDate: "2026-09-28",
    refEntity: "sale_invoice",
    refId: "r1",
    refNo: "SINV-0001",
    memo: null,
    debitCents: 0,
    creditCents: 0,
    ...p,
  };
}

describe("businessDate", () => {
  it("shifts UTC into the shop's local day", () => {
    // 2026-09-28T18:00:00Z is 23:30 on 2026-09-28 in Colombo (UTC+5:30)
    expect(businessDate(Date.parse("2026-09-28T18:00:00Z"), 330)).toBe("2026-09-28");
  });

  it("rolls over the local midnight that UTC has not reached", () => {
    // 2026-09-28T20:00:00Z is already 01:30 on 2026-09-29 in Colombo
    expect(businessDate(Date.parse("2026-09-28T20:00:00Z"), 330)).toBe("2026-09-29");
  });

  it("is UTC when the shop runs on UTC", () => {
    expect(businessDate(Date.parse("2026-09-28T20:00:00Z"), 0)).toBe("2026-09-28");
  });

  it("adds days across a month and a year boundary", () => {
    expect(addDays("2026-09-28", 1)).toBe("2026-09-29");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("validates the date format", () => {
    expect(isBusinessDate("2026-09-28")).toBe(true);
    expect(isBusinessDate("2026-9-28")).toBe(false);
    expect(isBusinessDate("")).toBe(false);
  });
});

describe("allocateProportional", () => {
  it("gives the rounding remainder to the first share", () => {
    expect(allocateProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("splits the spec's melt lot example exactly", () => {
    const shares = allocateProportional(39_603_961, [6000, 4000]);
    expect(shares).toEqual([23_762_377, 15_841_584]);
    expect(shares[0]! + shares[1]!).toBe(39_603_961);
  });

  it("handles a single weight", () => {
    expect(allocateProportional(500, [7])).toEqual([500]);
  });

  it("rejects non-positive weights", () => {
    expect(() => allocateProportional(100, [0, 5])).toThrow();
    expect(() => allocateProportional(100, [-1, 5])).toThrow();
  });
});

describe("allocateGoldValue", () => {
  it("does NOT normalise, so the shortfall is the manufacturing loss", () => {
    const values = allocateGoldValue(23_762_377, 6000, [5950]);
    expect(values).toEqual([23_564_657]);
    expect(23_762_377 - values.reduce((s, v) => s + v, 0)).toBe(197_720);
  });

  it("sums to vIn when there is no loss", () => {
    expect(allocateGoldValue(1000, 100, [40, 60])).toEqual([400, 600]);
  });

  it("returns zeros when nothing was consumed", () => {
    expect(allocateGoldValue(1000, 0, [100])).toEqual([0]);
  });
});

describe("checkBalanced", () => {
  it("accepts a balanced set", () => {
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 0 },
        { debitCents: 0, creditCents: 100 },
      ])
    ).not.toThrow();
  });

  it("rejects an unbalanced set", () => {
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 0 },
        { debitCents: 0, creditCents: 90 },
      ])
    ).toThrow(/balance/i);
  });

  it("rejects a single line", () => {
    expect(() => checkBalanced([{ debitCents: 100, creditCents: 100 }])).toThrow();
  });

  it("rejects a line that is both debit and credit", () => {
    expect(() =>
      checkBalanced([
        { debitCents: 100, creditCents: 100 },
        { debitCents: 0, creditCents: 100 },
      ])
    ).toThrow(/XOR/);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      checkBalanced([
        { debitCents: -100, creditCents: 0 },
        { debitCents: 0, creditCents: -100 },
      ])
    ).toThrow();
  });

  it("rejects a zero total", () => {
    expect(() => checkBalanced([{ debitCents: 0, creditCents: 0 }])).toThrow();
  });
});

describe("computePartyLedger", () => {
  it("sums a customer ledger the way the shop reads it", () => {
    const t = computePartyLedger("customer", [
      line({ refEntity: "opening_balance", debitCents: 50_000 }),
      line({ refEntity: "sale_invoice", debitCents: 20_000 }),
      line({ refEntity: "sale_payment", creditCents: 15_000 }),
      line({ refEntity: "sale_return", creditCents: 2_000 }),
    ]);
    expect(t.opening).toBe(50_000);
    expect(t.debitSales).toBe(20_000);
    expect(t.creditPayments).toBe(15_000);
    expect(t.creditReturns).toBe(2_000);
    expect(t.closing).toBe(53_000);
  });

  it("flips the sign for a supplier ledger", () => {
    const t = computePartyLedger("supplier", [
      line({ refEntity: "opening_balance", creditCents: 30_000 }),
      line({ refEntity: "purchase_invoice", creditCents: 40_000 }),
      line({ refEntity: "purchase_payment", debitCents: 10_000 }),
    ]);
    expect(t.opening).toBe(30_000);
    expect(t.creditPurchases).toBe(40_000);
    expect(t.debitPayments).toBe(10_000);
    expect(t.closing).toBe(60_000);
  });

  it("treats an unknown ref as a sale for a customer", () => {
    expect(computePartyLedger("customer", [line({ debitCents: 7 })]).debitSales).toBe(7);
  });

  it("returns zeros for a party with no lines", () => {
    expect(computePartyLedger("customer", []).closing).toBe(0);
  });
});

describe("meltingLossValue", () => {
  it("matches the spec worked example", () => {
    expect(meltingLossValue(40_000_000, 10_000, 100)).toBe(396_039);
  });

  it("is zero when nothing was lost", () => {
    expect(meltingLossValue(40_000_000, 10_000, 0)).toBe(0);
  });

  it("is zero when there is no denominator, rather than dividing by zero", () => {
    expect(meltingLossValue(40_000_000, 0, 0)).toBe(0);
  });

  it("leaves the remainder with the lot", () => {
    expect(40_000_000 - meltingLossValue(40_000_000, 10_000, 100)).toBe(39_603_961);
  });
});

describe("goldValueCents", () => {
  it("converts fine mg at a per-gram rate", () => {
    expect(goldValueCents(10_000, 900_000)).toBe(9_000_000);
    expect(goldValueCents(1, 900_000)).toBe(900);
  });
});

describe("closingCash", () => {
  it("is opening plus in minus out", () => {
    expect(closingCash(10_000, 25_000, 12_000)).toBe(23_000);
  });

  it("is just the opening when nothing moved", () => {
    expect(closingCash(10_000, 0, 0)).toBe(10_000);
  });
});

describe("cashDifference", () => {
  it("is actual minus expected", () => {
    expect(cashDifference(23_000, 22_500)).toBe(-500);
  });

  it("is zero when the count matches", () => {
    expect(cashDifference(23_000, 23_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/accounting.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './accounting'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/accounting.ts`:

```ts
export type PartyLedgerKind = "customer" | "supplier";

export type PartyLedgerLine = {
  entryId: string;
  entryNo: string;
  entryDate: string;
  refEntity: string;
  refId: string;
  refNo: string | null;
  memo: string | null;
  debitCents: number;
  creditCents: number;
};

export type PartyLedgerTotals = {
  opening: number;
  debitSales: number;
  creditPayments: number;
  creditReturns: number;
  creditPurchases: number;
  debitPayments: number;
  debitReturns: number;
  closing: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function businessDate(epochMs: number, tzOffsetMinutes: number): string {
  return new Date(epochMs + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Splits `total` across `weights`. The output always sums to `total`. */
export function allocateProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) throw new Error("weights must be positive");
  const shares = weights.map((w) => Math.floor((total * w) / sum));
  shares[0] = (shares[0] ?? 0) + total - shares.reduce((s, x) => s + x, 0);
  return shares;
}

export function checkBalanced(lines: { debitCents: number; creditCents: number }[]): void {
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

const OPENING = "opening_balance";

/**
 * Customer: a debit to 1200 means the customer owes us more, so the ledger
 * runs debit-positive. Supplier: a credit to 2000 means we owe them more, so
 * the ledger runs credit-positive. Every bucket is normalised to "increases
 * the balance we owe" so `closing` is a single sum.
 */
export function computePartyLedger(
  kind: PartyLedgerKind,
  lines: PartyLedgerLine[]
): PartyLedgerTotals {
  const t: PartyLedgerTotals = {
    opening: 0,
    debitSales: 0,
    creditPayments: 0,
    creditReturns: 0,
    creditPurchases: 0,
    debitPayments: 0,
    debitReturns: 0,
    closing: 0,
  };
  for (const l of lines) {
    const dr = l.debitCents;
    const cr = l.creditCents;
    if (kind === "customer") {
      if (l.refEntity === OPENING) t.opening += dr - cr;
      else if (l.refEntity === "sale_payment") t.creditPayments += cr - dr;
      else if (l.refEntity === "sale_return") t.creditReturns += cr - dr;
      else t.debitSales += dr - cr;
    } else {
      if (l.refEntity === OPENING) t.opening += cr - dr;
      else if (l.refEntity === "purchase_payment") t.debitPayments += dr - cr;
      else if (l.refEntity === "purchase_invoice") t.creditPurchases += cr - dr;
      else t.creditPurchases += cr - dr;
    }
  }
  t.closing =
    t.opening + t.debitSales + t.creditPurchases - t.creditPayments - t.debitPayments - t.creditReturns;
  return t;
}

export function closingCash(openingCents: number, cashInCents: number, cashOutCents: number): number {
  return openingCents + cashInCents - cashOutCents;
}

export function cashDifference(expectedCents: number, actualCents: number): number {
  return actualCents - expectedCents;
}

export function meltingLossValue(
  inputCostCents: number,
  outputFineMg: number,
  lossMg: number
): number {
  const denom = outputFineMg + lossMg;
  if (denom <= 0) return 0;
  return Math.round((inputCostCents * lossMg) / denom);
}

/**
 * Deliberately NOT allocateProportional: the output must sum to *less* than
 * `vIn` when fine gold was lost in the process, and that shortfall is the
 * manufacturing loss value. Normalising here would silently discard it.
 */
export function allocateGoldValue(vIn: number, fineIn: number, outputsFineMg: number[]): number[] {
  if (fineIn <= 0) return outputsFineMg.map(() => 0);
  return outputsFineMg.map((f) => Math.round((vIn * f) / fineIn));
}

export function goldValueCents(fineMg: number, rateCentsPerG: number): number {
  return Math.round((fineMg * rateCentsPerG) / 1000);
}
```

- [ ] **Step 4: Export from the package index**

Replace `packages/shared/src/index.ts` with:

```ts
export * from "./permissions";
export * from "./schemas";
export * from "./types";
export * from "./units";
export * from "./accounting";
```

- [ ] **Step 5: Point `allocateCharges` at the shared implementation**

In `apps/api/src/services/purchases.ts`, replace the import on line 1 and delete the function at lines 7-13:

```ts
import {
  allocateProportional,
  gToMg,
  lkrToCents,
  type CreateInvoiceInput,
  type CreateOrderInput,
} from "@goldos/shared";
```

replacing them with:

```ts
export const allocateCharges = allocateProportional;
```

The existing `receiveBatch` caller and any test keep working unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/shared && pnpm exec vitest run 2>&1 | tail -20`
Expected: all suites PASS, `accounting.test.ts` included.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts packages/shared/src/index.ts apps/api/src/services/purchases.ts
git commit -m "feat: shared accounting math, allocateCharges now delegates"
```

---

### Task 2: Migration 0015 — schema

**Files:**
- Create: `apps/api/drizzle/0015_ledger_core.sql`
- Modify: `apps/api/src/db/schema.ts:204-225` plus five table definitions

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces the shape every later task reads and writes:
  - `journal_entries(id PK, entry_no UNIQUE, entry_date, memo, ref_entity, ref_id, ref_no, source_module, status, reverses_entry_id, branch_id, created_at, created_by)`
  - `journal_lines(id PK, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo)`
  - `chart_of_accounts` gains `is_system`, `description`; 24 accounts total
  - `counters` gains `('JE', 1)` and `('GADJ', 1)`
  - `sales_invoices`, `sales_returns`, `purchase_invoices`, `old_gold_purchases` gain `journal_entry_id`
  - `melting_batches` gains `input_cost_cents`; `melting_outputs` gains `cost_cents`
  - `settings` gains `business_tz_offset_minutes = 330`
  - `customers`/`suppliers` keep `opening_balance_cents` for now — Task 3 backfills, Task 5 drops

- [ ] **Step 1: Write the migration**

Create `apps/api/drizzle/0015_ledger_core.sql`:

```sql
-- 0015_ledger_core.sql
-- The journal becomes header + lines. The flat table is renamed in place so
-- its rows survive; 0016 groups them into headers.

ALTER TABLE journal_entries RENAME TO journal_lines;
ALTER TABLE journal_lines ADD COLUMN entry_id TEXT;
ALTER TABLE journal_lines ADD COLUMN line_no INTEGER;

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  memo TEXT,
  ref_entity TEXT,
  ref_id TEXT,
  ref_no TEXT,
  source_module TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'POSTED',
  reverses_entry_id TEXT REFERENCES journal_entries(id),
  branch_id TEXT REFERENCES branches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_je_date     ON journal_entries(entry_date, branch_id);
CREATE INDEX idx_je_ref      ON journal_entries(ref_entity, ref_id);
CREATE INDEX idx_je_module   ON journal_entries(source_module, entry_date);
CREATE INDEX idx_je_status   ON journal_entries(status);
CREATE INDEX idx_je_reverses ON journal_entries(reverses_entry_id);

CREATE INDEX idx_jl_entry   ON journal_lines(entry_id, line_no);
CREATE INDEX idx_jl_account ON journal_lines(account_code);
CREATE INDEX idx_jl_party   ON journal_lines(party_type, party_id);

ALTER TABLE chart_of_accounts ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chart_of_accounts ADD COLUMN description TEXT;

-- Accounts the ledger posts into cannot be repurposed by the shop. The shop
-- configures *additional* accounts, not these.
UPDATE chart_of_accounts SET is_system = 1 WHERE code IN
  ('1000','1010','1100','1200','2000','2100','3000','3100','4000','5000');

-- 6000 is renamed rather than left as a generic bucket: it has zero entries,
-- and spec 2.3 gives every expense category its own account.
UPDATE chart_of_accounts
SET name = 'Rent & Rates', description = 'Shop rent and rates'
WHERE code = '6000';

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('1020', 'Card Clearing',           'ASSET',     1, 'Card sales awaiting settlement'),
  ('2200', 'Other Payables',          'LIABILITY', 1, 'Accrued costs not yet paid'),
  ('5100', 'Gold Melting Loss',       'EXPENSE',   1, 'Fine gold lost in melting'),
  ('5200', 'Gold Manufacturing Loss', 'EXPENSE',   1, 'Fine gold lost in manufacturing'),
  ('5300', 'Gold Adjustment Loss',    'EXPENSE',   1, 'Net gold shrinkage from stock counts');

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('6010', 'Utilities',              'EXPENSE', 0, 'Electricity, water, gas'),
  ('6020', 'Salaries & Wages',       'EXPENSE', 0, 'Staff wages and bonuses'),
  ('6030', 'Repairs & Maintenance',  'EXPENSE', 0, 'Tools, machinery, repairs'),
  ('6040', 'Transport & Delivery',   'EXPENSE', 0, 'Transport of goods and staff'),
  ('6050', 'Marketing & Advertising', 'EXPENSE', 0, 'Promotion and advertising'),
  ('6060', 'Bank & Card Charges',    'EXPENSE', 0, 'Bank fees, card processing, interest'),
  ('6070', 'Office & Consumables',   'EXPENSE', 0, 'Stationery and consumables'),
  ('6080', 'Other Expenses',         'EXPENSE', 0, 'Anything not covered above');

-- The document that owns an entry, so a correction reverses *that* entry
-- rather than guessing by ref_entity/ref_id plus created_at.
ALTER TABLE sales_invoices     ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE sales_returns      ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE purchase_invoices  ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);
ALTER TABLE old_gold_purchases ADD COLUMN journal_entry_id TEXT REFERENCES journal_entries(id);

-- Book-cost chain: what the shop paid -> melt lot -> finished product.
ALTER TABLE melting_batches ADD COLUMN input_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE melting_outputs ADD COLUMN cost_cents      INTEGER NOT NULL DEFAULT 0;

INSERT INTO counters (name, next) VALUES ('JE', 1), ('GADJ', 1);

-- Shop-local business date. UTC+5:30; overridable in the settings table.
INSERT INTO settings (key, value_json, type)
VALUES ('business_tz_offset_minutes', '330', 'number')
ON CONFLICT(key) DO NOTHING;
```

- [ ] **Step 2: Mirror the schema in Drizzle**

In `apps/api/src/db/schema.ts`, replace the `chartOfAccounts` and `journalEntries` definitions (currently lines 204-225) with:

```ts
export const chartOfAccounts = sqliteTable("chart_of_accounts", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  isActive: integer("is_active").notNull().default(1),
  isSystem: integer("is_system").notNull().default(0),
  description: text("description"),
  branchId: text("branch_id"),
});

export const journalEntries = sqliteTable("journal_entries", {
  id: text("id").primaryKey(),
  entryNo: text("entry_no").notNull(),
  entryDate: text("entry_date").notNull(),
  memo: text("memo"),
  refEntity: text("ref_entity"),
  refId: text("ref_id"),
  refNo: text("ref_no"),
  sourceModule: text("source_module").notNull(),
  status: text("status").notNull().default("POSTED"),
  reversesEntryId: text("reverses_entry_id"),
  branchId: text("branch_id"),
  createdAt: integer("created_at").notNull(),
  createdBy: text("created_by"),
});

export const journalLines = sqliteTable("journal_lines", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  lineNo: integer("line_no").notNull(),
  accountCode: text("account_code").notNull(),
  debitCents: integer("debit_cents").notNull().default(0),
  creditCents: integer("credit_cents").notNull().default(0),
  partyType: text("party_type"),
  partyId: text("party_id"),
  memo: text("memo"),
});
```

Then add the new columns to the existing definitions, matching each table's existing style:
- `inputCostCents: integer("input_cost_cents").notNull().default(0)` on `meltingBatches`
- `costCents: integer("cost_cents").notNull().default(0)` on `meltingOutputs`
- `journalEntryId: text("journal_entry_id")` on `salesInvoices`, `salesReturns`, `purchaseInvoices`, and `oldGoldPurchases`

- [ ] **Step 3: Verify the migration applies**

Run: `cd apps/api && npx wrangler d1 migrations apply goldos --local 2>&1 | tail -20`
Expected: `0015_ledger_core.sql` applied, no errors.

If the local database does not exist yet, establish the baseline first — the repo's
`db:migrate:local` script only runs 0001, so apply the rest through
`scripts/cloudflare-sync.sh` or by hand in sorted order.

- [ ] **Step 4: Confirm the account count**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT COUNT(*) AS n FROM chart_of_accounts;"`
Expected: `n` = 24.

- [ ] **Step 5: Confirm the header table is empty and lines are not**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT (SELECT COUNT(*) FROM journal_entries) AS headers, (SELECT COUNT(*) FROM journal_lines) AS lines;"`
Expected: `headers` = 0, `lines` = whatever the shop had before (0 on a fresh database).

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle/0015_ledger_core.sql apps/api/src/db/schema.ts
git commit -m "feat: migration 0015 — journal header+lines, 24 accounts, document links"
```

---

### Task 3: Migration 0016 — data backfill

**Files:**
- Create: `apps/api/drizzle/0016_ledger_backfill.sql`

**Interfaces:**
- Consumes: the `journal_entries` / `journal_lines` shape from Task 2.
- Produces: every pre-existing `journal_lines` row has a non-null `entry_id` and `line_no`; every party with a non-zero `opening_balance_cents` has an `opening_balance` header whose lines carry that party's `party_id`; every posting-bearing document has `journal_entry_id` set.

- [ ] **Step 1: Write the backfill**

Create `apps/api/drizzle/0016_ledger_backfill.sql`:

```sql
-- 0016_ledger_backfill.sql
-- Groups the pre-0015 flat journal rows into real entries, converts party
-- opening balances into entries against 3100, and links documents to their
-- entry. Idempotent: every step is guarded, so a re-run is a no-op.

-- A header per (ref_entity, ref_id, created_at, branch_id). The id is derived
-- from the grouping key so a re-run collides on the PRIMARY KEY rather than
-- duplicating. HASH is a stable SQLite function, unlike randomblob().
INSERT INTO journal_entries (id, entry_no, entry_date, memo, ref_entity, ref_id,
                             ref_no, source_module, status, branch_id, created_at, created_by)
SELECT
  'je-' || lower(hex(HASH(l.ref_entity, '|', l.ref_id, '|', l.created_at, '|', COALESCE(l.branch_id, '-')))),
  'JE-B' || substr('000000' || CAST(COUNT(*) AS TEXT), -6, 6),
  date(CAST(l.created_at / 1000 AS INTEGER), 'unixepoch', '+330 minutes'),
  l.memo,
  l.ref_entity,
  l.ref_id,
  NULL,
  CASE l.ref_entity
    WHEN 'sale_invoice'      THEN 'sales'
    WHEN 'sale_return'       THEN 'sales'
    WHEN 'purchase_invoice'  THEN 'purchases'
    WHEN 'purchase_payment'  THEN 'purchases'
    WHEN 'old_gold_purchase' THEN 'oldgold'
    ELSE 'manual'
  END,
  'POSTED',
  l.branch_id,
  l.created_at,
  l.created_by
FROM journal_lines l
WHERE l.entry_id IS NULL
GROUP BY l.ref_entity, l.ref_id, l.created_at, l.branch_id;

-- SQLite's rowid is not guaranteed to survive a table rename, so the id is
-- recomputed from the same grouping key rather than joined on.
UPDATE journal_lines
SET entry_id = 'je-' || lower(hex(HASH(ref_entity, '|', ref_id, '|', created_at, '|', COALESCE(branch_id, '-'))))
WHERE entry_id IS NULL;

-- line_no must be deterministic, so order by the line's own content.
UPDATE journal_lines
SET line_no = (
  SELECT COUNT(*) FROM journal_lines x
  WHERE x.entry_id = journal_lines.entry_id
    AND (x.account_code, x.debit_cents, x.credit_cents, COALESCE(x.party_id, '-'))
      < (journal_lines.account_code, journal_lines.debit_cents, journal_lines.credit_cents, COALESCE(journal_lines.party_id, '-'))
);

-- Party opening balances become real entries against 3100, dated the day
-- before the party's first journal line so they sort ahead of it. A customer
-- who starts owing us is DR 1200 / CR 3100; a supplier we start owing is
-- DR 3100 / CR 2000. The customers column is positive-means-owes-us and the
-- suppliers column is positive-means-we-owe, so the supplier branch negates.
INSERT INTO journal_entries (id, entry_no, entry_date, memo, ref_entity, ref_id,
                             ref_no, source_module, status, branch_id, created_at, created_by)
SELECT
  'je-open-' || p.kind || '-' || p.id,
  'JE-OPEN-' || substr(upper(hex(RANDOMBLOB(4))), 1, 8),
  date(CAST(p.created_at / 1000 AS INTEGER), 'unixepoch', '+330 minutes'),
  'Opening balance migrated from party record',
  'opening_balance',
  p.id,
  p.code,
  'manual',
  'POSTED',
  p.branch_id,
  p.created_at,
  p.created_by
FROM (
  SELECT 'customer' AS kind, id, code, branch_id, opening_balance_cents AS amount,
         created_at, created_by
  FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, code, branch_id, -opening_balance_cents, created_at, created_by
  FROM suppliers WHERE opening_balance_cents <> 0
) p;

INSERT INTO journal_lines (id, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo)
SELECT
  'jl-open-' || p.kind || '-' || p.id || '-' || n.n,
  'je-open-' || p.kind || '-' || p.id,
  n.n,
  n.account_code,
  p.amount,
  0,
  p.kind,
  p.id,
  'Opening balance migrated from party record'
FROM (
  SELECT 'customer' AS kind, id, opening_balance_cents AS amount FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, -opening_balance_cents FROM suppliers WHERE opening_balance_cents <> 0
) p
JOIN (
  SELECT 'customer' AS kind, 1 AS n, '1200' AS account_code, 1 AS take_debit
  UNION ALL
  SELECT 'customer', 2, '3100', 0
  UNION ALL
  SELECT 'supplier', 1, '2000', 1
  UNION ALL
  SELECT 'supplier', 2, '3100', 0
) n ON n.kind = p.kind
WHERE (p.amount > 0 AND n.take_debit = 1) OR (p.amount < 0 AND n.take_debit = 0)
ORDER BY p.kind, p.id, n.n;

-- The credit side is the same amount on the other account, so the pair nets to
-- zero by construction rather than by a second CASE.
INSERT INTO journal_lines (id, entry_id, line_no, account_code, debit_cents, credit_cents, party_type, party_id, memo)
SELECT
  'jl-open-' || p.kind || '-' || p.id || '-' || (CASE WHEN n.take_debit = 1 THEN 2 ELSE 1 END),
  'je-open-' || p.kind || '-' || p.id,
  CASE WHEN n.take_debit = 1 THEN 2 ELSE 1 END,
  CASE WHEN n.take_debit = 1 THEN '3100' ELSE CASE p.kind WHEN 'customer' THEN '1200' ELSE '2000' END END,
  0,
  ABS(p.amount),
  NULL,
  p.id,
  'Opening balance migrated from party record'
FROM (
  SELECT 'customer' AS kind, id, opening_balance_cents AS amount FROM customers WHERE opening_balance_cents <> 0
  UNION ALL
  SELECT 'supplier', id, -opening_balance_cents FROM suppliers WHERE opening_balance_cents <> 0
) p
JOIN (
  SELECT 'customer' AS kind, 1 AS take_debit
  UNION ALL
  SELECT 'supplier', 1
) n ON n.kind = p.kind;

-- Link each posting-bearing document to the header that recorded it. A purchase
-- void shares ref_entity and ref_id with the receive, so the EARLIEST entry for
-- the document is the receive, which is the one a void must reverse.
UPDATE purchase_invoices
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'purchase_invoice' AND e.ref_id = purchase_invoices.id
  ORDER BY e.created_at, e.id LIMIT 1
);

UPDATE sales_invoices
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'sale_invoice' AND e.ref_id = sales_invoices.id
  ORDER BY e.created_at, e.id LIMIT 1
);

UPDATE old_gold_purchases
SET journal_entry_id = (
  SELECT e.id FROM journal_entries e
  WHERE e.ref_entity = 'old_gold_purchase' AND e.ref_id = old_gold_purchases.id
  ORDER BY e.created_at, e.id LIMIT 1
);
```

The direction logic: both columns are stored positive-means-"this party owes
us more" — `customers.opening_balance_cents` positive means the customer owes
us, and `suppliers.opening_balance_cents` positive means we owe the supplier.
The old formulas were `opening + ΣDR − ΣCR` for a customer and
`opening + ΣCR − ΣDR` for a supplier, so negating the supplier figure puts both
parties on one scale: `amount > 0` always means "this party's balance goes up",
which is a **debit on their own control account**. A negative `amount` is the
reverse. The credit side carries `party_type = NULL`, so the party sub-ledger
only ever contains the movement on their own control account.

- [ ] **Step 2: Verify the grouping produced no orphans**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT COUNT(*) AS orphans FROM journal_lines WHERE entry_id IS NULL OR line_no IS NULL;"`
Expected: `0`.

- [ ] **Step 3: Verify every entry balances — the check that matters**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT e.id, SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING dr <> cr;"`
Expected: **zero rows**. Any row here means the grouping split a posting, and Task 3 is not done.

- [ ] **Step 4: Verify the headers and the party openings**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT (SELECT COUNT(*) FROM journal_entries) AS headers, (SELECT COUNT(DISTINCT entry_id) FROM journal_lines) AS linked, (SELECT COUNT(*) FROM journal_entries WHERE ref_entity = 'opening_balance') AS openings;"`
Expected: `headers` = `linked`, and `openings` = the number of parties with a non-zero opening balance (0 on a fresh database).

- [ ] **Step 5: Verify the party-opening entries are signed correctly**

Run: `cd apps/api && npx wrangler d1 execute goldos --local --command "SELECT l.party_type, l.party_id, l.account_code, l.debit_cents, l.credit_cents FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.ref_entity = 'opening_balance' ORDER BY l.party_type, l.party_id, l.line_no LIMIT 20;"`
Expected: for each customer, a 1200 debit paired with a 3100 credit of the same amount; for each supplier, a 2000 credit paired with a 3100 debit. Every pair must net to zero.

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle/0016_ledger_backfill.sql
git commit -m "feat: migration 0016 — backfill flat journal rows into entries"
```

---

### Task 4: Journal service rewrite

**Files:**
- Modify: `apps/api/src/services/journal.ts` (full rewrite)
- Create: `apps/api/src/services/journal.test.ts`

**Interfaces:**
- Consumes: `checkBalanced`, `computePartyLedger`, `isBusinessDate`, `PartyLedgerKind`, `PartyLedgerLine`, `PartyLedgerTotals` from `@goldos/shared` (Task 1); the new schema (Task 2).
- Produces, all from `services/journal.ts`:
  - `type JournalLine = { account: string; debitCents: number; creditCents: number; partyType?: "customer" | "supplier"; partyId?: string; memo?: string }`
  - `type JournalPost = { lines: JournalLine[]; refEntity: string; refId: string; refNo?: string; memo?: string; branchId?: string; actorId: string; auditAction: string; auditEntity: string; auditEntityId: string; sourceModule: string; entryDate?: string }`
  - `type BuiltEntry = { stmts: D1PreparedStatement[]; entryId: string; entryNo: string }`
  - `type JournalEntryRow = { id, entryNo, entryDate, memo, refEntity, refId, refNo, sourceModule, status, reversesEntryId, branchId, createdAt, createdBy, lines }` — `lines` is `({ id, lineNo } & JournalLine)[]`; `memo`, `refEntity`, `refId`, `refNo`, `reversesEntryId`, `branchId`, `createdBy` are nullable
  - `type TrialBalanceRow = { code, name, type, debitCents, creditCents, balanceCents }` — all numbers except the three strings
  - `type StatementRow = { entryId, entryNo, entryDate, memo, refEntity, refNo, debitCents, creditCents, balanceCents }`
  - `type ListJournalOpts = { page, limit, from?, to?, branchId?, accountCode?, sourceModule?, refEntity? }` — `from`/`to` are `'YYYY-MM-DD'` strings
  - `nextEntryNo(n: number): string`
  - `mirrorLines(lines: JournalLine[]): JournalLine[]`
  - `buildEntryStmts(db, post, opts?: { entryNo?: string; entryDate?: string; reversesEntryId?: string }): Promise<BuiltEntry>`
  - `reverseEntry(db, entryId, input: { reason: string; entryDate?: string; actorId: string }): Promise<BuiltEntry>`
  - `accountBalance(db, code, branchId?): Promise<number>`
  - `accountEntryCount(db, code): Promise<number>`
  - `getJournalEntry(db, id): Promise<JournalEntryRow>`
  - `listJournalEntries(db, opts): Promise<{ rows: JournalEntryRow[]; total: number }>`
  - `trialBalance(db, opts: { date: string; branchId?: string }): Promise<TrialBalanceRow[]>`
  - `accountStatement(db, opts: { code, from, to, branchId? }): Promise<{ rows: StatementRow[]; opening: number; closing: number }>`
  - `partyLedger(db, kind: PartyLedgerKind, partyId: string, opts?: { branchId?: string }): Promise<{ totals: PartyLedgerTotals; lines: PartyLedgerLine[] }>`
  - `postJournalStmts` — **deprecated shim** so Tasks 7 and 8 can migrate call sites one at a time. Deleted in Task 8.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/journal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mirrorLines, nextEntryNo } from "./journal";

describe("mirrorLines", () => {
  it("swaps debit and credit", () => {
    const mirrored = mirrorLines([
      { account: "1100", debitCents: 500, creditCents: 0 },
      { account: "2000", debitCents: 0, creditCents: 500 },
    ]);
    expect(mirrored[0]).toMatchObject({ account: "1100", debitCents: 0, creditCents: 500 });
    expect(mirrored[1]).toMatchObject({ account: "2000", debitCents: 500, creditCents: 0 });
  });

  it("preserves the party tag on a mirrored line", () => {
    const mirrored = mirrorLines([
      { account: "1200", debitCents: 100, creditCents: 0, partyType: "customer", partyId: "c1" },
      { account: "4000", debitCents: 0, creditCents: 100 },
    ]);
    expect(mirrored[0]!.partyType).toBe("customer");
    expect(mirrored[0]!.partyId).toBe("c1");
  });

  it("still balances after mirroring", () => {
    const lines = mirrorLines([
      { account: "1000", debitCents: 100, creditCents: 0 },
      { account: "4000", debitCents: 0, creditCents: 100 },
    ]);
    expect(lines.reduce((s, l) => s + l.debitCents, 0)).toBe(
      lines.reduce((s, l) => s + l.creditCents, 0)
    );
  });

  it("omits party keys on a line that had none", () => {
    const mirrored = mirrorLines([{ account: "1000", debitCents: 1, creditCents: 0 }]);
    expect("partyType" in mirrored[0]!).toBe(false);
  });
});

describe("nextEntryNo", () => {
  it("pads to six digits", () => {
    expect(nextEntryNo(1)).toBe("JE-000001");
    expect(nextEntryNo(42)).toBe("JE-000042");
  });

  it("does not truncate past six digits", () => {
    expect(nextEntryNo(1_234_567)).toBe("JE-1234567");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run src/services/journal.test.ts 2>&1 | tail -15`
Expected: FAIL — `mirrorLines` and `nextEntryNo` are not exported.

- [ ] **Step 3: Rewrite the service**

Replace `apps/api/src/services/journal.ts` in full:

```ts
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
    .all<Omit<StatementRow, "balanceCents">>();
  let running = opening;
  const rows = (results ?? []).map((r) => {
    running += r.debit_cents - r.credit_cents;
    return { ...r, balanceCents: running };
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
  const party = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(partyId).first<{ id: string }>();
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

/**
 * @deprecated Every caller must state its own `sourceModule` and `refNo` so
 * reports can attribute an entry. Removed once Task 8 has migrated the last
 * call site. Do not add new callers.
 */
export async function postJournalStmts(
  db: D1Database,
  post: Omit<JournalPost, "sourceModule">
): Promise<D1PreparedStatement[]> {
  const built = await buildEntryStmts(db, {
    ...post,
    sourceModule: "manual",
    entryDate: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
  });
  return built.stmts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run 2>&1 | tail -20`
Expected: `journal.test.ts` PASSES, and no existing suite regresses.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output, exit 0. The deprecated shim keeps all six existing call sites compiling.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/journal.ts apps/api/src/services/journal.test.ts
git commit -m "feat: journal header+lines service with reversal"
```

---

### Task 5: Retire `opening_balance_cents`

**Files:**
- Modify: `packages/shared/src/schemas.ts:65`
- Modify: `packages/shared/src/ledgers.test.ts`
- Modify: `apps/api/src/services/parties.ts:17,24,35,45,90,101,124`
- Modify: `apps/api/src/routes/parties.ts` (the `/:id/ledger` handler)
- Modify: `apps/web/app/(app)/customers/page.tsx:22`
- Modify: `apps/web/app/(app)/suppliers/page.tsx`
- Create: `apps/api/drizzle/0017_drop_opening_balance.sql`

**Interfaces:**
- Consumes: `partyLedger(db, kind, partyId, opts)` and `computePartyLedger` (Tasks 1 and 4); the backfill from Task 3.
- Produces: the party ledger route returns `{ opening, debitSales, creditPayments, creditReturns, creditPurchases, debitPayments, debitReturns, closing, lines[] }`.

- [ ] **Step 1: Update the test to assert the field is gone**

In `packages/shared/src/ledgers.test.ts`, replace the `it("party schema accepts notes", ...)` block with:

```ts
  it("party schema no longer accepts an opening balance", () => {
    const v = createPartySchema.parse({ name: "X", branchId: "b1", notes: "prefers SMS" });
    expect(v.notes).toBe("prefers SMS");
    expect((v as Record<string, unknown>).openingBalance).toBeUndefined();
  });
```

- [ ] **Step 2: Remove the field from the schema**

In `packages/shared/src/schemas.ts`, delete line 65:

```ts
  openingBalance: z.number().optional().default(0),
```

- [ ] **Step 3: Remove the column from the parties service**

In `apps/api/src/services/parties.ts`:
- Line 17: delete `opening_balance: number;` from the raw row type.
- Line 24: change the SELECT to `"id, code, name, phone, address, nic, notes, credit_limit_cents, is_active, branch_id, created_at"`.
- Line 35: delete `opening_balance_cents: number;` from `PartyRow`.
- Line 45: delete `opening_balance: centsToLkr(r.opening_balance_cents),`.
- Line 90: change the INSERT to `"INSERT INTO ${table} (id, code, name, phone, address, nic, notes, credit_limit_cents, is_active, branch_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)"`.
- Line 101: delete the `lkrToCents(input.openingBalance),` bind.
- Line 124: delete `opening_balance: input.openingBalance,` from the returned row.

Check whether `centsToLkr` and `lkrToCents` are still used elsewhere in the file; if not, drop them from the import on line 1.

- [ ] **Step 4: Point the ledger route at the new shape**

In `apps/api/src/routes/parties.ts`, replace the `/:id/ledger` handler with:

```ts
    .get("/:id/ledger", requirePerm(PERMISSIONS.MASTERS_VIEW), async (c) => {
      try {
        const kind = table === "customers" ? "customer" : "supplier";
        const data = await partyLedger(c.env.DB, kind, c.req.param("id"), {
          branchId: c.req.query("branchId") ?? undefined,
        });
        return c.json({ success: true, data: { ...data.totals, lines: data.lines } }, 200);
      } catch (err) {
        return serviceError(c, err);
      }
    });
```

and change the `account`/`partyType` locals it previously computed to nothing — the kind now lives in the `partyLedger` signature. Remove the two `const` lines if the handler no longer references them.

- [ ] **Step 5: Remove the web form field**

In `apps/web/app/(app)/customers/page.tsx`, delete line 22:

```ts
  { name: "openingBalance", label: "Opening balance (LKR)", type: "number" },
```

Apply the same deletion to `apps/web/app/(app)/suppliers/page.tsx`.

- [ ] **Step 6: Drop the column**

Create `apps/api/drizzle/0017_drop_opening_balance.sql`:

```sql
-- 0017_drop_opening_balance.sql
-- Opening balances are now journal entries against 3100 (see 0016). The
-- column was a second source of truth for a number the ledger already held,
-- and the two could disagree.
ALTER TABLE customers DROP COLUMN opening_balance_cents;
ALTER TABLE suppliers DROP COLUMN opening_balance_cents;
```

- [ ] **Step 7: Verify**

Run: `cd packages/shared && pnpm exec vitest run 2>&1 | tail -15 && cd ../.. && pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit && pnpm --filter goldos-web exec tsc --noEmit`
Expected: all PASS, no typecheck output.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/ledgers.test.ts apps/api/src/services/parties.ts apps/api/src/routes/parties.ts apps/api/drizzle/0017_drop_opening_balance.sql "apps/web/app/(app)/customers/page.tsx" "apps/web/app/(app)/suppliers/page.tsx"
git commit -m "feat: opening balances are journal entries, drop the party columns"
```

---

### Task 6: Chart of accounts CRUD

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append account schemas)
- Modify: `apps/api/src/services/journal.ts` (append account CRUD)
- Create: `apps/api/src/services/busdate.ts`
- Modify: `apps/api/src/routes/accounts.ts`

**Interfaces:**
- Consumes: `accountEntryCount` (Task 4).
- Produces from `services/journal.ts`:
  - `type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"`
  - `type AccountRow = { code, name, type, is_active, is_system, description, balance_cents, entry_count, is_editable }` — `description` is nullable, the rest are not
  - `listAccounts(db, branchId?): Promise<AccountRow[]>`
  - `createAccount(db, input: { code, name, type, description? }, actorId): Promise<{ code: string }>`
  - `updateAccount(db, code, input: { name?, description?, reason }, actorId): Promise<void>`
  - `setAccountActive(db, code, isActive: 0 | 1, reason, actorId): Promise<void>`
- Produces from `services/busdate.ts`:
  - `tzOffsetMinutes(db): Promise<number>`
  - `businessDateFor(db, epochMs): Promise<string>`
- Produces from `@goldos/shared`: `ACCOUNT_TYPES`, `createAccountSchema`, `updateAccountSchema`, `accountStatusSchema`.

- [ ] **Step 1: Add the schemas**

Append to `packages/shared/src/schemas.ts`:

```ts
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

export const createAccountSchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Account code must be four digits"),
  name: z.string().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES),
  description: z.string().max(500).optional(),
});

export const updateAccountSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
});

export const accountStatusSchema = z.object({
  isActive: z.union([z.literal(0), z.literal(1)]),
  reason: z.string().min(1).max(500),
});
```

- [ ] **Step 2: Add the service functions**

Append to `apps/api/src/services/journal.ts`:

```ts
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
    .prepare("SELECT code, name, type, is_active, is_system, description FROM chart_of_accounts ORDER BY code")
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
  const dup = await db.prepare("SELECT code FROM chart_of_accounts WHERE code = ?").bind(input.code).first();
  if (dup) fail("CONFLICT", `Account ${input.code} already exists`);
  await db.batch([
    db
      .prepare("INSERT INTO chart_of_accounts (code, name, type, is_active, is_system, description) VALUES (?, ?, ?, 1, 0, ?)")
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
    db.prepare("UPDATE chart_of_accounts SET name = ?, description = ? WHERE code = ?").bind(name, description, code),
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
```

- [ ] **Step 3: Create the business-date helper**

Create `apps/api/src/services/busdate.ts`:

```ts
import { businessDate } from "@goldos/shared";
import { getSetting } from "./settings";

const DEFAULT_OFFSET_MINUTES = 330;

export async function tzOffsetMinutes(db: D1Database): Promise<number> {
  const s = await getSetting(db, "business_tz_offset_minutes");
  return typeof s?.value === "number" ? s.value : DEFAULT_OFFSET_MINUTES;
}

export async function businessDateFor(db: D1Database, epochMs: number): Promise<string> {
  return businessDate(epochMs, await tzOffsetMinutes(db));
}
```

- [ ] **Step 4: Rewrite the accounts routes**

Replace `apps/api/src/routes/accounts.ts` in full:

```ts
import { Hono } from "hono";
import { z } from "zod";
import {
  accountStatusSchema,
  createAccountSchema,
  PERMISSIONS,
  updateAccountSchema,
} from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { businessDateFor } from "../services/busdate";
import {
  buildEntryStmts,
  createAccount,
  listAccounts,
  reverseEntry,
  setAccountActive,
  updateAccount,
} from "../services/journal";
import { serviceError } from "./http";

const reverseSchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(1).max(500),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const adjustSchema = z.object({
  debitAccount: z.string().min(1),
  creditAccount: z.string().min(1),
  amountCents: z.number().int().gt(0),
  memo: z.string().max(500).optional(),
  reason: z.string().min(1).max(500),
  branchId: z.string().min(1).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const accounts = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const rows = await listAccounts(c.env.DB, c.req.query("branchId") ?? undefined);
    return c.json({ success: true, data: rows }, 200);
  })
  .post("/", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid account" } }, 400);
    try {
      const data = await createAccount(c.env.DB, parsed.data, c.get("userId"));
      return c.json({ success: true, data }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:code", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid update" } }, 400);
    try {
      await updateAccount(c.env.DB, c.req.param("code"), parsed.data, c.get("userId"));
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .patch("/:code/status", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = accountStatusSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid status" } }, 400);
    try {
      await setAccountActive(
        c.env.DB,
        c.req.param("code"),
        parsed.data.isActive,
        parsed.data.reason,
        c.get("userId")
      );
      return c.json({ success: true, data: { ok: true } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/adjustments", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adjustSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid adjustment" } }, 400);
    if (parsed.data.debitAccount === parsed.data.creditAccount)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Accounts must differ" } }, 400);
    try {
      const id = crypto.randomUUID();
      const built = await buildEntryStmts(
        c.env.DB,
        {
          lines: [
            { account: parsed.data.debitAccount, debitCents: parsed.data.amountCents, creditCents: 0 },
            { account: parsed.data.creditAccount, debitCents: 0, creditCents: parsed.data.amountCents },
          ],
          refEntity: "adjustment",
          refId: id,
          memo: parsed.data.memo,
          branchId: parsed.data.branchId,
          actorId: c.get("userId"),
          auditAction: "accounts.adjust",
          auditEntity: "adjustment",
          auditEntityId: id,
          sourceModule: "manual",
        },
        { entryDate: parsed.data.entryDate ?? (await businessDateFor(c.env.DB, Date.now())) }
      );
      await c.env.DB.batch(built.stmts);
      return c.json({ success: true, data: { id, entryId: built.entryId, entryNo: built.entryNo } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .post("/journal/reverse", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reverseSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ success: false, error: { code: "VALIDATION", message: "Invalid reversal" } }, 400);
    try {
      const built = await reverseEntry(c.env.DB, parsed.data.entryId, {
        reason: parsed.data.reason,
        entryDate: parsed.data.entryDate,
        actorId: c.get("userId"),
      });
      await c.env.DB.batch(built.stmts);
      return c.json({ success: true, data: { entryId: built.entryId, entryNo: built.entryNo } }, 201);
    } catch (err) {
      return serviceError(c, err);
    }
  });
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @goldos/shared exec tsc --noEmit && pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/services/journal.ts apps/api/src/services/busdate.ts apps/api/src/routes/accounts.ts
git commit -m "feat: chart of accounts CRUD, adjustments post real entries, reversal endpoint"
```

---

### Task 7: Migrate the purchase and old-gold postings

**Files:**
- Modify: `apps/api/src/services/purchases.ts` (lines 1-13, 164, 189, 458, 525)
- Modify: `apps/api/src/services/oldgold.ts` (line 309)
- Modify: `apps/api/drizzle/0016_ledger_backfill.sql` (add the document-link UPDATEs)

**Interfaces:**
- Consumes: `buildEntryStmts`, `reverseEntry` (Task 4); `businessDateFor` (Task 6).
- Produces: `voidInvoice` reverses the invoice's own entry via `purchase_invoices.journal_entry_id`. After this task the deprecated `postJournalStmts` shim has one caller left (sales), removed in Task 8.

- [ ] **Step 1: Migrate the purchase receive posting**

In `apps/api/src/services/purchases.ts`, inside `receiveBatch`, replace the `const journal = await postJournalStmts(db, { ... })` call and its `stmts.push(...journal)` with:

```ts
  const journal = await buildEntryStmts(
    db,
    {
      lines: [
        { account: "1100", debitCents: total, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
        { account: "2000", debitCents: 0, creditCents: total, partyType: "supplier", partyId: opts.supplierId },
      ],
      refEntity: "purchase_invoice",
      refId: invoiceId,
      refNo: number,
      memo: `Purchase ${number}`,
      branchId: opts.branchId,
      actorId: opts.actorId,
      auditAction: "purchase.receive",
      auditEntity: "purchase_invoice",
      auditEntityId: invoiceId,
      sourceModule: "purchases",
    },
    { entryDate: await businessDateFor(db, opts.now) }
  );
  stmts.push(...journal.stmts);
```

The invoice INSERT is pushed onto `stmts` *before* `buildEntryStmts` resolves, so
its `journal_entry_id` cannot be bound inline. Leave the INSERT untouched and add,
immediately after `stmts.push(...journal.stmts);`:

```ts
  stmts.push(
    db.prepare("UPDATE purchase_invoices SET journal_entry_id = ? WHERE id = ?").bind(journal.entryId, invoiceId)
  );
```

- [ ] **Step 2: Migrate the purchase payment posting**

In the same function, replace the `const payJournal = await postJournalStmts(db, { ... })` block and its `stmts.push(...payJournal)` with:

```ts
    const payJournal = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "2000", debitCents: opts.paidCents, creditCents: 0, partyType: "supplier", partyId: opts.supplierId },
          { account: cash, debitCents: 0, creditCents: opts.paidCents },
        ],
        refEntity: "purchase_payment",
        refId: payId,
        refNo: `${number} / pay`,
        memo: `Payment for ${number}`,
        branchId: opts.branchId,
        actorId: opts.actorId,
        auditAction: "purchase.pay",
        auditEntity: "purchase_payment",
        auditEntityId: payId,
        sourceModule: "purchases",
      },
      { entryDate: await businessDateFor(db, opts.now) }
    );
    stmts.push(...payJournal.stmts);
```

Apply the same shape to the standalone `payInvoice` function (around line 458),
using `refNo: \`Payment for invoice ${inv.id}\`` and
`entryDate: await businessDateFor(db, now)`. That function `await db.batch([...])`
directly rather than building a list, so its call becomes
`...(await buildEntryStmts(db, { ... })).stmts` spread into the array literal.

- [ ] **Step 3: Make `voidInvoice` a real reversal**

In `voidInvoice`, add `paid_cents` and `journal_entry_id` to the invoice SELECT,
then add this guard immediately after the existing `VOID` check:

```ts
  if (inv.paid_cents > 0)
    throw Object.assign(new Error("Invoice has payments; reverse them before voiding"), {
      code: "CONFLICT",
    });
```

> A void reverses the *receive* posting only. Any payment already taken stays
> posted and becomes a genuine payable to the supplier, so voiding an invoice
> with payments against it would silently drop money. The guard makes that
> impossible rather than leaving it to the operator to notice.

Then replace the `const reversal = await postJournalStmts(db, { ... })` block
(line ~525) and its `stmts.push(...reversal)` with:

```ts
  let entryId = inv.journal_entry_id;
  if (!entryId) {
    const earliest = await db
      .prepare(
        "SELECT id FROM journal_entries WHERE ref_entity = 'purchase_invoice' AND ref_id = ? ORDER BY created_at, id LIMIT 1"
      )
      .bind(invoiceId)
      .first<{ id: string }>();
    if (!earliest) throw Object.assign(new Error("Invoice has no journal entry to reverse"), { code: "NOT_FOUND" });
    entryId = earliest.id;
  }
  const reversal = await reverseEntry(db, entryId, {
    reason,
    entryDate: await businessDateFor(db, now),
    actorId,
  });
  stmts.push(...reversal.stmts);
```

- [ ] **Step 4: Migrate the old-gold purchase posting**

In `apps/api/src/services/oldgold.ts`, replace the `const journal = await postJournalStmts(db, { ... })` call (line 309) with:

```ts
  const journal = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: "old_gold_purchase",
      refId: purchaseId,
      refNo: item.number,
      memo: `Old gold ${item.number}`,
      branchId: item.branch_id,
      actorId,
      auditAction: "oldgold.purchase",
      auditEntity: "old_gold",
      auditEntityId: itemId,
      sourceModule: "oldgold",
    },
    { entryDate: await businessDateFor(db, now) }
  );
```

Change `...journal,` in the `db.batch([...])` to `...journal.stmts,` and insert one
extra statement into that **same** array literal, immediately after the
`old_gold_purchases` INSERT:

```ts
    db
      .prepare("UPDATE old_gold_purchases SET journal_entry_id = ? WHERE id = ?")
      .bind(journal.entryId, purchaseId),
```

The whole posting, its gold row, and the link stay in one batch, so the entry
link cannot be written without the entry it points at.

- [ ] **Step 5: Update the imports in both files**

In `apps/api/src/services/purchases.ts`, change the journal import to:

```ts
import { buildEntryStmts, reverseEntry } from "./journal";
import { businessDateFor } from "./busdate";
```

In `apps/api/src/services/oldgold.ts`, change the journal import to:

```ts
import { buildEntryStmts } from "./journal";
import { businessDateFor } from "./busdate";
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 7: Confirm the shim now has exactly one caller left**

Run: `cd apps/api && grep -rn "postJournalStmts" src/`
Expected: only `services/journal.ts` (the definition) and `services/sales.ts` (two call sites).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/purchases.ts apps/api/src/services/oldgold.ts apps/api/drizzle/0016_ledger_backfill.sql
git commit -m "feat: purchase and old-gold postings use real entries, void reverses"
```

---

### Task 8: Migrate the sales postings and retire the shim

**Files:**
- Modify: `apps/api/src/services/sales.ts` (lines 1-7, 68, 218, 374)
- Modify: `apps/api/src/services/journal.ts` (delete `postJournalStmts`)

**Interfaces:**
- Consumes: `buildEntryStmts` (Task 4); `businessDateFor` (Task 6).
- Produces: the final posting map — `cash → 1000`, `card → 1020`, `bank → 1010`, `other → 1010`, `credit → 1200`. No deprecated shim remains.

- [ ] **Step 1: Move card payments to 1020**

In `apps/api/src/services/sales.ts`, change the `PAY_ACCOUNT` constant (line 68) to:

```ts
const PAY_ACCOUNT: Record<string, string> = {
  cash: "1000",
  card: "1020",
  bank: "1010",
  other: "1010",
  credit: "1200",
};
```

- [ ] **Step 2: Migrate the sale posting**

Replace the `const journal = await postJournalStmts(db, { ... })` call (line 218) and its `stmts.push(...journal)` with:

```ts
  const journal = await buildEntryStmts(
    db,
    {
      lines: [
        ...input.payments.map((p) => ({
          account: PAY_ACCOUNT[p.method]!,
          debitCents: lkrToCents(p.amountLkr),
          creditCents: 0,
          ...(p.method === "credit" && customer
            ? { partyType: "customer" as const, partyId: customer.id }
            : {}),
        })),
        { account: "4000", debitCents: 0, creditCents: total },
        { account: "5000", debitCents: costTotal, creditCents: 0 },
        { account: "1100", debitCents: 0, creditCents: costTotal },
      ],
      refEntity: "sale_invoice",
      refId: invoiceId,
      refNo: number,
      memo: `Sale ${number}`,
      branchId: input.branchId,
      actorId,
      auditAction: "sale.complete",
      auditEntity: "sale_invoice",
      auditEntityId: invoiceId,
      sourceModule: "sales",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  stmts.push(...journal.stmts);
  stmts.push(
    db.prepare("UPDATE sales_invoices SET journal_entry_id = ? WHERE id = ?").bind(journal.entryId, invoiceId)
  );
```

- [ ] **Step 3: Migrate the return posting**

In `createReturn`, change the refund-account selection so a card refund credits 1020. Find the `const cash = method === "cash" ? "1000" : "1010";` line and replace it with:

```ts
    const cash = method === "cash" ? "1000" : method === "card" ? "1020" : "1010";
```

Then replace the `const reversal = await postJournalStmts(db, { ... })` call (line 374) and its `stmts.push(...reversal)` with:

```ts
  const reversal = await buildEntryStmts(
    db,
    {
      lines: [
        ...refundLegs,
        { account: "1100", debitCents: costTotal, creditCents: 0 },
        { account: "5000", debitCents: 0, creditCents: costTotal },
      ],
      refEntity: "sale_return",
      refId: returnId,
      refNo: number,
      memo: `Return ${number}`,
      branchId: inv.branch_id,
      actorId,
      auditAction: "sale.return",
      auditEntity: "sale_return",
      auditEntityId: returnId,
      sourceModule: "sales",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  stmts.push(...reversal.stmts);
  stmts.push(
    db.prepare("UPDATE sales_returns SET journal_entry_id = ? WHERE id = ?").bind(reversal.entryId, returnId)
  );
```

- [ ] **Step 4: Delete the deprecated shim**

In `apps/api/src/services/journal.ts`, delete the `postJournalStmts` function and
its `@deprecated` comment block at the bottom of the file.

Run: `cd apps/api && grep -rn "postJournalStmts" src/ || echo NONE`
Expected: `NONE`.

- [ ] **Step 5: Update the imports**

In `apps/api/src/services/sales.ts`, change the journal import to
`import { buildEntryStmts } from "./journal";` and add
`import { businessDateFor } from "./busdate";`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/sales.ts apps/api/src/services/journal.ts
git commit -m "feat: sales postings use real entries, card clears through 1020"
```

---

### Task 9: Journal and report endpoints

**Files:**
- Modify: `apps/api/src/routes/accounts.ts`

**Interfaces:**
- Consumes: `listJournalEntries`, `getJournalEntry`, `trialBalance`, `accountStatement` (Task 4); `businessDateFor` (Task 6).
- Produces: `GET /api/v1/accounts/journal`, `/journal/:id`, `/trial-balance`, `/:code/statement`, all under `accounts:view`.

- [ ] **Step 1: Extend the service imports**

In `apps/api/src/routes/accounts.ts`, change the `../services/journal` import to:

```ts
import {
  accountStatement,
  buildEntryStmts,
  createAccount,
  getJournalEntry,
  listAccounts,
  listJournalEntries,
  reverseEntry,
  setAccountActive,
  trialBalance,
  updateAccount,
} from "../services/journal";
```

and change the `./http` import to:

```ts
import { pagination, serviceError } from "./http";
```

- [ ] **Step 2: Add the read routes**

Insert these handlers into the chain in `apps/api/src/routes/accounts.ts`
immediately after the `.use(requireAuth)` line, so the literal paths are
registered before the `/:code` handlers and win the match:

```ts
  .get("/journal", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const q = (k: string) => c.req.query(k) ?? undefined;
    const data = await listJournalEntries(c.env.DB, {
      ...pagination(c),
      from: q("from"),
      to: q("to"),
      branchId: q("branchId"),
      accountCode: q("accountCode"),
      sourceModule: q("sourceModule"),
      refEntity: q("refEntity"),
    });
    return c.json({ success: true, data }, 200);
  })
  .get("/journal/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      return c.json({ success: true, data: await getJournalEntry(c.env.DB, c.req.param("id")) }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
  .get("/trial-balance", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const date = c.req.query("date") ?? (await businessDateFor(c.env.DB, Date.now()));
    const rows = await trialBalance(c.env.DB, { date, branchId: c.req.query("branchId") ?? undefined });
    return c.json({ success: true, data: { date, rows } }, 200);
  })
  .get("/:code/statement", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const to = c.req.query("to") ?? (await businessDateFor(c.env.DB, Date.now()));
    const from = c.req.query("from") ?? "1970-01-01";
    try {
      const data = await accountStatement(c.env.DB, {
        code: c.req.param("code"),
        from,
        to,
        branchId: c.req.query("branchId") ?? undefined,
      });
      return c.json({ success: true, data: { code: c.req.param("code"), from, to, ...data } }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
```

- [ ] **Step 3: Verify the route order is correct**

Read the assembled chain and confirm `/journal` and `/trial-balance` appear
before `/:code` and `/:code/status`. Hono matches in registration order, so a
`GET /journal` reaching the `/:code` handler first would be read as account code
`"journal"`.

Run: `grep -n '\.get("/\|\.post("/\|\.patch("/' apps/api/src/routes/accounts.ts`
Expected order: `/`, `/journal`, `/journal/:id`, `/trial-balance`, `/:code/statement`, `/:code`, `/:code/status`.

- [ ] **Step 4: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/accounts.ts
git commit -m "feat: journal, trial balance, and account statement endpoints"
```

---

## Live verification

Run after Task 9, before starting the follow-on plan. `wrangler dev` serves the
API on 8787; a browser session against the web app signs you in.

1. `GET /api/v1/accounts` returns **24** accounts. 6000 is "Rent & Rates".
   1020 exists with a zero balance.
2. `POST /api/v1/accounts` with `{code:"6300", name:"Other Income",
   type:"REVENUE"}` returns 201. Posting the same code again returns 409.
3. `PATCH /api/v1/accounts/1000` returns 409 "system account". `PATCH
   /api/v1/accounts/6300` with a `reason` returns 200. `PATCH
   /api/v1/accounts/6300/status` with `{isActive:0, reason:"unused"}` returns
   200; reactivating it returns 200.
4. Post a cash sale. `GET /api/v1/accounts/journal?refEntity=sale_invoice`
   shows one `JE-000001` entry with 6 lines, balanced, with `refNo` set to the
   invoice number. `GET /api/v1/accounts/1000/statement` shows the debit with a
   running balance.
5. Post a card sale. Account 1020 is debited; 1010 is unchanged.
6. `POST /api/v1/accounts/journal/reverse` with that sale's `entryId`. The
   original shows `status: "REVERSED"`, a new entry carries
   `reversesEntryId`, and 1020 is back to zero. Reversing the same entry again
   returns 409.
7. `GET /api/v1/accounts/trial-balance` — the sum of every `balanceCents` is 0.
8. `GET /api/v1/customers/:id/ledger` returns `opening`, `debitSales`,
   `creditPayments`, `creditReturns`, and `closing`, and the closing equals the
   customer's share of 1200.
9. Post a purchase, then void it. The receive entry is `REVERSED`, a mirror
   entry points at it, and the invoice is `VOID`. Voiding an invoice that has
   `paid_cents > 0` returns 409.
10. Backdate an adjustment: `POST /api/v1/accounts/adjustments` with
    `entryDate` three days ago. It appears under that date in
    `GET /api/v1/accounts/journal`, not today.

## Spec coverage

- Spec §2.1 header + lines, indexes, `source_module` values → Tasks 2, 4
- Spec §2.2 `business_date` as TEXT with a `settings` offset → Tasks 1, 2, 6
- Spec §2.3 24 accounts, 6000 renamed, no 4100 → Task 2
- Spec §2.4 `input_cost_cents` / `cost_cents` → Task 2 (columns; used by the follow-on plan)
- Spec §2.5 `journal_entry_id` links → Tasks 2, 7
- Spec §2.6 retired opening-balance columns, full ripple → Tasks 3, 5
- Spec §3.1 `buildEntryStmts`, `reverseEntry`, correction-vs-document rule → Task 4
- Spec §3.2 the posting table, card → 1020, void → reversal → Tasks 7, 8
- Spec §3.3 opening balances as 3100 entries → Tasks 3, 5
- Spec §3.8 backfill, historical card sales left on 1010 → Tasks 3, 8
- Spec §4 every endpoint and its permission → Tasks 6, 9
- Spec §4 party ledger response shape → Tasks 4, 5
- Spec §6 shared math, `allocateProportional` de-duplicating `allocateCharges` → Task 1
- Spec §8 Vitest coverage and the live gate → Tasks 1, 4 and the live verification above

**Deferred to the follow-on plan:** §3.4 melting loss, §3.5 manufacturing book
cost, §3.6 gold adjustments, §3.7 the book-cost chain's melt and manufacturing
links, the shop-local report windows (which keep the ledger and the reports
agreeing), §5 the eight reconciliation checks, and the documentation update.

## Self-Review

- **Spec coverage:** every §1-§4 and §6-§8 item maps to a task above, or is
  explicitly deferred to the follow-on plan with its spec section named.
- **Placeholder scan:** no TBD, no "similar to Task N", no "add appropriate
  error handling". Every step carries real code or a real command with its
  expected output.
- **Type consistency:** `buildEntryStmts` is used identically in Tasks 6, 7, and
  8 and returns `BuiltEntry` in all three. `businessDateFor(db, ms)` has the
  same two-argument shape everywhere. `partyLedger(db, kind, partyId, opts?)` is
  called from Task 5's route with the kind derived from the `table` parameter.
  `JournalPost.entryDate` and `opts.entryDate` are distinguished: the post field
  is the caller's default, the opts field wins, which is how Tasks 7 and 8 pass a
  date they already computed.
- **Known wrinkles, all stated inline:** the party-opening migration uses an
  explicit `take_debit` flag because the two parties store their opening balance
  on opposite scales — a sign flip that is easy to get backwards and would make
  every migrated supplier balance point the wrong way. `voidInvoice` gains a
  `paid_cents > 0` guard because a void reverses the receive posting only, and
  reversing an invoice with payments against it would silently drop money. The
  accounts router registers its literal paths before `/:code` because Hono
  matches in registration order.
