# GoldOS Ledger Postings & Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ledger complete — value the money that melting, manufacturing, and gold adjustments currently omit — make the reports agree with the ledger's shop-local dates, and add the eight cross-foot reconciliation checks that gate day close.

**Architecture:** Every one of the three gold flows keeps its existing document and gold-ledger writes and gains a `buildEntryStmts` posting alongside them, inside the same `db.batch`, so money and metal always move together. Inventory is carried at **book cost**, traced purchase-value → melt lot → finished product, so a gold adjustment is valued at the effective rate for its purity rather than guessed. The checks are read-only SQL returning a uniform `CheckResult`, so the follow-on daily-closing spec can gate on `passed` without duplicating any arithmetic.

**Tech Stack:** Hono 4.5 on Cloudflare Workers · Cloudflare D1 (SQLite) via raw `.prepare().bind()` · Zod 3.23 · Vitest 2 · pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-09-28-goldos-ledger-core-design.md`
**Requires first:** `docs/superpowers/plans/2026-09-28-goldos-ledger-core-foundation.md` merged. This plan assumes migrations 0015-0017 have run, `buildEntryStmts`/`reverseEntry`/`businessDateFor` exist, and all six posting call sites already post real entries.

## Global Constraints

- Every `id` is `crypto.randomUUID()`, except seeded masters which use stable slugs.
- All timestamps are `INTEGER` epoch millis. `entry_date` is `TEXT` `'YYYY-MM-DD'`, shop-local.
- Money is `INTEGER` cents. Weight is `INTEGER` mg. Purity is `INTEGER` permille.
- Never `DELETE` a business row. Corrections are reversing entries.
- Every mutation batches its `audit_logs` insert via `buildAuditStmt` **inside the same `db.batch`** as the business write.
- Services throw `Object.assign(new Error("message"), { code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INTERNAL" })`.
- `D1Database` and `D1PreparedStatement` are Workers globals — **never imported**.
- `strict` + `noUncheckedIndexedAccess` are on.
- Gold is reconciled in **weight (fine mg)**, money in **cents**. There is no daily revaluation of inventory, so no check may compare a gold weight to a money amount.
- `allocateGoldValue` must **not** be replaced by `allocateProportional` for manufacturing output. The shortfall from `vIn` is the loss; normalising discards it silently.

---

## Permission additions (single source of truth)

**None.** All new routes are gated by existing permissions:
`accounts:view` for the reconciliation endpoint, `gold:manage` for adjustments
(already on gold adjustments today), `gold:manage` for melt approval (already),
`mfg:approve` for manufacturing finish (already). The count stays at 53.

---

## File Structure

**Create:**
- `apps/api/src/services/reconcile.ts` — the eight checks
- `apps/api/src/services/reconcile.test.ts` — the pure comparison helpers

**Modify:**
- `apps/api/src/services/melting.ts` — value the loss, cost the lot
- `apps/api/src/services/manufacturing.ts` — book-cost output, labour accrual
- `apps/api/src/services/gold.ts` — value the adjustment
- `apps/api/src/routes/manufacturing.ts` — accept `paidFrom`
- `apps/api/src/routes/accounts.ts` — the reconciliation endpoint
- `apps/api/src/routes/sales.ts`, `purchases.ts`, `oldgold.ts`, `manufacturing.ts` — shop-local report windows
- `docs/database.md`, `docs/api.md`, `docs/gold-accounting.md`, `docs/permissions.md`

---

### Task 10: Melting loss valuation

**Files:**
- Modify: `apps/api/src/services/melting.ts` (`approveBatch`, lines 187-257)

**Interfaces:**
- Consumes: `meltingLossValue(inputCostCents, outputFineMg, lossMg)` from `@goldos/shared`; `buildEntryStmts`; `businessDateFor` (all from the foundation plan).
- Produces: `melting_batches.input_cost_cents` and `melting_outputs.cost_cents` populated on approval; account 5100 debited by the loss value.

- [ ] **Step 1: Add the imports**

At the top of `apps/api/src/services/melting.ts`, add:

```ts
import { meltingLossValue } from "@goldos/shared";
import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";
```

- [ ] **Step 2: Load the book cost alongside each input**

In `approveBatch`, replace the `melting_inputs` query with one that joins the old-gold item's purchase value:

```ts
  const { results: inputs } = await db
    .prepare(
      "SELECT i.old_gold_id, i.net_mg, i.fine_mg, COALESCE(o.purchase_value_cents, 0) AS book_cents FROM melting_inputs i JOIN old_gold_items o ON o.id = i.old_gold_id WHERE i.batch_id = ?"
    )
    .bind(batchId)
    .all<{ old_gold_id: string; net_mg: number; fine_mg: number; book_cents: number }>();
```

Keep the `melting_outputs` query and the `if (!outputs) throw …` guard that follows it, then add immediately after that guard:

```ts
  const inputCostCents = (inputs ?? []).reduce((s, i) => s + i.book_cents, 0);
  const lossValueCents = meltingLossValue(inputCostCents, outputs.fine_mg, batch.loss_mg);
  const lotCostCents = inputCostCents - lossValueCents;
```

`melting_inputs.old_gold_id` is `NOT NULL UNIQUE`, so old gold is the only
thing that can enter a batch today and `purchase_value_cents` is the only cost
basis. If catalogue products ever become meltable, this must branch on a null
`old_gold_id` in the same change.

- [ ] **Step 3: Persist the lot cost and post the loss**

In the same function, after the `MELTING_OUTPUT` gold-ledger insert and before
the `if (batch.loss_mg > 0)` block, add:

```ts
  stmts.push(
    db.prepare("UPDATE melting_batches SET input_cost_cents = ? WHERE id = ?").bind(inputCostCents, batchId),
    db
      .prepare("UPDATE melting_outputs SET cost_cents = ? WHERE batch_id = ?")
      .bind(lotCostCents, batchId)
  );
  if (lossValueCents > 0) {
    const lossEntry = await buildEntryStmts(
      db,
      {
        lines: [
          { account: "5100", debitCents: lossValueCents, creditCents: 0 },
          { account: "1100", debitCents: 0, creditCents: lossValueCents },
        ],
        refEntity: "melt_batch",
        refId: batchId,
        refNo: batch.number,
        memo: `Melting loss ${batch.number}: ${batch.loss_mg}mg fine`,
        branchId: batch.branch_id,
        actorId,
        auditAction: "melt.loss",
        auditEntity: "melting_batch",
        auditEntityId: batchId,
        sourceModule: "melting",
      },
      { entryDate: await businessDateFor(db, Date.now()) }
    );
    stmts.push(...lossEntry.stmts);
  }
```

The `UPDATE melting_outputs` is keyed on `batch_id` alone because
`recordMelt` creates exactly one lot per batch (`lot_number` is
`MLT-{n}-01`).

- [ ] **Step 4: Verify the loss arithmetic against the spec example**

Run: `cd packages/shared && pnpm exec vitest run -t "meltingLossValue" 2>&1 | tail -12`
Expected: PASS, including `meltingLossValue(40_000_000, 10_000, 100) === 396_039`.

- [ ] **Step 5: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/melting.ts
git commit -m "feat: melting loss is valued and lots carry book cost"
```

---

### Task 11: Manufacturing book cost and labour accrual

**Files:**
- Modify: `apps/api/src/services/manufacturing.ts` (`finishOrder`, lines 239-357)
- Modify: `apps/api/src/routes/manufacturing.ts` (the finish handler)

**Interfaces:**
- Consumes: `allocateGoldValue`, `allocateProportional`, `fineGoldMg` from `@goldos/shared`; `buildEntryStmts`; `businessDateFor`.
- Produces:
  - `finishOrder(db, orderId, input: { paidFrom?: "cash" | "bank" }, actorId): Promise<{ productIds: string[]; barcodes: string[] }>` — the signature gains an `input` parameter; the previous three-argument form is replaced, not overloaded
  - `manufacturing_outputs.cost_cents` = allocated gold book value + labour share, replacing the market-rate formula
  - Account 2200 credited for accrued cost (or 1000/1010 when `paidFrom` is given); account 5200 debited for the manufacturing loss
  - Schema `finishSchema = z.object({ paidFrom: z.enum(["cash", "bank"]).optional() })` in `routes/manufacturing.ts`

- [ ] **Step 1: Update the imports**

Add `allocateGoldValue` and `allocateProportional` to the `@goldos/shared` import
at the top of `apps/api/src/services/manufacturing.ts`, and add:

```ts
import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";
```

- [ ] **Step 2: Give `finishOrder` its `input` parameter**

Change the signature to:

```ts
export async function finishOrder(
  db: D1Database,
  orderId: string,
  input: { paidFrom?: "cash" | "bank" },
  actorId: string
): Promise<{ productIds: string[]; barcodes: string[] }> {
  const orderPaidFrom = input.paidFrom;
```

- [ ] **Step 3: Load each lot's book cost and full weight**

Replace the materials query inside `finishOrder` with:

```ts
  const { results: mats } = await db
    .prepare(
      `SELECT m.lot_batch_id, m.lot_number, m.fine_mg,
              o.fine_mg AS lot_fine_mg, o.cost_cents AS lot_cost_cents
       FROM manufacturing_materials m
       JOIN melting_outputs o ON o.batch_id = m.lot_batch_id AND o.lot_number = m.lot_number
       WHERE m.order_id = ?`
    )
    .bind(orderId)
    .all<{
      lot_batch_id: string;
      lot_number: string;
      fine_mg: number;
      lot_fine_mg: number;
      lot_cost_cents: number;
    }>();
```

- [ ] **Step 4: Replace market costing with book costing**

Replace the `const rates = await currentGoldRatesCents(db);` line, the `byPurity`
map, the `goldValues` map, and the `for (const o of outputs)` loop that computes
`goldValues` and `outFine` (currently lines ~259-281) with:

```ts
  // Book value of the fine gold consumed, per lot. The two weights passed to
  // allocateProportional sum to the lot's full fine weight, which is what
  // makes it return the consumed share rather than the whole lot.
  const consumedByLot = new Map<string, number>();
  for (const m of mats ?? []) {
    const key = `${m.lot_batch_id}|${m.lot_number}`;
    consumedByLot.set(key, (consumedByLot.get(key) ?? 0) + m.fine_mg);
  }
  let vIn = 0;
  for (const m of mats ?? []) {
    const key = `${m.lot_batch_id}|${m.lot_number}`;
    const consumed = consumedByLot.get(key) ?? 0;
    const shares = allocateProportional(m.lot_cost_cents, [consumed, Math.max(m.lot_fine_mg - consumed, 0)]);
    vIn += shares[0] ?? 0;
  }
  const fineIn = (mats ?? []).reduce((s, m) => s + m.fine_mg, 0);

  const outFine = new Map<string, { fineMg: number; permille: number }>();
  for (const o of outputs) {
    const pur = await db
      .prepare("SELECT permille FROM purities WHERE id = ?")
      .bind(o.purity_id)
      .first<{ permille: number }>();
    if (!pur) throw Object.assign(new Error("Purity not found"), { code: "NOT_FOUND" });
    outFine.set(o.id, { fineMg: fineGoldMg(o.net_mg, pur.permille), permille: pur.permille });
  }
  // Deliberately NOT normalised: the shortfall from vIn is the manufacturing
  // loss. allocateProportional would make that shortfall vanish.
  const goldValues = allocateGoldValue(
    vIn,
    fineIn,
    outputs.map((o) => outFine.get(o.id)!.fineMg)
  );
```

Remove the `currentGoldRatesCents` import if nothing else in the file uses it.
Keep the `fineGoldMg` import.

- [ ] **Step 5: Use the book gold value when costing outputs**

In the output loop, replace `const costCents = (goldValues.get(o.id) ?? 0) + share;`
with an index lookup:

```ts
    const costCents = (goldValues[i] ?? 0) + share;
```

The surrounding loop is already `for (let i = 0; i < outputs.length; i++)`, so
`i` is in scope.

- [ ] **Step 6: Post the capitalised cost and the loss**

Immediately before the `if (order.loss_mg > 0)` gold-ledger block, add:

```ts
  const extras = order.labour_cents + order.making_cents + order.stone_cost_cents;
  const goldOut = goldValues.reduce((s, v) => s + v, 0);
  const mfgLossCents = Math.max(vIn - goldOut, 0);
  if (extras > 0 || mfgLossCents > 0) {
    // Accrue by default. Assuming cash would invent a cash movement that did
    // not happen and would put expected closing cash permanently out.
    const creditAccount =
      orderPaidFrom === "cash" ? "1000" : orderPaidFrom === "bank" ? "1010" : "2200";
    const lines: { account: string; debitCents: number; creditCents: number }[] = [];
    if (extras > 0) {
      lines.push({ account: "1100", debitCents: extras, creditCents: 0 });
      lines.push({ account: creditAccount, debitCents: 0, creditCents: extras });
    }
    if (mfgLossCents > 0) {
      lines.push({ account: "5200", debitCents: mfgLossCents, creditCents: 0 });
      lines.push({ account: "1100", debitCents: 0, creditCents: mfgLossCents });
    }
    const entry = await buildEntryStmts(
      db,
      {
        lines,
        refEntity: "mfg_order",
        refId: orderId,
        refNo: order.number,
        memo: `Manufacturing ${order.number}`,
        branchId: order.branch_id,
        actorId,
        auditAction: "mfg.cost",
        auditEntity: "manufacturing_order",
        auditEntityId: orderId,
        sourceModule: "manufacturing",
      },
      { entryDate: await businessDateFor(db, now) }
    );
    stmts.push(...entry.stmts);
  }
```

The two pairs combine to one balanced set, so `checkBalanced` accepts them as a
single entry: Σdebit = extras + mfgLossCents = Σcredit.

- [ ] **Step 7: Accept `paidFrom` on the route**

In `apps/api/src/routes/manufacturing.ts`, add a module-level schema next to the
file's other Zod schemas:

```ts
const finishSchema = z.object({ paidFrom: z.enum(["cash", "bank"]).optional() });
```

Then in the finish handler, replace the bare `finishOrder(c.env.DB, c.req.param("id"), c.get("userId"))`
call with:

```ts
      const body = await c.req.json().catch(() => null);
      const parsed = finishSchema.safeParse(body);
      return c.json(
        {
          success: true,
          data: await finishOrder(
            c.env.DB,
            c.req.param("id"),
            { paidFrom: parsed.success ? parsed.data.paidFrom : undefined },
            c.get("userId")
          ),
        },
        200
      );
```

A malformed body is not an error here — `paidFrom` is optional, so an empty
body is the common case and simply means "accrue".

- [ ] **Step 8: Verify the gold-value arithmetic against the spec example**

Run: `cd packages/shared && pnpm exec vitest run -t "allocateGoldValue" 2>&1 | tail -12`
Expected: PASS — `allocateGoldValue(23_762_377, 6000, [5950])` returns
`[23_564_657]`, leaving a shortfall of `197_720`.

- [ ] **Step 9: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/services/manufacturing.ts apps/api/src/routes/manufacturing.ts
git commit -m "feat: manufacturing output carries book cost, labour accrues to 2200"
```

---

### Task 12: Gold adjustment money

**Files:**
- Modify: `apps/api/src/services/gold.ts` (`recordAdjustment`, lines 421-458)
- Modify: `apps/api/src/routes/gold.ts` (the adjustments handler)

**Interfaces:**
- Consumes: `goldValueCents(fineMg, rateCentsPerG)`, `fineGoldMg` from `@goldos/shared`; `currentGoldRatesCents` from `services/rates.ts`; `buildEntryStmts`; `businessDateFor`.
- Produces:
  - `recordAdjustment(db, input, actorId): Promise<{ id: string; refNo: string; valueCents: number }>` — the return type gains two fields
  - 5300 debited for `LOSS`, credited for `ADJUSTMENT` and `RECOVERY`
  - `VALIDATION` rejection when no effective rate exists for the adjustment's purity

- [ ] **Step 1: Add the imports**

`apps/api/src/services/gold.ts` currently imports nothing from `@goldos/shared`.
Add:

```ts
import { fineGoldMg, goldValueCents } from "@goldos/shared";
import { businessDateFor } from "./busdate";
import { buildEntryStmts } from "./journal";
import { currentGoldRatesCents } from "./rates";
```

- [ ] **Step 2: Value the adjustment and reject an unrated one**

In `recordAdjustment`, after the approval-threshold check and before
`const id = crypto.randomUUID();`, insert:

```ts
  const purity = await db
    .prepare("SELECT id, permille FROM purities WHERE permille = ?")
    .bind(input.permille)
    .first<{ id: string; permille: number }>();
  if (!purity)
    throw Object.assign(new Error(`No purity matches ${input.permille} permille`), {
      code: "VALIDATION",
    });
  const rates = await currentGoldRatesCents(db);
  const rateRow = rates.find((r) => r.purity_id === purity.id);
  if (!rateRow)
    throw Object.assign(new Error(`No gold rate for this purity; cannot value the adjustment`), {
      code: "VALIDATION",
    });
  const valueCents = goldValueCents(fineGoldMg(input.weightMg, purity.permille), rateRow.rate_cents_per_g);
  if (valueCents <= 0)
    throw Object.assign(new Error("Adjustment has no value"), { code: "VALIDATION" });
```

A guessed loss is worse than no loss, so an unrated adjustment is refused
outright rather than valued at zero.

- [ ] **Step 3: Take a number**

Replace `const id = crypto.randomUUID();` with:

```ts
  const id = crypto.randomUUID();
  const counter = await db
    .prepare("SELECT next FROM counters WHERE name = 'GADJ'")
    .bind()
    .first<{ next: number }>();
  if (!counter) throw Object.assign(new Error("Counter GADJ missing"), { code: "INTERNAL" });
  const refNo = `GADJ-${String(counter.next).padStart(6, "0")}`;
```

- [ ] **Step 4: Post the money and extend the return**

After `const stmts = await postGoldStmts(...)` and before `await db.batch(stmts);`,
add:

```ts
  const lines: { account: string; debitCents: number; creditCents: number }[] =
    input.type === "LOSS"
      ? [
          { account: "5300", debitCents: valueCents, creditCents: 0 },
          { account: "1100", debitCents: 0, creditCents: valueCents },
        ]
      : [
          { account: "1100", debitCents: valueCents, creditCents: 0 },
          { account: "5300", debitCents: 0, creditCents: valueCents },
        ];
  const entry = await buildEntryStmts(
    db,
    {
      lines,
      refEntity: "gold_adjustment",
      refId: id,
      refNo,
      memo: `${input.type} ${input.weightMg}g: ${input.reason}`,
      branchId: input.branchId,
      actorId,
      auditAction: "gold.adjust.value",
      auditEntity: "adjustment",
      auditEntityId: id,
      sourceModule: "gold",
    },
    { entryDate: await businessDateFor(db, now) }
  );
  stmts.push(
    db.prepare("UPDATE counters SET next = ? WHERE name = 'GADJ'").bind(counter.next + 1),
    ...entry.stmts
  );
```

5300 is netted for `ADJUSTMENT` and `RECOVERY` so the account always shows net
gold variance rather than mixing shrinkage and surplus on the same line.

Change the signature's return type to
`Promise<{ id: string; refNo: string; valueCents: number }>` and the return
statement to `return { id, refNo, valueCents };`.

- [ ] **Step 5: Surface the new fields on the route**

In `apps/api/src/routes/gold.ts`, the adjustments handler already returns the
service result as `data`, so it picks up `refNo` and `valueCents` with no
change. Verify by reading the handler; if it destructures only `id`, replace
that with the whole result.

- [ ] **Step 6: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/gold.ts apps/api/src/routes/gold.ts
git commit -m "feat: gold adjustments are valued and post to 5300"
```

---

### Task 13: Shop-local report windows

**Files:**
- Modify: `apps/api/src/routes/sales.ts` (`dayBounds`)
- Modify: `apps/api/src/routes/purchases.ts` (`dayBounds`)
- Modify: `apps/api/src/routes/oldgold.ts` (`dayBounds`)
- Modify: `apps/api/src/routes/manufacturing.ts` (`dayBounds`)

**Interfaces:**
- Consumes: `businessDateFor(db, epochMs)` from `services/busdate`.
- Produces: report windows that agree with `journal_entries.entry_date`. A sale keyed at 23:50 Colombo time appears in today's sales report, not tomorrow's.

- [ ] **Step 1: Replace the duplicated helper in each of the four routes**

In each of `apps/api/src/routes/sales.ts`, `purchases.ts`, `oldgold.ts`, and
`manufacturing.ts`, delete the local `dayBounds` function and add this import:

```ts
import { businessDateFor } from "../services/busdate";
```

Then add this helper immediately after the imports, identical in all four files:

```ts
/**
 * Report windows must agree with journal_entries.entry_date, which is
 * shop-local. Computing a day boundary with setHours(0,0,0,0) uses the
 * Worker's UTC clock and is wrong for a shop east of Greenwich.
 */
async function dayBounds(db: D1Database, period: string): Promise<{ from: number; to: number }> {
  const now = Date.now();
  const today = await businessDateFor(db, now);
  const fromDate =
    period === "today" ? today : period === "month" ? `${today.slice(0, 7)}-01` : "1970-01-01";
  return { from: Date.parse(`${fromDate}T00:00:00Z`), to: now };
}
```

- [ ] **Step 2: Await the call sites**

Every call site currently reads:

```ts
const { from, to } = dayBounds(c.req.query("period") ?? "all");
```

Change every one to:

```ts
    const { from, to } = await dayBounds(c.env.DB, c.req.query("period") ?? "all");
```

- [ ] **Step 3: Verify there are no stragglers**

Run: `cd apps/api && grep -rn "d.setHours(0,0,0,0)" src/routes/ || echo NONE`
Expected: `NONE` — no route computes a day boundary in UTC any more.

- [ ] **Step 4: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sales.ts apps/api/src/routes/purchases.ts apps/api/src/routes/oldgold.ts apps/api/src/routes/manufacturing.ts
git commit -m "fix: report day windows use the shop's local date, not UTC"
```

---

### Task 14: Reconciliation service

**Files:**
- Create: `apps/api/src/services/reconcile.ts`
- Create: `apps/api/src/services/reconcile.test.ts`

**Interfaces:**
- Consumes: `businessDateFor` (foundation plan). Everything else is raw SQL.
- Produces, all from `services/reconcile.ts`:
  - `type CheckScope = "day" | "cumulative"`
  - `type CheckResult = { id: string; label: string; scope: CheckScope; expected: number; actual: number; difference: number; pass: boolean; detail: string[] }`
  - `type ReconcileReport = { date: string; passed: boolean; checks: CheckResult[] }`
  - `compareMoney(id, label, expected, actual, scope, detail?): CheckResult` — 1-cent tolerance
  - `compareWeight(id, label, ledgerMg, documentMg, detail?): CheckResult` — exact, no tolerance
  - `reconcile(db, opts: { date: string; branchId?: string }): Promise<ReconcileReport>`
  - `heldGoldMg(db, branchId?): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareMoney, compareWeight } from "./reconcile";

describe("compareMoney", () => {
  it("passes when the numbers agree", () => {
    const r = compareMoney("trial_balance", "Trial balance", 0, 0, "cumulative");
    expect(r.pass).toBe(true);
    expect(r.difference).toBe(0);
  });

  it("fails and reports the signed difference when they do not", () => {
    const r = compareMoney("sales_crossfoot", "Sales", 1000, 500, "day");
    expect(r.pass).toBe(false);
    expect(r.difference).toBe(-500);
  });

  it("tolerates a one-cent residue", () => {
    expect(compareMoney("x", "x", 1000, 999, "day").pass).toBe(true);
    expect(compareMoney("x", "x", 1000, 997, "day").pass).toBe(false);
  });

  it("passes detail lines through", () => {
    expect(compareMoney("x", "x", 0, 5, "day", ["JE-000007 off by 5"]).detail).toEqual([
      "JE-000007 off by 5",
    ]);
  });
});

describe("compareWeight", () => {
  it("passes on an exact match", () => {
    expect(compareWeight("gold_sale", "Gold SALE", 1000, 1000).pass).toBe(true);
  });

  it("fails on a one-milligram difference, with no tolerance", () => {
    const r = compareWeight("gold_sale", "Gold SALE", 1000, 999);
    expect(r.pass).toBe(false);
    expect(r.difference).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm exec vitest run src/services/reconcile.test.ts 2>&1 | tail -12`
Expected: FAIL — `Cannot find module './reconcile'`.

- [ ] **Step 3: Write the comparison helpers**

Create `apps/api/src/services/reconcile.ts` with this header:

```ts
export type CheckScope = "day" | "cumulative";

export type CheckResult = {
  id: string;
  label: string;
  scope: CheckScope;
  expected: number;
  actual: number;
  difference: number;
  pass: boolean;
  detail: string[];
};

export type ReconcileReport = {
  date: string;
  passed: boolean;
  checks: CheckResult[];
};

/** Cents. A one-cent residue is a rounding artefact, not a discrepancy. */
export function compareMoney(
  id: string,
  label: string,
  expected: number,
  actual: number,
  scope: CheckScope,
  detail: string[] = []
): CheckResult {
  const difference = actual - expected;
  return { id, label, scope, expected, actual, difference, pass: Math.abs(difference) <= 1, detail };
}

/** Fine milligrams. Exact: a missing milligram is real gold, not rounding. */
export function compareWeight(
  id: string,
  label: string,
  ledgerMg: number,
  documentMg: number,
  detail: string[] = []
): CheckResult {
  const difference = ledgerMg - documentMg;
  return { id, label, scope: "day", expected: documentMg, actual: ledgerMg, difference, pass: difference === 0, detail };
}

function n(v: number | null | undefined): number {
  return v ?? 0;
}
```

- [ ] **Step 4: Write the eight checks**

Append to `apps/api/src/services/reconcile.ts`:

```ts
function branchSql(branchId: string | undefined, col: string): { sql: string; vals: unknown[] } {
  return branchId ? { sql: ` AND ${col} = ?`, vals: [branchId] } : { sql: "", vals: [] };
}

export async function heldGoldMg(db: D1Database, branchId?: string): Promise<number> {
  const bp = branchSql(branchId, "branch_id");
  const products = await db
    .prepare(
      `SELECT COALESCE(SUM(fine_gold_mg), 0) AS fine_mg FROM products
       WHERE status NOT IN ('SOLD','RETURNED','VOID','LOST','MELTED')${bp.sql}`
    )
    .bind(...bp.vals)
    .first<{ fine_mg: number }>();
  const oldGold = await db
    .prepare(
      `SELECT COALESCE(SUM(fine_mg), 0) AS fine_mg FROM old_gold_items
       WHERE status IN ('PURCHASED','AVAILABLE','RESERVED_FOR_MELTING')${bp.sql}`
    )
    .bind(...bp.vals)
    .first<{ fine_mg: number }>();
  const lots = await db
    .prepare(
      `SELECT COALESCE(SUM(o.fine_mg), 0) AS total,
              COALESCE(SUM(COALESCE(a.fine_mg, 0)), 0) AS allocated
       FROM melting_outputs o
       JOIN melting_batches b ON b.id = o.batch_id AND b.status <> 'VOID'
       LEFT JOIN (
         SELECT lot_batch_id, lot_number, SUM(fine_mg) AS fine_mg
         FROM manufacturing_materials m
         JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID'
         GROUP BY lot_batch_id, lot_number
       ) a ON a.lot_batch_id = o.batch_id AND a.lot_number = o.lot_number${bp.sql}`
    )
    .bind(...bp.vals)
    .first<{ total: number; allocated: number }>();
  const wip = await db
    .prepare(
      `SELECT COALESCE(SUM(m.fine_mg), 0) AS fine_mg FROM manufacturing_materials m
       JOIN manufacturing_orders mo ON mo.id = m.order_id AND mo.status <> 'VOID'${bp.sql}`
    )
    .bind(...bp.vals)
    .first<{ fine_mg: number }>();
  return (
    n(products?.fine_mg) + n(oldGold?.fine_mg) + (n(lots?.total) - n(lots?.allocated)) + n(wip?.fine_mg)
  );
}

export async function reconcile(
  db: D1Database,
  opts: { date: string; branchId?: string }
): Promise<ReconcileReport> {
  const checks: CheckResult[] = [];
  const day = opts.date;
  const b = branchSql(opts.branchId, "e.branch_id");

  // 1. Every entry balances on its own — catches a corrupt backfill.
  const bad = await db
    .prepare(
      `SELECT e.entry_no, SUM(l.debit_cents) AS dr, SUM(l.credit_cents) AS cr
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.entry_date <= ?${b.sql}
       GROUP BY e.id, e.entry_no HAVING dr <> cr LIMIT 20`
    )
    .bind(day, ...b.vals)
    .all<{ entry_no: string; dr: number; cr: number }>();
  checks.push(
    compareMoney(
      "entry_balance",
      "Every journal entry balances",
      0,
      (bad ?? []).length,
      "cumulative",
      (bad ?? []).map((r) => `${r.entry_no}: DR ${r.dr} vs CR ${r.cr}`)
    )
  );

  // 2. Cumulative trial balance nets to zero.
  const tb = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents), 0) - COALESCE(SUM(l.credit_cents), 0) AS diff
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.entry_date <= ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ diff: number }>();
  checks.push(compareMoney("trial_balance", "Trial balance nets to zero", 0, n(tb?.diff), "cumulative"));

  // 3. Sales: net movement on 4000 equals invoice totals less return value.
  //    `sales_returns` has no total column — `refund_cents` and `credit_cents`
  //    are mutually exclusive (one is always zero), so the return's value is
  //    their sum. Two scalar sub-selects, not a JOIN: a second return against
  //    the same invoice would otherwise double the invoice total.
  const salesJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '4000' AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const siB = branchSql(opts.branchId, "si.branch_id");
  const salesDocs = await db
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(si.total_cents) FROM sales_invoices si
                   WHERE si.status <> 'VOID'
                     AND date(si.created_at / 1000, 'unixepoch', '+330 minutes') = ?${siB.sql}), 0)
       - COALESCE((SELECT SUM(sr.refund_cents + sr.credit_cents) FROM sales_returns sr
                   JOIN sales_invoices si2 ON si2.id = sr.invoice_id
                   WHERE sr.status = 'COMPLETE'
                     AND date(sr.created_at / 1000, 'unixepoch', '+330 minutes') = ?${siB.sql}), 0)
         AS net`
    )
    .bind(day, ...siB.vals, day, ...siB.vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney(
      "sales_crossfoot",
      "Sales journal matches sales documents",
      n(salesDocs?.net),
      n(salesJournal?.net),
      "day"
    )
  );

  // 4. Purchases: 1100 debits from purchase documents equal invoice totals.
  const purchJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1100' AND e.source_module = 'purchases' AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const purchDocs = await db
    .prepare(
      `SELECT COALESCE(SUM(total_cents), 0) AS net FROM purchase_invoices
       WHERE status <> 'VOID'
         AND date(created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "branch_id").sql}`
    )
    .bind(day, ...branchSql(opts.branchId, "branch_id").vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney("purchases_crossfoot", "Purchases journal matches purchase documents", n(purchDocs?.net), n(purchJournal?.net), "day")
  );

  // 5. Payment-driven cash movement equals the payment records.
  //
  //    Scoped by ref_entity on purpose. Specs 2-4 add their own cash sources
  //    (card settlements, expenses, bank payments, transfers), each with its
  //    own ref_entity, and this check must not start failing when they land.
  //    A sale's cash leg lives inside its 'sale_invoice' entry, so that ref is
  //    included; manufacturing, melting and manual entries are excluded
  //    because their cash legs are cost, not payment.
  //
  //    A credit sale inserts a sales_payments row with method='credit' but
  //    debits 1200, never a cash account — so it is excluded from both sides.
  const payJournal = await db
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code IN ('1000','1010','1020')
         AND e.ref_entity IN ('sale_invoice','sale_return','purchase_payment','old_gold_purchase')
         AND e.entry_date = ?${b.sql}`
    )
    .bind(day, ...b.vals)
    .first<{ net: number }>();
  const siB = branchSql(opts.branchId, "si.branch_id");
  const salesPay = await db
    .prepare(
      `SELECT COALESCE(SUM(sp.amount_cents), 0) AS net FROM sales_payments sp
       JOIN sales_invoices si ON si.id = sp.invoice_id
       WHERE sp.method <> 'credit'
         AND date(sp.created_at / 1000, 'unixepoch', '+330 minutes') = ?${siB.sql}`
    )
    .bind(day, ...siB.vals)
    .first<{ net: number }>();
  const refunds = await db
    .prepare(
      `SELECT COALESCE(SUM(sr.refund_cents), 0) AS net FROM sales_returns sr
       JOIN sales_invoices si3 ON si3.id = sr.invoice_id
       WHERE sr.status = 'COMPLETE'
         AND date(sr.created_at / 1000, 'unixepoch', '+330 minutes') = ?${siB.sql}`
    )
    .bind(day, ...siB.vals)
    .first<{ net: number }>();
  const piB = branchSql(opts.branchId, "pi.branch_id");
  const purchPay = await db
    .prepare(
      `SELECT COALESCE(SUM(pp.amount_cents), 0) AS net FROM purchase_payments pp
       JOIN purchase_invoices pi ON pi.id = pp.invoice_id
       WHERE date(pp.created_at / 1000, 'unixepoch', '+330 minutes') = ?${piB.sql}`
    )
    .bind(day, ...piB.vals)
    .first<{ net: number }>();
  const ogB = branchSql(opts.branchId, "og.branch_id");
  const oldGoldPaid = await db
    .prepare(
      `SELECT COALESCE(SUM(og.paid_cents), 0) AS net FROM old_gold_purchases og
       WHERE date(og.created_at / 1000, 'unixepoch', '+330 minutes') = ?${ogB.sql}`
    )
    .bind(day, ...ogB.vals)
    .first<{ net: number }>();
  checks.push(
    compareMoney(
      "payments_crossfoot",
      "Payment-driven cash movement matches the payment records",
      n(salesPay?.net) - n(refunds?.net) + n(purchPay?.net) + n(oldGoldPaid?.net),
      n(payJournal?.net),
      "day"
    )
  );

  // 6. Customer ledgers agree with the receivables control account.
  const customerRows = await db
    .prepare(
      `SELECT l.party_id, COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS signed
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.account_code = '1200' AND l.party_type = 'customer' AND e.entry_date <= ?${b.sql}
       GROUP BY l.party_id HAVING signed < 0`
    )
    .bind(day, ...b.vals)
    .all<{ party_id: string; signed: number }>();
  checks.push(
    compareMoney(
      "party_ledgers",
      "Customer ledgers agree with the receivables control account",
      0,
      (customerRows ?? []).length,
      "cumulative",
      (customerRows ?? []).map((r) => `${r.party_id}: control shows ${r.signed}`)
    )
  );

  // 7. Gold ledger weights match the documents that produced them, for the
  //    day. Scoped to documents *posted* that day: gold rows are written at
  //    approval and finish, not at allocation.
  const glb = branchSql(opts.branchId, "l.branch_id");
  const goldRows = await db
    .prepare(
      `SELECT l.type, COALESCE(SUM(l.fine_mg), 0) AS fine_mg FROM gold_ledger l
       WHERE l.type IN ('PURCHASE','OLD_GOLD_PURCHASE','SALE','MELTING_INPUT','MELTING_OUTPUT',
                        'MANUFACTURING_INPUT','MANUFACTURING_OUTPUT','LOSS')
         AND date(l.occurred_at / 1000, 'unixepoch', '+330 minutes') = ?${glb.sql}
       GROUP BY l.type`
    )
    .bind(day, ...glb.vals)
    .all<{ type: string; fine_mg: number }>();
  const ledgerMg = new Map((goldRows ?? []).map((r) => [r.type, r.fine_mg]));
  const docMg: Record<string, number> = {
    PURCHASE: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(ii.net_mg * pu.permille / 1000), 0) AS fine_mg
             FROM purchase_invoice_items ii
             JOIN purities pu ON pu.id = ii.purity_id
             JOIN purchase_invoices pi ON pi.id = ii.invoice_id
             WHERE pi.status <> 'VOID'
               AND date(pi.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "pi.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "pi.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    OLD_GOLD_PURCHASE: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(fine_mg), 0) AS fine_mg FROM old_gold_items
             WHERE status = 'PURCHASED'
               AND date(created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    SALE: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(p.fine_gold_mg), 0) AS fine_mg FROM sales_items si
             JOIN products p ON p.id = si.product_id
             JOIN sales_invoices s2 ON s2.id = si.invoice_id
             WHERE s2.status <> 'VOID'
               AND date(s2.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "s2.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "s2.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    MELTING_INPUT: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(i.fine_mg), 0) AS fine_mg FROM melting_inputs i
             JOIN melting_batches b2 ON b2.id = i.batch_id
             WHERE b2.status = 'APPROVED'
               AND date(b2.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "b2.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "b2.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    MELTING_OUTPUT: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(o.fine_mg), 0) AS fine_mg FROM melting_outputs o
             JOIN melting_batches b2 ON b2.id = o.batch_id
             WHERE b2.status = 'APPROVED'
               AND date(b2.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "b2.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "b2.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    MANUFACTURING_INPUT: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(m.fine_mg), 0) AS fine_mg FROM manufacturing_materials m
             JOIN manufacturing_orders mo ON mo.id = m.order_id
             WHERE mo.status = 'COMPLETE'
               AND date(mo.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "mo.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "mo.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    MANUFACTURING_OUTPUT: n(
      (
        await db
          .prepare(
            `SELECT COALESCE(SUM(o2.net_mg * pu.permille / 1000), 0) AS fine_mg FROM manufacturing_outputs o2
             JOIN manufacturing_orders mo ON mo.id = o2.order_id
             JOIN purities pu ON pu.id = o2.purity_id
             WHERE mo.status = 'COMPLETE'
               AND date(mo.created_at / 1000, 'unixepoch', '+330 minutes') = ?${branchSql(opts.branchId, "mo.branch_id").sql}`
          )
          .bind(day, ...branchSql(opts.branchId, "mo.branch_id").vals)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
    LOSS: n(
      (
        await db
          .prepare(
            `SELECT
               COALESCE((SELECT SUM(loss_mg) FROM melting_batches b3
                         WHERE b3.status = 'APPROVED'
                           AND date(b3.created_at / 1000, 'unixepoch', '+330 minutes') = ?), 0)
             + COALESCE((SELECT SUM(loss_mg) FROM manufacturing_orders mo2
                         WHERE mo2.status = 'COMPLETE' AND mo2.loss_mg > 0
                           AND date(mo2.created_at / 1000, 'unixepoch', '+330 minutes') = ?), 0) AS fine_mg`
          )
          .bind(day, day)
          .first<{ fine_mg: number }>()
      )?.fine_mg
    ),
  };
  for (const [type, documentMg] of Object.entries(docMg)) {
    checks.push(
      compareWeight(
        `gold_${type.toLowerCase()}`,
        `Gold ledger ${type} matches its documents`,
        ledgerMg.get(type) ?? 0,
        documentMg
      )
    );
  }

  // 8. Cumulative gold weight equals everything physically held.
  const total = await db
    .prepare(
      `SELECT COALESCE(SUM(fine_mg), 0) AS fine_mg FROM gold_ledger WHERE 1 = 1${branchSql(opts.branchId, "branch_id").sql}`
    )
    .bind(...branchSql(opts.branchId, "branch_id").vals)
    .first<{ fine_mg: number }>();
  checks.push(
    compareWeight(
      "gold_stock_consistency",
      "Gold ledger weight equals stock on hand",
      n(total?.fine_mg),
      await heldGoldMg(db, opts.branchId)
    )
  );

  return { date: day, passed: checks.every((c) => c.pass), checks };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pnpm exec vitest run 2>&1 | tail -20`
Expected: all suites PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter goldos-api exec tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/reconcile.ts apps/api/src/services/reconcile.test.ts
git commit -m "feat: eight cross-foot reconciliation checks"
```

---

### Task 15: Reconciliation endpoint

**Files:**
- Modify: `apps/api/src/routes/accounts.ts`

**Interfaces:**
- Consumes: `reconcile(db, opts)` (Task 14); `businessDateFor` (foundation plan).
- Produces: `GET /api/v1/accounts/reconciliation?date&branchId` under `accounts:view`.

- [ ] **Step 1: Add the route**

In `apps/api/src/routes/accounts.ts`, add `import { reconcile } from "../services/reconcile";` and insert this handler into the chain immediately after the `.get("/trial-balance", ...)` handler, so the literal path is registered before any `/:code` handler:

```ts
  .get("/reconciliation", requirePerm(PERMISSIONS.ACCOUNTS_VIEW), async (c) => {
    try {
      const date = c.req.query("date") ?? (await businessDateFor(c.env.DB, Date.now()));
      const data = await reconcile(c.env.DB, {
        date,
        branchId: c.req.query("branchId") ?? undefined,
      });
      return c.json({ success: true, data }, 200);
    } catch (err) {
      return serviceError(c, err);
    }
  })
```

A failing check is a **200 with `passed: false`**, not an error: the caller
needs the full report to show the operator what is out, and the follow-on
daily-closing spec decides whether that is fatal.

- [ ] **Step 2: Verify the route order**

Run: `grep -n '\.get("/\|\.post("/\|\.patch("/' apps/api/src/routes/accounts.ts`
Expected order: `/`, `/journal`, `/journal/:id`, `/trial-balance`,
`/reconciliation`, `/:code/statement`, `/:code`, `/:code/status`.

- [ ] **Step 3: Typecheck and test**

Run: `pnpm --filter goldos-api exec tsc --noEmit && cd apps/api && pnpm exec vitest run 2>&1 | tail -10`
Expected: no typecheck output, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/accounts.ts
git commit -m "feat: reconciliation endpoint"
```

---

### Task 16: Documentation

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/api.md`
- Modify: `docs/gold-accounting.md`
- Modify: `docs/permissions.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation matching the shipped system. No code changes.

- [ ] **Step 1: Update `docs/database.md`**

In the "Accounting foundation (0008_ledger)" section, rewrite it to describe
`0015_ledger_core` (the header/lines split, `is_system`, `description`, the 24
accounts) and add a new section for `0016_ledger_backfill` and
`0017_drop_opening_balance`. Move `opening_balance_cents` from the party tables
into the "Later-phase reservations" list, noting it was retired rather than
deferred.

Add the new columns to their tables' column lists: `journal_entry_id` on the
four document tables, `input_cost_cents` on `melting_batches`, `cost_cents` on
`melting_outputs`, and the `JE`/`GADJ` counters.

- [ ] **Step 2: Update `docs/api.md`**

Add rows for the new endpoints, each with its permission:

| Method | Path | Permission |
|---|---|---|
| POST | `/api/v1/accounts` | `accounts:manage` |
| PATCH | `/api/v1/accounts/:code` | `accounts:manage` |
| PATCH | `/api/v1/accounts/:code/status` | `accounts:manage` |
| GET | `/api/v1/accounts/journal` | `accounts:view` |
| GET | `/api/v1/accounts/journal/:id` | `accounts:view` |
| GET | `/api/v1/accounts/trial-balance` | `accounts:view` |
| GET | `/api/v1/accounts/reconciliation` | `accounts:view` |
| GET | `/api/v1/accounts/:code/statement` | `accounts:view` |
| POST | `/api/v1/accounts/journal/reverse` | `accounts:manage` |

Note in the entry for `POST /accounts/adjustments` that it now returns
`entryId` and `entryNo` and accepts an optional `entryDate`.

- [ ] **Step 3: Update `docs/gold-accounting.md`**

Add a "Book cost chain" section showing the trace
`old_gold_items.purchase_value_cents → melting_outputs.cost_cents →
manufacturing_outputs.cost_cents → products.cost_cents → sales_items.cost_cents`,
and a "Loss accounts" section listing 5100 (melting), 5200 (manufacturing), and
5300 (net gold variance), with the note that an unrated adjustment is refused.

Change the "Dual ledgers" section to state plainly that money reconciles in
cents and gold reconciles in fine milligrams, and that no daily revaluation
happens.

- [ ] **Step 4: Update `docs/permissions.md`**

The permission count is unchanged at 53. Add a line recording that no
permission was added by the ledger core work, and that `accounts:manage` now
covers chart CRUD and reversal in addition to adjustments.

- [ ] **Step 5: Commit**

```bash
git add docs/database.md docs/api.md docs/gold-accounting.md docs/permissions.md
git commit -m "docs: ledger core — journal shape, endpoints, book cost chain"
```

---

## Live verification

Run after Task 16. `wrangler dev` serves the API on 8787.

1. Melting: create a batch from old gold bought for LKR 400,000, melt to
   10,000 mg fine from 10,200 mg in with 100 mg loss, and approve. Account 5100
   is debited 396,039 cents, `melting_batches.input_cost_cents` is 40,000,000,
   and `melting_outputs.cost_cents` is 39,603,961.
2. Manufacturing: allocate 6,000 mg of that lot, finish with labour 30,000 and
   making 20,000 and one output of 5,950 mg fine. Account 2200 is credited
   5,000,000, 5200 is debited 197,720, and the product's `cost_cents` is
   28,564,657 — not its market value at the day's rate.
3. Repeat step 2 with `paidFrom: "bank"` on a second order. 1010 is credited
   instead of 2200, and 2200 is unchanged.
4. Gold adjustment: record a 5 g LOSS at 22K. 5300 is debited by
   `goldValueCents(fineGoldMg(5000, 916), rate)`. Record a 2 g RECOVERY; 5300 is
   credited. Try an adjustment on a purity with no rate — expect `400
   VALIDATION` with the "cannot value" message.
5. Shop-local window: between 19:00 and 24:00 Colombo time, post a sale, then
   `GET /api/v1/sales/reports/summary?period=today`. It appears in **today**,
   not tomorrow.
6. `GET /api/v1/accounts/reconciliation?date=<today>` returns `passed: true` on
   a clean database.
7. Re-run it after a day with every flow exercised: a cash sale, a card sale, a
   credit sale, a sale return, a purchase with a payment, an old-gold purchase,
   a melt with loss, a manufacturing finish, an adjustment. All checks pass.
8. Deliberately break one: `POST /accounts/adjustments` a single unbalanced
   amount… it is rejected, so instead void a purchase invoice twice — the second
   void returns `409`, and `purchases_crossfoot` still passes because the
   reversal is linked rather than orphaned.

## Spec coverage

- Spec §3.4 melting loss valuation and lot cost → Task 10
- Spec §3.5 manufacturing book cost, labour accrual, `paidFrom` → Task 11
- Spec §3.6 gold adjustment valuation, 5300 netting, `GADJ` numbering → Task 12
- Spec §3.7 the book-cost chain, complete and each link already book cost → Tasks 10, 11 and the docs in Task 16
- Spec §2.2 report windows agreeing with `entry_date` → Task 13
- Spec §5 all eight checks, with the check-7 day scoping and the check-8 booked-only old gold → Task 14
- Spec §4 the reconciliation endpoint's response shape → Task 15
- Spec §8 Vitest coverage and the live gate → Task 14 plus the live verification above
- Spec §6 `closingCash` / `cashDifference` → written and tested in the foundation plan, consumed by the follow-on daily-closing spec

## Self-Review

- **Spec coverage:** every §2.2, §3.4-§3.7, §4, §5, and §8 item maps to a task
  above. §1 and §6 are covered by the foundation plan and named here.
- **Placeholder scan:** every step carries real code or a real command with its
  expected output. No "similar to Task N", no "add error handling".
- **Type consistency:** `compareMoney` and `compareWeight` are used with the same
  signatures in the test and in `reconcile`. `reconcile(db, { date, branchId? })`
  matches the route call. `heldGoldMg(db, branchId?)` matches both call sites.
  `finishOrder`'s new four-argument form is written the same way in the service
  signature and in the route call.
- **Known wrinkles, stated inline:** `sales_returns` has no total column, so
  check 3 sums `refund_cents + credit_cents` (mutually exclusive, one is always
  zero) and uses scalar sub-selects rather than a `LEFT JOIN`, which would
  double an invoice total if a second return were ever raised against it. Check
  5 aggregates sales and purchase payments separately and adds them in JS,
  because the two tables have unrelated grains and a join would cross-product.
  Check 7's document queries are scoped to documents *posted* that day because
  gold rows are written at approval and finish, not at allocation — scoping to
  creation would fail every melt and every manufactured order. Check 8 counts
  only *booked* old gold: an item in `RECEIVED`, `TESTED`, or `VALUED` is in the
  shop but has no journal and no ledger row, so including it would make the
  check fail permanently.
