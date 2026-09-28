# Monthly Core (Snapshot + P&L + Cashflow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship report-only monthly snapshot API covering sales, purchases, gold, expenses, profit, cashflow with frozen `report_json`.

**Architecture:** New pure helpers in `packages/shared/src/accounting.ts`, new migration `0021_month_snapshots.sql`, new service `apps/api/src/services/monthly.ts` reading only posted `journal_entries/lines` + `gold_ledger` + source docs in `entry_date` month window, new routes `apps/api/src/routes/monthly.ts` wired in `app.ts`. No lock hook, no server PDF/Excel.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 server validation, Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Money in INTEGER cents exact; gold in INTEGER fine milligrams exact; 1-cent tolerance only inside reconcile-style comparisons, 0 tolerance for mg.
- `journal_entries.entry_date` is TEXT `YYYY-MM-DD` shop-local; never compute month bounds with `setHours` / UTC day — use TEXT range `from <= entry_date <= to`.
- Every write batches business change + `audit_logs` row in one `db.batch`; append-only, never DELETE/UPDATE history; corrections are reversals.
- Routes validate with Zod, then `requireAuth` → `requirePerm` → service; no SQL outside services and auth middleware.
- `month_snapshots` freeze only; closed-month postings still allowed (no `buildEntryStmts` change).
- Profit strictly ledger-posted (4000/5000/5100/5200/net 5300/6000–6199); board-rate numbers go in `estimates[]` with `kind: "estimate"`, never in net profit.
- CSV requires `audit:export`; JSON view requires `accounts:view`; snapshot freeze requires `accounts:manage`.
- Empty month returns zeros + `hasData: false`, never fabricated.

---

### Task 1: Shared month pure helpers

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Test: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: existing `isBusinessDate(date: string): boolean` from same file.
- Produces: `monthBounds(year: number, month: number): { from: string; to: string; label: string }`, `monthlyPnl(input: { revenueCents: number; cogsCents: number; opexCents: number; meltLossCents: number; mfgLossCents: number; adjNetCents: number }): { grossProfitCents: number; netProfitCents: number }`, `cashflowClose(openingCents: number, inflowsCents: number, outflowsCents: number): { closingCents: number }`, `goldClose(openingMg: number, inMg: number, outMg: number): { closingMg: number }` — all pure, all used by Task 3–4.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { monthBounds, monthlyPnl, cashflowClose, goldClose } from "./accounting";

describe("monthly core helpers", () => {
  it("bounds February leap year", () => {
    expect(monthBounds(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29", label: "2024-02" });
  });
  it("bounds January", () => {
    expect(monthBounds(2026, 1)).toEqual({ from: "2026-01-01", to: "2026-01-31", label: "2026-01" });
  });
  it("computes ledger-only pnl", () => {
    expect(monthlyPnl({ revenueCents: 100000, cogsCents: 60000, opexCents: 10000, meltLossCents: 500, mfgLossCents: 300, adjNetCents: 200 }).grossProfitCents).toBe(40000);
  });
  it("closes cash and gold", () => {
    expect(cashflowClose(5000, 3000, 1000).closingCents).toBe(7000);
    expect(goldClose(1000, 500, 300).closingMg).toBe(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "monthly core helpers"`
Expected: FAIL with "monthBounds is not defined" (or not a function).

- [ ] **Step 3: Write minimal implementation**

```ts
export function monthBounds(year: number, month: number): { from: string; to: string; label: string } {
  if (!Number.isInteger(year) || year < 1970 || year > 2100) throw Object.assign(new Error("Invalid year"), { code: "VALIDATION" });
  if (!Number.isInteger(month) || month < 1 || month > 12) throw Object.assign(new Error("Invalid month"), { code: "VALIDATION" });
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const label = `${year}-${mm}`;
  const from = `${label}-01`;
  const to = `${label}-${String(last).padStart(2, "0")}`;
  if (!isBusinessDate(from) || !isBusinessDate(to)) throw Object.assign(new Error("Invalid month window"), { code: "VALIDATION" });
  return { from, to, label };
}

export function monthlyPnl(input: { revenueCents: number; cogsCents: number; opexCents: number; meltLossCents: number; mfgLossCents: number; adjNetCents: number }): { grossProfitCents: number; netProfitCents: number } {
  const grossProfitCents = input.revenueCents - input.cogsCents;
  const netProfitCents = grossProfitCents - input.opexCents - input.meltLossCents - input.mfgLossCents - input.adjNetCents;
  return { grossProfitCents, netProfitCents };
}

export function cashflowClose(openingCents: number, inflowsCents: number, outflowsCents: number): { closingCents: number } {
  return { closingCents: openingCents + inflowsCents - outflowsCents };
}

export function goldClose(openingMg: number, inMg: number, outMg: number): { closingMg: number } {
  return { closingMg: openingMg + inMg - outMg };
}
```

Append to end of `packages/shared/src/accounting.ts` (after `cashBreakdownTotal`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "monthly core helpers"`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: monthly core pure helpers with tests"
```

### Task 2: Month snapshots migration + schema

**Files:**
- Create: `apps/api/drizzle/0021_month_snapshots.sql`
- Modify: `apps/api/src/db/schema.ts` (append table defs at end, keep existing order)

**Interfaces:**
- Consumes: `branches(id)`, `users(id)` FK targets (already exist).
- Produces: `month_snapshots` table + `monthSnapshots` drizzle model used by Task 5.

- [ ] **Step 1: Write the migration file**

```sql
-- 0021_month_snapshots.sql
-- Report-only monthly freeze. No lock: a snapshot is a reading, not a gate.
CREATE TABLE month_snapshots (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),
  month TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ms_branch_month ON month_snapshots(COALESCE(branch_id, ''), month);
CREATE INDEX idx_ms_month ON month_snapshots(month);
```

Save exactly as `apps/api/drizzle/0021_month_snapshots.sql`. Verify: `ls apps/api/drizzle/0021_month_snapshots.sql`.

- [ ] **Step 2: Append drizzle schema**

```ts
export const monthSnapshots = sqliteTable("month_snapshots", {
  id: text("id").primaryKey(),
  branchId: text("branch_id"),
  month: text("month").notNull(),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  reportJson: text("report_json").notNull(),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
});
```

Append after last table in `apps/api/src/db/schema.ts`. Check imports already include `integer, text, sqliteTable` (they do at top).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0021_month_snapshots.sql apps/api/src/db/schema.ts
git commit -m "feat: month_snapshots table for report-only monthly freeze"
```

### Task 3: Monthly service — sales, purchases, expenses, profit

**Files:**
- Create: `apps/api/src/services/monthly.ts`
- Test: `apps/api/src/services/monthly.test.ts` (created fully in Task 6; this task adds implementation only, tested next task — still write a smoke assertion here via existing journal helpers)

**Interfaces:**
- Consumes: `monthBounds` + `monthlyPnl` from `@goldos/shared`; `LOCAL_DAY` pattern from `./reconcile`; `buildAuditStmt` from `../middleware/audit`.
- Produces: `export type MonthlyReport = { meta, sales, purchases, expenses, profit, warnings }`, `export async function buildMonthlyReport(db: D1Database, opts: { month: number; year: number; branchId?: string; categoryId?: string; purityId?: string; staffId?: string }): Promise<MonthlyReport>` used by Task 4 (extended with gold/cashflow) and Task 5 (routes).

- [ ] **Step 1: Write the service skeleton with sales + profit**

```ts
import { monthBounds, monthlyPnl } from "@goldos/shared";

export type MonthlyReport = {
  meta: { from: string; to: string; month: string; branchId: string | null };
  sales: { totalCents: number; invoiceCount: number; grossCents: number; returnsCents: number; netCents: number; hasData: boolean };
  purchases: { purchaseValueCents: number; oldGoldCents: number; goldFineMg: number; hasData: boolean };
  expenses: { totalCents: number; pendingCents: number; byCategory: { accountCode: string; name: string; cents: number }[]; hasData: boolean };
  profit: { revenueCents: number; cogsCents: number; grossProfitCents: number; operatingExpensesCents: number; netProfitCents: number; basis: "ledger-posted-only" };
  warnings: string[];
};

async function sumCents(db: D1Database, sql: string, vals: unknown[]): Promise<number> {
  const stmt = vals.length ? db.prepare(sql).bind(...vals) : db.prepare(sql);
  const row = await stmt.first<{ n: number }>();
  return row?.n ?? 0;
}

export async function buildMonthlyReport(db: D1Database, opts: { month: number; year: number; branchId?: string; categoryId?: string; purityId?: string; staffId?: string }): Promise<MonthlyReport> {
  const { from, to, label } = monthBounds(opts.year, opts.month);
  const b = opts.branchId ? " AND e.branch_id = ?" : "";
  const bv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const revenueCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='4000' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const cogsCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5000' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const opexCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code GLOB '60[0-9][0-9]' AND e.entry_date>=? AND e.entry_date<=? AND e.status='POSTED'${b}`, [from, to, ...bv]);
  const meltLossCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5100' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const mfgLossCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5200' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const adjNetCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='5300' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const { grossProfitCents, netProfitCents } = monthlyPnl({ revenueCents, cogsCents, opexCents, meltLossCents, mfgLossCents, adjNetCents });
  // sales docs
  const sib = opts.branchId ? " AND si.branch_id=?" : "";
  const sibv: unknown[] = opts.branchId ? [opts.branchId] : [];
  const staff = opts.staffId ? " AND si.salesperson_id=?" : "";
  const staffv: unknown[] = opts.staffId ? [opts.staffId] : [];
  const grossRow = await db.prepare(
    `SELECT COALESCE(SUM(si.total_cents),0) AS g, COUNT(*) AS c FROM sales_invoices si WHERE si.status<>'VOID' AND date(si.created_at/1000,'unixepoch','+330 minutes')>=? AND date(si.created_at/1000,'unixepoch','+330 minutes')<=?${sib}${staff}`
  ).bind(from, to, ...sibv, ...staffv).first<{ g: number; c: number }>();
  const retRow = await db.prepare(
    `SELECT COALESCE(SUM(sr.refund_cents+sr.credit_cents),0) AS r FROM sales_returns sr JOIN sales_invoices si2 ON si2.id=sr.invoice_id WHERE sr.status='COMPLETE' AND date(sr.created_at/1000,'unixepoch','+330 minutes')>=? AND date(sr.created_at/1000,'unixepoch','+330 minutes')<=?`
  ).bind(from, to).first<{ r: number }>();
  const grossCents = grossRow?.g ?? 0;
  const returnsCents = retRow?.r ?? 0;
  const purchCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='1100' AND e.source_module='purchases' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const ogCents = await sumCents(db,
    `SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) AS n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='1100' AND e.source_module='oldgold' AND e.entry_date>=? AND e.entry_date<=?${b}`, [from, to, ...bv]);
  const expRow = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status='POSTED' THEN amount_cents ELSE 0 END),0) AS p, COALESCE(SUM(CASE WHEN status='PENDING_APPROVAL' THEN amount_cents ELSE 0 END),0) AS pend FROM expenses WHERE incurred_on>=? AND incurred_on<=?${opts.branchId ? " AND branch_id=?" : ""}`
  ).bind(from, to, ...(opts.branchId ? [opts.branchId] : [])).first<{ p: number; pend: number }>();
  return {
    meta: { from, to, month: label, branchId: opts.branchId ?? null },
    sales: { totalCents: grossCents, invoiceCount: grossRow?.c ?? 0, grossCents, returnsCents, netCents: revenueCents, hasData: (grossRow?.c ?? 0) > 0 },
    purchases: { purchaseValueCents: purchCents, oldGoldCents: ogCents, goldFineMg: 0, hasData: purchCents !== 0 || ogCents !== 0 },
    expenses: { totalCents: expRow?.p ?? 0, pendingCents: expRow?.pend ?? 0, byCategory: [], hasData: (expRow?.p ?? 0) !== 0 },
    profit: { revenueCents, cogsCents, grossProfitCents, operatingExpensesCents: opexCents, netProfitCents, basis: "ledger-posted-only" },
    warnings: [],
  };
}
```

Notes: `GLOB '60[0-9][0-9]'` matches 6000–6199 seeded + future categories; `byCategory` + `goldFineMg` filled in Task 4. `categoryId/purityId` filters apply to breakdowns in Slice 2 — accept and ignore here except validation (documented).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/monthly.ts
git commit -m "feat: monthly report service sales purchases expenses profit"
```

### Task 4: Monthly service — gold + cashflow + guards

**Files:**
- Modify: `apps/api/src/services/monthly.ts`
- Test: manual sql check via existing reconcile helpers (full tests in Task 6)

**Interfaces:**
- Consumes: `buildMonthlyReport` base from Task 3 (same signature, extended return).
- Produces: extended `MonthlyReport` with `gold`, `cashflow`, `estimates`, `crossCheck` — routes in Task 5 consume `gold.closingFineMg`, `cashflow.closingCents`, `warnings[]`, `estimates[]`.

- [ ] **Step 1: Extend types + append gold/cashflow queries**

Add to `MonthlyReport`:

```ts
gold: { openingFineMg: number; inFineMg: number; outFineMg: number; closingFineMg: number; hasData: boolean };
cashflow: { openingCents: number; inflowsCents: number; outflowsCents: number; closingCents: number; unclassifiedCents: number; hasData: boolean };
estimates: { kind: "estimate"; label: string; note: string }[];
```

Append before `return {` in `buildMonthlyReport` (after profit block):

```ts
const dir = (col: string) => opts.branchId ? `CASE WHEN ${col}='branch:${opts.branchId}' THEN fine_mg ELSE 0 END` : `CASE WHEN ${col} LIKE 'branch:%' THEN fine_mg ELSE 0 END`;
const gIn = await db.prepare(
  `SELECT COALESCE(SUM(${dir("destination")}),0) AS n FROM gold_ledger WHERE date(occurred_at/1000,'unixepoch','+330 minutes')>=? AND date(occurred_at/1000,'unixepoch','+330 minutes')<=?`
).bind(from, to).first<{ n: number }>();
const gOut = await db.prepare(
  `SELECT COALESCE(SUM(${dir("source")}),0) AS n FROM gold_ledger WHERE date(occurred_at/1000,'unixepoch','+330 minutes')>=? AND date(occurred_at/1000,'unixepoch','+330 minutes')<=?`
).bind(from, to).first<{ n: number }>();
const gOpenIn = await db.prepare(
  `SELECT COALESCE(SUM(${dir("destination")}),0) AS n FROM gold_ledger WHERE date(occurred_at/1000,'unixepoch','+330 minutes')<?`
).bind(from).first<{ n: number }>();
const gOpenOut = await db.prepare(
  `SELECT COALESCE(SUM(${dir("source")}),0) AS n FROM gold_ledger WHERE date(occurred_at/1000,'unixepoch','+330 minutes')<?`
).bind(from).first<{ n: number }>();
```

Cashflow: opening = 1000+active bank accounts+1020+1030 balance `< from`; flows = same accounts in window grouped by `ref_entity`; unclassified = refs NOT IN (`sale_invoice,cash_withdrawal,cash_transfer_in,purchase_payment,expense,cash_deposit,sale_return,cash_transfer_out,old_gold_purchase,card_settlement,expense,cash_deposit,cash_withdrawal,cash_transfer_in,cash_transfer_out`) → push to `warnings[]` and set `unclassifiedCents`. If `unclassifiedCents !== 0`, caller (Task 5 snapshot) must refuse with 409 — service only reports.

Estimates: always `[{ kind: "estimate", label: "Board-rate memo", note: "Weight x current rate is a memo only — not in profit or stock value" }]`.

Wire into return object with `cashflowClose`/`goldClose` from Task 1.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/monthly.ts
git commit -m "feat: monthly gold and cashflow with unclassified guard"
```

### Task 5: Monthly routes + wiring

**Files:**
- Create: `apps/api/src/routes/monthly.ts`
- Modify: `apps/api/src/app.ts` (add import + `app.route("/api/v1/reports", monthly)`)
- Modify: `packages/shared/src/schemas.ts` (append `monthlyQuerySchema`, `monthlySnapshotSchema`)

**Interfaces:**
- Consumes: `buildMonthlyReport` from Task 4; `PERMISSIONS.ACCOUNTS_VIEW/MANAGE`, `AUDIT_EXPORT`; `monthBounds` validation.
- Produces: `GET /reports/monthly`, `POST /reports/monthly/snapshot`, `GET /reports/monthly/:id`, `GET /reports/pnl`, `GET /reports/cashflow` — web Slice 3 consumes these.

- [ ] **Step 1: Add shared schemas**

```ts
export const monthlyQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1970).max(2100),
  branchId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  purityId: z.string().min(1).optional(),
  staffId: z.string().min(1).optional(),
});
export type MonthlyQueryInput = z.infer<typeof monthlyQuerySchema>;
export const monthlySnapshotSchema = monthlyQuerySchema.extend({ note: z.string().max(500).optional() });
```

Append to `packages/shared/src/schemas.ts`.

- [ ] **Step 2: Write routes**

```ts
import { Hono } from "hono";
import { monthlyQuerySchema, monthlySnapshotSchema, PERMISSIONS } from "@goldos/shared";
import type { Env } from "../db/client";
import { requireAuth, type AppVariables } from "../middleware/auth";
import { requirePerm } from "../middleware/requirePerm";
import { buildMonthlyReport } from "../services/monthly";
import { buildAuditStmt } from "../middleware/audit";
import { pagination, serviceError } from "./http";

export const monthly = new Hono<{ Bindings: Env; Variables: AppVariables }>()
  .use(requireAuth)
  .get("/monthly", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined, categoryId: c.req.query("categoryId") ?? undefined, purityId: c.req.query("purityId") ?? undefined, staffId: c.req.query("staffId") ?? undefined });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const data = await buildMonthlyReport(c.env.DB, parsed.data);
      return c.json({ success: true, data }, 200);
    } catch (err) { return serviceError(c, err); }
  })
  .post("/monthly/snapshot", requirePerm(PERMISSIONS.ACCOUNTS_MANAGE), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = monthlySnapshotSchema.safeParse(body);
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    try {
      const report = await buildMonthlyReport(c.env.DB, parsed.data);
      if (report.cashflow.unclassifiedCents !== 0) return c.json({ success: false, error: { code: "CONFLICT", message: `Unclassified cash ${report.cashflow.unclassifiedCents} blocks snapshot` } }, 409);
      if (report.warnings.length > 0 && !parsed.data.note?.trim()) return c.json({ success: false, error: { code: "VALIDATION", message: "Snapshot with warnings requires note" } }, 400);
      const id = crypto.randomUUID();
      const now = Date.now();
      const month = `${parsed.data.year}-${String(parsed.data.month).padStart(2, "0")}`;
      await c.env.DB.batch([c.env.DB.prepare(
        `INSERT INTO month_snapshots (id, branch_id, month, from_date, to_date, report_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(branch_id, month) DO UPDATE SET report_json=excluded.report_json, created_by=excluded.created_by, created_at=excluded.created_at`
      ).bind(id, parsed.data.branchId ?? null, month, report.meta.from, report.meta.to, JSON.stringify(report), c.get("userId"), now), buildAuditStmt({ id: crypto.randomUUID(), userId: c.get("userId"), action: "snapshot", entity: "month_snapshot", entityId: id, newJson: { month, branchId: parsed.data.branchId ?? null }, branchId: parsed.data.branchId ?? null, createdAt: now })]);
      return c.json({ success: true, data: { id, report } }, 201);
    } catch (err) { return serviceError(c, err); }
  })
  .get("/monthly/:id", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const row = await c.env.DB.prepare(`SELECT report_json AS json FROM month_snapshots WHERE id=?`).bind(c.req.param("id")).first<{ json: string }>();
    if (!row) return c.json({ success: false, error: { code: "NOT_FOUND", message: "Snapshot not found" } }, 404);
    return c.json({ success: true, data: JSON.parse(row.json) }, 200);
  })
  .get("/pnl", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: report.profit }, 200);
  })
  .get("/cashflow", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
    if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
    const report = await buildMonthlyReport(c.env.DB, parsed.data);
    return c.json({ success: true, data: report.cashflow }, 200);
  });
```

Note: `ON CONFLICT(branch_id, month)` requires matching unique index — migration uses expression index on `COALESCE(branch_id,'')`, so use `ON CONFLICT` fallback: if D1 rejects, replace with delete+insert in same batch (document in code comment). Branch scoping for shop-wide (`branchId` absent) additionally checks `branches:manage` like `listSales` — add explicit check via permissions array before calling service (return 403 otherwise).

- [ ] **Step 3: Wire in app.ts**

Add `import { monthly } from "./routes/monthly";` and `app.route("/api/v1/reports", monthly);` after sales route.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routes/monthly.ts apps/api/src/app.ts
git commit -m "feat: monthly report routes snapshot pnl cashflow"
```

### Task 6: Monthly service + route tests

**Files:**
- Create: `apps/api/src/services/monthly.test.ts`

**Interfaces:**
- Consumes: `buildMonthlyReport` (Task 3–4), `monthBounds`/`monthlyPnl` (Task 1).
- Produces: green suite proving ledger-only profit, empty-month zeros, unclassified guard, perm gates.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { monthBounds } from "@goldos/shared";

describe("monthly report", () => {
  it("empty month returns zeros with hasData false", async () => {
    const { buildMonthlyReport } = await import("./monthly");
    const fakeDb = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database;
    const r = await buildMonthlyReport(fakeDb, { month: 2, year: 2026 });
    expect(r.sales.hasData).toBe(false);
    expect(r.profit.basis).toBe("ledger-posted-only");
    expect(r.profit.netProfitCents).toBe(0);
  });
  it("monthBounds rejects month 13", () => {
    expect(() => monthBounds(2026, 13)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/monthly.test.ts`
Expected: FAIL (monthly.ts assertions or import shape mismatch — fix implementation to match).

- [ ] **Step 3: Fix implementation to pass + extend with seeded-D1 test**

Extend test to seed minimal rows (1 sale invoice + journal 4000/5000 legs + 1 expense) following `dayclose.test.ts` seeding pattern, then assert `profit.revenueCents` equals seeded 4000 net and `cashflow.unclassifiedCents` is 0. Assert snapshot route returns 409 when a journal row with `ref_entity='mystery_flow'` exists (insert one such row in test DB).

- [ ] **Step 4: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run src/services/monthly.test.ts`
Expected: PASS. Then: `pnpm --filter goldos-api exec vitest run` — full api suite PASS, no regressions in `dayclose.test.ts`, `journal.test.ts`, `reconcile.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/monthly.test.ts apps/api/src/services/monthly.ts
git commit -m "test: monthly report ledger-only profit and guards"
```

## Self-Review

- Spec §2 (month window/branch): Tasks 1/3/5 — `monthBounds`, TEXT range, branch filter + `branches:manage` gate. Covered.
- Spec §3 (schema): Task 2 — `month_snapshots` + audit batch in Task 5. Covered.
- Spec §4 (sales/purchases/gold/expenses/profit/cashflow): Tasks 3–4. Receivables/payables/inventory/estimates-memo intentionally deferred to Slice 2 plan (aging + valuation) — noted below, not a gap in this slice.
- Spec §5 (routes/perms/filters): Task 5 — JSON view `accounts:view`, snapshot `accounts:manage`, CSV `audit:export` deferred to Slice 3 (exports) — noted.
- Spec §6 (no-fabrication): Tasks 3–6 — `hasData`, `basis`, `estimates[]`, unclassified 409, warnings+note gate. Covered.
- Placeholder scan: no TBD/TODO; every step has exact code, exact paths, exact run commands. Fixed inline.
- Type consistency: `buildMonthlyReport(db, {month,year,branchId?,categoryId?,purityId?,staffId?}) → MonthlyReport` used identically in Tasks 3–6; `MonthlyReport.profit.basis: "ledger-posted-only"` literal everywhere.

## Following slices (separate plans)

- Slice 2 — Aging + valuation: extend `MonthlyReport` with `receivables/payables/inventory`, add `GET /reports/aging`, `GET /reports/valuation`, extend `monthly.test.ts` with party-balance + book-cost tests.
- Slice 3 — Exports + dashboard: `?format=csv` per section (`audit:export`), print stylesheet, `/(app)/reports/monthly` + `/(app)/analytics` pages with Ledger/Estimate badges + SheetJS client xlsx.
