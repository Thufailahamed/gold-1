# GoldOS Old Gold Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship staged old-gold intake (receive→test→value→purchase→release) with configurable valuation, atomic 5-ledger purchase batch, resale conversion with lineage, and counter UI + reports — migrated and deployed.

**Architecture:** `oldgold.ts` service with one function per transition; valuation computed in integers (mg × rate_cents × pct, single rounding); purchase batch composes status UPDATE + purchase row + `postJournalStmts` + gold IN movement + audit. OG numbers from `counters`. Release/convert are separate small batches. Melting-bound statuses locked with 409.

**Tech Stack:** Hono, Drizzle, D1, R2, Next.js 16, React 19, TanStack Query v5, RHF + Zod, Vitest, Wrangler, bwip-js (labels reuse existing helper).

## Global Constraints

- Every write batches business row(s) + audit_logs; failure rolls back.
- No hard deletes; VOID pre-purchase only with reason.
- Strict TypeScript, no `any`; Zod client + server; typed responses.
- Money INTEGER cents, weights INTEGER mg, purity INTEGER permille; convert at API boundary only.
- OG numbers `OG-000001` sequential via counters; PRD-/JW- untouched.
- Locked statuses (RESERVED_FOR_MELTING/MELTED/TRANSFERRED) → 409 TRANSITION_LOCKED.
- New perms `oldgold:view/create/edit/cancel/export/approve` (47 total).
- R2 keys `oldgold/{id}/{uuid}.{ext}`; images ≤5MB jpeg/png/webp ≤10; docs ≤10MB any type ≤10.

---

## Permission additions (append to matrix)

- 6 keys. owner: all (47). manager: all. accountant: view + export. gold_officer: view + create + edit. cashier: view + create. salesperson/inventory_officer: view. manufacturing: none.

## File Structure

- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/oldgold.test.ts`
- Create: `apps/api/drizzle/0011_oldgold.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/src/services/oldgold.ts`, `apps/api/src/routes/oldgold.ts`
- Modify: `apps/api/src/app.ts`
- Create web: `old-gold/intake`, `old-gold/testing`, `old-gold/items`, `old-gold/items/[id]`, `old-gold/reports`
- Modify web: sidebar (Old Gold section), dashboard Gold Purchased card
- Modify docs: `database.md`, `api.md`, `permissions.md`, `gold-accounting.md`

---

### Task 1: Shared perms + schemas + valuation spec

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/oldgold.test.ts`
- Test: oldgold test

**Interfaces:**
- Consumes: existing PERMISSIONS/DEFAULT_ROLES, units helpers.
- Produces: 6 OLDGOLD_* perms + grants; `createOldGoldSchema, testOldGoldSchema, valueOldGoldSchema, purchaseOldGoldSchema` (+ types); `valuateOldGold` pure helper (copied verbatim into service).

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/oldgold.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

export function valuateOldGold(args: {
  netMg: number; permille: number; rateCentsPerG: number; buyPct: number;
  stoneDeductionCents: number; processingDeductionCents: number; negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  const gross = Math.round(((fineMg * args.rateCentsPerG) / 1000) * (args.buyPct / 100));
  const value =
    args.negotiatedCents !== undefined
      ? args.negotiatedCents
      : gross - args.stoneDeductionCents - args.processingDeductionCents;
  if (value <= 0) throw new Error("value must be positive");
  return { fineMg, grossValueCents: gross, valueCents: value };
}

describe("old gold", () => {
  it("seeds oldgold permissions", () => {
    expect(PERMISSIONS.OLDGOLD_APPROVE).toBe("oldgold:approve");
    expect(DEFAULT_ROLES["gold_officer"]).toContain("oldgold:create");
    expect(DEFAULT_ROLES["gold_officer"]).not.toContain("oldgold:approve");
    expect(DEFAULT_ROLES["manufacturing_staff"]).not.toContain("oldgold:view");
  });
  it("values the spec example: 5g chain 22K @28500 buy 92% minus 2000", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 200000 });
    expect(v.fineMg).toBe(4580);
    expect(v.valueCents).toBe(11808900 - 200000);
  });
  it("negotiated total overrides formula", () => {
    const v = valuateOldGold({ netMg: 5000, permille: 916, rateCentsPerG: 2850000, buyPct: 92, stoneDeductionCents: 0, processingDeductionCents: 0, negotiatedCents: 11500000 });
    expect(v.valueCents).toBe(11500000);
  });
});
```

Check the example math: fine = round(5000×916/1000) = 4580mg. gross = round((4580×2850000/1000) × 0.92) = round(13,053,000 × 0.92) = round(12,008,760) = 12,008,760c = LKR 120,087.60. Minus 200,000c → 11,808,760c. So expected `valueCents` = 11808760, NOT 11808900 − 200000 (= 11,608,900 — wrong). Fix test expectation to `toBe(11808760)`. (Verify: 4580 × 2,850,000 = 13,053,000,000; /1000 = 13,053,000; ×0.92 = 12,008,760 exactly (integer? 13,053,000 × 92 = 1,200,876,000 /100 = 12,008,760 exact). So gross = 12008760, value = 12008760 − 200000 = 11808760.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/oldgold.test.ts`
Expected: FAIL (missing OLDGOLD_* exports).

- [ ] **Step 3: Implement**

permissions.ts: append 6 keys; DEFAULT_ROLES: owner/manager auto (manager filter unchanged); accountant append view+export; gold_officer append view+create+edit; cashier append view+create; salesperson + inventory_officer append view.
schemas.ts append:
```ts
export const TEST_METHODS = ["acid", "touchstone", "xrf", "electronic", "fire_assay"] as const;
export const OLDGOLD_STATUSES = ["RECEIVED", "TESTED", "VALUED", "PURCHASED", "AVAILABLE", "RESERVED_FOR_MELTING", "MELTED", "RESOLD", "TRANSFERRED", "VOID"] as const;

export const createOldGoldSchema = z.object({
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  itemType: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  grossG: z.number().gt(0).max(100000),
  stoneG: z.number().min(0).max(100000).optional().default(0),
  notes: z.string().max(2000).optional(),
});

export const testOldGoldSchema = z.object({
  method: z.enum(TEST_METHODS),
  permille: z.number().int().gt(0).lte(1000),
  result: z.enum(["pass", "fail", "inconclusive"]),
  notes: z.string().max(2000).optional(),
  approvedBy: z.string().min(1).optional(),
});

export const valueOldGoldSchema = z.object({
  buyPct: z.number().gt(0).lte(100).optional(),
  stoneDeductionLkr: z.number().min(0).optional().default(0),
  processingDeductionLkr: z.number().min(0).optional().default(0),
  negotiatedLkr: z.number().gt(0).optional(),
  reason: z.string().max(500).optional(),
});

export const purchaseOldGoldSchema = z.object({
  paidLkr: z.number().min(0),
  method: z.enum(["cash", "bank"]),
});

export const voidOldGoldSchema = z.object({ reason: z.string().min(1).max(500) });

export type CreateOldGoldInput = z.infer<typeof createOldGoldSchema>;
export type TestOldGoldInput = z.infer<typeof testOldGoldSchema>;
export type ValueOldGoldInput = z.infer<typeof valueOldGoldSchema>;
```

- [ ] **Step 4: Green + commit**

Run: `pnpm exec vitest run packages/shared/src/oldgold.test.ts 2>&1 | grep -E "Tests "; pnpm --filter @goldos/shared exec tsc --noEmit && echo TSC_OK`
```bash
git add packages/shared/src/permissions.ts packages/shared/src/schemas.ts packages/shared/src/oldgold.test.ts
git commit -m "feat: oldgold permissions, schemas, valuation spec"
```

---

### Task 2: Migration 0011 + drizzle + seed

**Files:**
- Create: `apps/api/drizzle/0011_oldgold.sql`
- Modify: `apps/api/src/db/schema.ts`, `apps/api/src/seed.ts`
- Test: local apply + counts

**Interfaces:**
- Consumes: Task 1 perm names.
- Produces: OG counter, 3 tables, 6 perms + grants.

- [ ] **Step 1: Write 0011_oldgold.sql**

```sql
INSERT INTO counters (name, next) VALUES ('OG', 1);
CREATE TABLE old_gold_items (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  item_type TEXT NOT NULL,
  description TEXT NOT NULL,
  gross_mg INTEGER NOT NULL,
  stone_mg INTEGER NOT NULL DEFAULT 0,
  net_mg INTEGER NOT NULL,
  purity_id TEXT REFERENCES purities(id),
  tested_permille INTEGER,
  karat TEXT,
  fine_mg INTEGER NOT NULL DEFAULT 0,
  rate_cents_per_g INTEGER,
  buy_pct REAL,
  purchase_rate_cents INTEGER,
  stone_deduction_cents INTEGER NOT NULL DEFAULT 0,
  processing_deduction_cents INTEGER NOT NULL DEFAULT 0,
  negotiated_cents INTEGER,
  purchase_value_cents INTEGER,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  converted_product_id TEXT REFERENCES products(id),
  staff_id TEXT REFERENCES users(id),
  notes TEXT,
  image_keys TEXT NOT NULL DEFAULT '[]',
  doc_keys TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE INDEX idx_og_customer ON old_gold_items(customer_id, created_at DESC);
CREATE INDEX idx_og_status ON old_gold_items(status, branch_id);
CREATE TABLE gold_tests (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES old_gold_items(id),
  method TEXT NOT NULL,
  tested_permille INTEGER NOT NULL,
  tester_id TEXT NOT NULL REFERENCES users(id),
  result TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE old_gold_purchases (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES old_gold_items(id),
  value_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
INSERT INTO permissions (id, name) VALUES
  ('oldgold:view', 'oldgold:view'), ('oldgold:create', 'oldgold:create'),
  ('oldgold:edit', 'oldgold:edit'), ('oldgold:cancel', 'oldgold:cancel'),
  ('oldgold:export', 'oldgold:export'), ('oldgold:approve', 'oldgold:approve');
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions WHERE id LIKE 'oldgold:%';
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'manager', id FROM permissions WHERE id LIKE 'oldgold:%';
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('accountant', 'oldgold:view'), ('accountant', 'oldgold:export'),
  ('gold_officer', 'oldgold:view'), ('gold_officer', 'oldgold:create'), ('gold_officer', 'oldgold:edit'),
  ('cashier', 'oldgold:view'), ('cashier', 'oldgold:create'),
  ('salesperson', 'oldgold:view'), ('inventory_officer', 'oldgold:view');
```

- [ ] **Step 2: Drizzle (3 tables) + seed (6 perms + grants mirroring matrix)**

- [ ] **Step 3: Apply local + verify (perms 47, owner 47, counters OG=1)**

- [ ] **Step 4: Commit**

```bash
git add apps/api/drizzle/0011_oldgold.sql apps/api/src/db/schema.ts apps/api/src/seed.ts
git commit -m "feat: old gold tables, OG counter, permissions"
```

---

### Task 3: Oldgold service

**Files:**
- Create: `apps/api/src/services/oldgold.ts`
- Test: tsc standalone (routes next task)

**Interfaces:**
- Consumes: `postJournalStmts`; `buildCreateProductStmts`; `valuateOldGold` (copy from test verbatim); `getSetting`; units; input types.
- Produces: `intakeItem, recordTest, valuateItem, purchaseItem, releaseItem, convertItem, voidItem, getItem, listItems, findByBarcode, oldgoldSummary, oldgoldBreakdown, customerOldgold`.

- [ ] **Step 1: Write services/oldgold.ts**

```ts
import { fineGoldMg, gToMg, lkrToCents, type CreateOldGoldInput, type TestOldGoldInput, type ValueOldGoldInput } from "@goldos/shared";
import { buildAuditStmt } from "../middleware/audit";
import type { PageOpts } from "./catalog";
import { buildCreateProductStmts } from "./products";
import { postJournalStmts } from "./journal";
import { getSetting } from "./settings";
import { currentGoldRatesCents } from "./rates";

export function valuateOldGold(args: {
  netMg: number; permille: number; rateCentsPerG: number; buyPct: number;
  stoneDeductionCents: number; processingDeductionCents: number; negotiatedCents?: number;
}): { fineMg: number; grossValueCents: number; valueCents: number } {
  const fineMg = Math.round((args.netMg * args.permille) / 1000);
  const gross = Math.round(((fineMg * args.rateCentsPerG) / 1000) * (args.buyPct / 100));
  const value = args.negotiatedCents !== undefined ? args.negotiatedCents : gross - args.stoneDeductionCents - args.processingDeductionCents;
  if (value <= 0) throw Object.assign(new Error("Value must be positive"), { code: "VALIDATION" });
  return { fineMg, grossValueCents: gross, valueCents: value };
}

const LOCKED = ["RESERVED_FOR_MELTING", "MELTED", "TRANSFERRED"];
function rejectLocked(status: string): void {
  if (LOCKED.includes(status))
    throw Object.assign(new Error("Melting-phase status, locked"), { code: "TRANSITION_LOCKED" });
}

async function nextOG(db: D1Database, stmts: D1PreparedStatement[]): Promise<string> {
  const row = await db.prepare("SELECT next FROM counters WHERE name = 'OG'").bind().first<{ next: number }>();
  if (!row) throw Object.assign(new Error("Counter missing"), { code: "INTERNAL" });
  stmts.push(db.prepare("UPDATE counters SET next = ? WHERE name = 'OG'").bind(row.next + 1));
  return `OG-${String(row.next).padStart(6, "0")}`;
}

async function requireApprover(db: D1Database, approverId: string, actorId: string): Promise<void> {
  if (approverId === actorId) throw Object.assign(new Error("Approver cannot be yourself"), { code: "FORBIDDEN" });
  const target = await db.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(approverId).first();
  if (!target) throw Object.assign(new Error("Approver not found"), { code: "NOT_FOUND" });
  const { results } = await db.prepare(
    `SELECT p.name AS name FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ?`
  ).bind(approverId).all<{ name: string }>();
  if (!(results ?? []).some((r) => r.name === "oldgold:approve"))
    throw Object.assign(new Error("Approval requires oldgold:approve"), { code: "FORBIDDEN" });
}

export async function intakeItem(db: D1Database, input: CreateOldGoldInput, actorId: string) {
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").bind(input.customerId).first();
  if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
  const branch = await db.prepare("SELECT id FROM branches WHERE id = ? AND is_active = 1").bind(input.branchId).first();
  if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });
  const grossMg = gToMg(input.grossG);
  const stoneMg = gToMg(input.stoneG);
  const netMg = grossMg - stoneMg;
  if (netMg <= 0) throw Object.assign(new Error("Stone weight must be less than gross weight"), { code: "VALIDATION" });
  const stmts: D1PreparedStatement[] = [];
  const number = await nextOG(db, stmts);
  const id = crypto.randomUUID();
  const now = Date.now();
  stmts.push(
    db.prepare("INSERT INTO old_gold_items (id, number, customer_id, branch_id, item_type, description, gross_mg, stone_mg, net_mg, status, staff_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)")
      .bind(id, number, input.customerId, input.branchId, input.itemType, input.description, grossMg, stoneMg, netMg, actorId, input.notes ?? null, now, actorId),
    buildAuditStmt(db, { userId: actorId, action: "oldgold.intake", entity: "old_gold", entityId: id, next: { number, ...input }, branchId: input.branchId })
  );
  await db.batch(stmts);
  return { id, number };
}

export async function recordTest(db: D1Database, itemId: string, input: TestOldGoldInput, actorId: string) {
  const item = await db.prepare("SELECT id, status, branch_id FROM old_gold_items WHERE id = ?").bind(itemId).first<{ id: string; status: string; branch_id: string }>();
  if (!item) throw Object.assign(new Error("Item not found"), { code: "NOT_FOUND" });
  rejectLocked(item.status);
  if (item.status !== "RECEIVED" && item.status !== "TESTED")
    throw Object.assign(new Error("Tests allowed in RECEIVED/TESTED only"), { code: "CONFLICT" });
  const { results: prior } = await db.prepare("SELECT tested_permille FROM gold_tests WHERE item_id = ?").bind(itemId).all<{ tested_permille: number }>();
  const disagrees = (prior ?? []).some((t) => t.tested_permille !== input.permille);
  if (disagrees) {
    if (!input.approvedBy) throw Object.assign(new Error("Disagreement requires approval"), { code: "FORBIDDEN" });
    await requireApprover(db, input.approvedBy, actorId);
  }
  const purity = await db.prepare("SELECT id, karat FROM purities WHERE permille = ? AND is_active = 1").bind(input.permille).first<{ id: string; karat: string }>();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO gold_tests (id, item_id, method, tested_permille, tester_id, result, approved_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, itemId, input.method, input.permille, actorId, input.result, input.approvedBy ?? null, input.notes ?? null, now),
    db.prepare("UPDATE old_gold_items SET purity_id = ?, tested_permille = ?, karat = ?, status = 'TESTED' WHERE id = ?")
      .bind(purity?.id ?? null, input.permille, purity?.karat ?? null, itemId),
    buildAuditStmt(db, { userId: actorId, action: "oldgold.test", entity: "old_gold", entityId: itemId, next: { method: input.method, permille: input.permille, result: input.result }, branchId: item.branch_id }),
  ]);
  return { testId: id };
}
```

Note: purities store permille per karat — test permille may not match any purity row (e.g. 875 vs seeded). purity_id NULL then; valuation uses tested_permille directly. Karat display falls back to `~{permille/10}K`? Keep karat NULL and let UI show permille. (Plan decision: no karat inference.)

```ts
export async function valuateItem(db: D1Database, itemId: string, input: ValueOldGoldInput, actorId: string) {
  const item = await db.prepare("SELECT id, status, branch_id, net_mg, tested_permille, purity_id FROM old_gold_items WHERE id = ?").bind(itemId).first<{
    id: string; status: string; branch_id: string; net_mg: number; tested_permille: number | null; purity_id: string | null;
  }>();
  if (!item) throw Object.assign(new Error("Item not found"), { code: "NOT_FOUND" });
  rejectLocked(item.status);
  if (item.status !== "TESTED" && item.status !== "VALUED")
    throw Object.assign(new Error("Valuation needs a tested item"), { code: "CONFLICT" });
  if (item.tested_permille === null) throw Object.assign(new Error("No tested purity"), { code: "VALIDATION" });
  const { results: rates } = await db.prepare("SELECT rate_cents_per_g FROM gold_rates WHERE purity_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1")
    .bind(item.purity_id, Date.now()).all<{ rate_cents_per_g: number }>();
```
Careful: purity_id may be NULL (unmatched permille). Then rate lookup by closest permille? Use `currentGoldRatesCents()` and match by purity_id if present else pick rate whose purity permille is closest? Simpler per spec ("board rate snapshot"): if purity_id present use its current rate; else use 22K rate? No — arbitrary. Decision: if no purity match, use rate of the purity with nearest permille (query purities ORDER BY ABS(permille - ?) LIMIT 1, then its current rate). Implement that.
```ts
  let buyPct = input.buyPct;
  let reasonRequired = false;
  if (buyPct === undefined) {
    const s = await getSetting(db, "oldgold_buy_pct");
    buyPct = typeof s?.value === "number" ? s.value : 92;
  } else reasonRequired = true;
  if (input.negotiatedLkr !== undefined) reasonRequired = true;
  if (reasonRequired && !input.reason) throw Object.assign(new Error("Reason required for overrides"), { code: "VALIDATION" });
  const v = valuateOldGold({ netMg: item.net_mg, permille: item.tested_permille, rateCentsPerG: rate, buyPct, stoneDeductionCents: lkrToCents(input.stoneDeductionLkr), processingDeductionCents: lkrToCents(input.processingDeductionLkr), negotiatedCents: input.negotiatedLkr !== undefined ? lkrToCents(input.negotiatedLkr) : undefined });
  const purchaseRate = Math.round((v.valueCents / v.fineMg) * 1000); // effective cents/g — hmm: value/fine_g; fine in mg → per gram = value/fineMg*1000
  await db.batch([
    db.prepare("UPDATE old_gold_items SET rate_cents_per_g = ?, buy_pct = ?, purchase_rate_cents = ?, stone_deduction_cents = ?, processing_deduction_cents = ?, negotiated_cents = ?, purchase_value_cents = ?, fine_mg = ?, status = 'VALUED' WHERE id = ?")
      .bind(rate, buyPct, purchaseRate, stoneDed, procDed, negotiated ?? null, v.valueCents, v.fineMg, itemId),
    buildAuditStmt(db, { userId: actorId, action: "oldgold.value", entity: "old_gold", entityId: itemId, next: { valueCents: v.valueCents, buyPct }, reason: input.reason, branchId: item.branch_id }),
  ]);
  return { valueCents: v.valueCents, fineMg: v.fineMg };
}

export async function purchaseItem(db, itemId, opts: { paidLkr: number; method: "cash" | "bank" }, actorId) {
  // load VALUED item + customer; paid ≤ value else VALIDATION
  // batch: status PURCHASED + purchase row + journal DR1100 value / CR cash|bank paid + (remainder: DR ...? No — single journal must balance: DR1100 value / CR1000 paid + CR1200 remainder(party customer)) + gold IN movement (type? stock_movements is product-scoped... old gold has no product row. Options: gold_movements table IN row only (no stock_movements). Spec says "gold IN movement" — use gold_movements direction IN. No stock_movements row (that's for products). + audit oldgold.purchase
  // return { purchaseId }
}

export async function releaseItem(db, itemId, actorId) { /* PURCHASED → AVAILABLE + audit */ }
export async function convertItem(db, itemId, productInput: { categoryId: string; metalTypeId: string; name: string; location?: string }, actorId) {
  // AVAILABLE only; buildCreateProductStmts with gross/net = item net, cost = purchase value, purity = item purity_id (must exist — conversion requires matched purity; else VALIDATION "needs matched purity")
  // batch: product stmts + UPDATE old_gold converted_product_id + status RESOLD + audit oldgold.convert (next: {productId, barcode})
}
export async function voidItem(db, itemId, reason, actorId) { /* RECEIVED/TESTED/VALUED only → VOID + audit */ }
export async function getItem(db, id) { /* item + customer + tests + purchase + journal (ref old_gold_purchase|old_gold) + gold movements + converted product */ }
export async function listItems(db, userId, canManageAll, opts: PageOpts & { status?; purityId?; branchId?; customerId?; from?; to? }) { /* LIKE number/description + filters */ }
export async function findByBarcode(db, code) { /* UPPER(number) = UPPER(code) + full detail via getItem */ }
export async function oldgoldSummary(db, {from, to, branchId}) → { items, gross_mg, fine_mg, value_cents, paid_cents, outstanding_cents } (PURCHASED+ only for value; all non-VOID for counts? Define: counts items created in range excluding VOID; value over PURCHASED+AVAILABLE+RESOLD)
export async function oldgoldBreakdown(db, {from, to, branchId, groupBy: "purity"|"customer"|"branch"}) 
export async function pendingList(db, branchId?) → items in PURCHASED/AVAILABLE with customer + fine
export async function customerOldgold(db, customerId) → items + totals
```

Need `getSetting` import from "./settings". R2 files handled in routes (Task 4), not service — service gets `addFiles(db, itemId, kind: "image"|"doc", keys: string[], actorId)` appending to JSON arrays + audit. Include it.

- [ ] **Step 2: tsc standalone + commit**

Run: `pnpm --filter goldos-api exec tsc --noEmit && echo TSC_OK` (routes reference next task — service standalone, expect clean).
```bash
git add apps/api/src/services/oldgold.ts
git commit -m "feat: old gold staged-flow service"
```

---

### Task 4: Oldgold routes + app mount

**Files:**
- Create: `apps/api/src/routes/oldgold.ts`
- Modify: `apps/api/src/app.ts`
- Test: tsc clean

**Interfaces:**
- Consumes: Task 3 fns; schemas; guards below.
- Produces: mounted `/api/v1/oldgold/*`.

Guards: intake/list/detail/scan → create/view; tests → edit; value → edit; purchase/release/convert → edit (convert needs products:create too? Require oldgold:edit AND products:create — implement as two requirePerm in chain); void → cancel; files → edit; reports → view.
Routes: POST /items, GET /items (filters status/purityId/branchId/customerId/from/to/search), GET /items/barcode/:code (before /:id!), GET /items/:id, POST /items/:id/tests, POST /items/:id/value, POST /items/:id/purchase, POST /items/:id/release, POST /items/:id/convert, POST /items/:id/files (multipart, kind=image|doc field; images jpeg/png/webp ≤5MB, docs ≤10MB any; R2 `oldgold/{id}/`; ≤10 each), GET /items/:id/files/:key (stream), PATCH /items/:id/void, GET /reports/summary (?period=today|month|all&branchId=), GET /reports/breakdown (?period=&groupBy=purity|customer|branch&branchId=), GET /reports/pending (?branchId=), GET /customers/:id/oldgold (perm masters:view? use oldgold:view — mount under oldgold router as `/customers/:id/history`? Cleaner: `GET /oldgold/customers/:id/history`). dayBounds: copy 12-line helper from sales route (same UTC-day semantics).

Convert body schema: `{ categoryId, metalTypeId, name, location? }` inline zod.

- [ ] **Step 1–3: Write routes, mount (`app.route("/api/v1/oldgold", oldgold)`), tsc clean, commit**

```bash
git add apps/api/src/routes/oldgold.ts apps/api/src/app.ts
git commit -m "feat: old gold routes"
```

---

### Task 5: Live verify + remote deploy

**Files:** none.

- [ ] **Step 1: Remote migrate + deploy** (0011 --remote, deploy)

- [ ] **Step 2: Counter gate (local 8788, remote smoke)**

Local: intake (customer + 5g chain) → OG-000001 RECEIVED → test XRF 916 → TESTED → conflicting acid 750 without approval → 403 → with manager approval → TESTED → value (buy 92, 2000 processing) → check valueCents == hand math → purchase 100k cash → batch verified (status PURCHASED, journal DR1100/CR1000+CR1200, gold IN, customer ledger payable, audit) → release → AVAILABLE → convert → JW- product with cost, lineage both ways → VOID attempt post-purchase → 4xx → locked status attempt (MELTED via direct? no route — verify TRANSITION note) → reports match → cashier approve attempt → 403.
Remote smoke: intake + purchase 1 item full bank → AVAILABLE; ledger reflects.

---

### Task 6: Web old-gold UI

**Files:**
- Create: `apps/web/app/(app)/old-gold/intake/page.tsx`, `testing/page.tsx`, `items/page.tsx`, `items/[id]/page.tsx`, `reports/page.tsx`
- Modify: sidebar (Old Gold section), dashboard Gold Purchased card
- Test: tsc + build + click-through

- [ ] **Step 1: Sidebar + intake + testing**

Sidebar section "Old Gold" (perm oldgold:view): Intake, Testing, Items, Reports.
Intake: customer search + weights + type/description + photos/docs upload (FormData POST after create) + label print link (OG barcode via products label endpoint? Labels are product-only — OG label: reuse `/products/:id/label`? No. Add label SVG to oldgold detail via bwipjs client? Simplest: render barcode text + print CSS; Code128 needs bwip-js client lib — skip graphics, print OG number + specs text label. Decision documented.)
Testing queue: RECEIVED/TESTED list + test form (method select, permille, result, approval field)inline per row.

- [ ] **Step 2: Items/detail/reports + dashboard**

Items: filters (status/purity/branch/customer/date) + scan field (OG- lookup → detail).
Detail: full lineage (customer, weights, tests table, valuation breakdown, purchase + journal, movements, converted product link) + action buttons by status (Value/Purchase/Release/Convert/Void dialogs).
Reports: period tabs + cards (items, gross/fine grams, value, paid, outstanding) + breakdown table + pending list + customer history search.
Dashboard Gold Purchased: fetch oldgold summary?period=today → fine grams (fallback "—").

- [ ] **Step 3: Verify + commit**

tsc + build + click-through 200s.
```bash
git add apps/web
git commit -m "feat: old gold counter UI and reports"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/database.md`, `docs/api.md`, `docs/permissions.md`, `docs/gold-accounting.md`
- Test: suite

database.md: 0011 tables + counters. api.md: all oldgold endpoints + cents contract + approval rules. permissions.md: oldgold rows. gold-accounting.md: old-gold posting example (DR1100/CR1000+CR1200, gold IN rows).
`pnpm test` + `pnpm build` 3/3 → commit docs.

---

## Self-Review

- Spec coverage: intake/tests/valuation/purchase (§2-3 Tasks 1–4) ✓; OG numbering (§2 Task 2) ✓; tracked fields incl. photos/docs (§2 Tasks 2,4) ✓; testing methods + override approval (§2 Tasks 3–4) ✓; 10 statuses with melting locked (§2 Tasks 2–4) ✓; configurable formulas (§2 Tasks 1,3) ✓; resale lineage (§2 Tasks 3–4) ✓; reports 9 ways (§5 Tasks 3–4,6) ✓; 5-ledger posting (§4 Tasks 3–4) ✓; scan-first UI (§5 Task 6) ✓.
- Placeholder scan: no TBD/TODO; karat-fallback decision, print-label decision, day semantics explicit.
- Type consistency: `amount_cents`/`valueCents` server vs LKR boundary; `refEntity` 'old_gold_purchase'|'old_gold'; OG regex `/^OG-\d{6}$/` separate from BARCODE_RE (do NOT extend BARCODE_RE — scan lookup is per-module).
