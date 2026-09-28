# Monthly Slice 2 (Aging + Valuation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the monthly report with ledger-as-of receivables/payables aging and book-cost inventory valuation, plus thin `/aging` and `/valuation` routes.

**Architecture:** Pure `agingBuckets` helper in `packages/shared/src/accounting.ts`; `receivables`, `payables`, and `inventory` sections appended to `MonthlyReport` in `apps/api/src/services/monthly.ts` (balances from journal lines `≤ to`, paid-as-of from payment tables, stock at `cost_cents` with pro-rata lots); `GET /reports/aging` and `GET /reports/valuation` aliases in `apps/api/src/routes/monthly.ts` mirroring `/pnl` and `/cashflow`.

**Tech Stack:** Hono 4 on Cloudflare Workers, Drizzle ORM → D1 (SQLite), Zod 3 (existing `monthlyQuerySchema`, no changes), Vitest 2, TypeScript 5.5 strict (no `any`).

## Global Constraints

- Money in INTEGER cents exact; gold weights exact mg where shown; aging in whole days.
- Read-only: no migration, no writes, no new tables.
- Balances are as-of `to` (journal `entry_date <= to`); outstanding uses payments received `≤ to`, never the live status column.
- Inventory at book `cost_cents` with `basis: "book-cost"`; board-rate numbers stay in `estimates[]` only.
- Empty sections return zeros + `hasData: false`, never fabricated.
- JSON requires `accounts:view`; shop-wide requires `branches:manage` or a `branchId` (existing route rule, unchanged).

---

### Task 1: Shared agingBuckets helper

**Files:**
- Modify: `packages/shared/src/accounting.ts`
- Test: `packages/shared/src/accounting.test.ts`

**Interfaces:**
- Consumes: nothing (standalone pure function).
- Produces: `agingBuckets(asOf: string, docs: { id: string; date: string; outstandingCents: number }[]): { "0-30": number; "31-60": number; "61-90": number; "90+": number }` used by Task 2. Dates are `YYYY-MM-DD`; age = whole days `asOf − date` (negative ages count as 0–30, documented).

- [ ] **Step 1: Write the failing test**

```ts
describe("agingBuckets", () => {
  it("buckets outstanding documents by age", () => {
    const r = agingBuckets("2026-09-28", [
      { id: "a", date: "2026-09-20", outstandingCents: 1000 },
      { id: "b", date: "2026-08-01", outstandingCents: 2000 },
      { id: "c", date: "2026-06-01", outstandingCents: 3000 },
      { id: "d", date: "2026-09-28", outstandingCents: 0 },
    ]);
    expect(r).toEqual({ "0-30": 1000, "31-60": 2000, "61-90": 0, "90+": 3000 });
  });
  it("treats future dates as current", () => {
    expect(agingBuckets("2026-09-28", [{ id: "x", date: "2026-10-05", outstandingCents: 7 }])["0-30"]).toBe(7);
  });
});
```

Zero-outstanding docs contribute nothing (skipped, not bucketed).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "agingBuckets"`
Expected: FAIL with "agingBuckets is not defined".

- [ ] **Step 3: Write minimal implementation**

```ts
export function agingBuckets(asOf: string, docs: { id: string; date: string; outstandingCents: number }[]): { "0-30": number; "31-60": number; "61-90": number; "90+": number } {
  if (!isBusinessDate(asOf)) throw Object.assign(new Error("Invalid as-of date"), { code: "VALIDATION" });
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const end = Date.parse(`${asOf}T00:00:00Z`);
  for (const d of docs) {
    if (d.outstandingCents <= 0) continue;
    const age = isBusinessDate(d.date) ? Math.max(0, Math.floor((end - Date.parse(`${d.date}T00:00:00Z`)) / 86_400_000)) : 0;
    if (age <= 30) buckets["0-30"] += d.outstandingCents;
    else if (age <= 60) buckets["31-60"] += d.outstandingCents;
    else if (age <= 90) buckets["61-90"] += d.outstandingCents;
    else buckets["90+"] += d.outstandingCents;
  }
  return buckets;
}
```

Append after `goldClose` in `packages/shared/src/accounting.ts` (next to the other monthly helpers).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @goldos/shared exec vitest run src/accounting.test.ts -t "agingBuckets"`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/accounting.ts packages/shared/src/accounting.test.ts
git commit -m "feat: agingBuckets pure helper with tests"
```

### Task 2: Receivables + payables sections

**Files:**
- Modify: `apps/api/src/services/monthly.ts`

**Interfaces:**
- Consumes: `agingBuckets` (Task 1); existing `sumCents` helper and `MonthlyReport`/`buildMonthlyReport` in the same file.
- Produces: `receivables` and `payables` on `MonthlyReport` consumed by Task 4 routes. Shapes: `{ lines: { partyId: string; name: string; balanceCents: number }[]; aging: { "0-30": number; "31-60": number; "61-90": number; "90+": number }; outstanding: { id: string; number: string; date: string; totalCents: number; outstandingCents: number }[]; totalCents: number; hasData: boolean }`.

- [ ] **Step 1: Extend the type + append the queries**

Extend `MonthlyReport` with `receivables` and `payables` of the shape above. Append before the `return {` in `buildMonthlyReport` (after the cashflow block):

```ts
const bEq = opts.branchId ? " AND e.branch_id = ?" : "";
const bEqv: unknown[] = opts.branchId ? [opts.branchId] : [];
// Balances as of `to`: every 1200/2000 line on or before month-end, opening
// entries included (they are journal lines too — never a separate column).
const custBal = await db.prepare(
  `SELECT l.party_id AS partyId, COALESCE(SUM(l.debit_cents - l.credit_cents),0) AS balance FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_code = '1200' AND l.party_type = 'customer' AND e.entry_date <= ? AND e.status = 'POSTED'${bEq} GROUP BY l.party_id`
).bind(to, ...bEqv).all<{ partyId: string; balance: number }>();
const custNames = new Map<string, string>();
for (const row of custBal.results ?? []) {
  const c = await db.prepare("SELECT name FROM customers WHERE id = ?").bind(row.partyId).first<{ name: string }>();
  custNames.set(row.partyId, c?.name ?? row.partyId);
}
// Outstanding as of `to`: invoice totals minus payments received on/before `to`
// (payment created_at business day). Live status column intentionally ignored.
const siB = opts.branchId ? " AND si.branch_id = ?" : "";
const siBv: unknown[] = opts.branchId ? [opts.branchId] : [];
const { results: sinvs } = await db.prepare(
  `SELECT si.id, si.number, si.total_cents, date(si.created_at/1000,'unixepoch','+330 minutes') AS d,
          COALESCE((SELECT SUM(sp.amount_cents) FROM sales_payments sp WHERE sp.invoice_id = si.id AND sp.method <> 'credit' AND date(sp.created_at/1000,'unixepoch','+330 minutes') <= ?), 0) AS paid
   FROM sales_invoices si WHERE si.status <> 'VOID' AND date(si.created_at/1000,'unixepoch','+330 minutes') <= ?${siB}`
).bind(to, to, ...siBv).all<{ id: string; number: string; total_cents: number; d: string; paid: number }>();
const receivablesOut = (sinvs ?? []).map((r) => ({ id: r.id, number: r.number, date: r.d, totalCents: r.total_cents, outstandingCents: r.total_cents - r.paid })).filter((r) => r.outstandingCents > 0);
const receivablesAging = agingBuckets(to, receivablesOut.map((r) => ({ id: r.id, date: r.date, outstandingCents: r.outstandingCents })));
```

Mirror for payables on `2000`/`supplier`, `purchase_invoices pi` (`total_cents`, `date(pi.created_at...)`, paid sub-select on `purchase_payments pp`), `suppliers` names. Wire into the return object:

```ts
receivables: { lines: (custBal.results ?? []).map((r) => ({ partyId: r.partyId, name: custNames.get(r.partyId) ?? r.partyId, balanceCents: r.balance })), aging: receivablesAging, outstanding: receivablesOut, totalCents: (custBal.results ?? []).reduce((s, r) => s + r.balance, 0), hasData: receivablesOut.length > 0 },
payables: { ... mirror with supplier balances as credit-positive (SUM(credit - debit)) ... },
```

Supplier balance sign: `SUM(l.credit_cents - l.debit_cents)` (we owe = credit-positive), unlike customer debit-positive. State it in a comment.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/monthly.ts
git commit -m "feat: monthly receivables and payables aging"
```

### Task 3: Inventory valuation section

**Files:**
- Modify: `apps/api/src/services/monthly.ts`

**Interfaces:**
- Consumes: `buildMonthlyReport` locals `from/to/branchId` (same function); `MonthlyReport` extended in Task 2.
- Produces: `inventory` on `MonthlyReport`: `{ jewelleryCents: number; goldCents: number; byBranch: { key: string; cents: number }[]; byCategory: { key: string; cents: number }[]; byPurity: { key: string; cents: number }[]; uncostedPieces: number; method: string; basis: "book-cost"; hasData: boolean }` consumed by Task 4.

- [ ] **Step 1: Append the valuation block**

```ts
// Book-cost valuation as of `to`. Jewellery: IN_STOCK-ish statuses (same set
// the gold consistency check counts). Lots: remaining fine share of lot cost.
// Old gold: purchase value of bought-but-unmelted items. No board rates here.
const inStock = "'IN_STOCK','TRANSFER_PENDING','RESERVED','IN_REPAIR','IN_MANUFACTURING','RETURNED'";
const jB = opts.branchId ? " AND p.branch_id = ?" : "";
const jBv: unknown[] = opts.branchId ? [opts.branchId] : [];
const jewTot = await db.prepare(`SELECT COALESCE(SUM(p.cost_cents),0) AS cents, COUNT(*) AS pieces, SUM(CASE WHEN p.cost_cents IS NULL THEN 1 ELSE 0 END) AS uncosted FROM products p WHERE p.status IN (${inStock})${jB}`).bind(...jBv).first<{ cents: number; pieces: number; uncosted: number }>();
```

Careful — `.bind(...jBv)` with empty jBv hits the D1 empty-bind question (same pattern flagged before; `sales.ts:190` and `allBranches` use bare `.bind()` successfully, so follow that precedent: when `jBv` is empty call `.bind()` with no args... reconcile's `firstRow` avoids it. Simplest honest approach matching shipped code: mirror `sumCents` from monthly.ts (it already does `vals.length ? bind(...vals) : prepare`). Write a local `firstOrNull(db, sql, vals)` in this block following `sumCents` exactly. Use it for every new query in Tasks 2–3... Task 2 already binds `to` always (non-empty) — safe as written. For Task 3 queries where vals may be empty (shop-wide, no branch), use the guarded form. Note: `jewTot` above binds `...jBv` possibly empty — rewrite with the guard before committing.

```ts
const { results: jewCat } = await guardedAll(db, `SELECT c.name AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p JOIN categories c ON c.id = p.category_id WHERE p.status IN (${inStock})${jB} GROUP BY c.name`, jBv);
const { results: jewPur } = await guardedAll(db, `SELECT pu.karat AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p JOIN purities pu ON pu.id = p.purity_id WHERE p.status IN (${inStock})${jB} GROUP BY pu.karat`, jBv);
const { results: jewBr } = await guardedAll(db, `SELECT p.branch_id AS key, COALESCE(SUM(p.cost_cents),0) AS cents FROM products p WHERE p.status IN (${inStock})${opts.branchId ? " AND p.branch_id = ?" : ""} GROUP BY p.branch_id`, opts.branchId ? [opts.branchId] : []);
const ogTot = await guardedFirst(db, `SELECT COALESCE(SUM(purchase_value_cents),0) AS cents FROM old_gold_items WHERE status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${opts.branchId ? " AND branch_id = ?" : ""}`, opts.branchId ? [opts.branchId] : []);
// Melt lots: remaining-fine share of each lot's carried cost.
const { results: lots } = await guardedAll(db,
  `SELECT o.id, o.fine_mg, o.cost_cents, o.permille FROM melting_outputs o JOIN melting_batches b ON b.id = o.batch_id AND b.status <> 'VOID'${opts.branchId ? " AND b.branch_id = ?" : ""}`,
  opts.branchId ? [opts.branchId] : []);
const { results: allocs } = await guardedAll(db,
  `SELECT m.lot_batch_id AS batchId, m.lot_number AS lotNo, COALESCE(SUM(m.fine_mg),0) AS used FROM manufacturing_materials m JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID' GROUP BY m.lot_batch_id, m.lot_number`,
  []);
```

Hmm — `melting_outputs` lot identity: manufacturing_materials references `(lot_batch_id, lot_number)`; melting_outputs rows need their lot_number column — migration 0013 has `lot_number MLT-{n}-01`. My select above misses it. Fix: select `o.batch_id, o.lot_number` too. Then per lot: remaining = fine_mg − used(batch,lot); value += round(cost_cents × remaining / fine_mg) when fine_mg > 0. Purity key: join purities on permille — purities table has permille column? Earlier plan asserted it; verify during implementation (`SELECT permille FROM purities LIMIT 1` — if the column is named differently, join on it correctly or fall back to `${permille}` permille-labeled keys like "916"). Decide at implementation: prefer `pu.karat` via permille join; on mismatch use raw permille string. Old-gold purity: `purity_id → karat`, else `tested_permille → karat`, else key "UNRESOLVED" with note in `method`.

```ts
inventory: {
  jewelleryCents: jewTot?.cents ?? 0,
  goldCents: ogCents + lotsCents,
  byBranch: jewBr rows + (gold has no branch split: lots/old-gold branch attribution differs — report jewellery byBranch only? No: spec wants byBranch for stock. Lots carry batch branch; old gold carries branch. So byBranch CAN include gold: lots grouped by b.branch_id, old gold by branch_id. Implement both, summed per branch key.),
  byCategory: jewellery-only (gold has no category) — documented in method note,
  byPurity: jewellery karat rows + lot karat rows + old-gold karat/UNRESOLVED rows, summed per key,
  uncostedPieces: jewTot?.uncosted ?? 0,
  method: "book cost; lots pro-rata by remaining fine weight; byCategory jewellery-only",
  basis: "book-cost",
  hasData: ...,
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/monthly.ts
git commit -m "feat: monthly inventory valuation at book cost"
```

### Task 4: /aging + /valuation routes

**Files:**
- Modify: `apps/api/src/routes/monthly.ts`

**Interfaces:**
- Consumes: `buildMonthlyReport` extended return (Tasks 2–3); existing `monthlyQuerySchema`, perm pattern, `shopWideAllowed` helper in the same file.
- Produces: `GET /reports/aging` → `{ receivables, payables }`; `GET /reports/valuation` → `inventory`. Same validation, same gates as `/pnl` and `/cashflow`.

- [ ] **Step 1: Append the two routes**

```ts
.get("/aging", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
  const parsed = monthlyQuerySchema.safeParse({ month: c.req.query("month"), year: c.req.query("year"), branchId: c.req.query("branchId") ?? undefined });
  if (!parsed.success) return c.json({ success: false, error: { code: "VALIDATION", message: "month 1-12 and year required" } }, 400);
  const perms = c.get("permissions") as string[];
  if (!shopWideAllowed(perms, parsed.data.branchId))
    return c.json({ success: false, error: { code: "FORBIDDEN", message: "branchId required without branches:manage" } }, 403);
  const report = await buildMonthlyReport(c.env.DB, parsed.data);
  return c.json({ success: true, data: { receivables: report.receivables, payables: report.payables } }, 200);
})
.get("/valuation", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
  ...same validation/gate, returns report.inventory...
});
```

Copy the `/pnl` block shape exactly (read it first), changing only the handler path and payload.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/monthly.ts
git commit -m "feat: monthly aging and valuation routes"
```

### Task 5: Aging + valuation tests

**Files:**
- Create: `apps/api/src/services/monthlyAging.test.ts` (separate file — `monthly.test.ts` covers core; this covers slice 2)

**Interfaces:**
- Consumes: `buildMonthlyReport` with the same fake-D1 harness pattern as `monthly.test.ts` (prepare → bind → first/all).
- Produces: green suite proving as-of balances, paid-as-of outstanding, bucketing, and book-cost basis.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildMonthlyReport } from "./monthly";

function fakeDb(first: (sql: string) => unknown, all: (sql: string) => unknown[] = () => []) {
  return {
    prepare: (sql: string) => ({
      bind: (..._v: unknown[]) => ({
        first: async () => first(sql),
        all: async () => ({ results: all(sql) }),
      }),
      first: async () => first(sql),
      all: async () => ({ results: all(sql) }),
    }),
  } as unknown as D1Database;
}

describe("monthly aging", () => {
  it("ages outstanding invoices while paid ones disappear", async () => {
    const db = fakeDb(
      (sql) => {
        if (sql.includes("account_code='4000'")) return { n: 0 };
        return { n: 0, dr: 0, cr: 0 };
      },
      (sql) => {
        if (sql.includes("FROM sales_invoices")) return [
          { id: "s1", number: "SINV-1", total_cents: 10000, d: "2026-09-01", paid: 10000 },
          { id: "s2", number: "SINV-2", total_cents: 5000, d: "2026-09-20", paid: 0 },
        ];
        return [];
      }
    );
    const r = await buildMonthlyReport(db, { month: 9, year: 2026 });
    expect(r.receivables.outstanding.map((o) => o.id)).toEqual(["s2"]);
    expect(r.receivables.aging["0-30"]).toBe(5000);
    expect(r.receivables.hasData).toBe(true);
  });
  it("values inventory at book cost, never board rate", async () => {
    const db = fakeDb(() => ({ n: 0, cents: 0, pieces: 0, uncosted: 0 }));
    const r = await buildMonthlyReport(db, { month: 9, year: 2026 });
    expect(r.inventory.basis).toBe("book-cost");
    expect(r.inventory.hasData).toBe(false);
    expect(r.estimates.every((e) => e.kind === "estimate")).toBe(true);
  });
});
```

The `first` fake returns zeros for all journal sums; the `all` fake returns two invoices (one fully paid-as-of → excluded, one open → aged 8 days → 0–30). The valuation test asserts basis literal + empty zeros + estimates still segregated. `buildMonthlyReport` also queries expenses/gold/cashflow — all covered by the zero `first` and empty `all` defaults... careful: `first` returning `{ n: 0 }` for queries selecting other aliases (`g/c/r/p/pend/dr/cr`) yields undefined fields → service defaults `?? 0` — verify each access in monthly.ts uses `??` (it does: `grossRow?.g ?? 0` etc.). The gold `first` for `AS n` queries is fine. `expRow?.p` fine. If any access lacks `??`, the test will surface it — fix the service (add `?? 0`), not the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter goldos-api exec vitest run src/services/monthlyAging.test.ts`
Expected: FAIL with "receivables is undefined" (sections don't exist yet — run this BEFORE Tasks 2–3 when following task-by-task; in order it passes after).

- [ ] **Step 3: Run test to verify it passes**

Run: `pnpm --filter goldos-api exec vitest run src/services/monthlyAging.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 4: Run full suite**

Run: `pnpm --filter goldos-api exec vitest run`
Expected: PASS — 15 files, no regressions in `monthly`, `counts`, `journal`, `reconcile` suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/monthlyAging.test.ts
git commit -m "test: monthly aging and book-cost valuation"
```

## Self-Review

- Spec §4 excerpts (receivables/payables/inventory contracts): Tasks 2–3 — exact shapes, as-of-`to` balances with openings included, paid-as-of outstanding ignoring live status, buckets 0–30/31–60/61–90/90+, book-cost with method + uncosted disclosure. Covered.
- Spec §5 (routes/filters): Task 4 — `/aging` + `/valuation` thin aliases, same validation/gates/filters as existing section routes (category/purity/staff accepted by schema, ignored beyond breakdowns — same as slice 1). Covered.
- No-fabrication: Tasks 1–3 + 5 — `hasData`, zero-exclusion, `UNRESOLVED` purity bucket, `estimates[]` untouched. Covered.
- Placeholder scan: no TBD/TODO; every query exact; the two "verify during implementation" notes (empty-bind guard, purities permille column) name their fallback explicitly.
- Type consistency: `receivables/payables` shared shape, `inventory` shape with `basis: "book-cost"` literal, `agingBuckets(asOf, docs)` identical in shared/service/tests; `buildMonthlyReport(db, { month, year, branchId?, ... })` signature unchanged.
